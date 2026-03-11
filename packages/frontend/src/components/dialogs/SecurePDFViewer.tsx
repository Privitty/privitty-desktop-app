import React, { useEffect, useRef, useState, useCallback } from 'react'

import Dialog from '../Dialog'
import { IconButton } from '../Icon'
import Icon from '../Icon'
import { getLogger } from '../../../../shared/logger'
import { useInitEffect } from '../helpers/hooks'
import useTranslationFunction from '../../hooks/useTranslationFunction'
import { runtime } from '@deltachat-desktop/runtime-interface'
import { basename } from 'path'

import type { DialogProps } from '../../contexts/DialogContext'

const log = getLogger('renderer/secure_pdf_viewer')

// PDF.js types
interface PDFDocumentProxy {
  numPages: number
  getPage(pageNumber: number): Promise<PDFPageProxy>
}

interface PDFPageProxy {
  getViewport(params: { scale: number }): PDFPageViewport
  render(params: PDFRenderParams): PDFRenderTask
}

interface PDFPageViewport {
  width: number
  height: number
}

interface PDFRenderParams {
  canvasContext: CanvasRenderingContext2D
  viewport: PDFPageViewport
}

interface PDFRenderTask {
  promise: Promise<void>
}

type Props = {
  filePath: string
  fileName: string
  canDownload?: boolean
}

export default function SecurePDFViewer(props: Props & DialogProps) {
  const { filePath, fileName, canDownload, onClose } = props
  const tx = useTranslationFunction()

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [pageLoading, setPageLoading] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const blobUrlRef = useRef<string | null>(null)

  // Load PDF document
  const loadPDF = useCallback(async () => {
    try {
      // Cleanup any existing blob URL
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }

      setLoading(true)
      setError(null)

      // Validate file path
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid file path provided')
      }

      // Load PDF.js library
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic import for pdfjs-dist
      const pdfjsLibrary = require('pdfjs-dist')

      // Set up worker
      try {
        const workerPath = 'pdf.worker.min.mjs'
        const workerResponse = await fetch(workerPath)
        if (workerResponse.ok) {
          const workerBlob = await workerResponse.blob()
          const workerBlobUrl = URL.createObjectURL(workerBlob)
          pdfjsLibrary.GlobalWorkerOptions.workerSrc = workerBlobUrl
        }
      } catch {
        // Fallback: disable worker and use main thread
        pdfjsLibrary.GlobalWorkerOptions.workerSrc = null
      }

      // Load file using Node.js fs (works on both Windows and macOS)
      let pdfSource: string | Uint8Array

      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Node.js fs/path in Electron
        const fs = require('fs')
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Node.js path in Electron
        const path = require('path')

        // Strip any file:// or file:/// prefix, then resolve to an absolute path.
        // NOTE: do NOT strip the leading '/' from POSIX absolute paths — doing so
        // would make the path relative and path.resolve() would resolve it from
        // cwd instead of the filesystem root.
        const stripped = filePath
          .replace(/^file:\/\/\//, '') // file:///C:/... or file:////...
          .replace(/^file:\/\//, '') // file:// (no third slash)
          .replace(/\\/g, '/') // normalise Windows back-slashes
        const normalizedPath = path.resolve(stripped)

        // Check if file exists and read it
        if (!fs.existsSync(normalizedPath)) {
          throw new Error(`File does not exist: ${normalizedPath}`)
        }

        const fileBuffer = fs.readFileSync(normalizedPath)
        const blob = new Blob([fileBuffer], { type: 'application/pdf' })
        const blobUrl = URL.createObjectURL(blob)
        pdfSource = blobUrl
        blobUrlRef.current = blobUrl

        log.info('File loaded using Node.js fs', {
          fileSize: fileBuffer.length,
        })
      } catch (_fsError) {
        // Fallback: use file:// URL (works on macOS, may fail on Windows)
        let normalizedFilePath = filePath
        if (!normalizedFilePath.startsWith('file://')) {
          normalizedFilePath = `file:///${normalizedFilePath.replace(/\\/g, '/')}`
        }
        pdfSource = normalizedFilePath
        log.info('Using file:// URL fallback')
      }

      // Load the PDF document
      const loadingTask = pdfjsLibrary.getDocument(pdfSource)
      const pdfDoc = await loadingTask.promise

      setPdf(pdfDoc)
      setTotalPages(pdfDoc.numPages)
      setCurrentPage(1)
      setLoading(false)

      log.info('PDF loaded successfully', { pages: pdfDoc.numPages })
    } catch (err) {
      log.error('Failed to load PDF', err)
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      setLoading(false)
    }
  }, [filePath])

  // Render current page
  const renderPage = useCallback(async () => {
    if (!pdf || !canvasRef.current) return

    try {
      setPageLoading(true)

      const page = await pdf.getPage(currentPage)
      const canvas = canvasRef.current
      const context = canvas.getContext('2d')

      if (!context) {
        throw new Error('Failed to get canvas context')
      }

      const viewport = page.getViewport({ scale })

      canvas.height = viewport.height
      canvas.width = viewport.width

      await page.render({
        canvasContext: context as any,
        viewport: viewport,
      }).promise

      setPageLoading(false)
    } catch (err) {
      log.error('Failed to render page', err)
      setError(err instanceof Error ? err.message : 'Failed to render page')
      setPageLoading(false)
    }
  }, [pdf, currentPage, scale])

  // Load PDF on mount
  useInitEffect(() => {
    loadPDF()
  })

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [])

  // Security: Prevent context menu and keyboard shortcuts
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) {
      const preventContextMenu = (e: Event) => {
        e.preventDefault()
        return false
      }

      canvas.addEventListener('contextmenu', preventContextMenu)

      return () => {
        canvas.removeEventListener('contextmenu', preventContextMenu)
      }
    }
  }, [pdf])

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

  // Re-render when page or scale changes
  useEffect(() => {
    if (pdf) {
      renderPage()
    }
  }, [pdf, renderPage])

  // Navigation functions
  const goToPreviousPage = useCallback(() => {
    if (currentPage > 1) {
      setCurrentPage(prev => prev - 1)
    }
  }, [currentPage])

  const goToNextPage = useCallback(() => {
    if (currentPage < totalPages) {
      setCurrentPage(prev => prev + 1)
    }
  }, [currentPage, totalPages])

  const goToFirstPage = useCallback(() => {
    setCurrentPage(1)
  }, [])

  const goToLastPage = useCallback(() => {
    setCurrentPage(totalPages)
  }, [totalPages])

  const goToPage = useCallback(
    (pageNumber: number) => {
      if (pageNumber >= 1 && pageNumber <= totalPages) {
        setCurrentPage(pageNumber)
      }
    },
    [totalPages]
  )

  const zoomIn = useCallback(() => {
    setScale(prev => Math.min(prev + 0.25, 3))
  }, [])

  const zoomOut = useCallback(() => {
    setScale(prev => Math.max(prev - 0.25, 0.5))
  }, [])

  const resetZoom = useCallback(() => {
    setScale(1)
  }, [])

  const onDownload = async () => {
    try {
      let name = fileName || basename(filePath) || 'document.pdf'

      // remove all .prv
      name = name.replace(/\.prv/g, '')

      // ensure pdf extension
      if (!name.endsWith('.pdf')) {
        name = `${name}.pdf`
      }

      await runtime.downloadFile(filePath, name)

      log.info('Secure PDF downloaded', { filePath, name })
    } catch (err) {
      log.error('Secure PDF download failed', err)
    }
  }

  if (loading) {
    return (
      <Dialog onClose={onClose} className='secure-pdf-viewer-dialog'>
        <div className='secure-pdf-viewer-loading'>
          <div className='loading-spinner'></div>
          <p>Loading PDF...</p>
        </div>
      </Dialog>
    )
  }

  if (error) {
    return (
      <Dialog onClose={onClose} className='secure-pdf-viewer-dialog'>
        <div className='secure-pdf-viewer-error'>
          <IconButton icon='cross' size={48} aria-label='Error loading PDF' />
          <h3>PDF Loading Error</h3>
          <p>{error}</p>
          <button onClick={loadPDF} className='retry-button'>
            Retry
          </button>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog onClose={onClose} className='secure-pdf-viewer-dialog'>
      <div className='secure-pdf-viewer-header'>
        <div className='secure-pdf-viewer-title'>
          <h2>{fileName}</h2>
          <span className='page-info'>
            Page {currentPage} of {totalPages}
          </span>
        </div>

        <div className='secure-pdf-viewer-header-actions'>
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

      <div className='secure-pdf-viewer-content'>
        {pageLoading && (
          <div className='page-loading-overlay'>
            <div className='page-loading-spinner'></div>
            <span>Loading page...</span>
          </div>
        )}

        <div className='pdf-page-container'>
          <canvas
            ref={canvasRef}
            className='pdf-canvas'
            style={{
              border: '1px solid #ccc',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              backgroundColor: 'white',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              MozUserSelect: 'none',
              msUserSelect: 'none',
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
              transition: 'transform 0.2s ease',
            }}
            onDragStart={e => e.preventDefault()}
            onDrop={e => e.preventDefault()}
          />
        </div>
      </div>

      {/* Combined controls - compact design */}
      <div className='secure-pdf-viewer-controls-bar'>
        <div className='controls-container'>
          {/* Zoom controls */}
          <div className='zoom-controls'>
            <button
              onClick={zoomOut}
              disabled={scale <= 0.5}
              aria-label='Zoom Out'
              className='zoom-button'
            >
              <Icon icon='minus' size={20} />
            </button>
            <span className='zoom-level'>{Math.round(scale * 100)}%</span>
            <button
              onClick={zoomIn}
              disabled={scale >= 3}
              aria-label='Zoom In'
              className='zoom-button'
            >
              <Icon icon='plus' size={20} />
            </button>
            <IconButton
              icon='rotate-right'
              onClick={resetZoom}
              aria-label={tx('reset_zoom')}
              size={20}
            />
          </div>

          {/* Pagination controls */}
          <div className='pagination-controls'>
            <button
              onClick={goToFirstPage}
              disabled={currentPage <= 1}
              aria-label='First Page'
              className='page-button'
            >
              <Icon icon='chevron-left' size={20} />
            </button>

            <button
              onClick={goToPreviousPage}
              disabled={currentPage <= 1}
              aria-label='Previous Page'
              className='page-button'
            >
              <Icon icon='chevron-left' size={20} />
            </button>

            <div className='page-input-container'>
              <input
                type='number'
                min={1}
                max={totalPages}
                value={currentPage}
                onChange={e => {
                  const page = parseInt(e.target.value)
                  if (!isNaN(page)) {
                    goToPage(page)
                  }
                }}
                className='page-input'
                aria-label='Go to page'
              />
              <span className='page-separator'>/</span>
              <span className='total-pages'>{totalPages}</span>
            </div>

            <button
              onClick={goToNextPage}
              disabled={currentPage >= totalPages}
              aria-label='Next Page'
              className='page-button'
            >
              <Icon icon='chevron-right' size={20} />
            </button>

            <button
              onClick={goToLastPage}
              disabled={currentPage >= totalPages}
              aria-label='Last Page'
              className='page-button'
            >
              <Icon icon='chevron-right' size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className='secure-pdf-viewer-footer'>
        <div className='secure-notice'>
          <IconButton icon='info' size={16} aria-label='Secure viewer notice' />
          <span>
            This is a secure viewer. PDF content cannot be copied, and printing
            is disabled.
          </span>
        </div>
      </div>
    </Dialog>
  )
}
