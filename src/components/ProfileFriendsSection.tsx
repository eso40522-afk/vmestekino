import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSocket, type DirectChatUser } from '../contexts/SocketContext'
import { API_URL } from '../config/api'
import './ProfileFriendsSection.css'

interface ProfileFriendsSectionProps {
  userId: string
  isOwnProfile: boolean
  variant?: 'default' | 'header'
}

type Friendship = 'none' | 'pending_outgoing' | 'pending_incoming' | 'friends' | 'self' | 'unknown'

export default function ProfileFriendsSection({ userId, isOwnProfile, variant = 'default' }: ProfileFriendsSectionProps) {
  const { user, token } = useAuth()
  const { socket, friendsVersion } = useSocket()

  const [friendship, setFriendship] = useState<Friendship>('unknown')
  const [actionBusy, setActionBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const authHeaders = useMemo(() => {
    if (!token) return undefined
    return { Authorization: `Bearer ${token}` }
  }, [token])

  const refreshStatus = useCallback(async () => {
    if (!user || user.isGuest) {
      setFriendship('unknown')
      return
    }
    if (user.id === userId) {
      setFriendship('self')
      return
    }
    if (!token) return
    try {
      const [friendsMine, requests] = await Promise.all([
        fetch(`${API_URL}/friends`, { headers: authHeaders }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_URL}/friends/requests`, { headers: authHeaders }).then(r => r.ok ? r.json() : null).catch(() => null)
      ])

      const isFriend = friendsMine?.friends?.some((f: DirectChatUser) => f.id === userId)
      const incomingPending = requests?.incoming?.some((f: DirectChatUser) => f.id === userId)
      const outgoingPending = requests?.outgoing?.some((f: DirectChatUser) => f.id === userId)

      if (isFriend) setFriendship('friends')
      else if (incomingPending) setFriendship('pending_incoming')
      else if (outgoingPending) setFriendship('pending_outgoing')
      else setFriendship('none')
    } catch {
      setFriendship('none')
    }
  }, [authHeaders, token, user, userId])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus, friendsVersion])

  useEffect(() => {
    if (!socket) return
    const handler = () => refreshStatus()
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
  }, [socket, refreshStatus])

  const handleSendRequest = async () => {
    if (!token) return
    setActionBusy(true)
    setErrorMessage(null)
    try {
      const res = await fetch(`${API_URL}/friends/request/${userId}`, { method: 'POST', headers: authHeaders })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setErrorMessage(data?.error || 'Не удалось отправить заявку')
      }
    } finally {
      setActionBusy(false)
      refreshStatus()
    }
  }

  const handleAccept = async () => {
    if (!token) return
    setActionBusy(true)
    try {
      await fetch(`${API_URL}/friends/accept/${userId}`, { method: 'POST', headers: authHeaders })
    } finally {
      setActionBusy(false)
      refreshStatus()
    }
  }

  const handleRemove = async () => {
    if (!token) return
    setActionBusy(true)
    try {
      await fetch(`${API_URL}/friends/${userId}`, { method: 'DELETE', headers: authHeaders })
    } finally {
      setActionBusy(false)
      refreshStatus()
    }
  }

  const handleOpenChat = () => {
    window.dispatchEvent(new CustomEvent('open-messenger', { detail: { userId } }))
  }

  // На своём профиле никаких action-кнопок — пользователь и так сам себе
  if (isOwnProfile) return null
  if (friendship === 'self' || friendship === 'unknown') return null

  if (variant === 'header') {
    return (
      <div className={`pfs-header${errorMessage ? ' pfs-header--has-error' : ''}`}>
        {friendship === 'friends' && (
          <>
            <button className="pfs-hBtn pfs-hBtn--glass" onClick={handleOpenChat} type="button" title="Написать сообщение">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              <span>Сообщение</span>
            </button>
            <button className="pfs-hBtn pfs-hBtn--icon" onClick={handleRemove} disabled={actionBusy} type="button" title="Удалить из друзей" aria-label="Удалить из друзей">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="17" y1="8" x2="22" y2="13" />
                <line x1="22" y1="8" x2="17" y2="13" />
              </svg>
            </button>
          </>
        )}

        {friendship === 'pending_outgoing' && (
          <>
            <span className="pfs-hPill">Заявка отправлена</span>
            <button className="pfs-hBtn pfs-hBtn--ghost" onClick={handleRemove} disabled={actionBusy} type="button">
              Отменить
            </button>
          </>
        )}

        {friendship === 'pending_incoming' && (
          <>
            <button className="pfs-hBtn pfs-hBtn--primary" onClick={handleAccept} disabled={actionBusy} type="button">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Принять</span>
            </button>
            <button className="pfs-hBtn pfs-hBtn--ghost" onClick={handleRemove} disabled={actionBusy} type="button">
              Отклонить
            </button>
          </>
        )}

        {friendship === 'none' && (
          <button className="pfs-hBtn pfs-hBtn--glass" onClick={handleSendRequest} disabled={actionBusy} type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
            <span>Добавить в друзья</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <section className="pfs-section pfs-section--actions">
      {errorMessage && <div className="pfs-error">{errorMessage}</div>}

      {friendship === 'friends' && (
        <div className="pfs-actions">
          <button className="pfs-btn pfs-btn--primary" onClick={handleOpenChat} type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            Написать сообщение
          </button>
          <button className="pfs-btn pfs-btn--ghost" onClick={handleRemove} disabled={actionBusy} type="button">
            Удалить из друзей
          </button>
        </div>
      )}

      {friendship === 'pending_outgoing' && (
        <div className="pfs-actions">
          <span className="pfs-pill">Заявка отправлена</span>
          <button className="pfs-btn pfs-btn--ghost" onClick={handleRemove} disabled={actionBusy} type="button">
            Отменить
          </button>
        </div>
      )}

      {friendship === 'pending_incoming' && (
        <div className="pfs-actions">
          <button className="pfs-btn pfs-btn--primary" onClick={handleAccept} disabled={actionBusy} type="button">
            Принять заявку
          </button>
          <button className="pfs-btn pfs-btn--ghost" onClick={handleRemove} disabled={actionBusy} type="button">
            Отклонить
          </button>
        </div>
      )}

      {friendship === 'none' && (
        <div className="pfs-actions">
          <button className="pfs-btn pfs-btn--ghost" onClick={handleSendRequest} disabled={actionBusy} type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
            Добавить в друзья
          </button>
        </div>
      )}
    </section>
  )
}
