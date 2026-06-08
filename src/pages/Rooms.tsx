import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { useAuth } from '../contexts/AuthContext'
import { useSocket } from '../contexts/SocketContext'
import { API_URL } from '../config/api'
import { getMovieDetails, getPosterUrl, searchMovies, type TMDBMovie, type TMDBMovieDetails } from '../services/tmdb'
import { buildMovieSlug } from '../utils/movieSlug'
import './Room.css'
import './Rooms.css'

interface RoomUser {
  id: string
  username: string
  color: string
  initials: string
  avatar: string
}

interface RoomVideo {
  title: string | null
  posterPath: string | null
  year: string | null
  movieId: string | null
  isPlaying: boolean
}

interface RoomInfo {
  roomId: string
  usersCount: number
  users: RoomUser[]
  isPrivate: boolean
  video: RoomVideo | null
  createdAt: string
}

type CreateSourceType = 'search' | 'link'
type CreateWatchMode = 'solo' | 'room'

export default function Rooms() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, logout } = useAuth()
  const { createRoom, currentRoomId } = useSocket()
  const roomClosedNotice = searchParams.get('closed') === '1'
  const roomSoloNotice = searchParams.get('solo') === '1'
  const autoOpenCreateLink = searchParams.get('create') === 'link'

  const [rooms, setRooms] = useState<RoomInfo[]>([])
  const [onlineUsers, setOnlineUsers] = useState(0)
  const [movieDetails, setMovieDetails] = useState<Record<string, TMDBMovieDetails>>({})
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createSource, setCreateSource] = useState<CreateSourceType>('search')
  const [createWatchMode, setCreateWatchMode] = useState<CreateWatchMode>('room')
  const [newRoomPrivate, setNewRoomPrivate] = useState(false)
  const [createSearchQuery, setCreateSearchQuery] = useState('')
  const [createSearchResults, setCreateSearchResults] = useState<TMDBMovie[]>([])
  const [createSearchLoading, setCreateSearchLoading] = useState(false)
  const [selectedCreateMovie, setSelectedCreateMovie] = useState<TMDBMovie | null>(null)
  const [createUrlInput, setCreateUrlInput] = useState('')
  const [createModalError, setCreateModalError] = useState('')
  const createSearchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Header search (interactive)
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

  const handleHeaderSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
  }

  const handleHeaderSearchSelect = (movie: TMDBMovie) => {
    setHeaderSearchQuery('')
    setHeaderSearchResults([])
    setShowHeaderResults(false)
    const slug = buildMovieSlug({
      id: movie.id,
      title: movie.title,
      originalTitle: movie.original_title,
      year: movie.release_date
    })
    navigate(`/library/${slug}`)
  }

  const fetchRooms = useCallback(async () => {
    try {
      const [roomsRes, presenceRes] = await Promise.all([
        fetch(`${API_URL}/rooms`),
        fetch(`${API_URL}/presence/online`)
      ])
      const roomsData = await roomsRes.json()
      setRooms(roomsData.rooms || [])
      if (presenceRes.ok) {
        const presenceData = await presenceRes.json()
        setOnlineUsers(Number(presenceData.online) || 0)
      }
    } catch (err) {
      console.error('Failed to fetch rooms:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRooms()
    const interval = setInterval(fetchRooms, 5000)
    return () => clearInterval(interval)
  }, [fetchRooms])

  useEffect(() => {
    if (!showCreateModal || createSource !== 'search') {
      setCreateSearchResults([])
      setCreateSearchLoading(false)
      return
    }

    if (!createSearchQuery.trim() || createSearchQuery.trim().length < 2) {
      setCreateSearchResults([])
      setCreateSearchLoading(false)
      return
    }

    clearTimeout(createSearchTimer.current)
    setCreateSearchLoading(true)

    createSearchTimer.current = setTimeout(async () => {
      try {
        const response = await searchMovies(createSearchQuery, 1)
        setCreateSearchResults(response.results.slice(0, 6))
      } catch {
        setCreateSearchResults([])
      } finally {
        setCreateSearchLoading(false)
      }
    }, 350)

    return () => clearTimeout(createSearchTimer.current)
  }, [showCreateModal, createSource, createSearchQuery])

  // Fetch TMDB details for rooms with movieId
  useEffect(() => {
    const fetchDetails = async () => {
      const movieIds = rooms
        .filter(r => r.video?.movieId && !movieDetails[r.video.movieId])
        .map(r => r.video!.movieId!)
      
      const unique = [...new Set(movieIds)]
      if (unique.length === 0) return

      const results = await Promise.allSettled(
        unique.map(id => getMovieDetails(Number(id)))
      )

      const newDetails: Record<string, TMDBMovieDetails> = {}
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          newDetails[unique[i]] = result.value
        }
      })

      if (Object.keys(newDetails).length > 0) {
        setMovieDetails(prev => ({ ...prev, ...newDetails }))
      }
    }
    fetchDetails()
  }, [rooms])

  const handleCreateRoom = async () => {
    setCreateSource('search')
    setCreateWatchMode('room')
    setNewRoomPrivate(false)
    setCreateSearchQuery('')
    setCreateSearchResults([])
    setSelectedCreateMovie(null)
    setCreateUrlInput('')
    setCreateModalError('')
    setShowCreateModal(true)
  }

  // Open create modal in URL mode if ?create=link is present in URL (deep link from header)
  useEffect(() => {
    if (!autoOpenCreateLink || showCreateModal) return
    setCreateSource('link')
    setCreateWatchMode('room')
    setNewRoomPrivate(false)
    setCreateSearchQuery('')
    setCreateSearchResults([])
    setSelectedCreateMovie(null)
    setCreateUrlInput('')
    setCreateModalError('')
    setShowCreateModal(true)
    const next = new URLSearchParams(searchParams)
    next.delete('create')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenCreateLink])

  const closeCreateModal = () => {
    setShowCreateModal(false)
    setCreateSource('search')
    setCreateWatchMode('room')
    setNewRoomPrivate(false)
    setCreateSearchQuery('')
    setCreateSearchResults([])
    setSelectedCreateMovie(null)
    setCreateUrlInput('')
    setCreateModalError('')
    clearTimeout(createSearchTimer.current)
  }

  const handleConfirmCreate = async () => {
    const trimmedUrl = createUrlInput.trim()
    const selectedMovieId = selectedCreateMovie?.id

    if (createSource === 'search' && !selectedMovieId) {
      setCreateModalError('Сначала выберите фильм из поиска.')
      return
    }

    if (createSource === 'link' && !trimmedUrl) {
      setCreateModalError('Добавьте ссылку на видео.')
      return
    }

    setCreating(true)
    try {
      const params = new URLSearchParams()
      if (createSource === 'search' && selectedMovieId) {
        params.set('autostartMovie', String(selectedMovieId))
      }
      if (createSource === 'link' && trimmedUrl) {
        params.set('autostartUrl', trimmedUrl)
      }
      if (createWatchMode === 'solo') {
        params.set('solo', '1')
      }

      const query = params.toString()

      if (createWatchMode === 'room') {
        const roomId = await createRoom(newRoomPrivate)
        closeCreateModal()
        navigate(`/room/${roomId}${query ? `?${query}` : ''}`)
      } else {
        closeCreateModal()
        navigate(`/room${query ? `?${query}` : ''}`)
      }
    } catch {
      // ignore
    } finally {
      setCreating(false)
    }
  }

  const handleJoinRoom = (roomId: string) => {
    navigate(`/room/${roomId}`)
  }

  const publicRoomsCount = rooms.filter(room => !room.isPrivate).length
  const activeViewersCount = onlineUsers
  const liveRoomsCount = rooms.filter(room => room.video?.isPlaying).length

  return (
    <div className="rooms-page">
      {/* Header — same as Room page */}
      <AppHeader
          onLogoClick={() => navigate('/')}
          onRoomsClick={() => navigate('/rooms')}
          roomsOnline={Boolean(currentRoomId)}
          roomsActive
          roomsLocked={!user || user.isGuest}
          onLibraryClick={() => navigate('/library')}
          libraryActive={false}
          onPlayerClick={() => currentRoomId ? navigate(`/room/${currentRoomId}`) : navigate('/library')}
          playerDisabled={!currentRoomId}
          playerTitle={currentRoomId ? 'Вернуться в комнату' : 'Нет активной комнаты'}
          showFavoriteButton
          favoriteLocked={!user || user.isGuest}
          onFavoriteClick={() => navigate('/library?favorites=1')}
          search={{
            mode: 'interactive',
            value: headerSearchQuery,
            onChange: setHeaderSearchQuery,
            onSubmit: handleHeaderSearchSubmit,
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

      {/* Content */}
      <main className="rooms-page__content">
        {roomClosedNotice && (
          <div className="rooms-page__alert rooms-page__alert--warning">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>Комната закрыта. Вход по прямой ссылке недоступен.</span>
          </div>
        )}

        {roomSoloNotice && (
          <div className="rooms-page__alert rooms-page__alert--warning">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>Комната находится в одиночном режиме. Присоединение недоступно.</span>
          </div>
        )}

        <section className="rooms-page__hero">
          <div className="rooms-page__heroGlow rooms-page__heroGlow--left" aria-hidden="true" />
          <div className="rooms-page__heroGlow rooms-page__heroGlow--right" aria-hidden="true" />

          <div className="rooms-page__top">
            <div className="rooms-page__info">
              <span className="rooms-page__eyebrow">Совместный просмотр</span>
              <h2 className="rooms-page__heading">Активные комнаты</h2>
              <p className="rooms-page__sub">Присоединяйтесь к просмотру, находите активные сеансы или создайте свою комнату за пару секунд.</p>

              <div className="rooms-page__stats">
                <div className="rooms-page__statCard">
                  <span className="rooms-page__statValue">{rooms.length}</span>
                  <span className="rooms-page__statLabel">Всего комнат</span>
                </div>
                <div className="rooms-page__statCard">
                  <span className="rooms-page__statValue">{publicRoomsCount}</span>
                  <span className="rooms-page__statLabel">Открытые</span>
                </div>
                <div className="rooms-page__statCard">
                  <span className="rooms-page__statValue">{liveRoomsCount}</span>
                  <span className="rooms-page__statLabel">Идёт просмотр</span>
                </div>
                <div className="rooms-page__statCard">
                  <span className="rooms-page__statValue">{activeViewersCount}</span>
                  <span className="rooms-page__statLabel">Участников онлайн</span>
                </div>
              </div>
            </div>

            <div className="rooms-page__actionsPanel">
              <div className="rooms-page__actionsCopy">
                <span className="rooms-page__actionsBadge">Быстрый старт</span>
              </div>
              <button 
                className="rooms-page__createBtn" 
                onClick={handleCreateRoom}
                disabled={creating}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {creating ? 'Создание...' : 'Создать комнату'}
              </button>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="rooms-page__loading">
            <div className="rooms-page__spinner" />
            <span>Загрузка комнат...</span>
          </div>
        ) : rooms.length === 0 ? (
          <div className="rooms-page__empty">
            <div className="rooms-page__emptyGlow" aria-hidden="true" />
            <div className="rooms-page__emptyIcon">
              <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="8" y="12" width="48" height="36" rx="4" />
                <polygon points="26,22 26,38 40,30" fill="currentColor" opacity="0.3" />
                <path d="M20 56h24" strokeLinecap="round" />
                <path d="M32 48v8" />
              </svg>
            </div>
            <h3>Нет активных комнат</h3>
            <p>Создайте первую комнату, включите фильм и отправьте ссылку друзьям. Здесь сразу появятся активные совместные просмотры.</p>
            <div className="rooms-page__emptyActions">
              <button className="rooms-page__secondaryBtn" onClick={() => navigate('/library')}>
                Перейти в библиотеку
              </button>
            </div>
          </div>
        ) : (
          <div className="rooms-page__grid">
            {rooms.map(room => {
              const details = room.video?.movieId ? movieDetails[room.video.movieId] : null
              const posterUrl = room.video?.posterPath
                ? getPosterUrl(room.video.posterPath, 'w342')
                : null
              const isPrivate = room.isPrivate

              return (
                <div key={room.roomId} className={`room-card${isPrivate ? ' room-card--private' : ''}`}>
                  {/* Private lock overlay */}
                  {isPrivate && (
                    <div className="room-card__lockOverlay">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="room-card__lockIcon">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                      <span>Приватная комната</span>
                    </div>
                  )}

                  {/* Poster / placeholder */}
                  <div className="room-card__poster">
                    {!isPrivate && posterUrl ? (
                      <img src={posterUrl} alt={room.video?.title || ''} />
                    ) : (
                      <div className="room-card__noPoster">
                        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <rect x="6" y="10" width="36" height="26" rx="3" />
                          <polygon points="19,17 19,31 33,24" fill="currentColor" opacity="0.3" />
                        </svg>
                      </div>
                    )}
                    {!isPrivate && room.video?.isPlaying && (
                      <div className="room-card__live">
                        <span className="room-card__liveDot" />
                        Смотрят
                      </div>
                    )}
                    {!isPrivate && details && details.vote_average > 0 && (
                      <div className={`room-card__rating ${details.vote_average >= 7 ? 'room-card__rating--green' : details.vote_average >= 5 ? 'room-card__rating--yellow' : 'room-card__rating--red'}`}>
                        ⭐ {details.vote_average.toFixed(1)}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="room-card__body">
                    <div className="room-card__roomHeader">
                      <div className="room-card__roomId">
                        <span className="room-card__roomLabel">Комната:</span>
                        <span className="room-card__roomHash">{room.roomId}</span>
                      </div>
                      <div className="room-card__usersCount">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        {room.usersCount}
                      </div>
                    </div>

                    {isPrivate ? (
                      <>
                        <h3 className="room-card__title">Приватная комната</h3>
                        <span className="room-card__year">Информация скрыта</span>
                      </>
                    ) : (
                      <>
                        <h3 className="room-card__title">
                          {room.video?.title || ''}
                        </h3>

                        {room.video?.year && (
                          <span className="room-card__year">{room.video.year}</span>
                        )}

                        {details?.overview && (
                          <p className="room-card__desc">{details.overview}</p>
                        )}

                        {details?.genres && details.genres.length > 0 && (
                          <div className="room-card__genres">
                            {details.genres.slice(0, 3).map(g => (
                              <span key={g.id} className="room-card__genre">{g.name}</span>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {/* Users avatars — hidden for private */}
                    {!isPrivate && (
                      <div className="room-card__users">
                        <div className="room-card__avatars">
                          {room.users.slice(0, 5).map((u, i) => (
                            <div
                              key={u.id}
                              className="room-card__avatar"
                              style={{ zIndex: 5 - i, backgroundColor: u.color }}
                              title={u.username}
                            >
                              {u.avatar ? (
                                <img src={u.avatar} alt={u.username} />
                              ) : (
                                <span>{u.initials}</span>
                              )}
                            </div>
                          ))}
                          {room.usersCount > 5 && (
                            <div className="room-card__avatar room-card__avatar--more">
                              +{room.usersCount - 5}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <button className="room-card__joinBtn" onClick={() => handleJoinRoom(room.roomId)}>
                      {isPrivate ? 'Присоединиться' : 'Присоединиться'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* Create Room Modal */}
      {showCreateModal && (
        <div className="rooms-modal__overlay" onClick={closeCreateModal}>
          <div className="rooms-modal" onClick={e => e.stopPropagation()}>
            <h3 className="rooms-modal__title">Создать комнату</h3>
            <p className="rooms-modal__sub">Выберите источник, формат просмотра и сразу перейдите в плеер.</p>

            <div className="rooms-modal__choiceToggle">
              <div className={`rooms-modal__choicePill rooms-modal__choicePill--${createSource}`} />
              <button
                type="button"
                className={`rooms-modal__choiceTab rooms-modal__choiceTab--mode ${createSource === 'search' ? 'rooms-modal__choiceTab--active' : ''}`}
                onClick={() => { setCreateSource('search'); setCreateModalError('') }}
              >
                <svg className="rooms-modal__choiceIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Поиск фильма
              </button>
              <button
                type="button"
                className={`rooms-modal__choiceTab rooms-modal__choiceTab--mode ${createSource === 'link' ? 'rooms-modal__choiceTab--active' : ''}`}
                onClick={() => { setCreateSource('link'); setCreateModalError('') }}
              >
                <svg className="rooms-modal__choiceIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                По ссылке
              </button>
            </div>

            <div className="rooms-modal__choiceToggle rooms-modal__choiceToggle--mode">
              <div className={`rooms-modal__choicePill rooms-modal__choicePill--${createWatchMode}`} />
              <button
                type="button"
                className={`rooms-modal__choiceTab rooms-modal__choiceTab--mode ${createWatchMode === 'solo' ? 'rooms-modal__choiceTab--active' : ''}`}
                onClick={() => { setCreateWatchMode('solo'); setCreateModalError('') }}
              >
                <svg className="rooms-modal__choiceIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="10" cy="7" r="4" />
                </svg>
                <span>В одиночку</span>
              </button>
              <button
                type="button"
                className={`rooms-modal__choiceTab rooms-modal__choiceTab--mode ${createWatchMode === 'room' ? 'rooms-modal__choiceTab--active' : ''}`}
                onClick={() => { setCreateWatchMode('room'); setCreateModalError('') }}
              >
                <svg className="rooms-modal__choiceIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="10" cy="7" r="4" />
                  <path d="M20 8v6" />
                  <path d="M17 11h6" />
                </svg>
                <span>Создать комнату</span>
              </button>
            </div>

            {createSource === 'search' ? (
              <div className="rooms-modal__searchBlock">
                <label className="rooms-modal__fieldLabel">Найти фильм</label>
                <div className="rooms-modal__searchBox">
                  <svg className="rooms-modal__searchIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    className="rooms-modal__searchInput"
                    placeholder="Название фильма..."
                    value={createSearchQuery}
                    onChange={(event) => {
                      setCreateSearchQuery(event.target.value)
                      setCreateModalError('')
                    }}
                  />
                </div>

                {selectedCreateMovie && (
                  <button
                    type="button"
                    className="rooms-modal__selectedMovie"
                    onClick={() => setSelectedCreateMovie(null)}
                  >
                    <img src={getPosterUrl(selectedCreateMovie.poster_path, 'w185')} alt={selectedCreateMovie.title} />
                    <span className="rooms-modal__selectedMovieInfo">
                      <strong>{selectedCreateMovie.title}</strong>
                      <span>{selectedCreateMovie.release_date?.split('-')[0] || 'Без даты'}</span>
                    </span>
                    <span className="rooms-modal__selectedMovieAction">Сбросить</span>
                  </button>
                )}

                {!selectedCreateMovie && (
                  <div className="rooms-modal__searchResults">
                    {createSearchLoading ? (
                      <div className="rooms-modal__searchState">Поиск...</div>
                    ) : createSearchQuery.trim().length < 2 ? (
                      <div className="rooms-modal__searchState">Введите хотя бы 2 символа.</div>
                    ) : createSearchResults.length === 0 ? (
                      <div className="rooms-modal__searchState">Ничего не найдено.</div>
                    ) : (
                      createSearchResults.map(movie => (
                        <button
                          key={movie.id}
                          type="button"
                          className="rooms-modal__searchResult"
                          onClick={() => {
                            setSelectedCreateMovie(movie)
                            setCreateSearchQuery(movie.title)
                            setCreateModalError('')
                          }}
                        >
                          <img src={getPosterUrl(movie.poster_path, 'w185')} alt={movie.title} className="rooms-modal__searchPoster" />
                          <span className="rooms-modal__searchMeta">
                            <strong>{movie.title}</strong>
                            <span>{movie.release_date?.split('-')[0] || 'Без даты'}</span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="rooms-modal__searchBlock">
                <label className="rooms-modal__fieldLabel">Ссылка на видео</label>
                <div className="rooms-modal__searchBox">
                  <svg className="rooms-modal__searchIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  <input
                    type="text"
                    className="rooms-modal__searchInput"
                    placeholder="https://..."
                    value={createUrlInput}
                    onChange={(event) => {
                      setCreateUrlInput(event.target.value)
                      setCreateModalError('')
                    }}
                  />
                </div>
              </div>
            )}

            {createWatchMode === 'room' ? (
              <div className="rooms-modal__option">
                <div className="rooms-modal__optionInfo">
                  <span className="rooms-modal__optionLabel">Приватная комната</span>
                  <span className="rooms-modal__optionDesc">
                    {newRoomPrivate
                      ? 'Комната будет скрыта в списке и доступна только по ссылке.'
                      : 'Комната будет видна в общем списке.'}
                  </span>
                </div>
                <button
                  className={`rooms-modal__toggle${newRoomPrivate ? ' rooms-modal__toggle--active' : ''}`}
                  onClick={() => setNewRoomPrivate(!newRoomPrivate)}
                  type="button"
                >
                  <span className="rooms-modal__toggleThumb" />
                </button>
              </div>
            ) : (
              <div className="rooms-modal__option rooms-modal__option--soloHint">
                <div className="rooms-modal__optionInfo">
                  <span className="rooms-modal__optionLabel">Одиночный режим</span>
                  <span className="rooms-modal__optionDesc">Будет создана скрытая одиночная комната, которая не появится в общем списке.</span>
                </div>
              </div>
            )}

            <div className="rooms-modal__privacyHint">
              {createWatchMode === 'solo' ? (
                <div className="rooms-modal__hintRow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4l3 3" />
                  </svg>
                  <span>После подтверждения вы сразу попадёте в плеер выбранного фильма.</span>
                </div>
              ) : newRoomPrivate ? (
                <div className="rooms-modal__hintRow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span>Информация о фильме и участниках будет скрыта</span>
                </div>
              ) : (
                <div className="rooms-modal__hintRow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M2 12h20" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <span>Все пользователи могут видеть и присоединяться</span>
                </div>
              )}
            </div>

            {createModalError && <div className="rooms-modal__error">{createModalError}</div>}

            <div className="rooms-modal__actions">
              <button
                className="rooms-modal__cancelBtn"
                onClick={closeCreateModal}
              >
                Отмена
              </button>
              <button
                className="rooms-modal__confirmBtn"
                onClick={handleConfirmCreate}
                disabled={creating}
              >
                {creating ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
