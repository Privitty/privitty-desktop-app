import { app as rawApp, ipcMain } from 'electron'
import { EventEmitter } from 'events'
import { yerpc, BaseDeltaChat, T } from '@privitty/jsonrpc-client'
import { getRPCServerPath } from '@privitty/deltachat-rpc-server'
import { join, dirname } from 'path'
import { existsSync, readdirSync } from 'fs'
import { arch, platform } from 'os'

import { getLogger } from '../../../shared/logger.js'
import * as mainWindow from '../../../frontend/src/components/windows/main.js'
import { ExtendedAppMainProcess } from '../types.js'
import DCWebxdc from './webxdc.js'
import { DesktopSettings } from '../desktop_settings.js'
import { StdioServer } from './stdio_server.js'
import { migrateAccountsIfNeeded } from './migration.js'

import { PrivittyClient } from '../privitty/client.js'

const app = rawApp as ExtendedAppMainProcess
const log = getLogger('main/deltachat')
const logCoreEvent = getLogger('core/event')

class ElectronMainTransport extends yerpc.BaseTransport {
  constructor(private sender: (message: yerpc.Message) => void) {
    super()
  }

  onMessage(message: yerpc.Message): void {
    this._onmessage(message)
  }

  _send(message: yerpc.Message): void {
    this.sender(message)
  }
}

export class JRPCDeltaChat extends BaseDeltaChat<ElectronMainTransport> {}

/**
 * Find DeltaChat RPC binary in packaged app.
 *
 * In CI universal macOS builds all arch-specific optional packages
 * (@privitty/deltachat-rpc-server-darwin-arm64, -darwin-x64) are replaced
 * with a single fat binary at @privitty/deltachat-rpc-server-darwin-universal.
 * We try candidates in order:
 *   1. arch-specific  (non-universal or dev builds)
 *   2. -darwin-universal (universal macOS production build)
 */
function findDeltaChatBinaryInPackagedApp(): string | null {
  const currentPlatform = platform()
  const currentArch = arch()

  const binaryName =
    currentPlatform === 'win32'
      ? 'deltachat-rpc-server.exe'
      : 'deltachat-rpc-server'

  // Arch-specific package name — used by both the packaged-app and dev resolvers.
  const packageName = `@privitty/deltachat-rpc-server-${currentPlatform}-${currentArch}`

  if (rawApp.isPackaged) {
    // In a packaged app, binaries live in app.asar.unpacked/node_modules/.
    // Try arch-specific package first, then fall back to the universal fat
    // binary created by the CI lipo step.
    const packageCandidates = [
      packageName,
      `@privitty/deltachat-rpc-server-${currentPlatform}-universal`,
    ]

    for (const candidate of packageCandidates) {
      const unpackedPath = join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        candidate,
        binaryName
      )
      if (existsSync(unpackedPath)) {
        log.info('Found deltachat-rpc-server in packaged app:', unpackedPath)
        return unpackedPath
      }
      log.debug('deltachat-rpc-server not at:', unpackedPath)
    }

    log.error(
      'deltachat-rpc-server not found in app.asar.unpacked. ' +
        'Tried packages:',
      packageCandidates
    )
    return null
  } else {
    // In development: search in pnpm store
    // __dirname when running from bundle_out/ will be: packages/target-electron/bundle_out
    // So we need to go up to the workspace root to find .pnpm store
    const searchPaths = [
      join(__dirname, '../../../node_modules/.pnpm'), // workspace root from bundle_out
      join(__dirname, '../../node_modules/.pnpm'), // packages/target-electron from bundle_out
      join(__dirname, '../../../../node_modules/.pnpm'), // if there's deeper nesting
    ]

    log.info('DeltaChat development mode - searching for binary:', {
      packageName,
      binaryName,
      __dirname,
      searchPaths,
    })

    for (const pnpmStore of searchPaths) {
      if (!existsSync(pnpmStore)) {
        log.debug('pnpm store does not exist:', pnpmStore)
        continue
      }

      try {
        const entries = readdirSync(pnpmStore)

        // Find the platform-specific package directory
        const targetDir = entries.find((entry: string) =>
          entry.startsWith(packageName.replace('@privitty/', '@privitty+'))
        )

        if (targetDir) {
          const binaryPath = join(
            pnpmStore,
            targetDir,
            'node_modules',
            packageName,
            binaryName
          )

          log.info('Checking binary path:', binaryPath)

          if (existsSync(binaryPath)) {
            log.info('Found DeltaChat binary in pnpm store:', binaryPath)
            return binaryPath
          } else {
            log.warn(
              'Binary path exists in pnpm but file not found:',
              binaryPath
            )
          }
        } else {
          log.debug('Target directory not found in pnpm store:', packageName)
        }
      } catch (error) {
        log.debug('Error searching pnpm store:', pnpmStore, error)
      }
    }

    log.warn('DeltaChat binary not found in pnpm stores')
    return null
  }
}

/**
 * DeltaChatController
 *
 * - proxy for a deltachat instance
 * - sends events to renderer
 * - handles events from renderer
 */
export default class DeltaChatController extends EventEmitter {
  /**
   * Created and owned by ipc on the backend
   */

  _inner_account_manager: StdioServer | null = null
  _inner_privitty_account_manager: PrivittyClient | null = null
  _inner_globalPrivittyCounter: number = 0
  callbackMap = new Map<number, (response: any) => void>()

  get account_manager(): Readonly<StdioServer> {
    if (!this._inner_account_manager) {
      throw new Error('account manager is not defined (yet?)')
    }
    return this._inner_account_manager
  }

  get privitty_account_manager(): Readonly<PrivittyClient> {
    if (!this._inner_privitty_account_manager) {
      throw new Error('account manager is not defined (yet?)')
    }
    return this._inner_privitty_account_manager
  }

  getGlobalSequence(): number {
    return ++this._inner_globalPrivittyCounter
  }

  /** for runtime info */
  rpcServerPath?: string

  constructor(
    public cwd: string,
    public onPrivittyData: (reponse: string) => void
  ) {
    super()
  }

  _jsonrpcRemote: JRPCDeltaChat | null = null
  get jsonrpcRemote(): Readonly<JRPCDeltaChat> {
    if (!this._jsonrpcRemote) {
      throw new Error('_jsonrpcRemote is not defined (yet?)')
    }
    return this._jsonrpcRemote
  }

  /**
   * Initialize the Privitty server for the currently selected DeltaChat account
   * and switch to that account's profile.
   *
   * Mirrors Android's initializePrivittyForSelectedAccount():
   *   1. Resolve the per-account directory via getBlobDir() → parent.
   *   2. Start (or restart) privitty-server scoped to that directory so it
   *      creates .privitty/ at accounts/<UUID>/.privitty/ (not the root).
   *   3. Fetch displayname + configured_addr directly from DeltaChat config.
   *   4. Call switchProfile only when displayname is non-empty.
   *
   * Triggered by the ImapConnected core event and also available via IPC
   * (privittyOpenVault) for manual invocation from the frontend.
   */
  async openPrivittyVault() {
    const accountId: number =
      (await this.jsonrpcRemote.rpc.getSelectedAccountId()) || 0

    if (accountId === 0) {
      log.warn('openPrivittyVault: no account selected — skipping')
      return
    }

    // Resolve per-account directory the same way Android does:
    //   dcContext.getBlobdir()            → e.g. .../accounts/<UUID>/blobs
    //   new File(blobdir).getParentFile() → e.g. .../accounts/<UUID>/
    let accountDir: string | null = null
    try {
      const blobDir = await this.jsonrpcRemote.rpc.getBlobDir(accountId)
      if (blobDir) {
        accountDir = dirname(blobDir)
        log.info('openPrivittyVault: account directory resolved:', accountDir)
      }
    } catch (error) {
      log.error(
        'openPrivittyVault: getBlobDir failed for account',
        accountId,
        error
      )
    }

    if (!accountDir) {
      log.error(
        'openPrivittyVault: could not resolve account directory — aborting'
      )
      return
    }

    // Start (or restart) privitty-server scoped to this account's directory.
    this._inner_privitty_account_manager?.startWithPath(accountDir)

    // Fetch display name and configured address directly from DeltaChat config.
    // Mirrors Android: dcContext.getConfig(CONFIG_DISPLAY_NAME / CONFIG_CONFIGURED_ADDRESS).
    // Using batchGetConfig avoids the race condition of the old module-level
    // dispName variable, which could still be empty when ImapConnected fires.
    const config = await this.jsonrpcRemote.rpc.batchGetConfig(accountId, [
      'displayname',
      'configured_addr',
      'addr',
    ])

    const displayName = config.displayname ?? ''
    const userEmail = config.configured_addr || config.addr || ''

    if (!displayName) {
      // Mirrors Android: skip switchProfile when userName is null or empty.
      log.warn(
        'openPrivittyVault: displayname is empty — switchProfile skipped'
      )
      return
    }

    log.info('openPrivittyVault: switching profile', { displayName, userEmail })

    // IMPORTANT: await the switchProfile response before notifying the renderer.
    // The server sets up the user database context only AFTER processing
    // switchProfile. If we notify the renderer earlier, the frontend scan
    // (isChatProtected / isPrivittyMessage) runs before the user context
    // exists — every query returns false — and gibberish stays visible.
    // A 20-second timeout prevents hanging if the server is unresponsive.
    try {
      await Promise.race([
        this.sendPrivittyMessage('switchProfile', {
          username: displayName,
          user_email: userEmail,
          user_id: String(accountId),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('switchProfile timeout')), 20_000)
        ),
      ])
      log.info(
        'openPrivittyVault: switchProfile completed — notifying renderer'
      )
    } catch (error) {
      log.error(
        'openPrivittyVault: switchProfile error (proceeding anyway):',
        error
      )
    }

    // Notify the renderer that the privitty-server is fully ready.
    // The frontend PrivittyChatContext listens for this to run its scan.
    mainWindow.send('privittyServerReady', {})
  }

  sendPrivittyMessage(method: string, params: any) {
    return new Promise<string>((resolve, _reject) => {
      const sequenceNumber = this.getGlobalSequence()
      this.callbackMap.set(sequenceNumber, response =>
        resolve(response as string)
      )
      this._inner_privitty_account_manager?.sendJsonRpcRequest(
        method,
        params,
        sequenceNumber
      )
    })
  }

  /**
   * Check whether a given DeltaChat chat has an active Privitty secure
   * connection.  Mirrors Android's prvContext.prvIsChatProtected(chatId).
   *
   * Returns false if:
   *   - privitty-server is not running yet
   *   - the chat has never been Privitty-enabled (no peer-exchange done)
   *   - any error occurs during the RPC call
   *
   * Used as a guard before sending file-access queries so that the server
   * never receives requests for chats it doesn't know about.
   */
  async isChatProtected(chatId: string): Promise<boolean> {
    if (!this._inner_privitty_account_manager?.isRunning) {
      return false
    }
    try {
      const responseStr = await this.sendPrivittyMessage('isChatProtected', {
        chat_id: chatId,
      })
      const response = JSON.parse(responseStr)
      const result = response?.result
      // Server may return a bare boolean or a { is_protected: bool } object
      if (typeof result === 'boolean') return result
      if (typeof result?.is_protected === 'boolean') return result.is_protected
      return false
    } catch {
      return false
    }
  }

  async sendMessageToPeer(pdu: string, chatId: number) {
    log.debug('sendMessageToPeer', { chatId })
    try {
      const MESSAGE_DEFAULT: T.MessageData = {
        file: null,
        filename: null,
        viewtype: null,
        html: null,
        location: null,
        overrideSenderName: null,
        quotedMessageId: null,
        quotedText: null,
        text: null,
      }
      const message: Partial<T.MessageData> = {
        text: pdu,
        file: undefined,
        filename: undefined,
        quotedMessageId: null,
        viewtype: 'Text',
      }
      await this.jsonrpcRemote.rpc.sendMsg(
        (await this.jsonrpcRemote.rpc.getSelectedAccountId()) || 0,
        chatId,
        { ...MESSAGE_DEFAULT, ...message }
      )
      log.debug('Message sent to peer')
    } catch (e) {
      log.warn('sendMessageToPeer error', e)
    }
  }

  // Handles MsgsChanged events for two distinct message categories:
  //
  //  A. BCC-self outgoing copies (isOutgoing=true, bcc_self enabled):
  //     PRIVITTY_SYNC: database sync payloads from the same user on another device.
  //
  //  B. All encrypted text messages (incoming OR outgoing, bcc_self irrelevant):
  //     Regular Privitty PDUs — on desktop these arrive via MsgsChanged, not
  //     IncomingMsg, for companion-device messages.
  //
  async handleMsgsChangedEvent(response: string) {
    const responseObj = JSON.parse(response)
    try {
      const msgId: number = responseObj.result.event.msgId
      const chatId: number = responseObj.result.event.chatId
      const contextId: number = responseObj.result.contextId

      // Skip if msgId or chatId is invalid
      if (!msgId || !chatId) return

      const Msg = await this.jsonrpcRemote.rpc.getMessage(contextId, msgId)
      if (!Msg) return

      const chatInfo = await this.jsonrpcRemote.rpc.getBasicChatInfo(
        contextId,
        chatId
      )

      // Common requirements: encrypted, text-only, not a contact request
      const isEncrypted = Msg.showPadlock
      const hasNoFile = !Msg.file
      const isNotContactRequest = !chatInfo?.isContactRequest

      if (!isEncrypted || !hasNoFile || !isNotContactRequest) return
      if (!Msg.text) return

      // ── Path A: PRIVITTY_SYNC (BCC-self only) ────────────────────────────
      // SYNC payloads are self-addressed messages sent by the same user on
      // another device. Only process them when outgoing + bcc_self enabled.
      if (Msg.text.startsWith('PRIVITTY_SYNC:')) {
        if (!Msg.isOutgoing) return
        const config = await this.jsonrpcRemote.rpc.batchGetConfig(contextId, [
          'bcc_self',
        ])
        if (config?.bcc_self !== '1') return
        try {
          const syncJson = JSON.parse(Msg.text.slice('PRIVITTY_SYNC:'.length))
          log.debug(
            'handleMsgsChangedEvent: Received BCC-self PRIVITTY_SYNC',
            syncJson
          )
          await this.applyPrivittySyncData(syncJson)
        } catch (e) {
          log.warn('handleMsgsChangedEvent: Invalid sync payload', e)
        }
        return
      }

      // ── Path B: Privitty PDU (any direction) ─────────────────────────────
      // All encrypted Privitty PDUs — both incoming partner messages and
      // BCC-self copies — are processed here regardless of isOutgoing or
      // bcc_self, because on desktop they all arrive via MsgsChanged.
      const isPrivittyResp = await this.sendPrivittyMessage(
        'isPrivittyMessage',
        {
          base64_data: Msg.text,
        }
      )
      const isPrivittyParsed = JSON.parse(isPrivittyResp)
      if (!isPrivittyParsed?.result?.is_valid) return

      log.info(
        'handleMsgsChangedEvent: Processing Privitty PDU, outgoing=' +
          Msg.isOutgoing
      )

      const resp = await this.sendPrivittyMessage('processMessage', {
        event_data: {
          chat_id: String(chatId),
          pdu: Msg.text,
        },
      })

      const json = JSON.parse(resp)
      if (json?.error) {
        log.warn('handleMsgsChangedEvent: processMessage error', json.error)
        return
      }

      const pdu = json?.result?.data?.pdu
      const targetChatId = Number(json?.result?.data?.chat_id)
      if (pdu && targetChatId) {
        this.sendMessageToPeer(pdu, targetChatId)
      }
    } catch (err) {
      log.error('handleMsgsChangedEvent error', err)
    }
  }

  // Mirrors Android's DC_EVENT_INCOMING_MSG handler in ApplicationContext.java.
  async privittyHandleIncomingMsg(response: string) {
    const responseObj = JSON.parse(response)
    const contextId: number = responseObj.result.contextId
    const chatId: number = responseObj.result.event.chatId

    const Msg = await this.jsonrpcRemote.rpc.getMessage(
      contextId,
      responseObj.result.event.msgId
    )
    const chatInfo = await this.jsonrpcRemote.rpc.getBasicChatInfo(
      contextId,
      chatId
    )

    if (!Msg.showPadlock || chatInfo.isContactRequest) return

    // ── Branch 1: text message (PDU or SYNC) ─────────────────────────────────
    if (Msg.text && Msg.text.trim() !== '') {
      if (Msg.text.startsWith('PRIVITTY_SYNC:')) {
        try {
          const syncJson = JSON.parse(Msg.text.slice('PRIVITTY_SYNC:'.length))
          log.debug('Received PRIVITTY_SYNC payload')
          await this.applyPrivittySyncData(syncJson)
        } catch (e) {
          log.warn('privittyHandleIncomingMsg: Invalid sync payload', e)
        }
        return
      }

      // Regular Privitty PDU — mirrors Android's prvIsPrivittyMessageString
      // followed by prvProcessMessage.
      const isPrivittyRaw = await this.sendPrivittyMessage(
        'isPrivittyMessage',
        {
          base64_data: Msg.text,
        }
      )
      await this.handlePrivittyValidation(isPrivittyRaw, Msg, chatId)
      return
    }

    // ── Branch 2: forwarded .prv file ────────────────────────────────────────
    // Mirrors Android's else-if (dcMsg.hasFile()) branch.
    // Checks the file access status so the server can register it in its DB.
    // Android waits up to 5 s (10 × 500 ms) for the file to download first.
    if (Msg.file) {
      const isPrvFile =
        Msg.file.endsWith('.prv') || (Msg.filename ?? '').endsWith('.prv')
      const isForwarded = Msg.isForwarded ?? false
      const isIncoming = !Msg.isOutgoing

      if (isPrvFile && isForwarded && isIncoming) {
        const filePath = Msg.file
        const chatIdStr = String(chatId)

        // Fire-and-forget, same as Android's background thread
        ;(async () => {
          try {
            if (!(await this.isChatProtected(chatIdStr))) return

            // Wait up to 5 s for the file to be written to disk
            const maxRetries = 10
            let fileExists = false
            for (let i = 0; i < maxRetries; i++) {
              if (existsSync(filePath)) {
                fileExists = true
                break
              }
              await new Promise(r => setTimeout(r, 500))
            }

            if (!fileExists) {
              log.warn(
                'privittyHandleIncomingMsg: forwarded .prv not downloaded after retries',
                filePath
              )
              return
            }

            const statusResp = await this.sendPrivittyMessage(
              'getFileAccessStatus',
              {
                event_data: { chat_id: chatIdStr, file_path: filePath },
              }
            )
            const status = JSON.parse(statusResp)?.result?.data?.status ?? ''
            if (status === 'not_found') {
              log.info(
                'privittyHandleIncomingMsg: .prv not in server DB yet — registers on first access',
                filePath
              )
            } else {
              log.info(
                'privittyHandleIncomingMsg: .prv registered, status:',
                status
              )
            }
          } catch (e) {
            log.warn(
              'privittyHandleIncomingMsg: forwarded .prv check failed',
              e
            )
          }
        })()
      }
    }
  }

  async applyPrivittySyncData(syncJson: any) {
    if (syncJson.type !== 'privitty_sync') return

    const action = syncJson.action
    const data = syncJson.data

    log.debug('Applying sync action:', action)

    switch (action) {
      case 'update_chat':
        await this.sendPrivittyMessage('updateChat', data)
        break
      case 'delete_file':
        await this.sendPrivittyMessage('deleteFile', data)
        break
      case 'update_config':
        await this.sendPrivittyMessage('updateConfig', data)
        break
      default:
        log.warn('Unknown sync action:', action)
    }
  }

  async handlePrivittyValidation(response: string, msg: any, chatId: number) {
    const parsed = JSON.parse(response)

    if (!parsed?.result?.is_valid) return

    log.info('Received incoming Privitty message')

    // Notify the renderer immediately so the chatlist can update without polling.
    // The frontend's PrivittyChatContext listens on 'privittyMessageDetected'
    // and marks the chat as Privitty-protected in its in-memory cache.
    mainWindow.send('privittyMessageDetected', { chatId })

    try {
      // The server requires params wrapped in event_data.
      // The direction field has been removed — Android removed it from the
      // library (commented out with "TODO: Remove from library") and it caused
      // "Forwardee contact not found" for incoming revoke messages.
      const resp = await this.sendPrivittyMessage('processMessage', {
        event_data: {
          chat_id: String(chatId),
          pdu: msg.text,
        },
      })

      const json = JSON.parse(resp)

      if (json?.error) {
        log.warn('processMessage returned an error', json.error)
        return
      }

      const pdu = json?.result?.data?.pdu
      const targetChatId = Number(json?.result?.data?.chat_id)

      if (pdu && targetChatId) {
        this.sendMessageToPeer(pdu, targetChatId)
      }
    } catch (err) {
      log.error('Failed to handle processMessage response', err)
    }
  }

  async init() {
    log.debug('Check if legacy accounts need migration')
    if (await migrateAccountsIfNeeded(this.cwd, getLogger('migration'))) {
      // Clear some settings that we can't migrate
      DesktopSettings.update({
        lastAccount: undefined,
        lastChats: {},
        lastSaveDialogLocation: undefined,
      })
    }

    log.debug('Initiating DeltaChatNode')

    // Try custom resolver first (works in packaged apps)
    let serverPath = findDeltaChatBinaryInPackagedApp()

    // Fall back to the npm package's resolver if custom resolver failed
    if (!serverPath) {
      log.debug('Custom resolver failed, trying getRPCServerPath()')
      try {
        serverPath = await getRPCServerPath({
          // Always allow environment override for local core usage
          disableEnvPath: false,
        })
        if (serverPath.includes('app.asar')) {
          // probably inside of electron build
          serverPath = serverPath.replace('app.asar', 'app.asar.unpacked')
        }
      } catch (error) {
        log.error('Failed to find deltachat-rpc-server:', error)
        throw error
      }
    }

    this.rpcServerPath = serverPath
    log.info('using deltachat-rpc-server at', { serverPath })

    this._inner_account_manager = new StdioServer(
      response => {
        try {
          // The `main-` in the ID prefix signifies that this is a response
          // to a request that originated from this (main) process's
          // JSON-RPC client, and not the JSON-RPC client
          // of the renderer process.
          // Thus we don't need to forward this response
          // to the renderer process.
          if (response.indexOf('"id":"main-') !== -1) {
            const message = JSON.parse(response)
            if (message.id.startsWith('main-')) {
              message.id = Number(message.id.replace('main-', ''))
              mainProcessTransport.onMessage(message)
              return
            }
          }
        } catch (error) {
          log.error('jsonrpc-decode', error)
        }
        if (response.indexOf('"kind":"IncomingMsg"') !== -1) {
          this.privittyHandleIncomingMsg(response)
        }
        if (response.indexOf('"kind":"MsgsChanged"') !== -1) {
          this.handleMsgsChangedEvent(response)
        }
        mainWindow.send('json-rpc-message', response)

        if (response.indexOf('event') !== -1)
          try {
            const { result } = JSON.parse(response)
            const { contextId, event } = result
            if (
              contextId !== undefined &&
              typeof event === 'object' &&
              event.kind
            ) {
              // A workaround.
              // Intercept the events that go to the renderer
              // and manually fire them on this JSON-RPC client.
              // See comments below about why we don't call `rpc.getNextEvent()`
              // on this JSON-RPC client.
              //
              // Note that, as you can see, if the renderer process
              // stops polling for events for whatever reason,
              // we will also stop emitting them here.
              //
              // The code is copy-pasted from
              // https://github.com/chatmail/core/blob/df0c0c47bacabfb8dcb4a5ea5edd92dc0652e0b3/deltachat-jsonrpc/typescript/src/client.ts#L56-L70
              const jsonrpcRemote_ = this._jsonrpcRemote
              if (jsonrpcRemote_) {
                type JRPCDeltaChatWithPrivateExposed = {
                  [P in keyof typeof jsonrpcRemote_]: (typeof jsonrpcRemote_)[P]
                } & {
                  contextEmitters: (typeof jsonrpcRemote_)['contextEmitters']
                }
                const jsonrpcRemote =
                  jsonrpcRemote_ as unknown as JRPCDeltaChatWithPrivateExposed
                jsonrpcRemote.emit(
                  result.event.kind,
                  result.contextId,
                  result.event
                )
                jsonrpcRemote.emit('ALL', result.contextId, result.event)
                if (jsonrpcRemote.contextEmitters[result.contextId]) {
                  jsonrpcRemote.contextEmitters[result.contextId].emit(
                    result.event.kind,
                    result.event as any
                  )
                  jsonrpcRemote.contextEmitters[result.contextId].emit(
                    'ALL',
                    result.event as any
                  )
                }
              }

              if (event.kind === 'WebxdcRealtimeData') {
                return
              }
              if (event.kind === 'Warning') {
                logCoreEvent.warn(contextId, event.msg)
              } else if (event.kind === 'Info') {
                logCoreEvent.info(contextId, event.msg)
              } else if (event.kind.startsWith('Error')) {
                logCoreEvent.error(contextId, event.msg)
              } else if (event.kind === 'ImapConnected') {
                this.openPrivittyVault()
              } else if (app.rc['log-debug']) {
                // in debug mode log all core events
                const event_clone = Object.assign({}, event) as Partial<
                  typeof event
                >
                delete event_clone.kind
                logCoreEvent.debug(contextId, event.kind, event)
              }
            }
          } catch (_error) {
            // ignore json parse errors
            return
          }
      },
      this.cwd,
      serverPath
    )

    // PrivittyClient is created with the accounts root as a placeholder path.
    // The actual per-account directory is set lazily in openPrivittyVault()
    // once the selected account is known (triggered by ImapConnected).
    // When the server emits its first JSON response (= fully initialised),
    // we notify the renderer so it can run the Privitty chatlist scan.
    this._inner_privitty_account_manager = new PrivittyClient(response => {
      // Forward all messages to the IPC callback (frontend).
      try {
        this.onPrivittyData(response)
      } catch (error) {
        log.error('Error in onPrivittyData callback:', error)
      }
      // Resolve any pending JSON-RPC requests by ID.
      try {
        const resp = JSON.parse(response.trim())
        if (resp.id !== undefined && this.callbackMap.has(resp.id)) {
          const resolve = this.callbackMap.get(resp.id)
          if (resolve) {
            resolve(response)
          }
          this.callbackMap.delete(resp.id)
        }
      } catch (error) {
        log.error('Failed to parse privitty-server response:', error)
      }
    }, this.cwd)

    this.account_manager.start()

    const mainProcessTransport = new ElectronMainTransport(message => {
      message.id = `main-${message.id}`
      this.account_manager.send(JSON.stringify(message))
    })

    ipcMain.handle('json-rpc-request', (_ev, message) => {
      this.account_manager.send(message)
    })

    this._jsonrpcRemote = new JRPCDeltaChat(
      mainProcessTransport,
      // Do NOT start calling `rpc.getNextEvent`.
      // Because there can be only one consumer of
      // `get_next_event`, and that is the renderer process's JSON-RPC client.
      false
    )

    if (DesktopSettings.state.syncAllAccounts) {
      log.info('Ready, starting accounts io...')
      this.jsonrpcRemote.rpc.startIoForAllAccounts()
      log.info('Started accounts io.')
    }
    for (const account of await this.jsonrpcRemote.rpc.getAllAccountIds()) {
      this.jsonrpcRemote.rpc.setConfig(
        account,
        'verified_one_on_one_chats',
        '1'
      )
    }
  }

  readonly webxdc = new DCWebxdc(this)
}
