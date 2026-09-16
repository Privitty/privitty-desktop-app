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
import Button from '../../Button'
import { QrReader, QrCodeScanRef } from '../../QrReader'

import styles from './ImportLicenseScreen.module.scss'

// Accept any HTTPS URL whose path starts with /v1/license/
const LICENSE_URL_RE = /^https?:\/\/[^/]+\/v1\/license\//i

type Step = 'idle' | 'scanning' | 'working' | 'success' | 'error'

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
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      setErrorMsg(
        'Could not read clipboard. Please copy the license URL first.'
      )
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
          <div className={styles.card}>{content}</div>
        </DialogContent>
      </DialogBody>
      {footer && <DialogFooter>{footer}</DialogFooter>}
    </>
  )

  // ── State: scanning ─────────────────────────────────────────────────────────
  // Match QrCodeScanQrInner / ScanInvitationCodeScreen: QrReader must sit in
  // DialogBody (not the centered .card) so the camera/error area can use the
  // full available width instead of shrinking to content.
  if (step === 'scanning') {
    return (
      <>
        <DialogHeader title='Import License' onClickBack={onBack} />
        <DialogBody>
          <QrReader
            key={readerKey}
            ref={qrRef}
            onScanSuccess={handleScanSuccess}
            onError={err => {
              setErrorMsg(
                typeof err === 'string'
                  ? err
                  : ((err as any)?.message ?? String(err))
              )
              setStep('error')
            }}
          />
          <DialogContent>
            <p className={styles.subtitleSmall}>
              Point your camera at the Privitty license QR code.
            </p>
          </DialogContent>
        </DialogBody>
        <DialogFooter>
          <FooterActions align='spaceBetween'>
            <FooterActionButton onClick={() => setStep('idle')}>
              Back
            </FooterActionButton>
            <FooterActionButton onClick={handlePasteUrl}>
              Paste URL
            </FooterActionButton>
          </FooterActions>
        </DialogFooter>
      </>
    )
  }

  // ── State: working ──────────────────────────────────────────────────────────
  if (step === 'working') {
    return card(
      <>
        <div className={styles.spinner} />
        <p className={styles.subtitleWithTopMargin}>{statusText}</p>
      </>
    )
  }

  // ── State: success ──────────────────────────────────────────────────────────
  if (step === 'success') {
    return card(
      <>
        <span className={styles.successIcon}>✓</span>
        <p className={styles.stateTitle}>License Imported</p>
        {customerName && customerName !== 'Unknown' && (
          <p className={styles.subtitleCompact}>Licensed to: {customerName}</p>
        )}
        <Button
          styling='primary'
          className={styles.actionButton}
          onClick={onDone}
        >
          Done
        </Button>
      </>
    )
  }

  // ── State: error ────────────────────────────────────────────────────────────
  if (step === 'error') {
    return card(
      <>
        <span className={styles.errorIcon}>✕</span>
        <p className={styles.stateTitle}>Import Failed</p>
        <p className={styles.errorText}>{errorMsg}</p>
        <Button
          styling='primary'
          className={styles.actionButton}
          onClick={handleRetry}
        >
          Try Again
        </Button>
      </>
    )
  }

  // ── State: idle (default — matches Android layoutIdle exactly) ────────────
  return card(
    <>
      <p className={styles.title}>Import License</p>
      <p className={styles.subtitle}>
        Paste the license link sent to you by email,
        <br />
        or scan the QR code provided by your administrator.
      </p>

      <div className={styles.actions}>
        <Button
          styling='primary'
          className={styles.actionButton}
          onClick={handlePasteUrl}
        >
          Paste License URL
        </Button>
        <Button
          className={`${styles.actionButton} ${styles.secondaryButton}`}
          onClick={() => setStep('scanning')}
        >
          Scan QR Code
        </Button>
      </div>
    </>
  )
}
