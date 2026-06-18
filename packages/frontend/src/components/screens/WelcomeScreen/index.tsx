import React, { useCallback, useLayoutEffect, useState } from 'react'

import Dialog from '../../Dialog'
import ImageBackdrop from '../../ImageBackdrop'
import ImportLicenseScreen from './ImportLicenseScreen'
import InstantOnboardingScreen from './InstantOnboardingScreen'
import OnboardingScreen from './OnboardingScreen'
import ScanInvitationCodeScreen from './ScanInvitationCodeScreen'
import useInstantOnboarding from '../../../hooks/useInstantOnboarding'
import { getConfiguredAccounts } from '../../../backend/account'
import { BackendRemote, EffectfulBackendActions } from '../../../backend-com'
import useDialog from '../../../hooks/dialog/useDialog'
import AlertDialog from '../../dialogs/AlertDialog'
import { unknownErrorToString } from '../../helpers/unknownErrorToString'
import { runtime } from '@deltachat-desktop/runtime-interface'

type Props = {
  selectedAccountId: number
  onUnSelectAccount: () => Promise<void>
  onExitWelcomeScreen: () => Promise<void>
}

/**
 * Welcomescreen is shown to users when they start the app
 * for the first time or when they have no configured accounts
 */

export default function WelcomeScreen({ selectedAccountId, ...props }: Props) {
  const {
    resetInstantOnboarding,
    showInstantOnboarding,
    startInstantOnboardingFlow,
  } = useInstantOnboarding()
  const [hasConfiguredAccounts, setHasConfiguredAccounts] = useState(false)
  const [showScanInvitationCode, setShowScanInvitationCode] = useState(false)
  const [showLicenseImport, setShowLicenseImport] = useState(false)
  const { openDialog } = useDialog()

  // Check whether a license file already exists; if not, show ImportLicenseScreen
  // before letting the user proceed to profile creation.
  const handleNextStep = useCallback(async () => {
    try {
      const hasLicense = await runtime.hasLicenseFile()
      if (hasLicense) {
        setShowScanInvitationCode(true)
      } else {
        setShowLicenseImport(true)
      }
    } catch {
      // If the check fails (e.g. browser runtime), fall through to profile creation.
      setShowScanInvitationCode(true)
    }
  }, [])

  useLayoutEffect(() => {
    // On a fresh DC start we will not have any yet.
    const checkAccounts = async () => {
      const accounts = await getConfiguredAccounts()
      if (accounts.length > 0) {
        setHasConfiguredAccounts(true)
      }
    }

    checkAccounts()
  }, [])

  /**
   * cancel the account creation process and call
   * onExitWelcomeScreen
   */
  const onClose = async () => {
    try {
      const acInfo = await BackendRemote.rpc.getAccountInfo(selectedAccountId)
      if (acInfo.kind === 'Unconfigured') {
        await props.onUnSelectAccount()
        await EffectfulBackendActions.removeAccount(selectedAccountId)
      }
      props.onExitWelcomeScreen()
    } catch (error) {
      openDialog(AlertDialog, {
        message: unknownErrorToString(error),
        cb: () => {},
      })
    }
  }

  return (
    <ImageBackdrop variant='welcome'>
      <Dialog
        fixed
        width={400}
        canEscapeKeyClose={hasConfiguredAccounts}
        backdropDragAreaOnTauriRuntime
        canOutsideClickClose={false}
        onClose={onClose}
        dataTestid='onboarding-dialog'
      >
        {!showInstantOnboarding ? (
          showLicenseImport ? (
            <ImportLicenseScreen
              onBack={() => setShowLicenseImport(false)}
              onDone={() => {
                setShowLicenseImport(false)
                startInstantOnboardingFlow()
              }}
            />
          ) : showScanInvitationCode ? (
            <ScanInvitationCodeScreen
              selectedAccountId={selectedAccountId}
              onBack={() => setShowScanInvitationCode(false)}
              onScanDone={() => setShowScanInvitationCode(false)}
              onLicenseDone={() => {
                setShowScanInvitationCode(false)
                startInstantOnboardingFlow()
              }}
            />
          ) : (
            <OnboardingScreen
              onNextStep={handleNextStep}
              selectedAccountId={selectedAccountId}
              hasConfiguredAccounts={hasConfiguredAccounts}
              onClose={onClose}
              {...props}
            />
          )
        ) : (
          <InstantOnboardingScreen
            selectedAccountId={selectedAccountId}
            onCancel={() => resetInstantOnboarding()}
          />
        )}
      </Dialog>
    </ImageBackdrop>
  )
}
