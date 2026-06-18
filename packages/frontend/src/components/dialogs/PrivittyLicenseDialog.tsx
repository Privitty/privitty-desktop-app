import React, { useEffect, useState } from 'react'
import { runtime } from '@deltachat-desktop/runtime-interface'
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogWithHeader,
  FooterActionButton,
  FooterActions,
} from '../Dialog'
import type { DialogProps } from '../../contexts/DialogContext'
import {
  PRIVITTY_STATUS_ACTIVE,
  PRIVITTY_STATUS_BYPASS,
  PRIVITTY_STATUS_GRACE_PERIOD,
  PRIVITTY_STATUS_NOT_ACTIVATED,
  PRIVITTY_STATUS_EXPIRED,
  PRIVITTY_STATUS_CLOCK_TAMPERED,
  licenseActivate,
  licenseGetStatus,
  licenseGetInfo,
  licenseStatusLabel,
  type PrivittyLicenseInfo,
} from '../../utils/privittyLicense'

export type PrivittyLicenseDialogProps = {
  initialStatusCode: number
} & DialogProps

export default function PrivittyLicenseDialog({
  initialStatusCode,
  onClose,
}: PrivittyLicenseDialogProps) {
  const [statusCode, setStatusCode] = useState(initialStatusCode)
  const [licenseInfo, setLicenseInfo] = useState<PrivittyLicenseInfo | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (statusCode === PRIVITTY_STATUS_ACTIVE || statusCode === PRIVITTY_STATUS_BYPASS) {
      return
    }
    licenseGetInfo()
      .then(info => setLicenseInfo(info))
      .catch(() => {})
  }, [statusCode])

  const refresh = async () => {
    try {
      const code = await licenseGetStatus()
      setStatusCode(code)
      if (code !== PRIVITTY_STATUS_ACTIVE && code !== PRIVITTY_STATUS_BYPASS) {
        const info = await licenseGetInfo()
        setLicenseInfo(info)
      }
    } catch {
      // ignore
    }
  }

  const handleLoadLicenseFile = async () => {
    setErrorMsg(null)
    const files = await runtime.showOpenFileDialog({
      filters: [{ name: 'License files', extensions: ['lic', 'jwt', 'json'] }],
      properties: ['openFile'],
    })
    if (!files || files.length === 0) return

    setBusy(true)
    try {
      // Delegate to the IPC handler which copies the JWT to the canonical
      // config path and immediately calls licenseInit + licenseActivate.
      await runtime.importLicenseFromFile(files[0])
      await refresh()
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to load license file'
      )
    } finally {
      setBusy(false)
    }
  }

  const handleActivate = async () => {
    setErrorMsg(null)
    setBusy(true)
    try {
      await licenseActivate()
      await refresh()
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to activate license'
      )
    } finally {
      setBusy(false)
    }
  }

  const needsAction =
    statusCode === PRIVITTY_STATUS_NOT_ACTIVATED ||
    statusCode === PRIVITTY_STATUS_EXPIRED

  const isGracePeriod = statusCode === PRIVITTY_STATUS_GRACE_PERIOD
  const isTampered = statusCode === PRIVITTY_STATUS_CLOCK_TAMPERED

  const title = needsAction
    ? 'Activate Privitty License'
    : isGracePeriod
      ? 'License Grace Period'
      : isTampered
        ? 'License Clock Error'
        : `License — ${licenseStatusLabel(statusCode)}`

  const bodyText = needsAction
    ? statusCode === PRIVITTY_STATUS_EXPIRED
      ? 'Your Privitty license has expired. Load a valid license file or contact your administrator.'
      : 'Your Privitty license is not yet activated on this device. Load a license file or activate online.'
    : isGracePeriod
      ? 'Your Privitty license is in its grace period. Please renew it soon to avoid service interruption.'
      : isTampered
        ? 'The system clock appears to have been changed. Please correct the system time and restart the app.'
        : `License status: ${licenseStatusLabel(statusCode)}`

  return (
    <DialogWithHeader title={title} onClose={onClose}>
      <DialogBody>
        <DialogContent paddingTop>
          <p style={{ marginBottom: 12 }}>{bodyText}</p>
          {licenseInfo && (
            <div
              style={{
                fontSize: 13,
                color: '#666',
                background: '#f5f5f5',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 12,
              }}
            >
              {licenseInfo.licenseId && (
                <div>
                  <strong>License ID:</strong> {licenseInfo.licenseId}
                </div>
              )}
              {licenseInfo.licenseType && (
                <div>
                  <strong>Type:</strong> {licenseInfo.licenseType}
                </div>
              )}
              {licenseInfo.activatedDevices != null && (
                <div>
                  <strong>Devices:</strong> {licenseInfo.activatedDevices}
                  {licenseInfo.maxDevices != null
                    ? ` / ${licenseInfo.maxDevices}`
                    : ''}
                </div>
              )}
              {licenseInfo.expiresAt != null && (
                <div>
                  <strong>Expires:</strong>{' '}
                  {new Date(licenseInfo.expiresAt * 1000).toLocaleDateString()}
                </div>
              )}
            </div>
          )}
          {errorMsg && (
            <p style={{ color: '#d32f2f', marginTop: 8 }}>{errorMsg}</p>
          )}
        </DialogContent>
      </DialogBody>
      <DialogFooter>
        <FooterActions>
          {needsAction && (
            <>
              <FooterActionButton
                onClick={handleLoadLicenseFile}
                disabled={busy}
              >
                Load License File
              </FooterActionButton>
              <FooterActionButton onClick={handleActivate} disabled={busy}>
                Activate Online
              </FooterActionButton>
            </>
          )}
          {(isGracePeriod || isTampered) && (
            <FooterActionButton onClick={onClose}>Dismiss</FooterActionButton>
          )}
          {!needsAction && !isGracePeriod && !isTampered && (
            <FooterActionButton onClick={onClose}>OK</FooterActionButton>
          )}
        </FooterActions>
      </DialogFooter>
    </DialogWithHeader>
  )
}
