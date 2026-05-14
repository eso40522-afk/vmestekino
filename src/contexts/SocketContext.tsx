import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuth, type User } from './AuthContext'
import { SOCKET_URL } from '../config/api'

// ==================== ТИПЫ ====================

export interface MovieCardData {
  movieId: number
  title: string
  posterPath: string | null
  year?: string
  imdbId?: string | null
}

export interface PollOption {
  id: number
  text: string
  votes: string[]
}

export interface PollData {
  id: string
  question: string
  options: PollOption[]
  multiSelect: boolean
  totalVoters: number
}

export interface ChatMessage {
  id: string
  type: 'user' | 'system' | 'movie' | 'poll'
  userId?: string
  username?: string
  color?: string
  initials?: string
  avatar?: string
  text: string
  timestamp: number
  movieCard?: MovieCardData
  poll?: PollData
}

export interface VideoState {
  url: string | null
  movieId: string | null
  title?: string
  imdbId?: string | null
  posterPath?: string | null
  year?: string
  selectedBy?: string
  currentTime: number
  isPlaying: boolean
  playbackRate: number
}

export interface RoomUser extends User {
  socketId?: string
}

export interface ModerationState {
  role: 'user' | 'admin'
  isBanned: boolean
  banReason: string
  timeoutUntil: number | null
  timeoutReason: string
}

interface RoomState {
  roomId: string
  video: VideoState
  users: RoomUser[]
  messages: ChatMessage[]
  leaderId: string | null
  isPrivate: boolean
  solo: boolean
}

interface SyncStartState {
  readyUsers: string[] // user IDs who are ready
  countdown: number | null // null = not counting, 0-3 = counting down
  isActive: boolean
}

interface SocketContextType {
  socket: Socket | null
  isConnected: boolean
  roomState: RoomState | null
  currentRoomId: string | null
  typingUsers: string[]
  syncStartState: SyncStartState
  userTimes: Record<string, number>
  moderationState: ModerationState
  joinRoom: (roomId: string) => void
  leaveRoom: () => void
  selectVideo: (url: string, movieId: string | null, title?: string, imdbId?: string | null, posterPath?: string | null, year?: string) => void
  sendPlay: (currentTime: number) => void
  sendPause: (currentTime: number) => void
  sendSeek: (currentTime: number) => void
  sendMessage: (text: string) => void
  setTyping: (isTyping: boolean) => void
  updateUsername: (username: string) => void
  createRoom: (isPrivate?: boolean) => Promise<string>
  kickUser: (socketId: string) => void
  togglePrivacy: (isPrivate: boolean) => void
  toggleSync: (syncEnabled: boolean) => void
  sendTimeUpdate: (currentTime: number) => void
  createPoll: (question: string, options: string[], multiSelect: boolean) => void
  votePoll: (pollId: string, optionId: number) => void
  // Sync start for embed players
  setReady: (isReady: boolean) => void
  startCountdown: () => void
  setRoomSolo: (solo: boolean) => void
  transferLeader: (targetSocketId: string) => void
}

// ==================== КОНТЕКСТ ====================

const SocketContext = createContext<SocketContextType | null>(null)

const defaultModerationState: ModerationState = {
  role: 'user',
  isBanned: false,
  banReason: '',
  timeoutUntil: null,
  timeoutReason: ''
}

// ==================== ПРОВАЙДЕР ====================

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user, syncUser } = useAuth()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null)
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [syncStartState, setSyncStartState] = useState<SyncStartState>({
    readyUsers: [],
    countdown: null,
    isActive: false
  })
  const [userTimes, setUserTimes] = useState<Record<string, number>>({})
  const [moderationState, setModerationState] = useState<ModerationState>(defaultModerationState)
  const typingTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const userRef = useRef(user)
  const syncUserRef = useRef(syncUser)

  useEffect(() => {
    userRef.current = user
    syncUserRef.current = syncUser
  }, [user, syncUser])

  // Подключение к серверу
  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      autoConnect: true,
      transports: ['websocket', 'polling']
    })

    newSocket.on('connect', () => {
      console.log('🔌 Подключено к серверу')
      setIsConnected(true)
    })

    newSocket.on('disconnect', () => {
      console.log('🔌 Отключено от сервера')
      setIsConnected(false)
    })

    newSocket.on('moderation-state', (state: Partial<ModerationState>) => {
      const currentUser = userRef.current
      const nextState: ModerationState = {
        role: (state.role || currentUser?.role || 'user') as 'user' | 'admin',
        isBanned: Boolean(state.isBanned),
        banReason: state.banReason || '',
        timeoutUntil: state.timeoutUntil || null,
        timeoutReason: state.timeoutReason || ''
      }

      setModerationState(nextState)
      if (currentUser && !currentUser.isGuest) {
        syncUserRef.current(nextState)
      }
    })

    newSocket.on('chat-timeout', ({ seconds }: { seconds?: number }) => {
      if (!seconds) return
      const currentUser = userRef.current

      const nextState: ModerationState = {
        role: (currentUser?.role || 'user') as 'user' | 'admin',
        isBanned: false,
        banReason: '',
        timeoutUntil: Date.now() + seconds * 1000,
        timeoutReason: 'Нарушение правил чата'
      }

      setModerationState(nextState)
      if (currentUser && !currentUser.isGuest) {
        syncUserRef.current(nextState)
      }
    })

    newSocket.on('account-banned', ({ message }: { message: string }) => {
      const currentUser = userRef.current
      const nextState: ModerationState = {
        role: (currentUser?.role || 'user') as 'user' | 'admin',
        isBanned: true,
        banReason: message,
        timeoutUntil: null,
        timeoutReason: ''
      }

      setModerationState(nextState)
      if (currentUser && !currentUser.isGuest) {
        syncUserRef.current(nextState)
      }
    })

    // Состояние комнаты при входе
    newSocket.on('room-state', (state: RoomState) => {
      console.log('📦 Получено состояние комнаты:', state)
      setRoomState(state)
      setCurrentRoomId(state.roomId)
    })

    // Новый пользователь
    newSocket.on('user-joined', ({ user: newUser, users }) => {
      console.log('👤 Пользователь присоединился:', newUser)
      setRoomState(prev => prev ? { ...prev, users } : null)
    })

    // Пользователь ушёл
    newSocket.on('user-left', ({ users }) => {
      setRoomState(prev => prev ? { ...prev, users } : null)
    })

    // Кик пользователя
    newSocket.on('kicked', () => {
      setRoomState(null)
      window.location.href = '/rooms'
    })

    newSocket.on('room-not-found', () => {
      setRoomState(null)
      setCurrentRoomId(null)
      window.location.href = '/rooms'
    })

    newSocket.on('room-closed', () => {
      setRoomState(null)
      setCurrentRoomId(null)
      window.location.href = '/rooms?closed=1'
    })

    newSocket.on('room-solo', () => {
      setRoomState(null)
      setCurrentRoomId(null)
      window.location.href = '/rooms?solo=1'
    })

    // Смена лидера
    newSocket.on('leader-changed', ({ leaderId }: { leaderId: string }) => {
      setRoomState(prev => prev ? { ...prev, leaderId } : null)
    })

    // Смена приватности
    newSocket.on('privacy-changed', ({ isPrivate }: { isPrivate: boolean }) => {
      setRoomState(prev => prev ? { ...prev, isPrivate } : null)
    })

    // Смена режима solo
    newSocket.on('solo-changed', (solo: boolean) => {
      setRoomState(prev => prev ? { ...prev, solo } : null)
    })

    // Синхронизация переключена лидером
    newSocket.on('sync-toggled', ({ syncEnabled }: { syncEnabled: boolean }) => {
      // Dispatched as custom event so Room.tsx can react
      window.dispatchEvent(new CustomEvent('sync-toggled', { detail: { syncEnabled } }))
    })

    // Пользователь обновил имя - обновляем пользователей, сообщения и видео
    newSocket.on('user-updated', ({ users, messages, video }) => {
      setRoomState(prev => {
        if (!prev) return null
        return { 
          ...prev, 
          users,
          ...(messages && { messages }),
          ...(video && { video })
        }
      })
    })

    // Изменение видео
    newSocket.on('video-changed', (video: VideoState) => {
      console.log('🎬 Видео изменено:', video)
      setRoomState(prev => prev ? { ...prev, video } : null)
    })

    // Сообщение чата
    newSocket.on('chat-message', (message: ChatMessage) => {
      console.log('📩 Получено сообщение чата:', message)
      setRoomState(prev => {
        if (!prev) {
          console.log('⚠️ roomState = null, сообщение потеряно!')
          return null
        }
        console.log('✅ Добавляем сообщение в чат, всего:', prev.messages.length + 1)
        return {
          ...prev,
          messages: [...prev.messages, message].slice(-100)
        }
      })
    })

    // Кто-то печатает
    newSocket.on('user-typing', ({ userId, username, isTyping }) => {
      if (isTyping) {
        setTypingUsers(prev => {
          if (prev.includes(username)) return prev
          return [...prev, username]
        })

        // Автоматически убираем через 3 секунды
        const existingTimeout = typingTimeouts.current.get(userId)
        if (existingTimeout) clearTimeout(existingTimeout)

        const timeout = setTimeout(() => {
          setTypingUsers(prev => prev.filter(u => u !== username))
          typingTimeouts.current.delete(userId)
        }, 3000)

        typingTimeouts.current.set(userId, timeout)
      } else {
        setTypingUsers(prev => prev.filter(u => u !== username))
        const existingTimeout = typingTimeouts.current.get(userId)
        if (existingTimeout) {
          clearTimeout(existingTimeout)
          typingTimeouts.current.delete(userId)
        }
      }
    })

    // Sync start events
    newSocket.on('sync-ready-update', ({ readyUsers }: { readyUsers: string[] }) => {
      setSyncStartState(prev => ({ ...prev, readyUsers }))
    })

    newSocket.on('sync-countdown', ({ countdown }: { countdown: number }) => {
      setSyncStartState(prev => ({ ...prev, countdown, isActive: countdown > 0 }))
    })

    newSocket.on('sync-start', () => {
      setSyncStartState({ readyUsers: [], countdown: null, isActive: false })
    })

    // Время пользователей
    newSocket.on('user-times', (times: Record<string, number>) => {
      setUserTimes(times)
    })

    // Обновление опроса
    newSocket.on('poll-update', ({ pollId, poll }: { pollId: string, poll: PollData }) => {
      setRoomState(prev => {
        if (!prev) return null
        return {
          ...prev,
          messages: prev.messages.map(m => 
            m.poll?.id === pollId ? { ...m, poll: { ...poll } } : m
          )
        }
      })
    })

    setSocket(newSocket)

    return () => {
      newSocket.close()
    }
  }, [])

  useEffect(() => {
    if (!user || user.isGuest) {
      setModerationState(defaultModerationState)
      return
    }

    setModerationState({
      role: (user.role || 'user') as 'user' | 'admin',
      isBanned: Boolean(user.isBanned),
      banReason: user.banReason || '',
      timeoutUntil: user.timeoutUntil || null,
      timeoutReason: user.timeoutReason || ''
    })
  }, [user])

  // Присоединение к комнате
  const joinRoom = useCallback((roomId: string) => {
    if (!socket) return
    socket.emit('join-room', { roomId, user })
  }, [socket, user])

  // Выход из комнаты
  const leaveRoom = useCallback(() => {
    setRoomState(null)
    setTypingUsers([])
    setUserTimes({})
  }, [])

  // Выбор видео
  const selectVideo = useCallback((url: string, movieId: string | null, title?: string, imdbId?: string | null, posterPath?: string | null, year?: string) => {
    if (!socket) return
    socket.emit('select-video', { url, movieId, title, imdbId, posterPath, year })
  }, [socket])

  // Воспроизведение
  const sendPlay = useCallback((currentTime: number) => {
    if (!socket) return
    socket.emit('video-play', { currentTime })
  }, [socket])

  // Пауза
  const sendPause = useCallback((currentTime: number) => {
    if (!socket) return
    socket.emit('video-pause', { currentTime })
  }, [socket])

  // Перемотка
  const sendSeek = useCallback((currentTime: number) => {
    if (!socket) return
    socket.emit('video-seek', { currentTime })
  }, [socket])

  // Отправка сообщения
  const sendMessage = useCallback((text: string) => {
    if (!socket || !text.trim()) {
      console.log('⚠️ Не могу отправить сообщение: socket=', !!socket, 'text=', text)
      return
    }
    if (moderationState.isBanned) return
    if (moderationState.timeoutUntil && moderationState.timeoutUntil > Date.now()) return
    console.log('📤 Отправляем через socket:', text.substring(0, 50))
    socket.emit('chat-message', { text })
  }, [socket, moderationState.isBanned, moderationState.timeoutUntil])

  // Индикатор печати
  const setTyping = useCallback((isTyping: boolean) => {
    if (!socket) return
    if (moderationState.isBanned) return
    if (moderationState.timeoutUntil && moderationState.timeoutUntil > Date.now()) return
    socket.emit('typing', { isTyping })
  }, [socket, moderationState.isBanned, moderationState.timeoutUntil])

  // Обновить имя пользователя
  const updateUsername = useCallback((username: string) => {
    if (!socket || !username.trim()) return
    socket.emit('update-username', { username: username.trim() })
  }, [socket])

  // Создание комнаты
  const createRoom = useCallback(async (isPrivate?: boolean): Promise<string> => {
    const res = await fetch(`${SOCKET_URL}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPrivate: !!isPrivate, userId: user?.id })
    })
    const data = await res.json()
    return data.roomId
  }, [user])

  // Кик пользователя
  const kickUser = useCallback((socketId: string) => {
    if (!socket) return
    socket.emit('kick-user', { socketId })
  }, [socket])

  // Переключение приватности
  const togglePrivacy = useCallback((isPrivate: boolean) => {
    if (!socket) return
    socket.emit('toggle-privacy', { isPrivate })
  }, [socket])

  // Переключение синхронизации (лидер)
  const toggleSync = useCallback((syncEnabled: boolean) => {
    if (!socket) return
    socket.emit('toggle-sync', { syncEnabled })
  }, [socket])

  // Sync start: отметить готовность
  const setReady = useCallback((isReady: boolean) => {
    if (!socket) return
    socket.emit('sync-ready', { isReady })
  }, [socket])

  // Sync start: запустить обратный отсчёт
  const startCountdown = useCallback(() => {
    if (!socket) return
    socket.emit('sync-start-countdown')
  }, [socket])

  // Пометить комнату как solo (не показывается в списке)
  const setRoomSolo = useCallback((solo: boolean) => {
    if (!socket) return
    socket.emit('set-room-solo', solo)
  }, [socket])

  const transferLeader = useCallback((targetSocketId: string) => {
    if (!socket) return
    socket.emit('transfer-leader', { targetSocketId })
  }, [socket])

  // Отправить текущее время плеера
  const sendTimeUpdate = useCallback((currentTime: number) => {
    if (!socket) return
    socket.emit('user-time-update', { currentTime })
  }, [socket])

  // Создать опрос
  const createPoll = useCallback((question: string, options: string[], multiSelect: boolean) => {
    if (!socket) return
    socket.emit('create-poll', { question, options, multiSelect })
  }, [socket])

  // Голосовать в опросе
  const votePoll = useCallback((pollId: string, optionId: number) => {
    if (!socket) return
    socket.emit('vote-poll', { pollId, optionId })
  }, [socket])

  return (
    <SocketContext.Provider value={{
      socket,
      isConnected,
      roomState,
      currentRoomId,
      typingUsers,
      syncStartState,
      userTimes,
      moderationState,
      joinRoom,
      leaveRoom,
      selectVideo,
      sendPlay,
      sendPause,
      sendSeek,
      sendMessage,
      setTyping,
      updateUsername,
      createRoom,
      kickUser,
      togglePrivacy,
      toggleSync,
      sendTimeUpdate,
      createPoll,
      votePoll,
      setReady,
      startCountdown,
      setRoomSolo,
      transferLeader
    }}>
      {children}
    </SocketContext.Provider>
  )
}

// ==================== ХУК ====================

export function useSocket() {
  const context = useContext(SocketContext)
  if (!context) {
    throw new Error('useSocket должен использоваться внутри SocketProvider')
  }
  return context
}
