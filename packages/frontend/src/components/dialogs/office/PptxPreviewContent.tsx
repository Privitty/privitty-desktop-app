import React, { useCallback, useEffect, useRef, useState } from 'react'
import { PPTXViewer } from 'pptxviewjs'

import { readLocalFileBuffer } from '../../../utils/readLocalFileBuffer'
import Icon from '../../Icon'

type Props = {
  filePath: string
  onLoad: () => void
  onError: (message: string) => void
}

export default function PptxPreviewContent({
  filePath,
  onLoad,
  onError,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PPTXViewer | null>(null)
  const [currentSlide, setCurrentSlide] = useState(1)
  const [totalSlides, setTotalSlides] = useState(0)

  const sizeCanvasToContainer = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) {
      return
    }

    const width = Math.max(1, Math.floor(container.clientWidth))
    const height = Math.max(1, Math.floor(container.clientHeight))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  }, [])

  const renderCurrentSlide = useCallback(
    async (viewer: PPTXViewer) => {
      const canvas = canvasRef.current
      if (!canvas) {
        return
      }

      sizeCanvasToContainer()
      await viewer.render(canvas)
      setCurrentSlide(viewer.getCurrentSlideIndex() + 1)
      setTotalSlides(viewer.getSlideCount())
    },
    [sizeCanvasToContainer]
  )

  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const loadPresentation = async () => {
      try {
        viewerRef.current?.destroy()

        const viewer = new PPTXViewer({
          canvas,
          slideSizeMode: 'fit',
          backgroundColor: '#ffffff',
        })
        viewerRef.current = viewer

        const bytes = await readLocalFileBuffer(filePath)
        await viewer.loadFile(bytes)
        await renderCurrentSlide(viewer)

        if (!cancelled) {
          onLoad()
        }
      } catch (err) {
        if (!cancelled) {
          onError(
            err instanceof Error
              ? err.message
              : 'Failed to preview PowerPoint presentation'
          )
        }
      }
    }

    void loadPresentation()

    return () => {
      cancelled = true
      viewerRef.current?.destroy()
      viewerRef.current = null
    }
  }, [filePath, onLoad, onError, renderCurrentSlide])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') {
      return
    }

    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const viewer = viewerRef.current
        if (!viewer) {
          return
        }
        void renderCurrentSlide(viewer)
      })
    })

    observer.observe(container)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [renderCurrentSlide])

  const goToPreviousSlide = async () => {
    const viewer = viewerRef.current
    const canvas = canvasRef.current
    if (!viewer || !canvas || currentSlide <= 1) {
      return
    }

    sizeCanvasToContainer()
    await viewer.previousSlide(canvas)
    setCurrentSlide(viewer.getCurrentSlideIndex() + 1)
  }

  const goToNextSlide = async () => {
    const viewer = viewerRef.current
    const canvas = canvasRef.current
    if (!viewer || !canvas || currentSlide >= totalSlides) {
      return
    }

    sizeCanvasToContainer()
    await viewer.nextSlide(canvas)
    setCurrentSlide(viewer.getCurrentSlideIndex() + 1)
  }

  return (
    <div className='office-pptx-preview'>
      <div ref={containerRef} className='office-pptx-canvas-container'>
        <canvas
          ref={canvasRef}
          className='office-pptx-canvas'
          onContextMenu={e => e.preventDefault()}
          onDragStart={e => e.preventDefault()}
        />
      </div>

      {totalSlides > 0 && (
        <div className='office-pptx-controls'>
          <div className='pagination-controls'>
            <button
              type='button'
              onClick={() => void goToPreviousSlide()}
              disabled={currentSlide <= 1}
              aria-label='Previous slide'
              className='page-button'
            >
              <Icon icon='chevron-left' size={20} />
            </button>
            <span className='office-pptx-slide-info'>
              Slide {currentSlide} of {totalSlides}
            </span>
            <button
              type='button'
              onClick={() => void goToNextSlide()}
              disabled={currentSlide >= totalSlides}
              aria-label='Next slide'
              className='page-button'
            >
              <Icon icon='chevron-right' size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
