import React, { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'

import { readLocalFileBuffer } from '../../../utils/readLocalFileBuffer'

type Props = {
  filePath: string
  onLoad: () => void
  onError: (message: string) => void
}

export default function ExcelPreviewContent({
  filePath,
  onLoad,
  onError,
}: Props) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [activeSheet, setActiveSheet] = useState('')

  useEffect(() => {
    let cancelled = false

    const loadWorkbook = async () => {
      try {
        const bytes = await readLocalFileBuffer(filePath)
        const parsedWorkbook = XLSX.read(bytes, { type: 'array' })
        const firstSheet = parsedWorkbook.SheetNames[0] ?? ''

        if (!cancelled) {
          setWorkbook(parsedWorkbook)
          setActiveSheet(firstSheet)
          onLoad()
        }
      } catch (err) {
        if (!cancelled) {
          onError(
            err instanceof Error
              ? err.message
              : 'Failed to preview Excel workbook'
          )
        }
      }
    }

    void loadWorkbook()

    return () => {
      cancelled = true
    }
  }, [filePath, onLoad, onError])

  const sheetHtml = useMemo(() => {
    if (!workbook || !activeSheet) {
      return ''
    }

    const worksheet = workbook.Sheets[activeSheet]
    if (!worksheet) {
      return ''
    }

    return XLSX.utils.sheet_to_html(worksheet, { editable: false })
  }, [workbook, activeSheet])

  if (!workbook) {
    return null
  }

  return (
    <div className='office-excel-preview'>
      {workbook.SheetNames.length > 1 && (
        <div className='office-excel-sheet-tabs' role='tablist'>
          {workbook.SheetNames.map(sheetName => (
            <button
              key={sheetName}
              type='button'
              role='tab'
              aria-selected={sheetName === activeSheet}
              className={
                sheetName === activeSheet
                  ? 'office-excel-sheet-tab active'
                  : 'office-excel-sheet-tab'
              }
              onClick={() => setActiveSheet(sheetName)}
            >
              {sheetName}
            </button>
          ))}
        </div>
      )}

      <div
        className='office-excel-sheet-content'
        onContextMenu={e => e.preventDefault()}
        dangerouslySetInnerHTML={{ __html: sheetHtml }}
      />
    </div>
  )
}
