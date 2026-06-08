import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSocket, type DirectChatUser } from '../contexts/SocketContext'
import { API_URL } from '../config/api'
import './InviteFriendsModal.css'

export interface InviteFriendsModalProps {
  isOpen: boolean
  onClose: () => void
  roomId: string
}

type InviteState = 'idle' | 'sending' | 'sent' | 'error'

function FriendAvatar({ user, size = 40 }: { user: DirectChatUser; size?: number }) {
  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.username}
        className="ifm-avatar ifm-avatar--img"
        style={{ width: size, height: size }}
        draggable={false}
      />
    )
  }
  return (
    <div
      className="ifm-avatar ifm-avatar--placeholder"
      style={{
        width: size,
        height: size,
        background: user.color || '#6366f1',
        fontSize: Math.round(size * 0.4),
      }}
    >
      {user.initials || (user.username || '?').slice(0, 2).toUpperCase()}
    </div>
  )
}

export default function InviteFriendsModal({ isOpen, onClose, roomId }: InviteFriendsModalProps) {
  const { user, token } = useAuth()
  const { socket, friendsVersion } = useSocket()

  const [items, setItems] = useState<DirectChatUser[]>([])
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [inviteStates, setInviteStates] = useState<Record<string, InviteState>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [closing, setClosing] = useState(false)

  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const authHeaders = useMemo<Record<string, string> | undefined>(() => {
    if (!token) return undefined
    return { Authorization: `Bearer ${token}` }
  }, [token])

  const loadFriends = useCallback(async () => {
    if (!user?.id) return
    setIsLoading(true)
    try {
      const res = await fetch(`${API_URL}/friends/list/${user.id}`)
      if (!res.ok) {
        setItems([])
        return
      }
      const data = await res.json()
      const friends: DirectChatUser[] = data.friends || []
      setItems(friends.filter(f => f.id !== user.id))
    } catch {
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setInviteStates({})
    setErrors({})
    setClosing(false)
    loadFriends()
  }, [isOpen, loadFriends, friendsVersion])

  // Esc
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen])

  // Realtime friend updates
  useEffect(() => {
    if (!socket || !isOpen) return
    const handler = () => loadFriends()
    socket.on('friends-updated', handler)
    socket.on('friend-accepted', handler)
    socket.on('friend-removed', handler)
    return () => {
      socket.off('friends-updated', handler)
      socket.off('friend-accepted', handler)
      socket.off('friend-removed', handler)
    }
  }, [socket, isOpen, loadFriends])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(f => f.username.toLowerCase().includes(q))
  }, [items, query])

  const handleInvite = async (friendId: string) => {
    if (!authHeaders || !roomId) return
    setInviteStates(prev => ({ ...prev, [friendId]: 'sending' }))
    setErrors(prev => {
      if (!prev[friendId]) return prev
      const next = { ...prev }
      delete next[friendId]
      return next
    })
    try {
      const res = await fetch(`${API_URL}/rooms/${roomId}/invite/${friendId}`, {
        method: 'POST',
        headers: authHeaders,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null
        const msg = data?.error || 'Не удалось отправить приглашение'
        setErrors(prev => ({ ...prev, [friendId]: msg }))
        setInviteStates(prev => ({ ...prev, [friendId]: 'error' }))
        return
      }
      setInviteStates(prev => ({ ...prev, [friendId]: 'sent' }))
    } catch (err) {
      console.error('invite failed', err)
      setErrors(prev => ({ ...prev, [friendId]: 'Ошибка сети' }))
      setInviteStates(prev => ({ ...prev, [friendId]: 'error' }))
    }
  }

  const handleClose = () => {
    setClosing(true)
    setTimeout(() => {
      setClosing(false)
      onClose()
    }, 220)
  }

  if (!isOpen) return null

  const noFriends = !isLoading && items.length === 0

  return (
    <div
      className={`ifm-overlay${closing ? ' ifm-overlay--closing' : ''}`}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`ifm-modal${closing ? ' ifm-modal--closing' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="ifm-header">
          <div className="ifm-titleWrap">
            <span className="ifm-titleIcon" aria-hidden>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </span>
            <div className="ifm-titleText">
              <h3 className="ifm-title">Пригласить друзей</h3>
              <p className="ifm-subtitle">Друзья получат сообщение со ссылкой и кнопкой «Присоединиться»</p>
            </div>
          </div>
          <button className="ifm-close" onClick={handleClose} type="button" aria-label="Закрыть">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {items.length > 0 && (
          <div className="ifm-searchWrap">
            <svg className="ifm-searchIcon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="ifm-search"
              placeholder="Поиск друга…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        )}

        <div className="ifm-list">
          {isLoading && (
            <div className="ifm-empty">
              <div className="ifm-spinner" />
              <span>Загружаем список друзей…</span>
            </div>
          )}
          {!isLoading && noFriends && (
            <div className="ifm-empty">
              <div className="ifm-emptyIcon" aria-hidden>
                <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 11h-6" />
                </svg>
              </div>
              <span>У вас пока нет друзей</span>
              <p>Добавьте друзей, чтобы приглашать их в комнату просмотра.</p>
            </div>
          )}
          {!isLoading && !noFriends && filtered.length === 0 && (
            <div className="ifm-empty">
              <span>Никого не нашлось по запросу «{query}».</span>
            </div>
          )}
          {!isLoading && filtered.map(friend => {
            const state = inviteStates[friend.id] || 'idle'
            const err = errors[friend.id]
            return (
              <div key={friend.id} className="ifm-row">
                <FriendAvatar user={friend} />
                <div className="ifm-rowInfo">
                  <span className="ifm-rowName">{friend.username}</span>
                  {friend.handle && <span className="ifm-rowHandle">@{friend.handle}</span>}
                  {err && state === 'error' && <span className="ifm-rowError">{err}</span>}
                </div>
                <button
                  type="button"
                  className={`ifm-inviteBtn ifm-inviteBtn--${state}`}
                  onClick={() => handleInvite(friend.id)}
                  disabled={state === 'sending' || state === 'sent'}
                >
                  {state === 'sending' && (
                    <>
                      <span className="ifm-spinner ifm-spinner--small" />
                      Отправка…
                    </>
                  )}
                  {state === 'sent' && (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Отправлено
                    </>
                  )}
                  {state === 'error' && 'Повторить'}
                  {state === 'idle' && (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                      Пригласить
                    </>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
