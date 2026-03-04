import { copyFile, writeFile, mkdir, rm } from 'fs/promises'
import {
  app as rawApp,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  shell,
  NativeImage,
  systemPreferences,
} from 'electron'
import path, {
  basename,
  extname,
  join,
  posix,
  sep,
  dirname,
  normalize,
} from 'path'
import { inspect } from 'util'
import { platform } from 'os'
import { existsSync } from 'fs'
import { versions } from 'process'
import { fileURLToPath } from 'url'

import { getLogger } from '../../shared/logger.js'
import {
  getDraftTempDir,
  getLogsPath,
  htmlDistDir,
  INTERNAL_TMP_DIR_NAME,
} from './application-constants.js'
import { LogHandler } from './log-handler.js'
import { ExtendedAppMainProcess } from './types.js'
import * as mainWindow from '../../frontend/src/components/windows/main.js'
import { openHelpWindow } from '../../frontend/src/components/windows/help.js'
import { DesktopSettings } from './desktop_settings.js'
import { getConfigPath } from './application-constants.js'
import { DesktopSettingsType, RuntimeInfo } from '../../shared/shared-types.js'
import { set_has_unread, updateTrayIcon } from './tray.js'
import { openHtmlEmailWindow } from '../../frontend/src/components/windows/html_email.js'
import { appx, mapPackagePath } from './isAppx.js'
import DeltaChatController from './deltachat/controller.js'
import { BuildInfo } from './get-build-info.js'
import { updateContentProtectionOnAllActiveWindows } from './content-protection.js'
import { MediaType } from '@deltachat-desktop/runtime-interface'
import * as fs from 'fs/promises' // Using the promise-based API for async/await

const __dirname = dirname(fileURLToPath(import.meta.url))

const log = getLogger('main/ipc')

const app = rawApp as ExtendedAppMainProcess

let dcController: typeof DeltaChatController.prototype
export function getDCJsonrpcClient() {
  return dcController.jsonrpcRemote.rpc
}

/** returns shutdown function */
export async function init(cwd: string, logHandler: LogHandler) {
  const main = mainWindow
  dcController = new DeltaChatController(cwd, onPrivittyMessage)

  function onPrivittyMessage(response: string) {
    log.info('Privitty message received in IPC')

    // Forward all privitty messages to the frontend
    try {
      const parsed = JSON.parse(response)
      log.debug('Sending privitty event to frontend')

      // Send to all windows
      main.window?.webContents.send('privitty-message', parsed)
    } catch (error) {
      log.error('Error forwarding privitty message to frontend:', error)
    }
  }

  try {
    await dcController.init()
  } catch (error) {
    log.critical(
      "Fatal: The Privitty Chat module couldn't be loaded. Please check if all dependencies are installed!",
      error,
      dcController.rpcServerPath
    )
    /* ignore-console-log */
    console.error(
      "Fatal: The Privitty Chat module couldn't be loaded. Please check if all dependencies are installed!",
      error,
      dcController.rpcServerPath
    )

    dialog.showErrorBox(
      'Fatal Error',
      `The Privitty Chat module couldn't be loaded.
  Please check if all dependencies are installed!
  The Log file is located in this folder: ${getLogsPath()}\n
  ${dcController.rpcServerPath}\n
  ${error instanceof Error ? error.message : inspect(error, { depth: null })}`
    )

    rawApp.exit(1)
  }

  ipcMain.once('ipcReady', _e => {
    app.ipcReady = true
    app.emit('ipcReady')
  })

  ipcMain.on('show', () => main.show())
  // ipcMain.on('setAllowNav', (e, ...args) => menu.setAllowNav(...args))

  ipcMain.on('handleLogMessage', (_e, channel, level, stacktrace, ...args) =>
    logHandler.log(channel, level, stacktrace, ...args)
  )

  ipcMain.on('ondragstart', (event, filePath) => {
    let icon: NativeImage
    try {
      icon = nativeImage.createFromPath(
        join(htmlDistDir(), 'images/electron-file-drag-out.png')
      )
      if (icon.isEmpty()) {
        throw new Error('load failed')
      }
    } catch (error) {
      log.warn('drag out icon could not be loaded', error)
      // create dummy black image
      const size = 64 ** 2 * 4
      const buffer = Buffer.alloc(size)
      for (let i = 0; i < size; i += 4) {
        buffer[i] = 0
        buffer[i + 1] = 0
        buffer[i + 2] = 0
        buffer[i + 3] = 255
      }
      icon = nativeImage.createFromBitmap(buffer, { height: 64, width: 64 })
    }

    event.sender.startDrag({
      file: filePath,
      icon,
    })
  })

  ipcMain.on('help', async (_ev, locale, anchor?: string) => {
    await openHelpWindow(locale, anchor)
  })

  ipcMain.on('reload-main-window', () => {
    if (!mainWindow.window) {
      throw new Error('window does not exist, this should never happen')
    }
    mainWindow.window.webContents.reload()
  })

  ipcMain.on('get-log-path', ev => {
    ev.returnValue = logHandler.logFilePath()
  })

  ipcMain.on('get-config-path', ev => {
    ev.returnValue = getConfigPath().split(sep).join(posix.sep)
  })

  ipcMain.on('get-rc-config', ev => {
    ev.returnValue = app.rc
  })

  ipcMain.on('get-runtime-info', ev => {
    const info: RuntimeInfo = {
      isMac: platform() === 'darwin',
      isAppx: appx,
      target: 'electron',
      versions: [
        { label: 'electron', value: versions.electron },
        { label: 'node', value: versions.node },
      ],
      runningUnderARM64Translation: app.runningUnderARM64Translation,
      rpcServerPath: dcController.rpcServerPath,
      buildInfo: BuildInfo,
      isContentProtectionSupported:
        platform() === 'darwin' || platform() === 'win32',
    }
    ev.returnValue = info
  })

  ipcMain.on('app-get-path', (ev, arg) => {
    ev.returnValue = app.getPath(arg)
  })

  /**
   * https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesgetmediaaccessstatusmediatype-windows-macos
   */
  ipcMain.handle('checkMediaAccess', (_ev, mediaType: MediaType) => {
    if (!systemPreferences.getMediaAccessStatus) {
      return new Promise(resolve => {
        resolve('unknown')
      })
    }
    if (mediaType === 'camera') {
      return systemPreferences.getMediaAccessStatus('camera')
    } else if (mediaType === 'microphone') {
      return systemPreferences.getMediaAccessStatus('microphone')
    } else {
      throw new Error('checkMediaAccess: unsupported media type')
    }
  })

  /**
   * https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesaskformediaaccessmediatype-macos
   */
  ipcMain.handle(
    'askForMediaAccess',
    (_ev, mediaType: MediaType): Promise<boolean | undefined> => {
      if (systemPreferences.askForMediaAccess) {
        if (mediaType === 'camera') {
          return systemPreferences.askForMediaAccess('camera')
        } else if (mediaType === 'microphone') {
          return systemPreferences.askForMediaAccess('microphone')
        }
      }
      return new Promise(resolve => {
        resolve(undefined)
      })
    }
  )

  ipcMain.handle('fileChooser', async (_ev, options) => {
    if (!mainWindow.window) {
      throw new Error('window does not exist, this should never happen')
    }
    const returnValue = await dialog.showOpenDialog(mainWindow.window, options)
    mainWindow.window.filePathWhiteList.push(...returnValue.filePaths)
    return returnValue
  })

  let lastSaveDialogLocation: string | undefined = undefined
  ipcMain.handle(
    'saveFile',
    async (_ev, pathToSource: string, filename: string) => {
      if (!mainWindow.window) {
        throw new Error('window does not exist, this should never happen')
      }

      let base_path = lastSaveDialogLocation || app.getPath('downloads')

      if (!existsSync(base_path)) {
        base_path = app.getPath('downloads')
      }

      const { canceled, filePath } = await dialog.showSaveDialog(
        mainWindow.window,
        {
          defaultPath: join(base_path, filename),
        }
      )

      if (!canceled && filePath) {
        try {
          await copyFile(pathToSource, filePath)
        } catch (error: any) {
          if (error.code == 'EACCES') {
            dialog.showErrorBox(
              'Permission Error',
              `Cannot write in this folder. You don't have write permission`
            )
          } else {
            dialog.showErrorBox(
              'Unhandled Error',
              `Cannot copy file. Error: ${error}`
            )
          }
        }
        lastSaveDialogLocation = path.dirname(filePath)
      }
    }
  )

  ipcMain.handle('getFileExist', async (_ev, filePath) => {
    try {
      // Check access to the file with the F_OK flag (default, checks for existence)
      await fs.access(filePath)
      return true // No error means the file exists
    } catch (error) {
      log.error('Error checking file existence:', error)
    }
    return false
  })

  // Privitty IPC handlers
  // Methods that query per-chat file-access data.  The privitty-server only
  // knows about chats that have completed a Privitty peer-exchange; calling
  // these for an unprotected chat would produce "Chat does not exist" errors.
  // We guard with isChatProtected() first — mirroring Android's pattern of
  // checking prvIsChatProtected() before invoking any file-access API.
  const FILE_ACCESS_METHODS = new Set([
    'getFileAccessStatus',
    'getFileAccessStatusList',
  ])

  ipcMain.handle(
    'privitty_Send_Message',
    async (_ev, method: string, params: any) => {
      if (FILE_ACCESS_METHODS.has(method)) {
        const chatId = String(params?.chat_id ?? params?.chatId ?? '')
        if (chatId) {
          const isProtected = await dcController.isChatProtected(chatId)
          if (!isProtected) {
            log.debug(
              `privitty_Send_Message: chat ${chatId} is not Privitty-protected` +
                ` — skipping ${method}`
            )
            return JSON.stringify({ success: true, data: null })
          }
        }
      }
      return dcController.sendPrivittyMessage(method, params)
    }
  )

  ipcMain.handle('get-desktop-settings', async _ev => {
    return DesktopSettings.state
  })

  ipcMain.handle(
    'set-desktop-setting',
    (
      _ev,
      key: keyof DesktopSettingsType,
      value: string | number | boolean | undefined
    ) => {
      DesktopSettings.update({ [key]: value })

      if (key === 'minimizeToTray') {
        updateTrayIcon()
      } else if (key === 'contentProtectionEnabled') {
        updateContentProtectionOnAllActiveWindows(Boolean(value))
      }

      return true
    }
  )

  ipcMain.handle(
    'app.setBadgeCountAndTrayIconIndicator',
    (_, count: number) => {
      app.setBadgeCount(count)
      set_has_unread(count !== 0)
    }
  )

  ipcMain.handle('app.writeTempFileFromBase64', (_ev, name, content) =>
    writeTempFileFromBase64(name, content)
  )
  ipcMain.handle('app.writeTempFile', (_ev, name, content) =>
    writeTempFile(name, content)
  )
  ipcMain.handle('app.copyFileToInternalTmpDir', (_ev, name, pathToFile) => {
    return copyFileToInternalTmpDir(name, pathToFile)
  })
  ipcMain.handle('app.removeTempFile', (_ev, path) => removeTempFile(path))
  ipcMain.handle('app.deleteEncryptedFile', (_ev, path) =>
    deleteEncryptedFile(path)
  )
  ipcMain.handle('electron.shell.openExternal', (_ev, url) =>
    shell.openExternal(url)
  )
  ipcMain.handle('electron.shell.openPath', (_ev, path) => {
    // map sandbox path if on Windows
    return shell.openPath(mapPackagePath(path))
  })
  ipcMain.handle('electron.clipboard.readText', () => {
    return clipboard.readText()
  })
  ipcMain.handle('electron.clipboard.readImage', () => {
    const image = clipboard.readImage()

    // Electron just returns an empty base64 string (for example
    // 'data:image/png;base64,' when no image was in the clipboard),
    // we check that here and more conveniently return null instead
    if (image.isEmpty()) {
      return null
    }

    return image.toDataURL()
  })
  ipcMain.handle('electron.clipboard.writeText', (_ev, text) => {
    return clipboard.writeText(text)
  })
  ipcMain.handle('electron.clipboard.writeImage', (_ev, path) => {
    return clipboard.writeImage(nativeImage.createFromPath(path))
  })

  ipcMain.handle(
    'saveBackgroundImage',
    async (_ev, file: string, isDefaultPicture: boolean) => {
      const originalFilePath = !isDefaultPicture
        ? file
        : join(htmlDistDir(), 'images/backgrounds/', file)

      const bgDir = join(getConfigPath(), 'background')
      await rm(bgDir, { recursive: true, force: true })
      await mkdir(bgDir, { recursive: true })
      const fileName = `background_${Date.now()}` + extname(originalFilePath)
      const newPath = join(getConfigPath(), 'background', fileName)
      try {
        await copyFile(originalFilePath, newPath)
      } catch (error) {
        log.error('BG-IMG Copy Failed', error)
        throw error
      }
      return `img: ${fileName.replace(/\\/g, '/')}`
    }
  )

  ipcMain.handle(
    'openMessageHTML',
    async (
      _ev,
      accountId: number,
      messageId: number,
      isContactRequest: boolean,
      subject: string,
      sender: string,
      receiveTime: string,
      content: string
    ) => {
      openHtmlEmailWindow(
        accountId,
        messageId,
        isContactRequest,
        subject,
        sender,
        receiveTime,
        content
      )
    }
  )

  return () => {
    // the shutdown function
    dcController.jsonrpcRemote.rpc.stopIoForAllAccounts()

    // Stop privitty server process
    try {
      dcController._inner_privitty_account_manager?.stop()
    } catch (error) {
      log.error('Error stopping privitty server:', error)
    }
  }
}

export async function writeTempFileFromBase64(
  name: string,
  content: string
): Promise<string> {
  await mkdir(getDraftTempDir(), { recursive: true })
  const pathToFile = join(getDraftTempDir(), basename(name))
  log.debug(`Writing base64 encoded file ${pathToFile}`)
  await writeFile(pathToFile, Buffer.from(content, 'base64'), 'binary')
  return pathToFile
}

/**
 * this function is only needed to temporarily
 * save a VCard to attach it to a draft message
 * should be removed once composer uses draft
 * message id and set_draft_vcard can be used
 * see https://github.com/deltachat/deltachat-core-rust/pull/5677
 */
export async function writeTempFile(
  name: string,
  content: string
): Promise<string> {
  await mkdir(getDraftTempDir(), { recursive: true })
  const pathToFile = join(getDraftTempDir(), basename(name))
  log.debug(`Writing tmp file ${pathToFile}`)
  await writeFile(pathToFile, Buffer.from(content, 'utf8'), 'binary')
  return pathToFile
}

export async function copyFileToInternalTmpDir(
  fileName: string,
  sourcePath: string
): Promise<string> {
  const sourceFileName = basename(sourcePath)
  const sourceDir = dirname(sourcePath)
  // make sure fileName includes only a file name, no path or whatever
  fileName = basename(normalize(fileName))
  let destinationDir = join(sourceDir, '..', INTERNAL_TMP_DIR_NAME)
  if (sourceFileName !== fileName) {
    // this is the case, when we copy a file that has an identifier
    //  as name (given during the file deduplications process)
    destinationDir = join(destinationDir, sourceFileName)
  }
  await mkdir(destinationDir, { recursive: true })
  const targetPath = join(destinationDir, fileName)
  await copyFile(sourcePath, targetPath)
  return targetPath
}

async function removeTempFile(path: string) {
  if (
    path.indexOf(rawApp.getPath('temp')) === -1 ||
    path.indexOf('..') !== -1
  ) {
    log.error(
      'removeTempFile was called with a path that is outside of the temp dir: ',
      path
    )
    throw new Error('Path is outside of the temp folder')
  }
  await rm(path)
}
/**
 * Safely deletes an encrypted .prv file from the user's folder (outside temp).
 * Used after a message with an encrypted attachment is successfully sent.
 * Validates path to prevent accidental deletion of arbitrary user files.
 */
async function deleteEncryptedFile(filePath: string): Promise<void> {
  if (!filePath || typeof filePath !== 'string') {
    log.error('deleteEncryptedFile: invalid or empty path')
    throw new Error('Invalid file path')
  }

  // Must end with .prv (case-insensitive for cross-platform)
  const normalizedPath = filePath.replace(/\\/g, '/')
  if (!normalizedPath.toLowerCase().endsWith('.prv')) {
    log.error('deleteEncryptedFile: path does not end with .prv', filePath)
    throw new Error('Only .prv encrypted files can be deleted')
  }

  // Reject paths with traversal attempts
  if (filePath.includes('..')) {
    log.error('deleteEncryptedFile: path contains ..', filePath)
    throw new Error('Invalid path: traversal not allowed')
  }

  try {
    const resolvedPath = path.resolve(filePath)
    const stat = await fs.stat(resolvedPath)

    if (!stat.isFile()) {
      log.error('deleteEncryptedFile: path is not a file', resolvedPath)
      throw new Error('Path is not a file')
    }

    await fs.unlink(resolvedPath)
    log.debug('deleteEncryptedFile: deleted', resolvedPath)
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      log.debug('deleteEncryptedFile: file already gone', filePath)
      return // Idempotent: treat missing file as success
    }
    log.error('deleteEncryptedFile: failed', filePath, err)
    throw err
  }
}