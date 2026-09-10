import React from 'react'
import { DeviceCommand } from '../../hooks/useDeviceCommands'

interface Props {
  commands: DeviceCommand[]
  onSelect: (command: DeviceCommand) => void
  onClose: () => void
}

export function DeviceCommandPalette({ commands, onSelect, onClose }: Props) {
  return (
    <div className='device-command-palette' role='listbox' aria-label='Device commands'>
      {commands.map(cmd => (
        <div
          key={cmd.name}
          className='device-command-palette__item'
          role='option'
          tabIndex={0}
          onClick={() => onSelect(cmd)}
          onKeyDown={e => e.key === 'Enter' && onSelect(cmd)}
        >
          <span className='device-command-palette__name'>/{cmd.name}</span>
          <span className='device-command-palette__desc'>{cmd.description}</span>
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
