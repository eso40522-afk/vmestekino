import { useState } from 'react'
import type { Movie } from '../data/movies'
import { movies as allMovies, genres } from '../data/movies'
import './MovieLibrary.css'

interface MovieLibraryProps {
  onSelectMovie: (movie: Movie) => void
  currentMovieId?: string
}

export function MovieLibrary({ onSelectMovie, currentMovieId }: MovieLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedGenre, setSelectedGenre] = useState('Все')

  // Фильтрация фильмов
  const filteredMovies = allMovies.filter(movie => {
    const matchesSearch = movie.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          movie.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesGenre = selectedGenre === 'Все' || movie.genre.includes(selectedGenre)
    return matchesSearch && matchesGenre
  })

  return (
    <div className="movie-library">
      <div className="movie-library__header">
        <h2 className="movie-library__title"><span className="movie-library__title-icon">🎬</span> Библиотека фильмов</h2>
        
        <div className="movie-library__search">
          <svg className="movie-library__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Поиск фильмов..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="movie-library__search-input"
          />
        </div>

        <div className="movie-library__genres">
          {genres.map(genre => (
            <button
              key={genre}
              className={`movie-library__genre-btn ${selectedGenre === genre ? 'active' : ''}`}
              onClick={() => setSelectedGenre(genre)}
            >
              {genre}
            </button>
          ))}
        </div>
      </div>

      <div className="movie-library__grid">
        {filteredMovies.map(movie => (
          <div
            key={movie.id}
            className={`movie-card ${currentMovieId === movie.id ? 'active' : ''}`}
            onClick={() => onSelectMovie(movie)}
          >
            <div className="movie-card__poster">
              <img src={movie.poster} alt={movie.title} loading="lazy" />
              <div className="movie-card__overlay">
                <button className="movie-card__play-btn">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              </div>
              {currentMovieId === movie.id && (
                <div className="movie-card__now-playing">
                  <span>▶ Сейчас играет</span>
                </div>
              )}
            </div>
            <div className="movie-card__info">
              <h3 className="movie-card__title">{movie.title}</h3>
              <div className="movie-card__meta">
                <span className="movie-card__year">{movie.year}</span>
                <span className="movie-card__duration">{movie.duration}</span>
                <span className="movie-card__rating">⭐ {movie.rating}</span>
              </div>
              <div className="movie-card__genres">
                {movie.genre.slice(0, 2).map(g => (
                  <span key={g} className="movie-card__genre-tag">{g}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredMovies.length === 0 && (
        <div className="movie-library__empty">
          <p>😔 Фильмы не найдены</p>
          <p>Попробуйте изменить параметры поиска</p>
        </div>
      )}
    </div>
  )
}
