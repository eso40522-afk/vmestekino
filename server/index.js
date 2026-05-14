import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { v4 as uuidv4 } from 'uuid'
import cors from 'cors'
import fetch from 'node-fetch'
import * as cheerio from 'cheerio'
import bcrypt from 'bcryptjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uploadsDir = path.join(__dirname, 'uploads')
const clientDistDir = path.resolve(__dirname, '../dist')
const clientIndexPath = path.join(clientDistDir, 'index.html')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
import {
  createUser, getUserById, getUserByEmail, updateUser,
  createSession, getSession, deleteSession, deleteUserSessions,
  getWatchedMovies, rateMovie, deleteWatchedMovie, getUserStats,
  getFavoriteMovies, getFavoriteMovieIds, addFavoriteMovie, removeFavoriteMovie,
  getUserGifs, addUserGif, deleteUserGif,
  getUserFavoriteGifs, addFavoriteGif, removeFavoriteGif,
  setUserRole, banUser, unbanUser, setUserTimeout, clearUserTimeout, getAdminUsers,
  getUserMessageHistory, getUserModerationState, logChatMessage, clearExpiredTimeouts,
  logAdminAction, getAdminAuditLogs
} from './database.js'

const app = express()
app.set('trust proxy', true)
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use('/uploads', express.static(uploadsDir))

const server = createServer(app)
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 5e6 // 5MB
})

const TMDB_API_KEY = process.env.TMDB_API_KEY || '2dca580c2a14b55200e784d157207b4d'
const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'
const EMBED_PROXY_ALLOWED_DOMAINS = ['vidsrc.me', 'vidsrc.net', 'vidsrc.xyz', 'vidsrc.to', 'vidsrc.vip']

const EMBED_BALANCERS = [
  {
    id: 'vidsrc-vip',
    name: 'VidSrc VIP',
    description: 'Основной плеер',
    buildUrl: imdbId => `https://vidsrc.vip/embed/movie/${imdbId}`
  },
  {
    id: 'moviesapi',
    name: 'MoviesAPI',
    description: 'Movies API плеер',
    buildUrl: imdbId => `https://moviesapi.club/movie/${imdbId}`
  },
  {
    id: 'smashystream',
    name: 'SmashyStream',
    description: 'Smashy плеер',
    buildUrl: imdbId => `https://embed.smashystream.com/playere.php?imdb=${imdbId}`
  },
  {
    id: '2embed',
    name: '2Embed',
    description: 'Резервный плеер',
    buildUrl: imdbId => `https://www.2embed.skin/embed/${imdbId}`
  },
  {
    id: 'vidlink',
    name: 'VidLink',
    description: 'VidLink плеер',
    buildUrl: imdbId => `https://vidlink.pro/movie/${imdbId}`
  }
]

// ==================== ХРАНИЛИЩЕ ====================

// Комнаты остаются в памяти (временные данные)
const rooms = new Map()
const ADMIN_EMAIL = 'adminkino2026@gmail.com'
const ADMIN_PASSWORD = 'adminkino2026@gmail.com'
const SUPPORT_EMAIL = 'tpkino2026@gmail.com'

function getModerationPayload(user) {
  clearExpiredTimeouts()

  const role = user?.role || 'user'
  const rawTimeoutUntil = user?.timeout_until ?? user?.timeoutUntil ?? null
  const timeoutUntil = rawTimeoutUntil && Number(rawTimeoutUntil) > Date.now()
    ? Number(rawTimeoutUntil)
    : null

  return {
    role,
    isBanned: Boolean(user?.is_banned ?? user?.isBanned),
    banReason: user?.ban_reason ?? user?.banReason ?? '',
    timeoutUntil,
    timeoutReason: user?.timeout_reason ?? user?.timeoutReason ?? ''
  }
}

function getPublicOrigin(req) {
  const forwardedProto = req?.headers?.['x-forwarded-proto']
  const protocol = req?.protocol
    || (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : '')
    || (req?.socket?.encrypted ? 'https' : 'http')

  const host = typeof req?.get === 'function'
    ? req.get('host')
    : req?.headers?.host

  return host ? `${protocol}://${host}` : LOCAL_API_ORIGIN
}

function normalizeMediaUrl(req, value) {
  if (!value || typeof value !== 'string') {
    return value || ''
  }

  return value.replace(/^https?:\/\/localhost:3001/i, getPublicOrigin(req))
}

function normalizeUserMedia(req, user) {
  return {
    ...user,
    avatar: normalizeMediaUrl(req, user?.avatar || ''),
    banner: normalizeMediaUrl(req, user?.banner || '')
  }
}

function normalizeMovieMedia(req, movie) {
  const posterPath = movie?.posterPath || ''

  const normalizedPosterPath = posterPath.startsWith('/') && !posterPath.startsWith('/api/') && !posterPath.startsWith('/uploads/')
    ? `${getPublicOrigin(req)}/api/tmdb/image?size=w342&path=${encodeURIComponent(posterPath)}`
    : normalizeMediaUrl(req, posterPath)

  return {
    ...movie,
    posterPath: normalizedPosterPath
  }
}

function normalizeGifMedia(req, gif) {
  return {
    ...gif,
    url: normalizeMediaUrl(req, gif?.url || '')
  }
}

function serializeAuthUser(req, user) {
  const normalizedUser = normalizeUserMedia(req, user)
  const moderation = getModerationPayload(user)

  return {
    id: normalizedUser.id,
    email: normalizedUser.email,
    username: normalizedUser.username,
    color: normalizedUser.color,
    initials: getInitials(normalizedUser.username),
    bio: normalizedUser.bio || '',
    avatar: normalizedUser.avatar || '',
    banner: normalizedUser.banner || '',
    createdAt: normalizedUser.created_at,
    ...moderation
  }
}

function getBanMessage() {
  return `Ваш аккаунт забанен. Если вы считаете, что это ошибка, свяжитесь с техподдержкой по адресу ${SUPPORT_EMAIL}.`
}

function getTimeoutBlockedMessage(timeoutUntil) {
  const seconds = Math.max(1, Math.ceil((Number(timeoutUntil) - Date.now()) / 1000))
  return { error: 'Чат временно недоступен', seconds }
}

function buildTmdbUrl(endpoint, params = {}) {
  const url = new URL(`${TMDB_BASE_URL}${endpoint}`)
  url.searchParams.set('api_key', TMDB_API_KEY)

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return
    }

    if (Array.isArray(value)) {
      value.forEach(item => url.searchParams.append(key, String(item)))
      return
    }

    url.searchParams.set(key, String(value))
  })

  return url
}

function normalizeImdbId(imdbId) {
  if (!imdbId || typeof imdbId !== 'string') {
    return ''
  }

  return imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`
}

function getEmbedBalancerById(id) {
  return EMBED_BALANCERS.find(balancer => balancer.id === id)
}

function buildEmbedSourceUrl(req, imdbId, balancerId) {
  const normalizedImdbId = normalizeImdbId(imdbId)
  const balancer = getEmbedBalancerById(balancerId) || EMBED_BALANCERS[0]
  const rawUrl = balancer.buildUrl(normalizedImdbId)

  try {
    const parsedUrl = new URL(rawUrl)
    if (EMBED_PROXY_ALLOWED_DOMAINS.some(domain => parsedUrl.hostname === domain || parsedUrl.hostname.endsWith(`.${domain}`))) {
      return `${getPublicOrigin(req)}/api/embed/proxy?url=${encodeURIComponent(rawUrl)}`
    }
  } catch {
    return rawUrl
  }

  return rawUrl
}

function getRequestSession(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  return token ? getSession(token) : null
}

function requireAdmin(req, res, next) {
  const session = getRequestSession(req)

  if (!session) {
    return res.status(401).json({ error: 'Не авторизован' })
  }

  if ((session.role || 'user') !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав' })
  }

  req.session = session
  next()
}

async function ensureAdminAccount() {
  const existingAdmin = getUserByEmail(ADMIN_EMAIL)

  if (!existingAdmin) {
    const adminId = uuidv4()
    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10)

    createUser({
      id: adminId,
      email: ADMIN_EMAIL,
      username: 'adminkino2026',
      password: hashedPassword,
      color: '#3b82f6'
    })

    setUserRole(adminId, 'admin')
    return
  }

  if ((existingAdmin.role || 'user') !== 'admin') {
    setUserRole(existingAdmin.id, 'admin')
  }
}

await ensureAdminAccount()

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

app.get('/api/tmdb', async (req, res) => {
  try {
    const { endpoint, ...params } = req.query

    if (!endpoint || typeof endpoint !== 'string' || !endpoint.startsWith('/')) {
      return res.status(400).json({ error: 'Некорректный endpoint TMDB' })
    }

    const tmdbUrl = buildTmdbUrl(endpoint, params)
    const response = await fetch(tmdbUrl)
    const data = await response.json()

    if (!response.ok) {
      return res.status(response.status).json(data)
    }

    res.set('Cache-Control', 'public, max-age=300')
    res.json(data)
  } catch (error) {
    console.error('❌ Ошибка TMDB proxy:', error)
    res.status(500).json({ error: 'Ошибка загрузки данных TMDB' })
  }
})

app.get('/api/tmdb/image', async (req, res) => {
  try {
    const { path: imagePath, size = 'w342' } = req.query

    if (!imagePath || typeof imagePath !== 'string' || !imagePath.startsWith('/')) {
      return res.status(400).json({ error: 'Некорректный путь изображения' })
    }

    const imageUrl = `${TMDB_IMAGE_BASE}/${size}${imagePath}`
    const response = await fetch(imageUrl)

    if (!response.ok) {
      return res.status(response.status).end()
    }

    const contentType = response.headers.get('content-type')
    if (contentType) {
      res.set('Content-Type', contentType)
    }
    res.set('Cache-Control', 'public, max-age=86400')

    const buffer = Buffer.from(await response.arrayBuffer())
    res.send(buffer)
  } catch (error) {
    console.error('❌ Ошибка TMDB image proxy:', error)
    res.status(500).json({ error: 'Ошибка загрузки изображения TMDB' })
  }
})

function generateRoomId() {
  // Генерируем короткий читаемый ID
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

function generateColor() {
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
    '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e'
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

function getInitials(username) {
  return username
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function getRoomState(req, roomId) {
  const room = rooms.get(roomId)
  if (!room) return null

  return {
    roomId,
    video: room.video,
    users: Array.from(room.users.values()).map(user => normalizeRoomUser(req, user)),
    messages: room.messages.slice(-50), // Последние 50 сообщений
    leaderId: room.leaderId || null,
    isPrivate: !!room.isPrivate,
    solo: !!room.solo
  }
}

function isCreatedRoom(room) {
  return Boolean(room?.creatorId)
}

function isRoomVisibleToUsers(room) {
  return Boolean(
    room &&
    isCreatedRoom(room) &&
    room.users.size > 0 &&
    room.video?.url &&
    !room.solo
  )
}

function isRoomVisibleToAdmin(room) {
  return Boolean(
    room &&
    isCreatedRoom(room) &&
    room.users.size > 0 &&
    room.video?.url &&
    !room.solo
  )
}

function buildHistoryLogEntry(username, text) {
  const trimmedText = String(text || '').trim()

  if (trimmedText.startsWith('GIF:')) {
    return {
      messageType: 'gif',
      text: trimmedText.slice(4)
    }
  }

  if (trimmedText.startsWith('MOVIE_SELECTED:')) {
    try {
      const payload = JSON.parse(trimmedText.slice('MOVIE_SELECTED:'.length))
      const title = typeof payload?.title === 'string' && payload.title.trim()
        ? ` "${payload.title.trim()}"`
        : ''

      return {
        messageType: 'movie',
        text: `${username} начал смотреть фильм${title}`
      }
    } catch {
      return {
        messageType: 'movie',
        text: `${username} начал смотреть фильм`
      }
    }
  }

  return {
    messageType: 'user',
    text: trimmedText
  }
}

function writeAdminAudit(req, { action, targetType, targetId, targetName, details }) {
  const admin = req.session
  if (!admin?.user_id) return

  logAdminAction({
    adminId: admin.user_id,
    adminUsername: admin.username || 'Администратор',
    action,
    targetType,
    targetId,
    targetName,
    details,
    createdAt: Date.now()
  })
}

function normalizeRoomUser(req, user) {
  return {
    id: user.id,
    username: user.username,
    color: user.color,
    initials: user.initials,
    avatar: normalizeMediaUrl(req, user.avatar || ''),
    role: user.role || 'user',
    isGuest: Boolean(user.isGuest),
    socketId: user.socketId,
    isBanned: Boolean(user.isBanned),
    timeoutUntil: user.timeoutUntil || null
  }
}

function normalizeRoomMessage(req, message) {
  const normalizedMessage = {
    ...message,
    avatar: normalizeMediaUrl(req, message.avatar || '')
  }

  if (typeof normalizedMessage.text === 'string' && normalizedMessage.text.startsWith('GIF:')) {
    return {
      ...normalizedMessage,
      text: `GIF:${normalizeMediaUrl(req, normalizedMessage.text.slice(4))}`
    }
  }

  return normalizedMessage
}

function reassignRoomAfterUserRemoval(roomId, removedSocketId, removedUserId) {
  const room = rooms.get(roomId)
  if (!room) return { deleted: true }

  if (room.leaderId === removedSocketId) {
    const nextLeaderSocketId = room.users.size > 0 ? room.users.keys().next().value : null
    room.leaderId = nextLeaderSocketId || null
    if (nextLeaderSocketId) {
      io.to(roomId).emit('leader-changed', { leaderId: nextLeaderSocketId })
    }
  }

  if (room.creatorId === removedUserId) {
    const nextOwner = room.users.size > 0 ? room.users.values().next().value : null
    room.creatorId = nextOwner?.id || null
  }

  if (room.users.size === 0) {
    rooms.delete(roomId)
    console.log(`🗑️ Комната ${roomId} удалена`)
    return { deleted: true }
  }

  return { deleted: false }
}

function removeSocketFromRoom(socket, { immediateDeleteIfEmpty = false } = {}) {
  const roomId = socket.data?.currentRoom
  if (!roomId || !rooms.has(roomId)) return

  const room = rooms.get(roomId)
  const removedUserId = socket.data?.currentUserId || null

  room.users.delete(socket.id)

  const result = reassignRoomAfterUserRemoval(roomId, socket.id, removedUserId)

  socket.data.currentRoom = null

  if (!result.deleted) {
    socket.to(roomId).emit('user-left', {
      userId: removedUserId,
      users: Array.from(room.users.values()).map(user => normalizeRoomUser(socket.request, user))
    })
    return
  }
}

// ==================== REST API ====================

// Регистрация
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' })
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Некорректный формат email' })
    }

    // Проверяем, существует ли пользователь
    const existingUser = getUserByEmail(email)
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' })
    }

    const userId = uuidv4()
    const color = generateColor()
    const username = email.split('@')[0]

    // Хешируем пароль
    const hashedPassword = await bcrypt.hash(password, 10)

    // Сохраняем пользователя в БД
    createUser({
      id: userId,
      email,
      username,
      password: hashedPassword,
      color
    })

    // Создаём сессию в БД
    const token = uuidv4()
    createSession(token, userId)

    const user = getUserById(userId)

    res.json({
      token,
      user: serializeAuthUser(req, user)
    })
  } catch (err) {
    console.error('Ошибка регистрации:', err)
    res.status(500).json({ error: 'Ошибка сервера при регистрации' })
  }
})

// Вход
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' })
    }

    const user = getUserByEmail(email)

    if (!user) {
      return res.status(401).json({ error: 'Неверный email или пароль' })
    }

    if (user.is_banned) {
      return res.status(403).json({ error: getBanMessage() })
    }

    // Проверяем пароль
    const isValidPassword = await bcrypt.compare(password, user.password)
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Неверный email или пароль' })
    }

    const token = uuidv4()
    createSession(token, user.id)

    res.json({
      token,
      user: serializeAuthUser(req, user)
    })
  } catch (err) {
    console.error('Ошибка входа:', err)
    res.status(500).json({ error: 'Ошибка сервера при входе' })
  }
})

// Проверка сессии
app.get('/api/me', (req, res) => {
  const session = getRequestSession(req)
  if (!session) {
    return res.status(401).json({ error: 'Не авторизован' })
  }

  res.json({
    user: serializeAuthUser(req, {
      ...session,
      id: session.user_id,
      created_at: session.created_at
    })
  })
})

// Получить профиль пользователя
app.get('/api/profile/:userId', (req, res) => {
  const { userId } = req.params
  const user = getUserById(userId)

  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }

  const watchedMoviesList = getWatchedMovies(userId).map(movie => normalizeMovieMedia(req, movie))
  const favoriteMoviesList = getFavoriteMovies(userId).map(movie => normalizeMovieMedia(req, movie))
  const stats = getUserStats(userId)
  const normalizedUser = normalizeUserMedia(req, user)

  res.json({
    profile: {
      id: normalizedUser.id,
      username: normalizedUser.username,
      email: normalizedUser.email,
      color: normalizedUser.color,
      initials: getInitials(normalizedUser.username),
      bio: normalizedUser.bio || '',
      avatar: normalizedUser.avatar || '',
      banner: normalizedUser.banner || '',
      watchedMovies: watchedMoviesList,
      favoriteMovies: favoriteMoviesList,
      stats,
      createdAt: normalizedUser.created_at,
      ...getModerationPayload(user)
    }
  })
})

// Обновить профиль
app.put('/api/profile', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  const session = token ? getSession(token) : null
  if (!session) {
    return res.status(401).json({ error: 'Не авторизован' })
  }

  const { username, bio, avatar, banner } = req.body

  const updatedUser = updateUser(session.user_id, { username, bio, avatar, banner })

  if (!updatedUser) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }

  const watchedMoviesList = getWatchedMovies(session.user_id).map(movie => normalizeMovieMedia(req, movie))
  const normalizedUser = normalizeUserMedia(req, updatedUser)

  res.json({
    profile: {
      id: normalizedUser.id,
      username: normalizedUser.username,
      email: normalizedUser.email,
      color: normalizedUser.color,
      initials: getInitials(normalizedUser.username),
      bio: normalizedUser.bio,
      avatar: normalizedUser.avatar,
      banner: normalizedUser.banner,
      watchedMovies: watchedMoviesList,
      createdAt: normalizedUser.created_at,
      ...getModerationPayload(updatedUser)
    }
  })
})

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : ''
  const users = getAdminUsers(search).map(user => ({
    id: user.id,
    email: user.email,
    username: user.username,
    color: user.color,
    avatar: normalizeMediaUrl(req, user.avatar || ''),
    role: user.role || 'user',
    isBanned: Boolean(user.isBanned),
    banReason: user.banReason || '',
    timeoutUntil: user.timeoutUntil || null,
    timeoutReason: user.timeoutReason || '',
    createdAt: user.createdAt,
    status: user.isBanned ? 'banned' : (user.timeoutUntil ? 'timed_out' : 'active')
  }))

  res.json({
    users,
    roomsCount: Array.from(rooms.values()).filter(room => room.users.size > 0).length
  })
})

app.get('/api/admin/rooms', requireAdmin, (req, res) => {
  const roomList = []
  for (const [roomId, room] of rooms) {
    if (!isRoomVisibleToAdmin(room)) continue
    roomList.push({
      roomId,
      usersCount: room.users.size,
      isPrivate: !!room.isPrivate,
      solo: !!room.solo,
      createdAt: room.createdAt,
      videoTitle: room.video?.title || '',
      posterPath: room.video?.posterPath || null
    })
  }

  res.json({ rooms: roomList })
})

app.get('/api/admin/rooms/:roomId', requireAdmin, (req, res) => {
  const roomId = String(req.params.roomId || '').toUpperCase()
  const room = rooms.get(roomId)

  if (!room || !isRoomVisibleToAdmin(room)) {
    return res.status(404).json({ error: 'Комната не найдена' })
  }

  writeAdminAudit(req, {
    action: 'view_room',
    targetType: 'room',
    targetId: roomId,
    targetName: room.video?.title || roomId,
    details: `Просмотр комнаты ${roomId}`
  })

  res.json({
    room: {
      roomId,
      usersCount: room.users.size,
      isPrivate: !!room.isPrivate,
      solo: !!room.solo,
      createdAt: room.createdAt,
      videoTitle: room.video?.title || '',
      posterPath: room.video?.posterPath || null,
      users: Array.from(room.users.values()).map(user => normalizeRoomUser(req, user)),
      messages: room.messages.map(message => normalizeRoomMessage(req, message))
    }
  })
})

app.get('/api/admin/users/:userId/messages', requireAdmin, (req, res) => {
  const user = getUserById(req.params.userId)
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }

  const messages = getUserMessageHistory(req.params.userId).map(message => ({
    ...message,
    text: message.messageType === 'gif'
      ? normalizeMediaUrl(req, message.text.startsWith('GIF:') ? message.text.slice(4) : message.text)
      : message.text
  }))

  writeAdminAudit(req, {
    action: 'view_user_history',
    targetType: 'user',
    targetId: user.id,
    targetName: user.username,
    details: `Просмотр истории сообщений пользователя ${user.username}`
  })

  res.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      avatar: user.avatar || '',
      color: user.color
    },
    messages
  })
})

app.post('/api/admin/users/:userId/timeout', requireAdmin, (req, res) => {
  const targetUser = getUserById(req.params.userId)
  if (!targetUser) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }

  if ((targetUser.role || 'user') === 'admin') {
    return res.status(400).json({ error: 'Нельзя выдавать таймаут администратору' })
  }

  const durationMs = Number(req.body?.durationMs)
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return res.status(400).json({ error: 'Некорректная длительность таймаута' })
  }

  const timeoutUntil = Date.now() + durationMs
  const updatedUser = setUserTimeout(targetUser.id, timeoutUntil, 'Нарушение правил чата')
  const moderation = getModerationPayload(updatedUser)

  writeAdminAudit(req, {
    action: 'set_timeout',
    targetType: 'user',
    targetId: targetUser.id,
    targetName: targetUser.username,
    details: `Выдан таймаут на ${Math.ceil(durationMs / 60000)} мин.`
  })

  for (const socket of io.sockets.sockets.values()) {
    if (socket.data?.currentUserId === targetUser.id) {
      socket.emit('moderation-state', moderation)
    }
  }

  res.json({ user: serializeAuthUser(req, updatedUser) })
})

app.post('/api/admin/users/:userId/timeout/remove', requireAdmin, (req, res) => {
  const targetUser = getUserById(req.params.userId)
  if (!targetUser) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }

  if ((targetUser.role || 'user') === 'admin') {
    return res.status(400).json({ error: 'Нельзя снимать таймауты администратору' })
  }

  const updatedUser = clearUserTimeout(targetUser.id)
  const moderation = getModerationPayload(updatedUser)

  writeAdminAudit(req, {
    action: 'remove_timeout',
    targetType: 'user',
    targetId: targetUser.id,
    targetName: targetUser.username,
    details: 'Снят активный таймаут'
  })

  for (const socket of io.sockets.sockets.values()) {
    if (socket.data?.currentUserId === targetUser.id) {
      socket.emit('moderation-state', moderation)
    }
  }

  res.json({ user: serializeAuthUser(req, updatedUser) })
})

app.post('/api/admin/users/:userId/ban', requireAdmin, (req, res) => {
  const targetUser = getUserById(req.params.userId)
  if (!targetUser) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }

  if ((targetUser.role || 'user') === 'admin') {
    return res.status(400).json({ error: 'Нельзя забанить администратора' })
  }

  const updatedUser = banUser(targetUser.id, 'Неоднократные нарушения правил сайта')
  deleteUserSessions(targetUser.id)

  writeAdminAudit(req, {
    action: 'ban_user',
    targetType: 'user',
    targetId: targetUser.id,
    targetName: targetUser.username,
    details: 'Пользователь забанен'
  })

  for (const socket of io.sockets.sockets.values()) {
    if (socket.data?.currentUserId !== targetUser.id) continue

    removeSocketFromRoom(socket, { immediateDeleteIfEmpty: true })
    socket.leaveAll()

    socket.emit('account-banned', {
      message: 'Вы получили перманентную блокировку в связи с неоднократными нарушениями правил нашего сайта. Ваш аккаунт забанен. Если вы считаете, что это ошибка, свяжитесь с техподдержкой по адресу tpkino2026@gmail.com.'
    })
  }

  res.json({ user: serializeAuthUser(req, updatedUser) })
})

app.post('/api/admin/users/:userId/unban', requireAdmin, (req, res) => {
  const targetUser = getUserById(req.params.userId)
  if (!targetUser) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }

  if ((targetUser.role || 'user') === 'admin') {
    return res.status(400).json({ error: 'Нельзя разбанить администратора' })
  }

  const updatedUser = unbanUser(targetUser.id)
  writeAdminAudit(req, {
    action: 'unban_user',
    targetType: 'user',
    targetId: targetUser.id,
    targetName: targetUser.username,
    details: 'Пользователь разбанен'
  })
  res.json({ user: serializeAuthUser(req, updatedUser) })
})

app.get('/api/admin/logs', requireAdmin, (req, res) => {
  const logs = getAdminAuditLogs().map(log => ({
    ...log,
    createdAt: Number(log.createdAt)
  }))

  res.json({ logs })
})

// Добавить/обновить оценку фильма
app.post('/api/profile/rate-movie', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  const session = token ? getSession(token) : null
  if (!session) {
    return res.status(401).json({ error: 'Не авторизован' })
  }

  const { movieId, title, posterPath, year, rating } = req.body

  if (!movieId || !title || rating === undefined) {
    return res.status(400).json({ error: 'movieId, title и rating обязательны' })
  }

  const watchedMoviesList = rateMovie(session.user_id, { movieId, title, posterPath, year, rating }).map(movie => normalizeMovieMedia(req, movie))
  res.json({ watchedMovies: watchedMoviesList })
})

// Удалить фильм из просмотренных
app.delete('/api/profile/watched/:movieId', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  const session = token ? getSession(token) : null
  if (!session) {
    return res.status(401).json({ error: 'Не авторизован' })
  }

  const { movieId } = req.params
  const watchedMoviesList = deleteWatchedMovie(session.user_id, movieId).map(movie => normalizeMovieMedia(req, movie))
  res.json({ watchedMovies: watchedMoviesList })
})

// Получить статистику пользователя
app.get('/api/profile/:userId/stats', (req, res) => {
  const { userId } = req.params
  const user = getUserById(userId)

  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }

  const stats = getUserStats(userId)
  res.json({ stats })
})

// Выход
app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token) {
    deleteSession(token)
  }
  res.json({ success: true })
})

// ==================== ИЗБРАННЫЕ ====================

// Получить список избранных
app.get('/api/favorites', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const session = token ? getSession(token) : null
  if (!session) return res.status(401).json({ error: 'Не авторизован' })
  res.json({ favorites: getFavoriteMovies(session.user_id).map(movie => normalizeMovieMedia(req, movie)) })
})

// Получить ID избранных (для быстрой проверки)
app.get('/api/favorites/ids', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const session = token ? getSession(token) : null
  if (!session) return res.status(401).json({ error: 'Не авторизован' })
  res.json({ ids: getFavoriteMovieIds(session.user_id) })
})

// Добавить в избранное
app.post('/api/favorites', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const session = token ? getSession(token) : null
  if (!session) return res.status(401).json({ error: 'Не авторизован' })

  const { movieId, title, posterPath, year, voteAverage, genreNames } = req.body
  if (!movieId || !title) return res.status(400).json({ error: 'movieId и title обязательны' })

  const favorites = addFavoriteMovie(session.user_id, { movieId, title, posterPath, year, voteAverage, genreNames }).map(movie => normalizeMovieMedia(req, movie))
  res.json({ favorites })
})

// Удалить из избранного
app.delete('/api/favorites/:movieId', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const session = token ? getSession(token) : null
  if (!session) return res.status(401).json({ error: 'Не авторизован' })

  const favorites = removeFavoriteMovie(session.user_id, req.params.movieId).map(movie => normalizeMovieMedia(req, movie))
  res.json({ favorites })
})

// Создание комнаты
app.post('/api/rooms', (req, res) => {
  const { isPrivate, userId } = req.body || {}

  // Check if user already has a room
  if (userId) {
    for (const [existingRoomId, room] of rooms) {
      if (room.creatorId === userId) {
        return res.json({ roomId: existingRoomId, existing: true })
      }
    }
  }

  const roomId = generateRoomId()

  rooms.set(roomId, {
    users: new Map(),
    video: {
      url: null,
      movieId: null,
      currentTime: 0,
      isPlaying: false,
      playbackRate: 1
    },
    messages: [],
    leaderId: null,
    isPrivate: !!isPrivate,
    solo: false,
    creatorId: userId || null,
    createdAt: new Date()
  })

  res.json({ roomId })
})

// Список всех активных комнат
app.get('/api/rooms', (req, res) => {
  const roomList = []
  for (const [roomId, room] of rooms) {
    if (!isRoomVisibleToUsers(room)) continue
    const users = Array.from(room.users.values()).map(u => ({
      id: u.id,
      username: u.username,
      color: u.color,
      initials: u.initials,
      avatar: u.avatar || ''
    }))
    roomList.push({
      roomId,
      usersCount: room.users.size,
      users,
      isPrivate: !!room.isPrivate,
      video: room.video.url ? {
        title: room.video.title || null,
        posterPath: room.video.posterPath || null,
        year: room.video.year || null,
        movieId: room.video.movieId || null,
        isPlaying: room.video.isPlaying
      } : null,
      createdAt: room.createdAt
    })
  }
  res.json({ rooms: roomList })
})

// Проверка существования комнаты
app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params
  const room = rooms.get(roomId.toUpperCase())

  if (!room) {
    return res.status(404).json({ error: 'Комната не найдена' })
  }

  res.json({
    roomId: roomId.toUpperCase(),
    usersCount: room.users.size,
    hasVideo: !!room.video.url
  })
})

// ==================== GIF API ====================

// Tenor API key (замените на свой ключ)
const TENOR_API_KEY = 'AIzaSyA3bPwalKCe9JDhYGx1FYC2F_s4KS3lLI0'

// Поиск GIF через Tenor
app.get('/api/tenor/search', async (req, res) => {
  try {
    const { q, limit = 20, pos } = req.query
    if (!q) return res.status(400).json({ error: 'Параметр q обязателен' })
    
    let url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${TENOR_API_KEY}&client_key=uniscreen&limit=${limit}&media_filter=gif,tinygif&locale=ru_RU`
    if (pos) url += `&pos=${pos}`
    
    const response = await fetch(url)
    const data = await response.json()
    res.json(data)
  } catch (error) {
    console.error('❌ Ошибка Tenor search:', error)
    res.status(500).json({ error: 'Ошибка поиска GIF' })
  }
})

// Популярные GIF
app.get('/api/tenor/featured', async (req, res) => {
  try {
    const { limit = 20, pos } = req.query
    let url = `https://tenor.googleapis.com/v2/featured?key=${TENOR_API_KEY}&client_key=uniscreen&limit=${limit}&media_filter=gif,tinygif&locale=ru_RU`
    if (pos) url += `&pos=${pos}`
    
    const response = await fetch(url)
    const data = await response.json()
    res.json(data)
  } catch (error) {
    console.error('❌ Ошибка Tenor featured:', error)
    res.status(500).json({ error: 'Ошибка загрузки GIF' })
  }
})

// Категории Tenor
app.get('/api/tenor/categories', async (req, res) => {
  try {
    const url = `https://tenor.googleapis.com/v2/categories?key=${TENOR_API_KEY}&client_key=uniscreen&locale=ru_RU`
    const response = await fetch(url)
    const data = await response.json()
    res.json(data)
  } catch (error) {
    console.error('❌ Ошибка Tenor categories:', error)
    res.status(500).json({ error: 'Ошибка загрузки категорий' })
  }
})

// Загрузить GIF — сохраняет файл на диск и возвращает URL
app.post('/api/gifs/upload', async (req, res) => {
  try {
    const { sessionToken, gifUrl } = req.body
    if (!sessionToken || !gifUrl) return res.status(400).json({ error: 'Неверные данные' })
    
    const session = getSession(sessionToken)
    if (!session) return res.status(401).json({ error: 'Не авторизован' })

    let fileUrl = gifUrl

    // Если это base64, сохраняем как файл
    if (gifUrl.startsWith('data:image/')) {
      const matches = gifUrl.match(/^data:image\/(\w+);base64,(.+)$/)
      if (!matches) return res.status(400).json({ error: 'Невалидный формат' })
      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1]
      const buffer = Buffer.from(matches[2], 'base64')
      const fileName = `${uuidv4()}.${ext}`
      const filePath = path.join(uploadsDir, fileName)
      fs.writeFileSync(filePath, buffer)
      fileUrl = `${req.protocol}://${req.get('host')}/uploads/${fileName}`
      console.log(`📁 GIF сохранён: ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)`)
    }

    const gifs = addUserGif(session.user_id, fileUrl).map(gif => normalizeGifMedia(req, gif))
    res.json({ gifs, url: normalizeMediaUrl(req, fileUrl) })
  } catch (error) {
    console.error('❌ Ошибка загрузки GIF:', error)
    res.status(500).json({ error: 'Ошибка загрузки' })
  }
})

// Сохранить GIF в последние (при отправке в чат)
app.post('/api/gifs/recent', async (req, res) => {
  try {
    const { sessionToken, gifUrl } = req.body
    if (!sessionToken || !gifUrl) return res.status(400).json({ error: 'Неверные данные' })
    
    const session = getSession(sessionToken)
    if (!session) return res.status(401).json({ error: 'Не авторизован' })
    
    const gifs = addUserGif(session.user_id, gifUrl).map(gif => normalizeGifMedia(req, gif))
    res.json({ gifs })
  } catch (error) {
    console.error('❌ Ошибка сохранения GIF в последние:', error)
    res.status(500).json({ error: 'Ошибка' })
  }
})

// Получить GIF пользователя
app.get('/api/gifs/user', async (req, res) => {
  try {
    const { sessionToken } = req.query
    if (!sessionToken) return res.status(400).json({ error: 'Нет токена' })
    
    const session = getSession(sessionToken)
    if (!session) return res.status(401).json({ error: 'Не авторизован' })
    
    const gifs = getUserGifs(session.user_id).map(gif => normalizeGifMedia(req, gif))
    res.json({ gifs })
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' })
  }
})

// Удалить GIF
app.delete('/api/gifs/:gifId', async (req, res) => {
  try {
    const { gifId } = req.params
    const { sessionToken } = req.query
    if (!sessionToken) return res.status(400).json({ error: 'Нет токена' })
    
    const session = getSession(sessionToken)
    if (!session) return res.status(401).json({ error: 'Не авторизован' })
    
    const gifs = deleteUserGif(session.user_id, parseInt(gifId)).map(gif => normalizeGifMedia(req, gif))
    res.json({ gifs })
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' })
  }
})

// Добавить в избранное
app.post('/api/gifs/favorite', async (req, res) => {
  try {
    const { sessionToken, gifUrl } = req.body
    if (!sessionToken || !gifUrl) return res.status(400).json({ error: 'Неверные данные' })
    
    const session = getSession(sessionToken)
    if (!session) return res.status(401).json({ error: 'Не авторизован' })
    
    const gifs = addFavoriteGif(session.user_id, gifUrl).map(gif => normalizeGifMedia(req, gif))
    res.json({ gifs })
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' })
  }
})

// Удалить из избранного (через POST вместо DELETE для поддержки длинных URL)
app.post('/api/gifs/favorite/remove', async (req, res) => {
  try {
    const { sessionToken, gifUrl } = req.body
    if (!sessionToken || !gifUrl) return res.status(400).json({ error: 'Неверные данные' })
    
    const session = getSession(sessionToken)
    if (!session) return res.status(401).json({ error: 'Не авторизован' })
    
    const gifs = removeFavoriteGif(session.user_id, gifUrl).map(gif => normalizeGifMedia(req, gif))
    res.json({ gifs })
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' })
  }
})

// Удалить из избранного (старый DELETE для совместимости)
app.delete('/api/gifs/favorite', async (req, res) => {
  try {
    const { sessionToken, gifUrl } = req.query
    if (!sessionToken || !gifUrl) return res.status(400).json({ error: 'Неверные данные' })
    
    const session = getSession(sessionToken)
    if (!session) return res.status(401).json({ error: 'Не авторизован' })
    
    const gifs = removeFavoriteGif(session.user_id, decodeURIComponent(gifUrl)).map(gif => normalizeGifMedia(req, gif))
    res.json({ gifs })
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' })
  }
})

// Получить избранные GIF
app.get('/api/gifs/favorites', async (req, res) => {
  try {
    const { sessionToken } = req.query
    if (!sessionToken) return res.status(400).json({ error: 'Нет токена' })
    
    const session = getSession(sessionToken)
    if (!session) return res.status(401).json({ error: 'Не авторизован' })
    
    const gifs = getUserFavoriteGifs(session.user_id)
    res.json({ gifs })
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' })
  }
})

// ==================== VIDEO PROXY API ====================

// Функция для поиска видео по IMDB ID через различные источники
async function findVideoEmbed(imdbId) {
  const cleanImdbId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`
  
  // Список источников для проверки
  const sources = [
    {
      name: 'VidSrc.me',
      url: `https://vidsrc.me/embed/movie/${cleanImdbId}`,
      check: async (url) => {
        try {
          const res = await fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 5000 
          })
          return res.ok ? url : null
        } catch { return null }
      }
    },
    {
      name: 'VidSrc.net',
      url: `https://vidsrc.net/embed/movie/${cleanImdbId}`,
      check: async (url) => {
        try {
          const res = await fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 5000 
          })
          return res.ok ? url : null
        } catch { return null }
      }
    },
    {
      name: '2Embed',
      url: `https://www.2embed.cc/embed/${cleanImdbId}`,
      check: async (url) => {
        try {
          const res = await fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 5000 
          })
          return res.ok ? url : null
        } catch { return null }
      }
    }
  ]

  // Проверяем все источники параллельно
  const results = await Promise.all(
    sources.map(async (source) => {
      const embedUrl = await source.check(source.url)
      return embedUrl ? { name: source.name, url: embedUrl } : null
    })
  )

  // Возвращаем все рабочие источники
  return results.filter(r => r !== null)
}

// API для поиска видео
app.get('/api/video/find/:imdbId', async (req, res) => {
  try {
    const { imdbId } = req.params
    console.log(`🔍 Поиск видео для IMDB: ${imdbId}`)
    
    const sources = await findVideoEmbed(imdbId)
    
    if (sources.length === 0) {
      return res.status(404).json({ 
        error: 'Видео не найдено',
        imdbId 
      })
    }

    console.log(`✅ Найдено ${sources.length} источников для ${imdbId}`)
    
    res.json({
      imdbId,
      sources,
      recommended: sources[0] // Первый рабочий источник
    })
  } catch (error) {
    console.error('❌ Ошибка поиска видео:', error)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

app.get('/api/embed/balancers', (req, res) => {
  res.json({
    balancers: EMBED_BALANCERS.map(({ id, name, description }) => ({ id, name, description }))
  })
})

app.get('/api/embed/source', (req, res) => {
  const { imdbId, balancerId } = req.query

  if (!imdbId || typeof imdbId !== 'string') {
    return res.status(400).json({ error: 'IMDB ID обязателен' })
  }

  const sourceUrl = buildEmbedSourceUrl(req, imdbId, typeof balancerId === 'string' ? balancerId : undefined)

  if (req.query.format === 'json') {
    return res.json({ url: sourceUrl })
  }

  res.redirect(sourceUrl)
})

// Прокси для проверки доступности URL
app.get('/api/video/check', async (req, res) => {
  try {
    const { url } = req.query
    if (!url) {
      return res.status(400).json({ error: 'URL не указан' })
    }

    const response = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 5000
    })

    res.json({ 
      available: response.ok,
      status: response.status 
    })
  } catch (error) {
    res.json({ available: false, error: error.message })
  }
})

// ==================== EMBED PROXY (без рекламы) ====================

// Прокси для vidsrc — загружает HTML, вырезает рекламу, отдаёт чистую страницу
app.get('/api/embed/proxy', async (req, res) => {
  try {
    const { url } = req.query
    if (!url) {
      return res.status(400).json({ error: 'URL не указан' })
    }

    // Разрешаем только vidsrc домены
    let urlObj
    try { urlObj = new URL(url) } catch { return res.status(400).json({ error: 'Невалидный URL' }) }
    if (!EMBED_PROXY_ALLOWED_DOMAINS.some(d => urlObj.hostname === d || urlObj.hostname.endsWith('.' + d))) {
      return res.status(403).json({ error: 'Домен не разрешён' })
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': urlObj.origin + '/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 10000
    })

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream: ${response.status}` })
    }

    let html = await response.text()

    // === Удаление рекламы ===
    const $ = cheerio.load(html)

    // Удаляем все скрипты с рекламными доменами
    const adDomains = [
      'popunder', 'popads', 'popcash', 'propellerads', 'juicyads',
      'exoclick', 'adsterra', 'trafficjunky', 'clickadu', 'hilltopads',
      'monetag', 'a-ads', 'admaven', 'roller-ads', 'onclicka',
      'pushprofit', 'pushground', 'disqus', 'mc.yandex', 'google-analytics',
      'googletagmanager', 'doubleclick', 'googlesyndication', 'adskeeper',
      'mgid', 'taboola', 'outbrain', 'revcontent'
    ]

    // Удаляем скрипты с рекламных доменов
    $('script[src]').each((_, el) => {
      const src = $(el).attr('src') || ''
      if (adDomains.some(ad => src.includes(ad))) {
        $(el).remove()
      }
    })

    // Удаляем inline-скрипты с window.open, popunder, рекламными паттернами
    $('script:not([src])').each((_, el) => {
      const code = $(el).html() || ''
      if (
        /window\.open\s*\(/i.test(code) ||
        /popunder|pop_under|clickunder/i.test(code) ||
        /onclick\s*=.*window/i.test(code) ||
        /document\.createElement\(['"]a['"]\).*click/i.test(code) ||
        /\/pop\.(js|min\.js)/i.test(code)
      ) {
        $(el).remove()
      }
    })

    // Удаляем элементы с рекламными классами/id
    $('[class*="ad-"], [class*="ads-"], [class*="banner"], [id*="ad-"], [id*="ads-"], [id*="banner"]').remove()
    $('iframe[src*="ads"], iframe[src*="banner"], iframe[src*="pop"]').remove()

    // Добавляем CSS для скрытия оставшейся рекламы и блокировку попапов
    // Добавляем base tag для правильного разрешения относительных URL
    $('head').prepend(`<base href="${urlObj.origin}/" />`)
    $('head').append(`
      <style>
        [onclick*="window.open"], .popunder, .pop-up, .ad-overlay, 
        div[class*="ad-"], div[id*="ad-"], div[class*="banner"],
        div[style*="z-index: 9999"], div[style*="z-index:9999"],
        a[target="_blank"][rel*="nofollow"] { display: none !important; }
      </style>
      <script>
        // Блокируем window.open (реклама)
        window.open = function() { return null; };
        // Блокируем навигацию родительской страницы
        try {
          if (window.top !== window.self) {
            Object.defineProperty(window, 'top', { get: function() { return window.self; } });
          }
          Object.defineProperty(window, 'parent', { get: function() { return window.self; } });
        } catch(e) {}
        // Перехватываем попытки изменить location
        var origLocation = window.location;
        try {
          window.addEventListener('beforeunload', function(e) { e.preventDefault(); e.returnValue = ''; });
        } catch(e) {}
        // Блокируем создание popup-элементов
        var origCreate = document.createElement.bind(document);
        document.createElement = function(tag) {
          var el = origCreate(tag);
          if (tag === 'a') {
            var origClick = el.click;
            el.click = function() {
              if (el.target === '_blank' && !el.closest('.player')) return;
              return origClick.apply(this, arguments);
            };
          }
          return el;
        };
      </script>
    `)

    // Заменяем относительные URL на абсолютные
    const baseUrl = urlObj.origin
    $('link[href^="/"]').each((_, el) => {
      $(el).attr('href', baseUrl + $(el).attr('href'))
    })
    $('script[src^="/"]').each((_, el) => {
      $(el).attr('src', baseUrl + $(el).attr('src'))
    })
    $('img[src^="/"]').each((_, el) => {
      $(el).attr('src', baseUrl + $(el).attr('src'))
    })

    html = $.html()

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.send(html)

    console.log(`🎬 Проксирован: ${url} (рекламы удалены)`)
  } catch (error) {
    console.error('❌ Embed proxy error:', error.message)
    res.status(500).json({ error: 'Ошибка проксирования' })
  }
})

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
  console.log('🔌 Пользователь подключился:', socket.id)

  let currentRoom = null
  let currentUser = null

  // Присоединение к комнате
  socket.on('join-room', ({ roomId, user }) => {
    roomId = roomId.toUpperCase()

    if (!rooms.has(roomId)) {
      socket.emit('room-not-found', { roomId })
      return
    }

    const room = rooms.get(roomId)

    // Гостевой пользователь если не авторизован
    currentUser = user || {
      id: socket.id,
      username: `Гость ${Math.floor(Math.random() * 1000)}`,
      color: generateColor(),
      isGuest: true
    }
    currentUser.initials = getInitials(currentUser.username)
    currentUser.socketId = socket.id

    // Подтягиваем аватар из БД (если зарегистрированный)
    const storedUser = getUserById(currentUser.id)
    if (storedUser) {
      const moderation = getModerationPayload(storedUser)
      currentUser = {
        ...currentUser,
        email: storedUser.email,
        username: storedUser.username,
        color: storedUser.color,
        initials: getInitials(storedUser.username),
        avatar: storedUser.avatar || '',
        role: moderation.role,
        isBanned: moderation.isBanned,
        banReason: moderation.banReason,
        timeoutUntil: moderation.timeoutUntil,
        timeoutReason: moderation.timeoutReason
      }
    }

    if (currentUser.isBanned) {
      socket.data.currentUserId = currentUser.id
      socket.emit('account-banned', {
        message: 'Вы получили перманентную блокировку в связи с неоднократными нарушениями правил нашего сайта. Ваш аккаунт забанен. Если вы считаете, что это ошибка, свяжитесь с техподдержкой по адресу tpkino2026@gmail.com.'
      })
      return
    }

    const isSoloRoomForUser = Boolean(
      room.solo &&
      currentUser.id !== room.creatorId &&
      !Array.from(room.users.values()).some(existingUser => existingUser.id === currentUser.id)
    )

    if (isSoloRoomForUser) {
      socket.emit('room-solo', { roomId })
      return
    }

    // Добавляем пользователя в комнату
    room.users.set(socket.id, currentUser)
    currentRoom = roomId
    socket.data.currentRoom = roomId
    socket.data.currentUserId = currentUser.id

    // Назначаем лидера если первый пользователь или лидер отсутствует
    if (!room.leaderId || !room.users.has(room.leaderId)) {
      room.leaderId = socket.id
    }

    // Присоединяемся к Socket.IO комнате
    socket.join(roomId)

    // Отправляем состояние комнаты новому пользователю
    socket.emit('room-state', getRoomState(socket.request, roomId))
    socket.emit('moderation-state', getModerationPayload(currentUser))

    // Уведомляем остальных о новом пользователе
    socket.to(roomId).emit('user-joined', {
      user: normalizeRoomUser(socket.request, currentUser),
      users: Array.from(room.users.values()).map(user => normalizeRoomUser(socket.request, user))
    })

    console.log(`👤 ${currentUser.username} вошёл в комнату ${roomId}`)
  })

  // Выбор видео
  socket.on('select-video', ({ url, movieId, title, imdbId, posterPath, year }) => {
    if (!currentRoom) return

    const room = rooms.get(currentRoom)
    if (!room) return

    room.video = {
      url,
      movieId,
      title,
      imdbId,
      posterPath,
      year,
      selectedBy: currentUser?.username,
      currentTime: 0,
      isPlaying: false,
      playbackRate: 1
    }
    
    // Не удаляем старые сообщения о фильмах - они остаются в истории

    io.to(currentRoom).emit('video-changed', room.video)

    // Не отправляем системное сообщение - карточка фильма будет показана через MOVIE_SELECTED
  })

  // Пометить комнату как solo (не показывать в списке) — только лидер
  socket.on('set-room-solo', (solo) => {
    if (!currentRoom) return
    const room = rooms.get(currentRoom)
    if (!room) return
    if (room.leaderId !== socket.id) return
    // Нельзя включить solo если в комнате больше 1 человека
    if (solo && room.users.size > 1) return
    room.solo = !!solo
    io.to(currentRoom).emit('solo-changed', !!solo)
  })

  // Синхронизация видео - play
  socket.on('video-play', ({ currentTime }) => {
    if (!currentRoom) return

    const room = rooms.get(currentRoom)
    if (!room) return

    room.video.isPlaying = true
    room.video.currentTime = currentTime

    socket.to(currentRoom).emit('video-sync', {
      action: 'play',
      currentTime,
      by: currentUser?.username
    })
  })

  // Синхронизация видео - pause
  socket.on('video-pause', ({ currentTime }) => {
    if (!currentRoom) return

    const room = rooms.get(currentRoom)
    if (!room) return

    room.video.isPlaying = false
    room.video.currentTime = currentTime

    socket.to(currentRoom).emit('video-sync', {
      action: 'pause',
      currentTime,
      by: currentUser?.username
    })
  })

  // Синхронизация видео - seek
  socket.on('video-seek', ({ currentTime }) => {
    if (!currentRoom) return

    const room = rooms.get(currentRoom)
    if (!room) return

    room.video.currentTime = currentTime

    socket.to(currentRoom).emit('video-sync', {
      action: 'seek',
      currentTime,
      by: currentUser?.username
    })
  })

  // Синхронизация - запрос текущего времени
  socket.on('request-sync', () => {
    if (!currentRoom) return

    const room = rooms.get(currentRoom)
    if (!room) return

    socket.emit('video-sync', {
      action: 'sync',
      currentTime: room.video.currentTime,
      isPlaying: room.video.isPlaying
    })
  })

  // Обновление текущего времени пользователя (для отображения таймера)
  socket.on('user-time-update', ({ currentTime }) => {
    if (!currentRoom || !currentUser) return

    const room = rooms.get(currentRoom)
    if (!room) return

    // Сохраняем время в данных пользователя
    const user = room.users.get(socket.id)
    if (user) {
      user.currentTime = currentTime
    }

    // Собираем все времена и рассылаем
    const userTimes = {}
    for (const [, u] of room.users) {
      userTimes[u.id] = u.currentTime || 0
    }

    io.to(currentRoom).emit('user-times', userTimes)
  })

  // Чат
  socket.on('chat-message', ({ text }) => {
    console.log(`📨 Получено сообщение от ${currentUser?.username}: "${text?.substring(0, 50)}..."`)
    console.log(`   currentRoom: ${currentRoom}, currentUser: ${currentUser?.username}`)
    
    if (!currentRoom || !currentUser || !text.trim()) {
      console.log('⚠️ Сообщение отклонено: нет комнаты или пользователя')
      return
    }

    const moderation = currentUser.isGuest ? null : getUserModerationState(currentUser.id)
    if (moderation?.isBanned) {
      socket.emit('account-banned', {
        message: 'Вы получили перманентную блокировку в связи с неоднократными нарушениями правил нашего сайта. Ваш аккаунт забанен. Если вы считаете, что это ошибка, свяжитесь с техподдержкой по адресу tpkino2026@gmail.com.'
      })
      return
    }

    if (moderation?.timeoutUntil && Number(moderation.timeoutUntil) > Date.now()) {
      socket.emit('chat-timeout', getTimeoutBlockedMessage(moderation.timeoutUntil))
      socket.emit('moderation-state', getModerationPayload(moderation))
      return
    }

    const room = rooms.get(currentRoom)
    if (!room) {
      console.log('⚠️ Комната не найдена:', currentRoom)
      return
    }

    // Получаем аватар из БД
    const userData = getUserById(currentUser.id)
    const message = {
      id: uuidv4(),
      type: 'user',
      userId: currentUser.id,
      username: currentUser.username,
      color: currentUser.color,
      initials: currentUser.initials,
      avatar: userData?.avatar || '',
      text: text.trim(),
      timestamp: Date.now()
    }

    room.messages.push(message)
    if (!currentUser.isGuest) {
      const historyEntry = buildHistoryLogEntry(currentUser.username, text)
      logChatMessage({
        roomId: currentRoom,
        userId: currentUser.id,
        username: currentUser.username,
        messageType: historyEntry.messageType,
        text: historyEntry.text,
        createdAt: message.timestamp
      })
    }
    console.log(`✅ Сообщение сохранено, всего сообщений: ${room.messages.length}`)

    // Ограничиваем историю
    if (room.messages.length > 100) {
      room.messages = room.messages.slice(-100)
    }

    io.to(currentRoom).emit('chat-message', message)
    console.log(`📤 Сообщение отправлено в комнату ${currentRoom}`)
  })

  // Создание опроса
  socket.on('create-poll', ({ question, options, multiSelect }) => {
    if (!currentRoom || !currentUser || !question?.trim() || !options?.length) return

    const moderation = currentUser.isGuest ? null : getUserModerationState(currentUser.id)
    if (moderation?.isBanned) {
      socket.emit('account-banned', {
        message: 'Вы получили перманентную блокировку в связи с неоднократными нарушениями правил нашего сайта. Ваш аккаунт забанен. Если вы считаете, что это ошибка, свяжитесь с техподдержкой по адресу tpkino2026@gmail.com.'
      })
      return
    }

    if (moderation?.timeoutUntil && Number(moderation.timeoutUntil) > Date.now()) {
      socket.emit('chat-timeout', getTimeoutBlockedMessage(moderation.timeoutUntil))
      socket.emit('moderation-state', getModerationPayload(moderation))
      return
    }

    const room = rooms.get(currentRoom)
    if (!room) return

    const userData = getUserById(currentUser.id)
    const pollId = uuidv4()
    
    const pollMessage = {
      id: uuidv4(),
      type: 'poll',
      userId: currentUser.id,
      username: currentUser.username,
      color: currentUser.color,
      initials: currentUser.initials,
      avatar: userData?.avatar || '',
      text: '',
      timestamp: Date.now(),
      poll: {
        id: pollId,
        question: question.trim().slice(0, 300),
        options: options.map((opt, i) => ({
          id: i,
          text: opt.trim().slice(0, 100),
          votes: []
        })),
        multiSelect: !!multiSelect,
        totalVoters: 0
      }
    }

    room.messages.push(pollMessage)
    if (!currentUser.isGuest) {
      logChatMessage({
        roomId: currentRoom,
        userId: currentUser.id,
        username: currentUser.username,
        messageType: 'poll',
        text: JSON.stringify({
          question: question.trim().slice(0, 300),
          options: options.map(opt => opt.trim().slice(0, 100)).filter(Boolean),
          multiSelect: !!multiSelect
        }),
        createdAt: pollMessage.timestamp
      })
    }
    
    // Сохраняем опрос отдельно для быстрого доступа
    if (!room.polls) room.polls = new Map()
    room.polls.set(pollId, pollMessage.poll)

    io.to(currentRoom).emit('chat-message', pollMessage)
    console.log(`📊 Опрос создан: "${question}" от ${currentUser.username}`)
  })

  // Голосование
  socket.on('vote-poll', ({ pollId, optionId }) => {
    if (!currentRoom || !currentUser) return

    const room = rooms.get(currentRoom)
    if (!room || !room.polls) return

    const poll = room.polls.get(pollId)
    if (!poll) return

    const userId = currentUser.id

    if (poll.multiSelect) {
      // Мультивыбор: toggle конкретного варианта
      const option = poll.options.find(o => o.id === optionId)
      if (!option) return

      const voteIndex = option.votes.indexOf(userId)
      if (voteIndex >= 0) {
        option.votes.splice(voteIndex, 1)
      } else {
        option.votes.push(userId)
      }
    } else {
      // Одиночный выбор: убрать из всех, добавить в выбранный
      poll.options.forEach(o => {
        const idx = o.votes.indexOf(userId)
        if (idx >= 0) o.votes.splice(idx, 1)
      })
      const option = poll.options.find(o => o.id === optionId)
      if (option) option.votes.push(userId)
    }

    // Подсчёт уникальных голосующих
    const allVoters = new Set()
    poll.options.forEach(o => o.votes.forEach(v => allVoters.add(v)))
    poll.totalVoters = allVoters.size

    // Обновить сообщение-опрос в истории
    const msgIndex = room.messages.findIndex(m => m.poll?.id === pollId)
    if (msgIndex >= 0) {
      room.messages[msgIndex].poll = { ...poll }
    }

    io.to(currentRoom).emit('poll-update', { pollId, poll: { ...poll } })
    console.log(`🗳️ ${currentUser.username} проголосовал в опросе "${poll.question}"`)
  })

  // Печатает...
  socket.on('typing', ({ isTyping }) => {
    if (!currentRoom || !currentUser) return

    const moderation = currentUser.isGuest ? null : getUserModerationState(currentUser.id)
    if (moderation?.isBanned || (moderation?.timeoutUntil && Number(moderation.timeoutUntil) > Date.now())) {
      return
    }

    socket.to(currentRoom).emit('user-typing', {
      userId: currentUser.id,
      username: currentUser.username,
      isTyping
    })
  })

  // Обновление имени пользователя
  socket.on('update-username', ({ username }) => {
    if (!currentRoom || !currentUser) return
    if (!username || username.length < 1 || username.length > 20) return

    const room = rooms.get(currentRoom)
    if (!room) return

    const oldUsername = currentUser.username
    const oldInitials = currentUser.initials
    currentUser.username = username.trim()
    currentUser.initials = getInitials(currentUser.username)

    // Обновляем в комнате
    room.users.set(socket.id, currentUser)

    // Обновляем имя во всех сообщениях этого пользователя
    room.messages.forEach(msg => {
      if (msg.userId === currentUser.id) {
        msg.username = currentUser.username
        msg.initials = currentUser.initials
      }
    })

    // Обновляем selectedBy в video если этот пользователь выбрал фильм
    if (room.video && room.video.selectedBy === oldUsername) {
      room.video.selectedBy = currentUser.username
    }

    // Уведомляем всех об обновлении (пользователи + сообщения + видео)
    io.to(currentRoom).emit('user-updated', {
      users: Array.from(room.users.values()).map(user => normalizeRoomUser(socket.request, user)),
      messages: room.messages.slice(-50),
      video: room.video
    })

    console.log(`📝 ${oldUsername} сменил имя на ${currentUser.username}`)
  })

  // ==================== SYNC START (для embed плееров) ====================

  // Отметить готовность к синхронному старту
  socket.on('sync-ready', ({ isReady }) => {
    if (!currentRoom || !currentUser) return

    const room = rooms.get(currentRoom)
    if (!room) return

    // Инициализируем readyUsers если нет
    if (!room.readyUsers) room.readyUsers = new Set()

    if (isReady) {
      room.readyUsers.add(currentUser.id)
    } else {
      room.readyUsers.delete(currentUser.id)
    }

    // Отправляем обновление всем в комнате
    io.to(currentRoom).emit('sync-ready-update', {
      readyUsers: Array.from(room.readyUsers)
    })

    console.log(`✅ ${currentUser.username} ${isReady ? 'готов' : 'не готов'} к просмотру`)
  })

  // Запустить обратный отсчёт
  socket.on('sync-start-countdown', () => {
    if (!currentRoom || !currentUser) return

    const room = rooms.get(currentRoom)
    if (!room) return

    // Системное сообщение
    const message = {
      id: uuidv4(),
      type: 'system',
      text: `${currentUser.username} запустил синхронный старт!`,
      timestamp: Date.now()
    }
    room.messages.push(message)
    io.to(currentRoom).emit('chat-message', message)

    // Обратный отсчёт 3, 2, 1, GO!
    let countdown = 3
    io.to(currentRoom).emit('sync-countdown', { countdown })

    const countdownInterval = setInterval(() => {
      countdown--
      if (countdown > 0) {
        io.to(currentRoom).emit('sync-countdown', { countdown })
      } else {
        clearInterval(countdownInterval)
        // Отправляем сигнал старта
        io.to(currentRoom).emit('sync-start')
        // Сбрасываем готовность
        room.readyUsers = new Set()
        io.to(currentRoom).emit('sync-ready-update', { readyUsers: [] })

        // Системное сообщение
        const startMessage = {
          id: uuidv4(),
          type: 'system',
          text: '🎬 Нажмите Play!',
          timestamp: Date.now()
        }
        room.messages.push(startMessage)
        io.to(currentRoom).emit('chat-message', startMessage)
      }
    }, 1000)
  })

  // Кик пользователя (только лидер)
  socket.on('kick-user', ({ socketId }) => {
    if (!currentRoom) return
    const room = rooms.get(currentRoom)
    if (!room) return
    if (room.leaderId !== socket.id) return // только лидер может кикать

    const targetSocket = io.sockets.sockets.get(socketId)
    if (targetSocket) {
      room.users.delete(socketId)
      targetSocket.emit('kicked')
      targetSocket.leave(currentRoom)

      io.to(currentRoom).emit('user-left', {
        userId: socketId,
        users: Array.from(room.users.values()).map(user => normalizeRoomUser(socket.request, user))
      })
    }
  })

  // Переключение приватности комнаты (только лидер)
  socket.on('toggle-privacy', ({ isPrivate }) => {
    if (!currentRoom) return
    const room = rooms.get(currentRoom)
    if (!room) return
    if (room.leaderId !== socket.id) return

    room.isPrivate = !!isPrivate
    io.to(currentRoom).emit('privacy-changed', { isPrivate: room.isPrivate })
  })

  // Переключение синхронизации (только лидер)
  socket.on('toggle-sync', ({ syncEnabled }) => {
    if (!currentRoom) return
    const room = rooms.get(currentRoom)
    if (!room) return
    if (room.leaderId !== socket.id) return

    io.to(currentRoom).emit('sync-toggled', { syncEnabled: !!syncEnabled })
  })

  // Передача лидерства другому пользователю
  socket.on('transfer-leader', ({ targetSocketId }) => {
    if (!currentRoom) return
    const room = rooms.get(currentRoom)
    if (!room) return
    if (room.leaderId !== socket.id) return // только текущий лидер
    if (!room.users.has(targetSocketId)) return // целевой пользователь должен быть в комнате

    room.leaderId = targetSocketId
    io.to(currentRoom).emit('leader-changed', { leaderId: targetSocketId })
  })

  // Отключение
  socket.on('disconnect', () => {
    console.log('🔌 Пользователь отключился:', socket.id)
    removeSocketFromRoom(socket)
  })
})

// ==================== СТАРТ СЕРВЕРА ====================

if (fs.existsSync(clientIndexPath)) {
  app.use(express.static(clientDistDir))
  app.get(/^(?!\/api|\/uploads|\/socket\.io).*/, (_req, res) => {
    res.sendFile(clientIndexPath)
  })
}

const PORT = process.env.PORT || 3001

server.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════════╗
  ║                                                ║
  ║   🎬 ВместеКино Server запущен!                ║
  ║                                                ║
  ║   HTTP:   http://localhost:${PORT}              ║
  ║   Socket: ws://localhost:${PORT}                ║
  ║                                                ║
  ╚════════════════════════════════════════════════╝
  `)
})
