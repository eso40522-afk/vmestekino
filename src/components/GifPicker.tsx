import { useState, useEffect, useRef, useCallback } from 'react'
import { API_URL } from '../config/api'
import './GifPicker.css'

interface GifPickerProps {
  onSelect: (gifUrl: string) => void
  onClose: () => void
  sessionToken: string | null
}

interface GifItem {
  id: number
  url: string
  addedAt: string
}

type GifTab = 'recent' | 'favorites'

export function GifPicker({ onSelect, onClose: _onClose, sessionToken }: GifPickerProps) {
  const [activeTab, setActiveTab] = useState<GifTab>('recent')
  const [recentGifs, setRecentGifs] = useState<GifItem[]>([])
  const [favorites, setFavorites] = useState<GifItem[]>([])
  const [favoriteUrls, setFavoriteUrls] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Загрузить последние гифки
  const loadRecent = useCallback(async () => {
    if (!sessionToken) return
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/gifs/user?sessionToken=${sessionToken}`)
      const data = await res.json()
      if (data.gifs) setRecentGifs(data.gifs)
    } catch (err) {
      console.error('Error loading recent gifs:', err)
    }
    setLoading(false)
  }, [sessionToken])

  // Загрузить избранные
  const loadFavorites = useCallback(async () => {
    if (!sessionToken) return
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/gifs/favorites?sessionToken=${sessionToken}`)
      const data = await res.json()
      if (data.gifs) {
        setFavorites(data.gifs)
        setFavoriteUrls(new Set(data.gifs.map((g: GifItem) => g.url)))
      }
    } catch (err) {
      console.error('Error loading favorite gifs:', err)
    }
    setLoading(false)
  }, [sessionToken])

  useEffect(() => {
    loadRecent()
    loadFavorites()
  }, [loadRecent, loadFavorites])

  const toggleFavorite = async (e: React.MouseEvent, url: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!sessionToken) return
    try {
      if (favoriteUrls.has(url)) {
        await fetch(`${API_URL}/gifs/favorite/remove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionToken, gifUrl: url })
        })
        setFavoriteUrls(prev => { const next = new Set(prev); next.delete(url); return next })
        setFavorites(prev => prev.filter(g => g.url !== url))
      } else {
        await fetch(`${API_URL}/gifs/favorite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionToken, gifUrl: url })
        })
        setFavoriteUrls(prev => new Set(prev).add(url))
        setFavorites(prev => [{ id: Date.now(), url, addedAt: new Date().toISOString() }, ...prev])
      }
    } catch (err) {
      console.error('Error toggling favorite:', err)
    }
  }

  const handleSelectGif = (e: React.MouseEvent, url: string) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect(url)
  }

  const deleteRecentGif = async (e: React.MouseEvent, gifId: number) => {
    e.preventDefault()
    e.stopPropagation()
    if (!sessionToken) return
    try {
      await fetch(`${API_URL}/gifs/${gifId}?sessionToken=${sessionToken}`, { method: 'DELETE' })
      setRecentGifs(prev => prev.filter(g => g.id !== gifId))
    } catch (err) {
      console.error('Error deleting gif:', err)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !sessionToken) return
    if (!file.type.startsWith('image/')) { alert('Можно загружать только изображения'); return }
    if (file.size > 10 * 1024 * 1024) { alert('Максимальный размер файла: 10 МБ'); return }
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = reader.result as string
      try {
        // Upload to server - returns a file URL instead of storing base64
        const uploadRes = await fetch(`${API_URL}/gifs/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionToken, gifUrl: base64 })
        })
        const uploadData = await uploadRes.json()
        const fileUrl = uploadData.url || base64

        await fetch(`${API_URL}/gifs/favorite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionToken, gifUrl: fileUrl })
        })
        loadFavorites()
        loadRecent()
        setActiveTab('favorites')
      } catch (err) {
        console.error('Error uploading gif:', err)
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const currentGifs = activeTab === 'recent' ? recentGifs : favorites

  return (
    <div className="gifPicker gifPicker--enter" onClick={e => e.stopPropagation()}>
      {/* Tabs */}
      <div className="gifPicker__tabs">
        <div className={`gifPicker__tabPill gifPicker__tabPill--${activeTab}`} />
        <button
          type="button"
          className={`gifPicker__tab ${activeTab === 'recent' ? 'gifPicker__tab--active' : ''}`}
          onClick={() => setActiveTab('recent')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          Последние
        </button>
        <button
          type="button"
          className={`gifPicker__tab ${activeTab === 'favorites' ? 'gifPicker__tab--active' : ''}`}
          onClick={() => { setActiveTab('favorites'); loadFavorites() }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          Избранное
        </button>
      </div>

      {/* Upload button */}
      <div className="gifPicker__uploadBar">
        <button type="button" className="gifPicker__uploadBtn" onClick={() => fileInputRef.current?.click()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Загрузить GIF
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/gif,image/png,image/jpeg,image/webp"
          onChange={handleUpload}
          style={{ display: 'none' }}
        />
      </div>

      {/* Content */}
      <div className="gifPicker__content">
        {loading ? (
          <div className="gifPicker__loading">
            <div className="gifPicker__spinner" />
          </div>
        ) : currentGifs.length === 0 ? (
          <div className="gifPicker__empty">
            <div className="gifPicker__emptyIcon">
              {activeTab === 'recent' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              )}
            </div>
            <span>{activeTab === 'recent' ? 'Нет отправленных GIF' : 'Нет избранных GIF'}</span>
            <span className="gifPicker__emptyHint">
              {activeTab === 'recent'
                ? 'Загрузите GIF и отправьте'
                : 'Нажмите ★ на гифке чтобы добавить'}
            </span>
          </div>
        ) : (
          <div className="gifPicker__grid">
            {currentGifs.map((gif, i) => (
              <div
                key={gif.id}
                className="gifPicker__item gifPicker__item--enter"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <img
                  src={gif.url}
                  alt="GIF"
                  className="gifPicker__img"
                  onClick={(e) => handleSelectGif(e, gif.url)}
                  loading="lazy"
                />
                <button
                  type="button"
                  className={`gifPicker__favBtn ${favoriteUrls.has(gif.url) ? 'gifPicker__favBtn--active' : ''}`}
                  onClick={(e) => toggleFavorite(e, gif.url)}
                  title={favoriteUrls.has(gif.url) ? 'Убрать из избранного' : 'В избранное'}
                >
                  {favoriteUrls.has(gif.url) ? '★' : '☆'}
                </button>
                {activeTab === 'recent' && (
                  <button
                    type="button"
                    className="gifPicker__deleteBtn"
                    onClick={(e) => deleteRecentGif(e, gif.id)}
                    title="Удалить из последних"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
