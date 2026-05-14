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

// Получить популярные фильмы
export async function getPopularMovies(page: number = 1): Promise<TMDBResponse> {
  return fetchTMDB<TMDBResponse>('/movie/popular', { page: page.toString() })
}

// Получить топ рейтинга
export async function getTopRatedMovies(page: number = 1): Promise<TMDBResponse> {
  return fetchTMDB<TMDBResponse>('/movie/top_rated', { page: page.toString() })
}

// Получить сейчас в кино
export async function getNowPlayingMovies(page: number = 1): Promise<TMDBResponse> {
  return fetchTMDB<TMDBResponse>('/movie/now_playing', { page: page.toString() })
}

// Получить скоро в кино
export async function getUpcomingMovies(page: number = 1): Promise<TMDBResponse> {
  return fetchTMDB<TMDBResponse>('/movie/upcoming', { page: page.toString() })
}

// Поиск фильмов
export async function searchMovies(query: string, page: number = 1): Promise<TMDBResponse> {
  return fetchTMDB<TMDBResponse>('/search/movie', { 
    query, 
    page: page.toString(),
    include_adult: 'false'
  })
}

// Получить детали фильма
export async function getMovieDetails(movieId: number): Promise<TMDBMovieDetails> {
  return fetchTMDB<TMDBMovieDetails>(`/movie/${movieId}`)
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
  return fetchTMDB<TMDBResponse>(`/movie/${movieId}/similar`, { page: page.toString() })
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
  const today = new Date()
  const releaseStart = new Date(today)
  const releaseEnd = new Date(today)

  releaseStart.setDate(today.getDate() - 60)
  releaseEnd.setDate(today.getDate() + 30)

  const formatDateParam = (date: Date) => date.toISOString().slice(0, 10)

  const params: Record<string, string> = {
    with_genres: genreId.toString(),
    page: page.toString(),
    sort_by: 'popularity.desc'
  }

  if (category === 'top_rated') {
    params.sort_by = 'vote_average.desc'
    params['vote_count.gte'] = '300'
  }

  if (category === 'now_playing') {
    params['primary_release_date.gte'] = formatDateParam(releaseStart)
    params['primary_release_date.lte'] = formatDateParam(releaseEnd)
  }

  if (category === 'upcoming') {
    params['primary_release_date.gte'] = formatDateParam(today)
  }

  return fetchTMDB<TMDBResponse>('/discover/movie', params)
}

// Получить лучшие фильмы по жанру (для рекомендаций)
export async function getTopRatedByGenre(genreId: number, page: number = 1): Promise<TMDBResponse> {
  return fetchTMDB<TMDBResponse>('/discover/movie', {
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
  { id: 'top_rated', name: 'Лучшие', fetch: getTopRatedMovies },
  { id: 'now_playing', name: 'Сейчас в кино', fetch: getNowPlayingMovies },
  { id: 'upcoming', name: 'Скоро', fetch: getUpcomingMovies }
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
