import moment from 'moment'

import { getLogger } from '../../../../shared/logger'
import { runtime } from '@deltachat-desktop/runtime-interface'
import { BackendRemote, Type } from '../../backend-com'
import { selectedAccountId } from '../../ScreenController'
import { internalOpenWebxdc } from '../../system-integration/webxdc'
import ForwardMessage from '../dialogs/ForwardMessage'
import ConfirmationDialog from '../dialogs/ConfirmationDialog'
import MessageDetail from '../dialogs/MessageDetail/MessageDetail'
import SecurePDFViewer from '../dialogs/SecurePDFViewer'
import SecureImageViewer from '../dialogs/SecureImageViewer'
import SecureVideoViewer from '../dialogs/SecureVideoViewer'

import type { OpenDialog } from '../../contexts/DialogContext'
import { C, type T } from '@privitty/jsonrpc-client'
import ConfirmDeleteMessageDialog from '../dialogs/ConfirmDeleteMessage'
import { extname } from 'path'

const log = getLogger('render/msgFunctions')

/**
 * json representation of the message object we get from the backend
 */
export function onDownload(msg: Type.Message) {
  if (!msg.file) {
    log.error('message has no file to download:', msg)
    throw new Error('message has no file to download')
  } else if (!msg.fileName) {
    log.error('message has no filename to download:', msg)
    throw new Error('message has no file name to download')
  } else {
    runtime.downloadFile(msg.file, msg.fileName)
  }
}

interface OpenAttachmentResult {
  useSecureViewer?: boolean
  filePath?: string
  fileName?: string
  viewerType?: string
}

export async function openAttachmentInShell(
  msg: Type.Message
): Promise<OpenAttachmentResult | void> {
  if (!msg.file || !msg.fileName) {
    log.error('message has no file to open:', msg)
    throw new Error('message has no file to open')
  }
  let tmpFile: string
  try {
    tmpFile = await runtime.copyFileToInternalTmpDir(msg.fileName, msg.file)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    log.error('Failed to copy file to temp directory', {
      originalFile: msg.file,
      fileName: msg.fileName,
      error: errorMessage,
    })

    // Show user-friendly error message
    runtime.showNotification({
      title: 'File Error',
      body: 'The file could not be opened because it is no longer available. It may have been deleted or moved.',
      icon: null,
      chatId: msg.chatId,
      messageId: msg.id,
      accountId: selectedAccountId(),
      notificationType: 0,
    })

    throw new Error('File is no longer available')
  }

  let filePathName = tmpFile
  log.debug('messagefuntions filePathName', filePathName)

  if (extname(msg.fileName) === '.prv') {
    filePathName = tmpFile.replace(/\\/g, '/')
    const accountId = selectedAccountId()

    // Decrypt the file using the JSONRPC API
    try {
      const basicChat = await BackendRemote.rpc.getBasicChatInfo(
        accountId,
        msg.chatId
      )
      let decryptedPath: string
      if (basicChat.chatType === C.DC_CHAT_TYPE_GROUP) {
        decryptedPath = await (
          BackendRemote.rpc as any
        ).privittyDecryptGroupFile(accountId, msg.chatId, msg.id, filePathName)
      } else {
        decryptedPath = await (BackendRemote.rpc as any).privittyDecryptFile(
          accountId,
          msg.chatId,
          msg.id,
          filePathName
        )
      }
      filePathName = decryptedPath.replace(/\\/g, '/')
    } catch (e) {
      log.error('openAttachmentInShell: failed to decrypt .prv file', e)
      return
    }

    const supportedImageExtensions = [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.bmp',
      '.webp',
      '.svg',
    ]
    const supportedVideoExtensions = [
      '.mp4',
      '.avi',
      '.mov',
      '.wmv',
      '.flv',
      '.webm',
      '.mkv',
      '.m4v',
    ]
    const decryptedFileExtension = extname(filePathName).toLowerCase()

    if (
      decryptedFileExtension === '.pdf' ||
      supportedImageExtensions.includes(decryptedFileExtension) ||
      supportedVideoExtensions.includes(decryptedFileExtension)
    ) {
      const viewerType: 'pdf' | 'image' | 'video' =
        decryptedFileExtension === '.pdf'
          ? 'pdf'
          : supportedImageExtensions.includes(decryptedFileExtension)
            ? 'image'
            : 'video'
      log.info('Opening decrypted .prv file in secure viewer', {
        filePath: filePathName,
        viewerType,
      })
      return {
        useSecureViewer: true,
        filePath: filePathName,
        fileName: msg.fileName,
        viewerType,
      }
    }

    runtime.openPath(filePathName)
    return
  }

  // For non-PDF files, use the original behavior
  if (!runtime.openPath(filePathName)) {
    log.info(
      "file couldn't be opened, try saving it in a different place and try to open it from there"
    )
  }
}

/**
 * Mirrors Android PrivittyForwardHelper.resolvePrivittySourceChatId().
 * For outgoing messages (relay copy), scans all chats for an incoming .prv
 * message with the same file path — that chat is the true source for the
 * privittyInitForwardPeerAdd() call.
 * For incoming messages, the message's own chatId is already correct.
 */
async function resolvePrivittySourceChatId(
  accountId: number,
  message: T.Message
): Promise<number> {
  // Incoming: message.chatId is already the source chat.
  if (message.fromId !== C.DC_CONTACT_ID_SELF) {
    return message.chatId
  }
  // Outgoing relay copy: scan all chats for a matching incoming .prv.
  const targetPath = (message.file ?? '').replace(/\\/g, '/')
  if (!targetPath) return message.chatId
  try {
    const chatIds = await BackendRemote.rpc.getChatlistEntries(
      accountId, null, null, null
    )
    for (const [chatIdNum] of chatIds) {
      if (chatIdNum === message.chatId) continue
      try {
        const msgIds = await BackendRemote.rpc.getMessageIds(
          accountId, chatIdNum, false, false
        )
        for (const msgId of msgIds) {
          const msg = await BackendRemote.rpc.getMessage(accountId, msgId)
          if (msg.fromId === C.DC_CONTACT_ID_SELF) continue
          if (!msg.file) continue
          const candidatePath = msg.file.replace(/\\/g, '/')
          if (candidatePath === targetPath) {
            log.debug('resolvePrivittySourceChatId: found source chat', chatIdNum)
            return chatIdNum
          }
        }
      } catch {
        // skip this chat on error
      }
    }
  } catch (e) {
    log.error('resolvePrivittySourceChatId: scan failed', e)
  }
  return message.chatId
}

/**
 * Mirrors Android PrivittyForwardHelper.shouldBlockPrvRelayForward().
 * Returns true (block) when:
 *  - incoming forwardee .prv (isIncomingForwardeePrv)
 *  - allow_forward is false
 *  - status is revoked / expired / denied
 */
const privittyForwardable = async (
  message: T.Message,
  isSelfTalk: boolean
): Promise<boolean> => {
  if (!message.file || !message.fileName?.toLowerCase().endsWith('.prv')) {
    return true
  }
  // Gap 8: Block forwarding outgoing .prv files from Saved Messages.
  if (isSelfTalk && message.fromId === C.DC_CONTACT_ID_SELF) {
    return false
  }
  try {
    const accountId = selectedAccountId()
    const filePath = message.file.replace(/\\/g, '/')
    const fileId = await (BackendRemote.rpc as any).privittyGetFileIdByPath(
      accountId,
      filePath
    )
    const displayStatus: T.PrivittyFileDisplayStatus | null = await (
      BackendRemote.rpc as any
    ).privittyGetFileDisplayStatus(accountId, fileId)
    log.debug('privittyForwardable displayStatus', displayStatus)

    if (!displayStatus) return false

    // Block if forwarding is not permitted
    if (!displayStatus.allow_forward) return false

    // Block permanently-closed statuses
    const status = (displayStatus.state_str ?? '').trim().toLowerCase()
    if (status === 'revoked' || status === 'expired' || status === 'denied') {
      return false
    }

    // Block incoming forwardee .prv (isIncomingForwardeePrv)
    // A forwarded incoming .prv means this is a relay copy — forwardee cannot re-forward.
    if (displayStatus.is_forwarded && message.fromId !== C.DC_CONTACT_ID_SELF) {
      return false
    }

    return true
  } catch (e) {
    log.error('privittyForwardable: failed to get file display status', e)
    return false
  }
}

export async function openForwardDialog(
  openDialog: OpenDialog,
  message: Type.Message,
  isSelfTalk = false
) {
  const forwardable = await privittyForwardable(message, isSelfTalk)

  try {
    if (!forwardable) {
      log.error('message has no file to forward:', message)
      // show notification
      runtime.showNotification({
        title: 'Privitty',
        body: 'File is not forwardable',
        icon: null,
        chatId: message.chatId,
        messageId: message.id,
        accountId: selectedAccountId(),
        notificationType: 0,
      })
      throw new Error('message has no file to forward')
    } else {
      openDialog(ForwardMessage, { message })
    }
  } catch (error) {
    // Handle any errors that may occur during the forward dialog opening
    log.error('Error opening forward dialog:', error)
  }
}

export function confirmDialog(
  openDialog: OpenDialog,
  message: string,
  confirmLabel: string,
  isConfirmDanger = false
): Promise<boolean> {
  return new Promise((res, _rej) => {
    openDialog(ConfirmationDialog, {
      message,
      confirmLabel,
      isConfirmDanger,
      cb: (yes: boolean) => {
        res(yes)
      },
    })
  })
}

export async function confirmForwardMessage(
  openDialog: OpenDialog,
  accountId: number,
  message: Type.Message,
  chat: Pick<Type.BasicChat, 'name' | 'id'>
) {
  const tx = window.static_translate
  const yes = await confirmDialog(
    openDialog,
    tx('ask_forward', [chat.name]),
    tx('forward')
  )
  if (yes) {
    try {
      if (message.file && message.fileName) {
        // For .prv files, check whether the destination chat is Privitty-protected.
        // If not, the P2P handshake is automatic in the Rust core — we just wait.
        const isPrvFile = message.fileName.toLowerCase().endsWith('.prv')

        if (isPrvFile) {
          // Gap 4+5: Resolve the true source chat (the chat the .prv was
          // originally received in) and check *source* chat encryption —
          // matching Android PrivittyForwardHelper.resolvePrivittySourceChatId()
          // and SendRelayedMessageUtil.handleForwarding() semantics.
          const sourceChatId = await resolvePrivittySourceChatId(
            accountId,
            message
          )
          const isSourceEncrypted = await (
            BackendRemote.rpc as any
          ).privittyIsChatEncrypted(accountId, sourceChatId)

          if (!isSourceEncrypted) {
            runtime.showNotification({
              title: 'Privitty',
              body: 'Establishing Privitty secure channel… Please try forwarding again once the secure connection is ready.',
              icon: null,
              chatId: sourceChatId,
              messageId: 0,
              accountId,
              notificationType: 0,
            })
            return
          }

          // Gap 3: Call privittyInitForwardPeerAdd BEFORE forwardMessages —
          // mirrors Android's SendRelayedMessageUtil order.
          const prvFilePath = message.file.replace(/\\/g, '/')
          try {
            await (BackendRemote.rpc as any).privittyInitForwardPeerAdd(
              accountId,
              sourceChatId,
              chat.id,
              prvFilePath
            )
          } catch (e) {
            log.error('privittyInitForwardPeerAdd failed', e)
            // Proceed with DC forward even if Privitty peer-add fails;
            // the forwardee will see "access not yet granted" and can request.
          }

          await BackendRemote.rpc.forwardMessages(
            accountId,
            [message.id],
            chat.id
          )
        } else {
          await BackendRemote.rpc.forwardMessages(
            accountId,
            [message.id],
            chat.id
          )
        }
      } else {
        await BackendRemote.rpc.forwardMessages(accountId, [message.id], chat.id)
      }
    } catch (e) {
      log.error('confirmForwardMessage: error forwarding', e)
      return
    }
    return yes
  }
}

export function confirmDeleteMessage(
  openDialog: OpenDialog,
  accountId: number,
  msg: Type.Message,
  chat: Type.FullChat
) {
  openDialog(ConfirmDeleteMessageDialog, {
    accountId,
    msg,
    chat,
  })
}

export function openMessageInfo(openDialog: OpenDialog, message: Type.Message) {
  openDialog(MessageDetail, { id: message.id })
}

export function openSecurePDFViewer(
  openDialog: OpenDialog,
  filePath: string,
  fileName: string,
  canDownload?: boolean
) {
  openDialog(SecurePDFViewer, { filePath, fileName, canDownload })
}

export function openSecureImageViewer(
  openDialog: OpenDialog,
  filePath: string,
  fileName: string,
  canDownload?: boolean
) {
  openDialog(SecureImageViewer, { filePath, fileName, canDownload })
}

export function openSecureVideoViewer(
  openDialog: OpenDialog,
  filePath: string,
  fileName: string,
  canDownload?: boolean
) {
  openDialog(SecureVideoViewer, { filePath, fileName, canDownload })
}

export function openSecureViewer(
  openDialog: OpenDialog,
  filePath: string,
  fileName: string,
  viewerType: 'pdf' | 'image' | 'video',
  canDownload?: boolean
) {
  switch (viewerType) {
    case 'pdf':
      openSecurePDFViewer(openDialog, filePath, fileName, canDownload)
      break
    case 'image':
      openSecureImageViewer(openDialog, filePath, fileName, canDownload)
      break
    case 'video':
      openSecureVideoViewer(openDialog, filePath, fileName, canDownload)
      break
  }
}

export function setQuoteInDraft(messageId: number) {
  if (window.__setQuoteInDraft) {
    window.__setQuoteInDraft(messageId)
  } else {
    throw new Error('window.__setQuoteInDraft undefined')
  }
}
/**
 * @throws if the composer is not rendered.
 */
export function enterEditMessageMode(messageToEdit: T.Message) {
  if (window.__enterEditMessageMode) {
    window.__enterEditMessageMode(messageToEdit)
  } else {
    throw new Error('window.__enterEditMessageMode undefined')
  }
}

export async function openMessageHTML(messageId: number) {
  const accountId = selectedAccountId()
  const content = await BackendRemote.rpc.getMessageHtml(accountId, messageId)
  if (!content) {
    log.error('openMessageHTML, message has no html content', { messageId })
    return
  }
  const {
    sender: { displayName },
    subject,
    chatId,
    receivedTimestamp,
  } = await BackendRemote.rpc.getMessage(accountId, messageId)
  const receiveTime = moment(receivedTimestamp * 1000).format('LLLL')
  const { isContactRequest } = await BackendRemote.rpc.getBasicChatInfo(
    accountId,
    chatId
  )
  runtime.openMessageHTML(
    accountId,
    messageId,
    isContactRequest,
    subject,
    displayName,
    receiveTime,
    content
  )
}

export async function downloadFullMessage(messageId: number) {
  await BackendRemote.rpc.downloadFullMessage(selectedAccountId(), messageId)
}

export async function openWebxdc(
  message: Type.Message,
  webxdcInfo?: T.WebxdcMessageInfo
) {
  const accountId = selectedAccountId()
  internalOpenWebxdc(accountId, message, webxdcInfo)
}
