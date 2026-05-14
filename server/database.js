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

console.log('✅ База данных инициализирована:', dbPath)

// ==================== ПОЛЬЗОВАТЕЛИ ====================

export function createUser({ id, email, username, password, color }) {
  const stmt = db.prepare(`
    INSERT INTO users (id, email, username, password, color)
    VALUES (?, ?, ?, ?, ?)
  `)
  stmt.run(id, email, username, password, color)
  return getUserById(id)
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id)
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email)
}

export function updateUser(id, { username, bio, avatar, banner }) {
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

  if (fields.length === 0) return getUserById(id)

  values.push(id)
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getUserById(id)
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

export function logChatMessage({ roomId, userId, username, messageType, text, createdAt }) {
  db.prepare(`
    INSERT INTO chat_logs (room_id, user_id, username, message_type, text, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(roomId, userId, username, messageType, text, createdAt)
}

export function getUserMessageHistory(userId, limit = 200) {
  return db.prepare(`
    SELECT id,
           room_id as roomId,
           user_id as userId,
           username,
           message_type as messageType,
           text,
           created_at as createdAt
    FROM chat_logs
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit)
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

export default db
