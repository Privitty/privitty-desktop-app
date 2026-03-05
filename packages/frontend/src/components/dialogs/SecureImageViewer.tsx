import React, { useState, useEffect, useRef } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import Dialog from '../Dialog'
import { IconButton } from '../Icon'
import { getLogger } from '../../../../shared/logger'
import useTranslationFunction from '../../hooks/useTranslationFunction'

import type { DialogProps } from '../../contexts/DialogContext'

const log = getLogger('renderer/secure_image_viewer')

type Props = {
  filePath: string
  fileName: string
}

export default function SecureImageViewer(props: Props & DialogProps) {
  const { filePath, fileName, onClose } = props
  const tx = useTranslationFunction()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const transformRef = useRef<any>(null)

  const loadImage = React.useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // Build a valid file:// URL for both macOS and Windows.
      // On macOS filePath starts with '/' (/Users/...) → file:///Users/...  (3 slashes)
      // On Windows filePath starts with a drive letter (C:/...) → file:///C:/...
      // Using just `file://${filePath}` on Windows produces file://C:/... where
      // "C:" is parsed as the hostname — the third slash is required.
      const normalizedPath = filePath.replace(/\\/g, '/')
      const url = normalizedPath.startsWith('/')
        ? `file://${normalizedPath}` // POSIX: /path → file:///path
        : `file:///${normalizedPath}` // Windows: C:/path → file:///C:/path
      log.info('Loading image in secure viewer', { filePath, url })

      setImageUrl(url)
      setLoading(false)
    } catch (err) {
      log.error('Failed to load image', err)
      setError(tx('error_loading_image'))
      setLoading(false)
    }
  }, [filePath, tx])

  useEffect(() => {
    loadImage()
  }, [loadImage])

  const zoomIn = () => {
    if (transformRef.current) {
      transformRef.current.zoomIn()
    }
  }

  const zoomOut = () => {
    if (transformRef.current) {
      transformRef.current.zoomOut()
    }
  }

  const resetZoom = () => {
    if (transformRef.current) {
      transformRef.current.resetTransform()
    }
  }

  const debouncedResetZoom = (state: any) => {
    setScale(state.state.scale)
  }

  const handleImageLoad = () => {
    setLoading(false)
  }

  const handleImageError = () => {
    setError(tx('error_loading_image'))
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
    <Dialog onClose={onClose} className='secure-image-viewer'>
      <div className='secure-image-viewer-header'>
        <h2>{fileName}</h2>
        <IconButton icon='cross' onClick={onClose} aria-label={tx('close')} />
      </div>

      <div
        className='secure-image-viewer-content'
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {loading && (
          <div className='image-loading-overlay'>
            <div className='image-loading-spinner'></div>
            <span>{tx('loading_image')}</span>
          </div>
        )}

        {error && (
          <div className='image-error-overlay'>
            <div className='error-content'>
              <IconButton
                icon='cross'
                size={48}
                aria-label={tx('error_loading_image')}
              />
              <h3>{tx('error_loading_image')}</h3>
              <p>{error}</p>
              <button onClick={loadImage} className='retry-button'>
                {tx('retry')}
              </button>
            </div>
          </div>
        )}

        {!error && (
          <TransformWrapper
            ref={transformRef}
            initialScale={1}
            minScale={0.25}
            maxScale={5}
            onZoom={debouncedResetZoom}
          >
            <TransformComponent>
              <div className='image-container'>
                <img
                  ref={imageRef}
                  src={imageUrl || ''}
                  alt={fileName}
                  className='secure-image'
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                  onContextMenu={handleContextMenu}
                  onDragStart={e => e.preventDefault()}
                  onDrop={e => e.preventDefault()}
                  style={{
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    MozUserSelect: 'none',
                    msUserSelect: 'none',
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                  }}
                />
              </div>
            </TransformComponent>
          </TransformWrapper>
        )}
      </div>

      <div className='secure-image-viewer-bottom-controls'>
        <div className='zoom-controls'>
          <IconButton
            icon='minus'
            onClick={zoomOut}
            aria-label={tx('zoom_out')}
          />
          <span className='zoom-level'>{Math.round(scale * 100)}%</span>
          <IconButton icon='plus' onClick={zoomIn} aria-label={tx('zoom_in')} />
          <IconButton
            icon='rotate-right'
            onClick={resetZoom}
            aria-label={tx('reset_zoom')}
          />
        </div>
      </div>

      <div className='secure-image-viewer-footer'>
        <div className='secure-notice'>
          <IconButton
            icon='info'
            size={16}
            aria-label={tx('secure_viewer_notice')}
          />
          <span>{tx('secure_viewer_notice')}</span>
        </div>
      </div>
    </Dialog>
  )
}
