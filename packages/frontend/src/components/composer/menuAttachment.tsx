import React, { useCallback, useContext } from 'react'
import { dirname, basename } from 'path'

import { runtime } from '@deltachat-desktop/runtime-interface'
import { useStore } from '../../stores/store'
import SettingsStoreInstance from '../../stores/settings'
import { IMAGE_EXTENSIONS } from '../../../../shared/constants'
import useConfirmationDialog from '../../hooks/dialog/useConfirmationDialog'
import useTranslationFunction from '../../hooks/useTranslationFunction'
import useDialog from '../../hooks/dialog/useDialog'
import SelectContactDialog from '../dialogs/SelectContact'
import useVideoChat from '../../hooks/useVideoChat'
import { LastUsedSlot, rememberLastUsedPath } from '../../utils/lastUsedPaths'
import { selectedAccountId } from '../../ScreenController'
import Icon from '../Icon'

import { ContextMenuItem } from '../ContextMenu'
import { ContextMenuContext } from '../../contexts/ContextMenuContext'

import { C, type T } from '@privitty/jsonrpc-client'
import { BackendRemote } from '../../backend-com'
import ConfirmSendingFiles from '../dialogs/ConfirmSendingFiles'
import useMessage from '../../hooks/chat/useMessage'
import SmallSelectDialogPrivitty from '../SmallSelectDialogPrivitty'
import { useSharedData } from '../../contexts/FileAttribContext'
//import { set } from 'immutable'

type Props = {
  addFileToDraft: (file: string, fileName: string, viewType: T.Viewtype) => void
  showAppPicker: (show: boolean) => void
  selectedChat: Pick<T.BasicChat, 'name' | 'id'> | null
}

// Main component that creates the menu and popover
export default function MenuAttachment({
  addFileToDraft,
  showAppPicker,
  selectedChat,
}: Props) {
  const { openContextMenu } = useContext(ContextMenuContext)

  const tx = useTranslationFunction()
  const openConfirmationDialog = useConfirmationDialog()
  const { sendVideoChatInvitation } = useVideoChat()
  const { openDialog, closeDialog } = useDialog()
  const { sendMessage } = useMessage()
  const [settings] = useStore(SettingsStoreInstance)
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

  let encryptedFile: string
  const addFilenameFileMod = async () => {
    // function for files
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

      try {
        if (selectedChat?.id) {
          const basicChat = await BackendRemote.rpc.getBasicChatInfo(
            accountId,
            selectedChat.id
          )
          if (basicChat.chatType === C.DC_CHAT_TYPE_GROUP) {
            encryptedFile = await runtime.PrivittySendMessage('sendEvent', {
              event_type: 'groupFileEncryptRequest',
              event_data: {
                group_chat_id: String(selectedChat?.id || 0),
                file_path: filePathName,
              },
            })
          } else {
            encryptedFile = await runtime.PrivittySendMessage('sendEvent', {
              event_type: 'fileEncryptRequest',
              event_data: {
                chat_id: String(selectedChat?.id || 0),
                file_path: filePathName,
                allow_download: fileAttribute.allowDownload,
                allow_forward: fileAttribute.allowForward,
                access_duration: Number(fileAttribute.allowedTime), // duration in seconds (string)
              },
            })
          }
        }
      } catch (e) {
        console.error(
          'Failed to determine chat type, falling back to fileEncryptRequest',
          e
        )
      }

      const data = JSON.parse(encryptedFile)
      const fileName = data.result?.data?.prv_file_name
      const oneTimeKey = data.result?.data?.one_time_key

      //check if file exists
      if (!fileName || fileName === '') {
        console.error('Encrypted file name is empty or undefined:', fileName)
        runtime.showNotification({
          title: 'Privitty',
          body: 'Encrypted file name is empty or undefined',
          icon: null,
          chatId: 0,
          messageId: 0,
          accountId,
          notificationType: 0,
        })
        return
      } else if (!runtime.checkFileExists(fileName)) {
        console.error('Encrypted file does not exist:', fileName)
        runtime.showNotification({
          title: 'Privitty',
          body: 'Encrypted file does not exist',
          icon: null,
          chatId: 0,
          messageId: 0,
          accountId,
          notificationType: 0,
        })
        return
      }

      addFileToDraft(fileName, basename(fileName), 'File')
      setSharedData({
        allowDownload: fileAttribute.allowDownload,
        allowForward: fileAttribute.allowForward,
        allowedTime: fileAttribute.allowedTime,
        FileDirectory: filePathName,
        oneTimeKey: oneTimeKey,
        encryptedFilePath: fileName,
      })

      // Don't delete the file immediately - it will be deleted after the message is sent
      // The file is needed by the backend when the user actually sends the message
      console.log(
        'Encrypted file added to draft, will be deleted after sending:',
        fileName
      )
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

  const addFilenameMedia = async () => {
    // function for media
    await rememberLastUsedPath(LastUsedSlot.Attachment)
    fileFilters = [
      {
        name: tx('image'),
        extensions: IMAGE_EXTENSIONS,
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
          'Failed to determine chat type in addFilenameMedia, falling back to openPrivittyProcess',
          e
        )
      }
    }

    // One-to-one (and fallback): keep existing behavior
    await openPrivittyProcess()
  }

  const onVideoChat = useCallback(async () => {
    if (!selectedChat) {
      return
    }

    const confirmed = await openConfirmationDialog({
      header: tx('videochat_invite_user_to_videochat', selectedChat.name),
      message: tx('videochat_invite_user_hint'),
      confirmLabel: tx('ok'),
    })

    if (confirmed) {
      sendVideoChatInvitation(accountId, selectedChat.id)
    }
  }, [
    accountId,
    openConfirmationDialog,
    selectedChat,
    sendVideoChatInvitation,
    tx,
  ])

  const selectContact = async () => {
    let dialogId = ''
    /**
     * TODO: reduce the overhead: just provide a vcardContact to draft/message
     * and send it as a message. No need to get the vcard from core to create
     * a tmp file to attach it as a file which is then converted into a vcardContact again
     * see https://github.com/deltachat/deltachat-core-rust/pull/5677
     */
    const addContactAsVcard = async (selectedContact: T.Contact) => {
      if (selectedContact) {
        const vCardContact = await BackendRemote.rpc.makeVcard(
          selectedAccountId(),
          [selectedContact.id]
        )
        // Use original name set by contact instead of nickname chosen by user
        const cleanAuthname = (
          selectedContact.authName || selectedContact.address
        ).replace(/[^a-z_A-Z0-9]/gi, '')
        const fileName = `VCard-${cleanAuthname}.vcf`
        const tmp_file = await runtime.writeTempFile(fileName, vCardContact)
        addFileToDraft(tmp_file, fileName, 'Vcard')
        closeDialog(dialogId)
      }
    }
    dialogId = openDialog(SelectContactDialog, { onOk: addContactAsVcard })
  }

  const _selectAppPicker = async () => {
    showAppPicker(true)
  }

  // item array used to populate menu
  const menu: (ContextMenuItem | false)[] = [
    {
      icon: 'person',
      label: tx('contact'),
      action: selectContact.bind(null),
    },
    !!settings?.settings.webrtc_instance && {
      icon: 'phone',
      label: tx('videochat'),
      action: onVideoChat,
    },
    //{
    //  icon: 'apps',
    //  label: tx('webxdc_app'),
    //  action: selectAppPicker.bind(null),
    //  dataTestid: 'open-app-picker',
    //},
    {
      icon: 'upload-file',
      label: tx('file'),
      action: addFilenameFile.bind(null),
    },
    { type: 'separator' },
    {
      icon: 'image',
      label: tx('image'),
      action: addFilenameMedia.bind(null),
    },
  ]

  const onClickAttachmentMenu = async (
    event: React.MouseEvent<any, MouseEvent>
  ) => {
    const result = await runtime.PrivittySendMessage('isChatProtected', {
      chat_id: String(selectedChat?.id),
    })
    const accountid: number =
      (await BackendRemote.rpc.getSelectedAccountId()) || 0
    const basicChat = await BackendRemote.rpc.getBasicChatInfo(
      accountid,
      selectedChat?.id || 0
    )

    const resp = JSON.parse(result)
    try {
      if (resp.result.is_protected == false) {
        // Get contact email dynamically
        let peerEmail // fallback
        let peerId
        try {
          const fullChat = await BackendRemote.rpc.getFullChatById(
            accountid,
            selectedChat?.id || 0
          )
          if (
            fullChat &&
            fullChat.contactIds &&
            fullChat.contactIds.length > 0
          ) {
            const contact = await BackendRemote.rpc.getContact(
              accountid,
              fullChat.contactIds[0]
            )
            if (contact && contact.address) {
              peerId = contact.id
              peerEmail = contact.address
            }
          }
        } catch (error) {
          console.error('Error getting contact email:', error)
          // Use fallback email if there's an error
        }

        const addpeerResponse = await runtime.PrivittySendMessage('sendEvent', {
          event_type: 'initPeerAddRequest',
          event_data: {
            chat_id: String(selectedChat?.id),
            peer_name: basicChat.name,
            peer_email: peerEmail,
            peer_id: String(peerId),
          },
        })
        const parsedResponse = JSON.parse(addpeerResponse)

        if (parsedResponse.result.success == true) {
          // Extract the PDU base64 string directly
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

          const msgId = await BackendRemote.rpc.sendMsg(
            accountId,
            selectedChat?.id || 0,
            {
              ...MESSAGE_DEFAULT,
              ...message,
            }
          )
          console.log('Message sent successfully with ID:', msgId)
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
        return
      }
    } catch (e) {
      console.error('Error in MenuAttachment', e)
      return
    }

    const attachmentMenuButtonElement = document.querySelector(
      '#attachment-menu-button'
    ) as HTMLDivElement

    const boundingBox = attachmentMenuButtonElement.getBoundingClientRect()

    const [x, y] = [boundingBox.x, boundingBox.y]
    event.preventDefault() // prevent default runtime context menu from opening

    openContextMenu({
      x,
      y,
      items: menu,
      ariaAttrs: {
        'aria-labelledby': 'attachment-menu-button',
      },
    })
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
