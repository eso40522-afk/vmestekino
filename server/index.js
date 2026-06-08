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
  createUser, getUserById, getUserByEmail, getUserByHandle, updateUser,
  generateUniqueHandle, handleExists, sanitizeHandleSeed,
  createSession, getSession, deleteSession, deleteUserSessions,
  getWatchedMovies, rateMovie, deleteWatchedMovie, getUserStats,
  getFavoriteMovies, getFavoriteMovieIds, addFavoriteMovie, removeFavoriteMovie,
  getUserGifs, addUserGif, deleteUserGif,
  getUserFavoriteGifs, addFavoriteGif, removeFavoriteGif,
  setUserRole, banUser, unbanUser, setUserTimeout, clearUserTimeout, getAdminUsers,
  getUserMessageHistory, getUserModerationState, logChatMessage, clearExpiredTimeouts,
  deleteChatLogById,
  logAdminAction, getAdminAuditLogs,
  getVideoSource, upsertVideoSource, getAllVideoSources, deleteVideoSource,
  searchUsersForFriends, getFriendshipStatus, getFriendsForUser,
  getIncomingFriendRequests, getOutgoingFriendRequests,
  createFriendRequest, acceptFriendRequest, declineFriendRequest, removeFriendship,
  insertDirectMessage, getConversationMessages, markConversationRead,
  getTotalUnreadCount, getConversationSummaries,
  parseFavoriteGenres
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
const KINOPOISK_API_KEY = process.env.KINOPOISK_API_KEY || ''
const KINOPOISK_BASE_URL = 'https://kinopoiskapiunofficial.tech'
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
// Онлайн-присутствие: userId -> количество активных сокетов (учитываем
// несколько вкладок одного пользователя). Запись удаляется, когда счётчик 0.
const onlineUserSockets = new Map()

function addOnlineUser(userId) {
  if (!userId) return
  onlineUserSockets.set(userId, (onlineUserSockets.get(userId) || 0) + 1)
}

function removeOnlineUser(userId) {
  if (!userId) return
  const next = (onlineUserSockets.get(userId) || 0) - 1
  if (next <= 0) onlineUserSockets.delete(userId)
  else onlineUserSockets.set(userId, next)
}
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
    handle: normalizedUser.handle || '',
    username: normalizedUser.username,
    color: normalizedUser.color,
    initials: getInitials(normalizedUser.username),
    bio: normalizedUser.bio || '',
    avatar: normalizedUser.avatar || '',
    banner: normalizedUser.banner || '',
    favoriteGenres: parseFavoriteGenres(normalizedUser.favorite_genres),
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

function buildSvgPlaceholder(width, height, label) {
  const safeLabel = String(label || 'Image unavailable').replace(/[<>]/g, '')
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#111318"/><text x="50%" y="50%" fill="#d1d5db" font-family="Arial, sans-serif" font-size="20" text-anchor="middle" dominant-baseline="middle">${safeLabel}</text></svg>`
}

function getTmdbImageFallbackSizes(size) {
  if (size === 'original') {
    return ['w1280', 'w780', 'w500', 'w342', 'w185']
  }

  if (size === 'w1280' || size === 'w780') {
    return ['w780', 'w500', 'w342', 'w185']
  }

  if (size === 'w500' || size === 'w342') {
    return ['w342', 'w185']
  }

  return ['w185']
}

function getTmdbPlaceholderMeta(size) {
  if (size === 'original' || size === 'w1280' || size === 'w780') {
    return { width: 1280, height: 720, label: 'Backdrop unavailable' }
  }

  if (size === 'w500' || size === 'w342') {
    return { width: 342, height: 513, label: 'Poster unavailable' }
  }

  return { width: 185, height: 278, label: 'Photo unavailable' }
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
      color: '#3b82f6',
      handle: generateUniqueHandle('adminkino2026')
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

// ==================== Трейлеры через Kinopoisk Unofficial API ====================
// Возвращает массив трейлеров с их CDN (kinopoisk.ru / yandex). Не блокируется в РФ.
// Поиск идёт по IMDb ID (TMDB -> /movie/{id}/external_ids -> imdb_id),
// затем /api/v2.2/films/{kpId}/videos.
// Кэш в памяти на 6 часов, чтобы не выжигать дневной лимит ключа.
const trailerCache = new Map() // tmdbId -> { videos, expires }
const TRAILER_CACHE_TTL = 6 * 60 * 60 * 1000

async function fetchKinopoiskIdByImdb(imdbId) {
  if (!KINOPOISK_API_KEY || !imdbId) return null
  try {
    const url = `${KINOPOISK_BASE_URL}/api/v2.2/films?imdbId=${encodeURIComponent(imdbId)}`
    const response = await fetch(url, {
      headers: { 'X-API-KEY': KINOPOISK_API_KEY, 'Accept': 'application/json' }
    })
    if (!response.ok) return null
    const data = await response.json()
    const first = data?.items?.[0]
    return first?.kinopoiskId || first?.filmId || null
  } catch (err) {
    console.error('Kinopoisk lookup failed:', err.message)
    return null
  }
}

async function fetchKinopoiskTrailers(kpId) {
  if (!KINOPOISK_API_KEY || !kpId) return []
  try {
    const url = `${KINOPOISK_BASE_URL}/api/v2.2/films/${kpId}/videos`
    const response = await fetch(url, {
      headers: { 'X-API-KEY': KINOPOISK_API_KEY, 'Accept': 'application/json' }
    })
    if (!response.ok) return []
    const data = await response.json()
    const items = Array.isArray(data?.items) ? data.items : []
    // Отдаём только Kinopoisk/Yandex CDN (не YouTube), чтобы работало в РФ
    return items
      .filter(v => v.url && v.site && /KINOPOISK|YANDEX|YANDEX_DISK/i.test(v.site))
      .map(v => ({
        url: v.url,
        name: v.name || 'Трейлер',
        site: v.site
      }))
  } catch (err) {
    console.error('Kinopoisk trailers fetch failed:', err.message)
    return []
  }
}

app.get('/api/movie-trailers/:tmdbId', async (req, res) => {
  try {
    const tmdbId = Number(req.params.tmdbId)
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      return res.status(400).json({ error: 'Некорректный TMDB ID' })
    }

    // Кэш
    const cached = trailerCache.get(tmdbId)
    if (cached && cached.expires > Date.now()) {
      res.set('Cache-Control', 'public, max-age=3600')
      return res.json({ videos: cached.videos, source: 'cache' })
    }

    // 1. Получаем название фильма из TMDB (для поиска на RuTube)
    let movieTitle = null
    let movieYear = null
    let imdbId = null
    try {
      const [detailsRes, externalRes] = await Promise.all([
        fetch(buildTmdbUrl(`/movie/${tmdbId}`, { language: 'ru-RU' })),
        fetch(buildTmdbUrl(`/movie/${tmdbId}/external_ids`))
      ])
      if (detailsRes.ok) {
        const details = await detailsRes.json()
        movieTitle = details.title || details.original_title || null
        movieYear = details.release_date ? String(details.release_date).slice(0, 4) : null
      }
      if (externalRes.ok) {
        const ext = await externalRes.json()
        imdbId = ext.imdb_id || null
      }
    } catch (err) {
      console.error('TMDB lookup failed for trailers:', err.message)
    }

    const collected = []

    // 2. Поиск на RuTube (бесплатно, без ключа, не блокируется в РФ)
    if (movieTitle) {
      const rutubeVideos = await searchRutubeTrailers(movieTitle, movieYear)
      collected.push(...rutubeVideos)
    }

    // 3. Fallback: Кинопоиск (если есть ключ и IMDb ID, и RuTube ничего не дал)
    if (collected.length === 0 && KINOPOISK_API_KEY && imdbId) {
      const kpId = await fetchKinopoiskIdByImdb(imdbId)
      if (kpId) {
        const kpVideos = await fetchKinopoiskTrailers(kpId)
        collected.push(...kpVideos)
      }
    }

    trailerCache.set(tmdbId, { videos: collected, expires: Date.now() + TRAILER_CACHE_TTL })

    res.set('Cache-Control', 'public, max-age=3600')
    res.json({ videos: collected, source: collected.length > 0 ? collected[0].site : 'empty' })
  } catch (error) {
    console.error('❌ Ошибка получения трейлеров:', error)
    res.status(500).json({ error: 'Ошибка загрузки трейлеров', videos: [] })
  }
})

// Поиск трейлеров на RuTube через их открытый search API.
// Возвращает embed-URL'ы вида https://rutube.ru/play/embed/{id}
async function searchRutubeTrailers(title, year) {
  try {
    const query = year ? `${title} ${year} трейлер` : `${title} трейлер`
    const url = `https://rutube.ru/api/search/video/?query=${encodeURIComponent(query)}`
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    })
    if (!response.ok) return []
    const data = await response.json()
    const results = Array.isArray(data?.results) ? data.results : []
    // Фильтруем: длительность < 8 минут (трейлеры обычно 1–4 мин), название содержит "трейлер" или "trailer"
    const filtered = results
      .filter(v => {
        if (!v || !v.id) return false
        const dur = Number(v.duration) || 0
        if (dur > 480) return false // больше 8 минут — скорее всего не трейлер
        const name = String(v.title || '').toLowerCase()
        return name.includes('трейлер') || name.includes('trailer') || name.includes('тизер') || name.includes('teaser')
      })
      .slice(0, 5)
      .map(v => ({
        url: `https://rutube.ru/play/embed/${v.id}`,
        name: v.title || 'Трейлер',
        site: 'RUTUBE',
        thumbnail: v.thumbnail_url || null,
        duration: Number(v.duration) || 0
      }))
    return filtered
  } catch (err) {
    console.error('RuTube trailer search failed:', err.message)
    return []
  }
}

app.get('/api/tmdb/image', async (req, res) => {
  try {
    const { path: imagePath, size = 'w342' } = req.query

    if (!imagePath || typeof imagePath !== 'string' || !imagePath.startsWith('/')) {
      return res.status(400).json({ error: 'Некорректный путь изображения' })
    }

    const requestedSize = typeof size === 'string' ? size : 'w342'
    const candidateSizes = [requestedSize, ...getTmdbImageFallbackSizes(requestedSize)]
    const uniqueSizes = [...new Set(candidateSizes)]

    for (const candidateSize of uniqueSizes) {
      const imageUrl = `${TMDB_IMAGE_BASE}/${candidateSize}${imagePath}`
      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Referer': 'https://www.themoviedb.org/'
        },
        timeout: 10000
      })

      if (!response.ok) {
        continue
      }

      const contentType = response.headers.get('content-type')
      if (contentType) {
        res.set('Content-Type', contentType)
      }
      res.set('Cache-Control', 'public, max-age=86400')

      const buffer = Buffer.from(await response.arrayBuffer())
      return res.send(buffer)
    }

    const placeholder = getTmdbPlaceholderMeta(requestedSize)
    res.set('Content-Type', 'image/svg+xml; charset=utf-8')
    res.set('Cache-Control', 'public, max-age=3600')
    res.status(200).send(buildSvgPlaceholder(placeholder.width, placeholder.height, placeholder.label))
  } catch (error) {
    console.error('❌ Ошибка TMDB image proxy:', error)
    res.status(500).json({ error: 'Ошибка загрузки изображения TMDB' })
  }
})

// ==================== URL THUMBNAIL (RuTube / VK Video) ====================
// Возвращает превью (баннер) для произвольной ссылки на видео.
// Сейчас поддерживаются: RuTube oEmbed, VK Video oEmbed. Иначе — null.

const URL_THUMBNAIL_CACHE = new Map()
const URL_THUMBNAIL_TTL_MS = 60 * 60 * 1000 // 1 час

function extractRuTubeIdFromUrl(url) {
  const m = url.match(/rutube\.ru\/(?:video|play\/embed|shorts)\/([a-z0-9]+)/i)
  return m ? m[1] : null
}

function extractVkVideoIdsFromUrl(url) {
  // vkvideo.ru/video-123_456 или vk.com/video-123_456
  const m = url.match(/(?:vkvideo\.ru|vk\.com)\/(?:video|clip)(-?\d+)_(\d+)/i)
  return m ? { ownerId: m[1], videoId: m[2] } : null
}

async function fetchRutubeThumbnail(url) {
  const rid = extractRuTubeIdFromUrl(url)
  if (!rid) return null
  try {
    // RuTube открытый oEmbed
    const oembedUrl = `https://rutube.ru/api/oembed/?url=${encodeURIComponent(`https://rutube.ru/video/${rid}/`)}&format=json`
    const r = await fetch(oembedUrl, { timeout: 7000, headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (r.ok) {
      const data = await r.json()
      if (data && typeof data.thumbnail_url === 'string') {
        return { thumbnailUrl: data.thumbnail_url, title: typeof data.title === 'string' ? data.title : null, provider: 'rutube' }
      }
    }
    // Фолбэк: video info endpoint
    const infoUrl = `https://rutube.ru/api/video/${rid}/?format=json`
    const r2 = await fetch(infoUrl, { timeout: 7000, headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (r2.ok) {
      const data = await r2.json()
      if (data && typeof data.thumbnail_url === 'string') {
        return { thumbnailUrl: data.thumbnail_url, title: typeof data.title === 'string' ? data.title : null, provider: 'rutube' }
      }
    }
  } catch (err) {
    console.warn('rutube thumbnail fetch failed:', err.message)
  }
  return null
}

async function fetchVkThumbnail(url) {
  const ids = extractVkVideoIdsFromUrl(url)
  if (!ids) return null
  try {
    // VK oEmbed
    const oembedUrl = `https://vk.com/oembed?url=${encodeURIComponent(url)}`
    const r = await fetch(oembedUrl, { timeout: 7000, headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (r.ok) {
      const data = await r.json()
      if (data && typeof data.thumbnail_url === 'string') {
        return { thumbnailUrl: data.thumbnail_url, title: typeof data.title === 'string' ? data.title : null, provider: 'vk' }
      }
    }
  } catch (err) {
    console.warn('vk thumbnail fetch failed:', err.message)
  }
  return null
}

app.get('/api/url-thumbnail', async (req, res) => {
  try {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : ''
    if (!rawUrl) {
      return res.status(400).json({ error: 'Параметр url обязателен' })
    }
    // Базовая валидация
    let parsed
    try {
      parsed = new URL(rawUrl)
    } catch {
      return res.status(400).json({ error: 'Некорректный url' })
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Поддерживаются только http/https ссылки' })
    }

    const cacheKey = rawUrl
    const cached = URL_THUMBNAIL_CACHE.get(cacheKey)
    if (cached && Date.now() - cached.at < URL_THUMBNAIL_TTL_MS) {
      return res.json(cached.data)
    }

    let result = null
    const host = parsed.hostname.toLowerCase()
    if (host.includes('rutube')) {
      result = await fetchRutubeThumbnail(rawUrl)
    } else if (host.includes('vkvideo') || host.includes('vk.com') || host.includes('vk.ru')) {
      result = await fetchVkThumbnail(rawUrl)
    }

    const payload = result
      ? { ok: true, thumbnailUrl: result.thumbnailUrl, title: result.title, provider: result.provider }
      : { ok: false, thumbnailUrl: null, title: null, provider: null }

    URL_THUMBNAIL_CACHE.set(cacheKey, { at: Date.now(), data: payload })
    res.set('Cache-Control', 'public, max-age=600')
    res.json(payload)
  } catch (error) {
    console.error('❌ Ошибка url-thumbnail:', error)
    res.status(500).json({ error: 'Ошибка получения превью' })
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

function formatDeletedMessageDetails(row) {
  const roomId = row.roomId || '?'
  const author = row.username || 'пользователя'
  const rawText = String(row.text || '').trim()

  if (row.messageType === 'gif') {
    return `Сообщение удалено в комнате ${roomId} — GIF от ${author}`
  }

  if (row.messageType === 'poll') {
    try {
      const payload = JSON.parse(rawText)
      const question = (payload?.question || '').toString().trim() || 'без вопроса'
      const options = Array.isArray(payload?.options) ? payload.options.filter(Boolean).join(', ') : ''
      const optionsPart = options ? ` (варианты: ${options})` : ''
      return `Сообщение удалено в комнате ${roomId} — опрос «${question}»${optionsPart}`
    } catch {
      return `Сообщение удалено в комнате ${roomId} — опрос`
    }
  }

  const preview = rawText.length > 200 ? `${rawText.slice(0, 200)}…` : rawText
  return `Сообщение удалено в комнате ${roomId}: «${preview}»`
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
    const { email, password, handle: rawHandle } = req.body

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

    // Валидация логина (handle)
    const trimmedHandle = String(rawHandle || '').trim().toLowerCase()
    if (!trimmedHandle) {
      return res.status(400).json({ error: 'Логин обязателен' })
    }
    if (!/^[a-z0-9._]{3,24}$/.test(trimmedHandle)) {
      return res.status(400).json({ error: 'Логин: 3–24 символа, только латиница, цифры, точка и подчёркивание' })
    }
    if (/^[._]|[._]$/.test(trimmedHandle)) {
      return res.status(400).json({ error: 'Логин не может начинаться или заканчиваться на . или _' })
    }
    if (handleExists(trimmedHandle)) {
      return res.status(400).json({ error: 'Этот логин уже занят' })
    }

    // Проверяем, существует ли пользователь
    const existingUser = getUserByEmail(email)
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' })
    }

    const userId = uuidv4()
    const color = generateColor()
    const username = trimmedHandle

    // Хешируем пароль
    const hashedPassword = await bcrypt.hash(password, 10)

    // Сохраняем пользователя в БД
    createUser({
      id: userId,
      email,
      username,
      password: hashedPassword,
      color,
      handle: trimmedHandle
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
      handle: normalizedUser.handle || '',
      username: normalizedUser.username,
      email: normalizedUser.email,
      color: normalizedUser.color,
      initials: getInitials(normalizedUser.username),
      bio: normalizedUser.bio || '',
      avatar: normalizedUser.avatar || '',
      banner: normalizedUser.banner || '',
      favoriteGenres: parseFavoriteGenres(normalizedUser.favorite_genres),
      watchedMovies: watchedMoviesList,
      favoriteMovies: favoriteMoviesList,
      stats,
      createdAt: normalizedUser.created_at,
      ...getModerationPayload(user)
    }
  })
})

// Получить профиль по handle (логину)
app.get('/api/profile/by-handle/:handle', (req, res) => {
  const { handle } = req.params
  const user = getUserByHandle(handle)

  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }

  const watchedMoviesList = getWatchedMovies(user.id).map(movie => normalizeMovieMedia(req, movie))
  const favoriteMoviesList = getFavoriteMovies(user.id).map(movie => normalizeMovieMedia(req, movie))
  const stats = getUserStats(user.id)
  const normalizedUser = normalizeUserMedia(req, user)

  res.json({
    profile: {
      id: normalizedUser.id,
      handle: normalizedUser.handle || '',
      username: normalizedUser.username,
      email: normalizedUser.email,
      color: normalizedUser.color,
      initials: getInitials(normalizedUser.username),
      bio: normalizedUser.bio || '',
      avatar: normalizedUser.avatar || '',
      banner: normalizedUser.banner || '',
      favoriteGenres: parseFavoriteGenres(normalizedUser.favorite_genres),
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

  const { username, bio, avatar, banner, favoriteGenres } = req.body

  const updatedUser = updateUser(session.user_id, { username, bio, avatar, banner, favoriteGenres })

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
      favoriteGenres: parseFavoriteGenres(normalizedUser.favorite_genres),
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

  const messages = getUserMessageHistory(req.params.userId)
    .filter(message => message.messageType !== 'movie')
    .map(message => ({
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

app.delete('/api/admin/chat-messages/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Некорректный идентификатор' })
  }

  const row = deleteChatLogById(id)
  if (!row) {
    return res.status(404).json({ error: 'Сообщение не найдено' })
  }

  if (row.messageId) {
    const room = rooms.get(row.roomId)
    if (room && Array.isArray(room.messages)) {
      const removed = room.messages.find(message => message.id === row.messageId)
      const before = room.messages.length
      room.messages = room.messages.filter(message => message.id !== row.messageId)
      if (removed?.poll?.id && room.polls) {
        room.polls.delete(removed.poll.id)
      }
      if (room.messages.length !== before) {
        io.to(row.roomId).emit('chat-message-deleted', { messageId: row.messageId })
      }
    }
  }

  writeAdminAudit(req, {
    action: 'delete_chat_message',
    targetType: 'user',
    targetId: row.userId,
    targetName: row.username,
    details: formatDeletedMessageDetails(row)
  })

  res.json({ ok: true, messageId: row.messageId || null })
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

// ==================== АДМИН: ИСТОЧНИКИ ВИДЕО ====================

app.get('/api/admin/video-sources', requireAdmin, (_req, res) => {
  res.json({ sources: getAllVideoSources() })
})

app.post('/api/admin/video-sources', requireAdmin, (req, res) => {
  const { tmdbId, imdbId, sourceType, sourceUrl, dubLanguage, dubType, title, posterPath, isActive } = req.body || {}

  if (!tmdbId || !sourceType || !sourceUrl) {
    return res.status(400).json({ error: 'tmdbId, sourceType и sourceUrl обязательны' })
  }

  const allowedSourceTypes = new Set(['html5', 'youtube', 'embed', 'rutube', 'vkvideo'])
  const normalizedSourceType = String(sourceType).trim().toLowerCase()
  if (!allowedSourceTypes.has(normalizedSourceType)) {
    return res.status(400).json({ error: 'Неподдерживаемый sourceType' })
  }

  try {
    const source = upsertVideoSource({
      tmdbId,
      imdbId,
      sourceType: normalizedSourceType,
      sourceUrl,
      dubLanguage,
      dubType,
      title,
      posterPath: typeof posterPath === 'string' ? posterPath : '',
      isActive: isActive !== false
    })

    logAdminAction({
      adminId: req.session.user_id,
      adminUsername: req.session.username,
      action: 'upsert_video_source',
      targetType: 'video_source',
      targetId: String(tmdbId),
      targetName: title || `tmdb:${tmdbId}`,
      details: `${normalizedSourceType} → ${sourceUrl}`,
      createdAt: Date.now()
    })

    res.json({ source })
  } catch (error) {
    res.status(500).json({ error: 'Не удалось сохранить источник' })
  }
})

app.delete('/api/admin/video-sources/:tmdbId', requireAdmin, (req, res) => {
  const removed = deleteVideoSource(req.params.tmdbId)
  if (!removed) {
    return res.status(404).json({ error: 'Источник не найден' })
  }

  logAdminAction({
    adminId: req.session.user_id,
    adminUsername: req.session.username,
    action: 'delete_video_source',
    targetType: 'video_source',
    targetId: String(req.params.tmdbId),
    targetName: `tmdb:${req.params.tmdbId}`,
    details: '',
    createdAt: Date.now()
  })

  res.json({ ok: true })
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

// ==================== ДРУЗЬЯ И ЛИЧНЫЕ СООБЩЕНИЯ ====================

function requireAuth(req, res) {
  const session = getRequestSession(req)
  if (!session) {
    res.status(401).json({ error: 'Не авторизован' })
    return null
  }
  return session
}

function publicUserCard(req, row) {
  if (!row) return null
  return {
    id: row.id,
    handle: row.handle || '',
    username: row.username,
    color: row.color || '#6366f1',
    initials: getInitials(row.username || '?'),
    avatar: normalizeMediaUrl(req, row.avatar || ''),
    bio: row.bio || '',
    favoriteGenres: parseFavoriteGenres(row.favorite_genres)
  }
}

function emitToUser(userId, event, payload) {
  if (!userId) return
  io.to(`user:${userId}`).emit(event, payload)
}

function emitFriendsUpdate(userId) {
  if (!userId) return
  io.to(`user:${userId}`).emit('friends-updated', {
    timestamp: Date.now()
  })
}

function emitUnreadUpdate(userId) {
  if (!userId) return
  io.to(`user:${userId}`).emit('dm-unread', {
    total: getTotalUnreadCount(userId)
  })
}

function serializeDirectMessage(message) {
  if (!message) return null
  return {
    id: message.id,
    senderId: message.senderId,
    recipientId: message.recipientId,
    text: message.text,
    messageType: message.messageType || 'text',
    createdAt: Number(message.createdAt),
    readAt: message.readAt ? Number(message.readAt) : null
  }
}

// Поиск пользователей для добавления в друзья
app.get('/api/users/search', (req, res) => {
  const session = requireAuth(req, res)
  if (!session) return
  const query = typeof req.query.q === 'string' ? req.query.q : ''
  const genresRaw = typeof req.query.genres === 'string' ? req.query.genres : ''
  const genreIds = genresRaw
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => Number.isInteger(value) && value > 0)
  const results = searchUsersForFriends(query, session.user_id, 24, genreIds).map(row => {
    const card = publicUserCard(req, row)
    const { status } = getFriendshipStatus(session.user_id, row.id)
    return {
      ...card,
      friendshipStatus: status,
      genreMatches: row._genreMatches || 0
    }
  })
  res.json({ users: results })
})

// Статус дружбы с конкретным пользователем
app.get('/api/friends/status/:userId', (req, res) => {
  const session = requireAuth(req, res)
  if (!session) return
  const otherId = req.params.userId
  if (otherId === session.user_id) {
    return res.json({ status: 'self' })
  }
  const target = getUserById(otherId)
  if (!target) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }
  const { status } = getFriendshipStatus(session.user_id, otherId)
  res.json({ status })
})

// Мой список друзей
app.get('/api/friends', (req, res) => {
  const session = requireAuth(req, res)
  if (!session) return
  const friends = getFriendsForUser(session.user_id).map(row => publicUserCard(req, row))
  res.json({ friends })
})

// Публичный список друзей конкретного пользователя
app.get('/api/friends/list/:userId', (req, res) => {
  const target = getUserById(req.params.userId)
  if (!target) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }
  const friends = getFriendsForUser(target.id).map(row => publicUserCard(req, row))
  res.json({ friends })
})

// Входящие заявки
app.get('/api/friends/requests', (req, res) => {
  const session = requireAuth(req, res)
  if (!session) return
  const incoming = getIncomingFriendRequests(session.user_id).map(row => publicUserCard(req, row))
  const outgoing = getOutgoingFriendRequests(session.user_id).map(row => publicUserCard(req, row))
  res.json({ incoming, outgoing })
})

// Отправить заявку в друзья
app.post('/api/friends/request/:userId', (req, res) => {
  const session = requireAuth(req, res)
  if (!session) return
  const targetId = req.params.userId
  if (targetId === session.user_id) {
    return res.status(400).json({ error: 'Нельзя добавить себя в друзья' })
  }
  const target = getUserById(targetId)
  if (!target) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }

  try {
    const result = createFriendRequest(session.user_id, targetId)
    const status = getFriendshipStatus(session.user_id, targetId)

    // Notify target
    if (result.accepted) {
      emitFriendsUpdate(targetId)
      emitFriendsUpdate(session.user_id)
      emitToUser(targetId, 'friend-accepted', {
        user: publicUserCard(req, { id: session.user_id, username: session.username, color: session.color, avatar: session.avatar })
      })
    } else {
      emitToUser(targetId, 'friend-request-received', {
        user: publicUserCard(req, { id: session.user_id, username: session.username, color: session.color, avatar: session.avatar })
      })
    }

    res.json({ status: status.status })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Не удалось отправить заявку' })
  }
})

// Принять заявку
app.post('/api/friends/accept/:userId', (req, res) => {
  const session = requireAuth(req, res)
  if (!session) return
  const otherId = req.params.userId
  try {
    acceptFriendRequest(session.user_id, otherId)
    emitFriendsUpdate(session.user_id)
    emitFriendsUpdate(otherId)
    emitToUser(otherId, 'friend-accepted', {
      user: publicUserCard(req, { id: session.user_id, username: session.username, color: session.color, avatar: session.avatar })
    })
    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Не удалось принять заявку' })
  }
})

// Отклонить заявку
app.post('/api/friends/decline/:userId', (req, res) => {
  const session = requireAuth(req, res)
  if (!session) return
  const otherId = req.params.userId
  try {
    declineFriendRequest(session.user_id, otherId)
    emitToUser(otherId, 'friend-request-declined', { byUserId: session.user_id })
    emitFriendsUpdate(session.user_id)
    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Не удалось отклонить заявку' })
  }
})

// Удалить друга / отменить заявку
app.delete('/api/friends/:userId', (req, res) => {
  const session = requireAuth(req, res)
  if (!session) return
  const otherId = req.params.userId
  const result = removeFriendship(session.user_id, otherId)
  if (result.removed) {
    emitFriendsUpdate(session.user_id)
    emitFriendsUpdate(otherId)
    emitToUser(otherId, 'friend-removed', { byUserId: session.user_id })
  }
  res.json({ ok: true })
})

// Список диалогов
app.get('/api/messages/conversations', (req, res) => {
  const session = requireAuth(req, res)
  if (!session) return
  const summaries = getConversationSummaries(session.user_id).map(row => ({
    user: publicUserCard(req, row),
    lastMessage: {
      id: row.messageId,
      senderId: row.senderId,
      recipientId: row.recipientId,
      text: row.text,
      messageType: row.messageType || 'text',
      createdAt: Number(row.createdAt),
      readAt: row.readAt ? Number(row.readAt) : null
    },
    unread: Number(row.unread || 0)
  }))
  res.json({
    conversations: summaries,
    totalUnread: getTotalUnreadCount(session.user_id)
  })
})

// Сообщения в диалоге
app.get('/api/messages/:userId', (req, res) => {
  const session = requireAuth(req, res)
  if (!session) return
  const otherId = req.params.userId
  const other = getUserById(otherId)
  if (!other) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }

  const beforeId = req.query.before ? Number(req.query.before) : null
  const limit = req.query.limit ? Number(req.query.limit) : 100
  const messages = getConversationMessages(session.user_id, otherId, { limit, beforeId })
    .map(serializeDirectMessage)

  res.json({
    user: publicUserCard(req, other),
    messages
  })
})

// Отправить сообщение
app.post('/api/messages/:userId', (req, res) => {
  const session = requireAuth(req, res)
  if (!session) return

  const otherId = req.params.userId
  if (otherId === session.user_id) {
    return res.status(400).json({ error: 'Нельзя писать самому себе' })
  }

  const target = getUserById(otherId)
  if (!target) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }
  if (target.is_banned) {
    return res.status(403).json({ error: 'Пользователь заблокирован' })
  }

  // Должны быть друзьями
  const status = getFriendshipStatus(session.user_id, otherId)
  if (status.status !== 'friends') {
    return res.status(403).json({ error: 'Можно писать только друзьям' })
  }

  // Не разрешаем при бане отправителя или активном таймауте
  const senderModeration = getUserModerationState(session.user_id)
  if (senderModeration?.isBanned) {
    return res.status(403).json({ error: 'Ваш аккаунт заблокирован' })
  }
  if (senderModeration?.timeoutUntil && Number(senderModeration.timeoutUntil) > Date.now()) {
    return res.status(403).json({ error: 'Чат временно недоступен' })
  }

  const rawText = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
  const messageType = ['text', 'gif', 'image'].includes(req.body?.messageType) ? req.body.messageType : 'text'

  if (!rawText) {
    return res.status(400).json({ error: 'Пустое сообщение' })
  }
  if (rawText.length > 4000) {
    return res.status(400).json({ error: 'Слишком длинное сообщение' })
  }

  const stored = insertDirectMessage({
    senderId: session.user_id,
    recipientId: otherId,
    text: rawText,
    messageType
  })

  const payload = serializeDirectMessage(stored)

  emitToUser(otherId, 'dm-message', {
    message: payload,
    from: publicUserCard(req, { id: session.user_id, username: session.username, color: session.color, avatar: session.avatar })
  })
  emitToUser(session.user_id, 'dm-message', {
    message: payload,
    from: publicUserCard(req, target)
  })
  emitUnreadUpdate(otherId)

  res.json({ message: payload })
})

// Пометить диалог как прочитанный
app.post('/api/messages/:userId/read', (req, res) => {
  const session = requireAuth(req, res)
  if (!session) return
  const otherId = req.params.userId
  const changes = markConversationRead(session.user_id, otherId)
  if (changes > 0) {
    emitToUser(otherId, 'dm-read', { byUserId: session.user_id })
    emitUnreadUpdate(session.user_id)
  }
  res.json({ ok: true, updated: changes })
})

// Индикатор печати в личных сообщениях
app.post('/api/messages/:userId/typing', (req, res) => {
  const session = requireAuth(req, res)
  if (!session) return
  const otherId = req.params.userId
  // быстрая проверка дружбы
  const status = getFriendshipStatus(session.user_id, otherId)
  if (status.status !== 'friends') {
    return res.status(403).json({ error: 'Не друзья' })
  }
  emitToUser(otherId, 'dm-typing', {
    fromUserId: session.user_id,
    isTyping: Boolean(req.body?.isTyping)
  })
  res.json({ ok: true })
})

// ==================== ПРИГЛАШЕНИЯ В КОМНАТУ ====================
// Отправить приглашение в комнату другу через личное сообщение
app.post('/api/rooms/:roomId/invite/:friendId', (req, res) => {
  const session = requireAuth(req, res)
  if (!session) return

  const roomId = String(req.params.roomId || '').toUpperCase()
  const friendId = String(req.params.friendId || '')

  if (!roomId || !friendId) {
    return res.status(400).json({ error: 'Не указан roomId или friendId' })
  }
  if (friendId === session.user_id) {
    return res.status(400).json({ error: 'Нельзя пригласить самого себя' })
  }

  const room = rooms.get(roomId)
  if (!room) {
    return res.status(404).json({ error: 'Комната не найдена' })
  }

  // Caller должен быть в комнате
  const callerInRoom = Array.from(room.users.values()).some(u => u.id === session.user_id)
  if (!callerInRoom) {
    return res.status(403).json({ error: 'Вы не находитесь в этой комнате' })
  }

  if (room.solo) {
    return res.status(400).json({ error: 'Нельзя приглашать в одиночный режим' })
  }
  if (room.isPrivate && room.creatorId && room.creatorId !== session.user_id) {
    // Гостям приватной комнаты можно тоже приглашать — оставим разрешено,
    // но если требуется ограничить — раскомментировать строку ниже:
    // return res.status(403).json({ error: 'Только создатель может приглашать в приватную комнату' })
  }

  const target = getUserById(friendId)
  if (!target) {
    return res.status(404).json({ error: 'Пользователь не найден' })
  }
  if (target.is_banned) {
    return res.status(403).json({ error: 'Пользователь заблокирован' })
  }

  // Должны быть друзьями
  const status = getFriendshipStatus(session.user_id, friendId)
  if (status.status !== 'friends') {
    return res.status(403).json({ error: 'Можно приглашать только друзей' })
  }

  // Сборка payload приглашения
  const members = Array.from(room.users.values()).map(u => ({
    id: u.id,
    username: u.username,
    color: u.color,
    initials: u.initials,
    avatar: normalizeMediaUrl(req, u.avatar || '')
  }))

  const video = room.video || {}
  const moviePoster = video.posterPath || ''
  const normalizedPoster = moviePoster.startsWith('/') && !moviePoster.startsWith('/api/') && !moviePoster.startsWith('/uploads/')
    ? `${getPublicOrigin(req)}/api/tmdb/image?size=w342&path=${encodeURIComponent(moviePoster)}`
    : normalizeMediaUrl(req, moviePoster)
  const movie = video.url ? {
    movieId: video.movieId || null,
    title: video.title || 'Видео',
    posterPath: normalizedPoster || null,
    year: video.year || null,
    sourceType: video.sourceType || null
  } : null

  const inviter = {
    id: session.user_id,
    username: session.username,
    color: session.color,
    initials: (session.username || '?').slice(0, 2).toUpperCase(),
    avatar: normalizeMediaUrl(req, session.avatar || '')
  }

  const payloadObj = {
    kind: 'room_invite',
    roomId,
    isPrivate: !!room.isPrivate,
    inviter,
    members,
    movie
  }

  const stored = insertDirectMessage({
    senderId: session.user_id,
    recipientId: friendId,
    text: JSON.stringify(payloadObj),
    messageType: 'room_invite'
  })

  const messagePayload = serializeDirectMessage(stored)

  emitToUser(friendId, 'dm-message', {
    message: messagePayload,
    from: publicUserCard(req, { id: session.user_id, username: session.username, color: session.color, avatar: session.avatar })
  })
  emitToUser(session.user_id, 'dm-message', {
    message: messagePayload,
    from: publicUserCard(req, target)
  })
  emitUnreadUpdate(friendId)

  res.json({ ok: true, message: messagePayload })
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

app.get('/api/video-sources/resolve', (req, res) => {
  const tmdbId = typeof req.query.tmdbId === 'string' ? req.query.tmdbId.trim() : ''
  const imdbId = typeof req.query.imdbId === 'string' ? req.query.imdbId.trim() : ''

  if (!tmdbId && !imdbId) {
    return res.status(400).json({ error: 'tmdbId или imdbId обязателен' })
  }

  const source = getVideoSource({ tmdbId: tmdbId || null, imdbId: imdbId || null })
  if (!source) {
    return res.status(404).json({ error: 'Источник не найден' })
  }

  res.json({ source })
})

// Публичный каталог фильмов, у которых админ задал источник воспроизведения.
// Используется на странице библиотеки как фильтр «Доступно онлайн».
app.get('/api/video-sources/catalog', (_req, res) => {
  try {
    const sources = getAllVideoSources().filter(src => src.isActive)
    res.json({ sources })
  } catch (error) {
    console.error('catalog error', error)
    res.status(500).json({ error: 'Не удалось загрузить каталог' })
  }
})

app.post('/api/video-sources', (req, res) => {
  const { tmdbId, imdbId, sourceType, sourceUrl, dubLanguage, dubType, title, isActive } = req.body || {}
  if (!tmdbId || !sourceType || !sourceUrl) {
    return res.status(400).json({ error: 'tmdbId, sourceType и sourceUrl обязательны' })
  }

  const allowedSourceTypes = new Set(['html5', 'youtube', 'embed', 'rutube', 'vkvideo'])
  const normalizedSourceType = String(sourceType).trim().toLowerCase()
  if (!allowedSourceTypes.has(normalizedSourceType)) {
    return res.status(400).json({ error: 'Неподдерживаемый sourceType' })
  }

  try {
    const source = upsertVideoSource({
      tmdbId,
      imdbId,
      sourceType: normalizedSourceType,
      sourceUrl,
      dubLanguage,
      dubType,
      title,
      isActive
    })

    res.json({ source })
  } catch (error) {
    res.status(500).json({ error: 'Не удалось сохранить источник' })
  }
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

// Сколько уникальных авторизованных пользователей сейчас на сайте
app.get('/api/presence/online', (_req, res) => {
  res.json({ online: onlineUserSockets.size })
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

  // Привязка сокета к личной комнате пользователя (для друзей и личных сообщений)
  socket.on('auth-register', ({ token } = {}) => {
    if (!token) return
    const session = getSession(token)
    if (!session) {
      socket.emit('auth-register-failed')
      return
    }
    // Покидаем старую персональную комнату, если переавторизация
    if (socket.data.personalRoom) {
      socket.leave(socket.data.personalRoom)
    }
    if (socket.data.authUserId && socket.data.authUserId !== session.user_id) {
      removeOnlineUser(socket.data.authUserId)
    }
    const room = `user:${session.user_id}`
    socket.join(room)
    socket.data.personalRoom = room
    const isNewBinding = socket.data.authUserId !== session.user_id
    socket.data.authUserId = session.user_id
    if (isNewBinding) addOnlineUser(session.user_id)
    socket.emit('auth-register-ok', { userId: session.user_id })
    // Сразу высылаем актуальный счётчик непрочитанных
    socket.emit('dm-unread', { total: getTotalUnreadCount(session.user_id) })
  })

  socket.on('auth-unregister', () => {
    if (socket.data.personalRoom) {
      socket.leave(socket.data.personalRoom)
      socket.data.personalRoom = null
    }
    if (socket.data.authUserId) {
      removeOnlineUser(socket.data.authUserId)
    }
    socket.data.authUserId = null
  })

  socket.on('admin:subscribe', ({ token } = {}) => {
    if (!token) return
    const session = getSession(token)
    if (!session || session.role !== 'admin') return
    socket.join('admins')
    socket.data.isAdmin = true
  })

  socket.on('admin:unsubscribe', () => {
    socket.leave('admins')
    socket.data.isAdmin = false
  })

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
  socket.on('select-video', ({ url, movieId, title, imdbId, posterPath, year, sourceType }) => {
    if (!currentRoom) return

    const room = rooms.get(currentRoom)
    if (!room) return

    room.video = {
      url,
      movieId,
      title,
      imdbId,
      sourceType: sourceType || null,
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
      const logId = logChatMessage({
        roomId: currentRoom,
        userId: currentUser.id,
        username: currentUser.username,
        messageType: historyEntry.messageType,
        text: historyEntry.text,
        createdAt: message.timestamp,
        messageId: message.id
      })

      if (historyEntry.messageType !== 'movie') {
        io.to('admins').emit('admin-chat-log', {
          id: logId,
          userId: currentUser.id,
          username: currentUser.username,
          roomId: currentRoom,
          messageType: historyEntry.messageType,
          text: historyEntry.messageType === 'gif'
            ? (historyEntry.text.startsWith('GIF:') ? historyEntry.text.slice(4) : historyEntry.text)
            : historyEntry.text,
          createdAt: message.timestamp,
          messageId: message.id
        })
      }
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
      const pollText = JSON.stringify({
        question: question.trim().slice(0, 300),
        options: options.map(opt => opt.trim().slice(0, 100)).filter(Boolean),
        multiSelect: !!multiSelect
      })
      const logId = logChatMessage({
        roomId: currentRoom,
        userId: currentUser.id,
        username: currentUser.username,
        messageType: 'poll',
        text: pollText,
        createdAt: pollMessage.timestamp,
        messageId: pollMessage.id
      })

      io.to('admins').emit('admin-chat-log', {
        id: logId,
        userId: currentUser.id,
        username: currentUser.username,
        roomId: currentRoom,
        messageType: 'poll',
        text: pollText,
        createdAt: pollMessage.timestamp,
        messageId: pollMessage.id
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
    if (socket.data.authUserId) {
      removeOnlineUser(socket.data.authUserId)
      socket.data.authUserId = null
    }
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
