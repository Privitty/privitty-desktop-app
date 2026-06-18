import React, {
  CSSProperties,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import reactStringReplace from 'react-string-replace'
import classNames from 'classnames'
import { C, T } from '@privitty/jsonrpc-client'
import { debounce } from 'debounce'

import MessageBody from './MessageBody'
import MessageMetaData, { isMediaWithoutText } from './MessageMetaData'
import {
  openForwardDialog,
  openMessageInfo,
  setQuoteInDraft,
  openMessageHTML,
  confirmDeleteMessage,
  downloadFullMessage,
  openWebxdc,
  enterEditMessageMode,
} from './messageFunctions'
import { getPrivittyFileTypeLabel } from '../../utils/privittyFileTypeLabel'
import Attachment from '../attachment/messageAttachment'
import { runtime } from '@deltachat-desktop/runtime-interface'
import { AvatarFromContact } from '../Avatar'
import { ConversationType } from './MessageList'
import { getDirection } from '../../utils/getDirection'
import { mapCoreMsgStatus2String } from '../helpers/MapMsgStatus'
import { ContextMenuItem } from '../ContextMenu'
import { onDCEvent, BackendRemote } from '../../backend-com'
import { selectedAccountId } from '../../ScreenController'
import { ProtectionEnabledDialog } from '../dialogs/ProtectionStatusDialog'
import FileAccessStatusDialog from '../dialogs/FileAccessStatusDialog'
import useDialog from '../../hooks/dialog/useDialog'
import useMessage from '../../hooks/chat/useMessage'
import useOpenViewProfileDialog from '../../hooks/dialog/useOpenViewProfileDialog'
import usePrivateReply from '../../hooks/chat/usePrivateReply'
import useTranslationFunction from '../../hooks/useTranslationFunction'
import useVideoChat from '../../hooks/useVideoChat'
import { useReactionsBar, showReactionsUi } from '../ReactionsBar'
import { ContextMenuContext } from '../../contexts/ContextMenuContext'
import Reactions from '../Reactions'
import ShortcutMenu from '../ShortcutMenu'
import InvalidUnencryptedMailDialog from '../dialogs/InvalidUnencryptedMail'
import Button from '../Button'
import VCardComponent from './VCard'
import Icon from '../Icon'

import styles from './styles.module.scss'

import type { OpenDialog } from '../../contexts/DialogContext'
import type { PrivateReply } from '../../hooks/chat/usePrivateReply'
import type { JumpToMessage } from '../../hooks/chat/useMessage'
import { mouseEventToPosition } from '../../utils/mouseEventToPosition'
import { useRovingTabindex } from '../../contexts/RovingTabindex'
import { privittyStore } from '../../privitty/privittyStore'

type PrivittyStatus =
  | 'active'
  | 'requested'
  | 'expired'
  | 'revoked'
  | 'deleted'
  | 'waiting_owner_action'
  | 'denied'
  | 'not_found'
  | 'none'
  | 'error'
  | undefined

interface CssWithAvatarColor extends CSSProperties {
  '--local-avatar-color': string
}

const Avatar = ({
  contact,
  onContactClick,
  tabIndex,
}: {
  contact: T.Contact
  onContactClick: (contact: T.Contact) => void
  tabIndex: -1 | 0
}) => {
  const { profileImage, color, displayName } = contact

  const onClick = () => onContactClick(contact)

  if (profileImage) {
    return (
      <button className='author-avatar' onClick={onClick} tabIndex={tabIndex}>
        <img alt={displayName} src={runtime.transformBlobURL(profileImage)} />
      </button>
    )
  } else {
    const codepoint = displayName && displayName.codePointAt(0)
    const initial = codepoint
      ? String.fromCodePoint(codepoint).toUpperCase()
      : '#'
    return (
      <button
        className='author-avatar default'
        aria-label={displayName}
        onClick={onClick}
        tabIndex={tabIndex}
      >
        <div
          style={{ '--local-avatar-color': color } as CssWithAvatarColor}
          className='label'
        >
          {initial}
        </div>
      </button>
    )
  }
}

const AuthorName = ({
  contact,
  onContactClick,
  overrideSenderName,
  tabIndex,
}: {
  contact: T.Contact
  onContactClick: (contact: T.Contact) => void
  overrideSenderName: string | null
  tabIndex: -1 | 0
}) => {
  const accountId = selectedAccountId()
  const { color, id } = contact
  const [displayName, setDisplayName] = useState<string>(contact.displayName)

  useEffect(() => {
    return onDCEvent(accountId, 'ContactsChanged', async ({ contactId }) => {
      if (contactId !== id) {
        return
      }

      const updatedContact = await BackendRemote.rpc.getContact(
        accountId,
        contactId
      )
      setDisplayName(updatedContact.displayName)
    })
  }, [accountId, id])

  return (
    <button
      key='author'
      className='author'
      style={{ color }}
      onClick={() => onContactClick(contact)}
      tabIndex={tabIndex}
    >
      {getAuthorName(displayName, overrideSenderName)}
    </button>
  )
}

const ForwardedTitle = ({
  contact,
  onContactClick,
  direction,
  conversationType,
  overrideSenderName,
  tabIndex,
  bellSlot,
}: {
  contact: T.Contact
  onContactClick: (contact: T.Contact) => void
  direction: 'incoming' | 'outgoing'
  conversationType: ConversationType
  overrideSenderName: string | null
  tabIndex: -1 | 0
  bellSlot?: React.ReactNode
}) => {
  const tx = useTranslationFunction()

  const { displayName, color } = contact

  const forwardedTextStyle: React.CSSProperties = {
    fontStyle: 'italic',
    fontWeight: 'normal',
    fontSize: '0.85em',
    opacity: 0.72,
  }

  if (conversationType.hasMultipleParticipants && direction !== 'outgoing') {
    // Group incoming: "Forwarded by Name" — keep left-aligned, italic
    return (
      <div
        className='forwarded-indicator'
        style={{ fontStyle: 'italic', fontWeight: 'normal', marginBottom: 6 }}
      >
        {reactStringReplace(tx('forwarded_by', '$$$'), '$$$', () => (
          <button
            className='forwarded-indicator-button'
            onClick={() => onContactClick(contact)}
            tabIndex={tabIndex}
            key='displayname'
            style={{ color: color, fontStyle: 'italic' }}
          >
            {overrideSenderName ? `~${overrideSenderName}` : displayName}
          </button>
        ))}
        {bellSlot}
      </div>
    )
  }

  // 1:1 or outgoing: "Forwarded Message" italic, right-aligned at the top corner
  return (
    <div
      className='forwarded-indicator'
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: 6,
        marginBottom: 6,
      }}
    >
      <span style={forwardedTextStyle}>{tx('forwarded_message')}</span>
      {bellSlot}
    </div>
  )
}

async function showFileForward(message: T.Message): Promise<boolean> {
  if (!message.file || !message.fileName) return true
  if (!message.fileName.toLowerCase().endsWith('.prv')) return true
  try {
    const accountId = selectedAccountId()
    const filePath = message.file.replace(/\\/g, '/')
    const fileId: T.I64 = await (
      BackendRemote.rpc as any
    ).privittyGetFileIdByPath(accountId, filePath)
    const displayStatus: T.PrivittyFileDisplayStatus | null = await (
      BackendRemote.rpc as any
    ).privittyGetFileDisplayStatus(accountId, fileId)
    return displayStatus?.allow_forward ?? false
  } catch (e) {
    console.error('showFileForward: failed to get file display status', e)
    return false
  }
}

function isPrvFile(message: Pick<T.Message, 'file' | 'fileName'>): boolean {
  return (
    message.fileName?.toLowerCase().endsWith('.prv') ||
    message.file?.toLowerCase().endsWith('.prv') ||
    false
  )
}

/**
 * Privitty-forwarded .prv files often arrive without DC's isForwarded flag.
 * Mirrors Android ConversationItem isPrvForwardedIncoming check.
 */
function isPrivittyForwardedPrvSync(message: T.Message): boolean {
  if (!isPrvFile(message)) return false
  if (message.isForwarded) return true
  if (message.fromId === C.DC_CONTACT_ID_SELF) return false
  const forwardedCount = message.privittyFileInfo?.forwarded?.length ?? 0
  return forwardedCount > 0
}

function shouldShowForwardedIndicator(
  message: T.Message,
  isPrivittyForwarded: boolean
): boolean {
  return (
    message.isForwarded ||
    isPrivittyForwarded ||
    isPrivittyForwardedPrvSync(message)
  )
}

/**
 * Mirrors Android FileAccessStatusData.isIncomingForwardeePrv().
 * Forwardee incoming .prv messages hide the bell icon.
 */
function isIncomingForwardeePrv(message: T.Message): boolean {
  if (!isPrvFile(message)) return false
  if (message.fromId === C.DC_CONTACT_ID_SELF) return false

  const info = message.privittyFileInfo
  const senderAddr = message.sender?.address?.trim().toLowerCase()
  if (senderAddr && info?.forwarded?.length) {
    const senderInForwardedList = info.forwarded.some(
      f => f.contactAddr?.trim().toLowerCase() === senderAddr
    )
    if (senderInForwardedList) return true
  }

  if (message.isForwarded && message.viewType === 'File') {
    return true
  }
  if (!info) return false

  const sharedStatus = info.shared?.status?.trim().toLowerCase()
  const hasRealSharedAccess =
    !!sharedStatus &&
    sharedStatus !== 'not_found' &&
    sharedStatus !== 'none'

  if (hasRealSharedAccess) return false

  if (info.forwarded.length > 0) {
    const fwdStatus = info.forwarded[0]?.status?.trim().toLowerCase()
    return !!fwdStatus && fwdStatus !== 'not_found'
  }
  return false
}

function shouldShowPrivittyBell(
  message: T.Message,
  direction: 'incoming' | 'outgoing',
  isPrivittyForwarded: boolean
): boolean {
  if (!isPrvFile(message)) return false
  // Outgoing relay copy: the forwarder (B) sent someone else's file — they
  // cannot manage access control, so hide the bell (Android hideBellForForwarder).
  if (direction === 'outgoing' && isPrivittyForwarded) return false
  return true
}

async function buildContextMenu(
  {
    accountId,
    message,
    text,
    conversationType,
    openDialog,
    privateReply,
    handleReactClick,
    chat,
    jumpToMessage,
  }: {
    accountId: number
    message: T.Message | null
    text?: string
    conversationType: ConversationType
    openDialog: OpenDialog
    privateReply: PrivateReply
    handleReactClick: (event: React.MouseEvent<Element, MouseEvent>) => void
    chat: T.FullChat
    jumpToMessage: JumpToMessage
  },
  clickTarget: HTMLAnchorElement | null
): Promise<(false | ContextMenuItem)[]> {
  const tx = window.static_translate // don't use the i18n context here for now as this component is inefficient (rendered one menu for every message)
  if (!message) {
    throw new Error('cannot show context menu for undefined message')
  }

  const isWebxdcInfo = message.systemMessageType === 'WebxdcInfoMessage'
  const email = clickTarget?.getAttribute('x-target-email')
  // grab selected text before clicking, otherwise the selection might be already gone
  const selectedText = window.getSelection()?.toString()
  const textSelected: boolean = selectedText !== null && selectedText !== ''

  const isSavedMessage = message.savedMessageId !== null

  /** Copy action, is one of the following, (in that order):
   *
   * - Copy [selection] to clipboard
   * - OR Copy link to clipboard
   * - OR Copy email to clipboard
   * - Fallback: OR Copy message text to copy
   */
  let copy_item: ContextMenuItem | false = {
    label: tx('menu_copy_text_to_clipboard'),
    action: () => {
      text && runtime.writeClipboardText(text)
    },
  }

  if (textSelected) {
    copy_item = {
      label: tx('menu_copy_selection_to_clipboard'),
      action: () => {
        runtime.writeClipboardText(selectedText as string)
      },
    }
  } else if (email) {
    copy_item = {
      label: tx('menu_copy_email_to_clipboard'),
      action: () => runtime.writeClipboardText(email),
    }
  }
  if (copy_item && message.viewType === 'Sticker') {
    copy_item = false
  }

  const showCopyImage = !!message.file && message.viewType === 'Image'

  const isInfoOrCallInvitation =
    message.isInfo || message.viewType === 'VideochatInvitation'
  // Do not show "reply" in read-only chats, and for info messages.
  // See
  // - https://github.com/deltachat/deltachat-desktop/issues/5337
  // - https://github.com/deltachat/deltachat-android/blob/52c01976821803fa2d8a177f93576fa4082ef5bd/src/main/java/org/thoughtcrime/securesms/ConversationFragment.java#L332-L332
  const showReply = chat.canSend && !isInfoOrCallInvitation

  // See
  // - https://github.com/deltachat/deltachat-desktop/issues/4695.
  // - https://github.com/deltachat/deltachat-desktop/issues/5365.
  // - https://github.com/deltachat/deltachat-android/blob/fd4a377752cc6778f161590fde2f9ab29c5d3011/src/main/java/org/thoughtcrime/securesms/ConversationFragment.java#L334
  const showEdit =
    message.fromId === C.DC_CONTACT_ID_SELF &&
    chat.isEncrypted &&
    message.text !== '' &&
    chat.canSend &&
    !isInfoOrCallInvitation &&
    !message.hasHtml &&
    message.viewType !== 'Call'

  // Do not show "react" for system messages
  const showSendReaction = showReactionsUi(message, chat)
  const showForward: boolean = await showFileForward(message)

  // Only show in groups, don't show on info messages or outgoing messages
  const showReplyPrivately =
    (conversationType.chatType === C.DC_CHAT_TYPE_GROUP ||
      conversationType.chatType === C.DC_CHAT_TYPE_IN_BROADCAST) &&
    !isInfoOrCallInvitation &&
    message.fromId > C.DC_CONTACT_ID_LAST_SPECIAL

  return Promise.resolve([
    // Reply
    showReply && {
      label: tx('notify_reply_button'),
      action: setQuoteInDraft.bind(null, message.id),
      rightIcon: 'reply',
    },
    // Reply privately
    showReplyPrivately && {
      label: tx('reply_privately'),
      action: () => {
        privateReply(accountId, message)
      },
    },
    // Forward message
    showForward && {
      label: tx('forward'),
      action: openForwardDialog.bind(null, openDialog, message, chat.isSelfTalk),
      rightIcon: 'forward',
    },
    // Send emoji reaction
    showSendReaction && {
      label: tx('react'),
      action: handleReactClick,
      rightIcon: 'reaction',
    },
    showEdit && {
      // Not `tx('edit_message')`.
      // See https://github.com/deltachat/deltachat-desktop/issues/4695#issuecomment-2688716592
      label: tx('global_menu_edit_desktop'),
      action: enterEditMessageMode.bind(null, message),
      rightIcon: 'edit',
    },
    { type: 'separator' },
    // Unsave
    isSavedMessage && {
      label: tx('unsave'),
      action: () => {
        if (message.savedMessageId !== null) {
          BackendRemote.rpc.deleteMessages(selectedAccountId(), [
            message.savedMessageId,
          ])
        }
      },
      rightIcon: 'bookmark-filled',
    },
    // copy item (selection or all text)
    text !== '' &&
      !message.file &&
      copy_item && {
        label: 'Copy Text',
        action: () => {
          runtime.writeClipboardText(text as string)
        },
        rightIcon: 'copy',
      },
    // Copy image
    showCopyImage && {
      label: tx('menu_copy_image_to_clipboard'),
      action: () => {
        runtime.writeClipboardImage(message.file as string)
      },
      rightIcon: 'copy',
    },
    // Save Sticker to sticker collection
    message.viewType === 'Sticker' && {
      label: tx('add_to_sticker_collection'),
      action: () =>
        BackendRemote.rpc.miscSaveSticker(
          selectedAccountId(),
          message.id,
          tx('saved')
        ),
    },
    // Webxdc Info message: jump to app message
    Boolean(isWebxdcInfo && message.parentId) && {
      label: tx('show_app_in_chat'),
      action: () => {
        if (message.parentId) {
          jumpToMessage({
            accountId,
            msgId: message.parentId,
            // Currently the info message is always in the same chat
            // as the message with `message.parentId`,
            // but let's not pass `chatId` here, for future-proofing.
            msgChatId: undefined,
            highlight: true,
            focus: true,
            msgParentId: message.id,
            scrollIntoViewArg: { block: 'center' },
          })
        }
      },
    },
    // Message Info
    {
      label: tx('info'),
      action: openMessageInfo.bind(null, openDialog, message),
      rightIcon: 'info',
    },
    { type: 'separator' },
    // Delete message
    {
      label: tx('delete_message_desktop'),
      action: confirmDeleteMessage.bind(
        null,
        openDialog,
        accountId,
        message,
        chat
      ),
      rightIcon: 'trash',
      danger: true,
    },
  ])
}

/**
 * Helper function to check if a message text is a Privitty control message.
 * The backend returns `{ result: { is_valid: boolean } }`.
 */
async function checkIsPrivittyMessage(
  messageText: string | null
): Promise<boolean> {
  if (!messageText || messageText.trim() === '') {
    return false
  }
  try {
    const response = await runtime.PrivittySendMessage('isPrivittyMessage', {
      base64_data: messageText,
    })
    const parsed = JSON.parse(response)
    return parsed?.result?.is_valid === true
  } catch (error) {
    console.error('Error checking isPrivittyMessage:', error)
    return false
  }
}

/**
 * Check whether this message is a raw PDU message that should be hidden.
 *
 * We treat a message as a "PDU message" if:
 * - it has non-empty `text`
 * - and `isPrivittyMessage` backend check returns `false`
 *
 * This distinguishes raw PDUs (which we want to hide) from
 * higher-level Privitty control messages (which have `is_valid === true`)
 * and from normal chat messages (which don't go through this flow).
 */
async function isPduMessage({
  text,
}: {
  text?: string | null
}): Promise<boolean> {
  if (!text || text.trim() === '') {
    return false
  }

  return checkIsPrivittyMessage(text)
}

/**
 * Mirrors Android DocumentView.setFileAccessStatus() label logic.
 * Returns null for statuses where no text is shown (active/expired/error).
 */
function getPrivittyStatusLabel(status: PrivittyStatus | null): string | null {
  switch (status) {
    case 'active':
      return null // hidden; expiry label shown instead
    case 'requested':
      return 'Access Requested'
    case 'expired':
      return 'Access Expired' // hidden; expiry label shown instead
    case 'revoked':
      return 'Access revoked'
    case 'denied':
      return 'Request denied'
    case 'deleted':
      return 'File deleted'
    case 'waiting_owner_action':
      return 'Waiting for owner action'
    case 'not_found':
    case 'none':
      // Android: "Access not yet granted" for incoming forwarded .prv
      return 'Access not yet granted'
    case 'error':
    default:
      return null
  }
}

/** Mirrors Android DocumentView: red for denied, grey for everything else. */
function getPrivittyStatusColor(status: PrivittyStatus | null): string {
  return status === 'denied' ? '#D93229' : '#666666'
}

/**
 * Format a Unix-millisecond timestamp the same way Android does:
 * "MMM dd, yyyy HH:mm"  e.g. "Jan 15, 2026 14:30"
 *
 * Mirrors Android FileAccessStatusData.setExpiryTime():
 * values below year-2000-in-ms are treated as seconds and multiplied by 1000.
 */
function normalizePrivittyFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

async function fetchPrivittyBubbleState(
  accountId: number,
  message: Pick<
    T.Message,
    | 'id'
    | 'fromId'
    | 'viewType'
    | 'isForwarded'
    | 'sender'
    | 'file'
    | 'fileName'
    | 'privittyFileInfo'
  >
): Promise<{
  status: PrivittyStatus
  expiryTime: number | null
  waitingCount: number
  isPrivittyForwarded: boolean
  isIncomingForwardee: boolean
}> {
  const file = message.file
  if (!file) {
    return {
      status: 'none',
      expiryTime: null,
      waitingCount: 0,
      isPrivittyForwarded: false,
      isIncomingForwardee: isIncomingForwardeePrv(message),
    }
  }

  const filePath = normalizePrivittyFilePath(file)
  let status: PrivittyStatus = 'none'
  let expiryTime: number | null = null
  let waitingCount = 0
  let isPrivittyForwarded = false
  let isIncomingForwardee = isIncomingForwardeePrv(message)

  try {
    const fileId: T.I64 = await (
      BackendRemote.rpc as any
    ).privittyGetFileIdByPath(accountId, filePath)
    const displayStatus: T.PrivittyFileDisplayStatus | null = await (
      BackendRemote.rpc as any
    ).privittyGetFileDisplayStatus(accountId, fileId)
    status = (displayStatus?.state_str ?? 'none') as PrivittyStatus
    isPrivittyForwarded = displayStatus?.is_forwarded ?? false
    expiryTime =
      displayStatus && displayStatus.expiry_time_ms > 0
        ? Math.floor(Number(displayStatus.expiry_time_ms) / 1000)
        : null
  } catch (err) {
    console.error('Privitty status error', err)
    status = 'error'
  }

  try {
    const info: T.PrivittyFileInfo | null = await (
      BackendRemote.rpc as any
    ).privittyGetFileAccessInfo(accountId, message.id)
    if (info) {
      const messageWithInfo = { ...message, privittyFileInfo: info }
      isIncomingForwardee = isIncomingForwardeePrv(messageWithInfo)

      const normalize = (s?: string) => s?.trim().toLowerCase()
      if (normalize(info.shared?.status) === 'waiting_owner_action' ||
          normalize(info.shared?.status) === 'requested') {
        waitingCount++
      }
      waitingCount += info.forwarded.filter(f =>
        ['waiting_owner_action', 'requested'].includes(
          normalize(f?.status) ?? ''
        )
      ).length
    }
  } catch (err) {
    console.error('Red dot count error:', err)
  }

  return { status, expiryTime, waitingCount, isPrivittyForwarded, isIncomingForwardee }
}

function matchesFileAccessChange(
  payload: { chatId: number; msgId?: number; filePath?: string },
  message: { id: number; chatId: number; file?: string | null }
): boolean {
  if (payload.chatId !== message.chatId) return false
  if (payload.msgId != null && payload.msgId !== message.id) return false
  if (payload.filePath && message.file) {
    return (
      normalizePrivittyFilePath(payload.filePath) ===
      normalizePrivittyFilePath(message.file)
    )
  }
  return true
}

function formatExpiryTime(rawMs: number): string {
  const ms = rawMs < 946_684_800_000 ? rawMs * 1000 : rawMs
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Gets replacement text for the first two Privitty messages in a chat.
 * Returns null if the message is not a Privitty message or if it's beyond the first two.
 */
async function getPrivittyReplacementTextForFirstTwo(
  {
    id,
    text,
    chatId,
  }: {
    id: number
    text?: string | null
    chatId: number
  },
  accountId: number
): Promise<string | null> {
  if (!text || text.trim() === '') {
    return null
  }

  // Check if this message is a Privitty message
  const isPrivitty = await checkIsPrivittyMessage(text)
  if (!isPrivitty) {
    return null
  }

  try {
    // Get all messages in the chat up to and including this message
    const messageListItems = await BackendRemote.rpc.getMessageListItems(
      accountId,
      chatId,
      false,
      true
    )

    // Filter to get only actual message items
    const messagesWithText = messageListItems.filter(
      item => item.kind === 'message'
    )

    // Find current message index
    const currentMessageIndex = messagesWithText.findIndex(
      item => item.kind === 'message' && item.msg_id === id
    )

    if (currentMessageIndex === -1) {
      return null
    }

    // Get message IDs up to current message
    const relevantMessageIds = messagesWithText
      .slice(0, currentMessageIndex + 1)
      .map(item => item.msg_id)

    // Fetch messages
    const messagesRecord = await BackendRemote.rpc.getMessages(
      accountId,
      relevantMessageIds
    )

    const messages = Object.values(messagesRecord)
      .filter(
        (msg): msg is T.MessageLoadResult & { kind: 'message' } =>
          msg !== undefined && msg.kind === 'message'
      )
      .map(msg => msg as T.Message)

    // Collect Privitty messages
    const privittyMessages: T.Message[] = []

    for (const msg of messages) {
      if (msg.text && msg.text.trim() !== '') {
        const isPrivittyMsg = await checkIsPrivittyMessage(msg.text)
        if (isPrivittyMsg) {
          privittyMessages.push(msg)
        }
      }
    }

    const privittyIndex = privittyMessages.findIndex(msg => msg.id === id)

    if (privittyIndex === -1) {
      return null
    }

    if (privittyIndex === 0) {
      return 'Establishing guaranteed full control over your shared data, please wait...'
    }

    if (privittyIndex === 1) {
      return 'You are Privitty secure -- take control and revoke data anytime.'
    }

    return null
  } catch (error) {
    console.error('Error determining Privitty replacement text:', error)
    return null
  }
}

function getPrivittyReplacementText(message: T.Message): string {
  return message.text || ''
}

export default function Message(props: {
  chat: T.FullChat
  message: T.Message
  conversationType: ConversationType
}) {
  const { message, conversationType, chat } = props
  const {
    id,
    text,
    chatId,
    file,
    fileName,
    fileMime,
    viewType,
    hasLocation,
    hasHtml,
    isInfo,
    isForwarded,
    systemMessageType,
    parentId,
    sender,
    overrideSenderName,
    downloadState,
  } = message
  const [waitingCount, setWaitingCount] = useState(0)
  const [isPrivittyForwarded, setIsPrivittyForwarded] = useState(() =>
    isPrivittyForwardedPrvSync(message)
  )
  const [isIncomingForwardee, setIsIncomingForwardee] = useState(() =>
    isIncomingForwardeePrv(message)
  )
  // Synchronously hide on first render if the text looks like a raw Privitty
  // PDU (long, continuous base64 string with no spaces). This eliminates the
  // flash of gibberish while the async isPduMessage() server call completes.
  // If the heuristic fires incorrectly, the async effect below corrects it.
  const [hidePduMessage, setHidePduMessage] = useState<boolean>(() => {
    const text = message.text
    if (!text || text.length < 80) return false
    return /^[A-Za-z0-9+/=\r\n]+$/.test(text.substring(0, 80))
  })
  const [privittyStatus, setPrivittyFileStatus] =
    useState<PrivittyStatus>('none')
  // Expiry timestamp in ms (null = no expiry). Shown as "Access Until: …"
  // for active and expired statuses, mirroring Android DocumentView.
  const [privittyExpiryTime, setPrivittyExpiryTime] = useState<number | null>(
    null
  )
  const [privittyReplacementText, setPrivittyReplacementText] = useState<
    string | null
  >(null)
  const accountId = selectedAccountId()
  const privittyStatusLabel = getPrivittyStatusLabel(privittyStatus)
  const privittyStatusColor = getPrivittyStatusColor(privittyStatus)

  // Confirm (or correct) the synchronous heuristic once the server is ready.
  // We must wait for server readiness: if the server is still doing switchProfile
  // when this fires, checkIsPrivittyMessage returns false, isPduMessage returns
  // false, and setHidePduMessage(false) would un-hide the message — revealing
  // the raw base64 PDU as gibberish. By deferring to onServerReady we guarantee
  // the server has its user-context loaded before we query it.
  useEffect(() => {
    let cancelled = false

    const unsubscribeReady = privittyStore.onServerReady(() => {
      if (cancelled) return
      ;(async () => {
        try {
          const shouldHide = await isPduMessage({ text })

          if (!cancelled) {
            setHidePduMessage(shouldHide)
          }
        } catch (error) {
          console.error('Error determining if message is PDU:', error)
        }
      })()
    })

    return () => {
      cancelled = true
      unsubscribeReady()
    }
  }, [id, text])

  // Fetch Privitty file status for .prv bubbles. Refreshes immediately when
  // access changes (grant/deny/revoke) and on MsgsChanged — Android parity.
  useEffect(() => {
    if (!file || !file.endsWith('.prv')) return

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    const refreshPrivittyFileState = async () => {
      if (cancelled) return
      const next = await fetchPrivittyBubbleState(accountId, message)
      if (cancelled) return
      setPrivittyFileStatus(next.status)
      setPrivittyExpiryTime(next.expiryTime)
      setWaitingCount(next.waitingCount)
      setIsPrivittyForwarded(next.isPrivittyForwarded)
      setIsIncomingForwardee(next.isIncomingForwardee)
    }

    const unsubscribeReady = privittyStore.onServerReady(() => {
      if (cancelled) return
      refreshPrivittyFileState()
      intervalId = setInterval(refreshPrivittyFileState, 59_000)
    })

    const unsubscribeFileAccess = privittyStore.subscribeFileAccessChanged(
      payload => {
        if (matchesFileAccessChange(payload, { id, chatId, file })) {
          refreshPrivittyFileState()
        }
      }
    )

    const unsubscribeMsgsChanged = onDCEvent(
      accountId,
      'MsgsChanged',
      ({ chatId: eventChatId, msgId }) => {
        if (eventChatId !== chatId) return
        if (msgId !== 0 && msgId !== id) return
        refreshPrivittyFileState()
      }
    )

    const unsubscribeForwardAccessRequested = onDCEvent(
      accountId,
      'PrivittyForwardAccessRequested',
      ({ chatId: eventChatId }) => {
        if (eventChatId === chatId) {
          refreshPrivittyFileState()
        }
      }
    )

    return () => {
      cancelled = true
      unsubscribeReady()
      unsubscribeFileAccess()
      unsubscribeMsgsChanged()
      unsubscribeForwardAccessRequested()
      if (intervalId) clearInterval(intervalId)
    }
  }, [accountId, id, file, chatId])
  // handshake messages. Must wait for server readiness — same reason as the
  // isPduMessage effect above: calling checkIsPrivittyMessage before
  // switchProfile completes returns false, causing replacement text to be
  // permanently null and the message to remain hidden with no info text shown.
  useEffect(() => {
    let cancelled = false

    const unsubscribeReady = privittyStore.onServerReady(() => {
      if (cancelled) return
      ;(async () => {
        try {
          const replacementText = await getPrivittyReplacementTextForFirstTwo(
            { id, text, chatId },
            accountId
          )

          if (!cancelled) {
            setPrivittyReplacementText(replacementText)
          }
        } catch (error) {
          console.error('Error getting Privitty replacement text:', error)
        }
      })()
    })

    return () => {
      cancelled = true
      unsubscribeReady()
    }
  }, [id, text, chatId, accountId])

  const direction = getDirection(message)
  const status = mapCoreMsgStatus2String(message.state)

  const tx = useTranslationFunction()

  const { showReactionsBar } = useReactionsBar()
  const { openDialog } = useDialog()
  const privateReply = usePrivateReply()
  const { openContextMenu } = useContext(ContextMenuContext)
  const openViewProfileDialog = useOpenViewProfileDialog()
  const { joinVideoChat } = useVideoChat()
  const { jumpToMessage } = useMessage()
  const [messageWidth, setMessageWidth] = useState(0)

  const showContextMenu = useCallback(
    async (
      event: React.MouseEvent<
        HTMLButtonElement | HTMLAnchorElement | HTMLDivElement,
        MouseEvent
      >
    ) => {
      event.preventDefault() // prevent default runtime context menu from opening

      const showContextMenuEventPos = mouseEventToPosition(event)

      const handleReactClick = (
        reactClickEvent: React.MouseEvent<Element, MouseEvent>
      ) => {
        // We don't want `OutsideClickHelper` to catch this event, causing
        // the reaction bar to directly hide again when switching to other
        // messages by clicking the "react" button
        reactClickEvent.stopPropagation()

        const reactClickEventPos = mouseEventToPosition(reactClickEvent)
        // `reactClickEventPos` might have a wrong ((0, 0)) position
        // if the "react" button was activated with keyboard,
        // because the element on which it was activated
        // (the menu item) gets removed from DOM immediately.
        // Let's fall back to `showContextMenuEventPos` in such a case.
        const position =
          reactClickEventPos.x > 0 && reactClickEventPos.y > 0
            ? reactClickEventPos
            : showContextMenuEventPos

        showReactionsBar({
          messageId: message.id,
          reactions: message.reactions,
          ...position,
        })
      }

      // the event.t is a workaround for labled links, as they will be able to contain markdown formatting in the label in the future.
      const target = ((event as any).t || event.target) as HTMLAnchorElement
      const items = await buildContextMenu(
        {
          accountId,
          message,
          text: text || undefined,
          conversationType,
          openDialog,
          privateReply,
          handleReactClick,
          chat: props.chat,
          jumpToMessage,
        },
        target
      )

      openContextMenu({
        ...showContextMenuEventPos,
        items,
        ariaAttrs: {
          'aria-label': tx('a11y_message_context_menu_btn_label'),
        },
      })
    },
    [
      accountId,
      props.chat,
      conversationType,
      message,
      openContextMenu,
      openDialog,
      privateReply,
      showReactionsBar,
      text,
      jumpToMessage,
      tx,
    ]
  )
  const ref = useRef<any>(null)
  const rovingTabindex = useRovingTabindex(ref)
  const rovingTabindexAttrs = {
    ref,
    tabIndex: rovingTabindex.tabIndex,
    onKeyDown: (e: React.KeyboardEvent) => {
      // Audio / video elements have controls that utilize
      // arrows. That is seeking, changing volume.
      // So we don't want to switch focus if all user wanted to do
      // is to seek the element.
      //
      // However, FYI, onKeyDown event doesn't appear to get triggered
      // when a sub-element of the <audio> element
      // (seek bar, volume slider), and not the <audio> element itself,
      // is focused. At least on Chromium.
      //
      // But, when the root (`<audio>`) element (and not on of its
      // sub-elements) is focused, it still listens for arrows
      // and performs seeking and volume changes,
      // so, still, we need to ignore such events.
      //
      // The same goes for the `useRovingTabindex` code in Gallery.
      if (
        e.target instanceof HTMLMediaElement &&
        // This is purely for future-proofing, in case
        // the media element is a direct item of the roving tabindex widget,
        // and not merely a child of such an item.
        // In such cases we muts not ignore the event, because otherwise
        // there would be no way to switch focus to another item
        // using just the keyboard.
        // Again, at the time of writing we do not have such elements.
        !e.target.classList.contains(rovingTabindex.className)
      ) {
        return
      }

      rovingTabindex.onKeydown(e)
    },
    onFocus: rovingTabindex.setAsActiveElement,
  }
  // When the message is not the active one
  // `rovingTabindex.tabIndex === -1`, we need to set `tabindex="-1"`
  // to all its interactive (otherwise "Tabbable to") elements,
  // such as links, attachments, "view reactions" button, etc.
  // Only the contents of the "active" (selected) message
  // should have tab stops.
  // See https://github.com/deltachat/deltachat-desktop/issues/2141
  // WhatsApp appears to behave similarly.
  // The implementation is similar to the "Grid" pattern:
  // https://www.w3.org/WAI/ARIA/apg/patterns/grid/#gridNav_inside
  const tabindexForInteractiveContents = rovingTabindex.tabIndex

  const messageContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const resizeHandler = () => {
      if (messageContainerRef.current) {
        let messageWidth = 0
        // set message width which is used by reaction component
        // to adapt the number of visible reactions
        if (fileMime || window.innerWidth < 900) {
          // image messages have a defined width
          messageWidth = messageContainerRef.current.clientWidth
        } else {
          // text messages might be smaller than min width but
          // they can be extended to at least max image width
          // so we pass that value to the reaction calculation
          messageWidth = 450
        }
        setMessageWidth(messageWidth)
      }
    }
    window.addEventListener('resize', resizeHandler)
    // call once on first render
    resizeHandler()
    return () => {
      window.removeEventListener('resize', resizeHandler)
    }
  }, [fileMime])

  // Completely hide raw PDU messages in the UI
  // But don't hide Privitty messages that have replacement text (we want to show those)
  if (hidePduMessage && privittyReplacementText === null) {
    return null
  }

  // Info Message (or Privitty messages with replacement text)
  if (isInfo || privittyReplacementText !== null) {
    const isWebxdcInfo = systemMessageType === 'WebxdcInfoMessage'
    const _isProtectionBrokenMsg =
      systemMessageType === 'ChatProtectionDisabled'
    const isProtectionEnabledMsg =
      systemMessageType === 'ChatProtectionEnabled' ||
      systemMessageType === 'ChatE2ee'

    // Message can't be sent because of `Invalid unencrypted mail to <>`
    // which is sent by chatmail servers.
    const isInvalidUnencryptedMail =
      systemMessageType === 'InvalidUnencryptedMail'

    // Some info messages can be clicked by the user to receive further information
    const isInteractive =
      (isWebxdcInfo && parentId) ||
      message.infoContactId != null ||
      isProtectionEnabledMsg ||
      isInvalidUnencryptedMail

    let onClick
    if (isInteractive) {
      onClick = async () => {
        if (isWebxdcInfo) {
          // open or focus the webxdc app
          openWebxdc(message)
        } else if (
          message.infoContactId != null &&
          message.infoContactId !== C.DC_CONTACT_ID_SELF
        ) {
          openViewProfileDialog(accountId, message.infoContactId)
        } else if (isProtectionEnabledMsg) {
          openDialog(ProtectionEnabledDialog)
        } else if (isInvalidUnencryptedMail) {
          openDialog(InvalidUnencryptedMailDialog)
        }
      }
    }

    const TagName = onClick ? 'button' : 'div'
    return (
      <div
        className={classNames(
          'info-message',
          isWebxdcInfo && 'webxdc-info',
          isInteractive && 'interactive',
          isProtectionEnabledMsg && 'e2ee-info' // used in e2e-tests
        )}
        id={String(message.id)}
        onContextMenu={showContextMenu}
      >
        <TagName
          className={'bubble ' + rovingTabindex.className}
          onClick={onClick}
          {...rovingTabindexAttrs}
          // Note that the actual `onContextMenu` listener
          // is on the wrapper component.
          aria-haspopup='menu'
        >
          {isWebxdcInfo && parentId && (
            <img
              src={runtime.getWebxdcIconURL(selectedAccountId(), parentId)}
            />
          )}
          {privittyReplacementText !== null
            ? privittyReplacementText
            : getPrivittyReplacementText(message) || text}
          {direction === 'outgoing' &&
            (status === 'sending' || status === 'error') && (
              <div
                className={classNames('status-icon', status)}
                aria-label={tx(`a11y_delivery_status_${status}`)}
              />
            )}
        </TagName>
      </div>
    )
  }
  // Normal Message
  const onContactClick = async (contact: T.Contact) => {
    openViewProfileDialog(accountId, contact.id)
  }

  let onClickMessageBody

  // Check if the message is saved or has a saved message
  // in both cases we display the bookmark icon
  const isOrHasSavedMessage = message.originalMsgId
    ? true
    : !!message.savedMessageId

  let content
  if (message.viewType === 'VideochatInvitation') {
    return (
      <div
        className={`videochat-invitation ${rovingTabindex.className}`}
        id={message.id.toString()}
        onContextMenu={showContextMenu}
        aria-haspopup='menu'
        {...rovingTabindexAttrs}
      >
        <div className='videochat-icon'>
          <span className='icon videocamera' />
        </div>
        {/* FYI the clickable element is not a semantic button.
        Here it's probably fine. So there is also no need
        to specify tabindex.*/}
        <AvatarFromContact
          contact={sender}
          onClick={onContactClick}
          // tabindexForInteractiveContents={tabindexForInteractiveContents}
        />
        <div className='break' />
        <div
          className='info-button'
          onClick={() => joinVideoChat(accountId, id)}
        >
          {direction === 'incoming'
            ? tx('videochat_contact_invited_hint', sender.displayName)
            : tx('videochat_you_invited_hint')}
          <button
            className='join-button'
            tabIndex={tabindexForInteractiveContents}
          >
            {direction === 'incoming'
              ? tx('videochat_tap_to_join')
              : tx('rejoin')}
          </button>
        </div>
        <div className='break' />
        <div className='meta-data-container'>
          <MessageMetaData
            fileMime={fileMime || null}
            direction={direction}
            status={status}
            error={message.error || null}
            downloadState={message.downloadState}
            isEdited={message.isEdited}
            hasText={text !== null && text !== ''}
            hasLocation={hasLocation}
            timestamp={message.timestamp * 1000}
            encrypted={message.showPadlock}
            isSavedMessage={isOrHasSavedMessage}
            onClickError={openMessageInfo.bind(null, openDialog, message)}
            viewType={'VideochatInvitation'}
            tabindexForInteractiveContents={tabindexForInteractiveContents}
            privittyStatus={privittyStatus}
          />
        </div>
      </div>
    )
  } else {
    content = (
      <div dir='auto' className='text'>
        {text !== null ? (
          <MessageBody
            text={
              privittyReplacementText !== null
                ? privittyReplacementText
                : getPrivittyReplacementText(message) || text
            }
            tabindexForInteractiveContents={tabindexForInteractiveContents}
          />
        ) : null}
      </div>
    )
  }

  if (downloadState !== 'Done') {
    content = (
      <div className={'download'}>
        {text} {'- '}
        {downloadState == 'Failure' && (
          <span key='fail' className={'failed'}>
            {tx('download_failed')}
          </span>
        )}
        {downloadState == 'InProgress' && (
          <span key='downloading'>{tx('downloading')}</span>
        )}
        {(downloadState == 'Failure' || downloadState === 'Available') && (
          <button
            onClick={downloadFullMessage.bind(null, message.id)}
            tabIndex={tabindexForInteractiveContents}
          >
            {tx('download')}
          </button>
        )}
      </div>
    )
  }

  /** Whether to show author name and avatar */
  const showAuthor =
    conversationType.hasMultipleParticipants ||
    message?.overrideSenderName ||
    message?.originalMsgId ||
    chat.isSelfTalk

  const hasText = text !== null && text !== ''
  const isWithoutText = isMediaWithoutText(fileMime, hasText, message.viewType)
  const showAttachment = (message: T.Message) =>
    message.file &&
    message.viewType !== 'Webxdc' &&
    message.viewType !== 'Vcard'

  const handleBellClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (message.file && message.chatId) {
      openDialog(FileAccessStatusDialog, {
        chatId: message.chatId,
        msgId: message.id,
        filePath: message.file,
        fileName: fileName || undefined,
        isPeer2Mode: direction === 'incoming',
      })
    }
  }

  const showForwardedIndicator = shouldShowForwardedIndicator(
    message,
    isPrivittyForwarded
  )
  const showPrivittyFileHeader =
    isPrvFile(message) && Boolean(showAttachment(message))
  const showPrivittyBellIcon = shouldShowPrivittyBell(
    message,
    direction,
    isPrivittyForwarded
  )

  const privittyBellButton = (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {direction === 'outgoing' && waitingCount > 0 && (
        <div
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: 16,
            height: 16,
            background: 'red',
            borderRadius: '50%',
            color: '#fff',
            fontSize: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
            fontWeight: 600,
            zIndex: 10,
          }}
          aria-label={`${waitingCount} pending access request${waitingCount === 1 ? '' : 's'}`}
        >
          {waitingCount}
        </div>
      )}
      <button
        onClick={handleBellClick}
        className='file-access-bell-button'
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label='File Access Status'
        tabIndex={tabindexForInteractiveContents}
      >
        <Icon icon='bell' size={20} />
      </button>
    </div>
  )

  return (
    <div
      onContextMenu={showContextMenu}
      aria-haspopup='menu'
      className={classNames(
        'message',
        direction,
        styles.message,
        rovingTabindex.className,
        {
          [styles.withReactions]: message.reactions,
          'type-sticker': viewType === 'Sticker',
          error: status === 'error',
          // Only apply the DC forwarded CSS class for non-.prv messages.
          // .prv forwarded files render their own inline badge.
          forwarded: showForwardedIndicator && !showPrivittyFileHeader,
          'has-html': hasHtml,
        }
      )}
      id={message.id.toString()}
      {...rovingTabindexAttrs}
    >
      {showAuthor && direction === 'incoming' && (
        <Avatar
          contact={sender}
          onContactClick={onContactClick}
          // The avatar doesn't need to be a tab stop, because
          // the author name is a tab stop and clicking on it does the same.
          tabIndex={-1}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          className='msg-container'
          style={{ borderColor: sender.color }}
          ref={messageContainerRef}
        >
          {/* Standard DC forwarded indicator — only for non-.prv messages */}
          {showForwardedIndicator && !showPrivittyFileHeader ? (
            <ForwardedTitle
              contact={sender}
              onContactClick={onContactClick}
              direction={direction}
              conversationType={conversationType}
              overrideSenderName={overrideSenderName}
              tabIndex={tabindexForInteractiveContents}
            />
          ) : null}
          {/* Privitty .prv file header — file type label + forwarded badge + bell */}
          {showPrivittyFileHeader && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '-4px',
                marginBottom: '4px',
              }}
            >
              <div
                style={{
                  color: direction === 'outgoing' ? '#FFF' : undefined,
                  fontWeight: 500,
                }}
              >
                {getPrivittyFileTypeLabel(fileName || message.fileName)}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  marginLeft: 12,
                }}
              >
                {showForwardedIndicator && (
                  <span
                    style={{
                      fontSize: 11,
                      fontStyle: 'italic',
                      fontWeight: 'normal',
                      opacity: 0.72,
                      color:
                        direction === 'outgoing' ? '#FFF' : 'var(--messageText, #444)',
                    }}
                  >
                    Forwarded Message
                  </span>
                )}
                {showPrivittyBellIcon && privittyBellButton}
              </div>
            </div>
          )}
          {!showForwardedIndicator && (
            <div
              className={classNames('author-wrapper', {
                'can-hide':
                  (!overrideSenderName && direction === 'outgoing') ||
                  !showAuthor,
              })}
            >
              <AuthorName
                contact={sender}
                onContactClick={onContactClick}
                overrideSenderName={overrideSenderName}
                tabIndex={tabindexForInteractiveContents}
              />
            </div>
          )}
          {/* <p>Document File</p> */}
          <div
            className={classNames('msg-body', {
              'msg-body--clickable': onClickMessageBody,
            })}
            onClick={onClickMessageBody}
            tabIndex={onClickMessageBody ? tabindexForInteractiveContents : -1}
          >
            {message.quote !== null && (
              <Quote
                quote={message.quote}
                msgParentId={message.id}
                // FYI the quote is not always interactive,
                // e.g. when `quote.kind === 'JustText'`.
                tabIndex={tabindexForInteractiveContents}
              />
            )}
            {showAttachment(message) && (
              <Attachment
                text={text || undefined}
                message={message}
                tabindexForInteractiveContents={tabindexForInteractiveContents}
                privittyStatus={privittyStatus}
              />
            )}
            {message.viewType === 'Webxdc' && (
              <WebxdcMessageContent
                tabindexForInteractiveContents={tabindexForInteractiveContents}
                message={message}
              ></WebxdcMessageContent>
            )}
            {message.viewType === 'Vcard' && (
              <VCardComponent
                message={message}
                tabindexForInteractiveContents={tabindexForInteractiveContents}
              ></VCardComponent>
            )}
            {content}
            {hasHtml && (
              <button
                onClick={openMessageHTML.bind(null, message.id)}
                className='show-html'
                tabIndex={tabindexForInteractiveContents}
              >
                {tx('show_full_message')}
              </button>
            )}
          </div>
          {showAttachment(message) && message.file?.endsWith('.prv') && (
            <div style={{ marginTop: 6 }}>
              {/* Status text — hidden for 'active' and 'expired' (Android parity) */}
              {privittyStatusLabel && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color:
                      direction === 'outgoing'
                        ? '#ffffff'
                        : privittyStatusColor,
                  }}
                >
                  {privittyStatusLabel}
                </p>
              )}
              {/* "Access Until:" — shown for active and expired when expiry is set */}
              {privittyStatus === 'active' && privittyExpiryTime != null && (
                <p
                  style={{
                    margin: '2px 0 0',
                    fontSize: 12,
                    color: direction === 'outgoing' ? '#fff' : '#666666',
                  }}
                >
                  Access Until: {formatExpiryTime(privittyExpiryTime)}
                </p>
              )}
            </div>
          )}
        </div>
        <footer
          className={classNames(styles.messageFooter, {
            [styles.onlyMedia]: isWithoutText,
            [styles.withReactionsNoText]: isWithoutText && message.reactions,
            [styles.incomingFooter]: direction === 'incoming',
          })}
        >
          <MessageMetaData
            fileMime={fileMime}
            direction={direction}
            status={status}
            error={message.error || null}
            downloadState={downloadState}
            isEdited={message.isEdited}
            hasText={hasText}
            hasLocation={hasLocation}
            timestamp={message.timestamp * 1000}
            encrypted={message.showPadlock}
            isSavedMessage={isOrHasSavedMessage}
            onClickError={openMessageInfo.bind(null, openDialog, message)}
            viewType={message.viewType}
            tabindexForInteractiveContents={tabindexForInteractiveContents}
            privittyStatus={privittyStatus}
          />
          <div
            // TODO the "+1" count aria-live announcment is perhaps not great
            // out of context.
            // Also the "show ReactionsDialog" button gets announced.
            aria-live='polite'
            aria-relevant='all'
          >
            {message.reactions && (
              <Reactions
                reactions={message.reactions}
                tabindexForInteractiveContents={tabindexForInteractiveContents}
                messageWidth={messageWidth}
              />
            )}
          </div>
        </footer>
      </div>
      <ShortcutMenu
        chat={props.chat}
        direction={direction}
        message={message}
        showContextMenu={showContextMenu}
        tabindexForInteractiveContents={tabindexForInteractiveContents}
      />
    </div>
  )
}

export const Quote = ({
  quote,
  msgParentId,
  isEditMessage,
  tabIndex,
}: {
  quote: T.MessageQuote
  msgParentId?: number
  /**
   * Whether this component is passed the message that the user is editing.
   */
  isEditMessage?: boolean
  tabIndex: -1 | 0
}) => {
  const tx = useTranslationFunction()
  const accountId = selectedAccountId()
  const { jumpToMessage } = useMessage()

  const hasMessage = quote.kind === 'WithMessage'

  const authorStyle = hasMessage ? { color: quote.authorDisplayColor } : {}
  const borderStyle =
    !hasMessage || quote.isForwarded
      ? {}
      : { borderLeftColor: quote.authorDisplayColor }

  let onClick = undefined
  if (quote.kind === 'WithMessage') {
    onClick = () => {
      jumpToMessage({
        accountId,
        msgId: quote.messageId,
        msgChatId: quote.chatId,
        highlight: true,
        focus: true,
        msgParentId,
        // Often times the quoted message is already in view,
        // so let's not scroll at all if so.
        scrollIntoViewArg: { block: 'nearest' },
      })
    }
  }
  // TODO a11y: we probably want a separate button
  // with `aria-label="Jump to message"`.
  // Having a button with so much content is probably not good.
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag className='quote-background' onClick={onClick} tabIndex={tabIndex}>
      <div
        className={`quote ${hasMessage && 'has-message'}`}
        style={borderStyle}
      >
        <div className='quote-text'>
          {isEditMessage ? (
            <div className='quote-author' style={authorStyle}>
              {tx('edit_message')}
            </div>
          ) : (
            hasMessage && (
              <>
                {quote.isForwarded ? (
                  <div className='quote-author'>
                    {reactStringReplace(
                      tx('forwarded_by', '$$forwarder$$'),
                      '$$forwarder$$',
                      () => (
                        <span key='displayname'>
                          {getAuthorName(
                            quote.authorDisplayName as string,
                            quote.overrideSenderName || undefined
                          )}
                        </span>
                      )
                    )}
                  </div>
                ) : (
                  <div className='quote-author' style={authorStyle}>
                    {getAuthorName(
                      quote.authorDisplayName,
                      quote.overrideSenderName || undefined
                    )}
                  </div>
                )}
              </>
            )
          )}
          {quote.text && (
            <div className='quoted-text'>
              <MessageBody
                text={
                  quote.text.slice(0, 3000 /* limit quoted message size */) ||
                  ''
                }
                disableJumbomoji
                nonInteractiveContent
                tabindexForInteractiveContents={-1}
              />
            </div>
          )}
        </div>
        {hasMessage && quote.image && (
          <img
            className='quoted-image'
            src={runtime.transformBlobURL(quote.image)}
          />
        )}
        {hasMessage && quote.viewType == 'Webxdc' && (
          <img
            className='quoted-webxdc-icon'
            src={runtime.getWebxdcIconURL(selectedAccountId(), quote.messageId)}
          />
        )}
      </div>
    </Tag>
  )
}

export function getAuthorName(
  displayName: string,
  overrideSenderName?: string | null
) {
  return overrideSenderName ? `~${overrideSenderName}` : displayName
}

function WebxdcMessageContent({
  message,
  tabindexForInteractiveContents,
}: {
  message: T.Message
  tabindexForInteractiveContents: -1 | 0
}) {
  const tx = useTranslationFunction()
  const [webxdcInfo, setWebxdcInfo] = useState<T.WebxdcMessageInfo | null>(null)
  const [isLoadingWebxdcInfo, setIsLoadingWebxdcInfo] = useState(true)
  const accountId = selectedAccountId()

  const fetchWebxdcInfo = useCallback(async () => {
    setIsLoadingWebxdcInfo(true)
    try {
      const info = await BackendRemote.rpc.getWebxdcInfo(accountId, message.id)
      setWebxdcInfo(info)
    } catch (error) {
      console.error(
        'Failed to refresh webxdc info for message:',
        message.id,
        error
      )
    } finally {
      setIsLoadingWebxdcInfo(false)
    }
  }, [accountId, message.id])

  const debouncedFetchWebxdcInfo = useMemo(
    () => debounce(fetchWebxdcInfo, 500),
    [fetchWebxdcInfo]
  )

  useEffect(() => {
    if (message.viewType !== 'Webxdc') return

    // Initial fetch
    fetchWebxdcInfo()

    // Listen for updates
    const cleanup = onDCEvent(
      accountId,
      'WebxdcStatusUpdate',
      async ({ msgId }) => {
        if (msgId === message.id) {
          // Debounce the refresh since event might be triggered on every key stroke
          debouncedFetchWebxdcInfo()
        }
      }
    )

    return cleanup
  }, [
    accountId,
    message.id,
    message.viewType,
    fetchWebxdcInfo,
    debouncedFetchWebxdcInfo,
  ])

  if (message.viewType !== 'Webxdc') {
    return null
  }

  const info = webxdcInfo || {
    name: isLoadingWebxdcInfo ? 'Loading...' : 'INFO MISSING!',
    document: undefined,
    summary: isLoadingWebxdcInfo ? '' : 'INFO MISSING!',
  }

  return (
    <div className='webxdc'>
      <img
        src={runtime.getWebxdcIconURL(selectedAccountId(), message.id)}
        alt={`icon of ${info.name}`}
        // No need to turn this element into a `<button>` for a11y,
        // because there is a button below that does the same.
        onClick={() => openWebxdc(message, webxdcInfo ?? undefined)}
        // Not setting `tabIndex={tabindexForInteractiveContents}` here
        // because there is a button below that does the same
      />
      <div
        className='info-text'
        title={`${info.document ? info.document + ' \n' : ''}${info.name}`}
      >
        <div className='document'>{info.document}</div>
        <div className='name'>{info.name}</div>
      </div>
      <div className='summary'>{info.summary}</div>
      <Button
        className={styles.startWebxdcButton}
        styling='primary'
        onClick={() => openWebxdc(message, webxdcInfo ?? undefined)}
        tabIndex={tabindexForInteractiveContents}
      >
        {tx('start_app')}
      </Button>
    </div>
  )
}
