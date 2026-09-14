import React, { useCallback, useContext, useMemo, useRef } from 'react'
import moment from 'moment'
import { T } from '@privitty/jsonrpc-client'
import { getDirection } from '../../utils/getDirection'
import { selectedAccountId } from '../../ScreenController'
import {
  useCmdRequestPending,
  isCmdRequestText,
} from '../../hooks/useCmdRequestPending'
import Message, {
  parseCmdResponse,
  CmdResponsePayload,
  buildContextMenu,
} from './Message'
import { ConversationType } from './MessageList'
import { ContextMenuContext } from '../../contexts/ContextMenuContext'
import useDialog from '../../hooks/dialog/useDialog'
import usePrivateReply from '../../hooks/chat/usePrivateReply'
import useMessage from '../../hooks/chat/useMessage'
import { mouseEventToPosition } from '../../utils/mouseEventToPosition'
import useTranslationFunction from '../../hooks/useTranslationFunction'
import Attachment from '../attachment/messageAttachment'
import Icon from '../Icon'
import { useIsRemoteAccessChat } from '../../contexts/RemoteAccessChatContext'

export interface RemoteAccessMessageProps {
  key2: string
  chat: T.FullChat
  message: T.Message
  conversationType: ConversationType
  unreadMessageInViewIntersectionObserver?: React.MutableRefObject<IntersectionObserver | null>
}

interface ParsedMetrics {
  loadAvg?: string
  idlePercent?: string
  bars: Array<{
    label: string
    value: string
    percent: number
    colorClass: 'purple' | 'cyan' | 'green'
  }>
}

function parseOutputMetrics(
  output: string | null | undefined
): ParsedMetrics | null {
  if (!output) return null

  let loadAvg: string | undefined
  let idlePercent: string | undefined
  const bars: ParsedMetrics['bars'] = []

  // Load Avg
  const loadMatch =
    output.match(/Load Avg:\s*([0-9.]+)/i) || output.match(/Load:\s*([0-9.]+)/i)
  if (loadMatch) {
    loadAvg = loadMatch[1]
  }

  // CPU usage: 4.78% user, 16.98% sys, 78.22% idle
  const cpuMatch = output.match(
    /CPU usage:\s*([0-9.]+)%\s*user,\s*([0-9.]+)%\s*sys,\s*([0-9.]+)%\s*idle/i
  )
  if (cpuMatch) {
    const userVal = parseFloat(cpuMatch[1])
    const sysVal = parseFloat(cpuMatch[2])
    idlePercent = `${cpuMatch[3]}%`

    bars.push({
      label: 'User CPU',
      value: `${cpuMatch[1]}%`,
      percent: Math.min(100, Math.max(3, userVal)),
      colorClass: 'purple',
    })

    bars.push({
      label: 'System',
      value: `${cpuMatch[2]}%`,
      percent: Math.min(100, Math.max(3, sysVal)),
      colorClass: 'cyan',
    })
  }

  // PhysMem: 7538M used
  const memMatch = output.match(/PhysMem:\s*([0-9]+[A-Z]?)\s*used/i)
  if (memMatch) {
    const num = parseFloat(memMatch[1])
    // Estimate a visually pleasing percentage if total unknown (~65-80%)
    const pct = num > 100 ? 76 : Math.min(100, Math.max(10, num))
    bars.push({
      label: 'PhysMem Used',
      value: memMatch[1],
      percent: pct,
      colorClass: 'purple',
    })
  }

  if (!loadAvg && !idlePercent && bars.length === 0) {
    return null
  }

  return { loadAvg, idlePercent, bars }
}

function renderTerminalLine(
  line: string,
  index: number,
  isHelp: boolean
): React.ReactNode {
  if (!line.trim()) {
    return <div key={index}>&nbsp;</div>
  }

  // Line in /help command registry, e.g. "/cpu-utilization — Current CPU usage per core"
  if (isHelp && line.trim().startsWith('/')) {
    const dashIdx =
      line.indexOf('—') !== -1 ? line.indexOf('—') : line.indexOf('-')
    if (dashIdx !== -1) {
      const cmdPart = line.slice(0, dashIdx).trimEnd()
      const rest = line.slice(dashIdx)
      return (
        <div key={index}>
          <span className='ra-tok-cmd'>{cmdPart}</span>
          <span className='ra-tok-dim'>{rest}</span>
        </div>
      )
    }
  }

  // CPU usage line with specific colored segments
  if (
    line.includes('CPU usage:') &&
    line.includes('user') &&
    line.includes('sys')
  ) {
    const m = line.match(
      /^(.*CPU usage:\s*)([0-9.]+%\s*user)(,\s*)([0-9.]+%\s*sys)(,\s*)([0-9.]+%\s*idle)(.*)$/i
    )
    if (m) {
      return (
        <div key={index}>
          <span className='ra-tok-dim'>{m[1]}</span>
          <span className='ra-tok-purple'>{m[2]}</span>
          <span className='ra-tok-dim'>{m[3]}</span>
          <span className='ra-tok-cyan'>{m[4]}</span>
          <span className='ra-tok-dim'>{m[5]}</span>
          <span className='ra-tok-green'>{m[6]}</span>
          <span className='ra-tok-dim'>{m[7]}</span>
        </div>
      )
    }
  }

  // General terminal line tokenization
  const tokens = line.split(
    /(\b\d+(?:\.\d+)?(?:%|[KMGT]?b?)?\b|\b(?:running|idle|unused)\b|\b(?:threads|sys)\b|\b(?:user)\b|[0-9/]+[KMGT]?\s*(?:in|out))/gi
  )

  return (
    <div key={index}>
      {tokens.map((token, tIdx) => {
        if (!token) return null
        const lower = token.toLowerCase()

        if (
          lower.includes('running') ||
          lower.includes('idle') ||
          lower.includes('unused')
        ) {
          return (
            <span key={tIdx} className='ra-tok-green'>
              {token}
            </span>
          )
        }
        if (
          lower.includes('threads') ||
          lower.includes('sys') ||
          lower.endsWith(' in')
        ) {
          return (
            <span key={tIdx} className='ra-tok-cyan'>
              {token}
            </span>
          )
        }
        if (lower.includes('user') || lower.endsWith(' out')) {
          return (
            <span key={tIdx} className='ra-tok-purple'>
              {token}
            </span>
          )
        }
        if (/^\d+(\.\d+)?(%|[KMGT]?b?)?$/i.test(token)) {
          return (
            <span key={tIdx} className='ra-tok-num'>
              {token}
            </span>
          )
        }

        return <span key={tIdx}>{token}</span>
      })}
    </div>
  )
}

export default function RemoteAccessMessage({
  message,
  chat,
  conversationType,
}: RemoteAccessMessageProps) {
  const text = message.text
  const direction = getDirection(message)
  const accountId = selectedAccountId()
  const { nodeName } = useIsRemoteAccessChat()
  const tx = useTranslationFunction()

  const cardRef = useRef<HTMLDivElement>(null)

  const { openContextMenu } = useContext(ContextMenuContext)
  const { openDialog } = useDialog()
  const privateReply = usePrivateReply()
  const { jumpToMessage } = useMessage()

  // 1. Detect if this is an Outgoing Command Request
  const isOutgoingCmd =
    direction === 'outgoing' &&
    (isCmdRequestText(text) || Boolean(text?.trim().startsWith('/')))
  const parsedCmd = useMemo(() => {
    if (!text) return 'command'
    if (isCmdRequestText(text)) {
      try {
        const start = text.indexOf('{')
        const end = text.lastIndexOf('}')
        if (start !== -1 && end !== -1) {
          const obj = JSON.parse(text.slice(start, end + 1))
          return obj?.cmd || obj?.command || 'command'
        }
      } catch {
        /* ignore */
      }
    }
    if (text.trim().startsWith('/')) {
      const match = text
        .trim()
        .slice(1)
        .split(/[\s\n]+/)[0]
      return match || 'command'
    }
    return 'command'
  }, [text])

  const { isPending: cmdIsPending, lastSeenHint: cmdLastSeenHint } =
    useCmdRequestPending(
      chat.id,
      isOutgoingCmd ? text : null,
      isOutgoingCmd ? (message.sender?.id ?? 0) : 0
    )

  // 2. Detect if this is a System Response
  const cmdResponse: CmdResponsePayload | null = useMemo(
    () => parseCmdResponse(text),
    [text]
  )

  // Only treat as a command response card when the text actually contains a
  // cmd_response JSON payload, OR when the incoming text matches known
  // command-output patterns (cpu/status/help). Plain text and file-only
  // messages must never enter the response card branch.
  const isIncomingResponse = useMemo(() => {
    if (cmdResponse) return true // parsed cmd_response JSON
    if (!text) return false // no text (file-only msg)
    if (message.file && !text.trim()) return false // file with no text
    // Heuristic: well-known command output patterns
    return (
      text.includes('CPU usage:') ||
      text.includes('Load Avg:') ||
      text.includes('Available commands:') ||
      (text.includes('daemon') && direction === 'incoming') ||
      (text.includes('uptime') && direction === 'incoming')
    )
  }, [cmdResponse, text, message.file, direction])

  // Determine command name for response card
  const responseCmdName = useMemo(() => {
    if (cmdResponse?.cmd) return cmdResponse.cmd
    if (text?.includes('Available commands:')) return 'help'
    if (text?.includes('CPU usage:') || text?.includes('Load Avg:'))
      return 'cpu-utilization'
    if (text?.includes('daemon') || text?.includes('uptime')) return 'status'
    return 'status'
  }, [cmdResponse, text])

  // Subtitle / Registry / Node logic
  const isHelpCmd = responseCmdName.toLowerCase() === 'help'
  const responseSubtitle = isHelpCmd ? 'Command Registry' : null
  const responseNode = !isHelpCmd ? nodeName || 'gateway' : null

  // Raw terminal output
  const rawOutput = cmdResponse?.output ?? (cmdResponse ? '' : text || '')
  const metrics = useMemo(() => parseOutputMetrics(rawOutput), [rawOutput])

  // Context Menu handler
  const handleContextMenu = useCallback(
    async (event: React.MouseEvent) => {
      event.preventDefault()
      const showContextMenuEventPos = mouseEventToPosition(event)

      const handleReactClick = () => {}

      const target = event.target as HTMLAnchorElement
      const items = await buildContextMenu(
        {
          accountId,
          message,
          text: text || undefined,
          conversationType,
          openDialog,
          privateReply,
          handleReactClick,
          chat,
          jumpToMessage,
        },
        target
      )

      // Remote Access messages should only have Info + Delete
      const remoteAccessItems = items.filter(item => {
        const label = String(item.label || '').toLowerCase()

        return label.includes('info') || label.includes('delete')
      })

      openContextMenu({
        ...showContextMenuEventPos,
        items: remoteAccessItems,
        ariaAttrs: {
          'aria-label': tx('a11y_message_context_menu_btn_label'),
        },
      })
    },
    [
      accountId,
      chat,
      conversationType,
      message,
      openContextMenu,
      openDialog,
      privateReply,
      text,
      jumpToMessage,
      tx,
    ]
  )

  // Timestamp formatting
  const formattedTime = useMemo(() => {
    const timestampMs = message.timestamp * 1000
    if (!timestampMs) return ''
    return moment(timestampMs).fromNow()
  }, [message.timestamp])

  // ---------------------------------------------------------------------------
  // Case A: Outgoing User Command (Right Aligned Compact Card)
  // Only render the command card for actual command messages, not plain text
  // or file attachments.
  // ---------------------------------------------------------------------------
  if (isOutgoingCmd) {
    return (
      <div
        className='ra-message-container ra-outgoing'
        id={message.id.toString()}
      >
        <div
          className='ra-command-card'
          ref={cardRef}
          onContextMenu={handleContextMenu}
        >
          <div className='ra-command-label'>/{parsedCmd}</div>
          {cmdIsPending ? (
            <div className='ra-command-status ra-status-pending'>
              <span className='ra-spinner' aria-hidden='true' />
              <span>Waiting for device…</span>
              {cmdLastSeenHint && (
                <span className='ra-offline-hint'>
                  Device last seen {cmdLastSeenHint}
                </span>
              )}
            </div>
          ) : (
            <div className='ra-command-status ra-status-done'>
              <span className='ra-check-mark'>✓</span>
              <span>Response received</span>
            </div>
          )}
        </div>

        <div className='ra-meta-row'>
          <span className='ra-timestamp'>{formattedTime}</span>
          <span className='ra-receipt' aria-label='Delivered'>
            ✓
          </span>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Case B: Incoming System/Edge Response Card (Left Aligned Large Card)
  // ---------------------------------------------------------------------------
  if (isIncomingResponse) {
    const lines = rawOutput.split('\n')
    const hasError = cmdResponse?.status && cmdResponse.status !== 'ok'
    const isFileMode =
      cmdResponse?.output_mode === 'file' || Boolean(message.file)

    return (
      <div
        className='ra-message-container ra-incoming'
        id={message.id.toString()}
      >
        <div
          className={`ra-response-card${isFileMode && message.file ? ' ra-file-mode' : ''}`}
          ref={cardRef}
          onContextMenu={handleContextMenu}
        >
          {/* Vertical accent stripe on left */}
          <div
            className={`ra-accent-stripe ${metrics ? 'ra-accent-cyan' : ''}`}
          />

          {/* Header */}
          <div className='ra-card-header'>
            <div className='ra-header-left'>
              <span className={`ra-dot ${metrics ? 'ra-dot-cyan' : ''}`} />
              <span className='ra-header-cmd'>/{responseCmdName}</span>
              {responseSubtitle && (
                <span className='ra-header-subtitle'>— {responseSubtitle}</span>
              )}
              {responseNode && (
                <span className='ra-node-badge'>NODE {responseNode}</span>
              )}
            </div>

            <div className='ra-header-right'>
              {/* Quick stats in header (Load / Idle) */}
              {metrics && (metrics.loadAvg || metrics.idlePercent) && (
                <div className='ra-quick-stats'>
                  {metrics.loadAvg && (
                    <span className='ra-quick-stat'>
                      <span className='ra-stat-lbl'>Load:</span>
                      <span className='ra-stat-val-cyan'>
                        {metrics.loadAvg}
                      </span>
                    </span>
                  )}
                  {metrics.idlePercent && (
                    <span className='ra-quick-stat'>
                      <span className='ra-stat-lbl'>Idle:</span>
                      <span className='ra-stat-val-green'>
                        {metrics.idlePercent}
                      </span>
                    </span>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className='ra-header-actions'>
                <button
                  type='button'
                  className='ra-btn-icon'
                  title='More options'
                  aria-label='More options'
                  onClick={handleContextMenu}
                >
                  <Icon icon='more' size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Metrics section with progress bars (e.g. for /cpu-utilization) */}
          {metrics && metrics.bars.length > 0 && (
            <div className='ra-metrics-section'>
              {metrics.bars.map(bar => (
                <div key={bar.label} className='ra-metric-box'>
                  <div className='ra-metric-labels'>
                    <span className='ra-metric-title'>{bar.label}</span>
                    <span className={`ra-metric-num ${bar.colorClass}`}>
                      {bar.value}
                    </span>
                  </div>
                  <div className='ra-progress-track'>
                    <div
                      className={`ra-progress-bar ${bar.colorClass}`}
                      style={{ width: `${bar.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error Banner */}
          {hasError && (
            <div className='ra-error-banner'>
              <span>⚠️</span>
              <span>
                {cmdResponse?.status === 'unauthorized'
                  ? 'Device commands not enabled'
                  : cmdResponse?.status === 'obsolete'
                    ? 'Command no longer available — capabilities updated'
                    : (cmdResponse?.message ?? 'Command execution failed')}
              </span>
            </div>
          )}

          {/* Terminal Output */}
          {!hasError && rawOutput && (
            <pre className='ra-terminal-output'>
              {lines.map((l, idx) => renderTerminalLine(l, idx, isHelpCmd))}
            </pre>
          )}

          {/* File Attachment Mode */}
          {isFileMode && message.file && (
            <Attachment message={message} tabindexForInteractiveContents={0} />
          )}
        </div>

        <div className='ra-meta-row'>
          <span className='ra-timestamp'>{formattedTime}</span>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Case C: Normal Plain Text or File Attachment in Remote Access Chat
  // Reuses the exact normal-chat Message component so all styling, attachments,
  // hover shortcut menu, metadata, and Privitty file layout match precisely.
  // ---------------------------------------------------------------------------
  return (
    <Message
      chat={chat}
      message={message}
      conversationType={conversationType}
    />
  )
}
