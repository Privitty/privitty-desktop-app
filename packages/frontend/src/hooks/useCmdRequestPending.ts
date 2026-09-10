/**
 * useCmdRequestPending — tracks whether an outbound `cmd_request` message is
 * still waiting for a matching `cmd_response` from the edge.
 *
 * Strategy (stateless / spec §8.3):
 *   - Scan the chat message list for a `cmd_response` whose `req_id` matches
 *     this message's `req_id`.  If none exists the message is "pending".
 *   - Re-evaluates on every `PrivittyDeviceCmdResponse` event so the bubble
 *     updates as soon as the edge replies.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { BackendRemote, onDCEvent } from '../backend-com'
import { selectedAccountId } from '../ScreenController'

export interface CmdRequestPendingResult {
  /** True while no matching cmd_response has been received yet. */
  isPending: boolean
  /**
   * When isPending is true and the contact's last-seen time is >1 h ago,
   * this holds a human-readable string like "2h ago".  Otherwise null.
   */
  lastSeenHint: string | null
}

/** Extract req_id from a raw cmd_request / cmd_response JSON text. */
function extractReqId(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.match(/"req_id"\s*:\s*"([^"]+)"/)
  return m ? m[1] : null
}

/** Return true if text looks like a cmd_response JSON payload. */
function isCmdResponseText(text: string | null | undefined): boolean {
  return !!text && text.includes('"__pvt"') && text.includes('cmd_response')
}

/** Return true if text looks like a cmd_request JSON payload. */
export function isCmdRequestText(text: string | null | undefined): boolean {
  return !!text && text.includes('"__pvt"') && text.includes('cmd_request')
}

/** Format a last-seen timestamp (seconds since epoch) into a human-readable hint. */
function formatLastSeen(lastSeenSecs: number): string | null {
  if (!lastSeenSecs) return null
  const deltaSecs = Math.floor(Date.now() / 1000) - lastSeenSecs
  if (deltaSecs < 3600) return null // < 1 h → don't show hint
  const hours = Math.floor(deltaSecs / 3600)
  const days = Math.floor(hours / 24)
  if (days >= 1) return `${days}d ago`
  return `${hours}h ago`
}

export function useCmdRequestPending(
  _messageId: number,
  chatId: number,
  messageText: string | null | undefined,
  /** DC ContactId of the peer (edge). Pass 0 to skip last-seen check. */
  peerId: number
): CmdRequestPendingResult {
  const [isPending, setIsPending] = useState(false)
  const [lastSeenHint, setLastSeenHint] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const reqId = extractReqId(messageText)

  const check = useCallback(async () => {
    if (!reqId || !chatId) {
      setIsPending(false)
      setLastSeenHint(null)
      return
    }

    const accountId = selectedAccountId()
    const rpc = BackendRemote.rpc

    try {
      // Fetch all message IDs in this chat
      const listItems = await rpc.getMessageListItems(
        accountId,
        chatId,
        false,
        true
      )
      const msgIds = listItems
        .filter((item: any) => item.kind === 'message')
        .map((item: any) => item.msg_id as number)

      // Fetch full message objects
      const messagesMap = await rpc.getMessages(accountId, msgIds)
      const messages = Object.values(messagesMap) as any[]

      // Look for a cmd_response that matches our req_id
      const resolved = messages.some(
        m => isCmdResponseText(m.text) && extractReqId(m.text) === reqId
      )

      if (!mountedRef.current) return

      setIsPending(!resolved)

      // If still pending, check edge last-seen for the offline hint
      if (!resolved && peerId > 0) {
        try {
          const contact = await rpc.getContact(accountId, peerId)
          const hint = formatLastSeen(contact?.lastSeen ?? 0)
          if (mountedRef.current) setLastSeenHint(hint)
        } catch {
          if (mountedRef.current) setLastSeenHint(null)
        }
      } else {
        if (mountedRef.current) setLastSeenHint(null)
      }
    } catch {
      if (mountedRef.current) {
        setIsPending(false)
        setLastSeenHint(null)
      }
    }
  }, [reqId, chatId, peerId])

  // Initial check
  useEffect(() => {
    mountedRef.current = true
    check()
    return () => {
      mountedRef.current = false
    }
  }, [check])

  // Re-check when any cmd_response arrives in this chat
  useEffect(() => {
    if (!chatId || !reqId) return
    const accountId = selectedAccountId()
    const unsub = onDCEvent(
      accountId,
      'PrivittyDeviceCmdResponse' as any,
      (ev: any) => {
        if (ev.chatId === chatId) check()
      }
    )
    return () => unsub()
  }, [chatId, reqId, check])

  // Also re-check on any generic MsgsChanged (catches responses delivered while offline)
  useEffect(() => {
    if (!chatId || !reqId) return
    const accountId = selectedAccountId()
    const unsub = onDCEvent(accountId, 'MsgsChanged', (ev: any) => {
      if (ev.chatId === chatId) check()
    })
    return () => unsub()
  }, [chatId, reqId, check])

  return { isPending, lastSeenHint }
}
