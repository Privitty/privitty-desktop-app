import React, { useState, useEffect, useRef } from 'react'
import Dialog from '../Dialog'
import { IconButton } from '../Icon'
import { getLogger } from '../../../../shared/logger'

import type { DialogProps } from '../../contexts/DialogContext'

const log = getLogger('renderer/secure_video_viewer')

type Props = {
  filePath: string
  fileName: string
}

export default function SecureVideoViewer(props: Props & DialogProps) {
  const { filePath, fileName, onClose } = props

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const blobUrlRef = useRef<string | null>(null)

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [])

  const loadVideo = React.useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      log.info('Loading video in secure viewer', {
        filePath,
        platform:
          typeof window !== 'undefined' ? window.process?.platform : 'unknown',
        containsPrv: filePath.includes('.prv'),
      })

      let videoUrl: string

      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Node.js fs/path in Electron
        const fs = require('fs')
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Node.js path in Electron
        const path = require('path')

        let normalizedPath = filePath.replace(/^file:\/\//, '')
        if (normalizedPath.startsWith('/')) {
          normalizedPath = normalizedPath.substring(1)
        }
        normalizedPath = path.resolve(normalizedPath)

        if (!fs.existsSync(normalizedPath)) {
          throw new Error(`File does not exist: ${normalizedPath}`)
        }

        const fileBuffer = fs.readFileSync(normalizedPath)
        const blob = new Blob([fileBuffer], { type: 'video/*' })
        const blobUrl = URL.createObjectURL(blob)

        videoUrl = blobUrl
        blobUrlRef.current = blobUrl

        log.info('Video loaded using Node.js fs', {
          fileSize: fileBuffer.length,
        })
      } catch {
        let normalizedFilePath = filePath
        if (!normalizedFilePath.startsWith('file://')) {
          normalizedFilePath = `file:///${normalizedFilePath.replace(/\\/g, '/')}`
        }
        videoUrl = normalizedFilePath
        log.info('Using file:// URL fallback for video')
      }

      setVideoUrl(videoUrl)
      setLoading(false)
    } catch (err) {
      log.error('Failed to load video', err)
      setError(err instanceof Error ? err.message : 'Failed to load video')
      setLoading(false)
    }
  }, [filePath])

  useEffect(() => {
    loadVideo()
  }, [loadVideo])

  const handleVideoLoad = () => {
    setLoading(false)
    log.info('Video loaded successfully', { videoUrl })
  }

  const handleVideoError = () => {
    log.error('Video failed to load', { videoUrl })
    setError('Failed to load video')
    setLoading(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Prevent copy shortcuts
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'a')) {
      e.preventDefault()
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  return (
    <Dialog onClose={onClose} className='secure-video-viewer'>
      <div className='secure-video-viewer-header'>
        <h2>{fileName}</h2>
        <IconButton icon='cross' onClick={onClose} aria-label='Close' />
      </div>

      <div
        className='secure-video-viewer-content'
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {loading && (
          <div className='video-loading-overlay'>
            <div className='video-loading-spinner'></div>
            <span>Loading video...</span>
          </div>
        )}

        {error && (
          <div className='video-error-overlay'>
            <div className='error-content'>
              <IconButton icon='cross' size={48} aria-label='Error' />
              <h3>Video Loading Error</h3>
              <p>{error}</p>
              <button onClick={loadVideo} className='retry-button'>
                Retry
              </button>
            </div>
          </div>
        )}

        {!error && (
          <div className='video-container'>
            <video
              ref={videoRef}
              src={videoUrl || ''}
              className='secure-video'
              onLoadedData={handleVideoLoad}
              onError={handleVideoError}
              onContextMenu={handleContextMenu}
              onDragStart={e => e.preventDefault()}
              onDrop={e => e.preventDefault()}
              controls
              autoPlay
              muted
              preload='metadata'
              style={{ userSelect: 'none' }}
            />
          </div>
        )}
      </div>

      <div className='secure-video-viewer-footer'>
        <div className='secure-notice'>
          <IconButton icon='info' size={16} aria-label='Secure viewer notice' />
          <span>
            This is a secure viewer. Video content cannot be copied or saved.
          </span>
        </div>
      </div>
    </Dialog>
  )
}
