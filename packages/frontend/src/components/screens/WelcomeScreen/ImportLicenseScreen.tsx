/**
 * ImportLicenseScreen
 *
 * Desktop equivalent of Android's ImportLicenseActivity.
 * Matches the Android layout and copy exactly:
 *
 *   Idle    → "Import License" title + subtitle + "Paste License URL" primary
 *             + "Scan QR Code" secondary
 *   Scanning → QR reader (opens only after the button is clicked — not automatic)
 *   Working  → spinner + live status text
 *   Success  → ✓  "License Imported"  customer name  "Done"
 *   Error    → ✕  "Import Failed"     error text     "Try Again"
 */

import React, { useCallback, useRef, useState } from 'react'
import { runtime } from '@deltachat-desktop/runtime-interface'
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FooterActionButton,
  FooterActions,
} from '../../Dialog'
import { QrReader, QrCodeScanRef } from '../../QrReader'

// Accept any HTTPS URL whose path starts with /v1/license/
const LICENSE_URL_RE = /^https?:\/\/[^/]+\/v1\/license\//i

type Step = 'idle' | 'scanning' | 'working' | 'success' | 'error'

// ── Android colour tokens ─────────────────────────────────────────────────────
const C = {
  bg: '#F8F5FF',
  title: '#1e1b4b',
  subtitle: '#6b7280',
  primary: '#7F66C5',
  primaryText: '#ffffff',
  success: '#16a34a',
  error: '#dc2626',
} as const

type Props = {
  onBack: () => void
  /** Called after a successful import so WelcomeScreen can proceed to onboarding. */
  onDone: () => void
}

export default function ImportLicenseScreen({ onBack, onDone }: Props) {
  const [step, setStep] = useState<Step>('idle')
  const [statusText, setStatusText] = useState('Downloading license…')
  const [customerName, setCustomerName] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [readerKey, setReaderKey] = useState(0)
  const qrRef = useRef<QrCodeScanRef | null>(null)
  const processingRef = useRef(false)

  // ── Core import logic ───────────────────────────────────────────────────────

  const processUrl = useCallback(async (raw: string) => {
    const url = raw.trim()
    if (!LICENSE_URL_RE.test(url)) {
      setErrorMsg(
        'Not a valid Privitty license link.\n' +
          'Expected: https://…/v1/license/…\n\nGot: ' +
          url.slice(0, 120)
      )
      setStep('error')
      return
    }
    setStep('working')
    setStatusText('Connecting to license server…')
    try {
      setStatusText('Downloading license…')
      const result = await runtime.importLicenseFromUrl(url)
      setCustomerName(result.customerName)
      setStep('success')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error.')
      setStep('error')
    }
  }, [])

  const handleScanSuccess = useCallback(
    (data: string) => {
      if (!data || processingRef.current) return
      processingRef.current = true
      processUrl(data).finally(() => {
        processingRef.current = false
      })
    },
    [processUrl]
  )

  const handlePasteUrl = useCallback(async () => {
    if (processingRef.current) return
    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      setErrorMsg('Could not read clipboard. Please copy the license URL first.')
      setStep('error')
      return
    }
    if (!text.trim()) {
      setErrorMsg('Clipboard is empty. Copy the license URL first.')
      setStep('error')
      return
    }
    processingRef.current = true
    processUrl(text).finally(() => {
      processingRef.current = false
    })
  }, [processUrl])

  const handleRetry = useCallback(() => {
    setStep('idle')
    setErrorMsg('')
    setStatusText('Downloading license…')
    setReaderKey(k => k + 1)
    processingRef.current = false
  }, [])

  // ── Shared card wrapper ─────────────────────────────────────────────────────

  const card = (content: React.ReactNode, footer?: React.ReactNode) => (
    <>
      <DialogHeader title='Import License' onClickBack={onBack} />
      <DialogBody>
        <DialogContent>
          <div
            style={{
              background: C.bg,
              borderRadius: 12,
              padding: '32px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 0,
              minHeight: 260,
              justifyContent: 'center',
            }}
          >
            {content}
          </div>
        </DialogContent>
      </DialogBody>
      {footer && <DialogFooter>{footer}</DialogFooter>}
    </>
  )

  // ── State: scanning ─────────────────────────────────────────────────────────
  if (step === 'scanning') {
    return card(
      <>
        <QrReader
          key={readerKey}
          ref={qrRef}
          onScanSuccess={handleScanSuccess}
          onError={err => {
            setErrorMsg(typeof err === 'string' ? err : (err as any)?.message ?? String(err))
            setStep('error')
          }}
        />
        <p style={{ margin: '10px 0 0', fontSize: 12, color: C.subtitle, textAlign: 'center' }}>
          Point your camera at the Privitty license QR code.
        </p>
      </>,
      <FooterActions align='spaceBetween'>
        <FooterActionButton onClick={() => setStep('idle')}>
          Back
        </FooterActionButton>
        <FooterActionButton onClick={handlePasteUrl}>
          Paste URL
        </FooterActionButton>
      </FooterActions>
    )
  }

  // ── State: working ──────────────────────────────────────────────────────────
  if (step === 'working') {
    return card(
      <>
        <div
          style={{
            width: 40,
            height: 40,
            border: `4px solid ${C.primary}`,
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <p style={{ margin: '16px 0 0', fontSize: 14, color: C.subtitle, textAlign: 'center' }}>
          {statusText}
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>
    )
  }

  // ── State: success ──────────────────────────────────────────────────────────
  if (step === 'success') {
    return card(
      <>
        <span style={{ fontSize: 56, color: C.success, lineHeight: 1 }}>✓</span>
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 22,
            fontWeight: 700,
            color: C.title,
            textAlign: 'center',
          }}
        >
          License Imported
        </p>
        {customerName && customerName !== 'Unknown' && (
          <p style={{ margin: '6px 0 32px', fontSize: 14, color: C.subtitle, textAlign: 'center' }}>
            Licensed to: {customerName}
          </p>
        )}
        <button onClick={onDone} style={primaryBtn}>
          Done
        </button>
      </>
    )
  }

  // ── State: error ────────────────────────────────────────────────────────────
  if (step === 'error') {
    return card(
      <>
        <span style={{ fontSize: 56, color: C.error, lineHeight: 1 }}>✕</span>
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 22,
            fontWeight: 700,
            color: C.title,
            textAlign: 'center',
          }}
        >
          Import Failed
        </p>
        <p
          style={{
            margin: '6px 0 32px',
            fontSize: 14,
            color: C.subtitle,
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {errorMsg}
        </p>
        <button onClick={handleRetry} style={primaryBtn}>
          Try Again
        </button>
      </>
    )
  }

  // ── State: idle (default — matches Android layoutIdle exactly) ────────────
  return card(
    <>
      <p
        style={{
          margin: '0 0 12px',
          fontSize: 22,
          fontWeight: 700,
          color: C.title,
          textAlign: 'center',
        }}
      >
        Import License
      </p>
      <p
        style={{
          margin: '0 0 32px',
          fontSize: 14,
          color: C.subtitle,
          textAlign: 'center',
          lineHeight: 1.5,
        }}
      >
        Paste the license link sent to you by email,
        <br />
        or scan the QR code provided by your administrator.
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          maxWidth: 320,
        }}
      >
        <button onClick={handlePasteUrl} style={primaryBtn}>
          Paste License URL
        </button>
        <button onClick={() => setStep('scanning')} style={secondaryBtn}>
          Scan QR Code
        </button>
      </div>
    </>
  )
}

// ── Shared button styles ──────────────────────────────────────────────────────

const actionBtnBase: React.CSSProperties = {
  width: '100%',
  minHeight: 48,
  padding: '12px 24px',
  fontSize: 15,
  fontWeight: 600,
  borderRadius: 8,
  cursor: 'pointer',
  letterSpacing: 0.3,
  boxSizing: 'border-box',
}

const primaryBtn: React.CSSProperties = {
  ...actionBtnBase,
  background: '#7F66C5',
  color: '#ffffff',
  border: '1.5px solid #7F66C5',
}

const secondaryBtn: React.CSSProperties = {
  ...actionBtnBase,
  background: 'transparent',
  color: '#7F66C5',
  border: '1.5px solid #7F66C5',
}
