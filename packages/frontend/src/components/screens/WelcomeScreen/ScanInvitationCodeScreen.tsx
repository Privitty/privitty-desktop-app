import React, { useCallback, useRef, useState } from 'react'

import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FooterActionButton,
  FooterActions,
} from '../../Dialog'
import { QrReader, QrCodeScanRef } from '../../QrReader'
import useProcessQr from '../../../hooks/useProcessQr'
import useTranslationFunction from '../../../hooks/useTranslationFunction'
import useAlertDialog from '../../../hooks/dialog/useAlertDialog'
import { runtime } from '@deltachat-desktop/runtime-interface'

// Match any HTTPS URL whose path starts with /v1/license/ — covers both the
// production server (plm.privittytech.com) and any staging / on-prem server.
const LICENSE_URL_RE = /^https?:\/\/[^/]+\/v1\/license\//i

type LicenseStep = 'idle' | 'working' | 'success' | 'error'

type Props = {
  selectedAccountId: number
  onBack: () => void
  onScanDone: (qrValue: string) => void
  /**
   * Called after a Privitty license URL is successfully imported.
   * Use this to proceed to instant onboarding rather than looping
   * back to the OnboardingScreen.
   */
  onLicenseDone?: () => void
}

export default function ScanInvitationCodeScreen({
  selectedAccountId,
  onBack,
  onScanDone,
  onLicenseDone,
}: Props) {
  const tx = useTranslationFunction()
  const processQr = useProcessQr()
  const openAlertDialog = useAlertDialog()
  const processingQrCode = useRef(false)
  const qrReaderRef = useRef<QrCodeScanRef | null>(null)
  const [readerKey, setReaderKey] = useState(0)
  const [licenseStep, setLicenseStep] = useState<LicenseStep>('idle')
  const [licenseCustomerName, setLicenseCustomerName] = useState('')
  const [licenseError, setLicenseError] = useState('')

  const handleError = useCallback(
    (error: any) => {
      const errorMessage = error?.message || error.toString()
      openAlertDialog({
        message: `${tx('qrscan_failed')} ${errorMessage}`,
      })
    },
    [openAlertDialog, tx]
  )

  const handleScanSuccess = useCallback(
    async (data: string) => {
      if (!data || processingQrCode.current) {
        return
      }

      // Intercept Privitty license delivery URLs before passing to DeltaChat QR handler.
      if (LICENSE_URL_RE.test(data)) {
        processingQrCode.current = true
        setLicenseStep('working')
        try {
          const { customerName } = await runtime.importLicenseFromUrl(data)
          setLicenseCustomerName(customerName)
          setLicenseStep('success')
          // After a short pause to let the user see the success message,
          // proceed to instant onboarding (if caller provided the callback).
          if (onLicenseDone) {
            window.setTimeout(onLicenseDone, 1500)
          }
        } catch (err) {
          setLicenseError(
            err instanceof Error ? err.message : 'License import failed.'
          )
          setLicenseStep('error')
        } finally {
          processingQrCode.current = false
        }
        return
      }

      processingQrCode.current = true
      try {
        await processQr(selectedAccountId, data, () => onScanDone(data))
      } catch (error: any) {
        handleError(error)
      } finally {
        processingQrCode.current = false
      }
    },
    [processQr, selectedAccountId, onScanDone, onLicenseDone, handleError]
  )

  const handlePasteFromClipboard = useCallback(() => {
    qrReaderRef.current?.handlePasteFromClipboard()
  }, [])

  const handleRetryCamera = useCallback(() => {
    // Re-mount the reader to trigger camera permission flow again.
    setReaderKey(prev => prev + 1)
  }, [])

  // Fallback: import a .lic / JWT file directly when the delivery server is
  // unreachable or the user received the license file by email.
  const handleLoadLicenseFile = useCallback(async () => {
    if (processingQrCode.current) return
    const files = await runtime.showOpenFileDialog({
      filters: [{ name: 'License files', extensions: ['lic', 'jwt', 'json', 'txt'] }],
      properties: ['openFile'],
    })
    if (!files || files.length === 0) return
    processingQrCode.current = true
    setLicenseStep('working')
    try {
      await runtime.importLicenseFromFile(files[0])
      setLicenseCustomerName('')
      setLicenseStep('success')
      if (onLicenseDone) {
        window.setTimeout(onLicenseDone, 1500)
      }
    } catch (err) {
      setLicenseError(
        err instanceof Error ? err.message : 'License file import failed.'
      )
      setLicenseStep('error')
    } finally {
      processingQrCode.current = false
    }
  }, [onLicenseDone])

  // ── License import sub-states ────────────────────────────────────────────
  if (licenseStep === 'working') {
    return (
      <>
        <DialogHeader title='Importing License…' onClickBack={onBack} />
        <DialogBody>
          <DialogContent>
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 13, color: '#666' }}>
                Importing license…
              </div>
            </div>
          </DialogContent>
        </DialogBody>
      </>
    )
  }

  if (licenseStep === 'success') {
    return (
      <>
        <DialogHeader title='License Activated' onClickBack={onBack} />
        <DialogBody>
          <DialogContent>
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                License activated
              </div>
              {licenseCustomerName !== 'Unknown' && (
                <div style={{ fontSize: 13, color: '#666' }}>
                  Licensed to: {licenseCustomerName}
                </div>
              )}
            </div>
          </DialogContent>
        </DialogBody>
        <DialogFooter>
          <FooterActions>
            <FooterActionButton onClick={() => onLicenseDone ? onLicenseDone() : onScanDone('')}>
              Continue
            </FooterActionButton>
          </FooterActions>
        </DialogFooter>
      </>
    )
  }

  if (licenseStep === 'error') {
    return (
      <>
        <DialogHeader title='License Import Failed' onClickBack={onBack} />
        <DialogBody>
          <DialogContent>
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div
                style={{ fontSize: 13, color: '#d32f2f', whiteSpace: 'pre-wrap' }}
              >
                {licenseError}
              </div>
            </div>
          </DialogContent>
        </DialogBody>
        <DialogFooter>
          <FooterActions>
            <FooterActionButton
              onClick={() => {
                setLicenseStep('idle')
                setLicenseError('')
                setReaderKey(k => k + 1)
                processingQrCode.current = false
              }}
            >
              {tx('retry')}
            </FooterActionButton>
          </FooterActions>
        </DialogFooter>
      </>
    )
  }

  // ── Normal invitation-code scanner ───────────────────────────────────────
  return (
    <>
      <DialogHeader
        title='Scan Invitation Code'
        onClickBack={onBack}
        dataTestid='scan-invitation-code-header'
      />
      <DialogBody>
        <DialogContent>
          <QrReader
            key={readerKey}
            ref={qrReaderRef}
            onScanSuccess={handleScanSuccess}
            onError={handleError}
          />
          <div style={{ textAlign: 'center', marginTop: 8, opacity: 0.9 }}>
            Point your camera at the invitation QR code.
          </div>
        </DialogContent>
      </DialogBody>
      <DialogFooter>
        <FooterActions align='spaceBetween'>
          <FooterActionButton
            onClick={handlePasteFromClipboard}
            data-testid='scan-invitation-paste'
          >
            {tx('global_menu_edit_paste_desktop')}
          </FooterActionButton>
          <FooterActionButton
            onClick={handleLoadLicenseFile}
            data-testid='scan-invitation-load-license'
          >
            Load License File
          </FooterActionButton>
          <FooterActionButton
            onClick={handleRetryCamera}
            data-testid='scan-invitation-retry'
          >
            {tx('retry')}
          </FooterActionButton>
        </FooterActions>
      </DialogFooter>
    </>
  )
}
