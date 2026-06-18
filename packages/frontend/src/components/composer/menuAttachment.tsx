import React from 'react'
import { dirname, basename } from 'path'

import { runtime } from '@deltachat-desktop/runtime-interface'
import { IMAGE_EXTENSIONS } from '../../../../shared/constants'
import useTranslationFunction from '../../hooks/useTranslationFunction'
import useDialog from '../../hooks/dialog/useDialog'
import { LastUsedSlot, rememberLastUsedPath } from '../../utils/lastUsedPaths'
import { selectedAccountId } from '../../ScreenController'
import Icon from '../Icon'

import { C, type T } from '@privitty/jsonrpc-client'
import { BackendRemote } from '../../backend-com'
import ConfirmSendingFiles from '../dialogs/ConfirmSendingFiles'
import useMessage from '../../hooks/chat/useMessage'
import SmallSelectDialogPrivitty from '../SmallSelectDialogPrivitty'
import { useSharedData } from '../../contexts/FileAttribContext'
import { encryptFileForChat } from '../../utils/privittyEncryptFile'

type Props = {
  addFileToDraft: (file: string, fileName: string, viewType: T.Viewtype) => void
  showAppPicker: (show: boolean) => void
  selectedChat: Pick<T.BasicChat, 'name' | 'id'> | null
}

// Opens the File Attributes flow directly when the attachment button is clicked.
export default function MenuAttachment({
  addFileToDraft,
  selectedChat,
}: Props) {
  const tx = useTranslationFunction()
  const { openDialog, closeDialog } = useDialog()
  const { sendMessage } = useMessage()
  const accountId = selectedAccountId()
  const { setSharedData } = useSharedData()

  const confirmSendMultipleFiles = (
    filePaths: string[],
    msgViewType: T.Viewtype
  ) => {
    if (!selectedChat) {
      throw new Error('no chat selected')
    }
    openDialog(ConfirmSendingFiles, {
      sanitizedFileList: filePaths.map(path => ({ name: basename(path) })),
      chatName: selectedChat.name,
      onClick: async (isConfirmed: boolean) => {
        if (!isConfirmed) {
          return
        }

        for (const filePath of filePaths) {
          await sendMessage(accountId, selectedChat.id, {
            file: filePath,
            filename: basename(filePath),
            viewtype: msgViewType,
          })
          // start sending other files, don't wait until last file is sent
          if (runtime.getRuntimeInfo().target === 'browser') {
            // browser created temp files during upload that can now be cleaned up
            runtime.removeTempFile(filePath)
          }
        }
      },
    })
  }

  const addFilenameFileMod = async () => {
    const { defaultPath, setLastPath } = await rememberLastUsedPath(
      LastUsedSlot.Attachment
    )
    const files = await runtime.showOpenFileDialog({
      filters: fileFilters,
      properties: ['openFile' /*, 'multiSelections'*/],
      defaultPath,
    })

    if (files.length === 1) {
      setLastPath(dirname(files[0]))
      const filePathName = files[0].replace(/\\/g, '/')

      if (!selectedChat?.id) return

      const enc = await encryptFileForChat(
        accountId,
        selectedChat.id,
        filePathName,
        fileAttribute
      )
      if (!enc) return

      addFileToDraft(enc.encryptedPath, basename(enc.encryptedPath), 'File')
      setSharedData({
        allowDownload: fileAttribute.allowDownload,
        allowForward: fileAttribute.allowForward,
        allowedTime: fileAttribute.allowedTime,
        FileDirectory: enc.originalPath,
        oneTimeKey: enc.oneTimeKey,
        encryptedFilePath: enc.encryptedPath,
      })
    } else if (files.length > 1) {
      confirmSendMultipleFiles(files, 'File')
    }
  }
  let fileAttribute: {
    allowDownload: boolean
    allowForward: boolean
    allowedTime: string
  }

  const openPrivittyProcess = async () => {
    const smallDialogID = await openDialog(SmallSelectDialogPrivitty, {
      initialSelectedValue: {
        allowDownload: false,
        allowForward: false,
        allowedTime: '',
      },
      values: [],
      onSave: async (selectedValue: {
        allowDownload: boolean
        allowForward: boolean
        allowedTime: string
      }) => {
        if (selectedValue) {
          fileAttribute = selectedValue
          if (fileAttribute.allowDownload === true) {
            if (fileFilters[0].name === tx('file')) {
              fileFilters = [
                {
                  name: tx('file'),
                  extensions: ['*'],
                },
              ]
            }
          } else {
            if (fileFilters[0].name === tx('file')) {
              fileFilters = [
                {
                  name: tx('file'),
                  extensions: [
                    'jpg',
                    'jpeg',
                    'png',
                    'gif',
                    'bmp',
                    'tiff',
                    'tif',
                    'webp',
                    'svg',
                    'mp4',
                    'avi',
                    'mov',
                    'wmv',
                    'flv',
                    'webm',
                    'mkv',
                    'm4v',
                    'pdf',
                  ],
                },
              ]
            }
          }
        }
        closeDialog(smallDialogID)
        await addFilenameFileMod()
      },
      title: 'File Attributes',
      onClose: async (isConfirmed: boolean) => {
        closeDialog(smallDialogID)
        if (!isConfirmed) {
          return
        }
      },
      onCancel: () => {
        console.log('Dialog cancelled')
        closeDialog(smallDialogID)
        return
      },
    })
  }

  let fileFilters = [
    {
      name: tx('image'),
      extensions: IMAGE_EXTENSIONS,
    },
  ]

  const addFilenameFile = async () => {
    fileFilters = [
      {
        name: tx('file'),
        extensions: ['*'],
      },
    ]

    // Group chats: skip Privitty attribute dialog, go straight to file selection
    if (selectedChat) {
      try {
        const basicChat = await BackendRemote.rpc.getBasicChatInfo(
          accountId,
          selectedChat.id
        )
        if (basicChat.chatType === C.DC_CHAT_TYPE_GROUP) {
          fileAttribute = {
            allowDownload: false,
            allowForward: false,
            allowedTime: '',
          }
          await addFilenameFileMod()
          return
        }
      } catch (e) {
        console.error(
          'Failed to determine chat type in addFilenameFile, falling back to openPrivittyProcess',
          e
        )
      }
    }

    // One-to-one (and fallback): keep existing behavior
    await openPrivittyProcess()
  }

  const onClickAttachmentMenu = async () => {
    if (!selectedChat?.id) return

    try {
      const isEncrypted = await (
        BackendRemote.rpc as any
      ).privittyIsChatEncrypted(accountId, selectedChat.id)

      if (!isEncrypted) {
        // Peer handshake is initiated automatically by the Privitty core once
        // both sides have exchanged at least one message.  Tell the user to
        // wait; the composer will refresh automatically on PrivittyPeerHandshakeComplete.
        runtime.showNotification({
          title: 'Privitty',
          body: 'Establishing Privitty secure channel… Please send a message first and wait for the secure connection to be ready.',
          icon: null,
          chatId: selectedChat.id,
          messageId: 0,
          accountId,
          notificationType: 0,
        })
        return
      }
    } catch (e) {
      console.error('onClickAttachmentMenu: privittyIsChatEncrypted failed', e)
      // If the check fails (server not yet ready), fall through so the user
      // is not completely blocked.
    }

    await addFilenameFile()
  }

  return (
    <button
      aria-label={tx('menu_add_attachment')}
      id='attachment-menu-button'
      data-testid='open-attachment-menu'
      className='attachment-button'
      onClick={onClickAttachmentMenu}
    >
      <Icon coloring='contextMenu' icon='paperclip' />
    </button>
  )
}
