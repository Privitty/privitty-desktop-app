import { app as rawApp, ipcMain } from 'electron'
import { EventEmitter } from 'events'
import { yerpc, BaseDeltaChat } from '@privitty/jsonrpc-client'
import { getRPCServerPath } from '@privitty/stdio-rpc-server'
import { join } from 'path'
import { existsSync, readdirSync } from 'fs'
import { arch, platform } from 'os'

import { getLogger } from '../../../shared/logger.js'
import * as mainWindow from '../../../frontend/src/components/windows/main.js'
import { ExtendedAppMainProcess } from '../types.js'
import DCWebxdc from './webxdc.js'
import { DesktopSettings } from '../desktop_settings.js'
import { StdioServer } from './stdio_server.js'
import { migrateAccountsIfNeeded } from './migration.js'
import {
  beginLicenseReload,
  emitPrivittyLicenseStatus,
  endLicenseReload,
  initLicenseManagerFromPersistedStore,
  licenseStoragePaths,
  reloadLicenseManagerFromDb,
  watchPrivittyLicenseDb,
} from '../privittyLicenseEvents.js'

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
 * Find the stdio-rpc-server binary in packaged app.
 *
 * In CI universal macOS builds all arch-specific optional packages
 * (@privitty/stdio-rpc-server-darwin-arm64, -darwin-x64) are replaced
 * with a single fat binary at @privitty/stdio-rpc-server-darwin-universal.
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
  const packageName = `@privitty/stdio-rpc-server-${currentPlatform}-${currentArch}`

  if (rawApp.isPackaged) {
    // In a packaged app, binaries live in app.asar.unpacked/node_modules/.
    // Try arch-specific package first, then fall back to the universal fat
    // binary created by the CI lipo step.
    const packageCandidates = [
      packageName,
      `@privitty/stdio-rpc-server-${currentPlatform}-universal`,
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
        log.info('Found stdio-rpc-server in packaged app:', unpackedPath)
        return unpackedPath
      }
      log.debug('stdio-rpc-server not at:', unpackedPath)
    }

    log.error(
      'stdio-rpc-server not found in app.asar.unpacked. ' + 'Tried packages:',
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

        // Collect all matching platform package directories and pick the latest version
        const prefix = packageName.replace('@privitty/', '@privitty+')
        const matchingDirs = entries.filter((entry: string) =>
          entry.startsWith(prefix)
        )

        // Sort by semver descending so we always prefer the newest installed version
        matchingDirs.sort((a: string, b: string) => {
          const verA = a.slice(prefix.length + 1).split('_')[0] // strip leading '@'
          const verB = b.slice(prefix.length + 1).split('_')[0]
          const partsA = verA.split('.').map(Number)
          const partsB = verB.split('.').map(Number)
          for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const diff = (partsB[i] ?? 0) - (partsA[i] ?? 0)
            if (diff !== 0) return diff
          }
          return 0
        })

        const targetDir = matchingDirs[0] as string | undefined

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

  get account_manager(): Readonly<StdioServer> {
    if (!this._inner_account_manager) {
      throw new Error('account manager is not defined (yet?)')
    }
    return this._inner_account_manager
  }

  /** for runtime info */
  rpcServerPath?: string

  constructor(public cwd: string) {
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
   * Initialize Privitty for the currently selected DeltaChat account.
   *
   * With the unified stdio-rpc-server all Privitty operations are handled
   * internally by the server process. This method:
   *   1. Calls `privittyInitialize` via JSONRPC so the server sets up the
   *      per-account database context.
   *   2. Initialises the global license manager and auto-activates if needed.
   *   3. Reads back the license status and forwards it to the renderer so the
   *      UI can show the PrivittyLicenseDialog when needed.
   *   4. Notifies the renderer that Privitty is ready.
   *
   * Triggered by the ImapConnected core event.
   */
  async openPrivittyVault(contextId?: number) {
    // Use the contextId from the ImapConnected event when available — that is
    // the exact account that connected, which may differ from getSelectedAccountId()
    // in multi-account setups.  Using the wrong account causes getChatSecurejoinQrCode
    // to fail with "No self addr configured" even though IMAP is up.
    const accountId: number =
      contextId || (await this.jsonrpcRemote.rpc.getSelectedAccountId()) || 0

    if (accountId === 0) {
      log.warn('openPrivittyVault: no account selected — skipping')
      return
    }

    // Initialise the Privitty context inside the unified RPC server.
    // Mirrors Android's prvContext.initialize() called from the IMAP-connected
    // handler.  The server creates / opens its SQLite databases on this call.
    try {
      await (this.jsonrpcRemote.rpc as any).privittyInitialize(accountId)
      log.info('openPrivittyVault: privittyInitialize completed', { accountId })
    } catch (error) {
      log.warn(
        'openPrivittyVault: privittyInitialize failed (non-fatal):',
        error
      )
    }

    // Obtain the Delta Chat contact-invite URL.
    // Mirrors Android's: isConfigured() == 1 → getSecurejoinQr(0)
    //
    // Prefer the account that just connected (contextId), but also check ALL
    // configured accounts — the securejoin QR only needs the on-disk key pair,
    // NOT active IMAP.  This means we get the link even if the triggering
    // account is freshly configured and hasn't fully connected yet.
    let inviteLink: string | null = null
    let deviceName: string | null = null
    const accountsToTry: number[] = [accountId]
    try {
      const allIds: number[] = await (
        this.jsonrpcRemote.rpc as any
      ).getAllAccountIds()
      for (const id of allIds) {
        if (!accountsToTry.includes(id)) accountsToTry.push(id)
      }
    } catch (_) {
      /* ignore — we'll still try the primary account */
    }

    for (const tryId of accountsToTry) {
      try {
        const configured: boolean = await (
          this.jsonrpcRemote.rpc as any
        ).isConfigured(tryId)
        if (!configured) continue
        // Capture display name from the first configured account for WatchTower.
        if (!deviceName) {
          try {
            const name: string | null = await (
              this.jsonrpcRemote.rpc as any
            ).getConfig(tryId, 'displayname')
            if (name && name.trim().length > 0) {
              deviceName = name.trim()
            } else {
              const addr: string | null = await (
                this.jsonrpcRemote.rpc as any
              ).getConfig(tryId, 'configured_addr')
              if (addr && addr.trim().length > 0) deviceName = addr.trim()
            }
          } catch (_inner) {
            /* ignore — name is optional */
          }
        }
        // Retry once after 3 s: on a freshly created chatmail account the
        // Ed25519 key pair may not be on disk yet when ImapConnected fires.
        let link: string | null = null
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 3000))
          try {
            link = await (
              this.jsonrpcRemote.rpc as any
            ).getChatSecurejoinQrCode(tryId, null)
            if (link) break
          } catch (inner) {
            log.info(
              'openPrivittyVault: getChatSecurejoinQrCode attempt failed',
              { tryId, attempt, reason: (inner as any)?.message ?? inner }
            )
          }
        }
        if (link) {
          inviteLink = link
          log.info('openPrivittyVault: invite link generated', {
            accountId: tryId,
            inviteLink,
          })
          break
        }
      } catch (error) {
        log.info(
          'openPrivittyVault: could not generate invite link for account (trying next):',
          { tryId, error }
        )
      }
    }
    if (!inviteLink) {
      log.warn(
        'openPrivittyVault: no configured account has an invite link yet — will retry on next ImapConnected'
      )
    }
    if (deviceName) {
      log.info('openPrivittyVault: device name resolved', { deviceName })
    }

    // Initialise the global Privitty license manager.
    //
    // The license manager is a process-level singleton — there is NO accountId
    // parameter on any license JSONRPC method.  The correct signature is:
    //   privittyLicenseInit(dataDir, licensePath, serverUrl, inviteLink?)
    //
    // dataDir     = <configPath>/license  (where privitty_license.db is stored)
    // licensePath = <configPath>/license/privitty.lic if the JWT file is present,
    //               null otherwise (manager reads from the cached DB)
    // serverUrl   = production PLM endpoint for activation / sync
    // inviteLink  = OPENPGP4FPR contact invite URL forwarded to WatchTower
    {
      const { licenseDbPath, licFilePath } = licenseStoragePaths()
      const hasInstalledLicense =
        existsSync(licenseDbPath) || existsSync(licFilePath)

      beginLicenseReload()
      try {
        try {
          await initLicenseManagerFromPersistedStore(
            this.jsonrpcRemote.rpc,
            inviteLink
          )
          log.info('openPrivittyVault: license manager initialised')
        } catch (error) {
          log.warn('openPrivittyVault: license init failed (non-fatal):', error)
        }

        // Read back the license status.
        // If the device is not yet activated and we have a JWT, attempt automatic
        // activation (mirrors Android's auto-activate on first launch with JWT).
        try {
          let statusCode: number = await (
            this.jsonrpcRemote.rpc as any
          ).privittyLicenseGetStatus()
          log.info('openPrivittyVault: license status before auto-activate', {
            statusCode,
          })

          // Attempt activation for any status that is not already confirmed active.
          // This covers NOT_ACTIVATED (3), BYPASS/debug (99), etc.
          if (
            statusCode !== 0 /* ACTIVE */ &&
            statusCode !== 1 /* GRACE_PERIOD */ &&
            hasInstalledLicense
          ) {
            try {
              if (deviceName) {
                await (
                  this.jsonrpcRemote.rpc as any
                ).privittyLicenseSetDeviceName(deviceName)
                log.info('openPrivittyVault: device name set', { deviceName })
              }
              await (this.jsonrpcRemote.rpc as any).privittyLicenseActivate()
              log.info('openPrivittyVault: auto-activation succeeded')
              statusCode = await (
                this.jsonrpcRemote.rpc as any
              ).privittyLicenseGetStatus()
              log.info(
                'openPrivittyVault: license status after auto-activate',
                {
                  statusCode,
                }
              )
            } catch (activateErr) {
              log.warn(
                'openPrivittyVault: auto-activation failed (user can retry via dialog):',
                activateErr
              )
            }
          } else if (statusCode === 0 || statusCode === 1) {
            // Device is already activated — re-activate unconditionally so PLM
            // and WatchTower always have an up-to-date record (PLM upserts on
            // device_id, so no extra seat is consumed).
            //
            // If an invite link is available, set it first so WatchTower can
            // link this device and show "Ready" for the invite status.
            // We do NOT gate on inviteLink !== null: the device must appear in
            // WatchTower's Connected Apps regardless of whether the securejoin
            // QR is available at this moment.
            try {
              if (inviteLink !== null) {
                await (
                  this.jsonrpcRemote.rpc as any
                ).privittyLicenseSetInviteLink(inviteLink)
              }
              if (deviceName) {
                await (
                  this.jsonrpcRemote.rpc as any
                ).privittyLicenseSetDeviceName(deviceName)
                log.info(
                  'openPrivittyVault: device name set for re-activation',
                  {
                    deviceName,
                  }
                )
              }
              await (this.jsonrpcRemote.rpc as any).privittyLicenseActivate()
              log.info('openPrivittyVault: re-activation pushed to PLM', {
                inviteLinkPresent: inviteLink !== null,
              })
            } catch (syncErr) {
              log.warn(
                'openPrivittyVault: re-activation failed (non-fatal):',
                syncErr
              )
            }
          }

          emitPrivittyLicenseStatus(accountId, statusCode)
          watchPrivittyLicenseDb(() => {
            void reloadLicenseManagerFromDb(
              this.jsonrpcRemote.rpc,
              accountId,
              inviteLink
            )
          })
        } catch (error) {
          log.warn(
            'openPrivittyVault: license status check failed (non-fatal):',
            error
          )
        }
      } finally {
        endLicenseReload()
      }
    }

    // Notify the renderer that Privitty is ready for this account.
    // The frontend PrivittyChatContext listens for this to run its initial scan.
    mainWindow.send('privittyServerReady', {})
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
        log.error('Failed to find stdio-rpc-server:', error)
        throw error
      }
    }

    this.rpcServerPath = serverPath
    log.info('using stdio-rpc-server at', { serverPath })

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
                log.info('ImapConnected: triggering openPrivittyVault', {
                  contextId,
                })
                this.openPrivittyVault(contextId)
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

    // Load the persisted license before the renderer window is created
    // (ipc.init awaits this method, then mainWindow.init runs). File-sharing
    // must not wait for ImapConnected / openPrivittyVault.
    await this.initPersistedPrivittyLicense()
  }

  /**
   * Create the global license manager from privitty_license.db as soon as
   * JSON-RPC is up. Activation / invite-link sync still happens later in
   * openPrivittyVault.
   */
  private async initPersistedPrivittyLicense(): Promise<void> {
    const rpc = this.jsonrpcRemote.rpc as any

    beginLicenseReload()

    try {
      await initLicenseManagerFromPersistedStore(rpc, null)

      log.info('initPersistedPrivittyLicense: license manager initialized')
    } catch (error) {
      log.warn(
        'initPersistedPrivittyLicense: license init failed (non-fatal):',
        error
      )
    } finally {
      endLicenseReload()
    }
  }
  readonly webxdc = new DCWebxdc(this)
}
