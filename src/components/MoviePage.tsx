import { useState, useEffect, useRef } from 'react'
import {
  type TMDBMovieDetails,
  type TMDBMovie,
  type TMDBCast,
  type TMDBCrew,
  getMovieDetails,
  getMovieExternalIds,
  getMovieCredits,
  getTopRatedByGenre,
  getPosterUrl,
  getBackdropUrl,
  getProfileUrl,
  formatReleaseDate,
  formatRuntime,
} from '../services/tmdb'
import { buildEmbedUrl } from '../services/alloha'
import { useAuth } from '../contexts/AuthContext'
import { useSocket } from '../contexts/SocketContext'
import type { SelectedMovieData } from './TMDBLibrary'
import './MoviePage.css'

interface MoviePageProps {
  movieId: number
  onBack: () => void
  onSelectMovie: (movie: SelectedMovieData) => void
  onNavigateToMovie: (movieId: number) => void
  onCreateRoom?: (isPrivate: boolean) => void
  favoriteIds: Set<string>
  onToggleFavorite: (e: React.MouseEvent, movie: TMDBMovie) => void
}

export function MoviePage({ movieId, onBack, onSelectMovie, onNavigateToMovie, onCreateRoom, favoriteIds, onToggleFavorite }: MoviePageProps) {
  const { token } = useAuth()
  const { setRoomSolo } = useSocket()
  const pageRef = useRef<HTMLDivElement>(null)
  const [movie, setMovie] = useState<TMDBMovieDetails | null>(null)
  const [imdbId, setImdbId] = useState<string | null>(null)
  const [cast, setCast] = useState<TMDBCast[]>([])
  const [director, setDirector] = useState<TMDBCrew | null>(null)
  const [similarMovies, setSimilarMovies] = useState<TMDBMovie[]>([])
  const [loading, setLoading] = useState(true)
  const [showWatchModal, setShowWatchModal] = useState(false)
  const [watchModalClosing, setWatchModalClosing] = useState(false)
  const [watchMode, setWatchMode] = useState<'solo' | 'room'>('solo')
  const [roomPrivate, setRoomPrivate] = useState(false)

  const closeWatchModal = () => {
    setWatchModalClosing(true)
    setTimeout(() => {
      setShowWatchModal(false)
      setWatchModalClosing(false)
      setRoomPrivate(false)
    }, 250)
  }


  useEffect(() => {
    loadMovie()
    // Scroll to top when movie page opens
    if (pageRef.current) {
      pageRef.current.scrollIntoView({ block: 'start' })
    } else {
      // Fallback: scroll the parent container
      const player = document.querySelector('.room__player')
      if (player) player.scrollTop = 0
    }
  }, [movieId])

  const loadMovie = async () => {
    setLoading(true)
    try {
      const [details, externalIds, credits] = await Promise.all([
        getMovieDetails(movieId),
        getMovieExternalIds(movieId),
        getMovieCredits(movieId),
      ])

      setMovie(details)
      setImdbId(externalIds.imdb_id)
      setCast(credits.cast.slice(0, 4))
      setDirector(credits.crew.find(c => c.job === 'Director') || null)

      // Загружаем рекомендации по жанру
      const mainGenreId = details.genres?.[0]?.id
      if (mainGenreId) {
        const genreMovies = await getTopRatedByGenre(mainGenreId)
        // Исключаем текущий фильм из рекомендаций
        setSimilarMovies(genreMovies.results.filter(m => m.id !== movieId).slice(0, 6))
      } else {
        setSimilarMovies([])
      }
    } catch (error) {
      console.error('Error loading movie:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleWatch = () => {
    if (!movie || !imdbId) return
    // Гости — сразу смотрят без модалки
    if (!token) {
      const embedUrl = buildEmbedUrl(imdbId)
      onSelectMovie({
        ...movie,
        videoUrl: embedUrl,
        kinopoiskId: null,
        imdbId: imdbId,
        useEmbed: true,
      })
      return
    }
    setShowWatchModal(true)
  }

  const handleConfirmWatch = () => {
    if (!movie || !imdbId) return
    setWatchModalClosing(true)
    setTimeout(() => {
      setShowWatchModal(false)
      setWatchModalClosing(false)
      setRoomPrivate(false)
    }, 250)
    if (watchMode === 'room' && onCreateRoom) {
      onCreateRoom(roomPrivate)
    }
    if (watchMode === 'solo') {
      setRoomSolo(true)
    }
    const embedUrl = buildEmbedUrl(imdbId)
    onSelectMovie({
      ...movie,
      videoUrl: embedUrl,
      kinopoiskId: null,
      imdbId: imdbId,
      useEmbed: true,
    })
  }

  const isFavorite = favoriteIds.has(String(movieId))

  const handleFavoriteClick = (e: React.MouseEvent) => {
    if (!movie) return
    onToggleFavorite(e, {
      id: movie.id,
      title: movie.title,
      poster_path: movie.poster_path,
      vote_average: movie.vote_average,
      release_date: movie.release_date,
      genre_ids: movie.genres?.map(g => g.id) || [],
      overview: movie.overview,
      original_title: movie.original_title,
      backdrop_path: movie.backdrop_path,
      vote_count: movie.vote_count,
      popularity: movie.popularity,
      adult: movie.adult,
    })
  }

  if (loading) {
    return (
      <div className="movie-page">
        <div className="movie-page__loading">
          <div className="movie-page__spinner" />
          <p>Загрузка...</p>
        </div>
      </div>
    )
  }

  if (!movie) {
    return (
      <div className="movie-page">
        <div className="movie-page__error">
          <p>Фильм не найден</p>
          <button onClick={onBack} className="movie-page__close-btn">✕</button>
        </div>
      </div>
    )
  }

  return (
    <div className="movie-page" ref={pageRef}>
      {/* Hero — full viewport */}
      <div
        className="movie-page__hero"
        style={{
          backgroundImage: movie.backdrop_path
            ? `url(${getBackdropUrl(movie.backdrop_path, 'original')})`
            : undefined,
        }}
      >
        <div className="movie-page__hero-overlay" />
        {/* Close button */}
        <button className="movie-page__close-btn" onClick={onBack}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <div className="movie-page__hero-bottom">
          {/* Meta info above title */}
          <div className="movie-page__hero-meta">
            <span className="movie-page__badge">Фильм</span>
            <span className="movie-page__hero-rating">★ {movie.vote_average.toFixed(1)}</span>
            <span className="movie-page__hero-year">{formatReleaseDate(movie.release_date)}</span>
            {movie.runtime > 0 && (
              <span className="movie-page__hero-runtime">{formatRuntime(movie.runtime)}</span>
            )}
          </div>

          {/* Title */}
          <h1 className="movie-page__title">{movie.title}</h1>

          {/* Action buttons */}
          <div className="movie-page__actions">
            <button className="movie-page__watch-btn" onClick={handleWatch}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              СМОТРЕТЬ
            </button>
            {token && (
              <button
                className={`movie-page__fav-btn ${isFavorite ? 'movie-page__fav-btn--active' : ''}`}
                onClick={handleFavoriteClick}
                title={isFavorite ? 'Убрать из избранного' : 'В избранное'}
              >
                <svg width="22" height="22" viewBox="0 0 24 24"
                  fill={isFavorite ? '#ef4444' : 'none'}
                  stroke={isFavorite ? '#ef4444' : 'currentColor'}
                  strokeWidth="2"
                >
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content below hero */}
      <div className="movie-page__content">
        <div className="movie-page__main">
          {/* Synopsis */}
          <div className="movie-page__section">
            <h2 className="movie-page__section-title">
              <span className="movie-page__section-accent" />
              Описание
            </h2>
            <p className="movie-page__overview">{movie.overview || 'Описание отсутствует'}</p>
          </div>

          {/* Cast & Crew */}
          {(director || cast.length > 0) && (
            <div className="movie-page__section">
              <h2 className="movie-page__section-title">
                <span className="movie-page__section-accent" />
                Съёмочная группа
              </h2>
              <div className="movie-page__cast-grid">
                {director && (
                  <div className="movie-page__cast-card">
                    <div className="movie-page__cast-photo">
                      {director.profile_path ? (
                        <img src={getProfileUrl(director.profile_path)} alt={director.name} />
                      ) : (
                        <div className="movie-page__cast-no-photo">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <span className="movie-page__cast-name">{director.name}</span>
                    <span className="movie-page__cast-role movie-page__cast-role--director">Режиссёр</span>
                  </div>
                )}
                {cast.map(person => (
                  <div key={person.id} className="movie-page__cast-card">
                    <div className="movie-page__cast-photo">
                      {person.profile_path ? (
                        <img src={getProfileUrl(person.profile_path)} alt={person.name} />
                      ) : (
                        <div className="movie-page__cast-no-photo">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <span className="movie-page__cast-name">{person.name}</span>
                    <span className="movie-page__cast-role">Актёр</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar — Recommendations */}
        <div className="movie-page__sidebar">
          <h2 className="movie-page__section-title">
            <span className="movie-page__section-accent" />
            Рекомендации
          </h2>
          {similarMovies.length > 0 ? (
            <div className="movie-page__recs">
              {similarMovies.map(sim => (
                <div
                  key={sim.id}
                  className="movie-page__rec-card"
                  onClick={() => onNavigateToMovie(sim.id)}
                >
                  <img
                    src={getPosterUrl(sim.poster_path, 'w185')}
                    alt={sim.title}
                    className="movie-page__rec-poster"
                    loading="lazy"
                  />
                  <div className="movie-page__rec-info">
                    <h4 className="movie-page__rec-title">{sim.title}</h4>
                    <span className="movie-page__rec-meta">
                      {formatReleaseDate(sim.release_date)} • {sim.vote_average.toFixed(1)} ★
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="movie-page__no-recs">Рекомендации не найдены</p>
          )}
        </div>
      </div>

      {/* Watch Mode Modal */}
      {showWatchModal && movie && (
        <div className={`movie-page__modal-overlay${watchModalClosing ? ' movie-page__modal-overlay--closing' : ''}`} onClick={closeWatchModal}>
          <div className={`movie-page__modal${watchModalClosing ? ' movie-page__modal--closing' : ''}`} onClick={e => e.stopPropagation()}>
            <div className="movie-page__modal-header">
              <h3 className="movie-page__modal-title">Начать просмотр</h3>
              <p className="movie-page__modal-sub">Выберите режим просмотра для «{movie.title}»</p>
            </div>

            <div className="movie-page__modal-info">
              <img
                src={getPosterUrl(movie.poster_path, 'w185')}
                alt={movie.title}
                className="movie-page__modal-poster"
              />
              <div className="movie-page__modal-details">
                <span className="movie-page__modal-movie-title">{movie.title}</span>
                <span className="movie-page__modal-meta">
                  {formatReleaseDate(movie.release_date)}
                  {movie.runtime > 0 && ` • ${formatRuntime(movie.runtime)}`}
                  {movie.vote_average > 0 && ` • ★ ${movie.vote_average.toFixed(1)}`}
                </span>
                {movie.genres && movie.genres.length > 0 && (
                  <span className="movie-page__modal-genres">
                    {movie.genres.map(g => g.name).join(', ')}
                  </span>
                )}
              </div>
            </div>

            <div className="movie-page__modal-toggle">
              <div className={`movie-page__modal-pill movie-page__modal-pill--${watchMode}`} />
              <button
                className={`movie-page__modal-tab ${watchMode === 'solo' ? 'movie-page__modal-tab--active' : ''}`}
                onClick={() => setWatchMode('solo')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
                В одиночку
              </button>
              <button
                className={`movie-page__modal-tab ${watchMode === 'room' ? 'movie-page__modal-tab--active' : ''}`}
                onClick={() => setWatchMode('room')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <line x1="19" y1="8" x2="19" y2="14"/>
                  <line x1="22" y1="11" x2="16" y2="11"/>
                </svg>
                Создать комнату
              </button>
            </div>

            {watchMode === 'room' && (
              <div className="movie-page__modal-privacy">
                <div className="movie-page__modal-privacy-info">
                  <span className="movie-page__modal-privacy-label">Приватная комната</span>
                  <span className="movie-page__modal-privacy-desc">
                    {roomPrivate
                      ? 'Комната будет скрыта в списке'
                      : 'Комната видна всем пользователям'}
                  </span>
                </div>
                <button
                  className={`movie-page__modal-toggle-switch${roomPrivate ? ' movie-page__modal-toggle-switch--active' : ''}`}
                  onClick={() => setRoomPrivate(!roomPrivate)}
                  type="button"
                >
                  <span className="movie-page__modal-toggle-thumb" />
                </button>
              </div>
            )}

            <div className="movie-page__modal-hint">
              {watchMode === 'solo' ? (
                <div className="movie-page__modal-hint-row">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  <span>Фильм начнёт воспроизводиться в текущей комнате</span>
                </div>
              ) : (
                <div className="movie-page__modal-hint-row">
                  {roomPrivate ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M2 12h20" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  )}
                  <span>{roomPrivate ? 'Информация о фильме и участниках будет скрыта' : 'Все пользователи могут видеть и присоединяться'}</span>
                </div>
              )}
            </div>

            <div className="movie-page__modal-actions">
              <button className="movie-page__modal-cancel" onClick={closeWatchModal}>
                Отмена
              </button>
              {watchMode === 'solo' ? (
                <button className="movie-page__modal-watch" onClick={handleConfirmWatch}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  Смотреть
                </button>
              ) : (
                <button className="movie-page__modal-confirm" onClick={handleConfirmWatch}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Создать комнату
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
