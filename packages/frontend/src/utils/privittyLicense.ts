/**
 * Privitty License — JSONRPC wrappers
 *
 * The license manager is a global singleton inside the stdio-rpc-server process.
 * NONE of the license methods take an accountId; they operate on the single
 * shared license state initialized by licenseInit().
 *
 * Mirrors the Android FFI surface in `deltachat-ffi/src/license_ffi.rs` and
 * the JSONRPC methods added to `deltachat-jsonrpc/src/api.rs`.
 *
 * Actual method signatures (from @privitty/jsonrpc-client 2.48.4):
 *   privittyLicenseInit(dataDir, licensePath, serverUrl)
 *   privittyLicenseActivate()
 *   privittyLicenseDeactivate()
 *   privittyLicenseCheckFeature(featureId)
 *   privittyLicenseGetStatus()
 *   privittyLicenseGetInfo()
 *   privittyLicenseSync()
 */

import { join } from 'path'

import { runtime } from '@deltachat-desktop/runtime-interface'
import { BackendRemote } from '../backend-com'

// ---------------------------------------------------------------------------
// Feature-flag constants — mirror Rust `FeatureFlag` enum.
// ---------------------------------------------------------------------------
export const PRIVITTY_FEATURE_FILE_SHARING = 1

// ---------------------------------------------------------------------------
// Status constants — mirror Rust `LicenseStatus::as_ffi_code()`.
// ---------------------------------------------------------------------------
export const PRIVITTY_STATUS_ACTIVE = 0
export const PRIVITTY_STATUS_GRACE_PERIOD = 1
export const PRIVITTY_STATUS_EXPIRED = 2
export const PRIVITTY_STATUS_NOT_ACTIVATED = 3
export const PRIVITTY_STATUS_CLOCK_TAMPERED = 4
export const PRIVITTY_STATUS_NOT_INITIALIZED = 5
export const PRIVITTY_STATUS_BYPASS = 99

export const PLM_SERVER_URL = 'https://plm.privittytech.com'

/** In-flight / completed `licenseInit()` — not a license snapshot cache. */
let licenseInitPromise: Promise<void> | null = null

// ---------------------------------------------------------------------------
// TypeScript interfaces for license API return types.
// ---------------------------------------------------------------------------

/** JWT / `features_json` feature flags. */
export type PrivittyLicenseFeatures = {
  file_sharing?: boolean
}

/** Detailed license information returned by `licenseGetInfo`. */
export interface PrivittyLicenseInfo {
  status: string
  licenseId: string
  customerId: string
  licenseType: string
  maxDevices: number
  activatedDevices: number
  expiresAt: number | null
  gracePeriodDays: number
  /** Parsed from `features` or the `features_json` string stored in `pv_license`. */
  features?: PrivittyLicenseFeatures | null
}

// ---------------------------------------------------------------------------
// Wrapper functions
// ---------------------------------------------------------------------------

/**
 * Create and initialise the global Privitty license manager.
 *
 * @param dataDir     Directory where `privitty_license.db` is stored (must be
 *                    writable). Typically `<configPath>/license`.
 * @param licensePath Path to the `.lic` JWT file; `null` to use a previously
 *                    cached JWT stored in the DB.
 * @param serverUrl   Base URL of the license server; `null` for offline-only
 *                    mode.
 *
 * Equivalent to Android FFI `privitty_license_new` + `privitty_license_init`.
 * Idempotent — calling it again replaces the current manager.
 */
export async function licenseInit(
  dataDir: string,
  licensePath: string | null,
  serverUrl: string | null
): Promise<void> {
  /* ignore-console-log */
  console.log('licenseInit started')
  await (BackendRemote.rpc as any).privittyLicenseInit(
    dataDir,
    licensePath,
    serverUrl,
    null
  )
  /* ignore-console-log */
  console.log('licenseInit completed')
}

/**
 * Register this device with the license server (requires network).
 *
 * Equivalent to Android FFI `privitty_license_activate`.
 */
export async function licenseActivate(): Promise<void> {
  await (BackendRemote.rpc as any).privittyLicenseActivate()
}

/**
 * Deactivate this device, freeing the seat on the license server.
 *
 * Best-effort — network errors are non-fatal.
 * Equivalent to Android FFI `privitty_license_deactivate`.
 */
export async function licenseDeactivate(): Promise<void> {
  await (BackendRemote.rpc as any).privittyLicenseDeactivate()
}

/**
 * Check whether a licensable feature is currently accessible.
 *
 * Resolves successfully if the feature is allowed; rejects if it is blocked.
 * Use `PRIVITTY_FEATURE_*` constants for `featureId`.
 *
 * Equivalent to Android FFI `privitty_license_check_feature`.
 */
export async function licenseCheckFeature(featureId: number): Promise<void> {
  await (BackendRemote.rpc as any).privittyLicenseCheckFeature(featureId)
}

/**
 * Return the current license status as an integer constant.
 *
 * Use `PRIVITTY_STATUS_*` constants to interpret the result.
 * Equivalent to Android FFI `privitty_license_get_status`.
 */
export async function licenseGetStatus(): Promise<number> {
  return (BackendRemote.rpc as any).privittyLicenseGetStatus()
}

/**
 * Return a detailed description of the current license state.
 *
 * Equivalent to Android FFI `privitty_license_get_info`.
 */
export async function licenseGetInfo(): Promise<PrivittyLicenseInfo> {
  const raw = await (BackendRemote.rpc as any).privittyLicenseGetInfo()

  let data: any = raw

  if (typeof data === 'string') {
    data = JSON.parse(data)

    if (typeof data === 'string') {
      data = JSON.parse(data)
    }
  }

  // Handle possible response wrappers.
  const info =
    data?.src ??
    data?.info ??
    data?.data ??
    data?.license ??
    data?.result ??
    data

  return {
    status: String(info?.status ?? ''),
    licenseId: String(info?.licenseId ?? info?.license_id ?? ''),
    customerId: String(info?.customerId ?? info?.customer_id ?? ''),
    licenseType: String(info?.licenseType ?? info?.license_type ?? ''),
    maxDevices: Number(info?.maxDevices ?? info?.max_devices ?? 0),
    activatedDevices: Number(
      info?.activatedDevices ?? info?.activated_devices ?? 0
    ),
    expiresAt: Number.isFinite(
      Number(info?.expiresAt ?? info?.expires_at ?? info?.exp)
    )
      ? Number(info?.expiresAt ?? info?.expires_at ?? info?.exp)
      : null,
    gracePeriodDays: Number(
      info?.gracePeriodDays ?? info?.grace_period_days ?? 0
    ),
  }
}

/**
 * True when `expires_at` is not available yet (manager still loading).
 * Status (Bypass, Active, …) is ignored — a snapshot with expires_at is ready.
 */
export function isLicenseSnapshotPending(info: PrivittyLicenseInfo): boolean {
  return typeof info.expiresAt !== 'number' || !Number.isFinite(info.expiresAt)
}

/**
 * Initialise the global license manager from `privitty_license.db` (JWT file
 * only if the DB does not exist). Deduplicates concurrent startup callers.
 */
export async function ensureLicenseInitialized(): Promise<void> {
  if (!licenseInitPromise) {
    licenseInitPromise = (async () => {
      const dataDir = join(runtime.getConfigPath(), 'license')
      const dbPath = join(dataDir, 'privitty_license.db')
      const jwtPath = join(dataDir, 'privitty.lic')

      let licensePath: string | null = null

      try {
        const hasDb = await runtime.checkFileExists(dbPath)

        if (!hasDb && (await runtime.checkFileExists(jwtPath))) {
          licensePath = jwtPath
        }
      } catch {
        // Let licenseInit load the cached database if available.
      }

      await licenseInit(dataDir, licensePath, PLM_SERVER_URL)
    })().catch(error => {
      licenseInitPromise = null
      throw error
    })
  }

  await licenseInitPromise
}

/**
 * Set (or clear) a human-readable device name forwarded to WatchTower during
 * the next {@link licenseActivate} call.  WatchTower will display this name
 * instead of the raw device ID, making it easy to identify devices in the
 * management dashboard.
 *
 * Typically pass the user's DC display name
 * (`BackendRemote.rpc.getConfig(accountId, 'displayname')`).
 * Call this **before** {@link licenseActivate}.
 * Pass `null` or an empty string to clear a previously set value.
 *
 * Equivalent to Android FFI `privitty_license_set_device_name`.
 */
export async function licenseSetDeviceName(
  deviceName: string | null
): Promise<void> {
  await (BackendRemote.rpc as any).privittyLicenseSetDeviceName(deviceName)
}

/**
 * Synchronise the license state with the server (re-validates the JWT,
 * updates the local cache, resets the grace-period counter).
 *
 * Should be called once per day or on app foreground.
 * Equivalent to Android FFI `privitty_license_sync`.
 */
export async function licenseSync(): Promise<void> {
  await (BackendRemote.rpc as any).privittyLicenseSync()
}

/**
 * Human-readable label for a status code.
 */
export function licenseStatusLabel(statusCode: number): string {
  switch (statusCode) {
    case PRIVITTY_STATUS_ACTIVE:
      return 'Active'
    case PRIVITTY_STATUS_GRACE_PERIOD:
      return 'Grace Period'
    case PRIVITTY_STATUS_EXPIRED:
      return 'Expired'
    case PRIVITTY_STATUS_NOT_ACTIVATED:
      return 'Not Activated'
    case PRIVITTY_STATUS_CLOCK_TAMPERED:
      return 'Clock Tampered'
    case PRIVITTY_STATUS_NOT_INITIALIZED:
      return 'Not Initialized'
    case PRIVITTY_STATUS_BYPASS:
      return 'Bypass (Debug)'
    default:
      return `Unknown (${statusCode})`
  }
}
