import React, { useCallback, useEffect, useState } from 'react'
import { basename, extname } from 'path'

import Dialog from '../Dialog'
import { IconButton } from '../Icon'
import Icon from '../Icon'
import { getLogger } from '../../../../shared/logger'
import useTranslationFunction from '../../hooks/useTranslationFunction'
import { runtime } from '@deltachat-desktop/runtime-interface'
import DocxPreviewContent from './office/DocxPreviewContent'
import ExcelPreviewContent from './office/ExcelPreviewContent'
import PptxPreviewContent from './office/PptxPreviewContent'

import type { DialogProps } from '../../contexts/DialogContext'
import type { OfficeViewerType } from '../../utils/secureViewerExtensions'

const log = getLogger('renderer/secure_office_viewer')

type Props = {
  filePath: string
  fileName: string
  viewerType: OfficeViewerType
  canDownload?: boolean
}

const OFFICE_TYPE_LABELS: Record<OfficeViewerType, string> = {
  docx: 'Word document',
  xlsx: 'Excel workbook',
  xls: 'Excel workbook',
  pptx: 'PowerPoint presentation',
}

export default function SecureOfficeViewer(props: Props & DialogProps) {
  const {
    filePath,
    fileName: rawFileName,
    viewerType,
    canDownload,
    onClose,
  } = props
  const fileName =
    rawFileName?.replace(/\.prv$/i, '') ||
    basename(filePath).replace(/\.prv$/i, '')
  const tx = useTranslationFunction()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const handleLoad = useCallback(() => {
    setLoading(false)
    setError(null)
  }, [])

  const handleError = useCallback((message: string) => {
    setLoading(false)
    setError(message)
  }, [])

  const retry = useCallback(() => {
    setLoading(true)
    setError(null)
    setReloadKey(prev => prev + 1)
  }, [])

  useEffect(() => {
    const preventCopyShortcuts = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'a')) {
        e.preventDefault()
        return false
      }
    }

    document.addEventListener('keydown', preventCopyShortcuts)

    return () => {
      document.removeEventListener('keydown', preventCopyShortcuts)
    }
  }, [])

  const onDownload = async () => {
    try {
      let name = fileName || basename(filePath)
      name = name.replace(/\.prv/g, '')

      const fileExtension = extname(filePath).toLowerCase()
      if (fileExtension && !name.toLowerCase().endsWith(fileExtension)) {
        name = `${name}${fileExtension}`
      }

      await runtime.downloadFile(filePath, name)
      log.info('Secure office file downloaded', { filePath, name })
    } catch (err) {
      log.error('Secure office file download failed', err)
    }
  }

  const renderPreviewContent = () => {
    const contentProps = {
      filePath,
      onLoad: handleLoad,
      onError: handleError,
    }

    switch (viewerType) {
      case 'docx':
        return <DocxPreviewContent key={reloadKey} {...contentProps} />
      case 'xlsx':
      case 'xls':
        return <ExcelPreviewContent key={reloadKey} {...contentProps} />
      case 'pptx':
        return <PptxPreviewContent key={reloadKey} {...contentProps} />
    }
  }

  if (error) {
    return (
      <Dialog onClose={onClose} className='secure-office-viewer-dialog'>
        <div className='secure-office-viewer-error'>
          <IconButton icon='cross' size={48} aria-label='Preview error' />
          <h3>Preview Error</h3>
          <p>{error}</p>
          <button type='button' onClick={retry} className='retry-button'>
            Retry
          </button>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog onClose={onClose} className='secure-office-viewer-dialog'>
      <div className='secure-office-viewer-header'>
        <div className='secure-office-viewer-title'>
          <h2>{fileName}</h2>
          <span className='office-type-info'>
            {OFFICE_TYPE_LABELS[viewerType]}
          </span>
        </div>

        <div className='secure-office-viewer-header-actions'>
          {canDownload && (
            <IconButton
              icon='download'
              onClick={onDownload}
              aria-label={tx('download')}
            />
          )}
          <IconButton icon='cross' onClick={onClose} aria-label='Close' />
        </div>
      </div>

      <div className='secure-office-viewer-content'>
        {loading && (
          <div className='secure-office-viewer-loading'>
            <div className='loading-spinner'></div>
            <span>Loading preview...</span>
          </div>
        )}

        <div
          className={
            loading
              ? 'secure-office-viewer-preview hidden-while-loading'
              : 'secure-office-viewer-preview'
          }
        >
          {renderPreviewContent()}
        </div>
      </div>

      <div className='secure-office-viewer-footer'>
        <div className='secure-notice'>
          <Icon icon='info' size={16} aria-label='Secure viewer notice' />
          <span>
            This is a secure viewer. Document content cannot be copied, and
            printing is disabled.
          </span>
        </div>
      </div>
    </Dialog>
  )
}
