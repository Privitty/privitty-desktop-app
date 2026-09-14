import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import Dialog from '../Dialog'
import { IconButton } from '../Icon'
import { getLogger } from '../../../../shared/logger'

import type { DialogProps } from '../../contexts/DialogContext'

const log = getLogger('renderer/secure_text_viewer')

// Text extensions treated as viewable
const TEXT_EXTENSIONS = [
  '.log',
  '.txt',
  '.csv',
  '.md',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.conf',
  '.sh',
  '.py',
  '.rs',
  '.js',
  '.ts',
]

export function isTextViewable(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return TEXT_EXTENSIONS.some(ext => lower.endsWith(ext))
}

type Props = {
  filePath: string
  fileName: string
  canDownload?: boolean
}

type SearchMatch = { pos: number; end: number }

export default function SecureTextViewer(props: Props & DialogProps) {
  const { filePath, fileName: rawFileName, onClose } = props
  // Strip .prv wrapper if present (the viewer shows the real name)
  const fileName =
    rawFileName?.replace(/\.prv$/i, '') ||
    filePath
      .split('/')
      .pop()
      ?.replace(/\.prv$/i, '') ||
    'File'

  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fontSize, setFontSize] = useState(13)
  const [searchQuery, setSearchQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [showSearch, setShowSearch] = useState(false)

  const contentRef = useRef<HTMLPreElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // ── Load file ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const url = filePath.startsWith('/')
      ? 'file://' + filePath
      : 'file:///' + filePath.replace(/\\/g, '/')

    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      })
      .then(text => {
        setContent(text)
        setLoading(false)
      })
      .catch(e => {
        log.error('SecureTextViewer: failed to read file', e)
        setError('Could not read file: ' + e.message)
        setLoading(false)
      })
  }, [filePath])

  // ── Search ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchQuery || !content) {
      setMatches([])
      setMatchIndex(0)
      return
    }
    const lower = content.toLowerCase()
    const q = searchQuery.toLowerCase()
    const found: SearchMatch[] = []
    let pos = 0
    while ((pos = lower.indexOf(q, pos)) !== -1) {
      found.push({ pos, end: pos + q.length })
      pos += q.length
    }
    setMatches(found)
    setMatchIndex(0)
  }, [searchQuery, content])

  // Scroll active match into view
  useEffect(() => {
    if (matches.length === 0 || !contentRef.current) return
    const marks =
      contentRef.current.querySelectorAll<HTMLSpanElement>('.stv-match')
    const active = marks[matchIndex]
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [matchIndex, matches])

  // ── Highlighted content ─────────────────────────────────────────────────────
  const highlighted = useMemo(() => {
    if (!content) return null
    if (!searchQuery || matches.length === 0) {
      return <span dangerouslySetInnerHTML={{ __html: escapeHtml(content) }} />
    }
    const q = searchQuery.toLowerCase()
    const lower = content.toLowerCase()
    const parts: React.ReactNode[] = []
    let cursor = 0
    let mi = 0
    while (cursor < content.length) {
      const next = lower.indexOf(q, cursor)
      if (next === -1) {
        parts.push(
          <span
            key={`t-${cursor}`}
            dangerouslySetInnerHTML={{
              __html: escapeHtml(content.slice(cursor)),
            }}
          />
        )
        break
      }
      if (next > cursor) {
        parts.push(
          <span
            key={`t-${cursor}`}
            dangerouslySetInnerHTML={{
              __html: escapeHtml(content.slice(cursor, next)),
            }}
          />
        )
      }
      parts.push(
        <span
          key={`m-${next}`}
          className={`stv-match${mi === matchIndex ? ' stv-match-active' : ''}`}
          dangerouslySetInnerHTML={{
            __html: escapeHtml(content.slice(next, next + q.length)),
          }}
        />
      )
      cursor = next + q.length
      mi++
    }
    return <>{parts}</>
  }, [content, searchQuery, matches, matchIndex])

  // ── Search navigation ────────────────────────────────────────────────────────
  const nextMatch = () =>
    setMatchIndex(i => (i + 1 < matches.length ? i + 1 : 0))
  const prevMatch = () =>
    setMatchIndex(i => (i - 1 >= 0 ? i - 1 : matches.length - 1))

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  const handleDialogKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault()
      setShowSearch(s => {
        if (!s) setTimeout(() => searchRef.current?.focus(), 50)
        return true
      })
    }
  }, [])

  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.shiftKey ? prevMatch() : nextMatch()
    }
    if (e.key === 'Escape') {
      setShowSearch(false)
      setSearchQuery('')
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Dialog onClose={onClose} className='secure-text-viewer'>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className='stv-header'>
        <span className='stv-file-icon'>📄</span>
        <span className='stv-title' title={fileName}>
          {fileName}
        </span>

        {/* Zoom out / label / zoom in */}
        <button
          className='stv-btn'
          onClick={() => setFontSize(s => Math.max(8, s - 1))}
          aria-label='Zoom out'
        >
          –
        </button>
        <span className='stv-zoom-label'>{fontSize}px</span>
        <button
          className='stv-btn'
          onClick={() => setFontSize(s => Math.min(32, s + 1))}
          aria-label='Zoom in'
        >
          +
        </button>

        {/* Search toggle */}
        <IconButton
          icon='search'
          aria-label='Search (Ctrl+F)'
          onClick={() => {
            setShowSearch(s => {
              if (!s) setTimeout(() => searchRef.current?.focus(), 50)
              return !s
            })
          }}
        />

        {/* Close */}
        <IconButton icon='cross' aria-label='Close' onClick={onClose} />
      </div>

      {/* ── Search bar ─────────────────────────────────────────────────── */}
      {showSearch && (
        <div className='stv-search-bar'>
          <input
            ref={searchRef}
            className='stv-search-input'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKey}
            placeholder='Search…'
            autoFocus
          />
          {matches.length > 0 && (
            <span className='stv-match-count'>
              {matchIndex + 1} / {matches.length}
            </span>
          )}
          {searchQuery && matches.length === 0 && (
            <span className='stv-no-match'>No matches</span>
          )}
          <button
            className='stv-btn'
            onClick={prevMatch}
            aria-label='Previous match'
          >
            ▲
          </button>
          <button
            className='stv-btn'
            onClick={nextMatch}
            aria-label='Next match'
          >
            ▼
          </button>
        </div>
      )}

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div
        className='stv-content-area'
        onKeyDown={handleDialogKeyDown}
        tabIndex={0}
      >
        {loading && <p className='stv-status'>Loading…</p>}
        {error && <p className='stv-status stv-error'>{error}</p>}
        {!loading && !error && (
          <pre ref={contentRef} className='stv-content' style={{ fontSize }}>
            {highlighted}
          </pre>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      {!loading && !error && content && (
        <div className='stv-footer'>
          <span>
            {content.split('\n').length} lines ·{' '}
            {(content.length / 1024).toFixed(1)} KB
          </span>
        </div>
      )}
    </Dialog>
  )
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
