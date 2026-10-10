import React from 'react'

/** Full-screen hard stop. Reason is expired, invalid, or deactivated. */
export default function WatchtowerAccessEnded({ reason }: { reason: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'var(--bgPrimary, #111)',
        color: 'var(--textPrimary, #fff)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <h1>Access ended</h1>
      <p>Reason: {reason || 'invalid'}</p>
      <p>Contact your organisation administrator.</p>
    </div>
  )
}
