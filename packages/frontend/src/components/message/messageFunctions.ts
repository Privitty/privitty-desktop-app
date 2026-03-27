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
    await runtime.PrivittySendMessage('sendEvent', {
      event_type: 'fileDecryptRequest',
      event_data: {
        chat_id: String(msg.chatId),
        prv_file: filePathName,
      },
    })

    if (msg.fromId === C.DC_CONTACT_ID_SELF) {
      // we will open the viewer if the file is not downloadable
      log.debug('Opening viewer for non-downloadable file', filePathName)

      const fileAccessResponse = await runtime.PrivittySendMessage(
        'sendEvent',
        {
          event_type: 'getFileAccessStatus',
          event_data: {
            chat_id: String(msg.chatId),
            file_path: filePathName,
          },
        }
      )
      log.debug('fileAccessResponse', fileAccessResponse)

      if (JSON.parse(fileAccessResponse).fileAccessState != 'revoked') {
        // Check if the decrypted file is a supported media type that should be opened in secure viewer
        const decryptedFileExtension = extname(
          msg.fileName.replace('.prv', '')
        ).toLowerCase()
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

        if (
          decryptedFileExtension === '.pdf' ||
          supportedImageExtensions.includes(decryptedFileExtension) ||
          supportedVideoExtensions.includes(decryptedFileExtension)
        ) {
          log.info(
            'Decrypted file is supported media, should be opened in secure viewer',
            {
              filePath: filePathName,
              fileName: msg.fileName,
              extension: decryptedFileExtension,
            }
          )
          // Return a result to indicate this should be opened in secure viewer
          return {
            useSecureViewer: true,
            filePath: filePathName,
            fileName: msg.fileName,
            viewerType:
              decryptedFileExtension === '.pdf'
                ? 'pdf'
                : supportedImageExtensions.includes(decryptedFileExtension)
                  ? 'image'
                  : 'video',
          }
        }
        runtime.openPath(filePathName)
        return
      }
    } else {
      log.debug('Message Functions 2 filePathName', filePathName)
      const fileAccessResponse = await runtime.PrivittySendMessage(
        'sendEvent',
        {
          event_type: 'getFileAccessStatus',
          event_data: {
            chat_id: String(msg.chatId),
            file_path: filePathName,
          },
        }
      )
      log.debug('fileAccessResponse', fileAccessResponse)
      const parsed = JSON.parse(fileAccessResponse)
      if (parsed.result?.data?.success === 'false') {
        //if (JSON.parse(fileAccessResponse).status === 'false') {
        // Check if the decrypted file is a supported media type that should be opened in secure viewer
        const decryptedFileExtension = extname(
          msg.fileName.replace('.prv', '')
        ).toLowerCase()
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
        let viewerType: 'pdf' | 'image' | 'video' | 'media' = 'media'
        if (
          decryptedFileExtension === '.pdf' ||
          supportedImageExtensions.includes(decryptedFileExtension) ||
          supportedVideoExtensions.includes(decryptedFileExtension)
        ) {
          if (supportedImageExtensions.includes(decryptedFileExtension)) {
            viewerType = 'image'
          } else if (
            supportedVideoExtensions.includes(decryptedFileExtension)
          ) {
            viewerType = 'video'
          } else if (decryptedFileExtension === '.pdf') {
            viewerType = 'pdf'
          } else {
            viewerType = 'media'
          }
          log.info(
            'Decrypted file is supported media, should be opened in secure viewer',
            {
              filePath: filePathName,
              fileName: msg.fileName,
              extension: decryptedFileExtension,
            }
          )
          // Return a result to indicate this should be opened in secure viewer
          return {
            useSecureViewer: true,
            filePath: filePathName,
            fileName: msg.fileName,
            viewerType: viewerType,
          }
        }
        //runtime.OpenSecureViewer(filePathName, filePathName)
        //runtime.openPath(filePathName)
        //return
        // Check if the decrypted file is a supported media type and use secure viewer
        const fileExtension = extname(filePathName).toLowerCase()

        if (fileExtension === '.pdf') {
          // For PDFs, we'll use the secure viewer dialog instead of opening in external app
          // This ensures the PDF data stays within the application
          log.info('Opening PDF in secure viewer', {
            filePath: filePathName,
            fileName: msg.fileName,
          })
          return {
            useSecureViewer: true,
            filePath: filePathName,
            fileName: msg.fileName,
            viewerType: 'pdf',
          }
        } else if (supportedImageExtensions.includes(fileExtension)) {
          // For images, use the secure image viewer
          log.info('Opening image in secure viewer', {
            filePath: filePathName,
            fileName: msg.fileName,
          })
          return {
            useSecureViewer: true,
            filePath: filePathName,
            fileName: msg.fileName,
            viewerType: 'image',
          }
        } else if (supportedVideoExtensions.includes(fileExtension)) {
          // For videos, use the secure video viewer
          log.info('Opening video in secure viewer', {
            filePath: filePathName,
            fileName: msg.fileName,
          })
          return {
            useSecureViewer: true,
            filePath: filePathName,
            fileName: msg.fileName,
            viewerType: 'video',
          }
        }
      }
    }
  }

  // For non-PDF files, use the original behavior
  if (!runtime.openPath(filePathName)) {
    log.info(
      "file couldn't be opened, try saving it in a different place and try to open it from there"
    )
  }
}

const privittyForwardable = async (message: T.Message): Promise<boolean> => {
  let isforwardable = true
  if (message.file) {
    isforwardable = false
    if (message.fromId === C.DC_CONTACT_ID_SELF) {
      // check if the file is forwardable
      const response = await runtime.PrivittySendMessage('sendEvent', {
        event_type: 'getFileAccessStatus',
        event_data: {
          chat_id: String(message.chatId),
          file_path: message.file,
        },
      })
      const result = JSON.parse(response)
      log.debug('getFileAccessStatus result', result)

      if (result) {
        isforwardable = result.result?.data?.is_forward === 'true'
      }
    } else {
      const response = await runtime.PrivittySendMessage('sendEvent', {
        event_type: 'getFileAccessStatus',
        event_data: {
          chat_id: String(message.chatId),
          file_path: message.file,
        },
      })
      const result = JSON.parse(response)

      //"result":"{"fileAccessState":"active"}
      if (result) {
        isforwardable = result.result?.data?.is_forward
      }
    }
  }
  return isforwardable
}

export async function openForwardDialog(
  openDialog: OpenDialog,
  message: Type.Message
) {
  const forwardable = await privittyForwardable(message)

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
    if (message.file && message.fileName) {
      const result = await runtime.PrivittySendMessage('isChatProtected', {
        chat_id: String(chat?.id),
      })
      const resp = JSON.parse(result)
      try {
        if (resp.result.is_protected == false) {
          // Get contact email dynamically
          let peerEmail = '' // fallback
          try {
            const fullChat = await BackendRemote.rpc.getFullChatById(
              accountId,
              chat?.id || 0
            )
            if (
              fullChat &&
              fullChat.contactIds &&
              fullChat.contactIds.length > 0
            ) {
              const contact = await BackendRemote.rpc.getContact(
                accountId,
                fullChat.contactIds[0]
              )
              if (contact && contact.address) {
                peerEmail = contact.address
              }
            }
          } catch (error) {
            log.error('Error getting contact email:', error)
            // Use fallback email if there's an error
          }
          const addpeerResponse = await runtime.PrivittySendMessage(
            'sendEvent',
            {
              event_type: 'initPeerAddRequest',
              event_data: {
                chat_id: String(chat.id),
                peer_name: chat.name,
                peer_email: peerEmail,
                peer_id: String(chat.id),
              },
            }
          )
          log.debug('addpeerResponse', addpeerResponse)
          const parsedResponse = JSON.parse(addpeerResponse)
          if (parsedResponse.result.success == true) {
            const pdu = parsedResponse?.result?.data?.pdu

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
              text: pdu,
              file: undefined,
              filename: undefined,
              quotedMessageId: null,
              viewtype: 'Text',
            }

            await BackendRemote.rpc.sendMsg(accountId, chat?.id || 0, {
              ...MESSAGE_DEFAULT,
              ...message,
            })
          } else {
            runtime.showNotification({
              title: 'Privitty',
              body: 'Privitty ADD peer state =' + parsedResponse.message_type,
              icon: null,
              chatId: 0,
              messageId: 0,
              accountId,
              notificationType: 0,
            })
            return
          }
          runtime.showNotification({
            title: 'Privitty',
            body: 'Enabling Privitty security',
            icon: null,
            chatId: 0,
            messageId: 0,
            accountId,
            notificationType: 0,
          })

          // Wait until Privitty protection is actually enabled for this chat
          await waitForPrivittyProtection(chat.id)
        }

        await BackendRemote.rpc.forwardMessages(
          accountId,
          [message.id],
          chat.id
        )
        //work around for privitty file forwarding create the temp
        const tmpFile = await runtime.copyFileToInternalTmpDir(
          message.fileName,
          message.file
        )
        let filePathName1 = tmpFile
        filePathName1 = tmpFile.replace(/\\/g, '/')

        //we need to send a split key to the peer
        const _filePathName = message.file.replace(/\\/g, '/')

        const responseFwdPeerAdd = await runtime.PrivittySendMessage(
          'sendEvent',
          {
            event_type: 'initForwardPeerAddRequest',
            event_data: {
              chat_id: String(message.chatId),
              forwardee_chat_id: String(chat.id),
              prv_file: filePathName1,
            },
          }
        )
        const parsedResponse = JSON.parse(responseFwdPeerAdd)
        log.debug('parsedResponse', parsedResponse)

        if (parsedResponse.result?.data?.status === 'success') {
          const pdu = parsedResponse.result?.data?.pdu
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
            text: pdu,
            file: undefined,
            filename: undefined,
            quotedMessageId: null,
            viewtype: 'Text',
          }
          await BackendRemote.rpc.sendMsg(accountId, chat?.id || 0, {
            ...MESSAGE_DEFAULT,
            ...message,
          })
        }
      } catch (e) {
        log.error('Error in Enabling Privitty Secure', e)
        return
      }
    } else {
      await BackendRemote.rpc.forwardMessages(accountId, [message.id], chat.id)
    }
    return yes
  }
}

// Waits until a chat becomes Privitty-protected.
async function waitForPrivittyProtection(chatId: number): Promise<void> {
  try {
    const resp = await runtime.PrivittySendMessage('isChatProtected', {
      chat_id: String(chatId),
    })
    const parsed = JSON.parse(resp)
    if (parsed?.result?.is_protected === true) {
      return
    }
  } catch {
    // Ignore immediate check errors and fall back to event listener.
  }

  await new Promise<void>(resolve => {
    const unsubscribe = runtime.onPrivittyMessageDetected(
      (protectedChatId: number) => {
        if (protectedChatId === chatId) {
          unsubscribe()
          resolve()
        }
      }
    )
  })
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
