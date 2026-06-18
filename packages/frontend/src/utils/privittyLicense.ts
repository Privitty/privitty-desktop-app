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
 * Actual method signatures (from @privitty/jsonrpc-client 2.48.3):
 *   privittyLicenseInit(dataDir, licensePath, serverUrl)
 *   privittyLicenseActivate()
 *   privittyLicenseDeactivate()
 *   privittyLicenseCheckFeature(featureId)
 *   privittyLicenseGetStatus()
 *   privittyLicenseGetInfo()
 *   privittyLicenseSync()
 */

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

// ---------------------------------------------------------------------------
// TypeScript interfaces for license API return types.
// ---------------------------------------------------------------------------

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
  await (BackendRemote.rpc as any).privittyLicenseInit(
    dataDir,
    licensePath,
    serverUrl
  )
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
  // The Rust method returns a JSON string; parse it here so callers always
  // receive a typed object.
  if (typeof raw === 'string') {
    return JSON.parse(raw) as PrivittyLicenseInfo
  }
  return raw as PrivittyLicenseInfo
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
