import React from 'react'
import { DeviceCommand, DeviceCommandArg } from '../../hooks/useDeviceCommands'

interface Props {
  command: DeviceCommand
  onSend: (
    command: DeviceCommand,
    args: Record<string, number | string>
  ) => void
  onCancel: () => void
}

export function DeviceCommandChips({ command, onSend, onCancel }: Props) {
  const arg: DeviceCommandArg | undefined = command.args?.[0]

  // No args: caller should have sent immediately; render nothing
  if (!arg || arg.type !== 'choice') return null

  return (
    <div className='device-command-chips'>
      <span className='device-command-chips__label'>/{command.name}</span>
      {arg.choices.map(choice => (
        <button
          key={String(choice)}
          className='device-command-chips__chip'
          type='button'
          onClick={() => onSend(command, { [arg.name]: choice })}
        >
          {String(choice)}
        </button>
      ))}
      <button
        className='device-command-chips__cancel'
        type='button'
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  )
}
