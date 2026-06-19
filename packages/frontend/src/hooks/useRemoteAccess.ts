import { useCallback, useEffect, useRef, useState } from 'react'
import { BackendRemote, onDCEvent } from '../backend-com'
import { selectedAccountId } from '../ScreenController'

// ---------------------------------------------------------------------------
// Types (mirror the Rust JSON-RPC types)
// ---------------------------------------------------------------------------

export interface PeerCapabilities {
  peerType: string
  remoteAccess: boolean
  shimVersion: number
  protocols: string[]
}

export interface PeerCapabilitiesResponse {
  localPeerType: string
  remotePeerType: string | null
  remoteAccessAvailable: boolean
  remoteAccessState: 'none' | 'unavailable' | 'available' | 'active'
  capabilities: PeerCapabilities | null
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseRemoteAccessResult {
  /** True when the edge peer has remote-access capabilities and chat is encrypted. */
  remoteAccessAvailable: boolean
  /** True when a tunnel session is currently active. */
  tunnelActive: boolean
  /** Refresh remote-access state from core. */
  refresh: () => Promise<void>
}

/**
 * Queries and tracks Privitty remote-access availability for a single 1:1 chat.
 *
 * Automatically re-queries on:
 *  - `PrivittyPeerCapabilitiesReceived` — edge just published its capabilities
 *  - `PrivittyTunnelActive`            — tunnel established
 *  - `PrivittyTunnelClosed`            — tunnel ended normally
 *  - `PrivittyTunnelError`             — tunnel ended with error
 */
export function useRemoteAccess(chatId: number | null): UseRemoteAccessResult {
  const [remoteAccessAvailable, setRemoteAccessAvailable] = useState(false)
  const [tunnelActive, setTunnelActive] = useState(false)
  const mountedRef = useRef(true)

  const rpc = BackendRemote.rpc as any

  const refresh = useCallback(async () => {
    if (!chatId) {
      setRemoteAccessAvailable(false)
      setTunnelActive(false)
      return
    }

    const accountId = selectedAccountId()
    try {
      const caps: PeerCapabilitiesResponse = await rpc.privittyGetPeerCapabilities(
        accountId,
        chatId
      )
      if (!mountedRef.current) return

      const available = caps?.remoteAccessAvailable ?? false
      setRemoteAccessAvailable(available)

      // Check live tunnel status
      if (available) {
        try {
          const status = await rpc.privittyGetTunnelStatus(accountId, chatId)
          if (!mountedRef.current) return
          const active =
            status?.readyForClient ||
            status?.bridgeRunning ||
            status?.tunnelState?.toLowerCase() === 'active'
          setTunnelActive(!!active)
        } catch {
          if (mountedRef.current) setTunnelActive(false)
        }
      } else {
        setTunnelActive(false)
      }
    } catch {
      if (mountedRef.current) {
        setRemoteAccessAvailable(false)
        setTunnelActive(false)
      }
    }
  }, [chatId, rpc])

  // Initial load + refresh on chatId change
  useEffect(() => {
    mountedRef.current = true
    refresh()
    return () => {
      mountedRef.current = false
    }
  }, [refresh])

  // Event listeners
  useEffect(() => {
    if (!chatId) return
    const accountId = selectedAccountId()

    const unsubs = [
      onDCEvent(accountId, 'PrivittyPeerCapabilitiesReceived' as any, (ev: any) => {
        if (ev.chatId === chatId) refresh()
      }),
      onDCEvent(accountId, 'PrivittyTunnelActive' as any, (ev: any) => {
        if (ev.chatId === chatId) {
          setTunnelActive(true)
        }
      }),
      onDCEvent(accountId, 'PrivittyTunnelClosed' as any, (ev: any) => {
        if (ev.chatId === chatId) {
          setTunnelActive(false)
          refresh()
        }
      }),
      onDCEvent(accountId, 'PrivittyTunnelError' as any, (ev: any) => {
        if (ev.chatId === chatId) {
          setTunnelActive(false)
        }
      }),
    ]

    return () => unsubs.forEach(fn => fn())
  }, [chatId, refresh])

  return { remoteAccessAvailable, tunnelActive, refresh }
}
