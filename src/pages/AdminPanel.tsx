import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { API_URL } from '../config/api'
import { getPosterUrl } from '../services/tmdb'
import './AdminPanel.css'

type AdminTab = 'users' | 'rooms' | 'logs'

type AdminUser = {
  id: string
  email: string
  username: string
  color: string
  avatar: string
  role: 'user' | 'admin'
  isBanned: boolean
  banReason: string
  timeoutUntil: number | null
  timeoutReason: string
  createdAt: string
  status: 'active' | 'timed_out' | 'banned'
}

type AdminRoom = {
  roomId: string
  usersCount: number
  isPrivate: boolean
  solo: boolean
  createdAt: string
  videoTitle: string
  posterPath?: string | null
}

type AdminRoomUser = {
  id: string
  username: string
  color: string
  initials: string
  avatar: string
  role: 'user' | 'admin'
  isGuest: boolean
  socketId?: string
  isBanned?: boolean
  timeoutUntil?: number | null
}

type AdminRoomPoll = {
  id: string
  question: string
  options: Array<{ id: number; text: string; votes: string[] }>
  multiSelect: boolean
  totalVoters: number
}

type AdminRoomMessage = {
  id: string
  type: 'user' | 'system' | 'movie' | 'poll'
  userId?: string
  username?: string
  color?: string
  initials?: string
  avatar?: string
  text: string
  timestamp: number
  poll?: AdminRoomPoll
}

type AdminRoomDetails = AdminRoom & {
  users: AdminRoomUser[]
  messages: AdminRoomMessage[]
}

type AdminMovieSelection = {
  movieId?: number
  title: string
  posterPath: string | null
  year?: string
  imdbId?: string | null
}

type UserMessage = {
  id: number
  roomId: string
  messageType: string
  text: string
  createdAt: number
}

type HistoryPollPayload = {
  question: string
  options: string[]
  multiSelect?: boolean
}

type ConfirmModerationAction = {
  type: 'ban' | 'timeout'
  user: AdminUser
}

type AdminAuditLog = {
  id: number
  adminId: string
  adminUsername: string
  action: string
  targetType: string
  targetId: string
  targetName: string
  details: string
  createdAt: number
}

const timeoutOptions = [
  { label: '5 мин', durationMs: 5 * 60 * 1000 },
  { label: '10 мин', durationMs: 10 * 60 * 1000 },
  { label: '30 мин', durationMs: 30 * 60 * 1000 },
  { label: '1 ч', durationMs: 60 * 60 * 1000 },
  { label: '3 ч', durationMs: 3 * 60 * 60 * 1000 },
  { label: '1 день', durationMs: 24 * 60 * 60 * 1000 }
]

function formatDate(value: string | number) {
  return new Date(value).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

function formatDateTime(value: number) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatTimeLeft(timeoutUntil: number | null) {
  if (!timeoutUntil) return '—'

  const diff = timeoutUntil - Date.now()
  if (diff <= 0) return '—'

  const minutes = Math.ceil(diff / 60000)
  if (minutes < 60) return `${minutes} мин`

  const hours = Math.ceil(minutes / 60)
  if (hours < 24) return `${hours} ч`

  const days = Math.ceil(hours / 24)
  return `${days} д`
}

function getHistoryGifUrl(item: UserMessage) {
  if (item.messageType === 'gif' && item.text) {
    return item.text
  }

  if (item.text.startsWith('GIF:')) {
    return item.text.slice(4)
  }

  return null
}

function getHistoryMovieText(item: UserMessage) {
  if (item.messageType === 'movie') {
    return item.text
  }

  if (!item.text.startsWith('MOVIE_SELECTED:')) {
    return null
  }

  try {
    const payload = JSON.parse(item.text.slice('MOVIE_SELECTED:'.length))
    const title = typeof payload?.title === 'string' && payload.title.trim()
      ? ` \"${payload.title.trim()}\"`
      : ''

    return `Начал смотреть фильм${title}`
  } catch {
    return 'Начал смотреть фильм'
  }
}

function getHistoryPoll(item: UserMessage): HistoryPollPayload | null {
  if (item.messageType !== 'poll' && !item.text.startsWith('POLL:')) {
    return null
  }

  if (item.text.startsWith('POLL:')) {
    return {
      question: item.text.slice(5),
      options: []
    }
  }

  try {
    const payload = JSON.parse(item.text)
    if (typeof payload?.question !== 'string') {
      return null
    }

    return {
      question: payload.question,
      options: Array.isArray(payload.options)
        ? payload.options.filter((option: unknown): option is string => typeof option === 'string' && option.trim().length > 0)
        : [],
      multiSelect: Boolean(payload.multiSelect)
    }
  } catch {
    return null
  }
}

function getAdminMovieSelection(text: string): AdminMovieSelection | null {
  if (!text.startsWith('MOVIE_SELECTED:')) {
    return null
  }

  try {
    const payload = JSON.parse(text.slice('MOVIE_SELECTED:'.length))
    if (typeof payload?.title !== 'string' || !payload.title.trim()) {
      return null
    }

    return {
      movieId: typeof payload.movieId === 'number' ? payload.movieId : undefined,
      title: payload.title.trim(),
      posterPath: typeof payload.posterPath === 'string' ? payload.posterPath : null,
      year: typeof payload.year === 'string' ? payload.year : undefined,
      imdbId: typeof payload.imdbId === 'string' ? payload.imdbId : null
    }
  } catch {
    return null
  }
}

function formatAuditAction(log: AdminAuditLog) {
  switch (log.action) {
    case 'view_room':
      return `Открыл комнату ${log.targetName}`
    case 'view_user_history':
      return `Открыл историю сообщений пользователя ${log.targetName}`
    case 'set_timeout':
      return `Выдал таймаут пользователю ${log.targetName}`
    case 'remove_timeout':
      return `Снял таймаут с пользователя ${log.targetName}`
    case 'ban_user':
      return `Забанил пользователя ${log.targetName}`
    case 'unban_user':
      return `Разбанил пользователя ${log.targetName}`
    default:
      return log.action
  }
}

function HistoryMessagePreview({ item }: { item: UserMessage }) {
  const gifUrl = getHistoryGifUrl(item)
  const movieText = getHistoryMovieText(item)
  const poll = getHistoryPoll(item)

  if (gifUrl) {
    return <img src={gifUrl} alt="GIF" className="admin-panel__historyGif" loading="lazy" />
  }

  if (poll) {
    return (
      <div className="admin-panel__historyPoll">
        <div className="admin-panel__historyTag">Опрос</div>
        <div className="admin-panel__historyPollQuestion">{poll.question}</div>
        {poll.options.length > 0 && (
          <div className="admin-panel__historyPollOptions">
            {poll.options.map(option => (
              <span key={option} className="admin-panel__historyPollOption">{option}</span>
            ))}
          </div>
        )}
        {poll.multiSelect && <div className="admin-panel__historyHint">Можно выбрать несколько вариантов</div>}
      </div>
    )
  }

  return <div className="admin-panel__historyText">{movieText || item.text}</div>
}

function AdminMessagePreview({ item }: { item: AdminRoomMessage }) {
  const gifUrl = item.text.startsWith('GIF:') ? item.text.slice(4) : null
  const movie = getAdminMovieSelection(item.text)

  if (item.type === 'system') {
    return <div className="admin-panel__roomSystemMessage">{item.text}</div>
  }

  if (movie) {
    return (
      <div className="admin-panel__roomMovieCard">
        <img
          src={movie.posterPath ? getPosterUrl(movie.posterPath, 'w342') : getPosterUrl(null)}
          alt={movie.title}
          className="admin-panel__roomMoviePoster"
        />
        <div className="admin-panel__roomMovieBody">
          <div className="admin-panel__historyTag">Фильм</div>
          <div className="admin-panel__roomMovieTitle">{movie.title}</div>
          <div className="admin-panel__historyHint">{item.username || 'Пользователь'} начал смотреть фильм{movie.year ? ` · ${movie.year}` : ''}</div>
        </div>
      </div>
    )
  }

  if (gifUrl) {
    return <img src={gifUrl} alt="GIF" className="admin-panel__historyGif" loading="lazy" />
  }

  if (item.poll) {
    return (
      <div className="admin-panel__historyPoll">
        <div className="admin-panel__historyTag">Опрос</div>
        <div className="admin-panel__historyPollQuestion">{item.poll.question}</div>
        <div className="admin-panel__historyPollOptions">
          {item.poll.options.map(option => (
            <span key={`${item.id}-${option.id}`} className="admin-panel__historyPollOption">{option.text}</span>
          ))}
        </div>
        <div className="admin-panel__historyHint">{item.poll.totalVoters} голосов</div>
      </div>
    )
  }

  return <div className="admin-panel__historyText">{item.text}</div>
}

function StatusBadge({ user }: { user: AdminUser }) {
  if (user.isBanned) {
    return <span className="admin-panel__status admin-panel__status--banned">Забанен</span>
  }

  if (user.timeoutUntil && user.timeoutUntil > Date.now()) {
    return <span className="admin-panel__status admin-panel__status--timeout">Таймаут</span>
  }

  return <span className="admin-panel__status admin-panel__status--active">Активен</span>
}

export default function AdminPanel() {
  const navigate = useNavigate()
  const { token, user, logout } = useAuth()
  const [activeTab, setActiveTab] = useState<AdminTab>('users')
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [rooms, setRooms] = useState<AdminRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [selectedTimeout, setSelectedTimeout] = useState(timeoutOptions[1].durationMs)
  const [showTimeoutModal, setShowTimeoutModal] = useState(false)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [historyTarget, setHistoryTarget] = useState<AdminUser | null>(null)
  const [messageHistory, setMessageHistory] = useState<UserMessage[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [selectedRoom, setSelectedRoom] = useState<AdminRoomDetails | null>(null)
  const [showRoomModal, setShowRoomModal] = useState(false)
  const [roomLoading, setRoomLoading] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmModerationAction | null>(null)
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([])
  const [actionPending, setActionPending] = useState<string | null>(null)

  const authHeaders = useMemo(
    () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    [token]
  )

  const loadUsers = useCallback(async () => {
    if (!token) return
    const res = await fetch(`${API_URL}/admin/users?search=${encodeURIComponent(search)}`, {
      headers: { Authorization: `Bearer ${token}` }
    })

    if (res.status === 401 || res.status === 403) {
      logout()
      navigate('/login', { replace: true })
      return
    }

    const data = await res.json()
    setUsers(data.users || [])
  }, [logout, navigate, search, token])

  const loadRooms = useCallback(async () => {
    if (!token) return
    const res = await fetch(`${API_URL}/admin/rooms`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    setRooms(data.rooms || [])
  }, [token])

  const loadAuditLogs = useCallback(async () => {
    if (!token) return
    const res = await fetch(`${API_URL}/admin/logs`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    setAuditLogs(data.logs || [])
  }, [token])

  const loadAdminData = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      await Promise.all([loadUsers(), loadRooms(), loadAuditLogs()])
    } finally {
      setLoading(false)
    }
  }, [loadAuditLogs, loadRooms, loadUsers, token])

  useEffect(() => {
    if (user?.role !== 'admin') {
      navigate('/login', { replace: true })
      return
    }
    loadAdminData().catch(() => setLoading(false))
  }, [loadAdminData, navigate, user?.role])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadUsers().catch(() => {})
    }, 250)
    return () => window.clearTimeout(timer)
  }, [loadUsers])

  useEffect(() => {
    if (!token || user?.role !== 'admin') return

    const interval = window.setInterval(() => {
      loadRooms().catch(() => {})
      loadAuditLogs().catch(() => {})
    }, 3000)

    return () => window.clearInterval(interval)
  }, [loadAuditLogs, loadRooms, token, user?.role])

  const openTimeoutModal = (targetUser: AdminUser) => {
    setSelectedUser(targetUser)
    setSelectedTimeout(timeoutOptions[1].durationMs)
    setShowTimeoutModal(true)
  }

  const closeTimeoutModal = () => {
    setShowTimeoutModal(false)
    setSelectedUser(null)
  }

  const executeApplyTimeout = async (targetUser: AdminUser) => {
    setActionPending(targetUser.id)
    try {
      await fetch(`${API_URL}/admin/users/${targetUser.id}/timeout`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ durationMs: selectedTimeout })
      })
      closeTimeoutModal()
      await loadUsers()
      await loadAuditLogs()
      if (showRoomModal && selectedRoom?.roomId) {
        await loadRoomDetails(selectedRoom.roomId)
      }
    } finally {
      setActionPending(null)
    }
  }

  const executeBan = async (targetUser: AdminUser) => {
    setActionPending(targetUser.id)
    try {
      await fetch(`${API_URL}/admin/users/${targetUser.id}/ban`, {
        method: 'POST',
        headers: authHeaders
      })
      await loadUsers()
      await loadRooms()
      await loadAuditLogs()
      if (showRoomModal && selectedRoom?.roomId) {
        await loadRoomDetails(selectedRoom.roomId)
      }
    } finally {
      setActionPending(null)
    }
  }

  const handleClearTimeout = async (targetUser: AdminUser) => {
    setActionPending(targetUser.id)
    try {
      await fetch(`${API_URL}/admin/users/${targetUser.id}/timeout/remove`, {
        method: 'POST',
        headers: authHeaders
      })
      await loadUsers()
      await loadAuditLogs()
      if (showRoomModal && selectedRoom?.roomId) {
        await loadRoomDetails(selectedRoom.roomId)
      }
    } finally {
      setActionPending(null)
    }
  }

  const handleUnban = async (targetUser: AdminUser) => {
    setActionPending(targetUser.id)
    try {
      await fetch(`${API_URL}/admin/users/${targetUser.id}/unban`, {
        method: 'POST',
        headers: authHeaders
      })
      await loadUsers()
      await loadAuditLogs()
      if (showRoomModal && selectedRoom?.roomId) {
        await loadRoomDetails(selectedRoom.roomId)
      }
    } finally {
      setActionPending(null)
    }
  }

  const requestBan = useCallback((targetUser: AdminUser) => {
    setConfirmAction({ type: 'ban', user: targetUser })
  }, [])

  const requestTimeoutConfirm = useCallback(() => {
    if (!selectedUser) return
    setConfirmAction({ type: 'timeout', user: selectedUser })
  }, [selectedUser])

  const closeConfirmModal = useCallback(() => {
    setConfirmAction(null)
  }, [])

  const handleConfirmModeration = useCallback(async () => {
    if (!confirmAction) return

    const currentAction = confirmAction
    setConfirmAction(null)

    if (currentAction.type === 'ban') {
      await executeBan(currentAction.user)
      return
    }

    await executeApplyTimeout(currentAction.user)
  }, [confirmAction, executeApplyTimeout, executeBan])

  const handleOpenHistory = async (targetUser: AdminUser) => {
    setHistoryTarget(targetUser)
    setShowHistoryModal(true)
    setHistoryLoading(true)
    try {
      const res = await fetch(`${API_URL}/admin/users/${targetUser.id}/messages`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      setMessageHistory(data.messages || [])
    } finally {
      setHistoryLoading(false)
    }
  }

  const loadRoomDetails = useCallback(async (roomId: string) => {
    if (!token) return

    const res = await fetch(`${API_URL}/admin/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })

    if (res.status === 404) {
      setSelectedRoom(null)
      setShowRoomModal(false)
      await loadRooms()
      return
    }

    const data = await res.json()
    setSelectedRoom(data.room || null)
  }, [loadRooms, token])

  const handleOpenRoom = useCallback(async (roomId: string) => {
    setShowRoomModal(true)
    setRoomLoading(true)
    try {
      await loadRoomDetails(roomId)
    } finally {
      setRoomLoading(false)
    }
  }, [loadRoomDetails])

  const closeRoomModal = useCallback(() => {
    setShowRoomModal(false)
    setSelectedRoom(null)
  }, [])

  const getAdminUserFromRoomUser = useCallback((roomUser: AdminRoomUser): AdminUser => ({
    id: roomUser.id,
    email: '',
    username: roomUser.username,
    color: roomUser.color,
    avatar: roomUser.avatar,
    role: roomUser.role,
    isBanned: Boolean(roomUser.isBanned),
    banReason: '',
    timeoutUntil: roomUser.timeoutUntil || null,
    timeoutReason: '',
    createdAt: '',
    status: roomUser.isBanned ? 'banned' : (roomUser.timeoutUntil ? 'timed_out' : 'active')
  }), [])

  useEffect(() => {
    if (!showRoomModal || !selectedRoom?.roomId) return

    const interval = window.setInterval(() => {
      loadRoomDetails(selectedRoom.roomId).catch(() => {})
    }, 2000)

    return () => window.clearInterval(interval)
  }, [loadRoomDetails, selectedRoom?.roomId, showRoomModal])

  return (
    <div className="admin-panel">
      <header className="admin-panel__header">
        <div className="admin-panel__titleWrap">
          <span className="admin-panel__titleIcon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M10.4 2.8h3.2l.5 2.2a7.7 7.7 0 0 1 1.7.7l1.9-1.2 2.3 2.3-1.2 1.9c.3.5.5 1.1.7 1.7l2.2.5v3.2l-2.2.5a7.7 7.7 0 0 1-.7 1.7l1.2 1.9-2.3 2.3-1.9-1.2a7.7 7.7 0 0 1-1.7.7l-.5 2.2h-3.2l-.5-2.2a7.7 7.7 0 0 1-1.7-.7l-1.9 1.2-2.3-2.3 1.2-1.9a7.7 7.7 0 0 1-.7-1.7l-2.2-.5v-3.2l2.2-.5a7.7 7.7 0 0 1 .7-1.7L4.3 6.8l2.3-2.3 1.9 1.2a7.7 7.7 0 0 1 1.7-.7z" />
              <circle cx="12" cy="12" r="3.2" />
            </svg>
          </span>
          <div>
            <h1 className="admin-panel__title">Панель администратора</h1>
            <p className="admin-panel__subtitle">Управление сайтом и модерацией в реальном времени</p>
          </div>
        </div>
        <div className="admin-panel__headerControls">
          <div className="admin-panel__adminBadge">
            <span className="admin-panel__adminBadgeLabel">Вы вошли как</span>
            <strong className="admin-panel__adminBadgeName">{user?.username || 'Администратор'}</strong>
          </div>
          <button className="admin-panel__logoutBtn" onClick={() => logout()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2" />
              <path d="M10 12h10" />
              <path d="M17 8l4 4-4 4" />
            </svg>
            <span>Выйти</span>
          </button>
        </div>
      </header>

      <main className="admin-panel__content">
        <div className="admin-panel__tabs">
          <button
            className={`admin-panel__tab ${activeTab === 'users' ? 'admin-panel__tab--active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            Пользователи <span>{users.length}</span>
          </button>
          <button
            className={`admin-panel__tab ${activeTab === 'rooms' ? 'admin-panel__tab--active' : ''}`}
            onClick={() => setActiveTab('rooms')}
          >
            Комнаты <span>{rooms.length}</span>
          </button>
          <button
            className={`admin-panel__tab ${activeTab === 'logs' ? 'admin-panel__tab--active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            Логи <span>{auditLogs.length}</span>
          </button>
        </div>

        {activeTab === 'users' && (
          <>
            <div className="admin-panel__searchWrap">
              <svg className="admin-panel__searchIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                type="text"
                className="admin-panel__search"
                placeholder="Поиск по имени или email..."
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
            </div>

            <div className="admin-panel__tableWrap">
              <div className="admin-panel__tableHeader admin-panel__grid">
                <span>Пользователь</span>
                <span>Email</span>
                <span>Статус</span>
                <span>Таймаут</span>
                <span>Регистрация</span>
                <span>Действия</span>
              </div>

              {loading ? (
                <div className="admin-panel__empty">Загрузка...</div>
              ) : users.length === 0 ? (
                <div className="admin-panel__empty">Пользователи не найдены</div>
              ) : (
                users.map(targetUser => {
                  const isSelfAdmin = targetUser.role === 'admin'
                  const hasActiveTimeout = Boolean(targetUser.timeoutUntil && targetUser.timeoutUntil > Date.now())
                  return (
                    <div key={targetUser.id} className="admin-panel__row admin-panel__grid">
                      <div className="admin-panel__userCell">
                        <div className="admin-panel__avatar" style={{ background: targetUser.avatar ? 'transparent' : targetUser.color }}>
                          {targetUser.avatar ? <img src={targetUser.avatar} alt={targetUser.username} /> : targetUser.username.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="admin-panel__usernameRow">
                            <span className="admin-panel__username">{targetUser.username}</span>
                            {targetUser.role === 'admin' && <span className="admin-panel__role">Админ</span>}
                          </div>
                        </div>
                      </div>
                      <span className="admin-panel__muted">{targetUser.email}</span>
                      <StatusBadge user={targetUser} />
                      <span className="admin-panel__muted">{formatTimeLeft(targetUser.timeoutUntil)}</span>
                      <span className="admin-panel__muted">{formatDate(targetUser.createdAt)}</span>
                      <div className="admin-panel__actions">
                        <button
                          className="admin-panel__actionBtn"
                          onClick={() => handleOpenHistory(targetUser)}
                          aria-label="История сообщений"
                          disabled={actionPending === targetUser.id}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                        </button>
                        <button
                          className={`admin-panel__actionBtn ${hasActiveTimeout ? 'admin-panel__actionBtn--warning' : ''}`}
                          onClick={() => hasActiveTimeout ? handleClearTimeout(targetUser) : openTimeoutModal(targetUser)}
                          aria-label={hasActiveTimeout ? 'Снять таймаут' : 'Выдать таймаут'}
                          title={hasActiveTimeout ? 'Снять таймаут' : 'Выдать таймаут'}
                          disabled={isSelfAdmin || actionPending === targetUser.id || targetUser.isBanned}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="9" />
                            {hasActiveTimeout ? <path d="M8 12h8" /> : <path d="M12 7v5l3 3" />}
                          </svg>
                        </button>
                        <button
                          className={`admin-panel__actionBtn ${targetUser.isBanned ? 'admin-panel__actionBtn--danger' : ''}`}
                          onClick={() => targetUser.isBanned ? handleUnban(targetUser) : requestBan(targetUser)}
                          aria-label={targetUser.isBanned ? 'Разбанить' : 'Забанить'}
                          title={targetUser.isBanned ? 'Разбанить' : 'Забанить'}
                          disabled={isSelfAdmin || actionPending === targetUser.id}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="9" />
                            {targetUser.isBanned ? <path d="M8 12h8" /> : <path d="M8 8l8 8" />}
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}

        {activeTab === 'rooms' && (
          <div className="admin-panel__roomsList">
            {rooms.length === 0 ? (
              <div className="admin-panel__empty">Активных комнат нет</div>
            ) : (
              rooms.map(room => (
                <button key={room.roomId} type="button" className="admin-panel__roomCard admin-panel__roomCardButton" onClick={() => handleOpenRoom(room.roomId)}>
                  <div>
                    <div className="admin-panel__roomId">Комната</div>
                    <div className="admin-panel__roomMeta">{room.videoTitle || 'Без выбранного фильма'}</div>
                  </div>
                  <div className="admin-panel__roomStats">
                    <span>{room.usersCount} участ.</span>
                    <span>{room.isPrivate ? 'Приватная' : 'Публичная'}</span>
                    <span>{room.solo ? 'Solo' : 'Shared'}</span>
                    <span>{formatDate(room.createdAt)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="admin-panel__logsList">
            {loading ? (
              <div className="admin-panel__empty">Загрузка логов...</div>
            ) : auditLogs.length === 0 ? (
              <div className="admin-panel__empty">Логи действий администратора пока пусты</div>
            ) : (
              auditLogs.map(log => (
                <div key={log.id} className="admin-panel__logItem">
                  <div className="admin-panel__historyMeta">
                    <span>{log.adminUsername}</span>
                    <span>{formatDateTime(log.createdAt)}</span>
                  </div>
                  <div className="admin-panel__logTitle">{formatAuditAction(log)}</div>
                  <div className="admin-panel__historyHint">{log.details}</div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {showTimeoutModal && selectedUser && (
        <div className="admin-panel__modalOverlay admin-panel__modalOverlay--front" onClick={closeTimeoutModal}>
          <div className="admin-panel__modal" onClick={event => event.stopPropagation()}>
            <button className="admin-panel__modalClose" onClick={closeTimeoutModal} aria-label="Закрыть">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <h2 className="admin-panel__modalTitle">Таймаут чата — {selectedUser.username}</h2>
            <p className="admin-panel__modalText">
              Пользователь не сможет писать в чат в течение указанного времени.
            </p>
            <div className="admin-panel__timeoutGrid">
              {timeoutOptions.map(option => (
                <button
                  key={option.durationMs}
                  className={`admin-panel__timeoutOption ${selectedTimeout === option.durationMs ? 'admin-panel__timeoutOption--active' : ''}`}
                  onClick={() => setSelectedTimeout(option.durationMs)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="admin-panel__modalActions">
              <button className="admin-panel__primaryBtn" onClick={requestTimeoutConfirm} disabled={actionPending === selectedUser.id}>
                Применить
              </button>
              <button className="admin-panel__secondaryBtn" onClick={closeTimeoutModal}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistoryModal && historyTarget && (
        <div className="admin-panel__modalOverlay admin-panel__modalOverlay--front" onClick={() => setShowHistoryModal(false)}>
          <div className="admin-panel__historyModal" onClick={event => event.stopPropagation()}>
            <div className="admin-panel__historyHeader">
              <div>
                <h2 className="admin-panel__modalTitle">История сообщений — {historyTarget.username}</h2>
                <p className="admin-panel__modalText">Все сохранённые сообщения пользователя в комнатах.</p>
              </div>
              <button className="admin-panel__modalClose" onClick={() => setShowHistoryModal(false)} aria-label="Закрыть">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="admin-panel__historyBody">
              {historyLoading ? (
                <div className="admin-panel__empty">Загрузка истории...</div>
              ) : messageHistory.length === 0 ? (
                <div className="admin-panel__empty">Сообщений пока нет</div>
              ) : (
                messageHistory.map(item => (
                  <div key={item.id} className="admin-panel__historyItem">
                    <div className="admin-panel__historyMeta">
                      <span>Комната {item.roomId}</span>
                      <span>{formatDateTime(item.createdAt)}</span>
                    </div>
                    <HistoryMessagePreview item={item} />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showRoomModal && (
        <div className="admin-panel__modalOverlay" onClick={closeRoomModal}>
          <div className="admin-panel__roomModal" onClick={event => event.stopPropagation()}>
            {selectedRoom?.posterPath && (
              <div className="admin-panel__roomHero">
                <img src={getPosterUrl(selectedRoom.posterPath, 'w500')} alt={selectedRoom.videoTitle} className="admin-panel__roomHeroImage" />
                <div className="admin-panel__roomHeroOverlay" />
              </div>
            )}
            <div className="admin-panel__historyHeader">
              <div>
                <h2 className="admin-panel__modalTitle">Комната</h2>
                <p className="admin-panel__modalText">{selectedRoom?.videoTitle || 'Загрузка комнаты...'}</p>
              </div>
              <button className="admin-panel__modalClose" onClick={closeRoomModal} aria-label="Закрыть">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {roomLoading && !selectedRoom ? (
              <div className="admin-panel__empty">Загрузка комнаты...</div>
            ) : !selectedRoom ? (
              <div className="admin-panel__empty">Комната больше не активна</div>
            ) : (
              <div className="admin-panel__roomModalBody">
                <section className="admin-panel__roomSidebar">
                  <div className="admin-panel__roomSectionTitle">Участники</div>
                  <div className="admin-panel__roomUsersList">
                    {selectedRoom.users.map(roomUser => {
                      const canModerate = !roomUser.isGuest && roomUser.role !== 'admin'
                      const mappedUser = getAdminUserFromRoomUser(roomUser)

                      return (
                        <div key={`${roomUser.id}-${roomUser.socketId || 'room'}`} className="admin-panel__roomUserCard">
                          <div className="admin-panel__userCell">
                            <div className="admin-panel__avatar" style={{ background: roomUser.avatar ? 'transparent' : roomUser.color }}>
                              {roomUser.avatar ? <img src={roomUser.avatar} alt={roomUser.username} /> : roomUser.initials}
                            </div>
                            <div>
                              <div className="admin-panel__usernameRow">
                                <span className="admin-panel__username">{roomUser.username}</span>
                                {roomUser.isGuest && <span className="admin-panel__role">Гость</span>}
                                {roomUser.role === 'admin' && <span className="admin-panel__role">Админ</span>}
                              </div>
                            </div>
                          </div>
                          <div className="admin-panel__actions">
                            <button
                              className="admin-panel__actionBtn"
                              onClick={() => handleOpenHistory(mappedUser)}
                              aria-label="История сообщений"
                              disabled={roomUser.isGuest || actionPending === roomUser.id}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                              </svg>
                            </button>
                            <button
                              className={`admin-panel__actionBtn ${mappedUser.timeoutUntil && mappedUser.timeoutUntil > Date.now() ? 'admin-panel__actionBtn--warning' : ''}`}
                              onClick={() => mappedUser.timeoutUntil && mappedUser.timeoutUntil > Date.now() ? handleClearTimeout(mappedUser) : openTimeoutModal(mappedUser)}
                              aria-label={mappedUser.timeoutUntil && mappedUser.timeoutUntil > Date.now() ? 'Снять таймаут' : 'Выдать таймаут'}
                              disabled={!canModerate || actionPending === roomUser.id || mappedUser.isBanned}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="9" />
                                {mappedUser.timeoutUntil && mappedUser.timeoutUntil > Date.now() ? <path d="M8 12h8" /> : <path d="M12 7v5l3 3" />}
                              </svg>
                            </button>
                            <button
                              className={`admin-panel__actionBtn ${mappedUser.isBanned ? 'admin-panel__actionBtn--danger' : ''}`}
                              onClick={() => mappedUser.isBanned ? handleUnban(mappedUser) : requestBan(mappedUser)}
                              aria-label={mappedUser.isBanned ? 'Разбанить' : 'Забанить'}
                              disabled={!canModerate || actionPending === roomUser.id}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="9" />
                                {mappedUser.isBanned ? <path d="M8 12h8" /> : <path d="M8 8l8 8" />}
                              </svg>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>

                <section className="admin-panel__roomChatSection">
                  <div className="admin-panel__roomSectionTitle">Чат комнаты</div>
                  <div className="admin-panel__roomChatList">
                    {selectedRoom.messages.length === 0 ? (
                      <div className="admin-panel__empty">В комнате пока нет сообщений</div>
                    ) : (
                      selectedRoom.messages.map(message => (
                        <div key={message.id} className="admin-panel__roomChatItem">
                          {message.type !== 'system' && (
                            <div className="admin-panel__avatar" style={{ background: message.avatar ? 'transparent' : message.color }}>
                              {message.avatar ? <img src={message.avatar} alt={message.username} /> : (message.initials || message.username?.slice(0, 2).toUpperCase())}
                            </div>
                          )}
                          <div className="admin-panel__roomChatContent">
                            {message.type !== 'system' && (
                              <div className="admin-panel__historyMeta">
                                <span>{message.username || 'Участник'}</span>
                                <span>{formatDateTime(message.timestamp)}</span>
                              </div>
                            )}
                            <AdminMessagePreview item={message} />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      )}

      {confirmAction && (
        <div className="admin-panel__modalOverlay admin-panel__modalOverlay--front admin-panel__modalOverlay--confirm" onClick={closeConfirmModal}>
          <div className="admin-panel__modal admin-panel__confirmModal" onClick={event => event.stopPropagation()}>
            <button className="admin-panel__modalClose" onClick={closeConfirmModal} aria-label="Закрыть">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <h2 className="admin-panel__modalTitle">
              {confirmAction.type === 'ban' ? 'Подтвердите бан' : 'Подтвердите таймаут'}
            </h2>
            <p className="admin-panel__modalText">
              {confirmAction.type === 'ban'
                ? `Вы точно хотите забанить пользователя ${confirmAction.user.username}?`
                : `Вы точно хотите выдать таймаут пользователю ${confirmAction.user.username}?`}
            </p>
            <div className="admin-panel__modalActions">
              <button className="admin-panel__primaryBtn" onClick={() => { handleConfirmModeration().catch(() => {}) }} disabled={actionPending === confirmAction.user.id}>
                Подтвердить
              </button>
              <button className="admin-panel__secondaryBtn" onClick={closeConfirmModal}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
