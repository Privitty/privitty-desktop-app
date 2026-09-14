import React, { useEffect, useRef, useState } from 'react'
import { DeviceCommand } from '../../hooks/useDeviceCommands'

interface Props {
  commands: DeviceCommand[]
  onSelect: (command: DeviceCommand) => void
  onClose: () => void
}

export function DeviceCommandPalette({ commands, onSelect, onClose }: Props) {
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  // Reset highlighted index when commands list changes (e.g. filtering)
  useEffect(() => {
    setHighlightedIndex(0)
  }, [commands])

  // Scroll highlighted item into view
  useEffect(() => {
    const item = itemRefs.current[highlightedIndex]
    if (item) {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  // Use refs to avoid stale closures in the capture-phase listener
  const stateRef = useRef({ highlightedIndex, commands, onSelect, onClose })
  useEffect(() => {
    stateRef.current = { highlightedIndex, commands, onSelect, onClose }
  })

  // Capture-phase keyboard listener — intercepts keys before the textarea
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { highlightedIndex, commands, onSelect, onClose } = stateRef.current
      if (commands.length === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopImmediatePropagation()
          setHighlightedIndex(
            highlightedIndex < commands.length - 1 ? highlightedIndex + 1 : 0
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopImmediatePropagation()
          setHighlightedIndex(
            highlightedIndex > 0 ? highlightedIndex - 1 : commands.length - 1
          )
          break
        case 'Enter':
          e.preventDefault()
          e.stopImmediatePropagation()
          if (commands[highlightedIndex]) {
            onSelect(commands[highlightedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          e.stopImmediatePropagation()
          onClose()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [])

  return (
    <div
      className='device-command-palette'
      role='listbox'
      aria-label='Device commands'
    >
      {commands.map((cmd, index) => (
        <div
          key={cmd.name}
          ref={el => {
            itemRefs.current[index] = el
          }}
          className={`device-command-palette__item${index === highlightedIndex ? ' device-command-palette__item--highlighted' : ''}`}
          role='option'
          aria-selected={index === highlightedIndex}
          tabIndex={-1}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => setHighlightedIndex(index)}
        >
          <span className='device-command-palette__name'>/{cmd.name}</span>
          <span className='device-command-palette__desc'>
            {cmd.description}
          </span>
        </div>
      ))}
      <div
        className='device-command-palette__cancel'
        role='button'
        tabIndex={0}
        onClick={onClose}
        onKeyDown={e => e.key === 'Enter' && onClose()}
      >
        Cancel
      </div>
    </div>
  )
}
