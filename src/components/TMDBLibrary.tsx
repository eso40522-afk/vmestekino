import { useState, useEffect, useCallback } from 'react'
import {
  type TMDBMovie,
  type TMDBMovieDetails,
  getPopularMovies,
  getTopRatedMovies,
  getNowPlayingMovies,
  getUpcomingMovies,
  searchMovies,
  getMoviesByGenre,
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
}

interface TMDBLibraryProps {
  onSelectMovie: (movie: SelectedMovieData) => void
  showFavorites?: boolean
  initialMovieId?: number | null
  onClearInitialMovie?: () => void
  onCreateRoom?: (isPrivate: boolean) => void
}

type CategoryType = 'popular' | 'top_rated' | 'now_playing' | 'upcoming' | 'favorites'

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

export function TMDBLibrary({ onSelectMovie, showFavorites, initialMovieId, onClearInitialMovie, onCreateRoom }: TMDBLibraryProps) {
  const { token } = useAuth()
  const [movies, setMovies] = useState<TMDBMovie[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<CategoryType>('popular')
  const [selectedGenre, setSelectedGenre] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [moviePageId, setMoviePageId] = useState<number | null>(null)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [favorites, setFavorites] = useState<FavoriteMovie[]>([])
  const [loadingFavorites, setLoadingFavorites] = useState(false)
  const [animatingFavId, setAnimatingFavId] = useState<string | null>(null)

  // Auto-open movie page from URL param
  useEffect(() => {
    if (initialMovieId && moviePageId === null) {
      setMoviePageId(initialMovieId)
      onClearInitialMovie?.()
    }
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
  const TMDB_PER_PAGE = 20

  const fetchTmdbPage = useCallback(async (tmdbPage: number) => {
    if (searchQuery.trim()) {
      return searchMovies(searchQuery, tmdbPage)
    } else if (selectedGenre) {
      return getMoviesByGenre(selectedGenre, tmdbPage, selectedCategory === 'favorites' ? 'popular' : selectedCategory)
    } else {
      switch (selectedCategory) {
        case 'top_rated':
          return getTopRatedMovies(tmdbPage)
        case 'now_playing':
          return getNowPlayingMovies(tmdbPage)
        case 'upcoming':
          return getUpcomingMovies(tmdbPage)
        default:
          return getPopularMovies(tmdbPage)
      }
    }
  }, [searchQuery, selectedGenre, selectedCategory])

  const loadMovies = useCallback(async () => {
    if (selectedCategory === 'favorites') {
      loadFavorites()
      return
    }
    setLoading(true)
    try {
      const startIndex = (page - 1) * ITEMS_PER_PAGE
      const endIndex = startIndex + ITEMS_PER_PAGE

      const firstTmdbPage = Math.floor(startIndex / TMDB_PER_PAGE) + 1
      const lastTmdbPage = Math.floor((endIndex - 1) / TMDB_PER_PAGE) + 1

      const pages = []
      for (let p = firstTmdbPage; p <= lastTmdbPage; p++) {
        pages.push(fetchTmdbPage(p))
      }
      const responses = await Promise.all(pages)

      const allMovies = responses.flatMap(r => r.results)
      const offsetInAll = startIndex - (firstTmdbPage - 1) * TMDB_PER_PAGE
      const sliced = allMovies.slice(offsetInAll, offsetInAll + ITEMS_PER_PAGE)

      setMovies(sliced)
      const totalItems = responses[0].total_pages * TMDB_PER_PAGE
      setTotalPages(Math.min(Math.floor(totalItems / ITEMS_PER_PAGE), 500))
    } catch (error) {
      console.error('Ошибка загрузки фильмов:', error)
    } finally {
      setLoading(false)
    }
  }, [fetchTmdbPage, page, loadFavorites, selectedCategory])

  useEffect(() => {
    loadMovies()
  }, [loadMovies])

  // Поиск с debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
    }, 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Выбор фильма — открываем страницу фильма
  const handleMovieClick = (movie: TMDBMovie) => {
    setMoviePageId(movie.id)
  }

  // Смена категории
  const handleCategoryChange = (category: CategoryType) => {
    setSelectedCategory(category)
    setSearchQuery('')
    setPage(1)
  }

  // Смена жанра
  const handleGenreChange = (genreId: number) => {
    setSelectedGenre(currentGenre => currentGenre === genreId ? null : genreId)
    setSearchQuery('')
    setPage(1)
  }

  return (
    <div className="tmdb-library">
      {/* Movie Page View */}
      {moviePageId !== null ? (
        <MoviePage
          movieId={moviePageId}
          onBack={() => setMoviePageId(null)}
          onSelectMovie={(movie) => {
            setMoviePageId(null)
            onSelectMovie(movie)
          }}
          onNavigateToMovie={(id) => setMoviePageId(id)}
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

        {/* Категории */}
        {selectedCategory !== 'favorites' && (
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
        </div>
        )}

        {/* Жанры */}
        {selectedCategory !== 'favorites' && (
        <div className="tmdb-library__genres">
          {movieGenres.map(genre => (
            <button
              key={genre.id}
              className={`tmdb-library__genre-btn ${selectedGenre === genre.id ? 'active' : ''}`}
              onClick={() => handleGenreChange(genre.id)}
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
