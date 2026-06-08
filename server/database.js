import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dbPath = path.join(__dirname, 'uniscreen.db')
const db = new Database(dbPath)

// Включаем WAL mode для лучшей производительности
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ==================== СОЗДАНИЕ ТАБЛИЦ ====================

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    color TEXT NOT NULL,
    bio TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    banner TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS watched_movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    movie_id TEXT NOT NULL,
    title TEXT NOT NULL,
    poster_path TEXT DEFAULT '',
    year TEXT DEFAULT '',
    rating REAL DEFAULT 0,
    rated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, movie_id)
  );

  CREATE TABLE IF NOT EXISTS favorite_movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    movie_id TEXT NOT NULL,
    title TEXT NOT NULL,
    poster_path TEXT DEFAULT '',
    year TEXT DEFAULT '',
    vote_average REAL DEFAULT 0,
    genre_names TEXT DEFAULT '',
    added_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, movie_id)
  );

  CREATE TABLE IF NOT EXISTS user_gifs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    url TEXT NOT NULL,
    added_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, url)
  );

  CREATE TABLE IF NOT EXISTS user_favorite_gifs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    url TEXT NOT NULL,
    added_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, url)
  );

  CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    message_type TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT NOT NULL,
    admin_username TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_name TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS video_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tmdb_id TEXT NOT NULL UNIQUE,
    imdb_id TEXT,
    source_type TEXT NOT NULL,
    source_url TEXT NOT NULL,
    dub_language TEXT DEFAULT '',
    dub_type TEXT DEFAULT '',
    title TEXT DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a TEXT NOT NULL,
    user_b TEXT NOT NULL,
    requester_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_a, user_b),
    FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_friendships_user_a ON friendships(user_a);
  CREATE INDEX IF NOT EXISTS idx_friendships_user_b ON friendships(user_b);

  CREATE TABLE IF NOT EXISTS direct_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    text TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    created_at INTEGER NOT NULL,
    read_at INTEGER,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_dm_conv ON direct_messages(sender_id, recipient_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_dm_recipient ON direct_messages(recipient_id, read_at);
`)

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all()
  if (!columns.some(column => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
  }
}

ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user'")
ensureColumn('users', 'is_banned', 'INTEGER NOT NULL DEFAULT 0')
ensureColumn('users', 'ban_reason', "TEXT NOT NULL DEFAULT ''")
ensureColumn('users', 'timeout_until', 'INTEGER')
ensureColumn('users', 'timeout_reason', "TEXT NOT NULL DEFAULT ''")
ensureColumn('users', 'favorite_genres', "TEXT NOT NULL DEFAULT '[]'")
ensureColumn('users', 'handle', "TEXT NOT NULL DEFAULT ''")
ensureColumn('video_sources', 'poster_path', "TEXT DEFAULT ''")
ensureColumn('chat_logs', 'message_id', "TEXT DEFAULT ''")

// Уникальный индекс по handle (без учёта регистра, пустые значения исключаем)
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle_unique ON users(LOWER(handle)) WHERE handle != ''`)

// Миграция: для пользователей без handle генерируем его из email/username
function sanitizeHandleSeed(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9._]+/g, '')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 24)
}

function handleExists(handle) {
  const row = db.prepare('SELECT 1 FROM users WHERE LOWER(handle) = LOWER(?) LIMIT 1').get(handle)
  return !!row
}

function generateUniqueHandle(seed) {
  let base = sanitizeHandleSeed(seed)
  if (base.length < 3) base = `user${base}`.slice(0, 24)
  if (base.length < 3) base = `user${Math.random().toString(36).slice(2, 6)}`
  let candidate = base
  let suffix = 0
  while (handleExists(candidate)) {
    suffix += 1
    const suffixStr = String(suffix)
    candidate = `${base.slice(0, Math.max(3, 24 - suffixStr.length))}${suffixStr}`
  }
  return candidate
}

const usersMissingHandle = db.prepare("SELECT id, email, username FROM users WHERE handle IS NULL OR handle = ''").all()
if (usersMissingHandle.length > 0) {
  const updateHandle = db.prepare('UPDATE users SET handle = ? WHERE id = ?')
  for (const u of usersMissingHandle) {
    const seed = (u.email && u.email.split('@')[0]) || u.username || u.id
    const handle = generateUniqueHandle(seed)
    updateHandle.run(handle, u.id)
  }
  console.log(`✅ Сгенерированы handle для ${usersMissingHandle.length} пользователей`)
}

export { generateUniqueHandle, handleExists, sanitizeHandleSeed }

console.log('✅ База данных инициализирована:', dbPath)

// ==================== ПОЛЬЗОВАТЕЛИ ====================

export function createUser({ id, email, username, password, color, handle }) {
  const stmt = db.prepare(`
    INSERT INTO users (id, email, username, password, color, handle)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  stmt.run(id, email, username, password, color, handle || '')
  return getUserById(id)
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id)
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email)
}

export function getUserByHandle(handle) {
  if (!handle) return null
  return db.prepare('SELECT * FROM users WHERE LOWER(handle) = LOWER(?)').get(handle)
}

export function updateUser(id, { username, bio, avatar, banner, favoriteGenres }) {
  const fields = []
  const values = []

  if (username !== undefined) {
    fields.push('username = ?')
    values.push(username.trim().slice(0, 30))
  }
  if (bio !== undefined) {
    fields.push('bio = ?')
    values.push(bio.trim().slice(0, 100))
  }
  if (avatar !== undefined) {
    fields.push('avatar = ?')
    values.push(avatar)
  }
  if (banner !== undefined) {
    fields.push('banner = ?')
    values.push(banner)
  }
  if (favoriteGenres !== undefined) {
    const arr = Array.isArray(favoriteGenres) ? favoriteGenres : []
    const normalized = arr
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value > 0)
      .slice(0, 3)
    fields.push('favorite_genres = ?')
    values.push(JSON.stringify(Array.from(new Set(normalized))))
  }

  if (fields.length === 0) return getUserById(id)

  values.push(id)
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getUserById(id)
}

export function parseFavoriteGenres(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value > 0)
      .slice(0, 3)
  } catch {
    return []
  }
}

export function setUserRole(id, role) {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
  return getUserById(id)
}

export function banUser(id, reason) {
  db.prepare(`
    UPDATE users
    SET is_banned = 1,
        ban_reason = ?,
        timeout_until = NULL,
        timeout_reason = ''
    WHERE id = ?
  `).run(reason || '', id)
  return getUserById(id)
}

export function unbanUser(id) {
  db.prepare(`
    UPDATE users
    SET is_banned = 0,
        ban_reason = ''
    WHERE id = ?
  `).run(id)
  return getUserById(id)
}

export function setUserTimeout(id, timeoutUntil, reason) {
  db.prepare(`
    UPDATE users
    SET timeout_until = ?,
        timeout_reason = ?,
        is_banned = 0
    WHERE id = ?
  `).run(timeoutUntil, reason || '', id)
  return getUserById(id)
}

export function clearUserTimeout(id) {
  db.prepare(`
    UPDATE users
    SET timeout_until = NULL,
        timeout_reason = ''
    WHERE id = ?
  `).run(id)
  return getUserById(id)
}

export function clearExpiredTimeouts() {
  db.prepare(`
    UPDATE users
    SET timeout_until = NULL,
        timeout_reason = ''
    WHERE timeout_until IS NOT NULL AND timeout_until <= ?
  `).run(Date.now())
}

export function getUserModerationState(userId) {
  clearExpiredTimeouts()
  return db.prepare(`
    SELECT id, role, is_banned as isBanned, ban_reason as banReason,
           timeout_until as timeoutUntil, timeout_reason as timeoutReason
    FROM users
    WHERE id = ?
  `).get(userId)
}

export function getAdminUsers(search = '') {
  clearExpiredTimeouts()
  const normalizedSearch = `%${search.trim().toLowerCase()}%`
  return db.prepare(`
    SELECT id,
           email,
           username,
           color,
           avatar,
           role,
           is_banned as isBanned,
           ban_reason as banReason,
           timeout_until as timeoutUntil,
           timeout_reason as timeoutReason,
           created_at as createdAt
    FROM users
    WHERE LOWER(username) LIKE ? OR LOWER(email) LIKE ?
    ORDER BY role DESC, created_at DESC
  `).all(normalizedSearch, normalizedSearch)
}

// ==================== СЕССИИ ====================

export function createSession(token, userId) {
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId)
}

export function getSession(token) {
  clearExpiredTimeouts()
  return db.prepare(`
    SELECT s.token, s.user_id, s.created_at as session_created,
           u.id, u.email, u.username, u.color, u.bio, u.avatar, u.banner, u.created_at,
           u.role, u.is_banned, u.ban_reason, u.timeout_until, u.timeout_reason
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
  `).get(token)
}

export function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function deleteUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

export function logChatMessage({ roomId, userId, username, messageType, text, createdAt, messageId }) {
  const info = db.prepare(`
    INSERT INTO chat_logs (room_id, user_id, username, message_type, text, created_at, message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(roomId, userId, username, messageType, text, createdAt, messageId || '')
  return Number(info.lastInsertRowid)
}

export function getUserMessageHistory(userId, limit = 200) {
  return db.prepare(`
    SELECT id,
           room_id as roomId,
           user_id as userId,
           username,
           message_type as messageType,
           text,
           created_at as createdAt,
           message_id as messageId
    FROM chat_logs
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit)
}

export function getChatLogById(id) {
  return db.prepare(`
    SELECT id,
           room_id as roomId,
           user_id as userId,
           username,
           message_type as messageType,
           text,
           created_at as createdAt,
           message_id as messageId
    FROM chat_logs
    WHERE id = ?
  `).get(id)
}

export function deleteChatLogById(id) {
  const row = getChatLogById(id)
  if (!row) return null
  db.prepare('DELETE FROM chat_logs WHERE id = ?').run(id)
  return row
}

export function logAdminAction({ adminId, adminUsername, action, targetType, targetId, targetName, details, createdAt }) {
  db.prepare(`
    INSERT INTO admin_audit_logs (admin_id, admin_username, action, target_type, target_id, target_name, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    adminId,
    adminUsername,
    action,
    targetType,
    targetId,
    targetName,
    details || '',
    createdAt || Date.now()
  )
}

export function getAdminAuditLogs(limit = 300) {
  return db.prepare(`
    SELECT id,
           admin_id as adminId,
           admin_username as adminUsername,
           action,
           target_type as targetType,
           target_id as targetId,
           target_name as targetName,
           details,
           created_at as createdAt
    FROM admin_audit_logs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit)
}

// ==================== ПРОСМОТРЕННЫЕ ФИЛЬМЫ ====================

export function getWatchedMovies(userId) {
  return db.prepare(`
    SELECT movie_id as movieId, title, poster_path as posterPath, year, rating, rated_at as ratedAt
    FROM watched_movies
    WHERE user_id = ?
    ORDER BY rated_at DESC
  `).all(userId)
}

export function rateMovie(userId, { movieId, title, posterPath, year, rating }) {
  const stmt = db.prepare(`
    INSERT INTO watched_movies (user_id, movie_id, title, poster_path, year, rating, rated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, movie_id)
    DO UPDATE SET title = excluded.title,
                  poster_path = excluded.poster_path,
                  year = excluded.year,
                  rating = excluded.rating,
                  rated_at = datetime('now')
  `)
  stmt.run(userId, String(movieId), title, posterPath || '', year || '', Math.min(10, Math.max(0, Number(rating))))
  return getWatchedMovies(userId)
}

export function deleteWatchedMovie(userId, movieId) {
  db.prepare('DELETE FROM watched_movies WHERE user_id = ? AND movie_id = ?').run(userId, String(movieId))
  return getWatchedMovies(userId)
}

export function getWatchedMoviesCount(userId) {
  const result = db.prepare('SELECT COUNT(*) as count FROM watched_movies WHERE user_id = ?').get(userId)
  return result.count
}

// ==================== СТАТИСТИКА ====================

export function getUserStats(userId) {
  const totalMovies = db.prepare('SELECT COUNT(*) as count FROM watched_movies WHERE user_id = ?').get(userId)
  const avgRating = db.prepare('SELECT AVG(rating) as avg FROM watched_movies WHERE user_id = ?').get(userId)
  const topRated = db.prepare(`
    SELECT movie_id as movieId, title, poster_path as posterPath, year, rating
    FROM watched_movies
    WHERE user_id = ?
    ORDER BY rating DESC
    LIMIT 5
  `).all(userId)

  return {
    totalMovies: totalMovies.count,
    averageRating: avgRating.avg ? Math.round(avgRating.avg * 10) / 10 : 0,
    topRated
  }
}

// ==================== ИСТОЧНИКИ ВОСПРОИЗВЕДЕНИЯ ====================

export function getVideoSource({ tmdbId, imdbId }) {
  const normalizedTmdbId = tmdbId != null ? String(tmdbId) : null
  const normalizedImdbId = typeof imdbId === 'string' && imdbId.trim() ? imdbId.trim() : null

  if (!normalizedTmdbId && !normalizedImdbId) {
    return null
  }

  return db.prepare(`
    SELECT tmdb_id as tmdbId,
           imdb_id as imdbId,
           source_type as sourceType,
           source_url as sourceUrl,
           dub_language as dubLanguage,
           dub_type as dubType,
           title,
           poster_path as posterPath,
           is_active as isActive,
           updated_at as updatedAt
    FROM video_sources
    WHERE is_active = 1
      AND ((? IS NOT NULL AND tmdb_id = ?) OR (? IS NOT NULL AND imdb_id = ?))
    ORDER BY CASE WHEN (? IS NOT NULL AND tmdb_id = ?) THEN 0 ELSE 1 END
    LIMIT 1
  `).get(
    normalizedTmdbId,
    normalizedTmdbId,
    normalizedImdbId,
    normalizedImdbId,
    normalizedTmdbId,
    normalizedTmdbId
  )
}

export function upsertVideoSource({ tmdbId, imdbId, sourceType, sourceUrl, dubLanguage, dubType, title, posterPath, isActive = true }) {
  const normalizedTmdbId = String(tmdbId).trim()
  const normalizedImdbId = typeof imdbId === 'string' && imdbId.trim() ? imdbId.trim() : null

  db.prepare(`
    INSERT INTO video_sources (
      tmdb_id,
      imdb_id,
      source_type,
      source_url,
      dub_language,
      dub_type,
      title,
      poster_path,
      is_active,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tmdb_id)
    DO UPDATE SET imdb_id = excluded.imdb_id,
                  source_type = excluded.source_type,
                  source_url = excluded.source_url,
                  dub_language = excluded.dub_language,
                  dub_type = excluded.dub_type,
                  title = excluded.title,
                  poster_path = COALESCE(NULLIF(excluded.poster_path, ''), video_sources.poster_path),
                  is_active = excluded.is_active,
                  updated_at = datetime('now')
  `).run(
    normalizedTmdbId,
    normalizedImdbId,
    String(sourceType).trim().toLowerCase(),
    String(sourceUrl).trim(),
    dubLanguage || '',
    dubType || '',
    title || '',
    posterPath || '',
    isActive ? 1 : 0
  )

  return getVideoSource({ tmdbId: normalizedTmdbId, imdbId: normalizedImdbId })
}

export function getAllVideoSources() {
  return db.prepare(`
    SELECT tmdb_id as tmdbId,
           imdb_id as imdbId,
           source_type as sourceType,
           source_url as sourceUrl,
           dub_language as dubLanguage,
           dub_type as dubType,
           title,
           poster_path as posterPath,
           is_active as isActive,
           created_at as createdAt,
           updated_at as updatedAt
    FROM video_sources
    ORDER BY datetime(updated_at) DESC
  `).all()
}

export function deleteVideoSource(tmdbId) {
  const normalizedTmdbId = tmdbId != null ? String(tmdbId).trim() : ''
  if (!normalizedTmdbId) return false
  const result = db.prepare('DELETE FROM video_sources WHERE tmdb_id = ?').run(normalizedTmdbId)
  return result.changes > 0
}

// Закрытие БД при завершении процесса
process.on('exit', () => db.close())
process.on('SIGINT', () => { db.close(); process.exit(0) })
process.on('SIGTERM', () => { db.close(); process.exit(0) })

// ==================== ИЗБРАННЫЕ ФИЛЬМЫ ====================

export function getFavoriteMovies(userId) {
  return db.prepare(`
    SELECT movie_id as movieId, title, poster_path as posterPath, year, vote_average as voteAverage, genre_names as genreNames, added_at as addedAt
    FROM favorite_movies
    WHERE user_id = ?
    ORDER BY added_at DESC
  `).all(userId)
}

export function getFavoriteMovieIds(userId) {
  return db.prepare('SELECT movie_id as movieId FROM favorite_movies WHERE user_id = ?').all(userId).map(r => r.movieId)
}

export function addFavoriteMovie(userId, { movieId, title, posterPath, year, voteAverage, genreNames }) {
  db.prepare(`
    INSERT OR IGNORE INTO favorite_movies (user_id, movie_id, title, poster_path, year, vote_average, genre_names)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, String(movieId), title, posterPath || '', year || '', voteAverage || 0, genreNames || '')
  return getFavoriteMovies(userId)
}

export function removeFavoriteMovie(userId, movieId) {
  db.prepare('DELETE FROM favorite_movies WHERE user_id = ? AND movie_id = ?').run(userId, String(movieId))
  return getFavoriteMovies(userId)
}

export function isFavoriteMovie(userId, movieId) {
  const result = db.prepare('SELECT COUNT(*) as count FROM favorite_movies WHERE user_id = ? AND movie_id = ?').get(userId, String(movieId))
  return result.count > 0
}

// ==================== GIF-КИ ====================

export function getUserGifs(userId, limit = 50) {
  return db.prepare('SELECT id, url, added_at as addedAt FROM user_gifs WHERE user_id = ? ORDER BY added_at DESC LIMIT ?').all(userId, limit)
}

export function addUserGif(userId, url) {
  // Если уже есть — не добавляем повторно (не дублируем)
  const existing = db.prepare('SELECT id FROM user_gifs WHERE user_id = ? AND url = ?').get(userId, url)
  if (existing) return getUserGifs(userId)
  db.prepare('INSERT INTO user_gifs (user_id, url) VALUES (?, ?)').run(userId, url)
  return getUserGifs(userId)
}

export function deleteUserGif(userId, gifId) {
  db.prepare('DELETE FROM user_gifs WHERE id = ? AND user_id = ?').run(gifId, userId)
  return getUserGifs(userId)
}

export function getUserFavoriteGifs(userId) {
  return db.prepare('SELECT id, url, added_at as addedAt FROM user_favorite_gifs WHERE user_id = ? ORDER BY added_at DESC').all(userId)
}

export function addFavoriteGif(userId, url) {
  db.prepare('INSERT OR IGNORE INTO user_favorite_gifs (user_id, url) VALUES (?, ?)').run(userId, url)
  return getUserFavoriteGifs(userId)
}

export function removeFavoriteGif(userId, url) {
  db.prepare('DELETE FROM user_favorite_gifs WHERE user_id = ? AND url = ?').run(userId, url)
  return getUserFavoriteGifs(userId)
}

export function isFavoriteGif(userId, url) {
  const result = db.prepare('SELECT COUNT(*) as count FROM user_favorite_gifs WHERE user_id = ? AND url = ?').get(userId, url)
  return result.count > 0
}

// ==================== ДРУЗЬЯ ====================

function friendshipPair(idA, idB) {
  return idA < idB ? [idA, idB] : [idB, idA]
}

export function searchUsersForFriends(query, excludeId, limit = 20, genreIds = []) {
  const normalized = `%${String(query || '').trim().toLowerCase()}%`
  const hasQuery = normalized && normalized !== '%%'
  const hasGenres = Array.isArray(genreIds) && genreIds.length > 0

  const baseCols = 'id, handle, username, email, color, avatar, bio, favorite_genres'

  // Служебные/тестовые аккаунты не должны появляться в поиске друзей
  const HIDDEN_FILTER = "role != 'admin' AND LOWER(username) NOT IN ('test', 'adminkino2026') AND LOWER(handle) NOT IN ('test', 'adminkino2026')"

  if (!hasQuery && !hasGenres) {
    return db.prepare(`
      SELECT ${baseCols}
      FROM users
      WHERE id != ? AND COALESCE(is_banned, 0) = 0 AND ${HIDDEN_FILTER}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(excludeId || '', limit)
  }

  const conditions = ['id != ?', 'COALESCE(is_banned, 0) = 0', HIDDEN_FILTER]
  const params = [excludeId || '']

  if (hasQuery) {
    conditions.push('(LOWER(username) LIKE ? OR LOWER(email) LIKE ?)')
    params.push(normalized, normalized)
  }

  const rows = db.prepare(`
    SELECT ${baseCols}
    FROM users
    WHERE ${conditions.join(' AND ')}
    ORDER BY username COLLATE NOCASE ASC
    LIMIT ?
  `).all(...params, hasGenres ? Math.max(limit * 4, 80) : limit)

  if (!hasGenres) return rows

  // Ранжируем по числу совпавших жанров
  const wantedSet = new Set(genreIds.map(value => Number(value)).filter(Number.isInteger))
  const ranked = rows
    .map(row => {
      const userGenres = parseFavoriteGenres(row.favorite_genres)
      let matches = 0
      for (const genre of userGenres) {
        if (wantedSet.has(genre)) matches += 1
      }
      return { row, matches }
    })
    .filter(entry => entry.matches > 0)
    .sort((a, b) => b.matches - a.matches)
    .slice(0, limit)
    .map(entry => ({ ...entry.row, _genreMatches: entry.matches }))
  return ranked
}

export function getFriendshipRecord(userId, otherId) {
  if (!userId || !otherId || userId === otherId) return null
  const [a, b] = friendshipPair(userId, otherId)
  return db.prepare(`
    SELECT id, user_a as userA, user_b as userB, requester_id as requesterId,
           status, created_at as createdAt, updated_at as updatedAt
    FROM friendships
    WHERE user_a = ? AND user_b = ?
  `).get(a, b)
}

export function getFriendshipStatus(userId, otherId) {
  const record = getFriendshipRecord(userId, otherId)
  if (!record) return { status: 'none' }
  if (record.status === 'accepted') return { status: 'friends', record }
  if (record.requesterId === userId) return { status: 'pending_outgoing', record }
  return { status: 'pending_incoming', record }
}

export function getFriendsForUser(userId) {
  return db.prepare(`
    SELECT u.id, u.handle, u.username, u.email, u.color, u.avatar, u.bio, u.favorite_genres,
           f.updated_at as friendsSince
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
    WHERE f.status = 'accepted'
      AND (f.user_a = ? OR f.user_b = ?)
      AND COALESCE(u.is_banned, 0) = 0
    ORDER BY u.username COLLATE NOCASE ASC
  `).all(userId, userId, userId)
}

export function getIncomingFriendRequests(userId) {
  return db.prepare(`
    SELECT u.id, u.handle, u.username, u.email, u.color, u.avatar, u.bio, u.favorite_genres, f.created_at as createdAt
    FROM friendships f
    JOIN users u ON u.id = f.requester_id
    WHERE f.status = 'pending'
      AND f.requester_id != ?
      AND (f.user_a = ? OR f.user_b = ?)
      AND COALESCE(u.is_banned, 0) = 0
    ORDER BY f.created_at DESC
  `).all(userId, userId, userId)
}

export function getOutgoingFriendRequests(userId) {
  return db.prepare(`
    SELECT u.id, u.handle, u.username, u.email, u.color, u.avatar, u.bio, u.favorite_genres, f.created_at as createdAt
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
    WHERE f.status = 'pending'
      AND f.requester_id = ?
      AND (f.user_a = ? OR f.user_b = ?)
      AND COALESCE(u.is_banned, 0) = 0
    ORDER BY f.created_at DESC
  `).all(userId, userId, userId, userId)
}

export function createFriendRequest(requesterId, targetId) {
  if (!requesterId || !targetId || requesterId === targetId) {
    throw new Error('Некорректные пользователи')
  }
  const targetUser = getUserById(targetId)
  if (!targetUser) throw new Error('Пользователь не найден')

  const existing = getFriendshipRecord(requesterId, targetId)
  if (existing) {
    if (existing.status === 'accepted') {
      return { record: existing, alreadyFriends: true }
    }
    if (existing.requesterId === requesterId) {
      return { record: existing, alreadySent: true }
    }
    // The other side already sent a request — auto-accept
    return acceptFriendRequest(requesterId, targetId)
  }

  const [a, b] = friendshipPair(requesterId, targetId)
  const now = Date.now()
  db.prepare(`
    INSERT INTO friendships (user_a, user_b, requester_id, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `).run(a, b, requesterId, now, now)
  return { record: getFriendshipRecord(requesterId, targetId), created: true }
}

export function acceptFriendRequest(userId, otherId) {
  const record = getFriendshipRecord(userId, otherId)
  if (!record) throw new Error('Запрос не найден')
  if (record.status === 'accepted') return { record, alreadyFriends: true }
  if (record.requesterId === userId) throw new Error('Нельзя принять собственный запрос')

  const now = Date.now()
  db.prepare(`
    UPDATE friendships
    SET status = 'accepted', updated_at = ?
    WHERE id = ?
  `).run(now, record.id)

  return { record: getFriendshipRecord(userId, otherId), accepted: true }
}

export function declineFriendRequest(userId, otherId) {
  const record = getFriendshipRecord(userId, otherId)
  if (!record) return { removed: false }
  if (record.status === 'accepted') throw new Error('Запрос уже принят')
  db.prepare('DELETE FROM friendships WHERE id = ?').run(record.id)
  return { removed: true, record }
}

export function removeFriendship(userId, otherId) {
  const record = getFriendshipRecord(userId, otherId)
  if (!record) return { removed: false }
  db.prepare('DELETE FROM friendships WHERE id = ?').run(record.id)
  return { removed: true, record }
}

// ==================== ЛИЧНЫЕ СООБЩЕНИЯ ====================

export function insertDirectMessage({ senderId, recipientId, text, messageType }) {
  const now = Date.now()
  const type = messageType || 'text'
  const info = db.prepare(`
    INSERT INTO direct_messages (sender_id, recipient_id, text, message_type, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(senderId, recipientId, text, type, now)
  return getDirectMessageById(Number(info.lastInsertRowid))
}

export function getDirectMessageById(id) {
  return db.prepare(`
    SELECT id, sender_id as senderId, recipient_id as recipientId,
           text, message_type as messageType, created_at as createdAt, read_at as readAt
    FROM direct_messages
    WHERE id = ?
  `).get(id)
}

export function getConversationMessages(userA, userB, { limit = 100, beforeId = null } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100))
  if (beforeId) {
    return db.prepare(`
      SELECT id, sender_id as senderId, recipient_id as recipientId,
             text, message_type as messageType, created_at as createdAt, read_at as readAt
      FROM direct_messages
      WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
        AND id < ?
      ORDER BY id DESC
      LIMIT ?
    `).all(userA, userB, userB, userA, Number(beforeId), safeLimit).reverse()
  }
  return db.prepare(`
    SELECT id, sender_id as senderId, recipient_id as recipientId,
           text, message_type as messageType, created_at as createdAt, read_at as readAt
    FROM direct_messages
    WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
    ORDER BY id DESC
    LIMIT ?
  `).all(userA, userB, userB, userA, safeLimit).reverse()
}

export function markConversationRead(userId, otherUserId) {
  const now = Date.now()
  const info = db.prepare(`
    UPDATE direct_messages
    SET read_at = ?
    WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL
  `).run(now, userId, otherUserId)
  return info.changes
}

export function getTotalUnreadCount(userId) {
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM direct_messages
    WHERE recipient_id = ? AND read_at IS NULL
  `).get(userId)
  return row?.count || 0
}

export function getConversationSummaries(userId) {
  // Returns one row per other-user with the last message, unread count
  return db.prepare(`
    WITH last_msg AS (
      SELECT
        CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS other_id,
        id,
        sender_id,
        recipient_id,
        text,
        message_type,
        created_at,
        read_at,
        ROW_NUMBER() OVER (
          PARTITION BY CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END
          ORDER BY id DESC
        ) AS rn
      FROM direct_messages
      WHERE sender_id = ? OR recipient_id = ?
    )
    SELECT
      u.id as id,
      u.username as username,
      u.color as color,
      u.avatar as avatar,
      m.id as messageId,
      m.sender_id as senderId,
      m.recipient_id as recipientId,
      m.text as text,
      m.message_type as messageType,
      m.created_at as createdAt,
      m.read_at as readAt,
      (
        SELECT COUNT(*) FROM direct_messages d
        WHERE d.recipient_id = ? AND d.sender_id = u.id AND d.read_at IS NULL
      ) as unread
    FROM last_msg m
    JOIN users u ON u.id = m.other_id
    WHERE m.rn = 1
      AND COALESCE(u.is_banned, 0) = 0
    ORDER BY m.created_at DESC
  `).all(userId, userId, userId, userId, userId)
}

export default db
