import React, { createContext, useContext, useEffect } from 'react'
import { runtime } from '@deltachat-desktop/runtime-interface'
import { BackendRemote, onDCEvent } from '../backend-com'
import { privittyStore } from '../privitty/privittyStore'
import useDialog from '../hooks/dialog/useDialog'
import PrivittyLicenseDialog from '../components/dialogs/PrivittyLicenseDialog'
import {
  PRIVITTY_STATUS_ACTIVE,
  PRIVITTY_STATUS_BYPASS,
  PRIVITTY_STATUS_NOT_INITIALIZED,
} from '../utils/privittyLicense'

/**
 * PrivittyChatContext — orchestrates detection and populates privittyStore.
 *
 * The store is the single source of truth for which chats are Privitty-protected.
 * This context is responsible only for DETECTION (running the scan, subscribing
 * to events). The DISPLAY is handled directly by each Message component via
 * store.subscribe(), which guarantees re-renders regardless of any React.memo
 * or areEqual memoization in ancestor components (react-window, etc.).
 */

interface PrivittyChatContextValue {
  /** Mark a chat as Privitty-protected (also persists to localStorage). */
  markChatAsPrivitty: (chatId: number) => void
}

const PrivittyChatContext = createContext<PrivittyChatContextValue>({
  markChatAsPrivitty: () => {},
})

export function PrivittyChatProvider({
  accountId,
  children,
}: {
  accountId: number | undefined
  children: React.ReactNode
}) {
  // Tell the store which account is active so it can load its cache.
  if (accountId != null) {
    privittyStore.setActiveAccount(accountId)
  }

  const { openDialog } = useDialog()

  const markChatAsPrivitty = (chatId: number) => {
    if (accountId != null) {
      privittyStore.markPrivitty(accountId, chatId)
    }
  }

  /**
   * Check whether a chat has an active Privitty secure connection using
   * the JSONRPC `privittyIsChatEncrypted` method (unified stdio-rpc-server).
   */
  const checkChat = async (
    chatId: number,
    _lastMessageId: number | null | undefined
  ) => {
    if (accountId == null) return
    if (privittyStore.isPrivitty(accountId, chatId)) return
    try {
      const isEncrypted = await (BackendRemote.rpc as any).privittyIsChatEncrypted(
        accountId,
        chatId
      )
      if (isEncrypted === true) {
        privittyStore.markPrivitty(accountId, chatId)
      }
    } catch {
      // server not yet ready — will be retried via events
    }
  }

  const scanAllChats = async () => {
    if (accountId == null) return
    try {
      const chatIds = await BackendRemote.rpc.getChatlistEntries(
        accountId,
        null,
        null,
        null
      )
      const items = await BackendRemote.rpc.getChatlistItemsByEntries(
        accountId,
        chatIds
      )
      await Promise.allSettled(
        Object.entries(items)
          .filter(([, item]) => item?.kind === 'ChatListItem')
          .map(([chatIdStr, item]) => {
            if (item?.kind !== 'ChatListItem') return Promise.resolve()
            return checkChat(Number(chatIdStr), item.lastMessageId)
          })
      )
    } catch {
      // unexpected error — event streams keep the store updated
    }
  }

  // Primary trigger: privittyServerReady fires from openPrivittyVault after
  // ImapConnected, guaranteeing the server's user DB is fully set up before
  // the scan runs.  30 s fallback prevents the scan from never running if the
  // event is missed.
  useEffect(() => {
    let cancelled = false
    const fallbackTimer = window.setTimeout(() => {
      if (!cancelled) {
        privittyStore.setServerReady()
        scanAllChats()
      }
    }, 30_000)

    const unsubscribe = runtime.onPrivittyServerReady(async () => {
      if (cancelled) return
      window.clearTimeout(fallbackTimer)
      // Signal all waiting components (e.g. file status fetches in Message.tsx)
      // that the server is ready before we run the scan.
      privittyStore.setServerReady()
      await scanAllChats()
    })

    return () => {
      cancelled = true
      window.clearTimeout(fallbackTimer)
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  // Re-check the specific chat whenever its last message changes.
  useEffect(() => {
    if (accountId == null) return
    return onDCEvent(accountId, 'ChatlistItemChanged', async ({ chatId }) => {
      if (!chatId || privittyStore.isPrivitty(accountId, chatId)) return
      try {
        const items = await BackendRemote.rpc.getChatlistItemsByEntries(
          accountId,
          [chatId]
        )
        const item = items[chatId]
        if (item?.kind === 'ChatListItem') {
          await checkChat(chatId, item.lastMessageId)
        }
      } catch {
        // ignore
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  // Real-time: main process fires this the instant it validates an incoming PDU.
  useEffect(() => {
    return runtime.onPrivittyMessageDetected(chatId => {
      if (accountId != null) {
        privittyStore.markPrivitty(accountId, chatId)
      }
    })
  }, [accountId])

  // Core event: peer handshake completed → mark the chat as Privitty-protected.
  useEffect(() => {
    if (accountId == null) return
    return onDCEvent(accountId, 'PrivittyPeerHandshakeComplete', ({ chatId }) => {
      privittyStore.markPrivitty(accountId, chatId)
    })
  }, [accountId])

  // Core event: chat encryption state changed (e.g. after key rotation).
  useEffect(() => {
    if (accountId == null) return
    return onDCEvent(
      accountId,
      'PrivittyChatEncryptionChanged',
      ({ chatId, isEncrypted }) => {
        if (isEncrypted) {
          privittyStore.markPrivitty(accountId, chatId)
        }
      }
    )
  }, [accountId])

  // Periodic sweep — mirrors Android's 30 s timer in ConversationFragment.
  // Marks expired file keys in the Privitty DB so the UI can show correct
  // "expired" badges without waiting for a server-push event.
  useEffect(() => {
    if (accountId == null) return
    const sweep = () => {
      ;(BackendRemote.rpc as any)
        .privittyCheckAndMarkExpiredKeys(accountId)
        .catch((e: unknown) =>
          console.error('privittyCheckAndMarkExpiredKeys failed', e)
        )
    }
    sweep() // run immediately on mount / account switch
    const interval = window.setInterval(sweep, 30_000)
    return () => window.clearInterval(interval)
  }, [accountId])

  // Forwardee forward-access requests: refresh the owner's message bell badge
  // (red dot) — do not auto-open a grant dialog; owner grants via access control.
  useEffect(() => {
    if (accountId == null) return
    return onDCEvent(
      accountId,
      'PrivittyForwardAccessRequested',
      ({ chatId: eventChatId }) => {
        privittyStore.notifyFileAccessChanged({ chatId: eventChatId })
      }
    )
  }, [accountId])

  // License status: show PrivittyLicenseDialog when the license needs
  // attention (not activated, expired, clock tampered, etc.).
  // The license manager is a global singleton — we show the dialog regardless
  // of which account triggered the event.
  useEffect(() => {
    return runtime.onPrivittyLicenseStatus((_eventAccountId, statusCode) => {
      // Ignore status codes that require no user action.
      if (
        statusCode === PRIVITTY_STATUS_ACTIVE ||
        statusCode === PRIVITTY_STATUS_BYPASS ||
        statusCode === PRIVITTY_STATUS_NOT_INITIALIZED
      ) {
        return
      }
      openDialog(PrivittyLicenseDialog, {
        initialStatusCode: statusCode,
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  return (
    <PrivittyChatContext.Provider value={{ markChatAsPrivitty }}>
      {children}
    </PrivittyChatContext.Provider>
  )
}

export const usePrivittyChatContext = () => useContext(PrivittyChatContext)
