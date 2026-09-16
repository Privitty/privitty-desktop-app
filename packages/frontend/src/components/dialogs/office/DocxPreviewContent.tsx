import React, { useEffect, useRef } from 'react'
import { renderAsync } from 'docx-preview'

import { readLocalFileBuffer } from '../../../utils/readLocalFileBuffer'

type Props = {
  filePath: string
  onLoad: () => void
  onError: (message: string) => void
}

export default function DocxPreviewContent({
  filePath,
  onLoad,
  onError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const styleContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    const styleContainer = styleContainerRef.current

    if (!container || !styleContainer) {
      return
    }

    const loadDocument = async () => {
      try {
        container.innerHTML = ''
        styleContainer.innerHTML = ''

        const bytes = await readLocalFileBuffer(filePath)
        await renderAsync(bytes, container, styleContainer, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          className: 'docx-preview-content',
        })

        if (!cancelled) {
          onLoad()
        }
      } catch (err) {
        if (!cancelled) {
          onError(
            err instanceof Error
              ? err.message
              : 'Failed to preview Word document'
          )
        }
      }
    }

    void loadDocument()

    return () => {
      cancelled = true
      if (container) {
        container.innerHTML = ''
      }
      if (styleContainer) {
        styleContainer.innerHTML = ''
      }
    }
  }, [filePath, onLoad, onError])

  return (
    <div className='office-docx-preview'>
      <div ref={styleContainerRef} className='office-docx-preview-styles' />
      <div
        ref={containerRef}
        className='office-docx-preview-body'
        onContextMenu={e => e.preventDefault()}
      />
    </div>
  )
}
