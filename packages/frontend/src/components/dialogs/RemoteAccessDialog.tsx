import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogWithHeader,
} from '../Dialog'
import type { DialogProps } from '../../contexts/DialogContext'
import { selectedAccountId } from '../../ScreenController'
import { BackendRemote, onDCEvent } from '../../backend-com'
import useTranslationFunction from '../../hooks/useTranslationFunction'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PeerCapabilities {
  peerType: string
  remoteAccess: boolean
  shimVersion: number
  protocols: string[]
  portfwdTargets?: LanReachTarget[]
}

interface LanReachTarget {
  label: string
  ip: string
  port: number
}

interface PeerCapabilitiesResponse {
  localPeerType: string
  remotePeerType: string | null
  remoteAccessAvailable: boolean
  remoteAccessState: 'none' | 'unavailable' | 'available' | 'active'
  capabilities: PeerCapabilities | null
}

interface TunnelStatusResponse {
  chatId: number
  localPeerType: string
  tunnelState: string
  bridgeRunning: boolean
  irohLinked: boolean
  readyForClient: boolean
  sessionId: string | null
  protocol: string | null
  localShimPort: number | null
  staleDbState: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUPPORTED_PROTOCOLS = ['ssh', 'rdp', 'vnc', 'portfwd'] as const
type Protocol = (typeof SUPPORTED_PROTOCOLS)[number]

function filterProtocols(advertised: string[]): Protocol[] {
  if (!advertised.length) return ['ssh', 'rdp', 'vnc']
  const lower = new Set(advertised.map(p => p.toLowerCase()))
  const filtered = SUPPORTED_PROTOCOLS.filter(p => lower.has(p))
  return filtered.length ? filtered : ['ssh', 'rdp', 'vnc']
}

function protocolLabel(p: string): string {
  switch (p.toLowerCase()) {
    case 'rdp':
      return 'RDP (Remote Desktop)'
    case 'vnc':
      return 'VNC (Virtual Desktop)'
    case 'portfwd':
      return 'LAN Reach (TCP Forward)'
    default:
      return 'SSH (Secure Shell)'
  }
}

function connectionHintText(protocol: string, port: number): string {
  switch (protocol.toLowerCase()) {
    case 'rdp':
      return `Open your RDP client and connect to:\n127.0.0.1:${port}`
    case 'vnc':
      return `Open your VNC viewer and connect to:\n127.0.0.1:${port}`
    case 'portfwd':
      return `Point your engineering tool (e.g. GX Works) at:\n127.0.0.1:${port}`
    default:
      return `Connect your SSH client:\nssh -p ${port} user@127.0.0.1`
  }
}

// ---------------------------------------------------------------------------
// RemoteAccessDialog
// ---------------------------------------------------------------------------

export interface RemoteAccessDialogProps extends DialogProps {
  chatId: number
  chatName: string
}

type Phase =
  | { kind: 'pick'; protocols: Protocol[]; portfwdTargets: LanReachTarget[] }
  | {
      kind: 'pick_target'
      targets: LanReachTarget[]
      selectedIdx: number
      localPort: string
    }
  | { kind: 'connecting'; protocol: Protocol; statusText: string }
  | {
      kind: 'active'
      protocol: Protocol
      port: number
      sessionId: string | null
    }
  | { kind: 'closing' }
  | { kind: 'error'; msg: string }

export default function RemoteAccessDialog({
  chatId,
  chatName,
  onClose,
}: RemoteAccessDialogProps) {
  const tx = useTranslationFunction()
  const accountId = selectedAccountId()
  const abortRef = useRef(false)

  const [phase, setPhase] = useState<Phase | null>(null)

  // Load initial state (maybe tunnel already active from a previous session)
  useEffect(() => {
    abortRef.current = false
    loadInitialPhase()
    return () => {
      abortRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  const rpc = BackendRemote.rpc as any

  async function loadInitialPhase() {
    try {
      const status: TunnelStatusResponse = await rpc.privittyGetTunnelStatus(
        accountId,
        chatId
      )
      console.log('privittyGetTunnelStatus =====', status)
      if (abortRef.current) return

      if (
        status &&
        (status.readyForClient ||
          status.bridgeRunning ||
          status.tunnelState?.toLowerCase() === 'active')
      ) {
        setPhase({
          kind: 'active',
          protocol: (status.protocol ?? 'ssh') as Protocol,
          port: status.localShimPort ?? 2222,
          sessionId: status.sessionId ?? null,
        })
        return
      }

      // Load available protocols from capabilities
      const caps: PeerCapabilitiesResponse =
        await rpc.privittyGetPeerCapabilities(accountId, chatId)
      console.log(
        'Load available protocols from capabilities privittyGetPeerCapabilities',
        caps
      )
      if (abortRef.current) return
      const protocols = filterProtocols(caps?.capabilities?.protocols ?? [])
      const portfwdTargets = caps?.capabilities?.portfwdTargets ?? []
      setPhase({ kind: 'pick', protocols, portfwdTargets })
    } catch (e: any) {
      if (!abortRef.current) {
        setPhase({
          kind: 'error',
          msg: e?.message ?? 'Failed to load capabilities',
        })
      }
    }
  }

  const openTunnel = useCallback(
    async (protocol: Protocol) => {
      if (protocol === 'portfwd') {
        // Should go through pick_target first.
        return
      }
      setPhase({
        kind: 'connecting',
        protocol,
        statusText: 'Sending tunnel offer…',
      })

      const WAIT_TIMEOUT_MS = 180_000
      const POLL_INTERVAL_MS = 1_000
      const deadline = Date.now() + WAIT_TIMEOUT_MS

      try {
        const offer = await rpc.privittySendTunnelOffer(
          accountId,
          chatId,
          protocol
        )

        console.log('Offer privittySendTunnelOffer', offer)

        setPhase({
          kind: 'connecting',
          protocol,
          statusText: 'Waiting for edge gateway…',
        })

        while (Date.now() < deadline) {
          if (abortRef.current) return
          await sleep(POLL_INTERVAL_MS)
          if (abortRef.current) return

          const status: TunnelStatusResponse =
            await rpc.privittyGetTunnelStatus(accountId, chatId)
          if (!status) continue

          if (status.readyForClient) {
            const port = status.localShimPort ?? offer.localPort
            setPhase({
              kind: 'active',
              protocol,
              port,
              sessionId: offer.sessionId ?? null,
            })
            return
          }

          if (status.irohLinked) {
            setPhase({
              kind: 'connecting',
              protocol,
              statusText: 'Connected — waiting for bridge…',
            })
          } else if (status.bridgeRunning) {
            setPhase({
              kind: 'connecting',
              protocol,
              statusText: 'Bridge starting…',
            })
          }
        }

        setPhase({
          kind: 'error',
          msg: 'Timed out waiting for tunnel (180 s). Is the edge online?',
        })
      } catch (e: any) {
        if (!abortRef.current) {
          setPhase({
            kind: 'error',
            msg: e?.message ?? 'Tunnel connection failed',
          })
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountId, chatId]
  )

  const openLanReach = useCallback(
    async (target: LanReachTarget, localPort: number) => {
      setPhase({
        kind: 'connecting',
        protocol: 'portfwd',
        statusText: `Opening LAN Reach to ${target.ip}:${target.port}…`,
      })

      const WAIT_TIMEOUT_MS = 180_000
      const POLL_INTERVAL_MS = 1_000
      const deadline = Date.now() + WAIT_TIMEOUT_MS

      try {
        const offer = await rpc.privittySendLanReachOffer(
          accountId,
          chatId,
          target.ip,
          target.port,
          localPort
        )

        console.log('offer privittySendLanReachOffer', offer)

        setPhase({
          kind: 'connecting',
          protocol: 'portfwd',
          statusText: 'Waiting for edge gateway…',
        })

        while (Date.now() < deadline) {
          if (abortRef.current) return
          await sleep(POLL_INTERVAL_MS)
          if (abortRef.current) return

          const status: TunnelStatusResponse =
            await rpc.privittyGetTunnelStatus(accountId, chatId)
          if (!status) continue

          if (status.readyForClient) {
            const port = status.localShimPort ?? offer.localPort
            setPhase({
              kind: 'active',
              protocol: 'portfwd',
              port,
              sessionId: offer.sessionId ?? null,
            })
            return
          }

          if (status.irohLinked) {
            setPhase({
              kind: 'connecting',
              protocol: 'portfwd',
              statusText: 'Connected — waiting for bridge…',
            })
          } else if (status.bridgeRunning) {
            setPhase({
              kind: 'connecting',
              protocol: 'portfwd',
              statusText: 'Bridge starting…',
            })
          }
        }

        setPhase({
          kind: 'error',
          msg: 'Timed out waiting for LAN Reach tunnel (180 s). Is the edge online?',
        })
      } catch (e: any) {
        if (!abortRef.current) {
          setPhase({
            kind: 'error',
            msg: e?.message ?? 'LAN Reach connection failed',
          })
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountId, chatId]
  )

  const closeTunnel = useCallback(async () => {
    setPhase({ kind: 'closing' })
    try {
      const tunnelClose = await rpc.privittyCloseTunnel(accountId, chatId)
      console.log('tunnelClose PRINTn======== privittyCloseTunnel', tunnelClose)
    } catch {
      // ignore — UI will refresh
    }
    onClose()
  }, [accountId, chatId, onClose, rpc])

  // Listen for PrivittyTunnelActive / Closed / Error events to keep phase in sync
  useEffect(() => {
    const unsubs = [
      onDCEvent(accountId, 'PrivittyTunnelActive' as any, (ev: any) => {
        if (ev.chatId !== chatId) return
        setPhase(prev =>
          prev?.kind === 'connecting'
            ? {
                kind: 'active',
                protocol: (ev.protocol ?? 'ssh') as Protocol,
                port: 2222,
                sessionId: ev.sessionId ?? null,
              }
            : prev
        )
      }),
      onDCEvent(accountId, 'PrivittyTunnelClosed' as any, (ev: any) => {
        if (ev.chatId !== chatId) return
        onClose()
      }),
      onDCEvent(accountId, 'PrivittyTunnelError' as any, (ev: any) => {
        if (ev.chatId !== chatId) return
        setPhase({ kind: 'error', msg: ev.msg ?? 'Tunnel error' })
      }),
    ]
    return () => unsubs.forEach(fn => fn())
  }, [accountId, chatId, onClose])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const title = 'Remote Access'

  if (!phase) {
    return (
      <DialogWithHeader title={title} onClose={onClose}>
        <DialogBody>
          <DialogContent>
            <p style={{ textAlign: 'center', padding: '24px 0', opacity: 0.7 }}>
              Loading…
            </p>
          </DialogContent>
        </DialogBody>
      </DialogWithHeader>
    )
  }

  if (phase.kind === 'pick') {
    return (
      <DialogWithHeader title={title} onClose={onClose}>
        <DialogBody>
          <DialogContent>
            <p
              style={{
                marginBottom: 12,
                fontWeight: 600,
                fontSize: '0.95em',
              }}
            >
              Connect to edge: <em>{chatName}</em>
            </p>
            <p style={{ marginBottom: 16, fontSize: '0.85em', opacity: 0.72 }}>
              Choose a remote-access protocol:
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {phase.protocols.map(p => (
                <button
                  key={p}
                  onClick={() => {
                    if (p === 'portfwd') {
                      if (!phase.portfwdTargets.length) {
                        setPhase({
                          kind: 'error',
                          msg: 'No LAN Reach targets provisioned. Ask your Watchtower admin to whitelist a device first.',
                        })
                        return
                      }
                      setPhase({
                        kind: 'pick_target',
                        targets: phase.portfwdTargets,
                        selectedIdx: 0,
                        localPort: String(
                          phase.portfwdTargets[0]?.port ?? 5007
                        ),
                      })
                    } else {
                      openTunnel(p)
                    }
                  }}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 6,
                    border: '1px solid var(--colorDeltaBlue)',
                    background: 'transparent',
                    color: 'var(--colorDeltaBlue)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontWeight: 500,
                  }}
                >
                  {protocolLabel(p)}
                </button>
              ))}
            </div>
          </DialogContent>
        </DialogBody>
        <DialogFooter>
          <button
            className='delta-button-round delta-button-secondary'
            onClick={onClose}
          >
            {tx('cancel')}
          </button>
        </DialogFooter>
      </DialogWithHeader>
    )
  }

  if (phase.kind === 'pick_target') {
    const selectedTarget = phase.targets[phase.selectedIdx]
    const canConnect = !!selectedTarget && Number(phase.localPort) > 0
    return (
      <DialogWithHeader title='LAN Reach — Choose Target' onClose={onClose}>
        <DialogBody>
          <DialogContent>
            <p style={{ marginBottom: 12, fontSize: '0.85em', opacity: 0.72 }}>
              Select a WatchTower-approved LAN device, then confirm the local
              port your engineering tool (e.g. GX Works) will connect to.
            </p>

            {/* Target selection */}
            <p style={{ marginBottom: 6, fontWeight: 600, fontSize: '0.85em' }}>
              LAN device:
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                marginBottom: 16,
              }}
            >
              {phase.targets.map((t, idx) => (
                <label
                  key={`${t.ip}:${t.port}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 14px',
                    borderRadius: 6,
                    border: `1px solid ${idx === phase.selectedIdx ? 'var(--colorDeltaBlue)' : 'var(--outlinePrimary, #ccc)'}`,
                    background:
                      idx === phase.selectedIdx
                        ? 'var(--bgChatlistItem)'
                        : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type='radio'
                    name='lan-target'
                    checked={idx === phase.selectedIdx}
                    onChange={() =>
                      setPhase(prev =>
                        prev?.kind === 'pick_target'
                          ? {
                              ...prev,
                              selectedIdx: idx,
                              localPort: String(t.port),
                            }
                          : prev
                      )
                    }
                    style={{ accentColor: 'var(--colorDeltaBlue)' }}
                  />
                  <div>
                    <div style={{ fontWeight: 500 }}>
                      {t.label || `${t.ip}:${t.port}`}
                    </div>
                    <div
                      style={{
                        fontSize: '0.8em',
                        opacity: 0.7,
                        fontFamily: 'monospace',
                      }}
                    >
                      {t.ip}:{t.port}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {/* Local port */}
            <label
              style={{ display: 'block', fontSize: '0.85em', marginBottom: 16 }}
            >
              <span style={{ fontWeight: 600 }}>Local port</span>
              <span style={{ opacity: 0.65 }}>
                {' '}
                — your tool connects to 127.0.0.1:&lt;port&gt;
              </span>
              <input
                type='number'
                min={1}
                max={65535}
                value={phase.localPort}
                onChange={e =>
                  setPhase(prev =>
                    prev?.kind === 'pick_target'
                      ? { ...prev, localPort: e.target.value }
                      : prev
                  )
                }
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 6,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--outlinePrimary, #ccc)',
                  background: 'var(--bgPrimary)',
                  color: 'var(--textPrimary)',
                }}
              />
            </label>
          </DialogContent>
        </DialogBody>
        <DialogFooter>
          <button
            className='delta-button-round delta-button-secondary'
            onClick={onClose}
          >
            {tx('cancel')}
          </button>
          <button
            className='delta-button-round delta-button-primary'
            disabled={!canConnect}
            onClick={() => {
              if (selectedTarget) {
                openLanReach(selectedTarget, Number(phase.localPort))
              }
            }}
          >
            Connect
          </button>
        </DialogFooter>
      </DialogWithHeader>
    )
  }

  if (phase.kind === 'connecting') {
    return (
      <DialogWithHeader title={title} onClose={onClose}>
        <DialogBody>
          <DialogContent>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '24px 0',
                gap: 16,
              }}
            >
              <div className='progress-icon' style={{ fontSize: 32 }}>
                ⏳
              </div>
              <p style={{ fontWeight: 600 }}>{protocolLabel(phase.protocol)}</p>
              <p style={{ opacity: 0.72, fontSize: '0.9em' }}>
                {phase.statusText}
              </p>
            </div>
          </DialogContent>
        </DialogBody>
        <DialogFooter>
          <button
            className='delta-button-round delta-button-secondary'
            onClick={onClose}
          >
            {tx('cancel')}
          </button>
        </DialogFooter>
      </DialogWithHeader>
    )
  }

  if (phase.kind === 'active') {
    const hint = connectionHintText(phase.protocol, phase.port)
    return (
      <DialogWithHeader
        title={`Remote Access — ${phase.protocol.toUpperCase()} Active`}
        onClose={onClose}
      >
        <DialogBody>
          <DialogContent>
            <p
              style={{
                marginBottom: 12,
                fontWeight: 600,
                color: 'var(--colorSuccess, #2e7d32)',
              }}
            >
              ✓ Tunnel established
            </p>
            <div
              style={{
                background: 'var(--bgChatlistItem)',
                borderRadius: 6,
                padding: '12px 14px',
                marginBottom: 12,
                fontFamily: 'monospace',
                fontSize: '0.9em',
                whiteSpace: 'pre',
                userSelect: 'all',
              }}
            >
              {hint}
            </div>
            {phase.sessionId && (
              <p style={{ fontSize: '0.8em', opacity: 0.6 }}>
                Session: {phase.sessionId}
              </p>
            )}
          </DialogContent>
        </DialogBody>
        <DialogFooter>
          <button
            className='delta-button-round delta-button-primary'
            onClick={onClose}
          >
            {tx('ok')}
          </button>
          <button
            className='delta-button-round delta-button-secondary'
            style={{ color: 'var(--colorDanger, #c62828)' }}
            onClick={closeTunnel}
          >
            Close Tunnel
          </button>
        </DialogFooter>
      </DialogWithHeader>
    )
  }

  if (phase.kind === 'closing') {
    return (
      <DialogWithHeader title={title} onClose={onClose}>
        <DialogBody>
          <DialogContent>
            <p style={{ textAlign: 'center', padding: '24px 0', opacity: 0.7 }}>
              Closing tunnel…
            </p>
          </DialogContent>
        </DialogBody>
      </DialogWithHeader>
    )
  }

  // error
  return (
    <DialogWithHeader title='Remote Access — Error' onClose={onClose}>
      <DialogBody>
        <DialogContent>
          <p
            style={{
              marginBottom: 12,
              color: 'var(--colorDanger, #c62828)',
              fontWeight: 600,
            }}
          >
            Connection failed
          </p>
          <p style={{ fontSize: '0.9em', opacity: 0.85 }}>
            {(phase as any).msg}
          </p>
        </DialogContent>
      </DialogBody>
      <DialogFooter>
        <button
          className='delta-button-round delta-button-primary'
          onClick={onClose}
        >
          {tx('ok')}
        </button>
      </DialogFooter>
    </DialogWithHeader>
  )
}

// ---------------------------------------------------------------------------
// Tiny utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
