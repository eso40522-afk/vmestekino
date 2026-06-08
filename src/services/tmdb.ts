// TMDB API Service
// Документация: https://developer.themoviedb.org/docs

import { API_URL } from '../config/api'

export interface TMDBMovie {
  id: number
  title: string
  original_title: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  release_date: string
  vote_average: number
  vote_count: number
  genre_ids: number[]
  popularity: number
  adult: boolean
  runtime?: number
}

export interface TMDBMovieDetails extends TMDBMovie {
  runtime: number
  genres: { id: number; name: string }[]
  tagline: string
  status: string
  budget: number
  revenue: number
  production_companies: { id: number; name: string; logo_path: string | null }[]
}

export interface TMDBResponse {
  page: number
  results: TMDBMovie[]
  total_pages: number
  total_results: number
}

export interface TMDBGenre {
  id: number
  name: string
}

type MovieFilterCategory = 'popular' | 'top_rated' | 'now_playing' | 'upcoming'

// Маппинг жанров на русский
const genreTranslations: Record<number, string> = {
  28: 'Боевик',
  12: 'Приключения',
  16: 'Анимация',
  35: 'Комедия',
  80: 'Криминал',
  99: 'Документальный',
  18: 'Драма',
  10751: 'Семейный',
  14: 'Фэнтези',
  36: 'История',
  27: 'Ужасы',
  10402: 'Музыка',
  9648: 'Детектив',
  10749: 'Мелодрама',
  878: 'Фантастика',
  10770: 'ТВ фильм',
  53: 'Триллер',
  10752: 'Военный',
  37: 'Вестерн'
}

function buildPlaceholderImage(width: string, height: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#1f2937"/><text x="50%" y="50%" fill="#e5e7eb" font-family="Arial, sans-serif" font-size="24" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

// Получить URL постера
export function getPosterUrl(path: string | null, size: 'w185' | 'w342' | 'w500' | 'original' = 'w342'): string {
  if (!path) return buildPlaceholderImage('342', '513', 'No Poster')
  return `${API_URL}/tmdb/image?size=${size}&path=${encodeURIComponent(path)}`
}

// Получить URL фона
export function getBackdropUrl(path: string | null, size: 'w780' | 'w1280' | 'original' = 'w1280'): string {
  if (!path) return ''
  return `${API_URL}/tmdb/image?size=${size}&path=${encodeURIComponent(path)}`
}

// Получить название жанра на русском
export function getGenreName(genreId: number): string {
  return genreTranslations[genreId] || 'Другое'
}

// Форматирование даты
export function formatReleaseDate(date: string): string {
  if (!date) return 'Неизвестно'
  return new Date(date).getFullYear().toString()
}

// Форматирование длительности
export function formatRuntime(minutes: number): string {
  if (!minutes) return ''
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return hours > 0 ? `${hours} ч ${mins} мин` : `${mins} мин`
}

// API запросы
async function fetchTMDB<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${API_URL}/tmdb`)
  url.searchParams.append('endpoint', endpoint)
  url.searchParams.append('language', 'ru-RU')
  
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value)
  })

  const response = await fetch(url.toString())
  
  if (!response.ok) {
    throw new Error(`TMDB API Error: ${response.status}`)
  }
  
  return response.json()
}

// Фильтр: показываем только фильмы с кириллическим названием.
const CYRILLIC_RE = /[А-яЁё]/
// Чёрный список слов в названии (порно/эротика/18+).
const BLOCKED_TITLE_RE = /(порно|секс|эрот|оргия|оргии|интим|18\+|xxx|порн)/i
// Минимальный порог оценки и количества голосов — отсеивает мусорные/непопулярные фильмы.
const MIN_VOTE_COUNT = 50
const MIN_VOTE_AVG = 5
export function hasCyrillicTitle(movie: { title?: string | null }): boolean {
  return Boolean(movie?.title && CYRILLIC_RE.test(movie.title))
}
export function isAllowedMovie(movie: TMDBMovie): boolean {
  if (movie.adult) return false
  if (!hasCyrillicTitle(movie)) return false
  if (movie.title && BLOCKED_TITLE_RE.test(movie.title)) return false
  if (movie.original_title && BLOCKED_TITLE_RE.test(movie.original_title)) return false
  if ((movie.vote_count ?? 0) < MIN_VOTE_COUNT) return false
  if ((movie.vote_average ?? 0) < MIN_VOTE_AVG) return false
  return true
}
function filterCyrillicResponse(response: TMDBResponse): TMDBResponse {
  const filtered = (response.results || []).filter(isAllowedMovie)
  return { ...response, results: filtered }
}
async function fetchTMDBList(endpoint: string, params: Record<string, string> = {}): Promise<TMDBResponse> {
  const data = await fetchTMDB<TMDBResponse>(endpoint, params)
  return filterCyrillicResponse(data)
}

// Получить популярные фильмы
export async function getPopularMovies(page: number = 1): Promise<TMDBResponse> {
  return fetchTMDBList('/movie/popular', { page: page.toString() })
}

// Получить топ рейтинга
export async function getTopRatedMovies(page: number = 1): Promise<TMDBResponse> {
  return fetchTMDBList('/movie/top_rated', { page: page.toString() })
}

function toDateParam(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// Получить сейчас в кино — точная фильтрация по дате выхода через discover.
// Берём фильмы, вышедшие за последние ~45 дней и до сегодня.
export async function getNowPlayingMovies(page: number = 1): Promise<TMDBResponse> {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - 45)
  return fetchTMDBList('/discover/movie', {
    page: page.toString(),
    sort_by: 'popularity.desc',
    'primary_release_date.gte': toDateParam(start),
    'primary_release_date.lte': toDateParam(today),
    with_release_type: '2|3',
    include_adult: 'false'
  })
}

// Получить скоро в кино — фильмы с датой выхода строго в будущем.
export async function getUpcomingMovies(page: number = 1): Promise<TMDBResponse> {
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const horizon = new Date(today)
  horizon.setMonth(today.getMonth() + 6)
  return fetchTMDBList('/discover/movie', {
    page: page.toString(),
    sort_by: 'primary_release_date.asc',
    'primary_release_date.gte': toDateParam(tomorrow),
    'primary_release_date.lte': toDateParam(horizon),
    with_release_type: '2|3',
    include_adult: 'false'
  })
}

// Поиск фильмов
export async function searchMovies(query: string, page: number = 1): Promise<TMDBResponse> {
  return fetchTMDBList('/search/movie', {
    query,
    page: page.toString(),
    include_adult: 'false'
  })
}

// Получить детали фильма
export async function getMovieDetails(movieId: number): Promise<TMDBMovieDetails> {
  return fetchTMDB<TMDBMovieDetails>(`/movie/${movieId}`)
}

// Видео (трейлеры, тизеры) с YouTube
export interface TMDBVideo {
  id: string
  key: string
  name: string
  site: string // 'YouTube' | 'Vimeo'
  type: string // 'Trailer' | 'Teaser' | 'Clip' | 'Featurette' | ...
  official: boolean
  size: number
  iso_639_1: string
  published_at: string
}

export interface TMDBVideosResponse {
  id: number
  results: TMDBVideo[]
}

// Унифицированный трейлер для UI:
// - 'rutube': embed-iframe с RuTube (работает в РФ без VPN)
// - 'youtube': классический YouTube embed (fallback)
// - 'direct':  прямая ссылка на mp4 (Kinopoisk/Yandex CDN)
export interface UnifiedTrailer {
  kind: 'rutube' | 'youtube' | 'direct'
  /** YouTube key — присутствует только при kind === 'youtube' */
  key?: string
  /** Прямая ссылка / RuTube embed URL */
  url?: string
  name: string
  /** Метка источника для отладки и UI ("RuTube" / "YouTube" / "Кинопоиск") */
  source: string
}

// Получить список видео для фильма. Пробуем сначала русские,
// затем fallback на английские, если русских нет.
export async function getMovieVideos(movieId: number): Promise<TMDBVideo[]> {
  const ru = await fetchTMDB<TMDBVideosResponse>(`/movie/${movieId}/videos`)
  if (ru.results && ru.results.length > 0) return ru.results
  try {
    const url = new URL(`${API_URL}/tmdb`)
    url.searchParams.append('endpoint', `/movie/${movieId}/videos`)
    url.searchParams.append('language', 'en-US')
    const response = await fetch(url.toString())
    if (!response.ok) return []
    const en = (await response.json()) as TMDBVideosResponse
    return en.results || []
  } catch {
    return []
  }
}

// Выбрать лучший трейлер: официальный YouTube Trailer > любой Trailer > Teaser > первый Clip.
export function pickBestTrailer(videos: TMDBVideo[]): TMDBVideo | null {
  if (!videos || videos.length === 0) return null
  const yt = videos.filter(v => v.site === 'YouTube')
  if (yt.length === 0) return null
  const officialTrailer = yt.find(v => v.type === 'Trailer' && v.official)
  if (officialTrailer) return officialTrailer
  const anyTrailer = yt.find(v => v.type === 'Trailer')
  if (anyTrailer) return anyTrailer
  const teaser = yt.find(v => v.type === 'Teaser')
  if (teaser) return teaser
  return yt[0]
}

// Получить трейлеры через наш backend (RuTube > Kinopoisk).
// Backend: GET /api/movie-trailers/:tmdbId -> { videos: [{ url, name, site }], source }
export async function getRussianTrailers(movieId: number): Promise<UnifiedTrailer[]> {
  try {
    const response = await fetch(`${API_URL}/movie-trailers/${movieId}`)
    if (!response.ok) return []
    const data = (await response.json()) as {
      videos?: Array<{ url: string; name: string; site: string }>
    }
    if (!Array.isArray(data.videos)) return []
    return data.videos.map(v => {
      const site = String(v.site || '').toUpperCase()
      if (site === 'RUTUBE') {
        return {
          kind: 'rutube' as const,
          url: v.url,
          name: v.name || 'Трейлер',
          source: 'RuTube'
        }
      }
      const label = site === 'KINOPOISK' ? 'Кинопоиск'
        : site === 'YANDEX_DISK' ? 'Яндекс.Диск'
        : site || 'Прямая ссылка'
      return {
        kind: 'direct' as const,
        url: v.url,
        name: v.name || 'Трейлер',
        source: label
      }
    })
  } catch {
    return []
  }
}

// Единая точка получения лучшего трейлера:
// сначала RuTube/Кинопоиск (работает в РФ), и только если пусто — fallback на YouTube.
export async function getBestUnifiedTrailer(movieId: number): Promise<UnifiedTrailer | null> {
  const russian = await getRussianTrailers(movieId)
  if (russian.length > 0) return russian[0]
  const tmdbVideos = await getMovieVideos(movieId)
  const yt = pickBestTrailer(tmdbVideos)
  if (yt) {
    return { kind: 'youtube', key: yt.key, name: yt.name, source: 'YouTube' }
  }
  return null
}

// Получить внешние ID (включая Kinopoisk)
export interface ExternalIds {
  imdb_id: string | null
  wikidata_id: string | null
  facebook_id: string | null
  instagram_id: string | null
  twitter_id: string | null
}

export async function getMovieExternalIds(movieId: number): Promise<ExternalIds> {
  return fetchTMDB<ExternalIds>(`/movie/${movieId}/external_ids`)
}

// Получить Kinopoisk ID по IMDB ID (через поиск)
export async function getKinopoiskId(tmdbId: number, imdbId?: string): Promise<string | null> {
  // TMDB не хранит напрямую Kinopoisk ID
  // Но мы можем использовать IMDB ID для поиска в других сервисах
  // Или использовать сопоставление TMDB -> KP через внешние API
  
  try {
    // Получаем IMDB ID если не передан
    if (!imdbId) {
      const externalIds = await getMovieExternalIds(tmdbId)
      imdbId = externalIds.imdb_id || undefined
    }
    
    // Для демо: используем поиск по названию фильма в Кинопоиске
    // В реальном приложении нужно использовать маппинг TMDB -> KP
    // или API Кинопоиска
    
    // Возвращаем IMDB ID как fallback (многие балансеры его поддерживают)
    return imdbId || null
  } catch (error) {
    console.error('Error getting Kinopoisk ID:', error)
    return null
  }
}

// Получить похожие фильмы
export async function getSimilarMovies(movieId: number, page: number = 1): Promise<TMDBResponse> {
  return fetchTMDBList(`/movie/${movieId}/similar`, { page: page.toString() })
}

// Актёрский состав
export interface TMDBCast {
  id: number
  name: string
  character: string
  profile_path: string | null
  known_for_department: string
}

export interface TMDBCrew {
  id: number
  name: string
  job: string
  department: string
  profile_path: string | null
}

export interface TMDBCredits {
  cast: TMDBCast[]
  crew: TMDBCrew[]
}

export async function getMovieCredits(movieId: number): Promise<TMDBCredits> {
  return fetchTMDB<TMDBCredits>(`/movie/${movieId}/credits`)
}

// Получить фильмы по жанру
export async function getMoviesByGenre(
  genreId: number,
  page: number = 1,
  category: MovieFilterCategory = 'popular'
): Promise<TMDBResponse> {
  return discoverMovies({ genreId, page, category })
}

// Универсальный discover с поддержкой одного или нескольких жанров, категории и диапазона годов.
export async function discoverMovies(opts: {
  genreId?: number | null
  genreIds?: number[] | null
  page?: number
  category?: MovieFilterCategory
  yearFrom?: number | null
  yearTo?: number | null
}): Promise<TMDBResponse> {
  const { genreId, genreIds, page = 1, category = 'popular', yearFrom, yearTo } = opts
  const today = new Date()
  const nowStart = new Date(today)
  const upcomingEnd = new Date(today)

  nowStart.setDate(today.getDate() - 45)
  upcomingEnd.setMonth(today.getMonth() + 6)

  const formatDateParam = (date: Date) => date.toISOString().slice(0, 10)

  const params: Record<string, string> = {
    page: page.toString(),
    sort_by: 'popularity.desc',
    include_adult: 'false'
  }

  // TMDB: запятая = AND, вертикальная черта = OR. Используем AND, чтобы
  // выборка по двум жанрам сужала результаты, а не расширяла их.
  const genreList = (genreIds && genreIds.length > 0 ? genreIds : (genreId ? [genreId] : []))
    .filter(id => Number.isFinite(id))
    .map(id => String(id))
  if (genreList.length > 0) {
    params.with_genres = genreList.join(',')
  }

  if (category === 'top_rated') {
    params.sort_by = 'vote_average.desc'
    params['vote_count.gte'] = '300'
  }

  if (category === 'now_playing') {
    params['primary_release_date.gte'] = formatDateParam(nowStart)
    params['primary_release_date.lte'] = formatDateParam(today)
    params.with_release_type = '2|3'
  }

  if (category === 'upcoming') {
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)
    params['primary_release_date.gte'] = formatDateParam(tomorrow)
    params['primary_release_date.lte'] = formatDateParam(upcomingEnd)
    params.sort_by = 'primary_release_date.asc'
    params.with_release_type = '2|3'
  }

  // Диапазон годов имеет приоритет над авто-датами категорий now_playing/upcoming.
  if (yearFrom) {
    params['primary_release_date.gte'] = `${yearFrom}-01-01`
  }
  if (yearTo) {
    params['primary_release_date.lte'] = `${yearTo}-12-31`
  }

  return fetchTMDBList('/discover/movie', params)
}

// Получить лучшие фильмы по жанру (для рекомендаций)
export async function getTopRatedByGenre(genreId: number, page: number = 1): Promise<TMDBResponse> {
  return fetchTMDBList('/discover/movie', {
    with_genres: genreId.toString(),
    page: page.toString(),
    sort_by: 'vote_average.desc',
    'vote_count.gte': '300'
  })
}

// Получить URL фото актёра
export function getProfileUrl(path: string | null, size: 'w185' | 'w342' | 'original' = 'w185'): string {
  if (!path) return ''
  return `${API_URL}/tmdb/image?size=${size}&path=${encodeURIComponent(path)}`
}

// Получить список жанров
export async function getGenres(): Promise<TMDBGenre[]> {
  const response = await fetchTMDB<{ genres: TMDBGenre[] }>('/genre/movie/list')
  return response.genres
}

// Категории для фильтрации
export const movieCategories = [
  { id: 'popular', name: 'Популярные', fetch: getPopularMovies },
  { id: 'top_rated', name: 'Лучшие', fetch: getTopRatedMovies }
]

// Жанры для фильтрации
export const movieGenres = [
  { id: 28, name: 'Боевик' },
  { id: 12, name: 'Приключения' },
  { id: 16, name: 'Анимация' },
  { id: 35, name: 'Комедия' },
  { id: 80, name: 'Криминал' },
  { id: 99, name: 'Документальный' },
  { id: 18, name: 'Драма' },
  { id: 10751, name: 'Семейный' },
  { id: 14, name: 'Фэнтези' },
  { id: 27, name: 'Ужасы' },
  { id: 9648, name: 'Детектив' },
  { id: 10749, name: 'Мелодрама' },
  { id: 878, name: 'Фантастика' },
  { id: 53, name: 'Триллер' },
  { id: 10752, name: 'Военный' }
]
