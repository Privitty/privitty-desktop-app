import React, { useEffect, useMemo, useState } from 'react'
import { runtime } from '@deltachat-desktop/runtime-interface'
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogWithHeader,
  FooterActionButton,
  FooterActions,
} from '../Dialog'
import useTranslationFunction from '../../hooks/useTranslationFunction'
import { avatarInitial } from '../Avatar'
import { basename } from 'path'
import type { DialogProps } from '../../contexts/DialogContext'
import classNames from 'classnames'
import useDialog from '../../hooks/dialog/useDialog'
import { selectedAccountId } from '../../ScreenController'
import { BackendRemote } from '../../backend-com'
import { T } from '@deltachat/jsonrpc-client'
import SmallSelectDialogPrivitty, {
  SelectedValue,
} from '../SmallSelectDialogPrivitty'
import Icon from '../Icon'

import styles from './FileAccessStatusDialog.module.scss'

interface FileAccessUser {
  email: string
  name?: string
  role: 'Owner' | 'Relay' | 'Forwardee'
  status: string
  expiry?: string | number | null
  timestamp?: string | number | null
  allowDownload?: boolean
  allowForward?: boolean
}

interface FileAccessStatusDialogProps extends DialogProps {
  chatId: number
  filePath: string
  fileName?: string
}

// ---------------------------------------------------------------------------
// Helper: extract PDU from a privitty-server response and send it as a
// DeltaChat text message. Mirrors Android's pattern of calling sendMsg with
// the PDU string after every access-control API call.
// ---------------------------------------------------------------------------
async function sendPdu(
  pdu: string,
  accountId: number,
  chatId: number
): Promise<void> {
  const MESSAGE_DEFAULT: T.MessageData = {
    file: null,
    filename: null,
    viewtype: null,
    html: null,
    location: null,
    overrideSenderName: null,
    quotedMessageId: null,
    quotedText: null,
    text: null,
  }
  await BackendRemote.rpc.sendMsg(accountId, chatId, {
    ...MESSAGE_DEFAULT,
    text: pdu,
    viewtype: 'Text',
  })
}

export default function FileAccessStatusDialog({
  chatId,
  filePath,
  fileName,
  onClose,
}: FileAccessStatusDialogProps) {
  const tx = useTranslationFunction()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sharedUsers, setSharedUsers] = useState<FileAccessUser[]>([])
  const [forwardedUsers, setForwardedUsers] = useState<FileAccessUser[]>([])
  const [ownerUser, setOwnerUser] = useState<FileAccessUser | null>(null)
  const [displayFileName, setDisplayFileName] = useState<string>('')
  const { openDialog, closeAllDialogs } = useDialog()
  const [isOwner, setIsOwner] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState('')
  const accountId = selectedAccountId()

  const isAccessRequested = (status?: string) => {
    if (!status) return false
    return ['requested', 'relay_to_owner', 'waiting_owner_action'].includes(
      status.toLowerCase()
    )
  }

  const fetchFileAccessStatus = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await runtime.PrivittySendMessage('sendEvent', {
        event_type: 'getFileAccessStatusList',
        event_data: {
          chat_id: String(chatId),
          file_path: filePath,
        },
      })

      const parsed =
        typeof response === 'string' ? JSON.parse(response) : response
      let result = parsed?.result

      if (typeof result === 'string') {
        try {
          result = JSON.parse(result)
        } catch {
          /* keep original */
        }
      }

      const data = result?.data
      const fileData = data?.file

      // Owner info
      if (fileData?.owner_info) {
        const o = fileData.owner_info
        setOwnerUser({
          email: o.contact_id || '',
          name: o.contact_name,
          role: 'Owner',
          status: 'active',
          expiry: o.expiry_time ?? null,
          timestamp: o.timestamp ?? null,
          allowDownload: Boolean(
            o.download_allowed ?? o.allow_download ?? true
          ),
          allowForward: Boolean(o.forward_allowed ?? o.allow_forward ?? true),
        })
      }

      if (!data)
        throw new Error('Invalid response from getFileAccessStatusList')

      const shared: FileAccessUser[] = []
      if (fileData?.shared_info) {
        const s = fileData.shared_info
        shared.push({
          email: s.contact_id || '',
          name: s.contact_name,
          role: 'Relay',
          status: s.status || 'active',
          expiry: s.expiry_time ?? null,
          timestamp: s.timestamp ?? null,
          allowDownload: Boolean(
            s.download_allowed ?? s.allow_download ?? s.allowDownload ?? false
          ),
          allowForward: Boolean(
            s.forward_allowed ?? s.allow_forward ?? s.allowForward ?? false
          ),
        })
      }

      const forwarded: FileAccessUser[] = []
      const forwardedList =
        fileData?.forwarded_list ?? data?.forwarded_list ?? []
      if (Array.isArray(forwardedList)) {
        forwardedList.forEach((u: any) => {
          forwarded.push({
            email: u.contact_id || '',
            name: u.contact_name,
            role: 'Forwardee',
            status: u.status || 'active',
            expiry: u.expiry_time ?? null,
            timestamp: u.timestamp ?? null,
            allowDownload: Boolean(
              u.download_allowed ?? u.allow_download ?? u.allowDownload ?? false
            ),
            allowForward: Boolean(
              u.forward_allowed ?? u.allow_forward ?? u.allowForward ?? false
            ),
          })
        })
      }

      setSharedUsers(shared)
      setForwardedUsers(forwarded)

      if (data.file_name) {
        setDisplayFileName(data.file_name)
      } else if (fileName) {
        setDisplayFileName(fileName)
      } else if (filePath) {
        setDisplayFileName(basename(filePath))
      }

      try {
        const accountInfo = await BackendRemote.rpc.getAccountInfo(accountId)
        const currentEmail =
          accountInfo.kind === 'Configured' ? accountInfo.addr : null
        const ownerEmail = fileData?.owner_info?.contact_id || null
        setIsOwner(
          !!(
            currentEmail &&
            ownerEmail &&
            currentEmail.toLowerCase() === ownerEmail.toLowerCase()
          )
        )
      } catch {
        setIsOwner(false)
      }
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
  }, [chatId, filePath])

  // ---------------------------------------------------------------------------
  // Confirmation dialog shown before revoking access — mirrors Android's
  // showRevokeConfirmationDialog() in FileAccessControlActivity.
  // ---------------------------------------------------------------------------
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
      <DialogWithHeader title='Revoke access?' onClose={onDialogClose}>
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
                Revoke Access
              </button>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogWithHeader>
    )
  }

  // Confirmation dialog for accept / deny access requests.
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

  // ---------------------------------------------------------------------------
  // performRevokeAccess — mirrors Android's performRevokeAccess().
  // Called after the user confirms the revoke dialog.
  // ---------------------------------------------------------------------------
  const performRevokeAccess = async (contactId: string) => {
    try {
      const response = await runtime.PrivittySendMessage('sendEvent', {
        event_type: 'initAccessRevokeRequest',
        event_data: {
          chat_id: String(chatId),
          file_path: filePath,
          contact_id: contactId,
        },
      })

      const parsed = JSON.parse(response)
      const pdu = parsed?.result?.data?.pdu

      if (pdu) {
        await sendPdu(pdu, accountId, chatId)
      }

      // Optimistically mark the user as revoked in the local list, then
      // reload the full data — same as Android's adapter.updateRequesteeStatus
      // + loadAccessData().
      const markRevoked = (users: FileAccessUser[]) =>
        users.map(u =>
          u.email === contactId ? { ...u, status: 'revoked' } : u
        )
      setSharedUsers(prev => markRevoked(prev))
      setForwardedUsers(prev => markRevoked(prev))
      await fetchFileAccessStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke access')
    }
  }

  // Show the revoke confirmation dialog — mirrors Android's handleRevokeClick()
  // → showRevokeConfirmationDialog().
  const handleRevokeClick = (contactId: string, displayName: string) => {
    openDialog(RevokeConfirmationDialog, {
      userName: displayName,
      onConfirm: async () => {
        closeAllDialogs()
        await performRevokeAccess(contactId)
      },
      onClose: () => closeAllDialogs(),
    })
  }

  // Handle accept / deny for pending access requests.
  const handleLockClick = async (
    contactId: string,
    role: 'Relay' | 'Forwardee'
  ) => {
    openDialog(AccessRequestDialog, {
      onAccept: async () => {
        closeAllDialogs()

        await openDialog(SmallSelectDialogPrivitty, {
          title: 'File Attributes',
          showAllowForward: false,
          initialSelectedValue: {
            allowDownload: false,
            allowForward: false,
            allowedTime: '86400',
          },
          onSave: async (selectedValue: SelectedValue) => {
            try {
              const eventType =
                role === 'Forwardee'
                  ? 'initRevertRelayForwardAccessAccept'
                  : 'initAccessGrantAccept'

              const response = await runtime.PrivittySendMessage('sendEvent', {
                event_type: eventType,
                event_data: {
                  chat_id: String(chatId),
                  file_path: filePath,
                  contact_id: contactId,
                  access_duration: Number(selectedValue.allowedTime),
                  allow_download: selectedValue.allowDownload,
                  allow_forward: selectedValue.allowForward,
                },
              })

              const parsed = JSON.parse(response).result?.data?.pdu

              if (parsed) {
                const MESSAGE_DEFAULT: T.MessageData = {
                  file: null,
                  filename: null,
                  viewtype: null,
                  html: null,
                  location: null,
                  overrideSenderName: null,
                  quotedMessageId: null,
                  quotedText: null,
                  text: null,
                }

                const message: Partial<T.MessageData> = {
                  text: parsed,
                  viewtype: 'Text',
                }

                await BackendRemote.rpc.sendMsg(accountId, chatId || 0, {
                  ...MESSAGE_DEFAULT,
                  ...message,
                })
              }

              await fetchFileAccessStatus()
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
          const eventType =
            role === 'Forwardee'
              ? 'initRevertRelayForwardAccessDenied'
              : 'initAccessDenied'
          const response = await runtime.PrivittySendMessage('sendEvent', {
            event_type: eventType,
            event_data: {
              chat_id: String(chatId),
              file_path: filePath,
              contact_id: contactId,
              denial_reason: 'File access not authorized',
            },
          })
          const pdu = JSON.parse(response)?.result?.data?.pdu
          if (pdu) await sendPdu(pdu, accountId, chatId)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to deny access')
        } finally {
          await fetchFileAccessStatus()
        }
      },
      onClose: () => closeAllDialogs(),
    })
  }

  const formatTimestamp = (
    timestamp: string | number | null | undefined
  ): string => {
    if (!timestamp) return ''
    const date =
      typeof timestamp === 'string'
        ? new Date(timestamp)
        : new Date(timestamp * 1000)
    if (isNaN(date.getTime())) return ''
    const month = date.toLocaleDateString('en-US', { month: 'short' })
    const day = date.getDate()
    const year = date.getFullYear()
    const hours = date.getHours()
    const minutes = date.getMinutes().toString().padStart(2, '0')
    return `${month} ${day}, ${year} ${hours}:${minutes}`
  }

  // API sends expiry_time in milliseconds (13 digits); support seconds too
  const parseExpiryDate = (
    expiry: string | number | null | undefined
  ): Date | null => {
    if (expiry == null) return null
    const ms =
      typeof expiry === 'string'
        ? new Date(expiry).getTime()
        : typeof expiry === 'number' && expiry > 1e12
          ? expiry
          : Number(expiry) * 1000
    const date = new Date(ms)
    return isNaN(date.getTime()) ? null : date
  }

  const formatExpiryWithRelative = (
    expiry: string | number | null | undefined,
    status?: string
  ): { text: string; isExpired: boolean; isRelative: boolean } => {
    if (status?.toLowerCase() === 'expired') {
      return { text: 'Expired', isExpired: true, isRelative: false }
    }
    const date = parseExpiryDate(expiry)
    if (!date) return { text: 'Never', isExpired: false, isRelative: false }
    const now = Date.now()
    const msLeft = date.getTime() - now
    if (msLeft <= 0) {
      return { text: 'Expired', isExpired: true, isRelative: false }
    }
    const hours = Math.floor(msLeft / (1000 * 60 * 60))
    const minutes = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60))
    if (hours >= 24) {
      const month = date.toLocaleDateString('en-US', { month: 'short' })
      const day = date.getDate()
      const year = date.getFullYear()
      return {
        text: `${month} ${day}, ${year}`,
        isExpired: false,
        isRelative: false,
      }
    }
    if (hours > 0) {
      return {
        text: `${hours}h ${minutes}m`,
        isExpired: false,
        isRelative: true,
      }
    }
    return {
      text: `${minutes}m`,
      isExpired: false,
      isRelative: true,
    }
  }

  const formatStatus = (status: string): string => {
    const statusMap: Record<string, string> = {
      active: 'Active',
      expired: 'Expired',
      revoked: 'Revoked',
      requested: 'Access Requested',
      relay_to_owner: 'Access Requested',
      denied: 'Denied',
      waiting_owner_action: 'Waiting Owner Action',
    }
    return statusMap[status] || status
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

  const UserCard = ({
    user,
    showActions = false,
    showLockButton = false,
    onLockClick,
    onRevokeClick,
  }: {
    user: FileAccessUser
    showActions?: boolean
    showLockButton?: boolean
    onLockClick?: (contactId: string, role?: string) => void
    onRevokeClick?: (contactId: string, displayName: string) => void
  }) => {
    const displayName = user.name || user.email || 'Unknown'
    const initial = avatarInitial(displayName, user.email)
    const timestamp = user.timestamp ? formatTimestamp(user.timestamp) : null
    const statusLabel = isAccessRequested(user.status)
      ? formatStatus(user.status)
      : null
    const isRevoked = user.status.toLowerCase() === 'revoked'

    return (
      <div
        className={classNames(
          styles.userRow,
          isRevoked && styles.revoked,
          isOwner && user.role === 'Owner' && styles.highlightBorder,
          !isOwner && user.role === 'Relay' && styles.highlightBorder
        )}
      >
        {!isOwner && user.role === 'Relay' && (
    <span className={styles.youBadge}>You</span>
  )}
        <div className={styles.userMain}>
          <div className={styles.avatar}>{initial}</div>
          <div className={styles.userInfo}>
            <div className={styles.userName}>{displayName}</div>
            <div className={styles.userSub}>
              <span className={styles.userEmail}>{user.email}</span>
              {(timestamp || statusLabel) && (
                <span className={styles.userMeta}>
                  {statusLabel || timestamp}
                </span>
              )}
              {isRevoked && (
                <span className={styles.userRevokedText}>Access revoked</span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.userCols}>
          <div className={styles.col}>
            <div className={styles.colLabel}>DOWNLOAD</div>
            <div className={styles.yesNo}>
              {user.allowDownload ? (
                <>
                  <Icon
                    icon='active'
                    size={14}
                    className={styles.yesNoCheck}
                    aria-hidden
                  />
                  Yes
                </>
              ) : (
                'No'
              )}
            </div>
          </div>
          <div className={styles.col}>
            <div className={styles.colLabel}>FORWARD</div>
            <div className={styles.yesNo}>
              {user.allowForward ? (
                <>
                  <Icon
                    icon='active'
                    size={14}
                    className={styles.yesNoCheck}
                    aria-hidden
                  />
                  Yes
                </>
              ) : (
                'No'
              )}
            </div>
          </div>
          <div className={styles.col}>
            <div className={styles.colLabel}>EXPIRY</div>
            {(() => {
              const exp = formatExpiryWithRelative(user.expiry, user.status)
              return (
                <div
                  className={classNames(
                    styles.expiryValue,
                    exp.isExpired && styles.expiryExpired,
                    exp.isRelative && !exp.isExpired && styles.expirySoon
                  )}
                >
                  {(exp.isExpired || exp.isRelative) && (
                    <Icon
                      icon='info'
                      size={14}
                      className={styles.expiryClockIcon}
                      aria-hidden
                    />
                  )}
                  {exp.text}
                </div>
              )
            })()}
          </div>
        </div>

        <div className={styles.rowActions}>
          {showActions && isOwner && (
            <>
              {/* Show Revoke ONLY when Grant Access is NOT present */}
              {!showLockButton && onRevokeClick && !isRevoked && (
                <button
                  type='button'
                  className={styles.grantAccessLink}
                  title='Revoke access'
                  onClick={() => onRevokeClick(user.email, displayName)}
                >
                  Revoke Access
                </button>
              )}

              {/* Show Grant Access when access is requested */}
              {showLockButton && onLockClick && (
                <button
                  type='button'
                  className={styles.grantAccessLink}
                  title='Grant Access'
                  onClick={() => onLockClick(user.email)}
                >
                  Grant Access
                </button>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const filteredSharedUsers = useMemo(() => {
    if (!normalizedQuery) return sharedUsers
    return sharedUsers.filter(u => {
      const hay = `${u.name ?? ''} ${u.email ?? ''}`.toLowerCase()
      return hay.includes(normalizedQuery)
    })
  }, [normalizedQuery, sharedUsers])

  const filteredForwardedUsers = useMemo(() => {
    if (!normalizedQuery) return forwardedUsers
    return forwardedUsers.filter(u => {
      const hay = `${u.name ?? ''} ${u.email ?? ''}`.toLowerCase()
      return hay.includes(normalizedQuery)
    })
  }, [normalizedQuery, forwardedUsers])

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
          <div className={styles.searchRow}>
            <div className={styles.searchInputWrap}>
              <Icon icon='search' size={18} className={styles.searchIcon} />
              <input
                className={styles.searchInput}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder='Search people or groups...'
                aria-label='Search people or groups'
              />
            </div>
          </div>
          {loading && (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: '#666',
              }}
            >
              {tx('loading') || 'Loading...'}
            </div>
          )}
          {error && (
            <div
              style={{
                padding: '40px 20px',
                color: '#d32f2f',
                textAlign: 'center',
              }}
            >
              {error}
            </div>
          )}
          {!loading && !error && (
            <div className={styles.sections}>
              {/* Owner section */}
              {!isOwner && ownerUser && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Owner</div>
                  <div className={styles.sectionList}>
                    <UserCard user={ownerUser} showActions={false} />
                  </div>
                </div>
              )}
              {/* Shared section */}
              {filteredSharedUsers.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Shared</div>
                  <div className={styles.sectionList}>
                    {filteredSharedUsers.map((user, index) => (
                      <UserCard
                        key={`shared-${index}`}
                        user={user}
                        showActions={true}
                        showLockButton={isAccessRequested(user.status)}
                        onRevokeClick={handleRevokeClick}
                        onLockClick={contactId =>
                          handleLockClick(contactId, 'Relay')
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Forwarded section */}
              {filteredForwardedUsers.length > 0 && (
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Forwarded</div>
                  <div className={styles.sectionList}>
                    {filteredForwardedUsers.map((user, index) => (
                      <UserCard
                        key={`forwarded-${index}`}
                        user={user}
                        showActions={true}
                        showLockButton={isAccessRequested(user.status)}
                        onRevokeClick={handleRevokeClick}
                        onLockClick={contactId =>
                          handleLockClick(contactId, 'Forwardee')
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {filteredSharedUsers.length === 0 &&
                filteredForwardedUsers.length === 0 && (
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
