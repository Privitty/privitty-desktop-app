import React from 'react'
import classNames from 'classnames'
import { T } from '@privitty/jsonrpc-client'

import Timestamp from '../conversations/Timestamp'
import { isImage, isVideo } from '../attachment/Attachment'
import { msgStatus } from '../../types-app'
import useTranslationFunction from '../../hooks/useTranslationFunction'

type PrivittyStatus =
  | 'active'
  | 'requested'
  | 'expired'
  | 'revoked'
  | 'deleted'
  | 'waiting_owner_action'
  | 'denied'
  | 'not_found'
  | 'none'
  | 'error'
  | undefined

type Props = {
  encrypted: boolean
  fileMime: string | null
  direction?: 'incoming' | 'outgoing'
  status: msgStatus
  error: string | null
  downloadState: T.DownloadState
  isEdited: boolean
  hasText: boolean
  timestamp: number
  hasLocation?: boolean
  onClickError?: () => void
  tabindexForInteractiveContents: -1 | 0
  viewType: T.Viewtype
  isSavedMessage: boolean
  privittyStatus?: PrivittyStatus
}

function getPrivittyStatusIcon(
  privittyStatus: PrivittyStatus,
  hasText: boolean,
  direction?: 'incoming' | 'outgoing'
): 'active' | 'loading' | 'error' | 'blocked' | null {
  const isFile = !hasText

  // All outgoing messages → active
  if (direction === 'outgoing') {
    return 'active'
  }

  // Incoming text → active
  if (!isFile) {
    return 'active'
  }

  // Incoming file → check privitty status
  switch (privittyStatus) {
    case 'active':
      return 'active'

    case 'expired':
      return 'error'

    case 'requested':
      return 'loading'

    case 'revoked':
      return 'blocked'

    default:
      return null
  }
}
export default function MessageMetaData(props: Props) {
  const tx = useTranslationFunction()

  const {
    encrypted,
    fileMime,
    direction,
    status,
    error,
    downloadState,
    isEdited,
    hasText,
    timestamp,
    hasLocation,
    onClickError,
    tabindexForInteractiveContents,
    viewType,
    isSavedMessage,
    privittyStatus,
  } = props

  const privittyIcon = getPrivittyStatusIcon(privittyStatus, hasText, direction)
  const padlock = encrypted

  return (
    <div
      className={classNames('metadata', {
        'with-image-no-caption': isMediaWithoutText(
          fileMime,
          hasText,
          viewType
        ),
      })}
    >
      {padlock && (
        <div aria-hidden={true} className='padlock-icon' />
      )}
      {/* FYI the email doesn't need `aria-live`
      as we don't expect it to get removed. See
      https://github.com/deltachat/deltachat-desktop/pull/5023#discussion_r2059382983 */}
      {!encrypted && downloadState === 'Done' && (
        // if a message is not yet downloaded we don't know if it is encrypted or not
        <div
          aria-label={tx('email')}
          // We should not announce this for _every_ message.
          // This is available in the "Message info" dialog.
          aria-hidden={true}
          className={'email-icon'}
        />
      )}
      <div
        className='aria-live-wrapper'
        aria-live='polite'
        // Also announce removals as to notify when a message gets unsaved.
        // AFAIK "saved" / "unsaved" changes only as a result of user action,
        // but let's do it for confirmation, and for future-proofing.
        aria-relevant='all'
      >
        {isSavedMessage && (
          <div aria-label={tx('saved')} className={'saved-message-icon'} />
        )}
      </div>
      {hasLocation && <span className={'location-icon'} />}
      <div className='aria-live-wrapper' aria-live='polite'>
        {isEdited && <span className='edited'>{tx('edited')}</span>}
      </div>
      <Timestamp
        timestamp={timestamp}
        extended
        direction={direction}
        module='date'
      />
      <span className='spacer' />

      {privittyIcon && (
        <div
          aria-label='Privitty status'
          aria-hidden={true}
          className={classNames('privitty-status-icon', privittyIcon)}
        />
      )}

      <span className='spacer' />

      {(direction === 'outgoing' || error !== null) && (
        <div className='delivery-status-wrapper'>
          <div
            role='status'
            className={classNames(
              'status-icon',
              error !== null ? 'error' : status
            )}
          >
            <span className='visually-hidden'>
              {tx(
                `a11y_delivery_status_${
                  error !== null
                    ? 'error'
                    : (status as Exclude<
                        typeof status,
                        '' | 'in_fresh' | 'in_seen' | 'in_noticed'
                      >)
                }`
              )}
            </span>
          </div>
          {error !== null && (
            <button
              className='error-button'
              tabIndex={tabindexForInteractiveContents}
              onClick={onClickError}
            >
              <span className='visually-hidden'>
                {tx('menu_message_details')}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Returns true if message contains visual media (image, sticker or video)
 * without any further text.
 **/
export function isMediaWithoutText(
  fileMime: string | null,
  hasText: boolean,
  viewType: T.Viewtype
): boolean {
  const withImageNoCaption = Boolean(
    !hasText && (isImage(fileMime) || isVideo(fileMime))
  )

  return withImageNoCaption || viewType === 'Sticker'
}
