import { useEffect, useState } from 'react'

import { onDCEvent } from '../backend-com'
import { selectedAccountId } from '../ScreenController'
import { getWatchtowerStatus } from '../privitty/watchtowerStatus'
import { getLogger } from '@deltachat-desktop/shared/logger'

const log = getLogger('renderer/useFileSharingEnabled')

export const FILE_SHARING_BLOCKED_TEXT =
  'File sharing resumes once Watchtower restores access for this device.'

export type FileSharingAccess = {
  enabled: boolean
  reason: string | null
}

const ENABLED: FileSharingAccess = { enabled: true, reason: null }

export default function useFileSharingEnabled(): FileSharingAccess {
  const accountId = selectedAccountId()
  const [access, setAccess] = useState<FileSharingAccess>(ENABLED)

  useEffect(() => {
    let cancelled = false
    const apply = (status?: string, reason?: string) => {
      if (cancelled) return
      setAccess(
        status === 'blocked'
          ? { enabled: false, reason: reason ?? null }
          : ENABLED
      )
    }
    const refresh = () => {
      getWatchtowerStatus(accountId)
        .then(result => apply(result.status, result.reason))
        .catch(error => log.debug('privitty_wt_status failed', error))
    }

    refresh()
    const off = (onDCEvent as any)(
      accountId,
      'PrivittyWatchtowerStatusChanged',
      (event: { status?: string }) => {
        apply(event.status)
        refresh()
      }
    )
    return () => {
      cancelled = true
      off()
    }
  }, [accountId])

  return access
}
