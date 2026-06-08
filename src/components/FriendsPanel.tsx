import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSocket, type DirectChatUser } from '../contexts/SocketContext'
import { API_URL } from '../config/api'
import { GENRE_OPTIONS, getGenreOption } from '../data/genres'
import './FriendsPanel.css'

type Tab = 'friends' | 'requests' | 'search'

interface SearchUser extends DirectChatUser {
  friendshipStatus: 'none' | 'pending_outgoing' | 'pending_incoming' | 'friends'
  genreMatches?: number
}

interface FriendsPanelProps {
  isOpen: boolean
  onClose: () => void
  onOpenChat: (userId: string) => void
  onOpenProfile: (userId: string, handle?: string) => void
}

function Avatar({ user, size = 40 }: { user: DirectChatUser, size?: number }) {
  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.username}
        className="fp-avatar fp-avatar--img"
        style={{ width: size, height: size }}
        draggable={false}
      />
    )
  }
  return (
    <div
      className="fp-avatar fp-avatar--placeholder"
      style={{ width: size, height: size, background: user.color || '#6366f1', fontSize: Math.round(size * 0.4) }}
    >
      {user.initials || (user.username || '?').slice(0, 2).toUpperCase()}
    </div>
  )
}

function SpinnerDot() {
  return <span className="fp-spinner" aria-hidden="true" />
}

function GenreChips({ genres, max = 3 }: { genres?: number[]; max?: number }) {
  if (!genres || genres.length === 0) return null
  const visible = genres.slice(0, max)
  return (
    <span className="fp-row__genres">
      {visible.map(id => {
        const g = getGenreOption(id)
        if (!g) return null
        return (
          <span key={id} className="fp-row__genre" title={g.name}>
            <span className="fp-row__genreEmoji">{g.emoji}</span>
            <span className="fp-row__genreName">{g.name}</span>
          </span>
        )
      })}
    </span>
  )
}

export default function FriendsPanel({ isOpen, onClose, onOpenChat, onOpenProfile }: FriendsPanelProps) {
  const { token, user: me } = useAuth()
  const { socket, friendsVersion } = useSocket()

  const [tab, setTab] = useState<Tab>('friends')
  const [friends, setFriends] = useState<DirectChatUser[]>([])
  const [incoming, setIncoming] = useState<DirectChatUser[]>([])
  const [outgoing, setOutgoing] = useState<DirectChatUser[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchUser[]>([])
  const [selectedGenres, setSelectedGenres] = useState<number[]>([])
  const [friendsFilter, setFriendsFilter] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [pendingActions, setPendingActions] = useState<Record<string, boolean>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showGenreFilter, setShowGenreFilter] = useState(false)
  const [genreFilterClosing, setGenreFilterClosing] = useState(false)

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const genreFilterCloseTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const toggleGenreFilter = useCallback(() => {
    if (genreFilterCloseTimerRef.current) {
      clearTimeout(genreFilterCloseTimerRef.current)
      genreFilterCloseTimerRef.current = undefined
    }
    setShowGenreFilter(prev => {
      if (prev) {
        setGenreFilterClosing(true)
        genreFilterCloseTimerRef.current = setTimeout(() => {
          setShowGenreFilter(false)
          setGenreFilterClosing(false)
        }, 260)
        return prev
      }
      setGenreFilterClosing(false)
      return true
    })
  }, [])

  useEffect(() => () => {
    if (genreFilterCloseTimerRef.current) clearTimeout(genreFilterCloseTimerRef.current)
  }, [])
  const closeOnEscRef = useRef(onClose)
  closeOnEscRef.current = onClose

  const authHeaders = useMemo(() => {
    if (!token) return undefined
    return { Authorization: `Bearer ${token}` }
  }, [token])

  const setBusy = useCallback((id: string, value: boolean) => {
    setPendingActions(prev => {
      const next = { ...prev }
      if (value) next[id] = true
      else delete next[id]
      return next
    })
  }, [])

  const refreshLists = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    try {
      const [friendsRes, requestsRes] = await Promise.all([
        fetch(`${API_URL}/friends`, { headers: authHeaders }),
        fetch(`${API_URL}/friends/requests`, { headers: authHeaders })
      ])
      const friendsData = friendsRes.ok ? await friendsRes.json() : { friends: [] }
      const requestsData = requestsRes.ok ? await requestsRes.json() : { incoming: [], outgoing: [] }
      setFriends(friendsData.friends || [])
      setIncoming(requestsData.incoming || [])
      setOutgoing(requestsData.outgoing || [])
    } catch (err) {
      console.error('Failed to load friends data', err)
    } finally {
      setIsLoading(false)
    }
  }, [authHeaders, token])

  useEffect(() => {
    if (isOpen) {
      refreshLists()
      setErrorMessage(null)
    }
  }, [isOpen, refreshLists])

  useEffect(() => {
    if (!isOpen) return
    refreshLists()
  }, [friendsVersion, isOpen, refreshLists])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOnEscRef.current()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen])

  // Поиск (debounced) — поддерживает имя + фильтр по жанрам
  useEffect(() => {
    if (tab !== 'search') return
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (!token) return
    setIsSearching(true)
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams()
        if (searchQuery.trim()) params.set('q', searchQuery.trim())
        if (selectedGenres.length > 0) params.set('genres', selectedGenres.join(','))
        const url = `${API_URL}/users/search${params.toString() ? `?${params.toString()}` : ''}`
        const res = await fetch(url, { headers: authHeaders })
        if (res.ok) {
          const data = await res.json()
          setSearchResults(data.users || [])
        }
      } catch (err) {
        console.error('Search failed', err)
      } finally {
        setIsSearching(false)
      }
    }, 280)

    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [searchQuery, selectedGenres, tab, token, authHeaders, friendsVersion])

  // Действия
  const handleRequest = async (userId: string) => {
    if (!token) return
    setBusy(userId, true)
    setErrorMessage(null)
    try {
      const res = await fetch(`${API_URL}/friends/request/${userId}`, {
        method: 'POST',
        headers: authHeaders
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setErrorMessage(data?.error || 'Не удалось отправить заявку')
        return
      }
      const status = data?.status as SearchUser['friendshipStatus']
      setSearchResults(prev => prev.map(u => u.id === userId ? { ...u, friendshipStatus: status || 'pending_outgoing' } : u))
      refreshLists()
    } finally {
      setBusy(userId, false)
    }
  }

  const handleAccept = async (userId: string) => {
    if (!token) return
    setBusy(userId, true)
    try {
      const res = await fetch(`${API_URL}/friends/accept/${userId}`, {
        method: 'POST',
        headers: authHeaders
      })
      if (res.ok) {
        setIncoming(prev => prev.filter(u => u.id !== userId))
        refreshLists()
      }
    } finally {
      setBusy(userId, false)
    }
  }

  const handleDecline = async (userId: string) => {
    if (!token) return
    setBusy(userId, true)
    try {
      const res = await fetch(`${API_URL}/friends/decline/${userId}`, {
        method: 'POST',
        headers: authHeaders
      })
      if (res.ok) {
        setIncoming(prev => prev.filter(u => u.id !== userId))
        refreshLists()
      }
    } finally {
      setBusy(userId, false)
    }
  }

  const handleRemove = async (userId: string) => {
    if (!token) return
    setBusy(userId, true)
    try {
      const res = await fetch(`${API_URL}/friends/${userId}`, {
        method: 'DELETE',
        headers: authHeaders
      })
      if (res.ok) {
        setFriends(prev => prev.filter(u => u.id !== userId))
        setOutgoing(prev => prev.filter(u => u.id !== userId))
        setSearchResults(prev => prev.map(u => u.id === userId ? { ...u, friendshipStatus: 'none' } : u))
        refreshLists()
      }
    } finally {
      setBusy(userId, false)
    }
  }

  useEffect(() => {
    if (!socket || !isOpen) return
    const handler = () => refreshLists()
    socket.on('friend-request-received', handler)
    socket.on('friend-accepted', handler)
    socket.on('friend-request-declined', handler)
    socket.on('friend-removed', handler)
    socket.on('friends-updated', handler)
    return () => {
      socket.off('friend-request-received', handler)
      socket.off('friend-accepted', handler)
      socket.off('friend-request-declined', handler)
      socket.off('friend-removed', handler)
      socket.off('friends-updated', handler)
    }
  }, [socket, isOpen, refreshLists])

  const toggleGenre = (id: number) => {
    setSelectedGenres(prev => {
      if (prev.includes(id)) return prev.filter(g => g !== id)
      if (prev.length >= 5) return prev
      return [...prev, id]
    })
  }

  const clearGenres = () => setSelectedGenres([])

  const myFavGenres = useMemo(() => new Set(me?.favoriteGenres || []), [me?.favoriteGenres])

  const renderFriendRow = (user: DirectChatUser, actions: React.ReactNode, extra?: React.ReactNode) => (
    <div key={user.id} className="fp-row">
      <button className="fp-row__main" onClick={() => onOpenProfile(user.id, user.handle)} type="button">
        <Avatar user={user} size={48} />
        <div className="fp-row__info">
          <span className="fp-row__name">{user.username}</span>
          {user.bio ? (
            <span className="fp-row__bio">{user.bio}</span>
          ) : (
            <GenreChips genres={user.favoriteGenres} max={3} />
          )}
          {extra}
        </div>
      </button>
      <div className="fp-row__actions">{actions}</div>
    </div>
  )

  const incomingCount = incoming.length
  const outgoingCount = outgoing.length
  const requestsBadge = incomingCount + outgoingCount

  const filteredFriends = useMemo(() => {
    const q = friendsFilter.trim().toLowerCase()
    if (!q) return friends
    return friends.filter(f => f.username.toLowerCase().includes(q))
  }, [friends, friendsFilter])

  return (
    <>
      <div className={`fp-backdrop${isOpen ? ' fp-backdrop--open' : ''}`} onClick={onClose} />
      <aside className={`fp-panel${isOpen ? ' fp-panel--open' : ''}`} role="dialog" aria-label="Друзья">
        <div className="fp-panel__header">
          <div className="fp-panel__title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>Друзья</span>
          </div>
          <button className="fp-panel__close" onClick={onClose} type="button" aria-label="Закрыть">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="fp-tabs">
          <button className={`fp-tab${tab === 'friends' ? ' fp-tab--active' : ''}`} onClick={() => setTab('friends')} type="button">
            Друзья
            <span className="fp-tab__badge">{friends.length}</span>
          </button>
          <button className={`fp-tab${tab === 'requests' ? ' fp-tab--active' : ''}`} onClick={() => setTab('requests')} type="button">
            Заявки
            {requestsBadge > 0 && (
              <span className={`fp-tab__badge${incomingCount > 0 ? ' fp-tab__badge--accent' : ''}`}>{requestsBadge}</span>
            )}
          </button>
          <button className={`fp-tab${tab === 'search' ? ' fp-tab--active' : ''}`} onClick={() => setTab('search')} type="button">
            Поиск
          </button>
        </div>

        {errorMessage && (
          <div className="fp-error">{errorMessage}</div>
        )}

        <div className="fp-body">
          {tab === 'search' && (
            <div className="fp-search">
              <div className="fp-searchBar">
                <div className="fp-searchInput">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Имя пользователя, email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                  {searchQuery && (
                    <button className="fp-searchInput__clear" onClick={() => setSearchQuery('')} type="button" aria-label="Очистить">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                <button
                  className={`fp-filterBtn${(showGenreFilter && !genreFilterClosing) || selectedGenres.length > 0 ? ' fp-filterBtn--active' : ''}`}
                  onClick={toggleGenreFilter}
                  type="button"
                  title="Фильтр по жанрам"
                  aria-label="Фильтр по жанрам"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                  </svg>
                  {selectedGenres.length > 0 && <span className="fp-filterBtn__badge">{selectedGenres.length}</span>}
                </button>
              </div>

              {showGenreFilter && (
                <div className={`fp-genreFilter${genreFilterClosing ? ' fp-genreFilter--closing' : ''}`}>
                  <div className="fp-genreFilter__header">
                    <span className="fp-genreFilter__title">Любимые жанры человека</span>
                    {selectedGenres.length > 0 && (
                      <button type="button" className="fp-genreFilter__clear" onClick={clearGenres}>Сбросить</button>
                    )}
                  </div>
                  <div className="fp-genreFilter__list">
                    {GENRE_OPTIONS.map(g => {
                      const active = selectedGenres.includes(g.id)
                      return (
                        <button
                          key={g.id}
                          type="button"
                          className={`fp-genrePill${active ? ' fp-genrePill--active' : ''}${myFavGenres.has(g.id) ? ' fp-genrePill--mine' : ''}`}
                          onClick={() => toggleGenre(g.id)}
                        >
                          <span>{g.name}</span>
                        </button>
                      )
                    })}
                  </div>
                  {myFavGenres.size > 0 && (
                    <p className="fp-genreFilter__hint">Жанры с тонкой рамкой — ваши любимые</p>
                  )}
                </div>
              )}

              {isSearching ? (
                <div className="fp-empty"><SpinnerDot /> Поиск...</div>
              ) : searchResults.length === 0 ? (
                <div className="fp-empty">
                  {searchQuery || selectedGenres.length > 0
                    ? 'Ничего не найдено. Попробуйте изменить запрос.'
                    : 'Начните вводить имя или выберите жанры, чтобы найти единомышленников.'}
                </div>
              ) : (
                <div className="fp-list">
                  {searchResults.map(user => renderFriendRow(
                    user,
                    user.friendshipStatus === 'friends' ? (
                      <span className="fp-pill fp-pill--ok">В друзьях</span>
                    ) : user.friendshipStatus === 'pending_outgoing' ? (
                      <span className="fp-pill">Отправлено</span>
                    ) : user.friendshipStatus === 'pending_incoming' ? (
                      <button
                        className="fp-btn fp-btn--primary"
                        onClick={() => handleAccept(user.id)}
                        disabled={!!pendingActions[user.id]}
                        type="button"
                      >
                        Принять
                      </button>
                    ) : (
                      <button
                        className="fp-btn fp-btn--primary"
                        onClick={() => handleRequest(user.id)}
                        disabled={!!pendingActions[user.id]}
                        type="button"
                      >
                        {pendingActions[user.id] ? <SpinnerDot /> : 'Добавить'}
                      </button>
                    ),
                    user.genreMatches && user.genreMatches > 0 ? (
                      <span className="fp-row__match">🎯 Совпадений жанров: {user.genreMatches}</span>
                    ) : undefined
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'friends' && (
            <>
              {friends.length > 0 && (
                <div className="fp-search">
                  <div className="fp-searchInput fp-searchInput--compact">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Найти среди друзей"
                      value={friendsFilter}
                      onChange={(e) => setFriendsFilter(e.target.value)}
                    />
                    {friendsFilter && (
                      <button className="fp-searchInput__clear" onClick={() => setFriendsFilter('')} type="button" aria-label="Очистить">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className="fp-list">
                {isLoading ? (
                  <div className="fp-empty"><SpinnerDot /> Загрузка...</div>
                ) : filteredFriends.length === 0 ? (
                  friends.length === 0 ? (
                    <div className="fp-empty">
                      <p>Пока нет друзей</p>
                      <button className="fp-btn fp-btn--primary" onClick={() => setTab('search')} type="button">Найти друзей</button>
                    </div>
                  ) : (
                    <div className="fp-empty">Никого не найдено по «{friendsFilter}»</div>
                  )
                ) : (
                  filteredFriends.map(user => renderFriendRow(user,
                    <>
                      <button className="fp-iconBtn fp-iconBtn--primary" onClick={() => onOpenChat(user.id)} type="button" title="Написать сообщение">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                      </button>
                      <button className="fp-iconBtn fp-iconBtn--danger" onClick={() => handleRemove(user.id)} disabled={!!pendingActions[user.id]} type="button" title="Удалить из друзей">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                      </button>
                    </>
                  ))
                )}
              </div>
            </>
          )}

          {tab === 'requests' && (
            <div className="fp-list">
              {outgoingCount === 0 && incomingCount === 0 ? (
                <div className="fp-empty">
                  <p>Заявок пока нет</p>
                  <button className="fp-btn fp-btn--primary" onClick={() => setTab('search')} type="button">Найти друзей</button>
                </div>
              ) : (
                <>
                  {outgoingCount > 0 && (
                    <div className="fp-section">
                      <div className="fp-section__header">
                        <span className="fp-section__title">Вы отправили</span>
                        <span className="fp-section__count">{outgoingCount}</span>
                      </div>
                      {outgoing.map(user => renderFriendRow(user,
                        <button className="fp-btn fp-btn--ghost" onClick={() => handleRemove(user.id)} disabled={!!pendingActions[user.id]} type="button">
                          Отменить
                        </button>
                      ))}
                    </div>
                  )}

                  {incomingCount > 0 && (
                    <div className="fp-section">
                      <div className="fp-section__header">
                        <span className="fp-section__title">Вам отправили</span>
                        <span className="fp-section__count fp-section__count--accent">{incomingCount}</span>
                      </div>
                      {incoming.map(user => renderFriendRow(user,
                        <>
                          <button className="fp-btn fp-btn--primary" onClick={() => handleAccept(user.id)} disabled={!!pendingActions[user.id]} type="button">
                            Принять
                          </button>
                          <button className="fp-btn fp-btn--ghost" onClick={() => handleDecline(user.id)} disabled={!!pendingActions[user.id]} type="button">
                            Отклонить
                          </button>
                        </>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
