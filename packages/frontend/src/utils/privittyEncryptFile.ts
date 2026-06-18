import { C } from '@privitty/jsonrpc-client'

import { BackendRemote } from '../backend-com'
import { getLogger } from '../../../shared/logger'

const log = getLogger('renderer/privittyEncryptFile')

const DEFAULT_FILE_ATTR = {
  allowDownload: false,
  allowForward: false,
  allowedTime: '',
} as const

export type EncryptFileForChatResult = {
  encryptedPath: string
  /** @deprecated OTK is now queued internally by the core — always empty string. */
  oneTimeKey: string
  originalPath: string
}

/**
 * Encrypts a local file for the given chat using the Privitty JSONRPC API.
 *
 * For group chats: uses `privittySendGroupFile`.
 * For 1:1 chats: uses `privittySendFile` (fetches the peer contact ID from
 * `getChatContacts` automatically).
 *
 * The caller is responsible for attaching `encryptedPath` to a DC message via
 * `BackendRemote.rpc.sendMsg`.  The OTK / PDU is automatically queued by the
 * core as hidden system messages — the caller no longer needs to send a
 * separate text message for it.
 */
export async function encryptFileForChat(
  accountId: number,
  chatId: number,
  plainFilePath: string,
  fileAttribute: {
    allowDownload: boolean
    allowForward: boolean
    allowedTime: string
  } = DEFAULT_FILE_ATTR
): Promise<EncryptFileForChatResult | null> {
  const normalized = plainFilePath.replace(/\\/g, '/')
  // accessDurationMinutes: 0 = unlimited
  const accessDurationMinutes = fileAttribute.allowedTime
    ? Math.ceil(Number(fileAttribute.allowedTime) / 60)
    : 0

  try {
    const basicChat = await BackendRemote.rpc.getBasicChatInfo(accountId, chatId)

    let encryptedPath: string

    if (basicChat.chatType === C.DC_CHAT_TYPE_GROUP) {
      const result = await (BackendRemote.rpc as any).privittySendGroupFile(
        accountId,
        chatId,
        normalized,
        fileAttribute.allowDownload,
        fileAttribute.allowForward,
        accessDurationMinutes
      )
      encryptedPath = result.encrypted_path
    } else {
      // For single / P2P chats we need the peer's DC contact ID.
      const contactIds: number[] = await BackendRemote.rpc.getChatContacts(
        accountId,
        chatId
      )
      // Filter out well-known special IDs (self = 1, device = 5, info = 2, etc.)
      const peerContactId = contactIds.find(
        id => id > C.DC_CONTACT_ID_LAST_SPECIAL
      )
      if (!peerContactId) {
        log.error('encryptFileForChat: could not determine peerContactId', {
          chatId,
          contactIds,
        })
        return null
      }

      const result = await (BackendRemote.rpc as any).privittySendFile(
        accountId,
        chatId,
        peerContactId,
        normalized,
        fileAttribute.allowDownload,
        fileAttribute.allowForward,
        accessDurationMinutes
      )
      encryptedPath = result.encrypted_path
    }

    return {
      encryptedPath,
      oneTimeKey: '', // OTK is now handled internally by the Privitty core
      originalPath: normalized,
    }
  } catch (e) {
    log.error('encryptFileForChat: JSONRPC call failed', e)
    return null
  }
}
