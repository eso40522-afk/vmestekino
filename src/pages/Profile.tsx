import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth, type WatchedMovie } from '../contexts/AuthContext'
import AppHeader from '../components/AppHeader'
import { useSocket } from '../contexts/SocketContext'
import { API_URL } from '../config/api'
import { searchMovies, getPosterUrl, type TMDBMovie } from '../services/tmdb'
import ImageCropModal from '../components/ImageCropModal'
import './Profile.css'
import './Room.css'

interface FavoriteMovie {
  movieId: string | number
  title: string
  posterPath: string
  year: string
  voteAverage: number
  genreNames?: string
  addedAt?: string
}

export default function Profile() {
  const navigate = useNavigate()
  const { userId: paramUserId } = useParams<{ userId?: string }>()
  const { user, token, updateProfile, logout } = useAuth()
  const { currentRoomId } = useSocket()

  // Если есть paramUserId и это не текущий пользователь — смотрим чужой профиль
  const isOwnProfile = !paramUserId || paramUserId === user?.id
  const viewUserId = paramUserId || user?.id

  const [isEditing, setIsEditing] = useState(false)
  const [editUsername, setEditUsername] = useState('')
  const [editBio, setEditBio] = useState('')
  const [editAvatar, setEditAvatar] = useState('')
  const [editBanner, setEditBanner] = useState('')
  const [cropImage, setCropImage] = useState('')
  const [cropType, setCropType] = useState<'avatar' | 'banner'>('avatar')
  const [showCropModal, setShowCropModal] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [watchedMovies, setWatchedMovies] = useState<WatchedMovie[]>([])
  const [favoriteMovies, setFavoriteMovies] = useState<FavoriteMovie[]>([])
  const [showRateModal, setShowRateModal] = useState(false)
  const [rateMovieData, setRateMovieData] = useState({ movieId: '', title: '', posterPath: '', year: '' })
  const [rateValue, setRateValue] = useState(5)
  const [hoverRating, setHoverRating] = useState(0)
  const [isRating, setIsRating] = useState(false)
  const [showAddMovieModal, setShowAddMovieModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [activeTab, setActiveTab] = useState<'watched' | 'rated'>('watched')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [profileStats, setProfileStats] = useState<{ totalMovies: number; averageRating: number; topRated: any[] }>({ totalMovies: 0, averageRating: 0, topRated: [] })

  // Header search
  const [headerSearch, setHeaderSearch] = useState('')
  const [headerResults, setHeaderResults] = useState<TMDBMovie[]>([])
  const [showHeaderResults, setShowHeaderResults] = useState(false)
  const [headerSearching, setHeaderSearching] = useState(false)
  const headerSearchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Данные чужого профиля
  const [viewedProfile, setViewedProfile] = useState<{
    username: string; bio: string; avatar: string; banner: string; color: string; createdAt: string
  } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  // Redirect if not logged in or guest (only for own profile without param)
  useEffect(() => {
    if (!paramUserId && (!user || user.isGuest)) {
      navigate('/')
    }
  }, [user, navigate, paramUserId])

  // Load profile data
  useEffect(() => {
    if (viewUserId) {
      fetchProfile()
    }
  }, [viewUserId, token])

  // Header search with debounce
  useEffect(() => {
    if (headerSearchTimer.current) clearTimeout(headerSearchTimer.current)
    if (!headerSearch.trim() || headerSearch.trim().length < 2) {
      setHeaderResults([])
      setShowHeaderResults(false)
      return
    }
    setHeaderSearching(true)
    headerSearchTimer.current = setTimeout(async () => {
      try {
        const data = await searchMovies(headerSearch)
        setHeaderResults(data.results?.slice(0, 6) || [])
        setShowHeaderResults(true)
      } catch { /* ignore */ }
      setHeaderSearching(false)
    }, 300)
    return () => { if (headerSearchTimer.current) clearTimeout(headerSearchTimer.current) }
  }, [headerSearch])

  const fetchProfile = async () => {
    if (!viewUserId) return
    try {
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_URL}/profile/${viewUserId}`, { headers })
      const data = await res.json()
      if (data.profile) {
        setWatchedMovies(data.profile.watchedMovies || [])
        setFavoriteMovies(data.profile.favoriteMovies || [])
        if (data.profile.stats) {
          setProfileStats(data.profile.stats)
        }
        if (!isOwnProfile) {
          setViewedProfile({
            username: data.profile.username,
            bio: data.profile.bio || '',
            avatar: data.profile.avatar || '',
            banner: data.profile.banner || '',
            color: data.profile.color || '#6366f1',
            createdAt: data.profile.createdAt
          })
        }
      }
    } catch (err) {
      console.error('Error fetching profile:', err)
    }
  }

  const handleEditOpen = () => {
    if (!user) return
    setEditUsername(user.username || '')
    setEditBio(user.bio || '')
    setEditAvatar(user.avatar || '')
    setEditBanner(user.banner || '')
    setIsEditing(true)
  }

  const handleEditSave = async () => {
    setIsSaving(true)
    try {
      await updateProfile({
        username: editUsername,
        bio: editBio,
        avatar: editAvatar,
        banner: editBanner
      })
      setIsEditing(false)
    } catch (err: any) {
      console.error('Error saving profile:', err)
      alert(err.message || 'Ошибка сохранения профиля')
    } finally {
      setIsSaving(false)
    }
  }

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => {
      setCropImage(reader.result as string)
      setCropType('avatar')
      setShowCropModal(true)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleBannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => {
      setCropImage(reader.result as string)
      setCropType('banner')
      setShowCropModal(true)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleCropSave = (croppedImage: string) => {
    if (cropType === 'avatar') {
      setEditAvatar(croppedImage)
    } else {
      setEditBanner(croppedImage)
    }
    setShowCropModal(false)
  }

  const handleRateMovie = async () => {
    if (!token) return
    setIsRating(true)
    try {
      const res = await fetch(`${API_URL}/profile/rate-movie`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ...rateMovieData,
          rating: rateValue
        })
      })
      const data = await res.json()
      if (data.watchedMovies) {
        setWatchedMovies(data.watchedMovies)
      }
      setShowRateModal(false)
      setShowAddMovieModal(false)
    } catch (err) {
      console.error('Error rating movie:', err)
    } finally {
      setIsRating(false)
    }
  }

  const handleDeleteMovie = async (movieId: string | number) => {
    if (!token) return
    try {
      const res = await fetch(`${API_URL}/profile/watched/${movieId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.watchedMovies) {
        setWatchedMovies(data.watchedMovies)
      }
      setShowDeleteConfirm(null)
    } catch (err) {
      console.error('Error deleting movie:', err)
    }
  }

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim() || query.trim().length < 2) {
      setSearchResults([])
      return
    }
    setIsSearching(true)
    try {
      const data = await searchMovies(query)
      setSearchResults(data.results?.slice(0, 8) || [])
    } catch (err) {
      console.error('Error searching TMDB:', err)
    } finally {
      setIsSearching(false)
    }
  }, [])

  // Живой поиск с debounce 300мс
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([])
      return
    }
    searchTimerRef.current = setTimeout(() => {
      doSearch(searchQuery)
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [searchQuery, doSearch])

  const selectMovieToRate = (movie: any) => {
    setRateMovieData({
      movieId: movie.id,
      title: movie.title,
      posterPath: getPosterUrl(movie.poster_path, 'w185'),
      year: movie.release_date?.split('-')[0] || ''
    })
    setRateValue(5)
    setHoverRating(0)
    setShowRateModal(true)
  }

  const openEditRating = (movie: WatchedMovie) => {
    setRateMovieData({
      movieId: String(movie.movieId),
      title: movie.title,
      posterPath: movie.posterPath,
      year: movie.year
    })
    setRateValue(movie.rating)
    setHoverRating(0)
    setShowRateModal(true)
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const months = [
      'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ]
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
  }

  const renderStars = (rating: number, interactive = false, size = 18) => {
    const stars = []
    for (let i = 1; i <= 10; i++) {
      const active = interactive ? (hoverRating || rateValue) >= i : rating >= i
      stars.push(
        <span
          key={i}
          className={`profile-star ${active ? 'profile-star--active' : ''} ${interactive ? 'profile-star--interactive' : ''}`}
          style={{ fontSize: size }}
          onClick={interactive ? () => setRateValue(i) : undefined}
          onMouseEnter={interactive ? () => setHoverRating(i) : undefined}
          onMouseLeave={interactive ? () => setHoverRating(0) : undefined}
        >
          ★
        </span>
      )
    }
    return <div className="profile-stars">{stars}</div>
  }

  if (!isOwnProfile && !viewedProfile) {
    // Loading other user's profile or not found
    return (
      <div className="profile-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16 }}>Загрузка профиля...</div>
      </div>
    )
  }

  if (isOwnProfile && (!user || user.isGuest)) return null

  // Собираем данные профиля: свой или чужой
  const profileData = isOwnProfile ? {
    username: user!.username,
    bio: user!.bio || '',
    avatar: user!.avatar || '',
    banner: user!.banner || '',
    color: user!.color,
    email: user!.email,
    initials: user!.initials,
    createdAt: user!.createdAt
  } : {
    username: viewedProfile!.username,
    bio: viewedProfile!.bio,
    avatar: viewedProfile!.avatar,
    banner: viewedProfile!.banner,
    color: viewedProfile!.color,
    email: '',
    initials: viewedProfile!.username.slice(0, 2).toUpperCase(),
    createdAt: viewedProfile!.createdAt
  }

  const sortedMovies = [...watchedMovies].sort((a, b) => {
    return new Date(b.ratedAt).getTime() - new Date(a.ratedAt).getTime()
  })

  const sortedFavorites = [...favoriteMovies].sort((a, b) => {
    return new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime()
  })

  const visibleMovies = activeTab === 'watched' ? sortedMovies : sortedFavorites

  return (
    <div className="profile-page">
      {/* Background */}
      <div className="profile-bg-glow profile-bg-glow--1" />
      <div className="profile-bg-glow profile-bg-glow--2" />

      {/* Header Islands */}
      <AppHeader
          onLogoClick={() => navigate('/')}
          onRoomsClick={() => currentRoomId ? navigate(`/room/${currentRoomId}`) : navigate('/rooms')}
          roomsOnline={Boolean(currentRoomId)}
          onLibraryClick={() => navigate('/rooms')}
          libraryActive={false}
          onPlayerClick={() => currentRoomId && navigate(`/room/${currentRoomId}`)}
          playerDisabled={!currentRoomId}
          playerTitle={currentRoomId ? 'Вернуться в комнату' : 'Нет активной комнаты'}
          showFavoriteButton={Boolean(user && !user.isGuest)}
          onFavoriteClick={() => setActiveTab('rated')}
          favoriteActive={activeTab === 'rated'}
          onLinkClick={() => currentRoomId ? navigate(`/room/${currentRoomId}`) : navigate('/rooms')}
          linkDisabled={!currentRoomId}
          search={{
            mode: 'interactive',
            value: headerSearch,
            onChange: setHeaderSearch,
            onSubmit: (event) => event.preventDefault(),
            onFocus: () => headerResults.length > 0 && setShowHeaderResults(true),
            results: headerResults,
            showResults: showHeaderResults,
            searching: headerSearching,
            onCloseResults: () => setShowHeaderResults(false),
            onSelectResult: (movie) => {
              setShowHeaderResults(false)
              setHeaderSearch('')
              navigate(`/room?movie=${movie.id}`)
            },
            placeholder: 'Фильмы, сериалы, актёры...'
          }}
          user={user}
          onLoginClick={() => navigate('/login')}
          onProfileClick={() => navigate('/profile')}
          onLogoutClick={logout}
        />

      {/* Banner */}
      <div className="profile-banner" style={profileData.banner ? { backgroundImage: `url(${profileData.banner})` } : {}}>
        <button className="profile-back-btn" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        {!profileData.banner && (
          <div className="profile-banner__default">
            <div className="profile-banner__gradient" />
          </div>
        )}
      </div>

      {/* Profile header */}
      <div className="profile-header">
        <div className="profile-header__top">
          <div className="profile-avatar-wrapper">
            {profileData.avatar ? (
              <img src={profileData.avatar} alt={profileData.username} className="profile-avatar-img" />
            ) : (
              <div className="profile-avatar-placeholder" style={{ background: profileData.color }}>
                {profileData.initials}
              </div>
            )}
          </div>
          {isOwnProfile && (
            <button className="profile-edit-btn" onClick={handleEditOpen}>
              Редактировать профиль
            </button>
          )}
        </div>

        <div className="profile-info">
          <h1 className="profile-info__name">{profileData.username}</h1>
          {profileData.email && <span className="profile-info__handle">@{profileData.email.split('@')[0]}</span>}
          {profileData.bio && <p className="profile-info__bio">{profileData.bio}</p>}
          <div className="profile-info__meta">
            <span className="profile-info__meta-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Регистрация: {formatDate(profileData.createdAt)}
            </span>
          </div>
          <div className="profile-info__stats">
            <div className="profile-info__stat">
              <span className="profile-info__stat-number">{profileStats.totalMovies}</span>
              <span className="profile-info__stat-label">Просмотрено</span>
            </div>
            <div className="profile-info__stat">
              <span className="profile-info__stat-number">
                {profileStats.averageRating > 0 ? profileStats.averageRating : '—'}
              </span>
              <span className="profile-info__stat-label">Средняя оценка</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="profile-tabs">
        <div className={`profile-tabPill profile-tabPill--${activeTab}`} />
        <button
          className={`profile-tab ${activeTab === 'watched' ? 'profile-tab--active' : ''}`}
          onClick={() => setActiveTab('watched')}
        >
          Просмотренные
        </button>
        <button
          className={`profile-tab ${activeTab === 'rated' ? 'profile-tab--active' : ''}`}
          onClick={() => setActiveTab('rated')}
        >
          Избранное
        </button>
      </div>

      {/* Content */}
      <div className="profile-content">
        {/* Add movie button */}
        {isOwnProfile && activeTab === 'watched' && (
          <button className="profile-add-movie-btn" onClick={() => { setShowAddMovieModal(true); setSearchQuery(''); setSearchResults([]); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Добавить фильм
          </button>
        )}

        {visibleMovies.length === 0 ? (
          <div className="profile-empty">
            <div className="profile-empty__icon">{activeTab === 'watched' ? '🎬' : '❤️'}</div>
            <h3 className="profile-empty__title">{activeTab === 'watched' ? 'Пока нет фильмов' : 'Пока нет избранного'}</h3>
            <p className="profile-empty__text">
              {activeTab === 'watched'
                ? 'Добавьте фильмы, которые вы посмотрели, и оцените их'
                : 'Здесь будут отображаться фильмы, которые пользователь добавил в избранное'}
            </p>
          </div>
        ) : (
          <div className="profile-movies-grid">
            {visibleMovies.map((movie) => (
              <div key={movie.movieId} className="profile-movie-card">
                <div className="profile-movie-card__poster">
                  {movie.posterPath ? (
                    <img src={movie.posterPath} alt={movie.title} />
                  ) : (
                    <div className="profile-movie-card__no-poster">🎬</div>
                  )}
                  {isOwnProfile && activeTab === 'watched' && (
                    <div className="profile-movie-card__overlay">
                      <button
                        className="profile-movie-card__action"
                        onClick={() => openEditRating(movie as WatchedMovie)}
                        title="Изменить оценку"
                      >
                        ✏️
                      </button>
                      <button
                        className="profile-movie-card__action profile-movie-card__action--delete"
                        onClick={() => setShowDeleteConfirm(String(movie.movieId))}
                        title="Удалить"
                      >
                        🗑️
                      </button>
                    </div>
                  )}
                </div>
                <div className="profile-movie-card__info">
                  <h4 className="profile-movie-card__title">{movie.title}</h4>
                  {movie.year && <span className="profile-movie-card__year">{movie.year}</span>}
                  {activeTab === 'watched' ? (
                    <div className="profile-movie-card__rating">
                      <span className="profile-movie-card__rating-value">{(movie as WatchedMovie).rating}</span>
                      <span className="profile-movie-card__rating-star">★</span>
                      <span className="profile-movie-card__rating-max">/10</span>
                    </div>
                  ) : (
                    <div className="profile-movie-card__rating">
                      <span className="profile-movie-card__rating-value">{(movie as FavoriteMovie).voteAverage ? (movie as FavoriteMovie).voteAverage.toFixed(1) : '—'}</span>
                      <span className="profile-movie-card__rating-star">❤</span>
                    </div>
                  )}
                </div>

                {/* Delete confirmation */}
                {activeTab === 'watched' && showDeleteConfirm === String(movie.movieId) && (
                  <div className="profile-delete-confirm">
                    <p>Удалить фильм?</p>
                    <div className="profile-delete-confirm__actions">
                      <button className="profile-delete-confirm__btn profile-delete-confirm__btn--yes" onClick={() => handleDeleteMovie(movie.movieId)}>
                        Да
                      </button>
                      <button className="profile-delete-confirm__btn profile-delete-confirm__btn--no" onClick={() => setShowDeleteConfirm(null)}>
                        Нет
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Profile Modal */}
      {isEditing && (
        <div className="profile-modal-overlay" onClick={() => setIsEditing(false)}>
          <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal__header">
              <button className="profile-modal__close" onClick={() => setIsEditing(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <h2 className="profile-modal__title">Редактировать профиль</h2>
              <button className="profile-modal__save" onClick={handleEditSave} disabled={isSaving}>
                {isSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>

            {/* Banner edit */}
            <div
              className="profile-modal__banner"
              style={editBanner ? { backgroundImage: `url(${editBanner})` } : {}}
              onClick={() => bannerInputRef.current?.click()}
            >
              <div className="profile-modal__banner-overlay">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </div>
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/*"
                className="profile-modal__file-input"
                onChange={handleBannerUpload}
              />
            </div>

            {/* Avatar edit */}
            <div className="profile-modal__avatar-section">
              <div className="profile-modal__avatar" onClick={() => fileInputRef.current?.click()}>
                {editAvatar ? (
                  <img src={editAvatar} alt="Avatar" className="profile-modal__avatar-img" />
                ) : (
                  <div className="profile-modal__avatar-placeholder" style={{ background: user?.color }}>
                    {user?.initials}
                  </div>
                )}
                <div className="profile-modal__avatar-overlay">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="profile-modal__file-input"
                  onChange={handleAvatarUpload}
                />
              </div>
            </div>

            {/* Form fields */}
            <div className="profile-modal__form">
              <div className="profile-modal__field">
                <label className="profile-modal__label">Имя</label>
                <input
                  type="text"
                  className="profile-modal__input"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  maxLength={30}
                  placeholder="Ваше имя"
                />
                <span className="profile-modal__char-count">{editUsername.length}/30</span>
              </div>
              <div className="profile-modal__field">
                <label className="profile-modal__label">О себе</label>
                <textarea
                  className="profile-modal__textarea"
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  maxLength={100}
                  placeholder="Расскажите о себе"
                  rows={3}
                />
                <span className="profile-modal__char-count">{editBio.length}/100</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image Crop Modal */}
      {showCropModal && cropImage && (
        <ImageCropModal
          image={cropImage}
          aspectRatio={cropType === 'avatar' ? 1 : 3}
          title={cropType === 'avatar' ? 'Редактирование аватарки' : 'Редактирование баннера'}
          isCircle={cropType === 'avatar'}
          outputWidth={cropType === 'avatar' ? 256 : 1200}
          outputHeight={cropType === 'avatar' ? 256 : 400}
          onSave={handleCropSave}
          onClose={() => setShowCropModal(false)}
        />
      )}

      {/* Add Movie Modal */}
      {showAddMovieModal && (
        <div className="profile-modal-overlay" onClick={() => setShowAddMovieModal(false)}>
          <div className="profile-modal profile-modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal__header">
              <button className="profile-modal__close" onClick={() => setShowAddMovieModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <h2 className="profile-modal__title">Добавить фильм</h2>
              <div style={{ width: 60 }} />
            </div>

            <div className="profile-search">
              <div className="profile-search__input-wrapper">
                <svg className="profile-search__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  className="profile-search__input"
                  placeholder="Фильмы, сериалы, актёры..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
                {isSearching && <span className="profile-search__spinner">⏳</span>}
              </div>
            </div>

            <div className="profile-search-results">
              {searchResults.map((movie) => (
                <div
                  key={movie.id}
                  className="profile-search-result"
                  onClick={() => selectMovieToRate(movie)}
                >
                  <div className="profile-search-result__poster">
                    {movie.poster_path ? (
                      <img src={getPosterUrl(movie.poster_path, 'w185')} alt={movie.title} />
                    ) : (
                      <div className="profile-search-result__no-poster">🎬</div>
                    )}
                  </div>
                  <div className="profile-search-result__info">
                    <h4 className="profile-search-result__title">{movie.title}</h4>
                    <span className="profile-search-result__year">{movie.release_date?.split('-')[0]}</span>
                  </div>
                  <div className="profile-search-result__add">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </div>
                </div>
              ))}
              {searchResults.length === 0 && searchQuery && !isSearching && (
                <div className="profile-search__empty">Ничего не найдено</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rate Modal */}
      {showRateModal && (
        <div className="profile-modal-overlay" onClick={() => setShowRateModal(false)}>
          <div className="profile-modal profile-modal--rate" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal__header">
              <button className="profile-modal__close" onClick={() => setShowRateModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <h2 className="profile-modal__title">Оценить фильм</h2>
              <div style={{ width: 60 }} />
            </div>

            <div className="profile-rate-content">
              <div className="profile-rate-movie">
                {rateMovieData.posterPath ? (
                  <img src={rateMovieData.posterPath} alt={rateMovieData.title} className="profile-rate-movie__poster" />
                ) : (
                  <div className="profile-rate-movie__no-poster">🎬</div>
                )}
                <div className="profile-rate-movie__info">
                  <h3 className="profile-rate-movie__title">{rateMovieData.title}</h3>
                  {rateMovieData.year && <span className="profile-rate-movie__year">{rateMovieData.year}</span>}
                </div>
              </div>

              <div className="profile-rate-stars">
                <span className="profile-rate-value">{hoverRating || rateValue}</span>
                {renderStars(rateValue, true, 28)}
              </div>

              <button
                className="profile-rate-submit"
                onClick={handleRateMovie}
                disabled={isRating}
              >
                {isRating ? 'Сохранение...' : 'Сохранить оценку'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
