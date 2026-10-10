import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react'

import Dialog from '../../Dialog'
import ImageBackdrop from '../../ImageBackdrop'
import ConnectWatchtowerScreen from './ConnectWatchtowerScreen'
import InstantOnboardingScreen from './InstantOnboardingScreen'
import OnboardingScreen from './OnboardingScreen'
import ScanInvitationCodeScreen from './ScanInvitationCodeScreen'
import useInstantOnboarding from '../../../hooks/useInstantOnboarding'
import { getConfiguredAccounts } from '../../../backend/account'
import { BackendRemote, EffectfulBackendActions } from '../../../backend-com'
import useDialog from '../../../hooks/dialog/useDialog'
import AlertDialog from '../../dialogs/AlertDialog'
import { unknownErrorToString } from '../../helpers/unknownErrorToString'

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
  const [showWatchtower, setShowWatchtower] = useState(false)
  const [enrollLink, setEnrollLink] = useState<string | undefined>()
  const { openDialog } = useDialog()

  // Connect to Watchtower before the invite scan.
  const handleNextStep = useCallback(async () => {
    setShowWatchtower(true)
  }, [])

  useEffect(() => {
    const onEnroll = (event: Event) => {
      const link = (event as CustomEvent<{ link?: string }>).detail?.link
      setEnrollLink(link)
      setShowWatchtower(true)
    }
    window.addEventListener('watchtower-enroll', onEnroll)
    return () => window.removeEventListener('watchtower-enroll', onEnroll)
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
          showWatchtower ? (
            <ConnectWatchtowerScreen
              initialLink={enrollLink}
              onBack={() => setShowWatchtower(false)}
              onDone={() => {
                setShowWatchtower(false)
                setShowScanInvitationCode(true)
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
