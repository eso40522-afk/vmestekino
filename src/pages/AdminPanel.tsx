import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useSocket } from '../contexts/SocketContext'
import { API_URL } from '../config/api'
import {
  getPosterUrl,
  getTopRatedMovies,
  searchMovies,
  getMovieDetails,
  getMovieExternalIds,
  formatReleaseDate,
  type TMDBMovie
} from '../services/tmdb'
import './AdminPanel.css'

type AdminTab = 'users' | 'rooms' | 'logs' | 'video_sources'

type VideoSourceType = 'html5' | 'youtube' | 'embed' | 'rutube' | 'vkvideo'

type AdminVideoSource = {
  tmdbId: string
  imdbId: string | null
  sourceType: VideoSourceType
  sourceUrl: string
  dubLanguage: string
  dubType: string
  title: string
  posterPath?: string | null
  isActive: number | boolean
  updatedAt?: string
}

type AdminMovieFilter = 'all' | 'with' | 'without'

type AdminMovieDraft = {
  tmdbId: number
  imdbId: string
  sourceType: VideoSourceType
  sourceUrl: string
  dubLanguage: string
  dubType: string
  title: string
  posterPath: string | null
  year: string
  isNew: boolean
}

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
  messageId?: string
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

function logActionLabel(action: string): string {
  switch (action) {
    case 'view_room': return 'Просмотр комнаты'
    case 'view_user_history': return 'Просмотр истории'
    case 'set_timeout': return 'Таймаут'
    case 'remove_timeout': return 'Снят таймаут'
    case 'ban_user': return 'Бан'
    case 'unban_user': return 'Разбан'
    case 'upsert_video_source': return 'Источник сохранён'
    case 'delete_video_source': return 'Источник удалён'
    case 'delete_chat_message': return 'Сообщение удалено'
    default: return action
  }
}

function logActionTone(action: string): 'neutral' | 'warning' | 'danger' | 'success' | 'info' {
  switch (action) {
    case 'set_timeout':
      return 'warning'
    case 'ban_user':
    case 'delete_video_source':
    case 'delete_chat_message':
      return 'danger'
    case 'remove_timeout':
    case 'unban_user':
    case 'upsert_video_source':
      return 'success'
    case 'view_room':
    case 'view_user_history':
      return 'info'
    default:
      return 'neutral'
  }
}

function HistoryMessagePreview({ item }: { item: UserMessage }) {
  const gifUrl = getHistoryGifUrl(item)
  const movie = getAdminMovieSelection(item.text)
  const movieText = getHistoryMovieText(item)
  const poll = getHistoryPoll(item)

  if (gifUrl) {
    return <img src={gifUrl} alt="GIF" className="admin-panel__historyGif" loading="lazy" />
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
          <div className="admin-panel__historyHint">Начал смотреть{movie.year ? ` · ${movie.year}` : ''}{movie.imdbId ? ` · ${movie.imdbId}` : ''}</div>
        </div>
      </div>
    )
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
  const { socket } = useSocket()
  const historyTargetRef = useRef<AdminUser | null>(null)
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
  const [deletingMessageId, setDeletingMessageId] = useState<number | null>(null)
  const [deleteMessageConfirm, setDeleteMessageConfirm] = useState<UserMessage | null>(null)
  const [deleteMessageError, setDeleteMessageError] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [selectedRoom, setSelectedRoom] = useState<AdminRoomDetails | null>(null)
  const [showRoomModal, setShowRoomModal] = useState(false)
  const [roomLoading, setRoomLoading] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmModerationAction | null>(null)
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([])
  const [actionPending, setActionPending] = useState<string | null>(null)

  // Вкладка "Фильмы"
  const [movieSearch, setMovieSearch] = useState('')
  const [movieFilter, setMovieFilter] = useState<AdminMovieFilter>('all')
  const [tmdbMovies, setTmdbMovies] = useState<TMDBMovie[]>([])
  const [tmdbLoading, setTmdbLoading] = useState(false)
  const [tmdbLoadingMore, setTmdbLoadingMore] = useState(false)
  const [, setTmdbPage] = useState(1)
  const [, setTmdbHasMore] = useState(true)
  const [savedSources, setSavedSources] = useState<AdminVideoSource[]>([])
  const [, setSourcesLoading] = useState(false)
  const [movieDraft, setMovieDraft] = useState<AdminMovieDraft | null>(null)
  const [movieDraftLoading, setMovieDraftLoading] = useState(false)
  const [movieDraftError, setMovieDraftError] = useState<string | null>(null)
  const [movieDraftSaving, setMovieDraftSaving] = useState(false)
  const [confirmDeleteSource, setConfirmDeleteSource] = useState<AdminVideoSource | null>(null)

  // Логи
  const [logSearch, setLogSearch] = useState('')
  const [logActionFilter, setLogActionFilter] = useState<string>('all')

  // Сортировка и фильтр пользователей
  const [userStatusDir, setUserStatusDir] = useState<'asc' | 'desc'>('desc')
  const [userDateDir, setUserDateDir] = useState<'asc' | 'desc'>('desc')
  const [userStatusFilter, setUserStatusFilter] = useState<'all' | 'active' | 'timed_out' | 'banned'>('all')

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

  const loadSavedSources = useCallback(async () => {
    if (!token) return
    setSourcesLoading(true)
    try {
      const res = await fetch(`${API_URL}/admin/video-sources`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      const sources: AdminVideoSource[] = Array.isArray(data.sources) ? data.sources : []
      setSavedSources(sources)

      // Дотягиваем постеры для записей без poster_path
      const missing = sources.filter(item => !item.posterPath)
      if (missing.length > 0) {
        const results = await Promise.allSettled(missing.map(item => getMovieDetails(Number(item.tmdbId))))
        const updates = new Map<string, string>()
        results.forEach((result, idx) => {
          if (result.status === 'fulfilled' && result.value?.poster_path) {
            updates.set(String(missing[idx].tmdbId), result.value.poster_path)
          }
        })
        if (updates.size > 0) {
          setSavedSources(prev => prev.map(item => updates.has(String(item.tmdbId))
            ? { ...item, posterPath: updates.get(String(item.tmdbId)) || item.posterPath }
            : item))
        }
      }
    } finally {
      setSourcesLoading(false)
    }
  }, [token])

  const loadTmdbMovies = useCallback(async (query: string) => {
    setTmdbLoading(true)
    setTmdbPage(1)
    setTmdbHasMore(false)
    setTmdbMovies([])
    try {
      // Лимит страниц TMDB: для поиска 5 (быстрый отклик), для топа — глубокая авто-подгрузка.
      const AUTO_PAGE_CAP = query.trim() ? 5 : 30
      const fetcher = query.trim()
        ? (page: number) => searchMovies(query.trim(), page)
        : (page: number) => getTopRatedMovies(page)
      const first = await fetcher(1)
      const totalPages = Math.min(first.total_pages ?? 1, AUTO_PAGE_CAP)
      const seen = new Set<number>()
      const initial = (first.results || []).filter(item => seen.has(item.id) ? false : (seen.add(item.id), true))
      setTmdbMovies(initial)
      setTmdbPage(1)
      // Завершаем основной спиннер сразу — дальше будет фоновая прогрессивная подгрузка.
      setTmdbLoading(false)
      if (totalPages <= 1) return
      setTmdbLoadingMore(true)
      try {
        for (let page = 2; page <= totalPages; page++) {
          let response: { results?: TMDBMovie[] } = {}
          try {
            response = await fetcher(page)
          } catch {
            break
          }
          const extra = (response.results || []).filter(item => seen.has(item.id) ? false : (seen.add(item.id), true))
          if (extra.length > 0) {
            setTmdbMovies(prev => [...prev, ...extra])
          }
          setTmdbPage(page)
        }
      } finally {
        setTmdbLoadingMore(false)
      }
    } catch {
      setTmdbMovies([])
      setTmdbHasMore(false)
      setTmdbLoading(false)
    }
  }, [])

  const savedSourceMap = useMemo(() => {
    const map = new Map<string, AdminVideoSource>()
    savedSources.forEach(source => {
      map.set(String(source.tmdbId), source)
    })
    return map
  }, [savedSources])

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

  useEffect(() => {
    if (activeTab !== 'video_sources' || user?.role !== 'admin') return
    loadSavedSources().catch(() => {})
  }, [activeTab, loadSavedSources, user?.role])

  // Реал-тайм подписка на новые сообщения чата для админов
  useEffect(() => {
    if (!socket || !token || user?.role !== 'admin') return
    socket.emit('admin:subscribe', { token })

    const handleNewLog = (entry: UserMessage & { userId: string }) => {
      const target = historyTargetRef.current
      if (!target || target.id !== entry.userId) return
      setMessageHistory(prev => {
        if (prev.some(item => item.id === entry.id)) return prev
        return [{
          id: entry.id,
          roomId: entry.roomId,
          messageType: entry.messageType,
          text: entry.text,
          createdAt: entry.createdAt,
          messageId: entry.messageId
        }, ...prev]
      })
    }

    socket.on('admin-chat-log', handleNewLog)
    const handleReconnect = () => {
      socket.emit('admin:subscribe', { token })
    }
    socket.on('connect', handleReconnect)

    return () => {
      socket.off('admin-chat-log', handleNewLog)
      socket.off('connect', handleReconnect)
      socket.emit('admin:unsubscribe')
    }
  }, [socket, token, user?.role])

  useEffect(() => {
    historyTargetRef.current = historyTarget
  }, [historyTarget])

  useEffect(() => {
    if (activeTab !== 'video_sources') return
    const timer = window.setTimeout(() => {
      loadTmdbMovies(movieSearch).catch(() => {})
    }, 250)
    return () => window.clearTimeout(timer)
  }, [activeTab, movieSearch, loadTmdbMovies])

  const openMovieEditor = useCallback(async (movie: { id: number; title: string; poster_path?: string | null; release_date?: string }) => {
    setMovieDraftError(null)
    setMovieDraftLoading(true)
    const existing = savedSourceMap.get(String(movie.id)) || null
    setMovieDraft({
      tmdbId: movie.id,
      imdbId: existing?.imdbId || '',
      sourceType: (existing?.sourceType as VideoSourceType) || 'rutube',
      sourceUrl: existing?.sourceUrl || '',
      dubLanguage: existing?.dubLanguage || 'ru',
      dubType: existing?.dubType || 'озвучка',
      title: existing?.title || movie.title,
      posterPath: movie.poster_path || existing?.posterPath || null,
      year: movie.release_date ? formatReleaseDate(movie.release_date) : '',
      isNew: !existing
    })

    try {
      const externalIds = await getMovieExternalIds(movie.id)
      setMovieDraft(prev => prev && prev.tmdbId === movie.id ? { ...prev, imdbId: prev.imdbId || externalIds.imdb_id || '' } : prev)
    } catch {
      // игнорируем, imdbId можно ввести вручную
    } finally {
      setMovieDraftLoading(false)
    }
  }, [savedSourceMap])

  const closeMovieEditor = useCallback(() => {
    setMovieDraft(null)
    setMovieDraftError(null)
  }, [])

  const submitMovieDraft = useCallback(async () => {
    if (!movieDraft || !token) return
    if (!movieDraft.sourceUrl.trim()) {
      setMovieDraftError('Укажите ссылку на источник')
      return
    }

    setMovieDraftSaving(true)
    setMovieDraftError(null)
    try {
      const res = await fetch(`${API_URL}/admin/video-sources`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          tmdbId: movieDraft.tmdbId,
          imdbId: movieDraft.imdbId.trim() || null,
          sourceType: movieDraft.sourceType,
          sourceUrl: movieDraft.sourceUrl.trim(),
          dubLanguage: movieDraft.dubLanguage,
          dubType: movieDraft.dubType,
          title: movieDraft.title,
          posterPath: movieDraft.posterPath || '',
          isActive: true
        })
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setMovieDraftError(typeof data?.error === 'string' ? data.error : 'Не удалось сохранить')
        return
      }

      await loadSavedSources()
      setMovieDraft(null)
    } catch {
      setMovieDraftError('Не удалось сохранить')
    } finally {
      setMovieDraftSaving(false)
    }
  }, [authHeaders, loadSavedSources, movieDraft, token])

  const handleDeleteSource = useCallback(async (source: AdminVideoSource) => {
    if (!token) return
    setActionPending(`source-${source.tmdbId}`)
    try {
      await fetch(`${API_URL}/admin/video-sources/${source.tmdbId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      await loadSavedSources()
      setMovieDraft(null)
    } finally {
      setActionPending(null)
      setConfirmDeleteSource(null)
    }
  }, [loadSavedSources, token])

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

  const handleDeleteMessage = async (message: UserMessage) => {
    if (!token || deletingMessageId === message.id) return
    setDeletingMessageId(message.id)
    setDeleteMessageError(null)
    try {
      const res = await fetch(`${API_URL}/admin/chat-messages/${message.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Не удалось удалить сообщение')
      }
      setMessageHistory(prev => prev.filter(item => item.id !== message.id))
      setDeleteMessageConfirm(null)
      loadAuditLogs()
    } catch (error) {
      console.error('Ошибка удаления сообщения:', error)
      setDeleteMessageError(error instanceof Error ? error.message : 'Не удалось удалить сообщение')
    } finally {
      setDeletingMessageId(null)
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
            Пользователи
          </button>
          <button
            className={`admin-panel__tab ${activeTab === 'rooms' ? 'admin-panel__tab--active' : ''}`}
            onClick={() => setActiveTab('rooms')}
          >
            Комнаты
          </button>
          <button
            className={`admin-panel__tab ${activeTab === 'logs' ? 'admin-panel__tab--active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            Логи
          </button>
          <button
            className={`admin-panel__tab ${activeTab === 'video_sources' ? 'admin-panel__tab--active' : ''}`}
            onClick={() => setActiveTab('video_sources')}
          >
            Фильмы
          </button>
        </div>

        {activeTab === 'users' && (() => {
          const allVisible = users.filter(u => u.role !== 'admin' && u.username.toLowerCase() !== 'test')
          const activeCount = allVisible.filter(u => u.status === 'active').length
          const timedOutCount = allVisible.filter(u => u.status === 'timed_out').length
          const bannedCount = allVisible.filter(u => u.status === 'banned').length
          const filteredByStatus = userStatusFilter === 'all'
            ? allVisible
            : allVisible.filter(u => u.status === userStatusFilter)
          const statusRank: Record<string, number> = { active: 0, timed_out: 1, banned: 2 }
          const sortedUsers = [...filteredByStatus].sort((a, b) => {
            if (userStatusFilter === 'all') {
              const ra = statusRank[a.status] ?? 99
              const rb = statusRank[b.status] ?? 99
              if (ra !== rb) return userStatusDir === 'asc' ? rb - ra : ra - rb
            }
            const ta = new Date(a.createdAt).getTime() || 0
            const tb = new Date(b.createdAt).getTime() || 0
            return userDateDir === 'asc' ? ta - tb : tb - ta
          })
          const statusSortAvailable = userStatusFilter === 'all'
          const statCards: { key: 'all' | 'active' | 'timed_out' | 'banned'; label: string; value: number; tone?: string }[] = [
            { key: 'all', label: 'Зарегистрировано', value: allVisible.length },
            { key: 'active', label: 'Активных', value: activeCount, tone: 'success' },
            { key: 'timed_out', label: 'В таймауте', value: timedOutCount, tone: 'warning' },
            { key: 'banned', label: 'Забанено', value: bannedCount, tone: 'danger' }
          ]
          return (
          <>
            <div className="admin-panel__statsRow">
              {statCards.map(card => (
                <button
                  key={card.key}
                  type="button"
                  className={`admin-panel__statCard${card.tone ? ` admin-panel__statCard--${card.tone}` : ''}${userStatusFilter === card.key ? ' admin-panel__statCard--active' : ''}`}
                  onClick={() => setUserStatusFilter(card.key)}
                >
                  <div className="admin-panel__statLabel">{card.label}</div>
                  <div className="admin-panel__statValue">{card.value}</div>
                  {card.key === 'all' && <div className="admin-panel__statHint">в реальном времени</div>}
                </button>
              ))}
            </div>

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
                <button
                  type="button"
                  className={`admin-panel__sortBtn ${userStatusDir === 'asc' ? 'admin-panel__sortBtn--asc' : ''} ${!statusSortAvailable ? 'admin-panel__sortBtn--inactive' : ''}`}
                  onClick={() => statusSortAvailable && setUserStatusDir(prev => prev === 'desc' ? 'asc' : 'desc')}
                  disabled={!statusSortAvailable}
                  title={!statusSortAvailable ? 'Доступно в режиме «Зарегистрировано»' : userStatusDir === 'asc' ? 'От забаненных к активным' : 'От активных к забаненным'}
                >
                  Статус
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 10l5-5 5 5" />
                    <path d="M7 14l5 5 5-5" />
                  </svg>
                </button>
                <span>Таймаут</span>
                <button
                  type="button"
                  className={`admin-panel__sortBtn ${userDateDir === 'asc' ? 'admin-panel__sortBtn--asc' : ''}`}
                  onClick={() => setUserDateDir(prev => prev === 'desc' ? 'asc' : 'desc')}
                  title={userDateDir === 'asc' ? 'От старых к новым' : 'От новых к старым'}
                >
                  Регистрация
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 10l5-5 5 5" />
                    <path d="M7 14l5 5 5-5" />
                  </svg>
                </button>
                <span>Действия</span>
              </div>

              {loading ? (
                <div className="admin-panel__empty">Загрузка...</div>
              ) : sortedUsers.length === 0 ? (
                <div className="admin-panel__empty">Пользователи не найдены</div>
              ) : (
                sortedUsers.map(targetUser => {
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
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
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
          )
        })()}

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
          <div className="admin-panel__logs">
            <div className="admin-panel__moviesToolbar">
              <div className="admin-panel__searchWrap admin-panel__searchWrap--inline">
                <svg className="admin-panel__searchIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                <input
                  type="text"
                  className="admin-panel__search"
                  placeholder="Поиск по администратору, объекту или описанию..."
                  value={logSearch}
                  onChange={event => setLogSearch(event.target.value)}
                />
              </div>
              <div className="admin-panel__movieFilters">
                {([
                  { key: 'all', label: 'Все' },
                  { key: 'set_timeout', label: 'Таймауты' },
                  { key: 'remove_timeout', label: 'Снятия таймаута' },
                  { key: 'ban_user', label: 'Баны' },
                  { key: 'unban_user', label: 'Разбаны' },
                  { key: 'view_room', label: 'Комнаты' },
                  { key: 'view_user_history', label: 'История' },
                  { key: 'delete_chat_message', label: 'Удалённые сообщения' },
                  { key: 'upsert_video_source', label: 'Источники' },
                  { key: 'delete_video_source', label: 'Удалённые источники' }
                ] as { key: string; label: string }[]).map(item => (
                  <button
                    key={item.key}
                    type="button"
                    className={`admin-panel__movieFilter ${logActionFilter === item.key ? 'admin-panel__movieFilter--active' : ''}`}
                    onClick={() => setLogActionFilter(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="admin-panel__logsList">
              {loading && auditLogs.length === 0 ? (
                <div className="admin-panel__empty">Загрузка логов...</div>
              ) : (() => {
                const query = logSearch.trim().toLowerCase()
                const filtered = auditLogs.filter(log => {
                  if (logActionFilter !== 'all' && log.action !== logActionFilter) return false
                  if (!query) return true
                  return (
                    log.adminUsername.toLowerCase().includes(query) ||
                    log.targetName.toLowerCase().includes(query) ||
                    (log.details || '').toLowerCase().includes(query) ||
                    log.action.toLowerCase().includes(query)
                  )
                })

                if (filtered.length === 0) {
                  return <div className="admin-panel__empty">По выбранным фильтрам логов нет</div>
                }

                return filtered.map(log => {
                  const adminUser = users.find(item => item.username === log.adminUsername)
                  const targetIsUser = log.targetType === 'user'
                  const targetUser = targetIsUser ? users.find(item => item.id === log.targetId) : null
                  const targetIsRoom = log.targetType === 'room'
                  const targetRoom = targetIsRoom ? rooms.find(item => item.roomId === log.targetId) : null
                  const targetIsSource = log.targetType === 'video_source'
                  const targetSource = targetIsSource ? savedSourceMap.get(log.targetId) : null
                  const tone = logActionTone(log.action)

                  return (
                    <div key={log.id} className={`admin-panel__logCard admin-panel__logCard--${tone}`}>
                      <div className="admin-panel__logCardBody">
                        <div className="admin-panel__logCardHeader">
                          <div className="admin-panel__logCardActor">
                            {adminUser?.avatar ? (
                              <img src={adminUser.avatar} alt={adminUser.username} className="admin-panel__logCardAvatar" />
                            ) : (
                              <span className="admin-panel__logCardAvatar admin-panel__logCardAvatar--initials" style={{ background: adminUser?.color || '#3a3d4a' }}>
                                {(log.adminUsername || '?').slice(0, 2).toUpperCase()}
                              </span>
                            )}
                            <div>
                              <div className="admin-panel__logCardActorName">{log.adminUsername}</div>
                              <div className="admin-panel__logCardMeta">{formatDateTime(log.createdAt)}</div>
                            </div>
                          </div>
                          <span className={`admin-panel__logActionBadge admin-panel__logActionBadge--${tone}`}>{logActionLabel(log.action)}</span>
                        </div>

                        <div className="admin-panel__logCardTarget">
                          {targetUser && (
                            <div className="admin-panel__logTargetUser">
                              {targetUser.avatar ? (
                                <img src={targetUser.avatar} alt={targetUser.username} className="admin-panel__logCardAvatar" />
                              ) : (
                                <span className="admin-panel__logCardAvatar admin-panel__logCardAvatar--initials" style={{ background: targetUser.color || '#3a3d4a' }}>
                                  {targetUser.username.slice(0, 2).toUpperCase()}
                                </span>
                              )}
                              <div>
                                <div className="admin-panel__logTargetTitle">{targetUser.username}</div>
                                <div className="admin-panel__logCardMeta">{targetUser.email}</div>
                              </div>
                            </div>
                          )}

                          {targetIsUser && !targetUser && (
                            <div className="admin-panel__logTargetUser">
                              <span className="admin-panel__logCardAvatar admin-panel__logCardAvatar--initials" style={{ background: '#3a3d4a' }}>
                                {(log.targetName || '?').slice(0, 2).toUpperCase()}
                              </span>
                              <div>
                                <div className="admin-panel__logTargetTitle">{log.targetName}</div>
                                <div className="admin-panel__logCardMeta">пользователь удалён или не загружен</div>
                              </div>
                            </div>
                          )}

                          {targetIsRoom && (
                            <div className="admin-panel__logTargetRoom">
                              {targetRoom?.posterPath ? (
                                <img src={getPosterUrl(targetRoom.posterPath, 'w185')} alt={targetRoom.videoTitle || log.targetId} className="admin-panel__logTargetPoster" />
                              ) : (
                                <div className="admin-panel__logTargetPoster admin-panel__logTargetPoster--placeholder">🎬</div>
                              )}
                              <div>
                                <div className="admin-panel__logTargetTitle">{targetRoom?.videoTitle || log.targetName || 'Без фильма'}</div>
                                <div className="admin-panel__logCardMeta">Комната {log.targetId}{targetRoom ? ` · ${targetRoom.usersCount} участ.` : ' · уже закрыта'}</div>
                              </div>
                            </div>
                          )}

                          {targetIsSource && (
                            <div className="admin-panel__logTargetRoom">
                              {targetSource?.posterPath ? (
                                <img src={getPosterUrl(targetSource.posterPath, 'w185')} alt={targetSource.title} className="admin-panel__logTargetPoster" />
                              ) : (
                                <div className="admin-panel__logTargetPoster admin-panel__logTargetPoster--placeholder">🎞</div>
                              )}
                              <div>
                                <div className="admin-panel__logTargetTitle">{targetSource?.title || log.targetName || `TMDB #${log.targetId}`}</div>
                                <div className="admin-panel__logCardMeta">tmdb: {log.targetId}{targetSource ? ` · ${targetSource.sourceType.toUpperCase()}` : ''}</div>
                              </div>
                            </div>
                          )}
                        </div>

                        {log.details && (
                          <div className="admin-panel__logCardDetails">{log.details}</div>
                        )}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        )}

        {activeTab === 'video_sources' && (
          <div className="admin-panel__movies">
            <div className="admin-panel__statsRow">
              <div className="admin-panel__statCard">
                <div className="admin-panel__statLabel">Загружено фильмов</div>
                <div className="admin-panel__statValue">{tmdbMovies.length.toLocaleString('ru-RU')}</div>
                <div className="admin-panel__statHint">лучшие фильмы по версии TMDB</div>
              </div>
              <div className="admin-panel__statCard admin-panel__statCard--success">
                <div className="admin-panel__statLabel">С источником</div>
                <div className="admin-panel__statValue">{savedSources.length}</div>
                <div className="admin-panel__statHint">сохранено в базе</div>
              </div>
              <div className="admin-panel__statCard admin-panel__statCard--warning">
                <div className="admin-panel__statLabel">Без источника</div>
                <div className="admin-panel__statValue">{tmdbMovies.filter(m => !savedSourceMap.has(String(m.id))).length.toLocaleString('ru-RU')}</div>
                <div className="admin-panel__statHint">из загруженных</div>
              </div>
            </div>
            <div className="admin-panel__moviesToolbar">
              <div className="admin-panel__searchWrap admin-panel__searchWrap--inline">
                <svg className="admin-panel__searchIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                <input
                  type="text"
                  className="admin-panel__search"
                  placeholder="Поиск фильма по названию..."
                  value={movieSearch}
                  onChange={event => setMovieSearch(event.target.value)}
                />
              </div>
              <div className="admin-panel__movieFilters">
                {([
                  { key: 'all', label: 'Все' },
                  { key: 'with', label: `С источником (${savedSources.length})` },
                  { key: 'without', label: `Без источника (${tmdbMovies.filter(m => !savedSourceMap.has(String(m.id))).length})` }
                ] as { key: AdminMovieFilter; label: string }[]).map(item => (
                  <button
                    key={item.key}
                    type="button"
                    className={`admin-panel__movieFilter ${movieFilter === item.key ? 'admin-panel__movieFilter--active' : ''}`}
                    onClick={() => setMovieFilter(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {tmdbLoading ? (
              <div className="admin-panel__empty">Загрузка фильмов...</div>
            ) : (
              (() => {
                const search = movieSearch.trim().toLowerCase()
                let filtered: { id: number; title: string; poster_path?: string | null; release_date?: string }[]
                if (movieFilter === 'with') {
                  filtered = savedSources.map(source => ({
                    id: Number(source.tmdbId),
                    title: source.title || `tmdb: ${source.tmdbId}`,
                    poster_path: source.posterPath || null,
                    release_date: ''
                  }))
                  if (search) {
                    filtered = filtered.filter(movie => movie.title.toLowerCase().includes(search))
                  }
                } else {
                  filtered = tmdbMovies.filter(movie => {
                    const has = savedSourceMap.has(String(movie.id))
                    if (movieFilter === 'without') return !has
                    return true
                  })
                }

                if (filtered.length === 0) {
                  return <div className="admin-panel__empty">Фильмы не найдены</div>
                }

                return (
                  <>
                    <div className="admin-panel__movieGrid">
                      {filtered.map(movie => {
                        const mapped = savedSourceMap.get(String(movie.id))
                        return (
                          <button
                            key={movie.id}
                            type="button"
                            className={`admin-panel__movieCard ${mapped ? 'admin-panel__movieCard--mapped' : ''}`}
                            onClick={() => openMovieEditor(movie)}
                          >
                            <div className="admin-panel__movieCardPoster">
                              <img src={getPosterUrl(movie.poster_path ?? null, 'w342')} alt={movie.title} loading="lazy" />
                              {mapped ? (
                                <span className="admin-panel__movieBadge admin-panel__movieBadge--mapped">{mapped.sourceType.toUpperCase()}</span>
                              ) : (
                                <span className="admin-panel__movieBadge admin-panel__movieBadge--empty">Нет источника</span>
                              )}
                            </div>
                            <div className="admin-panel__movieCardBody">
                              <div className="admin-panel__movieCardTitle">{movie.title}</div>
                              <div className="admin-panel__movieCardMeta">{movie.release_date ? formatReleaseDate(movie.release_date) : '—'} · tmdb: {movie.id}</div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                    {tmdbLoadingMore && movieFilter !== 'with' && (
                      <div className="admin-panel__loadMoreWrap">
                        <span className="admin-panel__loadMoreHint">Подгружаем ещё фильмы…</span>
                      </div>
                    )}
                  </>
                )
              })()
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
          <div className="admin-panel__historyModal admin-panel__historyModal--wide" onClick={event => event.stopPropagation()}>
            <div className="admin-panel__historyHeader">
              <div className="admin-panel__historyHeaderUser">
                {historyTarget.avatar ? (
                  <img src={historyTarget.avatar} alt={historyTarget.username} className="admin-panel__historyHeaderAvatar" />
                ) : (
                  <span className="admin-panel__historyHeaderAvatar admin-panel__historyHeaderAvatar--initials" style={{ background: historyTarget.color || '#3a3d4a' }}>
                    {historyTarget.username.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div>
                  <h2 className="admin-panel__modalTitle">История — {historyTarget.username}</h2>
                  <p className="admin-panel__modalText">Все сообщения пользователя · можно удалять</p>
                </div>
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
                    <div className="admin-panel__historyItemActions">
                      <button
                        type="button"
                        className="admin-panel__historyDeleteBtn"
                        onClick={() => { setDeleteMessageError(null); setDeleteMessageConfirm(item) }}
                        disabled={deletingMessageId === item.id}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                        <span>{deletingMessageId === item.id ? 'Удаление...' : 'Удалить сообщение'}</span>
                      </button>
                    </div>
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
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
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

      {deleteMessageConfirm && (
        <div
          className="admin-panel__modalOverlay admin-panel__modalOverlay--front admin-panel__modalOverlay--confirm"
          onClick={() => { if (deletingMessageId === null) { setDeleteMessageConfirm(null); setDeleteMessageError(null) } }}
        >
          <div className="admin-panel__modal admin-panel__confirmModal" onClick={event => event.stopPropagation()}>
            <button
              className="admin-panel__modalClose"
              onClick={() => { setDeleteMessageConfirm(null); setDeleteMessageError(null) }}
              aria-label="Закрыть"
              disabled={deletingMessageId !== null}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <h2 className="admin-panel__modalTitle">Удалить сообщение?</h2>
            <p className="admin-panel__modalText">
              Вы точно хотите удалить это сообщение? Оно также исчезнет из чата комнаты у всех участников.
            </p>
            {deleteMessageError && (
              <p className="admin-panel__modalText" style={{ color: '#ff7a8a' }}>{deleteMessageError}</p>
            )}
            <div className="admin-panel__modalActions">
              <button
                className="admin-panel__primaryBtn"
                onClick={() => { handleDeleteMessage(deleteMessageConfirm).catch(() => {}) }}
                disabled={deletingMessageId !== null}
              >
                {deletingMessageId !== null ? 'Удаление...' : 'Удалить'}
              </button>
              <button
                className="admin-panel__secondaryBtn"
                onClick={() => { setDeleteMessageConfirm(null); setDeleteMessageError(null) }}
                disabled={deletingMessageId !== null}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {movieDraft && (
        <div className="admin-panel__modalOverlay admin-panel__modalOverlay--front" onClick={closeMovieEditor}>
          <div className="admin-panel__modal admin-panel__movieModal" onClick={event => event.stopPropagation()}>
            <button className="admin-panel__modalClose" onClick={closeMovieEditor} aria-label="Закрыть">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <div className="admin-panel__movieModalHeader">
              {movieDraft.posterPath ? (
                <img src={getPosterUrl(movieDraft.posterPath, 'w185')} alt={movieDraft.title} className="admin-panel__movieModalPoster" />
              ) : (
                <div className="admin-panel__movieModalPoster admin-panel__movieCardPoster--placeholder">
                  <span>{(movieDraft.title || '?').slice(0, 1).toUpperCase()}</span>
                </div>
              )}
              <div className="admin-panel__movieModalHeaderText">
                <div className="admin-panel__historyTag">{movieDraft.isNew ? 'Новый источник' : 'Редактирование'}</div>
                <h2 className="admin-panel__modalTitle">{movieDraft.title || `TMDB #${movieDraft.tmdbId}`}</h2>
                <p className="admin-panel__modalText">{movieDraft.year || '—'} · tmdb: {movieDraft.tmdbId}{movieDraft.imdbId ? ` · ${movieDraft.imdbId}` : ''}</p>
              </div>
            </div>

            <div className="admin-panel__movieFormGrid">
              <label className="admin-panel__field">
                <span>Тип источника</span>
                <select
                  value={movieDraft.sourceType}
                  onChange={event => setMovieDraft(prev => prev ? { ...prev, sourceType: event.target.value as VideoSourceType } : prev)}
                >
                  <option value="rutube">RuTube</option>
                  <option value="vkvideo">VK Video</option>
                  <option value="youtube">YouTube</option>
                  <option value="embed">Embed (VidSrc)</option>
                  <option value="html5">HTML5 (mp4)</option>
                </select>
              </label>

              <label className="admin-panel__field admin-panel__field--wide">
                <span>Ссылка на источник</span>
                <input
                  type="url"
                  placeholder="https://rutube.ru/video/..."
                  value={movieDraft.sourceUrl}
                  onChange={event => setMovieDraft(prev => prev ? { ...prev, sourceUrl: event.target.value } : prev)}
                />
              </label>

              <label className="admin-panel__field">
                <span>IMDb ID</span>
                <input
                  type="text"
                  placeholder="tt0133093"
                  value={movieDraft.imdbId}
                  onChange={event => setMovieDraft(prev => prev ? { ...prev, imdbId: event.target.value } : prev)}
                />
              </label>

              <label className="admin-panel__field">
                <span>Язык озвучки</span>
                <input
                  type="text"
                  value={movieDraft.dubLanguage}
                  onChange={event => setMovieDraft(prev => prev ? { ...prev, dubLanguage: event.target.value } : prev)}
                />
              </label>

              <label className="admin-panel__field">
                <span>Тип озвучки</span>
                <input
                  type="text"
                  value={movieDraft.dubType}
                  onChange={event => setMovieDraft(prev => prev ? { ...prev, dubType: event.target.value } : prev)}
                />
              </label>

              <label className="admin-panel__field admin-panel__field--wide">
                <span>Название</span>
                <input
                  type="text"
                  value={movieDraft.title}
                  onChange={event => setMovieDraft(prev => prev ? { ...prev, title: event.target.value } : prev)}
                />
              </label>
            </div>

            {movieDraftError && <div className="admin-panel__movieFormError">{movieDraftError}</div>}
            {movieDraftLoading && <div className="admin-panel__historyHint">Загрузка данных фильма...</div>}

            <div className="admin-panel__modalActions admin-panel__modalActions--split">
              {!movieDraft.isNew && (
                <button
                  type="button"
                  className="admin-panel__dangerBtn"
                  onClick={() => {
                    const saved = savedSourceMap.get(String(movieDraft.tmdbId))
                    if (saved) setConfirmDeleteSource(saved)
                  }}
                  disabled={movieDraftSaving}
                >
                  Удалить источник
                </button>
              )}
              <div className="admin-panel__modalActions">
                <button className="admin-panel__secondaryBtn" onClick={closeMovieEditor} disabled={movieDraftSaving}>
                  Отмена
                </button>
                <button
                  className="admin-panel__primaryBtn"
                  onClick={() => { submitMovieDraft().catch(() => {}) }}
                  disabled={movieDraftSaving || !movieDraft.sourceUrl.trim()}
                >
                  {movieDraftSaving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteSource && (
        <div className="admin-panel__modalOverlay admin-panel__modalOverlay--front admin-panel__modalOverlay--confirm" onClick={() => setConfirmDeleteSource(null)}>
          <div className="admin-panel__modal admin-panel__confirmModal" onClick={event => event.stopPropagation()}>
            <button className="admin-panel__modalClose" onClick={() => setConfirmDeleteSource(null)} aria-label="Закрыть">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <h2 className="admin-panel__modalTitle">Удалить источник</h2>
            <p className="admin-panel__modalText">
              Источник для «{confirmDeleteSource.title || `TMDB #${confirmDeleteSource.tmdbId}`}» будет удалён. Фильм снова начнёт использовать резервный VidSrc-эмбед.
            </p>
            <div className="admin-panel__modalActions">
              <button
                className="admin-panel__dangerBtn"
                onClick={() => { handleDeleteSource(confirmDeleteSource).catch(() => {}) }}
                disabled={actionPending === `source-${confirmDeleteSource.tmdbId}`}
              >
                Удалить
              </button>
              <button className="admin-panel__secondaryBtn" onClick={() => setConfirmDeleteSource(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
