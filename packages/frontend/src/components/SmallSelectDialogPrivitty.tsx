import React, { useMemo, useState } from 'react'
import Checkbox from './Checkbox'
import Dialog, {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FooterActions,
} from './Dialog'
import FooterActionButton from './Dialog/FooterActionButton'
import useTranslationFunction from '../hooks/useTranslationFunction'

import type { DialogProps } from '../contexts/DialogContext'

export type SelectDialogOption = [value: string, label: string]

export type SelectedValue = {
  allowDownload: boolean
  allowForward: boolean
  allowedTime: string // duration in seconds as string
}

type Props = {
  title: string
  initialSelectedValue: SelectedValue
  onSave?: (selectedValue: SelectedValue) => void
  onSelect?: (selectedValue: SelectedValue) => void
  onCancel?: () => void
  showAllowForward?: boolean
} & DialogProps

/** Format a Date for datetime-local input: YYYY-MM-DDTHH:mm */
function formatDateTimeLocal(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

/** Get default expiry: current time + 1 day */
function getDefaultExpiryDateTime(): string {
  const defaultDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
  defaultDate.setSeconds(0, 0)
  return formatDateTimeLocal(defaultDate)
}

/** Get min datetime for picker: now (rounded to next minute) */
function getMinDateTime(): string {
  const now = new Date()
  now.setSeconds(0, 0)
  return formatDateTimeLocal(now)
}

function getDateAfterDays(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  date.setSeconds(0, 0)
  return formatDateTimeLocal(date)
}

export default function SmallSelectDialogPrivitty({
  initialSelectedValue: _initialSelectedValue,
  onSave,
  title,
  onClose,
  onSelect,
  onCancel,
  showAllowForward = true,
}: Props) {
  const tx = useTranslationFunction()
  const [allowDownload, setAllowDownload] = useState<boolean>(false)
  const [allowForward, setAllowForward] = useState<boolean>(false)
  const [expiryDateTime, setExpiryDateTime] = useState<string>(
    getDefaultExpiryDateTime
  )
  const [validationError, setValidationError] = useState<string | null>(null)
  const [selectedTab, setSelectedTab] = useState<number | null>(null)

  const minDateTime = useMemo(() => getMinDateTime(), [])

  const saveAndClose = () => {
    setValidationError(null)

    const selectedEpochMs = new Date(expiryDateTime).getTime()
    const nowMs = Date.now()

    if (selectedEpochMs <= nowMs) {
      setValidationError('Please select a future date and time')
      return
    }

    const durationSeconds = Math.floor((selectedEpochMs - nowMs) / 1000)
    if (durationSeconds <= 0) {
      setValidationError('Invalid time selected')
      return
    }

    const selectedValue: SelectedValue = {
      allowDownload,
      allowForward,
      allowedTime: String(durationSeconds),
    }
    onSelect && onSelect(selectedValue)
    onSave && onSave(selectedValue)
    onClose()
  }

  const handleTabClick = (days: number) => {
    setSelectedTab(days)
    setExpiryDateTime(getDateAfterDays(days))
    setValidationError(null)
  }

  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setExpiryDateTime(e.target.value)
    setSelectedTab(null)
    setValidationError(null)
  }

  return (
    <Dialog onClose={onClose}>
      <DialogHeader title={title} />
      <DialogBody>
        <DialogContent>
          <div style={{ marginBottom: 12 }}>
            <Checkbox
              checked={allowDownload}
              onChange={e => setAllowDownload(e.target.checked)}
              label='Allow Download'
            />
          </div>
          {showAllowForward && (
            <div style={{ marginBottom: 12 }}>
              <Checkbox
                checked={allowForward}
                onChange={e => setAllowForward(e.target.checked)}
                label='Allow Forward'
              />
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor='expiry-datetime'
              style={{ display: 'block', marginBottom: 4 }}
            >
              {'Expiry date and time'}
            </label>
            <input
              id='expiry-datetime'
              type='datetime-local'
              value={expiryDateTime}
              min={minDateTime}
              onChange={handleExpiryChange}
              className='textbox'
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: 14,
                borderRadius: 4,
                border: '1px solid var(--borderColor, #ccc)',
              }}
            />
          </div>
          {validationError && (
            <div
              style={{
                marginBottom: 12,
                padding: '8px 12px',
                backgroundColor: 'rgba(211, 47, 47, 0.1)',
                color: 'var(--colorError, #d32f2f)',
                fontSize: 13,
                borderRadius: 4,
              }}
            >
              {validationError}
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleTabClick(2)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid #ccc',
                  background: selectedTab === 2 ? '#6750A4' : '#fff',
                  color: selectedTab === 2 ? '#fff' : '#000',
                  cursor: 'pointer',
                }}
              >
                2 Days
              </button>

              <button
                onClick={() => handleTabClick(3)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid #ccc',
                  background: selectedTab === 3 ? '#6750A4' : '#fff',
                  color: selectedTab === 3 ? '#fff' : '#000',
                  cursor: 'pointer',
                }}
              >
                3 Days
              </button>

              <button
                onClick={() => handleTabClick(7)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid #ccc',
                  background: selectedTab === 7 ? '#6750A4' : '#fff',
                  color: selectedTab === 7 ? '#fff' : '#000',
                  cursor: 'pointer',
                }}
              >
                1 Week
              </button>
            </div>
          </div>
        </DialogContent>
      </DialogBody>
      <DialogFooter>
        <FooterActions>
          <FooterActionButton
            onClick={() => {
              onCancel && onCancel()
              onClose()
            }}
          >
            {tx('cancel')}
          </FooterActionButton>
          <FooterActionButton styling='primary' onClick={saveAndClose}>
            {tx('save_desktop')}
          </FooterActionButton>
        </FooterActions>
      </DialogFooter>
    </Dialog>
  )
}
