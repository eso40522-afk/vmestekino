import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { API_URL } from '../config/api'
import './UrlPasteModal.css'

export interface UrlPasteModalProps {
  isOpen: boolean
  onClose: () => void
  /** Called with the validated URL when user submits. Receives both the raw URL and the selected watch mode. */
  onSubmit: (payload: { url: string; mode: 'solo' | 'room'; isPrivate: boolean }) => void | Promise<void>
  /** When true, user is a guest and can only watch solo. */
  guestMode?: boolean
  title?: string
  hint?: string
}

interface ThumbnailState {
  loading: boolean
  url: string | null
  title: string | null
  failed: boolean
  provider: 'rutube' | 'vk' | null
}

const INITIAL_THUMB: ThumbnailState = { loading: false, url: null, title: null, failed: false, provider: null }

function looksLikeKnownProvider(url: string): boolean {
  const lower = url.toLowerCase()
  return /rutube\.ru|vkvideo\.ru|vk\.com|vk\.ru/.test(lower)
}

export default function UrlPasteModal({
  isOpen,
  onClose,
  onSubmit,
  guestMode = false,
  title = 'Вставьте ссылку на видео',
  hint = 'Поддерживаются: RuTube, VK Video, прямые ссылки на .mp4 и другие видеоформаты',
}: UrlPasteModalProps) {
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<'solo' | 'room'>('solo')
  const [isPrivate, setIsPrivate] = useState(false)
  const [thumb, setThumb] = useState<ThumbnailState>(INITIAL_THUMB)
  const [submitting, setSubmitting] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const fetchSeqRef = useRef(0)

  useEffect(() => {
    if (isOpen) {
      setUrl('')
      setMode('solo')
      setIsPrivate(false)
      setThumb(INITIAL_THUMB)
      setSubmitting(false)
      setTimeout(() => inputRef.current?.focus(), 60)
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = url.trim()
    if (!trimmed) {
      setThumb(INITIAL_THUMB)
      return
    }
    if (!looksLikeKnownProvider(trimmed)) {
      setThumb({ ...INITIAL_THUMB })
      return
    }

    debounceRef.current = setTimeout(async () => {
      const seq = ++fetchSeqRef.current
      setThumb(prev => ({ ...prev, loading: true, failed: false }))
      try {
        const resp = await fetch(`${API_URL}/url-thumbnail?url=${encodeURIComponent(trimmed)}`)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = await resp.json() as {
          ok: boolean
          thumbnailUrl: string | null
          title: string | null
          provider: 'rutube' | 'vk' | null
        }
        if (seq !== fetchSeqRef.current) return
        if (data.ok && data.thumbnailUrl) {
          setThumb({ loading: false, url: data.thumbnailUrl, title: data.title, failed: false, provider: data.provider })
        } else {
          setThumb({ loading: false, url: null, title: null, failed: true, provider: null })
        }
      } catch {
        if (seq !== fetchSeqRef.current) return
        setThumb({ loading: false, url: null, title: null, failed: true, provider: null })
      }
    }, 450)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [url, isOpen])

  const handleClose = () => {
    if (submitting) return
    onClose()
  }

  // Escape — быстрое закрытие
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, submitting])

  const handleSubmit = async () => {
    const trimmed = url.trim()
    if (!trimmed || submitting) return
    try {
      setSubmitting(true)
      await onSubmit({ url: trimmed, mode, isPrivate: mode === 'room' ? isPrivate : false })
      setSubmitting(false)
      onClose()
    } catch (err) {
      console.error('UrlPasteModal submit failed', err)
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return createPortal(
    <div
      className="urlPasteModal__overlay"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="urlPasteModal__content"
        onClick={e => e.stopPropagation()}
      >
        <button
          className="urlPasteModal__close"
          onClick={handleClose}
          type="button"
          aria-label="Закрыть"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <h2 className="urlPasteModal__title">
          <span className="urlPasteModal__titleIcon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </span>
          {title}
        </h2>
        <p className="urlPasteModal__hint">{hint}</p>

        <input
          ref={inputRef}
          type="text"
          className="urlPasteModal__input"
          placeholder="https://rutube.ru/video/... или ссылка на VK Video / .mp4"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && url.trim() && !submitting) handleSubmit()
          }}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />

        {/* Превью */}
        <div className="urlPasteModal__preview">
          {thumb.loading && (
            <div className="urlPasteModal__previewLoading">
              <div className="urlPasteModal__spinner" />
              <span>Загружаем баннер…</span>
            </div>
          )}
          {!thumb.loading && thumb.url && (
            <div className="urlPasteModal__previewCard">
              <img src={thumb.url} alt={thumb.title || 'Превью видео'} className="urlPasteModal__previewImg" />
              {thumb.title && (
                <div className="urlPasteModal__previewMeta">
                  <span className="urlPasteModal__previewBadge">
                    {thumb.provider === 'rutube' ? 'RuTube' : 'VK Video'}
                  </span>
                  <span className="urlPasteModal__previewTitle">{thumb.title}</span>
                </div>
              )}
            </div>
          )}
          {!thumb.loading && !thumb.url && thumb.failed && (
            <div className="urlPasteModal__previewFallback">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>В настоящий момент не удалось загрузить баннер</span>
            </div>
          )}
        </div>

        <div className="urlPasteModal__examples">
          <p>Примеры:</p>
          <ul>
            <li>RuTube: https://rutube.ru/video/abc123def456/</li>
            <li>VK Video: https://vkvideo.ru/video-123456_789012</li>
            <li>Прямая ссылка: https://example.com/video.mp4</li>
          </ul>
        </div>

        {/* Режим просмотра */}
        <div className="urlPasteModal__toggle">
          <div className={`urlPasteModal__pill urlPasteModal__pill--${mode}`} />
          <button
            type="button"
            className={`urlPasteModal__tab${mode === 'solo' ? ' urlPasteModal__tab--active' : ''}`}
            onClick={() => setMode('solo')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            В одиночку
          </button>
          <button
            type="button"
            className={`urlPasteModal__tab${mode === 'room' ? ' urlPasteModal__tab--active' : ''}${guestMode ? ' urlPasteModal__tab--locked' : ''}`}
            onClick={() => { if (!guestMode) setMode('room') }}
            title={guestMode ? 'Доступно после регистрации' : undefined}
          >
            {guestMode && (
              <svg className="urlPasteModal__tabLock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            )}
            <span className="urlPasteModal__tabContent">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
              Создать комнату
            </span>
          </button>
        </div>

        {/* Приватность */}
        {mode === 'room' && !guestMode && (
          <div className="urlPasteModal__privacy">
            <div className="urlPasteModal__privacyInfo">
              <span className="urlPasteModal__privacyLabel">Приватная комната</span>
              <span className="urlPasteModal__privacyDesc">
                {isPrivate ? 'Комната будет скрыта в списке' : 'Комната видна всем пользователям'}
              </span>
            </div>
            <button
              type="button"
              className={`urlPasteModal__switch${isPrivate ? ' urlPasteModal__switch--active' : ''}`}
              onClick={() => setIsPrivate(p => !p)}
              aria-pressed={isPrivate}
            >
              <span className="urlPasteModal__switchThumb" />
            </button>
          </div>
        )}

        <button
          type="button"
          className="urlPasteModal__submit"
          onClick={handleSubmit}
          disabled={!url.trim() || submitting}
        >
          {submitting ? (
            <span className="urlPasteModal__submitInner">
              <span className="urlPasteModal__spinner urlPasteModal__spinner--inline" />
              Готовим просмотр…
            </span>
          ) : (
            <span className="urlPasteModal__submitInner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              Начать просмотр
            </span>
          )}
        </button>
      </div>
    </div>,
    document.body
  )
}
