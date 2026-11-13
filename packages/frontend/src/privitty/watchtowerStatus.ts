import { runtime } from '@deltachat-desktop/runtime-interface'
import { BackendRemote } from '../backend-com'

export type WatchtowerStatus = Record<string, unknown> & {
  status?: string
  reason?: string
}

// The pinned @privitty/jsonrpc-client has no generated privittyWt* methods.
export async function getWatchtowerStatus(
  accountId: number
): Promise<WatchtowerStatus> {
  const wrapping = await runtime.getWatchtowerWrappingKey().catch(() => null)
  const raw = await BackendRemote.transport.request('privitty_wt_status', [
    accountId,
    wrapping,
  ])
  return (
    typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})
  ) as WatchtowerStatus
}
