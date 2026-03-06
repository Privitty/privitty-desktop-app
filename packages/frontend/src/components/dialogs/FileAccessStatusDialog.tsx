import React, { useEffect, useState } from 'react'
import { runtime } from '@deltachat-desktop/runtime-interface'
import { DialogBody, DialogContent, DialogWithHeader } from '../Dialog'
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

interface FileAccessUser {
  email: string
  name?: string
  role: 'Owner' | 'Relay' | 'Forwardee'
  status: string
  expiry?: string | number | null
  timestamp?: string | number | null
  permissions?: string[]
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
  const [, setDisplayFileName] = useState<string>('')
  const { openDialog, closeAllDialogs } = useDialog()
  const [isOwner, setIsOwner] = useState<boolean>(false)
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
          expiry: s.expiry_time || null,
          timestamp: s.timestamp || null,
          permissions: [],
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
            permissions: [],
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

    if (typeof fileName === 'string' && fileName.trim()) {
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
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid #e0e0e0',
          backgroundColor: 'transparent',
          opacity: isRevoked ? 0.6 : 1,
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            backgroundColor: '#4a4a4a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            fontWeight: '500',
            marginRight: '12px',
            flexShrink: 0,
          }}
        >
          {initial}
        </div>

        {/* User info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '15px',
              fontWeight: '500',
              marginBottom: '4px',
            }}
          >
            {displayName}
          </div>
          {(timestamp || statusLabel) && (
            <div
              style={{
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span style={{ fontSize: '12px' }}>🕐</span>
              {statusLabel || timestamp}
            </div>
          )}
          {isRevoked && (
            <div
              style={{ fontSize: '12px', color: '#D93229', marginTop: '2px' }}
            >
              Access revoked
            </div>
          )}
        </div>

        {/* Action buttons — only shown to the file owner */}
        {showActions && isOwner && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexShrink: 0,
            }}
          >
            {/* Revoke button — shown for non-revoked users */}
            {onRevokeClick && !isRevoked && (
              <button
                title='Revoke access'
                onClick={() => onRevokeClick(user.email, displayName)}
                style={{
                  width: '32px',
                  height: '32px',
                  border: 'none',
                  borderRadius: '4px',
                  backgroundColor: '#6750A4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  cursor: 'pointer',
                }}
              >
                <div
                  aria-label='Blocked'
                  aria-hidden={true}
                  className={classNames('privitty-blocked-icon')}
                />
              </button>
            )}
            {/* Lock button — shown for pending access requests */}
            {showLockButton && onLockClick && (
              <button
                title='Review access request'
                onClick={() => onLockClick(user.email)}
                style={{
                  width: '32px',
                  height: '32px',
                  border: 'none',
                  borderRadius: '4px',
                  backgroundColor: '#6750A4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  cursor: 'pointer',
                }}
              >
                <div
                  aria-label='Lock'
                  aria-hidden={true}
                  className={classNames('privitty-lock-icon')}
                />
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <DialogWithHeader title='Access Control' onClose={onClose}>
      <DialogBody>
        <DialogContent>
          {/* File name */}
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid #e0e0e0',
              backgroundColor: 'transparent',
            }}
          >
            <div style={{ fontSize: '15px', fontWeight: '500' }}>
              {getDisplayFileName()}
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
            <div style={{ backgroundColor: 'transparent' }}>
              {/* Shared section */}
              {sharedUsers.length > 0 && (
                <div>
                  <div
                    style={{
                      padding: '12px 20px',
                      fontSize: '14px',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderBottom: '1px solid #e0e0e0',
                      backgroundColor: 'transparent',
                    }}
                  >
                    Shared
                  </div>
                  <div style={{ backgroundColor: 'transparent' }}>
                    {sharedUsers.map((user, index) => (
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
              {forwardedUsers.length > 0 && (
                <div>
                  <div
                    style={{
                      padding: '12px 20px',
                      fontSize: '14px',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderTop:
                        sharedUsers.length > 0 ? '1px solid #e0e0e0' : 'none',
                      borderBottom: '1px solid #e0e0e0',
                      backgroundColor: 'transparent',
                    }}
                  >
                    Forwarded
                  </div>
                  <div style={{ backgroundColor: 'transparent' }}>
                    {forwardedUsers.map((user, index) => (
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

              {sharedUsers.length === 0 && forwardedUsers.length === 0 && (
                <div
                  style={{
                    padding: '40px 20px',
                    textAlign: 'center',
                  }}
                >
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
