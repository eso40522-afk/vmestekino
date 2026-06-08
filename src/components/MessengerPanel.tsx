import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useSocket, type DirectChatUser, type DirectMessageData } from '../contexts/SocketContext'
import { API_URL } from '../config/api'
import './MessengerPanel.css'

interface ConversationEntry {
  user: DirectChatUser
  lastMessage: DirectMessageData
  unread: number
}

interface MessengerPanelProps {
  isOpen: boolean
  onClose: () => void
  initialUserId: string | null
  onOpenProfile: (userId: string, handle?: string) => void
}

function Avatar({ user, size = 40 }: { user: DirectChatUser, size?: number }) {
  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.username}
        className="mp-avatar mp-avatar--img"
        style={{ width: size, height: size }}
        draggable={false}
      />
    )
  }
  return (
    <div
      className="mp-avatar mp-avatar--placeholder"
      style={{ width: size, height: size, background: user.color || '#6366f1', fontSize: Math.round(size * 0.4) }}
    >
      {user.initials || (user.username || '?').slice(0, 2).toUpperCase()}
    </div>
  )
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function formatDateGroup(timestamp: number) {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  if (sameDay(date, today)) return 'Сегодня'
  if (sameDay(date, yesterday)) return 'Вчера'
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

function previewText(message: DirectMessageData) {
  if (!message) return ''
  if (message.messageType === 'gif') return 'GIF'
  if (message.messageType === 'image') return 'Изображение'
  if (message.messageType === 'room_invite') return '🎥 Приглашение в комнату'
  return message.text
}

interface RoomInvitePayload {
  kind: 'room_invite'
  roomId: string
  isPrivate?: boolean
  inviter: { id: string; username: string; color?: string; initials?: string; avatar?: string }
  members: Array<{ id: string; username: string; color?: string; initials?: string; avatar?: string }>
  movie: {
    movieId?: number | string | null
    title?: string
    posterPath?: string | null
    year?: string | null
    sourceType?: string | null
    customThumbnail?: string | null
  } | null
}

function parseInvitePayload(raw: string): RoomInvitePayload | null {
  try {
    const data = JSON.parse(raw)
    if (data && data.kind === 'room_invite' && typeof data.roomId === 'string') return data as RoomInvitePayload
  } catch {
    /* noop */
  }
  return null
}

export default function MessengerPanel({ isOpen, onClose, initialUserId, onOpenProfile }: MessengerPanelProps) {
  const { user, token } = useAuth()
  const { socket, refreshDmUnread } = useSocket()
  const navigate = useNavigate()

  const [conversations, setConversations] = useState<ConversationEntry[]>([])
  const [isLoadingList, setIsLoadingList] = useState(false)
  const [activeUser, setActiveUser] = useState<DirectChatUser | null>(null)
  const [messages, setMessages] = useState<DirectMessageData[]>([])
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [theyTyping, setTheyTyping] = useState(false)

  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastReadIdsRef = useRef<Set<string>>(new Set())
  const typingTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const theyTypingTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const authHeaders = useMemo(() => {
    if (!token) return undefined
    return { Authorization: `Bearer ${token}` }
  }, [token])

  const loadConversations = useCallback(async () => {
    if (!token) return
    setIsLoadingList(true)
    try {
      const res = await fetch(`${API_URL}/messages/conversations`, { headers: authHeaders })
      if (res.ok) {
        const data = await res.json()
        setConversations(data.conversations || [])
      }
    } catch (err) {
      console.error('Failed to load conversations', err)
    } finally {
      setIsLoadingList(false)
    }
  }, [authHeaders, token])

  const loadMessages = useCallback(async (otherId: string) => {
    if (!token) return
    setIsLoadingMessages(true)
    try {
      const res = await fetch(`${API_URL}/messages/${otherId}`, { headers: authHeaders })
      if (res.ok) {
        const data = await res.json()
        setActiveUser(data.user)
        setMessages(data.messages || [])
        // Помечаем прочитанным
        await markRead(otherId)
      }
    } catch (err) {
      console.error('Failed to load messages', err)
    } finally {
      setIsLoadingMessages(false)
    }
  }, [authHeaders, token])

  const markRead = useCallback(async (otherId: string) => {
    if (!token) return
    if (lastReadIdsRef.current.has(otherId)) return
    lastReadIdsRef.current.add(otherId)
    try {
      await fetch(`${API_URL}/messages/${otherId}/read`, {
        method: 'POST',
        headers: authHeaders
      })
      setConversations(prev => prev.map(c => c.user.id === otherId ? { ...c, unread: 0 } : c))
      refreshDmUnread()
    } finally {
      // Allow re-mark after a short delay if new messages come in
      setTimeout(() => { lastReadIdsRef.current.delete(otherId) }, 500)
    }
  }, [authHeaders, refreshDmUnread, token])

  // Загружаем список при открытии
  useEffect(() => {
    if (isOpen) {
      loadConversations()
      setErrorMessage(null)
    } else {
      setActiveUser(null)
      setMessages([])
      setDraft('')
      setTheyTyping(false)
    }
  }, [isOpen, loadConversations])

  // Если задан initialUserId — открыть диалог сразу
  useEffect(() => {
    if (isOpen && initialUserId) {
      loadMessages(initialUserId)
    }
  }, [initialUserId, isOpen, loadMessages])

  // Прокрутка к концу при изменении сообщений
  useEffect(() => {
    if (!messagesScrollRef.current) return
    messagesScrollRef.current.scrollTo({
      top: messagesScrollRef.current.scrollHeight,
      behavior: 'smooth'
    })
  }, [messages, activeUser?.id, theyTyping])

  // Escape для закрытия
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeUser) setActiveUser(null)
        else onCloseRef.current()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, activeUser])

  // Socket-слушатели для real-time входящих сообщений
  useEffect(() => {
    if (!socket) return

    const handleNewMessage = (payload: { message: DirectMessageData, from: DirectChatUser }) => {
      const msg = payload.message
      const me = user?.id
      if (!me) return
      const otherId = msg.senderId === me ? msg.recipientId : msg.senderId

      // Если открыт диалог именно с этим пользователем — добавляем в ленту
      if (activeUser && otherId === activeUser.id) {
        setMessages(prev => {
          // Защита от дублирования по реальному id
          if (prev.some(m => m.id === msg.id)) return prev
          // Если это наше же сообщение, заменяем оптимистичный плейсхолдер
          // (у него отрицательный id и совпадает текст/тип/получатель)
          if (msg.senderId === me) {
            const optimisticIdx = prev.findIndex(m =>
              m.id < 0 &&
              m.senderId === me &&
              m.recipientId === msg.recipientId &&
              m.messageType === msg.messageType &&
              m.text === msg.text
            )
            if (optimisticIdx !== -1) {
              const next = prev.slice()
              next[optimisticIdx] = msg
              return next
            }
          }
          return [...prev, msg]
        })
        // Помечаем прочитанным (мы только что увидели)
        if (msg.senderId !== me) {
          markRead(otherId)
        }
      }

      // Обновляем превью в списке диалогов
      setConversations(prev => {
        const others = prev.filter(c => c.user.id !== otherId)
        const existing = prev.find(c => c.user.id === otherId)
        const isIncoming = msg.senderId !== me
        const isActiveChat = activeUser?.id === otherId
        const next: ConversationEntry = {
          user: existing?.user || payload.from,
          lastMessage: msg,
          unread: isIncoming && !isActiveChat
            ? (existing?.unread || 0) + 1
            : 0
        }
        return [next, ...others]
      })
    }

    const handleTyping = (payload: { fromUserId: string, isTyping: boolean }) => {
      if (!activeUser || payload.fromUserId !== activeUser.id) return
      setTheyTyping(payload.isTyping)
      if (theyTypingTimerRef.current) clearTimeout(theyTypingTimerRef.current)
      if (payload.isTyping) {
        theyTypingTimerRef.current = setTimeout(() => setTheyTyping(false), 4000)
      }
    }

    const handleRead = (payload: { byUserId: string }) => {
      if (!activeUser || payload.byUserId !== activeUser.id) return
      setMessages(prev => prev.map(m =>
        m.senderId === user?.id && m.recipientId === activeUser.id && !m.readAt
          ? { ...m, readAt: Date.now() }
          : m
      ))
    }

    socket.on('dm-message', handleNewMessage)
    socket.on('dm-typing', handleTyping)
    socket.on('dm-read', handleRead)

    return () => {
      socket.off('dm-message', handleNewMessage)
      socket.off('dm-typing', handleTyping)
      socket.off('dm-read', handleRead)
    }
  }, [socket, activeUser, user?.id, markRead])

  // Печать индикатор
  const handleDraftChange = (value: string) => {
    setDraft(value)
    if (!activeUser || !token) return
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    fetch(`${API_URL}/messages/${activeUser.id}/typing`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isTyping: true })
    }).catch(() => {})

    typingTimerRef.current = setTimeout(() => {
      if (!activeUser) return
      fetch(`${API_URL}/messages/${activeUser.id}/typing`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTyping: false })
      }).catch(() => {})
    }, 1500)
  }

  const handleSend = async () => {
    if (!activeUser || !token) return
    const text = draft.trim()
    if (!text) return
    setIsSending(true)
    setErrorMessage(null)
    const tempId = Date.now()
    const optimistic: DirectMessageData = {
      id: -tempId,
      senderId: user?.id || '',
      recipientId: activeUser.id,
      text,
      messageType: 'text',
      createdAt: Date.now(),
      readAt: null
    }
    setMessages(prev => [...prev, optimistic])
    setDraft('')
    try {
      const res = await fetch(`${API_URL}/messages/${activeUser.id}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, messageType: 'text' })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setErrorMessage(data?.error || 'Не удалось отправить сообщение')
        setMessages(prev => prev.filter(m => m.id !== optimistic.id))
        return
      }
      const data = await res.json()
      const real: DirectMessageData = data.message
      setMessages(prev => {
        // Если сокет уже доставил настоящее сообщение — просто убираем оптимистичный плейсхолдер
        if (prev.some(m => m.id === real.id)) {
          return prev.filter(m => m.id !== optimistic.id)
        }
        return prev.map(m => m.id === optimistic.id ? real : m)
      })
      // Обновляем превью в списке
      setConversations(prev => {
        const others = prev.filter(c => c.user.id !== activeUser.id)
        return [
          { user: activeUser, lastMessage: real, unread: 0 },
          ...others
        ]
      })
    } catch (err) {
      console.error('Send failed', err)
      setErrorMessage('Ошибка сети')
      setMessages(prev => prev.filter(m => m.id !== optimistic.id))
    } finally {
      setIsSending(false)
      inputRef.current?.focus()
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Авто-рост textarea
  useEffect(() => {
    if (!inputRef.current) return
    inputRef.current.style.height = 'auto'
    const next = Math.min(inputRef.current.scrollHeight, 160)
    inputRef.current.style.height = `${next}px`
  }, [draft])

  // Группировка сообщений по дню
  const grouped = useMemo(() => {
    const groups: { date: string, items: DirectMessageData[] }[] = []
    for (const msg of messages) {
      const date = formatDateGroup(msg.createdAt)
      const last = groups[groups.length - 1]
      if (last && last.date === date) {
        last.items.push(msg)
      } else {
        groups.push({ date, items: [msg] })
      }
    }
    return groups
  }, [messages])

  const renderConversationList = () => (
    <div className="mp-list-pane">
      <div className="mp-list-header">
        <h3>Сообщения</h3>
      </div>
      <div className="mp-list">
        {isLoadingList ? (
          <div className="mp-empty"><span className="fp-spinner" /> Загрузка...</div>
        ) : conversations.length === 0 ? (
          <div className="mp-empty">
            <p>Нет диалогов</p>
            <p className="mp-empty__hint">Добавьте друзей и начните общение</p>
          </div>
        ) : (
          conversations.map(conv => {
            const isMe = conv.lastMessage.senderId === user?.id
            return (
              <button
                key={conv.user.id}
                className={`mp-conv${activeUser?.id === conv.user.id ? ' mp-conv--active' : ''}`}
                onClick={() => loadMessages(conv.user.id)}
                type="button"
              >
                <Avatar user={conv.user} size={44} />
                <div className="mp-conv__info">
                  <div className="mp-conv__top">
                    <span className="mp-conv__name">{conv.user.username}</span>
                    <span className="mp-conv__time">{formatTime(conv.lastMessage.createdAt)}</span>
                  </div>
                  <div className="mp-conv__bottom">
                    <span className="mp-conv__preview">
                      {isMe && <span className="mp-conv__prefix">Вы: </span>}
                      {previewText(conv.lastMessage)}
                    </span>
                    {conv.unread > 0 && (
                      <span className="mp-conv__badge">{conv.unread > 99 ? '99+' : conv.unread}</span>
                    )}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )

  const renderChat = () => {
    if (!activeUser) {
      return (
        <div className="mp-empty mp-empty--center">
          <div className="mp-empty__icon">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>
          <p>Выберите диалог</p>
          <p className="mp-empty__hint">Сообщения остаются приватными между вами и собеседником</p>
        </div>
      )
    }

    return (
      <div className="mp-chat">
        <div className="mp-chat__header">
          <button className="mp-chat__back" onClick={() => setActiveUser(null)} type="button" aria-label="Назад">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <button className="mp-chat__user" onClick={() => onOpenProfile(activeUser.id, activeUser.handle)} type="button">
            <Avatar user={activeUser} size={36} />
            <div className="mp-chat__userInfo">
              <span className="mp-chat__name">{activeUser.username}</span>
              <span className="mp-chat__status">
                {theyTyping ? (
                  <span className="mp-typing">
                    <span /><span /><span /> печатает...
                  </span>
                ) : 'Активен'}
              </span>
            </div>
          </button>
        </div>

        <div className="mp-chat__scroll" ref={messagesScrollRef}>
          {isLoadingMessages ? (
            <div className="mp-empty"><span className="fp-spinner" /> Загрузка...</div>
          ) : messages.length === 0 ? (
            <div className="mp-empty mp-empty--center">
              <p>Сообщений пока нет</p>
              <p className="mp-empty__hint">Напишите первое — будьте вежливы</p>
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.date} className="mp-msgGroup">
                <div className="mp-msgDate">{group.date}</div>
                {group.items.map((msg, idx) => {
                  const isMine = msg.senderId === user?.id
                  const prev = group.items[idx - 1]
                  const stacked = prev && prev.senderId === msg.senderId && (msg.createdAt - prev.createdAt < 60_000)
                  const invitePayload = msg.messageType === 'room_invite' ? parseInvitePayload(msg.text) : null
                  if (invitePayload) {
                    return (
                      <div key={msg.id} className={`mp-msgRow${isMine ? ' mp-msgRow--mine' : ''}${stacked ? ' mp-msgRow--stacked' : ''}`}>
                        <div className={`mp-msg mp-msg--invite${isMine ? ' mp-msg--mine' : ''}`}>
                          <div className="mp-invite__header">
                            <span className="mp-invite__badge">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="5 3 19 12 5 21 5 3" />
                              </svg>
                              Приглашение в комнату
                            </span>
                          </div>
                          <div className="mp-invite__text">
                            <strong>{invitePayload.inviter.username}</strong>
                            {isMine
                              ? ` приглашает «${activeUser?.username || 'друга'}» в комнату просмотра`
                              : ' приглашает вас в комнату просмотра'}
                          </div>
                          {invitePayload.movie?.posterPath && (
                            <div className="mp-invite__banner">
                              <img src={invitePayload.movie.posterPath} alt={invitePayload.movie.title || 'Постер'} />
                              {invitePayload.movie.title && (
                                <div className="mp-invite__bannerCaption">
                                  <span className="mp-invite__bannerTitle">{invitePayload.movie.title}</span>
                                  {invitePayload.movie.year && (
                                    <span className="mp-invite__bannerYear">{invitePayload.movie.year}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          {!invitePayload.movie?.posterPath && (
                            <div className="mp-invite__noBanner">
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="2" y="3" width="20" height="14" rx="2" />
                                <line x1="8" y1="21" x2="16" y2="21" />
                                <line x1="12" y1="17" x2="12" y2="21" />
                              </svg>
                              <span>{invitePayload.movie?.title || 'Видео ещё не выбрано'}</span>
                            </div>
                          )}
                          {invitePayload.members && invitePayload.members.length > 0 && (
                            <div className="mp-invite__members">
                              <div className="mp-invite__memberAvatars">
                                {invitePayload.members.slice(0, 5).map(m => (
                                  <span
                                    key={m.id}
                                    className="mp-invite__memberAvatar"
                                    title={m.username}
                                    style={{ background: m.avatar ? 'transparent' : (m.color || '#6366f1') }}
                                  >
                                    {m.avatar
                                      ? <img src={m.avatar} alt={m.username} />
                                      : (m.initials || (m.username || '?').slice(0, 2).toUpperCase())}
                                  </span>
                                ))}
                                {invitePayload.members.length > 5 && (
                                  <span className="mp-invite__memberAvatar mp-invite__memberAvatar--more">
                                    +{invitePayload.members.length - 5}
                                  </span>
                                )}
                              </div>
                              <span className="mp-invite__memberCount">
                                {invitePayload.members.length === 1
                                  ? '1 участник'
                                  : `${invitePayload.members.length} участников`}
                              </span>
                            </div>
                          )}
                          {!isMine ? (
                            <button
                              type="button"
                              className="mp-invite__joinBtn"
                              onClick={() => {
                                navigate(`/room/${invitePayload.roomId}`)
                                onCloseRef.current()
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                              Присоединиться
                            </button>
                          ) : (
                            <div className="mp-invite__sentLabel">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              Приглашение отправлено
                            </div>
                          )}
                          <div className="mp-msg__meta">
                            <span>{formatTime(msg.createdAt)}</span>
                            {isMine && (
                              <span className={`mp-msg__read${msg.readAt ? ' mp-msg__read--seen' : ''}`} title={msg.readAt ? 'Прочитано' : 'Доставлено'}>
                                {msg.readAt ? (
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M2 12l5 5 7-9" />
                                    <path d="M9 17l5 5 9-12" />
                                  </svg>
                                ) : (
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M5 12l5 5 9-12" />
                                  </svg>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  }
                  return (
                    <div key={msg.id} className={`mp-msgRow${isMine ? ' mp-msgRow--mine' : ''}${stacked ? ' mp-msgRow--stacked' : ''}`}>
                      <div className={`mp-msg${isMine ? ' mp-msg--mine' : ''}`}>
                        <div className="mp-msg__text">{msg.text}</div>
                        <div className="mp-msg__meta">
                          <span>{formatTime(msg.createdAt)}</span>
                          {isMine && (
                            <span className={`mp-msg__read${msg.readAt ? ' mp-msg__read--seen' : ''}`} title={msg.readAt ? 'Прочитано' : 'Доставлено'}>
                              {msg.readAt ? (
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M2 12l5 5 7-9" />
                                  <path d="M9 17l5 5 9-12" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M5 12l5 5 9-12" />
                                </svg>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {errorMessage && (
          <div className="mp-error">{errorMessage}</div>
        )}

        <div className="mp-chat__input">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Напишите сообщение..."
            rows={1}
            maxLength={4000}
          />
          <button className="mp-chat__send" onClick={handleSend} disabled={isSending || !draft.trim()} type="button" aria-label="Отправить">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={`mp-backdrop${isOpen ? ' mp-backdrop--open' : ''}`} onClick={onClose} />
      <aside className={`mp-panel${isOpen ? ' mp-panel--open' : ''}${activeUser ? ' mp-panel--chat' : ''}`} role="dialog" aria-label="Личные сообщения">
        <div className="mp-panel__header">
          <div className="mp-panel__title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            <span>Сообщения</span>
          </div>
          <button className="fp-panel__close" onClick={onClose} type="button" aria-label="Закрыть">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={`mp-content${activeUser ? ' mp-content--chat' : ' mp-content--list'}`}>
          {renderConversationList()}
          {renderChat()}
        </div>
      </aside>
    </>
  )
}
