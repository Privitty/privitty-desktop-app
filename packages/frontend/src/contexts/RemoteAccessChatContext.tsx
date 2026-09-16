import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
} from 'react'
import { C, T } from '@privitty/jsonrpc-client'
import { useRemoteAccess } from '../hooks/useRemoteAccess'
import { useDeviceCommands } from '../hooks/useDeviceCommands'
import { privittyStore } from '../privitty/privittyStore'
import { getLogger } from '@deltachat-desktop/shared/logger'

const log = getLogger('renderer/RemoteAccessChatContext')

interface RemoteAccessChatContextValue {
  isRemoteAccessChat: boolean
  nodeName: string
  tunnelActive: boolean
}

const RemoteAccessChatContext = createContext<RemoteAccessChatContextValue>({
  isRemoteAccessChat: false,
  nodeName: '',
  tunnelActive: false,
})

// In-memory cache of identified remote-access chats (accountId:chatId)
// Prevents any UI flickering while async RPC capability queries resolve.
const knownRemoteAccessChats = new Set<string>()

export function RemoteAccessChatProvider({
  chat,
  accountId,
  children,
}: {
  chat: T.FullChat
  accountId: number
  children: React.ReactNode
}) {
  const chatId = chat.id
  const cacheKey = `${accountId}:${chatId}`

  // Remote access is only applicable for 1:1 Privitty-encrypted chats (matching MainScreen & Composer)
  const [isPrivittyChat, setIsPrivittyChat] = useState<boolean>(() => {
    return (
      chat.chatType === C.DC_CHAT_TYPE_SINGLE &&
      privittyStore.isPrivitty(accountId, chatId)
    )
  })

  useEffect(() => {
    const check =
      chat.chatType === C.DC_CHAT_TYPE_SINGLE &&
      privittyStore.isPrivitty(accountId, chatId)
    setIsPrivittyChat(check)

    return privittyStore.subscribe(markedChatId => {
      if (markedChatId === chatId) {
        setIsPrivittyChat(chat.chatType === C.DC_CHAT_TYPE_SINGLE)
      }
    })
  }, [accountId, chatId, chat.chatType])

  const { tunnelActive } = useRemoteAccess(isPrivittyChat ? chatId : null)
  const { isEnabled: commandsEnabled } = useDeviceCommands(
    isPrivittyChat ? chatId : null
  )

  const isEdgeNamed = useMemo(() => {
    return /^(NODE|Edge Gateway|Edge|Gateway)\b/i.test(chat.name || '')
  }, [chat.name])

  // A chat is confirmed as remote-access if it is a 1:1 Privitty chat and:
  // 1) Chat name matches edge device conventions (e.g. "NODE gw101", "Edge Gateway"), OR
  // 2) Device commands are enabled for the peer (capabilities published by privitty-edged), OR
  // 3) An active remote-access tunnel session is currently running
  const isConfirmedRemoteAccess = Boolean(
    isPrivittyChat && (isEdgeNamed || commandsEnabled || tunnelActive)
  )

  const isRemoteAccess = Boolean(
    isPrivittyChat &&
    (isConfirmedRemoteAccess ||
      (isEdgeNamed && knownRemoteAccessChats.has(cacheKey)))
  )

  useEffect(() => {
    if (!isPrivittyChat || !isConfirmedRemoteAccess) {
      knownRemoteAccessChats.delete(cacheKey)
    } else {
      knownRemoteAccessChats.add(cacheKey)
    }
  }, [isConfirmedRemoteAccess, isPrivittyChat, cacheKey])

  useEffect(() => {
    log.debug(
      `Chat ${chatId} (${chat.name}): isPrivitty=${isPrivittyChat}, isEdgeNamed=${isEdgeNamed}, commandsEnabled=${commandsEnabled}, tunnelActive=${tunnelActive} => isRemoteAccess=${isRemoteAccess}`
    )
  }, [
    chatId,
    chat.name,
    isPrivittyChat,
    isEdgeNamed,
    commandsEnabled,
    tunnelActive,
    isRemoteAccess,
  ])

  // Derive a node name from chat/peer name, e.g. "gw101" from "NODE gw101" or "Edge Gateway"
  const nodeName = useMemo(() => {
    if (!chat.name) return 'gateway'
    const clean = chat.name
      .replace(/^(Edge Gateway|Edge|Gateway|NODE)\s*/i, '')
      .trim()
    return clean || chat.name
  }, [chat.name])

  const value = useMemo(
    () => ({
      isRemoteAccessChat: isRemoteAccess,
      nodeName,
      tunnelActive,
    }),
    [isRemoteAccess, nodeName, tunnelActive]
  )

  return (
    <RemoteAccessChatContext.Provider value={value}>
      {children}
    </RemoteAccessChatContext.Provider>
  )
}

export function useIsRemoteAccessChat(): RemoteAccessChatContextValue {
  return useContext(RemoteAccessChatContext)
}
