import React, { useState, useEffect, useRef } from 'react'
import classNames from 'classnames'
import { filesize } from 'filesize'

import {
  confirmDialog,
  openAttachmentInShell,
  openSecureViewer,
} from '../message/messageFunctions'
import {
  isDisplayableByFullscreenMedia,
  isImage,
  isVideo,
  isAudio,
  getExtension,
  dragAttachmentOut,
  MessageTypeAttachmentSubset,
} from './Attachment'
import { runtime } from '@deltachat-desktop/runtime-interface'
import { getDirection } from '../../utils/getDirection'
import { BackendRemote, Type } from '../../backend-com'
import FullscreenMedia, {
  NeighboringMediaMode,
} from '../dialogs/FullscreenMedia'
import useTranslationFunction from '../../hooks/useTranslationFunction'
import useDialog from '../../hooks/dialog/useDialog'
import AudioPlayer from '../AudioPlayer'
import { T, C } from '@privitty/jsonrpc-client'
import { selectedAccountId } from '../../ScreenController'
import { extname } from 'path'

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

type AttachmentProps = {
  text?: string
  message: Type.Message
  tabindexForInteractiveContents: -1 | 0
  privittyStatus?: PrivittyStatus
}

/**
 * Gets the background color and text color for the file attachment based on the Privitty status.
 * Returns an object with backgroundColor and textColor, or null for default styling.
 */
function getPrivittyFileColors(
  status: PrivittyStatus | null | undefined,
  direction: 'incoming' | 'outgoing'
): { backgroundColor: string; textColor: string } | null {
  // For outgoing messages, default is white with black text
  if (direction === 'outgoing') {
    switch (status) {
      case 'revoked':
        return { backgroundColor: '#C4891B', textColor: '#FFFFFF' } // Yellow with white text
      case 'expired':
        return { backgroundColor: '#808080', textColor: '#FFFFFF' } // Grey with white text
      case 'denied':
        return { backgroundColor: '#D93229', textColor: '#FFFFFF' } // Red with white text
      default:
        return null // Keep default white with black text
    }
  } else {
    // For incoming messages, default is purple (#7F66C5) with white text
    switch (status) {
      case 'none':
      case 'not_found':
        // Android: amber #9E6B00 for forwardee awaiting grant
        return { backgroundColor: '#9E6B00', textColor: '#FFFFFF' }
      case 'revoked':
        return { backgroundColor: '#C4891B', textColor: '#FFFFFF' }
      case 'expired':
        return { backgroundColor: '#808080', textColor: '#FFFFFF' }
      case 'denied':
        return { backgroundColor: '#D93229', textColor: '#FFFFFF' }
      default:
        return null // Keep default purple with white text
    }
  }
}

export default function Attachment({
  text,
  message,
  tabindexForInteractiveContents,
  privittyStatus,
}: AttachmentProps) {
  const tx = useTranslationFunction()
  const { openDialog } = useDialog()
  if (!message.file) {
    return null
  }
  const direction = getDirection(message)
  const fileColors = getPrivittyFileColors(privittyStatus, direction)
  const onClickAttachment = async (ev: any) => {
    if (message.viewType === 'Sticker') return
    ev.stopPropagation()
    if (isDisplayableByFullscreenMedia(message.fileMime)) {
      openDialog(FullscreenMedia, {
        msg: message,
        neighboringMedia: NeighboringMediaMode.Chat,
      })
    } else {
      // Check if this is a supported media file (including .prv files that decrypt to supported formats)
      const supportedExtensions = [
        '.pdf',
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.bmp',
        '.webp',
        '.svg',
        '.mp4',
        '.avi',
        '.mov',
        '.wmv',
        '.flv',
        '.webm',
        '.mkv',
        '.m4v',
      ]
      const isSupportedMedia =
        message.fileName?.toLowerCase().endsWith('.prv') ||
        supportedExtensions.some(ext =>
          message.fileName?.toLowerCase().endsWith(ext)
        )

      if (isSupportedMedia) {
        // Check if this is a supported media file that should be opened in secure viewer
        const fileName = message.fileName?.toLowerCase() || ''
        const cleanedFileName = fileName.endsWith('.prv')
          ? fileName.slice(0, -4)
          : fileName
        const fileExtension = cleanedFileName.split('.').pop() || ''

        const supportedImageExtensions = [
          'jpg',
          'jpeg',
          'png',
          'gif',
          'bmp',
          'webp',
          'svg',
        ]
        const supportedVideoExtensions = [
          'mp4',
          'avi',
          'mov',
          'wmv',
          'flv',
          'webm',
          'mkv',
          'm4v',
        ]

        if (
          fileExtension === 'pdf' ||
          supportedImageExtensions.includes(fileExtension) ||
          supportedVideoExtensions.includes(fileExtension)
        ) {
          try {
            // For supported media files, we need to get the file path and open in secure viewer
            let tmpFile: string
            try {
              tmpFile = await runtime.copyFileToInternalTmpDir(
                message.fileName || '',
                message.file || ''
              )
            } catch (_copyError) {
              // Show user-friendly error message
              runtime.showNotification({
                title: 'Media File Error',
                body: 'The media file could not be opened because it is no longer available. It may have been deleted or moved.',
                icon: null,
                chatId: message.chatId,
                messageId: message.id,
                accountId: selectedAccountId(),
                notificationType: 0,
              })

              // Fall back to regular opening
              openAttachmentInShell(message)
              return
            }

            let filePathName = tmpFile.replace(/\\/g, '/')

            // Handle .prv files (encrypted files)
            // Normalize message.file to forward-slashes — required on Windows where
            // DC returns backslash paths that don't match Privitty's internal paths.
            const blobFilePath = (message.file || '').replace(/\\/g, '/')
            const accountIdForFile = selectedAccountId()

            // Fetch file access status via JSONRPC
            let fileId: T.I64 = 0 as unknown as T.I64
            let displayStatus: T.PrivittyFileDisplayStatus | null = null
            try {
              fileId = await (BackendRemote.rpc as any).privittyGetFileIdByPath(
                accountIdForFile,
                blobFilePath
              )
              displayStatus = await (
                BackendRemote.rpc as any
              ).privittyGetFileDisplayStatus(accountIdForFile, fileId)
            } catch (e) {
              console.error('Failed to get Privitty file display status', e)
            }

            const fileAccessStatus = displayStatus?.state_str ?? null
            const canDownload = displayStatus?.allow_download ?? false
            // Use Privitty's own is_forwarded flag — more reliable than DC's
            // isForwarded message flag which can be absent in some relay paths.
            const isPrivittyForwarded =
              displayStatus?.is_forwarded ??
              (Boolean(message.isForwarded) && message.viewType === 'File')
            let decryptError: string | null = null

            // Helper: decrypt via the correct JSONRPC API based on chat type.
            // Both P2P and forwarded paths use the same underlying methods.
            const decryptPrvFile = async (): Promise<string> => {
              const basicChat = await BackendRemote.rpc.getBasicChatInfo(
                accountIdForFile,
                message.chatId
              )
              let decryptedPath: string
              if (basicChat.chatType === C.DC_CHAT_TYPE_GROUP) {
                decryptedPath = await (
                  BackendRemote.rpc as any
                ).privittyDecryptGroupFile(
                  accountIdForFile,
                  message.chatId,
                  message.id,
                  filePathName
                )
              } else {
                decryptedPath = await (
                  BackendRemote.rpc as any
                ).privittyDecryptFile(
                  accountIdForFile,
                  message.chatId,
                  message.id,
                  filePathName
                )
              }
              return decryptedPath.replace(/\\/g, '/')
            }

            if (!isPrivittyForwarded) {
              if (direction === 'outgoing') {
                // Sender always decrypts — they own the file, no access check needed.
                try {
                  filePathName = await decryptPrvFile()
                } catch (e) {
                  decryptError =
                    e instanceof Error ? e.message : 'File decryption failed.'
                }
              } else {
                // Receiver: gate on access status
                if (fileAccessStatus === 'expired') {
                  const yes = await confirmDialog(
                    openDialog,
                    'This file is no longer accessible. You can request access from the owner to view it again.',
                    'SEND REQUEST'
                  )
                  if (!yes) return
                  // Request renewal — core sends the PDU automatically
                  try {
                    await (
                      BackendRemote.rpc as any
                    ).privittyInitForwardAccessRequest(
                      accountIdForFile,
                      message.chatId,
                      fileId
                    )
                  } catch (e) {
                    console.error('privittyInitForwardAccessRequest failed', e)
                  }
                  return
                }

                if (fileAccessStatus === 'revoked') {
                  await confirmDialog(
                    openDialog,
                    'This file is no longer accessible. This file is revoked',
                    'OK'
                  )
                  return
                }

                // ACTIVE or not yet registered — attempt decryption.
                try {
                  filePathName = await decryptPrvFile()
                } catch (e) {
                  decryptError =
                    e instanceof Error ? e.message : 'File decryption failed.'
                }
              }
            } else {
              // Forwarded .prv — mirror Android's ConversationItem click logic
              const sendForwardAccessRequest = async () => {
                try {
                  await (
                    BackendRemote.rpc as any
                  ).privittyInitForwardAccessRequest(
                    accountIdForFile,
                    message.chatId,
                    fileId
                  )
                  runtime.showNotification({
                    title: 'Privitty',
                    body: 'Requesting file access permission from owner…',
                    icon: null,
                    chatId: message.chatId,
                    messageId: message.id,
                    accountId: accountIdForFile,
                    notificationType: 0,
                  })
                } catch (e) {
                  console.error('privittyInitForwardAccessRequest failed', e)
                }
              }

              if (
                fileAccessStatus === 'none' ||
                fileAccessStatus === 'not_found' ||
                !fileAccessStatus
              ) {
                // Access not yet requested — show dialog, Android parity
                const yes = await confirmDialog(
                  openDialog,
                  'You need permission to access this file. Would you like to request access from the owner?',
                  'Send Request'
                )
                if (!yes) return
                await sendForwardAccessRequest()
                return
              } else if (
                fileAccessStatus === 'requested' ||
                fileAccessStatus === 'waiting_owner_action'
              ) {
                runtime.showNotification({
                  title: 'Privitty',
                  body: 'Access request already pending. Please wait for the owner to respond.',
                  icon: null,
                  chatId: message.chatId,
                  messageId: message.id,
                  accountId: accountIdForFile,
                  notificationType: 0,
                })
                return
              } else if (fileAccessStatus === 'expired') {
                const yes = await confirmDialog(
                  openDialog,
                  'This file is no longer accessible. You can request access from the owner to view it again.',
                  'SEND REQUEST'
                )
                if (!yes) return
                await sendForwardAccessRequest()
                return
              } else if (fileAccessStatus === 'revoked') {
                await confirmDialog(
                  openDialog,
                  'This file is no longer accessible. Access has been revoked by the owner.',
                  'OK'
                )
                return
              } else if (fileAccessStatus === 'denied') {
                await confirmDialog(
                  openDialog,
                  'Access to this file was denied by the owner.',
                  'OK'
                )
                return
              } else if (fileAccessStatus === 'active') {
                try {
                  filePathName = await decryptPrvFile()
                } catch (e) {
                  decryptError =
                    e instanceof Error ? e.message : 'File decryption failed.'
                }
              }
            }

            // Safety guard: if the path still points to the encrypted .prv file
            // it means decryption did not return a valid output path (e.g. Privitty
            // service error, or file not yet registered).  Opening the encrypted
            // bytes in SecurePDFViewer would give "Invalid PDF structure".
            if (filePathName.toLowerCase().endsWith('.prv')) {
              const errorMsg =
                decryptError ||
                'The file could not be decrypted. The Privitty service may not have completed the key exchange for this file yet. Please try again in a moment.'
              await confirmDialog(openDialog, errorMsg, 'OK')
              return
            }

            // Determine the correct viewer type based on file extension
            let viewerType: 'pdf' | 'image' | 'video' = 'pdf'
            const finalFileExtension = extname(filePathName).toLowerCase()

            if (finalFileExtension === '.pdf') {
              viewerType = 'pdf'
            } else if (
              [
                '.jpg',
                '.jpeg',
                '.png',
                '.gif',
                '.bmp',
                '.webp',
                '.svg',
              ].includes(finalFileExtension)
            ) {
              viewerType = 'image'
            } else if (
              [
                '.mp4',
                '.avi',
                '.mov',
                '.wmv',
                '.flv',
                '.webm',
                '.mkv',
                '.m4v',
              ].includes(finalFileExtension)
            ) {
              viewerType = 'video'
            }
            // Open in appropriate secure viewer
            openSecureViewer(
              openDialog,
              filePathName,
              message.fileName || '',
              viewerType,
              canDownload
            )
          } catch (error) {
            console.error('Error opening media in secure viewer:', error)
            // Fallback to regular opening
            openAttachmentInShell(message)
          }
        } else {
          // For non-PDF files, use the regular opening method
          const result = await openAttachmentInShell(message)
          if (result?.useSecureViewer) {
            openSecureViewer(
              openDialog,
              result.filePath!,
              result.fileName!,
              result.viewerType as 'pdf' | 'image' | 'video'
            )
          }
        }
      } else {
        const result = await openAttachmentInShell(message)
        if (result?.useSecureViewer) {
          openSecureViewer(
            openDialog,
            result.filePath!,
            result.fileName!,
            result.viewerType as 'pdf' | 'image' | 'video'
          )
        }
      }
    }
  }

  /**
   * height has to be calculated before images are loaded to enable
   * the virtual list to calculate the correct height of all messages
   *
   * if the image exceeds the maximal width or height it will be scaled down
   * if the image exceeds the minimal width or height it will be scaled up
   *
   * if after resizing one dimension exceeds a maximum it will be cropped
   * by css rules: max-width/max-height with object-fit: cover
   */
  const calculateHeight = (
    message: Pick<
      T.Message,
      'dimensionsHeight' | 'dimensionsWidth' | 'viewType'
    >
  ): number => {
    const minWidth = 200 // needed for readable footer & reactions
    const minHeight = 50 // needed for readable footer
    const maxLandscapeWidth = 450 // also set by css
    const maxPortraitHeight = 450 // also set by css
    const stickerHeight = 200

    if (message.viewType === 'Sticker') {
      return stickerHeight
    }

    const height = message.dimensionsHeight
    const width = message.dimensionsWidth
    const portrait = isPortrait(message)
    let finalHeight: number
    if (portrait) {
      // limit height if needed
      finalHeight = Math.min(height, maxPortraitHeight)
      if (height < maxPortraitHeight) {
        if ((finalHeight / height) * width < minWidth) {
          // stretch image to have minWidth
          finalHeight = (height / width) * minWidth
        }
      }
    } else {
      // make sure image is not wider than maxWidth
      finalHeight = Math.min(height, (maxLandscapeWidth / width) * height)
      if ((finalHeight / height) * width < minWidth) {
        // stretch image to have minWidth
        finalHeight = (height / width) * minWidth
      }
      if (finalHeight < minHeight) {
        finalHeight = minHeight
      }
    }
    return finalHeight
  }

  const isPortrait = (
    message: Pick<T.Message, 'dimensionsHeight' | 'dimensionsWidth'>
  ): boolean => {
    if (message.dimensionsHeight === 0 || message.dimensionsWidth === 0) {
      return false
    }
    return message.dimensionsHeight > message.dimensionsWidth
  }

  const withCaption = Boolean(text)
  // For attachments which aren't full-frame
  const withContentBelow = withCaption
  if (isImage(message.fileMime) || message.viewType === 'Sticker') {
    if (!message.file) {
      return (
        <div
          className={classNames('message-attachment-broken-media', direction)}
        >
          {tx('attachment_failed_to_load')}
        </div>
      )
    }
    return (
      <button
        onClick={onClickAttachment}
        tabIndex={tabindexForInteractiveContents}
        className={classNames(
          'message-attachment-media',
          withCaption ? 'content-below' : null
        )}
      >
        <img
          className={classNames(
            'attachment-content',
            isPortrait(message) ? 'portrait' : null,
            message.viewType === 'Sticker' ? 'sticker' : null
          )}
          src={runtime.transformBlobURL(message.file)}
          height={calculateHeight(message)}
        />
      </button>
    )
  } else if (isVideo(message.fileMime)) {
    if (!message.file) {
      return (
        <button
          onClick={onClickAttachment}
          tabIndex={tabindexForInteractiveContents}
          style={{ cursor: 'pointer' }}
          className={classNames('message-attachment-broken-media', direction)}
        >
          {tx('attachment_failed_to_load')}
        </button>
      )
    }
    // the native fullscreen option is better right now so we don't need to open our own one
    return (
      <div
        className={classNames(
          'message-attachment-media',
          withCaption ? 'content-below' : null
        )}
      >
        <video
          className='attachment-content video-content'
          src={runtime.transformBlobURL(message.file)}
          controls={true}
          // Despite the element having multiple interactive
          // (pseudo?) elements inside of it, tabindex applies to all of them.
          tabIndex={tabindexForInteractiveContents}
        />
      </div>
    )
  } else if (isAudio(message.fileMime)) {
    return (
      <div
        className={classNames(
          'message-attachment-audio',
          withContentBelow ? 'content-below' : null
        )}
      >
        <AudioPlayer
          src={runtime.transformBlobURL(message.file)}
          // Despite the element having multiple interactive
          // (pseudo?) elements inside of it, tabindex applies to all of them.
          tabIndex={tabindexForInteractiveContents}
        />
      </div>
    )
  } else {
    const { fileName, fileBytes, fileMime }: MessageTypeAttachmentSubset =
      message

    const extension = getExtension(message)
    return (
      <button
        className={classNames(
          'message-attachment-generic',
          withContentBelow ? 'content-below' : null
        )}
        style={
          fileColors
            ? { backgroundColor: fileColors.backgroundColor }
            : undefined
        }
        onClick={onClickAttachment}
        tabIndex={tabindexForInteractiveContents}
      >
        <div
          className='file-icon'
          draggable='true'
          onDragStart={dragAttachmentOut.bind(null, message.file)}
          title={fileMime || 'null'}
        >
          {extension ? (
            <div className='file-extension'>
              {fileMime === 'application/octet-stream' ? '' : extension}
            </div>
          ) : null}
        </div>
        <div
          className='text-part'
          style={fileColors ? { color: fileColors.textColor } : undefined}
        >
          <div
            className='name'
            style={fileColors ? { color: fileColors.textColor } : undefined}
          >
            {fileName}
          </div>
          <div
            className='size'
            style={fileColors ? { color: fileColors.textColor } : undefined}
          >
            {fileBytes ? filesize(fileBytes) : '?'}
          </div>
        </div>
      </button>
    )
  }
}

export function DraftAttachment({
  attachment,
}: {
  attachment: MessageTypeAttachmentSubset
}) {
  const [webxdcInfo, setWebxdcInfo] = useState<T.WebxdcMessageInfo | null>(null)
  const [isLoadingWebxdcInfo, setIsLoadingWebxdcInfo] = useState(true)
  const accountId = selectedAccountId()

  const lastFileNameRef = useRef<string | null>(null)

  useEffect(() => {
    if (attachment.viewType === 'Webxdc') {
      // Only load webxdc info if filename has changed
      if (attachment.fileName !== lastFileNameRef.current) {
        lastFileNameRef.current = attachment.fileName
        setIsLoadingWebxdcInfo(true)
        BackendRemote.rpc
          .getWebxdcInfo(accountId, attachment.id)
          .then((info: T.WebxdcMessageInfo) => {
            setWebxdcInfo(info)
          })
          .catch((error: any) => {
            console.error(
              'Failed to load webxdc info for draft:',
              attachment.id,
              error
            )
            setWebxdcInfo(null)
          })
          .finally(() => {
            setIsLoadingWebxdcInfo(false)
          })
      }
    }
  }, [accountId, attachment.id, attachment.viewType, attachment.fileName])

  if (!attachment) {
    return null
  }
  if (isImage(attachment.fileMime)) {
    return (
      <div className={classNames('message-attachment-media')}>
        <img
          className='attachment-content'
          src={runtime.transformBlobURL(attachment.file || '')}
        />
      </div>
    )
  } else if (isVideo(attachment.fileMime)) {
    return (
      <div className={classNames('message-attachment-media')}>
        <video
          className='attachment-content'
          src={runtime.transformBlobURL(attachment.file || '')}
          controls
        />
      </div>
    )
  } else if (isAudio(attachment.fileMime)) {
    return <AudioPlayer src={runtime.transformBlobURL(attachment.file || '')} />
  } else if (attachment.viewType === 'Webxdc') {
    const iconUrl = runtime.getWebxdcIconURL(selectedAccountId(), attachment.id)
    return (
      <div className='media-attachment-webxdc'>
        <img className='icon' src={iconUrl} alt='app icon' />
        <div className='text-part'>
          <div className='name'>
            {isLoadingWebxdcInfo
              ? 'Loading...'
              : webxdcInfo?.name || 'Unknown App'}
          </div>
          <div className='size'>{filesize(attachment.fileBytes ?? 0)}</div>
        </div>
      </div>
    )
  } else {
    const { file, fileName, fileBytes, fileMime } = attachment
    const extension = getExtension(attachment)

    return (
      <div className={classNames('message-attachment-generic')}>
        <div
          className='file-icon'
          draggable='true'
          onDragStart={ev => file && dragAttachmentOut(file, ev)}
          title={fileMime || 'null'}
        >
          {extension ? (
            <div className='file-extension'>
              {fileMime === 'application/octet-stream' ? '' : extension}
            </div>
          ) : null}
        </div>
        <div className='text-part'>
          <div className='name'>{fileName}</div>
          <div className='size'>{filesize(fileBytes ?? 0)}</div>
        </div>
      </div>
    )
  }
}
