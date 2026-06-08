import { useState, useEffect, useCallback, useRef } from 'react'
import {
  type TMDBMovie,
  type TMDBMovieDetails,
  getPopularMovies,
  getTopRatedMovies,
  getNowPlayingMovies,
  getUpcomingMovies,
  searchMovies,
  discoverMovies,
  getMovieDetails,
  getPosterUrl,
  getGenreName,
  formatReleaseDate,
  movieCategories,
  movieGenres
} from '../services/tmdb'
import { useAuth } from '../contexts/AuthContext'
import { API_URL } from '../config/api'
import { MoviePage } from './MoviePage'
import './TMDBLibrary.css'

export interface SelectedMovieData extends TMDBMovieDetails {
  videoUrl: string
  kinopoiskId?: string | null
  imdbId?: string | null
  useEmbed?: boolean
  sourceType?: 'html5' | 'youtube' | 'embed' | 'rutube' | 'vkvideo'
}

interface MovieOpenInfo {
  id: number
  title?: string | null
  originalTitle?: string | null
  year?: string | number | null
}

interface TMDBLibraryProps {
  onSelectMovie: (movie: SelectedMovieData) => void
  showFavorites?: boolean
  initialMovieId?: number | null
  onClearInitialMovie?: () => void
  /** Called when a movie page is opened — parent updates the URL slug. */
  onMovieOpen?: (movie: MovieOpenInfo) => void
  /** Called when the movie page is closed — parent navigates back to the list. */
  onMovieClose?: () => void
  onCreateRoom?: (isPrivate: boolean) => void
}

type CategoryType = 'popular' | 'top_rated' | 'now_playing' | 'upcoming' | 'favorites' | 'catalog'

const MAX_GENRES = 2

interface CatalogSource {
  tmdbId: string
  imdbId?: string | null
  sourceType: string
  title?: string | null
  posterPath?: string | null
  updatedAt?: string | null
}

interface FavoriteMovie {
  movieId: string
  title: string
  posterPath: string
  year: string
  voteAverage: number
  genreNames: string
  addedAt: string
}

function resolveFavoritePosterUrl(posterPath: string): string {
  if (!posterPath) {
    return getPosterUrl(null, 'w500')
  }

  if (/^(https?:|data:)/i.test(posterPath) || posterPath.startsWith('/api/') || posterPath.startsWith('/uploads/')) {
    return posterPath
  }

  return getPosterUrl(posterPath, 'w500')
}

export function TMDBLibrary({ onSelectMovie, showFavorites, initialMovieId, onClearInitialMovie, onMovieOpen, onMovieClose, onCreateRoom }: TMDBLibraryProps) {
  const { token } = useAuth()
  const YEAR_MIN = 1950
  const YEAR_MAX = new Date().getFullYear()
  const [movies, setMovies] = useState<TMDBMovie[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<CategoryType>('popular')
  const [selectedGenres, setSelectedGenres] = useState<number[]>([])
  const [yearFrom, setYearFrom] = useState<number>(YEAR_MIN)
  const [yearTo, setYearTo] = useState<number>(YEAR_MAX)
  const [yearFromInput, setYearFromInput] = useState<string>(String(YEAR_MIN))
  const [yearToInput, setYearToInput] = useState<string>(String(YEAR_MAX))
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [moviePageId, setMoviePageId] = useState<number | null>(null)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [favorites, setFavorites] = useState<FavoriteMovie[]>([])
  const [loadingFavorites, setLoadingFavorites] = useState(false)
  const [animatingFavId, setAnimatingFavId] = useState<string | null>(null)

  // Каталог фильмов, для которых админ привязал источник (RuTube, embed, html5 и т. п.).
  const [catalogMovies, setCatalogMovies] = useState<TMDBMovie[]>([])
  const [catalogSourceTypes, setCatalogSourceTypes] = useState<Map<number, string>>(new Map())
  const [loadingCatalog, setLoadingCatalog] = useState(false)

  // Sync movie page state with URL-driven initialMovieId (slug source of truth).
  useEffect(() => {
    setMoviePageId(initialMovieId ?? null)
    if (initialMovieId) onClearInitialMovie?.()
  }, [initialMovieId])

  // Sync showFavorites prop with selectedCategory
  useEffect(() => {
    if (showFavorites) {
      setMoviePageId(null)
      setSelectedCategory('favorites')
    } else if (selectedCategory === 'favorites') {
      setSelectedCategory('popular')
    }
  }, [showFavorites])

  // Загрузка избранных ID
  useEffect(() => {
    if (!token) { setFavoriteIds(new Set()); return }
    fetch(`${API_URL}/favorites/ids`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setFavoriteIds(new Set(data.ids?.map(String) ?? [])))
      .catch(() => {})
  }, [token])

  // Переключение избранного
  const toggleFavorite = async (e: React.MouseEvent, movie: TMDBMovie) => {
    e.stopPropagation()
    if (!token) return
    const id = String(movie.id)
    const isFav = favoriteIds.has(id)

    // Optimistic update
    setFavoriteIds(prev => {
      const next = new Set(prev)
      isFav ? next.delete(id) : next.add(id)
      return next
    })

    // Trigger bounce animation
    if (!isFav) {
      setAnimatingFavId(id)
      setTimeout(() => setAnimatingFavId(null), 500)
    }

    try {
      if (isFav) {
        await fetch(`${API_URL}/favorites/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      } else {
        await fetch(`${API_URL}/favorites`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            movieId: id,
            title: movie.title,
            posterPath: movie.poster_path || '',
            year: formatReleaseDate(movie.release_date),
            voteAverage: movie.vote_average,
            genreNames: movie.genre_ids.slice(0, 2).map(gid => getGenreName(gid)).join(', ')
          })
        })
      }
    } catch {
      // Revert on error
      setFavoriteIds(prev => {
        const next = new Set(prev)
        isFav ? next.add(id) : next.delete(id)
        return next
      })
    }
  }

  // Загрузка списка избранных
  const loadFavorites = useCallback(async () => {
    if (!token) return
    setLoadingFavorites(true)
    try {
      const res = await fetch(`${API_URL}/favorites`, { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      setFavorites(data.favorites || [])
    } catch { /* */ } finally {
      setLoadingFavorites(false)
    }
  }, [token])

  // Загрузка фильмов
  const ITEMS_PER_PAGE = 24

  // Каталог: грузим один раз и кэшируем (для фильтра «Доступно онлайн»).
  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true)
    try {
      const res = await fetch(`${API_URL}/video-sources/catalog`)
      if (!res.ok) throw new Error('catalog request failed')
      const data = await res.json() as { sources?: CatalogSource[] }
      const sources = (data.sources || []).filter(src => Number.isFinite(Number(src.tmdbId)))

      // Маппинг tmdbId -> sourceType для отображения плашки источника на карточке.
      const typesMap = new Map<number, string>()
      sources.forEach(src => {
        typesMap.set(Number(src.tmdbId), String(src.sourceType || '').toLowerCase())
      })
      setCatalogSourceTypes(typesMap)

      // Заглушки сразу, чтобы пользователь видел список — детали догрузим параллельно.
      const placeholderMovies: TMDBMovie[] = sources.map(src => ({
        id: Number(src.tmdbId),
        title: src.title || 'Без названия',
        original_title: src.title || '',
        overview: '',
        poster_path: src.posterPath || null,
        backdrop_path: null,
        release_date: '',
        vote_average: 0,
        vote_count: 0,
        genre_ids: [],
        popularity: 0,
        adult: false
      }))
      setCatalogMovies(placeholderMovies)

      // Догружаем детали TMDB (постер/год/жанры/рейтинг) с защитой от ошибок.
      const detailResults = await Promise.allSettled(
        placeholderMovies.map(movie => getMovieDetails(movie.id))
      )
      const enriched: TMDBMovie[] = placeholderMovies.map((movie, idx) => {
        const result = detailResults[idx]
        if (result.status !== 'fulfilled') return movie
        const details = result.value
        return {
          ...movie,
          title: details.title || movie.title,
          original_title: details.original_title || movie.original_title,
          overview: details.overview || '',
          poster_path: details.poster_path || movie.poster_path,
          backdrop_path: details.backdrop_path || null,
          release_date: details.release_date || '',
          vote_average: details.vote_average || 0,
          vote_count: details.vote_count || 0,
          genre_ids: Array.isArray(details.genres) ? details.genres.map(g => g.id) : []
        }
      })
      setCatalogMovies(enriched)
    } catch (error) {
      console.error('Ошибка загрузки каталога:', error)
      setCatalogMovies([])
    } finally {
      setLoadingCatalog(false)
    }
  }, [])

  const fetchTmdbPage = useCallback(async (tmdbPage: number) => {
    const yearActive = yearFrom > YEAR_MIN || yearTo < YEAR_MAX
    let response
    if (searchQuery.trim()) {
      response = await searchMovies(searchQuery, tmdbPage)
    } else if (selectedGenres.length > 0 || yearActive) {
      response = await discoverMovies({
        genreIds: selectedGenres,
        page: tmdbPage,
        category: (selectedCategory === 'favorites' || selectedCategory === 'catalog') ? 'popular' : selectedCategory,
        yearFrom: yearActive ? yearFrom : null,
        yearTo: yearActive ? yearTo : null
      })
    } else {
      switch (selectedCategory) {
        case 'top_rated':
          response = await getTopRatedMovies(tmdbPage)
          break
        case 'now_playing':
          response = await getNowPlayingMovies(tmdbPage)
          break
        case 'upcoming':
          response = await getUpcomingMovies(tmdbPage)
          break
        default:
          response = await getPopularMovies(tmdbPage)
      }
    }

    // Дополнительная клиентская фильтрация по году, чтобы отображаемый
    // release_date (региональный) совпадал с выбранным диапазоном.
    // TMDB фильтрует по primary_release_date (глобальный), который может
    // отличаться от regional release_date, который показывается в карточке.
    if (yearActive) {
      const filtered = (response.results || []).filter(movie => {
        if (!movie.release_date) return false
        const year = parseInt(movie.release_date.slice(0, 4), 10)
        if (!Number.isFinite(year)) return false
        return year >= yearFrom && year <= yearTo
      })
      return { ...response, results: filtered }
    }

    return response
  }, [searchQuery, selectedGenres, selectedCategory, yearFrom, yearTo, YEAR_MIN, YEAR_MAX])

  // Кэш накопленных страниц TMDB по ключу (категория|жанр|поиск).
  // Это даёт нам стабильную пагинацию по 24, без дубликатов и без «дыр» из-за фильтрации.
  type CacheEntry = {
    items: TMDBMovie[]
    seenIds: Set<number>
    nextTmdbPage: number
    totalTmdbPages: number
    exhausted: boolean
  }
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const cacheKey = `${selectedCategory}|${selectedGenres.join(',')}|${searchQuery.trim().toLowerCase()}|${yearFrom}-${yearTo}`

  // Сбрасываем кэш при изменении категории/жанров/года/поиска, чтобы не показывать
  // устаревшие данные и не накапливать пустые ответы при race-условиях StrictMode.
  useEffect(() => {
    cacheRef.current = new Map()
  }, [selectedCategory, selectedGenres, yearFrom, yearTo, searchQuery])

  const ensureItems = useCallback(async (key: string, neededCount: number): Promise<CacheEntry> => {
    let entry = cacheRef.current.get(key)
    if (!entry) {
      entry = { items: [], seenIds: new Set(), nextTmdbPage: 1, totalTmdbPages: 1, exhausted: false }
      cacheRef.current.set(key, entry)
    }
    // TMDB ограничивает выдачу 500 страницами.
    const MAX_TMDB_PAGES = 500
    // Защитный потолок на число подзапросов за один вызов, чтобы не подвиснуть.
    let safety = 30
    while (entry.items.length < neededCount && !entry.exhausted && safety-- > 0) {
      const pageToFetch = entry.nextTmdbPage
      let response
      try {
        response = await fetchTmdbPage(pageToFetch)
      } catch {
        entry.exhausted = true
        break
      }
      entry.totalTmdbPages = Math.min(response.total_pages ?? 1, MAX_TMDB_PAGES)
      for (const movie of response.results || []) {
        if (!entry.seenIds.has(movie.id)) {
          entry.seenIds.add(movie.id)
          entry.items.push(movie)
        }
      }
      entry.nextTmdbPage = pageToFetch + 1
      if (entry.nextTmdbPage > entry.totalTmdbPages) {
        entry.exhausted = true
      }
    }
    return entry
  }, [fetchTmdbPage])

  const loadMovies = useCallback(async () => {
    if (selectedCategory === 'favorites') {
      loadFavorites()
      return
    }
    if (selectedCategory === 'catalog') {
      // Catalog уже загружен отдельным эффектом — здесь только сбрасываем индикатор загрузки.
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const needed = page * ITEMS_PER_PAGE
      const entry = await ensureItems(cacheKey, needed)
      const startIndex = (page - 1) * ITEMS_PER_PAGE
      const sliced = entry.items.slice(startIndex, startIndex + ITEMS_PER_PAGE)
      setMovies(sliced)

      // Оценка общего числа страниц.
      // Пока не исчерпали TMDB: экстраполируем по доле прошедших фильтр.
      if (entry.exhausted) {
        setTotalPages(Math.max(1, Math.ceil(entry.items.length / ITEMS_PER_PAGE)))
      } else {
        const fetchedTmdbPages = entry.nextTmdbPage - 1
        const passRate = fetchedTmdbPages > 0 ? entry.items.length / fetchedTmdbPages : 0
        const estimatedItems = Math.round(passRate * entry.totalTmdbPages)
        const estimatedPages = Math.max(page + 1, Math.ceil(estimatedItems / ITEMS_PER_PAGE))
        setTotalPages(Math.min(estimatedPages, 500))
      }
    } catch (error) {
      console.error('Ошибка загрузки фильмов:', error)
    } finally {
      setLoading(false)
    }
  }, [cacheKey, ensureItems, page, loadFavorites, selectedCategory])

  useEffect(() => {
    loadMovies()
  }, [loadMovies])

  // Подгружаем каталог при первом входе в категорию «Доступно онлайн».
  useEffect(() => {
    if (selectedCategory === 'catalog' && catalogMovies.length === 0 && !loadingCatalog) {
      loadCatalog()
    }
  }, [selectedCategory, catalogMovies.length, loadingCatalog, loadCatalog])

  // Поиск с debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
    }, 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Выбор фильма — открываем страницу фильма (URL — источник истины через onMovieOpen)
  const handleMovieClick = (movie: TMDBMovie) => {
    if (onMovieOpen) {
      onMovieOpen({
        id: movie.id,
        title: movie.title,
        originalTitle: movie.original_title,
        year: movie.release_date
      })
    } else {
      setMoviePageId(movie.id)
    }
  }

  // Смена категории
  const handleCategoryChange = (category: CategoryType) => {
    setSelectedCategory(category)
    setSearchQuery('')
    setPage(1)
  }

  // Смена жанра (мульти-выбор до 2 жанров)
  const handleGenreChange = (genreId: number) => {
    setSelectedGenres(current => {
      if (current.includes(genreId)) {
        return current.filter(id => id !== genreId)
      }
      if (current.length >= MAX_GENRES) {
        // Заменяем самый старый выбор, чтобы всегда оставаться в пределах MAX_GENRES
        return [...current.slice(1), genreId]
      }
      return [...current, genreId]
    })
    setSearchQuery('')
    setPage(1)
  }

  // Изменение года: следим, чтобы from <= to
  const clampYear = (value: number) => Math.min(YEAR_MAX, Math.max(YEAR_MIN, value))
  const handleYearFromSlider = (value: number) => {
    const next = Math.min(value, yearTo)
    setYearFrom(next)
    setYearFromInput(String(next))
    setPage(1)
  }
  const handleYearToSlider = (value: number) => {
    const next = Math.max(value, yearFrom)
    setYearTo(next)
    setYearToInput(String(next))
    setPage(1)
  }
  const commitYearFromInput = () => {
    const num = parseInt(yearFromInput, 10)
    if (!Number.isFinite(num)) { setYearFromInput(String(yearFrom)); return }
    const next = Math.min(clampYear(num), yearTo)
    setYearFrom(next)
    setYearFromInput(String(next))
    setPage(1)
  }
  const commitYearToInput = () => {
    const num = parseInt(yearToInput, 10)
    if (!Number.isFinite(num)) { setYearToInput(String(yearTo)); return }
    const next = Math.max(clampYear(num), yearFrom)
    setYearTo(next)
    setYearToInput(String(next))
    setPage(1)
  }
  const resetYearRange = () => {
    setYearFrom(YEAR_MIN)
    setYearTo(YEAR_MAX)
    setYearFromInput(String(YEAR_MIN))
    setYearToInput(String(YEAR_MAX))
    setPage(1)
  }
  const yearActive = yearFrom > YEAR_MIN || yearTo < YEAR_MAX
  const sliderLeftPct = ((yearFrom - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100
  const sliderRightPct = ((yearTo - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100

  return (
    <div className="tmdb-library">
      {/* Movie Page View */}
      {moviePageId !== null ? (
        <MoviePage
          movieId={moviePageId}
          onBack={() => {
            if (onMovieClose) onMovieClose()
            else setMoviePageId(null)
          }}
          onSelectMovie={(movie) => {
            setMoviePageId(null)
            onSelectMovie(movie)
          }}
          onNavigateToMovie={(sim) => {
            if (onMovieOpen) {
              onMovieOpen({
                id: sim.id,
                title: sim.title,
                originalTitle: sim.original_title,
                year: sim.release_date
              })
            } else {
              setMoviePageId(sim.id)
            }
          }}
          onCreateRoom={onCreateRoom}
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
        />
      ) : (
      <>
      {/* Header */}
      <div className="tmdb-library__header">
        <div className="tmdb-library__heading">
          <h2 className="tmdb-library__title">{selectedCategory === 'favorites' ? 'Избранное' : 'Фильмы — смотреть онлайн'}</h2>
          <p className="tmdb-library__subtitle">Тысячи фильмов и сериалов для совместного просмотра с друзьями. Выбирайте, создавайте комнату и наслаждайтесь вместе.</p>
        </div>

        {/* Категории + фильтр по году */}
        {selectedCategory !== 'favorites' && (
        <div className="tmdb-library__controls">
          <div className="tmdb-library__categories">
            {movieCategories.map(cat => (
              <button
                key={cat.id}
                className={`tmdb-library__category-btn ${selectedCategory === cat.id ? 'active' : ''}`}
                onClick={() => handleCategoryChange(cat.id as CategoryType)}
              >
                {cat.name}
              </button>
            ))}
            <button
              type="button"
              className={`tmdb-library__category-btn tmdb-library__category-btn--catalog ${selectedCategory === 'catalog' ? 'active' : ''}`}
              onClick={() => handleCategoryChange('catalog')}
              title="Фильмы с подключённым источником воспроизведения"
            >
              <span className="tmdb-library__catalogStar" aria-hidden="true">✦</span>
              Доступно онлайн
            </button>
          </div>

          <div className={`tmdb-library__yearFilter ${yearActive ? 'is-active' : ''}`}>
            <span className="tmdb-library__yearLabel">Год:</span>
            <div className="tmdb-library__yearSliderWrap">
              <div className="tmdb-library__yearTrack" />
              <div
                className="tmdb-library__yearTrackActive"
                style={{ left: `${sliderLeftPct}%`, right: `${100 - sliderRightPct}%` }}
              />
              <input
                type="range"
                min={YEAR_MIN}
                max={YEAR_MAX}
                value={yearFrom}
                onChange={(e) => handleYearFromSlider(Number(e.target.value))}
                className="tmdb-library__yearRange tmdb-library__yearRange--from"
                aria-label="Год от (слайдер)"
              />
              <input
                type="range"
                min={YEAR_MIN}
                max={YEAR_MAX}
                value={yearTo}
                onChange={(e) => handleYearToSlider(Number(e.target.value))}
                className="tmdb-library__yearRange tmdb-library__yearRange--to"
                aria-label="Год до (слайдер)"
              />
            </div>
            <div className="tmdb-library__yearInputs">
              <input
                type="number"
                min={YEAR_MIN}
                max={YEAR_MAX}
                className="tmdb-library__yearInput"
                value={yearFromInput}
                onChange={(e) => setYearFromInput(e.target.value)}
                onBlur={commitYearFromInput}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                aria-label="Год от"
              />
              <span className="tmdb-library__yearDash">—</span>
              <input
                type="number"
                min={YEAR_MIN}
                max={YEAR_MAX}
                className="tmdb-library__yearInput"
                value={yearToInput}
                onChange={(e) => setYearToInput(e.target.value)}
                onBlur={commitYearToInput}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                aria-label="Год до"
              />
              {yearActive && (
                <button type="button" className="tmdb-library__yearReset" onClick={resetYearRange} title="Сбросить" aria-label="Сбросить">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
        )}

        {/* Жанры */}
        {selectedCategory !== 'favorites' && (
        <div className="tmdb-library__genres">
          {movieGenres.map(genre => (
            <button
              key={genre.id}
              className={`tmdb-library__genre-btn ${selectedGenres.includes(genre.id) ? 'active' : ''}`}
              onClick={() => handleGenreChange(genre.id)}
              title={selectedGenres.includes(genre.id) ? 'Убрать жанр' : (selectedGenres.length >= MAX_GENRES ? 'Можно выбрать до двух жанров — заменим самый старый' : 'Добавить жанр')}
            >
              {genre.name}
            </button>
          ))}
        </div>
        )}
      </div>

      {/* Сетка фильмов */}
      {selectedCategory === 'favorites' ? (
        // === Избранное ===
        loadingFavorites ? (
          <div className="tmdb-library__loading">
            <div className="tmdb-library__spinner" />
            <p>Загрузка избранного...</p>
          </div>
        ) : favorites.length === 0 ? (
          <div className="tmdb-library__empty">
            <p>❤️ Список избранного пуст</p>
            <p>Нажмите на сердечко на любом фильме, чтобы добавить</p>
          </div>
        ) : (
          <div className="tmdb-library__grid">
            {favorites.map(fav => (
              <div
                key={fav.movieId}
                className="tmdb-movie-card"
                onClick={() => handleMovieClick({ id: Number(fav.movieId), title: fav.title, poster_path: fav.posterPath, vote_average: fav.voteAverage, release_date: fav.year, genre_ids: [], overview: '', original_title: '', backdrop_path: null, vote_count: 0, popularity: 0, adult: false } as TMDBMovie)}
              >
                <div className="tmdb-movie-card__poster">
                  <img src={resolveFavoritePosterUrl(fav.posterPath)} alt={fav.title} loading="lazy" />
                  <div className="tmdb-movie-card__overlay">
                    <button className="tmdb-movie-card__play-btn">
                      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                    </button>
                  </div>
                  <div className="tmdb-movie-card__rating">⭐ {fav.voteAverage.toFixed(1)}</div>
                  <button
                    className="tmdb-movie-card__fav-btn tmdb-movie-card__fav-btn--active"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!token) return
                      setFavoriteIds(prev => { const n = new Set(prev); n.delete(fav.movieId); return n })
                      setFavorites(prev => prev.filter(f => f.movieId !== fav.movieId))
                      fetch(`${API_URL}/favorites/${fav.movieId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
                    }}
                    title="Убрать из избранного"
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="#ef4444" stroke="#ef4444" strokeWidth="2">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                  </button>
                </div>
                <div className="tmdb-movie-card__info">
                  <h3 className="tmdb-movie-card__title">{fav.title}</h3>
                  <div className="tmdb-movie-card__meta">
                    <span>{fav.year}</span>
                    <span>{fav.genreNames}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : selectedCategory === 'catalog' ? (
        // === Каталог: фильмы с подключённым источником ===
        loadingCatalog && catalogMovies.length === 0 ? (
          <div className="tmdb-library__loading">
            <div className="tmdb-library__spinner" />
            <p>Загрузка каталога...</p>
          </div>
        ) : (() => {
          // Клиентская фильтрация по жанру/году (метадата приходит из TMDB).
          const filteredCatalog = catalogMovies.filter(movie => {
            if (selectedGenres.length > 0) {
              // Совпадение по ВСЕМ выбранным жанрам (AND).
              const hasAllGenres = selectedGenres.every(g => movie.genre_ids.includes(g))
              if (!hasAllGenres) return false
            }
            if (yearActive) {
              if (!movie.release_date) return false
              const year = parseInt(movie.release_date.slice(0, 4), 10)
              if (!Number.isFinite(year)) return false
              if (year < yearFrom || year > yearTo) return false
            }
            return true
          })

          if (filteredCatalog.length === 0) {
            return (
              <div className="tmdb-library__empty">
                <p>✦ В каталоге нет подходящих фильмов</p>
                <p>Попробуйте изменить фильтры</p>
              </div>
            )
          }

          return (
            <div className="tmdb-library__grid">
              {filteredCatalog.map(movie => (
                <div
                  key={movie.id}
                  className="tmdb-movie-card"
                  onClick={() => handleMovieClick(movie)}
                >
                  <div className="tmdb-movie-card__poster">
                    <img
                      src={getPosterUrl(movie.poster_path)}
                      alt={movie.title}
                      loading="lazy"
                    />
                    <div className="tmdb-movie-card__overlay">
                      <button className="tmdb-movie-card__play-btn">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                      </button>
                    </div>
                    {movie.vote_average > 0 && (
                      <div className="tmdb-movie-card__rating">⭐ {movie.vote_average.toFixed(1)}</div>
                    )}
                    {(() => {
                      const type = catalogSourceTypes.get(movie.id) || ''
                      const label = type === 'vkvideo' ? 'VK VIDEO' : (type ? type.toUpperCase() : 'ОНЛАЙН')
                      return (
                        <div className="tmdb-movie-card__sourceBadge" title={`Источник: ${label}`}>
                          {label}
                        </div>
                      )
                    })()}
                    {token && (
                      <button
                        className={`tmdb-movie-card__fav-btn ${favoriteIds.has(String(movie.id)) ? 'tmdb-movie-card__fav-btn--active' : ''}`}
                        onClick={(e) => toggleFavorite(e, movie)}
                        title={favoriteIds.has(String(movie.id)) ? 'Убрать из избранного' : 'В избранное'}
                      >
                        <svg viewBox="0 0 24 24" width="20" height="20"
                          fill={favoriteIds.has(String(movie.id)) ? '#ef4444' : 'none'}
                          stroke={favoriteIds.has(String(movie.id)) ? '#ef4444' : 'currentColor'}
                          strokeWidth="2"
                        >
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="tmdb-movie-card__info">
                    <h3 className="tmdb-movie-card__title">{movie.title}</h3>
                    <div className="tmdb-movie-card__meta">
                      <span>{movie.release_date ? formatReleaseDate(movie.release_date) : 'Доступно'}</span>
                      <span>{movie.genre_ids.slice(0, 2).map(id => getGenreName(id)).join(', ')}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        })()
      ) : loading ? (
        <div className="tmdb-library__loading">
          <div className="tmdb-library__spinner" />
          <p>Загрузка фильмов...</p>
        </div>
      ) : movies.length === 0 ? (
        <div className="tmdb-library__empty">
          <p>😔 Фильмы не найдены</p>
          <p>Попробуйте изменить запрос</p>
        </div>
      ) : (
        <>
          <div className="tmdb-library__grid">
            {movies.map(movie => (
              <div
                key={movie.id}
                className="tmdb-movie-card"
                onClick={() => handleMovieClick(movie)}
              >
                <div className="tmdb-movie-card__poster">
                  <img 
                    src={getPosterUrl(movie.poster_path)} 
                    alt={movie.title}
                    loading="lazy"
                  />
                  <div className="tmdb-movie-card__overlay">
                    <button className="tmdb-movie-card__play-btn">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  </div>
                  <div className="tmdb-movie-card__rating">
                    ⭐ {movie.vote_average.toFixed(1)}
                  </div>
                  {token && (
                    <button
                      className={`tmdb-movie-card__fav-btn ${favoriteIds.has(String(movie.id)) ? 'tmdb-movie-card__fav-btn--active' : ''} ${animatingFavId === String(movie.id) ? 'tmdb-movie-card__fav-btn--animating' : ''}`}
                      onClick={(e) => toggleFavorite(e, movie)}
                      title={favoriteIds.has(String(movie.id)) ? 'Убрать из избранного' : 'В избранное'}
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20"
                        fill={favoriteIds.has(String(movie.id)) ? '#ef4444' : 'none'}
                        stroke={favoriteIds.has(String(movie.id)) ? '#ef4444' : 'currentColor'}
                        strokeWidth="2"
                      >
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                      </svg>
                    </button>
                  )}
                </div>
                <div className="tmdb-movie-card__info">
                  <h3 className="tmdb-movie-card__title">{movie.title}</h3>
                  <div className="tmdb-movie-card__meta">
                    <span>{formatReleaseDate(movie.release_date)}</span>
                    <span>{movie.genre_ids.slice(0, 2).map(id => getGenreName(id)).join(', ')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Пагинация */}
          <div className="tmdb-library__pagination">
            <button
              className="tmdb-library__page-btn"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              ← Назад
            </button>
            <span className="tmdb-library__page-info">
              Страница {page} из {totalPages}
            </span>
            <button
              className="tmdb-library__page-btn"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Вперёд →
            </button>
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}
