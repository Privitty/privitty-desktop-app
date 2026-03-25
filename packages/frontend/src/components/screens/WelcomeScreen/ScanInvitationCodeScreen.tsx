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

type Props = {
  selectedAccountId: number
  onBack: () => void
  onScanDone: (qrValue: string) => void
}

export default function ScanInvitationCodeScreen({
  selectedAccountId,
  onBack,
  onScanDone,
}: Props) {
  const tx = useTranslationFunction()
  const processQr = useProcessQr()
  const openAlertDialog = useAlertDialog()
  const processingQrCode = useRef(false)
  const qrReaderRef = useRef<QrCodeScanRef | null>(null)
  const [readerKey, setReaderKey] = useState(0)

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
      processingQrCode.current = true
      try {
        await processQr(selectedAccountId, data, () => onScanDone(data))
      } catch (error: any) {
        handleError(error)
      } finally {
        processingQrCode.current = false
      }
    },
    [processQr, selectedAccountId, onScanDone, handleError]
  )

  const handlePasteFromClipboard = useCallback(() => {
    qrReaderRef.current?.handlePasteFromClipboard()
  }, [])

  const handleRetryCamera = useCallback(() => {
    // Re-mount the reader to trigger camera permission flow again.
    setReaderKey(prev => prev + 1)
  }, [])

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
