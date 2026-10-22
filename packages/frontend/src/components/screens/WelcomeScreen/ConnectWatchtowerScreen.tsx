import React, { useRef, useState } from 'react'
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
import { QrReader } from '../../QrReader'

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

function logEnroll(step: string, detail?: unknown) {
  /* ignore-console-log */
  console.info('[watchtower-enroll]', step, detail ?? '')
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function rpcMethodMissing(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code: unknown }).code
      : undefined
  return code === -32601 || /method not found|unknown method|not a function/i.test(errorText(error))
}

async function requestEmailCode(link: string): Promise<Record<string, unknown>> {
  logEnroll('rpc privitty_wt_enroll_start')
  try {
    const raw = await BackendRemote.transport.request('privitty_wt_enroll_start', [link])
    logEnroll('rpc result', raw)
    return parseJson(raw)
  } catch (error) {
    logEnroll('rpc failed', errorText(error))
    if (!rpcMethodMissing(error)) {
      throw error
    }
    logEnroll('core has no enroll method; contacting Watchtower from the desktop')
    const started = await runtime.watchtowerEnrollStart(link)
    for (const line of started.trace) {
      logEnroll(line)
    }
    return { challengeId: started.challengeId, emailHint: started.emailHint }
  }
}

function describeLink(link: string): Record<string, unknown> {
  try {
    const url = new URL(link)
    const token = url.searchParams.get('t') ?? ''
    return {
      host: url.searchParams.get('wt'),
      tokenPrefix: token.slice(0, 6),
      tokenLength: token.length,
      ca: url.searchParams.get('ca'),
    }
  } catch (error) {
    return { parseError: errorText(error), length: link.length }
  }
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
  const scanning = useRef(false)

  async function start(enrollLink?: string) {
    const value = (enrollLink ?? link).trim()
    logEnroll('start', describeLink(value))
    if (!value.toLowerCase().startsWith('privitty://enroll')) {
      setHint('Paste a privitty://enroll link, or scan its QR code.')
      setPhase('error')
      return
    }
    setLink(value)
    setPhase('link')
    setHint('Contacting Watchtower…')
    try {
      const started = await requestEmailCode(value)
      setChallengeId(String(started.challengeId ?? ''))
      const email = String(started.emailHint ?? '')
      logEnroll('email code requested', { challengeId: started.challengeId, emailHint: email })
      setHint(email ? `Enter the code sent to ${email}` : 'Enter the code from your email.')
      setPhase('code')
    } catch (error) {
      logEnroll('start failed', errorText(error))
      setHint(errorText(error))
      setPhase('error')
    }
  }

  async function onScan(data: string) {
    const value = data.trim()
    logEnroll('qr', describeLink(value))
    if (!value || scanning.current || phase === 'code' || phase === 'done') {
      logEnroll('qr ignored', { empty: !value, phase })
      return
    }
    if (!value.toLowerCase().startsWith('privitty://enroll')) {
      setHint('That QR code is not a Watchtower invite.')
      setPhase('error')
      return
    }
    scanning.current = true
    try {
      await start(value)
    } finally {
      scanning.current = false
    }
  }

  async function requestConfirm(
    wrapping: string
  ): Promise<{ status: 'ok' | 'blocked'; reason?: string }> {
    const accountId = selectedAccountId()
    const meta = JSON.parse(metadata()) as Record<string, unknown>
    logEnroll('rpc privitty_wt_enroll_confirm')
    try {
      const raw = await BackendRemote.transport.request('privitty_wt_enroll_confirm', [
        accountId,
        link.trim(),
        challengeId,
        code.trim(),
        metadata(),
        wrapping,
      ])
      logEnroll('rpc confirm result', raw)
      return parseJson(raw) as { status: 'ok' | 'blocked'; reason?: string }
    } catch (rpcError) {
      logEnroll('rpc confirm failed', errorText(rpcError))
      if (!rpcMethodMissing(rpcError)) throw rpcError
      logEnroll('core has no confirm method; confirming from the desktop')
      const result = await runtime.watchtowerEnrollConfirm({
        accountId,
        link: link.trim(),
        challengeId,
        code: code.trim(),
        metadata: meta,
        wrappingKeyB64: wrapping,
      })
      for (const line of result.trace) {
        logEnroll(line)
      }
      return { status: result.status, reason: result.reason }
    }
  }

  async function confirm() {
    logEnroll('confirm', { challengeId, codeLength: code.trim().length })
    setHint('Confirming…')
    try {
      const wrapping = await runtime.getWatchtowerWrappingKey()
      const body = await requestConfirm(wrapping)
      logEnroll('confirm done', body)
      if (body.status === 'blocked') {
        window.dispatchEvent(
          new CustomEvent('watchtower-access-ended', {
            detail: { reason: String(body.reason ?? 'invalid') },
          })
        )
        setHint(`Access blocked: ${body.reason ?? 'device not permitted'}`)
        setPhase('error')
        return
      }
      setPhase('done')
      setHint('Connected to Watchtower.')
    } catch (error) {
      logEnroll('confirm failed', errorText(error))
      setHint(errorText(error))
      setPhase('error')
    }
  }

  return (
    <>
      <DialogHeader title='Connect to Watchtower' />
      <DialogBody>
        <DialogContent>
          <p>{hint}</p>
          {phase !== 'code' && phase !== 'done' && (
            <QrReader onScanSuccess={data => void onScan(data)} onError={message => setHint(message)} />
          )}
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
