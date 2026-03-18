import { join, dirname } from 'path'
import { createRequire } from 'module'
import { getLogger } from '@deltachat-desktop/shared/logger'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { getLogsPath } from '../application-constants'
import { arch, platform } from 'os'
import { app, dialog } from 'electron/main'
import { existsSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'

const _require = createRequire(import.meta.url)
const privittyCoreVersion: string = (() => {
  try {
    return _require('@privitty/privitty-core/package.json').version
  } catch {
    return 'unknown'
  }
})()

const log = getLogger('Privitty')

export class PrivittyClient {
  private _cmd_path: string
  serverProcess: ChildProcessWithoutNullStreams | null
  private pendingRequests: Map<number | undefined, (response: any) => void>

  constructor(
    public on_data: (response: string) => void,
    public accounts_path: string
  ) {
    this.serverProcess = null
    this.pendingRequests = new Map()
    this._cmd_path = this.computeCmdPath()
  }

  private computeCmdPath(): string {
    try {
      const binaryPath = this.findPrivittyBinaryInPnpm()
      log.info('Found privitty-server binary at:', binaryPath)
      return binaryPath
    } catch (error) {
      log.error('Failed to locate privitty-server binary:', error)

      const binName =
        process.platform === 'win32' ? 'privitty-server.exe' : 'privitty-server'

      if (app.isPackaged) {
        const fallbackPath = join(
          process.resourcesPath,
          'privitty',
          'dll',
          binName
        )
        log.warn('Using packaged-app fallback path:', fallbackPath)
        return fallbackPath
      }

      const devPath = join(app.getAppPath(), 'privitty/dll', binName)
      log.warn('Using development fallback path:', devPath)
      return devPath
    }
  }

  private findPrivittyBinaryInPnpm(): string {
    const platformName = platform()
    const archName = arch()

    let packageName: string
    let binaryName: string

    if (platformName === 'darwin') {
      if (archName === 'arm64' || archName === 'x64') {
        packageName = `@privitty/privitty-core-darwin-${archName}`
        binaryName = 'privitty-server'
      } else {
        throw new Error(`Unsupported macOS architecture: ${archName}`)
      }
    } else if (platformName === 'linux') {
      if (archName === 'x64') {
        packageName = '@privitty/privitty-core-linux-x64'
        binaryName = 'privitty-server'
      } else {
        throw new Error(`Unsupported Linux architecture: ${archName}`)
      }
    } else if (platformName === 'win32') {
      if (archName === 'x64') {
        packageName = '@privitty/privitty-core-win32-x64'
        binaryName = 'privitty-server.exe'
      } else {
        throw new Error(`Unsupported Windows architecture: ${archName}`)
      }
    } else {
      throw new Error(`Unsupported platform: ${platformName}`)
    }

    if (app.isPackaged) {
      // In packaged apps binaries live in app.asar.unpacked/node_modules/.
      // CI universal macOS builds replace arch-specific packages with a single
      // fat binary (@privitty/privitty-core-darwin-universal) created by lipo.
      // Try the arch-specific package first, then fall back to universal.
      const candidates: string[] = [packageName]
      if (platformName === 'darwin') {
        candidates.push('@privitty/privitty-core-darwin-universal')
      }

      for (const pkg of candidates) {
        const unpackedPath = join(
          process.resourcesPath,
          'app.asar.unpacked',
          'node_modules',
          pkg,
          binaryName
        )
        if (existsSync(unpackedPath)) {
          log.info('Found privitty-server at:', unpackedPath)
          return unpackedPath
        }
        log.debug('privitty-server not found at:', unpackedPath)
      }

      throw new Error(
        `privitty-server not found in app.asar.unpacked. Tried: ${candidates.join(', ')}`
      )
    }

    // Development: search pnpm virtual store
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const pnpmStorePaths = [
      join(__dirname, '../../../node_modules/.pnpm'),
      join(__dirname, '../../../../node_modules/.pnpm'),
      join(__dirname, '../../../../../node_modules/.pnpm'),
    ]

    for (const pnpmStore of pnpmStorePaths) {
      if (!existsSync(pnpmStore)) continue
      try {
        const entries = readdirSync(pnpmStore)
        const entry = entries.find(e =>
          e.startsWith(packageName.replace('@', '@').replace('/', '+'))
        )
        if (entry) {
          const binaryPath = join(
            pnpmStore,
            entry,
            'node_modules',
            packageName,
            binaryName
          )
          if (existsSync(binaryPath)) {
            return binaryPath
          }
        }
      } catch {
        // try next path
      }
    }

    throw new Error(
      `privitty-server binary not found for ${packageName} ` +
        `(platform: ${platformName}, arch: ${archName})`
    )
  }

  start() {
    log.info(`Privitty Core version: ${privittyCoreVersion}`)
    log.info('Starting privitty-server', {
      binary: this._cmd_path,
      accountsPath: this.accounts_path,
    })

    this.serverProcess = spawn(this._cmd_path, {
      cwd: this.accounts_path,
      env: {
        RUST_LOG: process.env.RUST_LOG,
        PRIVITTY_ACCOUNTS_PATH: this.accounts_path,
      },
    })

    this.serverProcess.on('error', err => {
      if (err.message.endsWith('ENOENT')) {
        dialog.showErrorBox(
          'Fatal Error: Privitty Module Missing',
          `The Privitty module is missing. It may have been quarantined by your antivirus software.\n\n` +
            `Expected location: "${this._cmd_path}"\n` +
            `Log files: ${getLogsPath()}\n\n` +
            `Error: ${err.message}`
        )
      } else {
        dialog.showErrorBox(
          'Fatal Error',
          `A fatal error occurred in the Privitty module. Please contact support.\n\n` +
            `${err.name}: ${err.message}\n\n` +
            `Log files: ${getLogsPath()}`
        )
      }
      app.exit(1)
    })

    let stdoutBuffer = ''
    this.serverProcess.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString()
      while (stdoutBuffer.includes('\n')) {
        const n = stdoutBuffer.indexOf('\n')
        const line = stdoutBuffer.substring(0, n).trim()
        stdoutBuffer = stdoutBuffer.substring(n + 1)
        if (!line.startsWith('{')) continue
        try {
          this.on_data(line)
        } catch (e) {
          log.error('Error processing privitty-server output:', e)
        }
      }
    })

    let stderrLog = ''
    const STDERR_LOG_LIMIT = 800
    this.serverProcess.stderr.on('data', (data: Buffer) => {
      log.error('privitty-server stderr:', data.toString().trimEnd())
      stderrLog = (stderrLog + data.toString()).slice(-STDERR_LOG_LIMIT)
    })

    this.serverProcess.on('close', (code, signal) => {
      if (code !== null) {
        log.info('privitty-server closed with exit code', code)
      } else {
        log.info('privitty-server closed with signal', signal)
      }
    })

    this.serverProcess.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        log.critical('privitty-server exited unexpectedly with code', code)
        dialog.showErrorBox(
          'Fatal Error',
          `[Privitty | ${platform()} | ${arch()}]\n` +
            `The Privitty server exited unexpectedly (exit code ${code}).\n\n` +
            stderrLog
        )
        app.exit(1)
      } else if (signal !== null) {
        log.warn('privitty-server terminated with signal', signal)
      }
    })
  }

  send(message: string) {
    this.serverProcess?.stdin.write(message + '\n')
  }

  sendJsonRpcRequest(
    method: string,
    params: any = {},
    requestId?: number
  ): Promise<any> {
    const request = {
      jsonrpc: '2.0',
      method,
      params,
      id: requestId,
    }
    return new Promise(resolve => {
      this.pendingRequests.set(requestId, resolve)
      this.serverProcess?.stdin.write(JSON.stringify(request) + '\n')
    })
  }

  /** Whether the privitty-server child process is currently running. */
  get isRunning(): boolean {
    return this.serverProcess !== null
  }

  /**
   * Start (or restart) privitty-server scoped to the given per-account directory.
   *
   * Mirrors Android: accountDir = parent of getBlobdir() = accounts/<UUID>/.
   * This ensures .privitty/ is created inside the individual account directory
   * (accounts/<UUID>/.privitty/) rather than the shared accounts root.
   *
   * - If the server is already running with the same path → no-op.
   * - If the server is already running with a different path (account switch)
   *   → stops the old instance then starts a new one.
   */
  startWithPath(accountDir: string) {
    if (this.isRunning) {
      if (this.accounts_path === accountDir) {
        log.debug('privitty-server already running with correct account path')
        return
      }
      log.info('Account path changed — restarting privitty-server', {
        from: this.accounts_path,
        to: accountDir,
      })
      this.stop()
    }
    this.accounts_path = accountDir
    this.start()
  }

  /**
   * Stop the privitty-server process.
   * Called on app shutdown or before a path-change restart.
   */
  stop() {
    if (this.serverProcess) {
      log.info('Stopping privitty-server')
      try {
        this.serverProcess.kill()
        this.serverProcess = null
      } catch (error) {
        log.error('Error stopping privitty-server:', error)
      }
    }
  }
}
