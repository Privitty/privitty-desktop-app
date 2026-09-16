import { existsSync, watch, watchFile } from 'fs'
import { join } from 'path'

import { getLogger } from '../../shared/logger.js'
import * as mainWindow from '../../frontend/src/components/windows/main.js'
import { getConfigPath } from './application-constants.js'

const log = getLogger('main/privittyLicenseEvents')
const PLM_SERVER_URL = 'https://plm.privittytech.com'

const SQLITE_SETTLE_MS = 250
const WATCH_DEBOUNCE_MS = 400

type PendingReload = {
  rpc: any
  accountId: number
  inviteLink: string | null
}

let dbWatchStarted = false
let reloadInFlight = false
let ignoreWatchUntil = 0
let pendingReload: PendingReload | null = null

export function licenseStoragePaths() {
  const licDir = join(getConfigPath(), 'license')
  const licFilePath = join(licDir, 'privitty.lic')
  const licenseDbPath = join(licDir, 'privitty_license.db')

  const licensePath =
    !existsSync(licenseDbPath) && existsSync(licFilePath) ? licFilePath : null

  return {
    licDir,
    licFilePath,
    licenseDbPath,
    licensePath,
  }
}

/**
 * Initialize the license manager from the persisted DB,
 * or from the JWT file when the DB does not exist yet.
 */
export async function initLicenseManagerFromPersistedStore(
  rpc: any,
  inviteLink: string | null = null
): Promise<void> {
  if (!rpc) {
    throw new Error('JSONRPC not ready')
  }

  const { licDir, licensePath } = licenseStoragePaths()

  log.info('Initializing Privitty license manager', {
    licDir,
    licensePath,
  })

  await rpc.privittyLicenseInit(licDir, licensePath, PLM_SERVER_URL, inviteLink)

  log.info('Privitty license manager initialized')
}

function suppressWatch(): void {
  ignoreWatchUntil = Date.now() + 2000
}

export function beginLicenseReload(): void {
  reloadInFlight = true
  suppressWatch()
}

export function endLicenseReload(): void {
  reloadInFlight = false

  if (pendingReload) {
    const reload = pendingReload
    pendingReload = null

    void reloadLicenseManagerFromDb(
      reload.rpc,
      reload.accountId,
      reload.inviteLink
    )
  }
}

export function emitPrivittyLicenseStatus(
  accountId: number,
  statusCode: number
): void {
  log.info('Privitty license status changed', {
    accountId,
    statusCode,
  })

  mainWindow.send('privittyLicenseStatus', {
    accountId,
    statusCode,
  })
}

function queueReload(
  rpc: any,
  accountId: number,
  inviteLink: string | null
): void {
  pendingReload = {
    rpc,
    accountId,
    inviteLink,
  }
}

function drainPendingReload(): void {
  if (!pendingReload) {
    return
  }

  const reload = pendingReload
  pendingReload = null

  void reloadLicenseManagerFromDb(
    reload.rpc,
    reload.accountId,
    reload.inviteLink
  )
}

/**
 * Reload the license manager from the persisted SQLite DB
 * and notify the frontend with the latest status.
 */
export async function reloadLicenseManagerFromDb(
  rpc: any,
  accountId: number,
  inviteLink: string | null = null
): Promise<number> {
  if (!rpc) {
    return 5
  }

  if (reloadInFlight) {
    queueReload(rpc, accountId, inviteLink)
    return rpc.privittyLicenseGetStatus()
  }

  reloadInFlight = true
  suppressWatch()

  try {
    // Give SQLite time to finish WAL/journal writes.
    await new Promise(resolve => setTimeout(resolve, SQLITE_SETTLE_MS))

    const licDir = join(getConfigPath(), 'license')

    await rpc.privittyLicenseInit(licDir, null, PLM_SERVER_URL, inviteLink)

    const statusCode: number = await rpc.privittyLicenseGetStatus()

    emitPrivittyLicenseStatus(accountId, statusCode)

    return statusCode
  } catch (error) {
    log.warn('Failed to reload Privitty license manager', error)

    return 5
  } finally {
    reloadInFlight = false
    drainPendingReload()
  }
}

export function watchPrivittyLicenseDb(onChange: () => void): void {
  if (dbWatchStarted) {
    return
  }

  const licDir = join(getConfigPath(), 'license')

  if (!existsSync(licDir)) {
    return
  }

  dbWatchStarted = true

  let timer: ReturnType<typeof setTimeout> | null = null

  const scheduleReload = (): void => {
    if (timer) {
      clearTimeout(timer)
    }

    timer = setTimeout(() => {
      if (Date.now() < ignoreWatchUntil) {
        return
      }

      log.info('Privitty license DB changed')

      onChange()
    }, WATCH_DEBOUNCE_MS)
  }

  watch(licDir, (_event, filename) => {
    const name = filename ? String(filename) : ''

    if (name && !name.startsWith('privitty_license')) {
      return
    }

    scheduleReload()
  })

  // SQLite may update the WAL without triggering
  // the directory watcher reliably.
  for (const name of ['privitty_license.db', 'privitty_license.db-wal']) {
    const filePath = join(licDir, name)

    watchFile(filePath, { interval: 1000 }, (current, previous) => {
      if (previous.mtimeMs === 0 && previous.size === 0) {
        return
      }

      if (
        current.mtimeMs === previous.mtimeMs &&
        current.size === previous.size
      ) {
        return
      }

      scheduleReload()
    })
  }

  log.info('Watching Privitty license DB', {
    licDir,
  })
}
