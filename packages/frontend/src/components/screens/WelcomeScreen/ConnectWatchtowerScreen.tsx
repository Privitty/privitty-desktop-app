import React, { useState } from 'react'
import { BackendRemote } from '../../../backend-com'
import { selectedAccountId } from '../../../ScreenController'
import { runtime } from '@deltachat-desktop/runtime-interface'
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FooterActionButton,
  FooterActions,
} from '../../Dialog'

type Phase = 'link' | 'code' | 'done' | 'error'

function metadata(): string {
  return JSON.stringify({
    model: (navigator.userAgent || 'desktop').slice(0, 128),
    os: navigator.platform || 'desktop',
    os_version: '0',
    app_version: 'desktop',
    locale: navigator.language || 'en',
  })
}

function parseJson(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as Record<string, unknown>
  }
  return (raw ?? {}) as Record<string, unknown>
}

export default function ConnectWatchtowerScreen({
  initialLink,
  onBack,
  onDone,
}: {
  initialLink?: string
  onBack: () => void
  onDone: () => void
}) {
  const [link, setLink] = useState(initialLink ?? '')
  const [code, setCode] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [hint, setHint] = useState(
    'Paste a privitty://enroll link, or open one from a QR code.'
  )
  const [phase, setPhase] = useState<Phase>('link')
  const rpc = BackendRemote.rpc as any

  async function start() {
    setPhase('link')
    setHint('Contacting Watchtower…')
    try {
      const started = parseJson(await rpc.privittyWtEnrollStart(link.trim()))
      setChallengeId(String(started.challengeId ?? ''))
      const email = String(started.emailHint ?? '')
      setHint(email ? `Enter the code sent to ${email}` : 'Enter the code from your email.')
      setPhase('code')
    } catch (error) {
      setHint(error instanceof Error ? error.message : 'Could not start enrollment.')
      setPhase('error')
    }
  }

  async function confirm() {
    setHint('Confirming…')
    try {
      const wrapping = await runtime.getWatchtowerWrappingKey()
      const body = parseJson(
        await rpc.privittyWtEnrollConfirm(
          selectedAccountId(),
          link.trim(),
          challengeId,
          code.trim(),
          metadata(),
          wrapping
        )
      )
      if (body.status === 'blocked') {
        window.dispatchEvent(
          new CustomEvent('watchtower-access-ended', {
            detail: { reason: String(body.reason ?? 'invalid') },
          })
        )
        return
      }
      setPhase('done')
      setHint('Connected to Watchtower.')
    } catch (error) {
      setHint(error instanceof Error ? error.message : 'Could not confirm the code.')
      setPhase('error')
    }
  }

  return (
    <>
      <DialogHeader title='Connect to Watchtower' />
      <DialogBody>
        <DialogContent>
          <p>{hint}</p>
          {phase !== 'done' && (
            <textarea
              value={link}
              onChange={event => setLink(event.target.value)}
              placeholder='privitty://enroll?wt=…'
              rows={3}
              style={{ width: '100%' }}
            />
          )}
          {phase === 'code' && (
            <input
              value={code}
              onChange={event => setCode(event.target.value)}
              placeholder='Email code'
              style={{ width: '100%', marginTop: 8 }}
            />
          )}
        </DialogContent>
      </DialogBody>
      <DialogFooter>
        <FooterActions>
          <FooterActionButton onClick={onBack}>Back</FooterActionButton>
          {phase !== 'done' && phase !== 'code' && (
            <FooterActionButton onClick={() => void start()}>
              Send email code
            </FooterActionButton>
          )}
          {phase === 'code' && (
            <FooterActionButton onClick={() => void confirm()}>
              Confirm
            </FooterActionButton>
          )}
          {phase === 'done' && (
            <FooterActionButton onClick={onDone}>Done</FooterActionButton>
          )}
        </FooterActions>
      </DialogFooter>
    </>
  )
}

export function WatchtowerStatusBody({
  status,
}: {
  status: Record<string, unknown> | null
}) {
  if (!status) return <p>Loading status…</p>
  const host = String(status.wt_url ?? '—')
  const expires = Number(status.expires_at ?? 0)
  const days = Number(status.days_left ?? 0)
  const end =
    expires > 0
      ? `${new Date(expires * 1000).toLocaleString()} (${days} days left)`
      : '—'
  const renewed = String(status.last_renewal ?? 'Not reported')
  return (
    <div>
      <p>
        <strong>Watchtower host</strong>
        <br />
        {host}
      </p>
      <p>
        <strong>Licence end</strong>
        <br />
        {end}
      </p>
      <p>
        <strong>Last renewal</strong>
        <br />
        {renewed}
      </p>
    </div>
  )
}
