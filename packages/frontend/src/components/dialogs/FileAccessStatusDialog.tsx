import React, { useEffect, useMemo, useState } from 'react'
import { DialogBody, DialogContent, DialogWithHeader } from '../Dialog'
import useTranslationFunction from '../../hooks/useTranslationFunction'
import { avatarInitial } from '../Avatar'
import { basename } from 'path'
import type { DialogProps } from '../../contexts/DialogContext'
import classNames from 'classnames'
import useDialog from '../../hooks/dialog/useDialog'
import { selectedAccountId } from '../../ScreenController'
import { BackendRemote } from '../../backend-com'
import { T } from '@privitty/jsonrpc-client'
import SmallSelectDialogPrivitty, {
  SelectedValue,
} from '../SmallSelectDialogPrivitty'
import Icon from '../Icon'
import {
  buildFileAccessSections,
  canRevokeAccess,
  getFileAccessStatusDisplayText,
  isAccessBlockedForPermissions,
  isAccessPermanentlyBlocked,
  isAccessRequestedStatus,
  shouldShowYouBadge,
  type FileAccessRequestee,
} from '../../utils/fileAccessRequestees'
import { privittyStore } from '../../privitty/privittyStore'

import styles from './FileAccessStatusDialog.module.scss'

interface FileAccessStatusDialogProps extends DialogProps {
  chatId: number
  msgId: number
  filePath: string
  fileName?: string
  /** Mirrors Android `isPeer2Mode` — true for incoming messages. */
  isPeer2Mode?: boolean
}

export default function FileAccessStatusDialog({
  chatId,
  msgId,
  filePath,
  fileName,
  isPeer2Mode: isPeer2ModeProp,
  onClose,
}: FileAccessStatusDialogProps) {
  const tx = useTranslationFunction()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ownerList, setOwnerList] = useState<FileAccessRequestee[]>([])
  const [sharedList, setSharedList] = useState<FileAccessRequestee[]>([])
  const [forwardedList, setForwardedList] = useState<FileAccessRequestee[]>([])
  const [displayFileName, setDisplayFileName] = useState<string>('')
  const [isPeer2Mode, setIsPeer2Mode] = useState(Boolean(isPeer2ModeProp))
  const [selfAccountAddr, setSelfAccountAddr] = useState<string | null>(null)
  const { openDialog, closeAllDialogs } = useDialog()
  const [searchQuery, setSearchQuery] = useState('')
  const accountId = selectedAccountId()

  const notifyBubbleRefresh = () => {
    privittyStore.notifyFileAccessChanged({
      chatId,
      msgId,
      filePath: filePath.replace(/\\/g, '/'),
    })
  }

  const fetchFileAccessStatus = async () => {
    try {
      setLoading(true)
      setError(null)

      const sections = await buildFileAccessSections(
        accountId,
        chatId,
        msgId,
        fileName
      )

      setOwnerList(sections.ownerList)
      setSharedList(sections.sharedList)
      setForwardedList(sections.forwardedList)
      setDisplayFileName(sections.displayFileName)
      setSelfAccountAddr(sections.selfAccountAddr)
      setIsPeer2Mode(
        isPeer2ModeProp !== undefined ? isPeer2ModeProp : sections.isPeer2Mode
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to fetch file access status'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFileAccessStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgId, chatId, filePath, isPeer2ModeProp])

  function RevokeConfirmationDialog({
    userName,
    onConfirm,
    onClose: onDialogClose,
  }: {
    userName: string
    onConfirm: () => void
    onClose: () => void
  }) {
    return (
      <DialogWithHeader title='Revoke?' onClose={onDialogClose}>
        <DialogBody>
          <DialogContent>
            <p style={{ marginBottom: 24 }}>
              Are you sure you want to revoke access for{' '}
              <strong>{userName}</strong>?
            </p>
            <div
              style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}
            >
              <button
                onClick={onDialogClose}
                style={{
                  fontSize: '18px',
                  fontWeight: '400',
                  padding: '14px 22px',
                  borderRadius: '12px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                style={{
                  fontSize: '18px',
                  fontWeight: '400',
                  backgroundColor: '#f26861',
                  color: '#fff',
                  padding: '14px 22px',
                  borderRadius: '12px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Revoke
              </button>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogWithHeader>
    )
  }

  function AccessRequestDialog({
    onAccept,
    onDenied,
    onClose: onDialogClose,
  }: {
    onAccept: () => void
    onDenied: () => void
    onClose: () => void
  }) {
    return (
      <DialogWithHeader title='File Access Request' onClose={onDialogClose}>
        <DialogBody>
          <DialogContent>
            <p style={{ marginBottom: 20 }}>
              Do you want to allow access for this file?
            </p>
            <div
              style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}
            >
              <button
                onClick={onDenied}
                style={{
                  fontSize: '18px',
                  fontWeight: '400',
                  padding: '14px 22px',
                  borderRadius: '12px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Denied
              </button>
              <button
                onClick={onAccept}
                style={{
                  fontSize: '18px',
                  fontWeight: '400',
                  backgroundColor: '#6750A4',
                  color: '#fff',
                  padding: '14px 22px',
                  borderRadius: '12px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Accept
              </button>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogWithHeader>
    )
  }

  const performRevokeAccess = async (contactEmail: string) => {
    try {
      const fileId: T.I64 = await (
        BackendRemote.rpc as any
      ).privittyGetFileIdByPath(accountId, filePath.replace(/\\/g, '/'))
      const peerContactId: number = await (
        BackendRemote.rpc as any
      ).privittyGetContactIdByAddr(accountId, contactEmail)
      await (BackendRemote.rpc as any).privittyRevokeFileAccess(
        accountId,
        chatId,
        fileId,
        peerContactId
      )
      await fetchFileAccessStatus()
      notifyBubbleRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke access')
    }
  }

  const handleRevokeClick = (
    requestee: FileAccessRequestee,
    displayName: string
  ) => {
    openDialog(RevokeConfirmationDialog, {
      userName: displayName,
      onConfirm: async () => {
        closeAllDialogs()
        await performRevokeAccess(requestee.contactId)
      },
      onClose: () => closeAllDialogs(),
    })
  }

  const handleLockClick = async (requestee: FileAccessRequestee) => {
    openDialog(AccessRequestDialog, {
      onAccept: async () => {
        closeAllDialogs()

        await openDialog(SmallSelectDialogPrivitty, {
          title: 'File Attributes',
          showAllowForward: !requestee.isForwarded,
          initialSelectedValue: {
            allowDownload: false,
            allowForward: false,
            allowedTime: '86400',
          },
          onSave: async (selectedValue: SelectedValue) => {
            try {
              const fileId: T.I64 = await (
                BackendRemote.rpc as any
              ).privittyGetFileIdByPath(
                accountId,
                filePath.replace(/\\/g, '/')
              )
              const peerContactId: number = await (
                BackendRemote.rpc as any
              ).privittyGetContactIdByAddr(accountId, requestee.contactId)
              const accessDurationSecs = Number(selectedValue.allowedTime)

              if (requestee.isForwarded) {
                await (BackendRemote.rpc as any).privittyInitForwardGrant(
                  accountId,
                  chatId,
                  fileId,
                  peerContactId,
                  selectedValue.allowDownload,
                  selectedValue.allowForward,
                  accessDurationSecs
                )
              } else {
                await (BackendRemote.rpc as any).privittySendFileAccess(
                  accountId,
                  chatId,
                  fileId,
                  peerContactId,
                  selectedValue.allowDownload,
                  selectedValue.allowForward,
                  accessDurationSecs
                )
              }

              await fetchFileAccessStatus()
              notifyBubbleRefresh()
            } catch (err) {
              console.error('Failed to accept access:', err)
            }
          },
          onClose: () => closeAllDialogs(),
        })
      },
      onDenied: async () => {
        closeAllDialogs()
        try {
          const fileId: T.I64 = await (
            BackendRemote.rpc as any
          ).privittyGetFileIdByPath(accountId, filePath.replace(/\\/g, '/'))
          const peerContactId: number = await (
            BackendRemote.rpc as any
          ).privittyGetContactIdByAddr(accountId, requestee.contactId)

          if (requestee.isForwarded) {
            await (BackendRemote.rpc as any).privittyInitForwardDenied(
              accountId,
              chatId,
              fileId,
              peerContactId
            )
          } else {
            await (BackendRemote.rpc as any).privittyDenyFileAccess(
              accountId,
              chatId,
              fileId,
              peerContactId
            )
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to deny access')
        } finally {
          await fetchFileAccessStatus()
          notifyBubbleRefresh()
        }
      },
      onClose: () => closeAllDialogs(),
    })
  }

  const getDisplayFileName = (): string => {
    let rawName = 'File'
    if (typeof displayFileName === 'string' && displayFileName.trim()) {
      rawName = displayFileName
    } else if (typeof fileName === 'string' && fileName.trim()) {
      rawName = fileName
    } else if (filePath) {
      rawName = basename(filePath)
    }
    return rawName.replace(/\.prv$/, '')
  }

  const getStatusIcon = (status?: string | null): React.ReactNode => {
    const normalized = (status ?? '').trim().toLowerCase()
    switch (normalized) {
      case 'expired':
        return (
          <Icon icon='error' size={16} className={styles.statusIcon} aria-hidden />
        )
      case 'denied':
        return (
          <Icon icon='error' size={16} className={styles.statusIcon} aria-hidden />
        )
      case 'requested':
      case 'waiting_owner_action':
      case 'waiting_for_owner_action':
        return (
          <Icon
            icon='loading'
            size={16}
            className={styles.statusIcon}
            aria-hidden
          />
        )
      case 'revoked':
        return (
          <Icon
            icon='blocked'
            size={16}
            className={styles.statusIcon}
            aria-hidden
          />
        )
      default:
        return null
    }
  }

  const getRelayStatusLabel = (status?: string | null): string | null => {
    const normalized = (status ?? '').trim().toLowerCase()
    if (normalized === 'relay_to_owner') {
      return 'Forwardee Requested Access'
    }
    if (normalized === 'relay_to_recipient' || normalized === 'relay_to_recepient') {
      return 'Owner Responded'
    }
    return null
  }

  const UserRow = ({ requestee }: { requestee: FileAccessRequestee }) => {
    const displayName = requestee.name || requestee.contactId || 'Unknown'
    const initial = avatarInitial(displayName, requestee.contactId)
    const showYou = shouldShowYouBadge(
      requestee,
      isPeer2Mode,
      selfAccountAddr
    )
    const isOwnerRow = requestee.isOwner && !requestee.isForwarded
    const statusDisplayText = getFileAccessStatusDisplayText(
      requestee.status,
      requestee.expiryTime
    )
    const relayLabel =
      isPeer2Mode && requestee.isForwarded
        ? getRelayStatusLabel(requestee.status)
        : null

    const hideForwardedRequestStatus =
      isPeer2Mode &&
      requestee.isForwarded &&
      (isAccessRequestedStatus(requestee.status) ||
        statusDisplayText === 'Access Requested')

    const accessBlocked = isAccessBlockedForPermissions(requestee.status)
    const allowDownload =
      !accessBlocked && requestee.allowDownload === true
    const allowForward =
      !accessBlocked && requestee.allowForward === true

    const requiresOwnerAction =
      !isPeer2Mode &&
      !isAccessPermanentlyBlocked(requestee.status) &&
      isAccessRequestedStatus(requestee.status)

    const showRevoke =
      !isPeer2Mode && canRevokeAccess(requestee.status)

    return (
      <div className={classNames(styles.userRow, requestee.status?.toLowerCase() === 'revoked' && styles.revoked)}>
        <div className={styles.userMain}>
          <div className={styles.avatar}>{initial}</div>
          <div className={styles.userInfo}>
            <div className={styles.userNameRow}>
              <div className={styles.userName}>{displayName}</div>
              {showYou && <span className={styles.youSuffix}>(You)</span>}
            </div>

            {relayLabel && (
              <div className={styles.relayLabel}>{relayLabel}</div>
            )}

            {!isOwnerRow && !hideForwardedRequestStatus && (
              <div className={styles.accessRow}>
                <Icon
                  icon='schedule'
                  size={16}
                  className={styles.accessClockIcon}
                  aria-hidden
                />
                <span className={styles.accessUntil}>{statusDisplayText}</span>

                <div className={styles.permissionIcons}>
                  {!requestee.isForwarded && (
                    <Icon
                      icon='forward'
                      size={16}
                      className={classNames(
                        styles.permissionIcon,
                        !allowForward && styles.permissionIconDisabled
                      )}
                      aria-label={
                        allowForward
                          ? 'Forward allowed'
                          : 'Forward not allowed'
                      }
                    />
                  )}
                  <Icon
                    icon='download'
                    size={16}
                    className={classNames(
                      styles.permissionIcon,
                      !allowDownload && styles.permissionIconDisabled
                    )}
                    aria-label={
                      allowDownload
                        ? 'Download allowed'
                        : 'Download not allowed'
                    }
                  />
                </div>

                <div className={styles.statusIcons}>
                  {getStatusIcon(requestee.status)}
                </div>
              </div>
            )}
          </div>
        </div>

        {!isOwnerRow && !isPeer2Mode && (
          <div className={styles.rowActions}>
            {requiresOwnerAction && (
              <button
                type='button'
                className={styles.actionButton}
                aria-label='Grant access'
                onClick={() => handleLockClick(requestee)}
              >
                <Icon icon='lock' size={18} />
              </button>
            )}
            {showRevoke && (
              <button
                type='button'
                className={styles.actionButton}
                aria-label='Revoke'
                onClick={() => handleRevokeClick(requestee, displayName)}
              >
                <Icon icon='blocked' size={18} />
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const showSearch = forwardedList.length > 10

  const filteredForwardedUsers = useMemo(() => {
    if (!normalizedQuery) return forwardedList
    return forwardedList.filter(r =>
      r.name.toLowerCase().includes(normalizedQuery)
    )
  }, [normalizedQuery, forwardedList])

  const hasAnyRows =
    ownerList.length > 0 ||
    sharedList.length > 0 ||
    filteredForwardedUsers.length > 0

  return (
    <DialogWithHeader
      title='Access Control'
      onClose={onClose}
      className={styles.largeDialog}
      width={740}
    >
      <DialogBody>
        <DialogContent>
          <div className={styles.fileRow}>
            <Icon icon='file' size={18} className={styles.fileIcon} />
            <div className={styles.fileName}>{getDisplayFileName()}</div>
          </div>

          {showSearch && (
            <div className={styles.searchRow}>
              <div className={styles.searchInputWrap}>
                <Icon icon='search' size={18} className={styles.searchIcon} />
                <input
                  className={styles.searchInput}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder='Search forwarded users...'
                  aria-label='Search forwarded users'
                />
              </div>
            </div>
          )}

          {loading && (
            <div className={styles.centerMessage}>{tx('loading') || 'Loading...'}</div>
          )}
          {error && <div className={styles.errorMessage}>{error}</div>}

          {!loading && !error && (
            <div className={styles.sections}>
              {ownerList.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Owner</div>
                  <div className={styles.sectionList}>
                    {ownerList.map((requestee, index) => (
                      <UserRow key={`owner-${index}`} requestee={requestee} />
                    ))}
                  </div>
                </div>
              )}

              {sharedList.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Shared</div>
                  <div className={styles.sectionList}>
                    {sharedList.map((requestee, index) => (
                      <UserRow key={`shared-${index}`} requestee={requestee} />
                    ))}
                  </div>
                </div>
              )}

              {filteredForwardedUsers.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Forwarded</div>
                  <div className={styles.sectionList}>
                    {filteredForwardedUsers.map((requestee, index) => (
                      <UserRow
                        key={`forwarded-${index}`}
                        requestee={requestee}
                      />
                    ))}
                  </div>
                </div>
              )}

              {!hasAnyRows && (
                <div className={styles.emptyState}>
                  No access data available
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </DialogBody>
    </DialogWithHeader>
  )
}
