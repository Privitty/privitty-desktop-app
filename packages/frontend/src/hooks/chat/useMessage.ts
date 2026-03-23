import { useCallback } from 'react'
import useChat from './useChat'
import { BackendRemote } from '../../backend-com'
import { ChatView } from '../../contexts/ChatContext'
import { getLogger } from '../../../../shared/logger'
import { notifyWebxdcMessageSent } from '../useWebxdcMessageSent'

import type { T } from '@privitty/jsonrpc-client'
//import { ContextMenuContext } from '../../contexts/ContextMenuContext'
import { useSharedDataOptional } from '../../contexts/FileAttribContext'
import { runtime } from '@deltachat-desktop/runtime-interface'

export type JumpToMessage = (params: {
  // "not from a different account" because apparently
  // `selectAccount` throws if `nextAccountId` is not the same
  // as the current account ID.
  //
  // TODO refactor: can't we just remove this property then?
  /**
   * The ID of the currently selected account.
   * jumpToMessage from `useMessage()` _cannot_ jump to messages
   * of different accounts.
   */
  accountId: number
  msgId: number
  /**
   * Optional, but if it is known, it's best to provide it
   * for better performance.
   * When provided, the caller guarantees that
   * `msgChatId === await rpc.getMessage(accountId, msgId)).chatId`.
   */
  msgChatId?: number
  highlight?: boolean
  focus: boolean
  /**
   * The ID of the message to remember,
   * to later go back to it, using the "jump down" button.
   *
   * This has no effect if `msgId` and `msgParentId` belong to different chats.
   * Because otherwise if the user pops the stack
   * by clicking the "jump down" button,
   * we'll erroneously show messages from the previous chat
   * without actually switching to that chat.
   */
  msgParentId?: number
  /**
   * `behavior: 'smooth'` should not be used due to "scroll locking":
   * they don't behave well together currently.
   * `inline` also isn't supposed to have effect because
   * the messages list should not be horizontally scrollable.
   */
  scrollIntoViewArg?: Parameters<HTMLElement['scrollIntoView']>[0]
}) => Promise<void>

export type SendMessage = (
  accountId: number,
  chatId: number,
  message: Partial<T.MessageData>
) => Promise<void>

export type ForwardMessage = (
  accountId: number,
  messageId: number,
  chatId: number
) => Promise<void>

export type DeleteMessage = (
  accountId: number,
  messageId: number
) => Promise<void>

const log = getLogger('hooks/useMessage')

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

export default function useMessage() {
  const { chatId, setChatView, selectChat } = useChat()
  const { sharedData, setSharedData } = useSharedDataOptional()

  const jumpToMessage = useCallback<JumpToMessage>(
    async ({
      accountId,
      msgId,
      msgChatId,
      highlight = true,
      focus,
      msgParentId,
      scrollIntoViewArg,
    }) => {
      log.debug(`jumpToMessage with messageId: ${msgId}`)

      if (msgChatId == undefined) {
        msgChatId = (await BackendRemote.rpc.getMessage(accountId, msgId))
          .chatId
      }

      // Workaround to actual jump to message in regarding mounted component view
      // We must set this before the potential `await selectChat()`,
      // i.e. before the render of the message list
      // so that it shows the target message right away.
      window.__internal_jump_to_message_asap = {
        accountId,
        chatId: msgChatId,
        jumpToMessageArgs: [
          {
            msgId,
            highlight,
            focus,
            // Don't add to the stack if the message is in a different chat,
            // see `msgParentId` docstring.
            addMessageIdToStack: msgChatId === chatId ? msgParentId : undefined,
            scrollIntoViewArg,
          },
        ],
      }
      window.__internal_check_jump_to_message?.()

      // Check if target message is in same chat, if not switch first
      if (msgChatId !== chatId) {
        await selectChat(accountId, msgChatId)
      }
      setChatView(ChatView.MessageList)

      window.__closeAllDialogs?.()
    },
    [chatId, selectChat, setChatView]
  )

  const sendMessage = useCallback<SendMessage>(
    async (
      accountId: number,
      chatId: number,
      message: Partial<T.MessageData>
    ) => {
      log.debug('filePathName', message)
      let msgId = 0
      if (message.file && message.filename) {
        msgId = await BackendRemote.rpc.sendMsg(accountId, chatId, {
          ...MESSAGE_DEFAULT,
          ...message,
        })

        if (sharedData.oneTimeKey) {
          log.info('need to send otsp message:')

          const pdu = sharedData.oneTimeKey
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
          BackendRemote.rpc.sendMsg(accountId, chatId, {
            ...MESSAGE_DEFAULT,
            ...message,
          })
        }
        // DELETE ENCRYPTED .prv FILE AFTER SUCCESSFUL SEND
        // (File is in user's folder, use deleteEncryptedFile not removeTempFile)
        if (sharedData?.encryptedFilePath) {
          try {
            if (await runtime.checkFileExists(sharedData.encryptedFilePath)) {
              await runtime.deleteEncryptedFile(sharedData.encryptedFilePath)
              log.debug(
                'Encrypted file deleted after send:',
                sharedData.encryptedFilePath
              )
            }
          } catch (err) {
            log.error('Failed to delete encrypted file after send:', err)
          }
        }
      } else {
        msgId = await BackendRemote.rpc.sendMsg(accountId, chatId, {
          ...MESSAGE_DEFAULT,
          ...message,
        })
      }

      // Notify about the sent message (listeners can filter by message type if needed)
      notifyWebxdcMessageSent(accountId, chatId, message)

      // Jump down on sending
      jumpToMessage({
        accountId,
        msgId,
        msgChatId: chatId,
        highlight: false,
        focus: false,
      })

      // Reset shared file attributes after send to avoid leaking to next message
      setSharedData({
        allowDownload: false,
        allowForward: false,
        allowedTime: '',
        FileDirectory: '',
        oneTimeKey: '',
        encryptedFilePath: '',
      })
    },
    [jumpToMessage, sharedData, setSharedData]
  )

  const forwardMessage = useCallback<ForwardMessage>(
    async (accountId: number, messageId: number, chatId: number) => {
      await BackendRemote.rpc.forwardMessages(accountId, [messageId], chatId)
    },
    []
  )

  const deleteMessage = useCallback<DeleteMessage>(
    async (accountId: number, messageId: number) => {
      await BackendRemote.rpc.deleteMessages(accountId, [messageId])
    },
    []
  )

  return {
    /**
     * Makes the currently rendered MessageList component instance
     * load and scroll the message with the specified `msgId` into view.
     *
     * The specified message may be a message from a different chat,
     * but _not_ from a different account,
     * see {@link JumpToMessage['accountId']}.
     */
    jumpToMessage,
    sendMessage,
    forwardMessage,
    deleteMessage,
  }
}
