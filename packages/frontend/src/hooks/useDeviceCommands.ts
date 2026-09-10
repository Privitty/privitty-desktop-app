import { useCallback, useEffect, useRef, useState } from 'react'
import { BackendRemote, onDCEvent } from '../backend-com'
import { selectedAccountId } from '../ScreenController'

export interface DeviceCommandArg {
  name: string
  type: 'choice' | 'int' | 'string'
  default: number | string
  choices: Array<number | string>
}

export interface DeviceCommand {
  name: string
  description: string
  output_mode: 'text' | 'file' | 'auto'
  args: DeviceCommandArg[]
}

export interface DeviceCapabilities {
  commands_enabled?: boolean
  commands: DeviceCommand[]
  platform?: string
  edge_version?: string
}

/** Parse the raw JSON manifest stored by privitty-core (matches Android logic). */
function parseDeviceCapabilities(json: string): DeviceCapabilities | null {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>
    const commands = Array.isArray(obj.commands)
      ? (obj.commands as DeviceCommand[])
      : []
    return {
      commands_enabled:
        obj.commands_enabled === undefined ? true : Boolean(obj.commands_enabled),
      commands,
      platform: typeof obj.platform === 'string' ? obj.platform : undefined,
      edge_version:
        typeof obj.edge_version === 'string' ? obj.edge_version : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Match Android {@code ConversationActivity.refreshDeviceCapabilities}:
 * enabled when the cached manifest contains at least one command.
 */
function capabilitiesEnablePalette(caps: DeviceCapabilities | null): boolean {
  return (caps?.commands?.length ?? 0) > 0
}

export function useDeviceCommands(chatId: number | null): {
  capabilities: DeviceCapabilities | null
  isEnabled: boolean
  refresh: () => void
} {
  const [capabilities, setCapabilities] = useState<DeviceCapabilities | null>(
    null
  )
  const mountedRef = useRef(true)
  const retryTimersRef = useRef<number[]>([])
  const rpc = BackendRemote.rpc

  const clearRetryTimers = useCallback(() => {
    retryTimersRef.current.forEach(id => window.clearTimeout(id))
    retryTimersRef.current = []
  }, [])

  const refreshInternal = useCallback(async () => {
    if (!chatId) {
      setCapabilities(null)
      return
    }
    const accountId = selectedAccountId()
    try {
      const json: string | null = await rpc.privittyGetDeviceCapabilities(
        accountId,
        chatId
      )
      if (!mountedRef.current) return
      if (json) {
        setCapabilities(parseDeviceCapabilities(json))
      } else {
        setCapabilities(null)
      }
    } catch {
      if (mountedRef.current) setCapabilities(null)
    }
  }, [chatId, rpc])

  const scheduleRetries = useCallback(() => {
    clearRetryTimers()
    // Edge re-publishes device_capabilities shortly after peer capabilities
    // exchange; poll a few times so we don't miss a slow SMTP round-trip.
    for (const delayMs of [800, 2000, 5000]) {
      const id = window.setTimeout(() => {
        if (mountedRef.current) {
          void refreshInternal()
        }
      }, delayMs)
      retryTimersRef.current.push(id)
    }
  }, [clearRetryTimers, refreshInternal])

  const refresh = useCallback(() => {
    void refreshInternal()
  }, [refreshInternal])

  useEffect(() => {
    mountedRef.current = true
    clearRetryTimers()
    void refreshInternal()
    return () => {
      mountedRef.current = false
      clearRetryTimers()
    }
  }, [refreshInternal, clearRetryTimers])

  useEffect(() => {
    if (!chatId) return
    const accountId = selectedAccountId()

    const onChatEvent = (ev: { chatId?: number }) => {
      if (ev.chatId === chatId) {
        void refreshInternal()
      }
    }

    const onPeerCaps = (ev: { chatId?: number }) => {
      if (ev.chatId === chatId) {
        void refreshInternal()
        scheduleRetries()
      }
    }

    const unsubs = [
      onDCEvent(
        accountId,
        'PrivittyDeviceCapabilitiesReceived',
        onChatEvent
      ),
      onDCEvent(accountId, 'PrivittyPeerCapabilitiesReceived', onPeerCaps),
      onDCEvent(accountId, 'PrivittyPeerHandshakeComplete', onChatEvent),
      onDCEvent(accountId, 'PrivittyChatEncryptionChanged', onChatEvent),
      // Hidden capability messages still bump MsgsChanged.
      onDCEvent(accountId, 'MsgsChanged', onChatEvent),
    ]

    return () => unsubs.forEach(fn => fn())
  }, [chatId, refreshInternal, scheduleRetries])

  const isEnabled = capabilitiesEnablePalette(capabilities)

  return { capabilities, isEnabled, refresh }
}
