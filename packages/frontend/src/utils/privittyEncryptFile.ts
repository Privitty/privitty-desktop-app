import { runtime } from '@deltachat-desktop/runtime-interface'
import { C } from '@privitty/jsonrpc-client'

import { BackendRemote } from '../backend-com'
import { getLogger } from '../../../shared/logger'

const log = getLogger('renderer/privittyEncryptFile')

/** Same defaults as group / menu path in menuAttachment.tsx (addFilenameFile). */
const DEFAULT_FILE_ATTR = {
  allowDownload: false,
  allowForward: false,
  allowedTime: '',
} as const

export type EncryptFileForChatResult = {
  encryptedPath: string
  oneTimeKey: string
  originalPath: string
}

/**
 * Encrypts a local file for the given chat using the same APIs as menuAttachment:
 * - group: `groupFileEncryptRequest`
 * - 1:1: `fileEncryptRequest` with default attributes
 */
export async function encryptFileForChat(
  accountId: number,
  chatId: number,
  plainFilePath: string
): Promise<EncryptFileForChatResult | null> {
  const normalized = plainFilePath.replace(/\\/g, '/')
  let encryptedFile: string
  try {
    const basicChat = await BackendRemote.rpc.getBasicChatInfo(accountId, chatId)
    if (basicChat.chatType === C.DC_CHAT_TYPE_GROUP) {
      encryptedFile = await runtime.PrivittySendMessage('sendEvent', {
        event_type: 'groupFileEncryptRequest',
        event_data: {
          group_chat_id: String(chatId),
          file_path: normalized,
        },
      })
    } else {
      encryptedFile = await runtime.PrivittySendMessage('sendEvent', {
        event_type: 'fileEncryptRequest',
        event_data: {
          chat_id: String(chatId),
          file_path: normalized,
          allow_download: DEFAULT_FILE_ATTR.allowDownload,
          allow_forward: DEFAULT_FILE_ATTR.allowForward,
          access_duration: Number(DEFAULT_FILE_ATTR.allowedTime),
        },
      })
    }
  } catch (e) {
    log.error('encryptFileForChat: PrivittySendMessage failed', e)
    return null
  }

  const data = JSON.parse(encryptedFile)
  const prvFileName = data.result?.data?.prv_file_name
  const oneTimeKey = data.result?.data?.one_time_key

  if (!prvFileName || prvFileName === '') {
    log.error('encryptFileForChat: empty prv_file_name')
    runtime.showNotification({
      title: 'Privitty',
      body: 'Encrypted file name is empty or undefined',
      icon: null,
      chatId: 0,
      messageId: 0,
      accountId,
      notificationType: 0,
    })
    return null
  }

  if (!(await runtime.checkFileExists(prvFileName))) {
    log.error('encryptFileForChat: encrypted file does not exist', prvFileName)
    runtime.showNotification({
      title: 'Privitty',
      body: 'Encrypted file does not exist',
      icon: null,
      chatId: 0,
      messageId: 0,
      accountId,
      notificationType: 0,
    })
    return null
  }

  return {
    encryptedPath: prvFileName,
    oneTimeKey: oneTimeKey ?? '',
    originalPath: normalized,
  }
}
