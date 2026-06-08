import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSocket, type DirectChatUser } from '../contexts/SocketContext'
import { API_URL } from '../config/api'
import { getGenreOption } from '../data/genres'
import './FriendsListModal.css'

interface FriendsListModalProps {
  isOpen: boolean
  onClose: () => void
  userId: string
  title?: string
  onOpenProfile: (userId: string, handle?: string) => void
}

type FriendshipStatus = 'self' | 'friends' | 'pending_outgoing' | 'pending_incoming' | 'none'

interface FriendItem extends DirectChatUser {
  status?: FriendshipStatus
}

function Avatar({ user, size = 44 }: { user: DirectChatUser; size?: number }) {
  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.username}
        className="flm-avatar flm-avatar--img"
        style={{ width: size, height: size }}
        draggable={false}
      />
    )
  }
  return (
    <div
      className="flm-avatar flm-avatar--placeholder"
      style={{ width: size, height: size, background: user.color || '#6366f1', fontSize: Math.round(size * 0.4) }}
    >
      {user.initials || (user.username || '?').slice(0, 2).toUpperCase()}
    </div>
  )
}

export default function FriendsListModal({ isOpen, onClose, userId, title, onOpenProfile }: FriendsListModalProps) {
  const { user, token } = useAuth()
  const { socket, friendsVersion } = useSocket()

  const [items, setItems] = useState<FriendItem[]>([])
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [pendingActions, setPendingActions] = useState<Record<string, boolean>>({})

  const closeRef = useRef(onClose)
  closeRef.current = onClose

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

  // Загружаем список друзей пользователя + статусы относительно текущего юзера
  const loadFriends = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`${API_URL}/friends/list/${userId}`)
      if (!res.ok) {
        setItems([])
        return
      }
      const data = await res.json()
      const friends: DirectChatUser[] = data.friends || []

      // Если авторизованы — загружаем статусы дружбы
      let withStatuses: FriendItem[] = friends.map(f => ({ ...f }))
      if (user && !user.isGuest && token) {
        const statuses = await Promise.all(friends.map(async f => {
          if (f.id === user.id) return { id: f.id, status: 'self' as FriendshipStatus }
          try {
            const r = await fetch(`${API_URL}/friends/status/${f.id}`, { headers: authHeaders })
            if (!r.ok) return { id: f.id, status: 'none' as FriendshipStatus }
            const sd = await r.json()
            return { id: f.id, status: (sd.status || 'none') as FriendshipStatus }
          } catch {
            return { id: f.id, status: 'none' as FriendshipStatus }
          }
        }))
        const map = new Map(statuses.map(s => [s.id, s.status]))
        withStatuses = friends.map(f => ({ ...f, status: map.get(f.id) }))
      }

      setItems(withStatuses)
    } catch {
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [userId, user, token, authHeaders])

  useEffect(() => {
    if (!isOpen) return
    loadFriends()
  }, [isOpen, loadFriends, friendsVersion])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen])

  // Realtime: обновляем при изменении дружбы
  useEffect(() => {
    if (!socket || !isOpen) return
    const handler = () => loadFriends()
    socket.on('friends-updated', handler)
    socket.on('friend-accepted', handler)
    socket.on('friend-removed', handler)
    socket.on('friend-request-received', handler)
    socket.on('friend-request-declined', handler)
    return () => {
      socket.off('friends-updated', handler)
      socket.off('friend-accepted', handler)
      socket.off('friend-removed', handler)
      socket.off('friend-request-received', handler)
      socket.off('friend-request-declined', handler)
    }
  }, [socket, isOpen, loadFriends])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(f => f.username.toLowerCase().includes(q))
  }, [items, query])

  const handleAddFriend = async (id: string) => {
    if (!token) return
    setBusy(id, true)
    try {
      const res = await fetch(`${API_URL}/friends/request/${id}`, { method: 'POST', headers: authHeaders })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        const status = (data?.status || 'pending_outgoing') as FriendshipStatus
        setItems(prev => prev.map(it => it.id === id ? { ...it, status } : it))
      }
    } finally {
      setBusy(id, false)
    }
  }

  const handleAccept = async (id: string) => {
    if (!token) return
    setBusy(id, true)
    try {
      const res = await fetch(`${API_URL}/friends/accept/${id}`, { method: 'POST', headers: authHeaders })
      if (res.ok) {
        setItems(prev => prev.map(it => it.id === id ? { ...it, status: 'friends' } : it))
      }
    } finally {
      setBusy(id, false)
    }
  }

  const handleMessage = (id: string) => {
    window.dispatchEvent(new CustomEvent('open-messenger', { detail: { userId: id } }))
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="flm-overlay" onClick={onClose}>
      <div className="flm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Список друзей">
        <div className="flm-modal__header">
          <div className="flm-modal__title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>{title || 'Друзья'}</span>
            <span className="flm-modal__count">{items.length}</span>
          </div>
          <button className="flm-modal__close" onClick={onClose} type="button" aria-label="Закрыть">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flm-modal__searchWrap">
          <div className="flm-searchInput">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Поиск по имени..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button className="flm-searchInput__clear" onClick={() => setQuery('')} type="button" aria-label="Очистить">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="flm-modal__list">
          {isLoading ? (
            <div className="flm-empty"><span className="flm-spinner" /> Загрузка...</div>
          ) : filtered.length === 0 ? (
            items.length === 0 ? (
              <div className="flm-empty">Пока нет друзей</div>
            ) : (
              <div className="flm-empty">Никого не найдено</div>
            )
          ) : (
            filtered.map(friend => {
              const isMe = friend.id === user?.id
              const status = friend.status
              const canShowActions = user && !user.isGuest && !isMe
              const showMessage = canShowActions && status === 'friends'
              const showAdd = canShowActions && status === 'none'
              const showAccept = canShowActions && status === 'pending_incoming'
              const showPending = canShowActions && status === 'pending_outgoing'
              return (
                <div key={friend.id} className="flm-row">
                  <button className="flm-row__main" onClick={() => { onOpenProfile(friend.id, friend.handle); onClose() }} type="button">
                    <Avatar user={friend} size={44} />
                    <div className="flm-row__info">
                      <span className="flm-row__name">{friend.username}</span>
                      {friend.favoriteGenres && friend.favoriteGenres.length > 0 ? (
                        <span className="flm-row__genres">
                          {friend.favoriteGenres.slice(0, 3).map(id => {
                            const g = getGenreOption(id)
                            if (!g) return null
                            return (
                              <span key={id} className="flm-row__genre">
                                {g.emoji} {g.name}
                              </span>
                            )
                          })}
                        </span>
                      ) : friend.bio ? (
                        <span className="flm-row__bio">{friend.bio}</span>
                      ) : null}
                    </div>
                  </button>
                  <div className="flm-row__actions">
                    {showMessage && (
                      <button
                        className="flm-iconBtn flm-iconBtn--primary"
                        onClick={() => handleMessage(friend.id)}
                        type="button"
                        title="Написать сообщение"
                        aria-label="Написать сообщение"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                      </button>
                    )}
                    {showAdd && (
                      <button
                        className="flm-iconBtn flm-iconBtn--add"
                        onClick={() => handleAddFriend(friend.id)}
                        disabled={!!pendingActions[friend.id]}
                        type="button"
                        title="Добавить в друзья"
                        aria-label="Добавить в друзья"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <line x1="20" y1="8" x2="20" y2="14" />
                          <line x1="23" y1="11" x2="17" y2="11" />
                        </svg>
                      </button>
                    )}
                    {showAccept && (
                      <button
                        className="flm-iconBtn flm-iconBtn--add"
                        onClick={() => handleAccept(friend.id)}
                        disabled={!!pendingActions[friend.id]}
                        type="button"
                        title="Принять заявку"
                        aria-label="Принять заявку"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </button>
                    )}
                    {showPending && (
                      <span className="flm-pill">Отправлено</span>
                    )}
                    {status === 'friends' && (
                      <span className="flm-pill flm-pill--ok">В друзьях</span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
