import { useCallback, useEffect, useRef, useState } from 'react'

import { runtime } from '@deltachat-desktop/runtime-interface'
import {
  ensureLicenseInitialized,
  licenseGetInfo,
} from '../utils/privittyLicense'
import { getLogger } from '@deltachat-desktop/shared/logger'

const log = getLogger('renderer/useFileSharingEnabled')

export type FileSharingDisableReason = 'expired' | 'disabled' | 'unavailable'

export type FileSharingAccess = {
  enabled: boolean
  reason: FileSharingDisableReason | null
  expiresAt: number | null
}

const INITIAL_ACCESS: FileSharingAccess = {
  enabled: false,
  reason: 'unavailable',
  expiresAt: null,
}

export default function useFileSharingEnabled(): FileSharingAccess {
  const [access, setAccess] = useState<FileSharingAccess>(INITIAL_ACCESS)
  const expiryTimer = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      await ensureLicenseInitialized()

      const { expiresAt } = await licenseGetInfo()
      const now = Math.floor(Date.now() / 1000)

      if (expiresAt == null || !Number.isFinite(expiresAt)) {
        setAccess(INITIAL_ACCESS)
        return
      }

      const expired = expiresAt <= now

      setAccess({
        enabled: !expired,
        reason: expired ? 'expired' : null,
        expiresAt,
      })
    } catch (error) {
      log.debug('[useFileSharingEnabled] Failed to get license info', error)
      setAccess(INITIAL_ACCESS)
    }
  }, [])

  useEffect(() => {
    void refresh()

    return runtime.onPrivittyLicenseStatus(() => {
      void refresh()
    })
  }, [refresh])

  useEffect(() => {
    if (!access.enabled || access.expiresAt == null) {
      return
    }

    const delay = access.expiresAt * 1000 - Date.now()

    if (delay <= 0) {
      setAccess(prev => ({
        ...prev,
        enabled: false,
        reason: 'expired',
      }))
      return
    }

    expiryTimer.current = window.setTimeout(() => {
      setAccess(prev => ({
        ...prev,
        enabled: false,
        reason: 'expired',
      }))
    }, delay)

    return () => {
      if (expiryTimer.current !== null) {
        window.clearTimeout(expiryTimer.current)
        expiryTimer.current = null
      }
    }
  }, [access.enabled, access.expiresAt])

  return access
}
