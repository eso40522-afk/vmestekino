import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { TMDBLibrary, type SelectedMovieData } from '../components/TMDBLibrary'
import { useAuth } from '../contexts/AuthContext'
import { useSocket } from '../contexts/SocketContext'
import { searchMovies, type TMDBMovie } from '../services/tmdb'
import { buildMovieSlug, parseMovieIdFromSlug } from '../utils/movieSlug'
import './Rooms.css'

export default function Library() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { slug } = useParams<{ slug?: string }>()
  const { user, logout } = useAuth()
  const { createRoom, currentRoomId } = useSocket()

  // Movie id source of truth: URL slug `/library/:slug` (id is the trailing segment).
  // Fallback to legacy `?movie=ID` query for backward compatibility.
  const slugMovieId = parseMovieIdFromSlug(slug)
  const queryMovieId = searchParams.get('movie') ? Number(searchParams.get('movie')) : null
  const initialMovieId = slugMovieId ?? (queryMovieId && Number.isFinite(queryMovieId) ? queryMovieId : null)
  const showFavorites = searchParams.get('favorites') === '1'

  // Header search
  const [headerSearchQuery, setHeaderSearchQuery] = useState('')
  const [headerSearchResults, setHeaderSearchResults] = useState<TMDBMovie[]>([])
  const [headerSearching, setHeaderSearching] = useState(false)
  const [showHeaderResults, setShowHeaderResults] = useState(false)
  const headerSearchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const query = headerSearchQuery.trim()
    if (!query || query.length < 2) {
      setHeaderSearchResults([])
      setHeaderSearching(false)
      setShowHeaderResults(false)
      return
    }

    clearTimeout(headerSearchTimer.current)
    setHeaderSearching(true)

    headerSearchTimer.current = setTimeout(async () => {
      try {
        const response = await searchMovies(query, 1)
        setHeaderSearchResults(response.results.slice(0, 5))
        setShowHeaderResults(response.results.length > 0)
      } catch {
        setHeaderSearchResults([])
      } finally {
        setHeaderSearching(false)
      }
    }, 400)

    return () => clearTimeout(headerSearchTimer.current)
  }, [headerSearchQuery])

  const handleHeaderSearchSelect = (movie: TMDBMovie) => {
    setHeaderSearchQuery('')
    setHeaderSearchResults([])
    setShowHeaderResults(false)
    navigate(`/library/${buildMovieSlug({
      id: movie.id,
      title: movie.title,
      originalTitle: movie.original_title,
      year: movie.release_date
    })}`)
  }

  const handleMovieOpen = useCallback((movie: { id: number; title?: string | null; originalTitle?: string | null; year?: string | number | null }) => {
    const target = `/library/${buildMovieSlug(movie)}`
    navigate(target)
  }, [navigate])

  const handleMovieClose = useCallback(() => {
    navigate(showFavorites ? '/library?favorites=1' : '/library')
  }, [navigate, showFavorites])

  // Watch flow: MoviePage calls onCreateRoom (room mode) then onSelectMovie.
  // For solo mode it only calls onSelectMovie. We coordinate via ref.
  const pendingRoomRef = useRef<{ create: boolean; isPrivate: boolean }>({ create: false, isPrivate: false })

  const handleCreateRoom = useCallback((isPrivate: boolean) => {
    pendingRoomRef.current = { create: true, isPrivate }
  }, [])

  const handleSelectMovie = useCallback(async (movie: SelectedMovieData) => {
    const pending = pendingRoomRef.current
    pendingRoomRef.current = { create: false, isPrivate: false }
    if (pending.create) {
      try {
        const newRoomId = await createRoom(pending.isPrivate)
        navigate(`/room/${newRoomId}?autostartMovie=${movie.id}`)
      } catch {
        navigate(`/room?autostartMovie=${movie.id}`)
      }
    } else {
      navigate(`/room?autostartMovie=${movie.id}&solo=1`)
    }
  }, [createRoom, navigate])

  return (
    <div className="rooms-page">
      <AppHeader
        onLogoClick={() => navigate('/')}
        onRoomsClick={() => navigate('/rooms')}
        roomsOnline={Boolean(currentRoomId)}
        roomsLocked={!user || user.isGuest}
        onLibraryClick={() => {
          if (slugMovieId !== null || showFavorites) {
            navigate('/library')
          }
        }}
        libraryActive={!showFavorites}
        onPlayerClick={() => currentRoomId ? navigate(`/room/${currentRoomId}`) : navigate('/library')}
        playerDisabled={!currentRoomId}
        playerTitle={currentRoomId ? 'Вернуться в комнату' : 'Нет активной комнаты'}
        showFavoriteButton
        favoriteLocked={!user || user.isGuest}
        onFavoriteClick={() => navigate('/library?favorites=1')}
        favoriteActive={showFavorites}
        search={{
          mode: 'interactive',
          value: headerSearchQuery,
          onChange: setHeaderSearchQuery,
          onSubmit: (event) => event.preventDefault(),
          onFocus: () => headerSearchResults.length > 0 && setShowHeaderResults(true),
          results: headerSearchResults,
          showResults: showHeaderResults,
          searching: headerSearching,
          onCloseResults: () => setShowHeaderResults(false),
          onSelectResult: handleHeaderSearchSelect,
          placeholder: 'Фильмы, сериалы, актёры...'
        }}
        user={user}
        onLoginClick={() => navigate('/login')}
        onProfileClick={() => navigate('/profile')}
        onLogoutClick={logout}
      />

      <div className="library-page__shell">
        <TMDBLibrary
          onSelectMovie={handleSelectMovie}
          showFavorites={showFavorites}
          initialMovieId={initialMovieId}
          onMovieOpen={handleMovieOpen}
          onMovieClose={handleMovieClose}
          onClearInitialMovie={() => {
            // Legacy `?movie=ID` clean-up — only when not driven by slug.
            if (slugMovieId === null && queryMovieId) {
              const next = new URLSearchParams(searchParams)
              next.delete('movie')
              setSearchParams(next, { replace: true })
            }
          }}
          onCreateRoom={handleCreateRoom}
        />
      </div>
    </div>
  )
}
