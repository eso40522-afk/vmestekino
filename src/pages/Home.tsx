import { useState, useEffect, useRef, memo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useSocket } from '../contexts/SocketContext'
import { getPopularMovies, getNowPlayingMovies, getTopRatedMovies, searchMovies, getPosterUrl, getBackdropUrl, formatReleaseDate, type TMDBMovie } from '../services/tmdb'
import { buildMovieSlug } from '../utils/movieSlug'
import UrlPasteModal from '../components/UrlPasteModal'
import FriendsPanel from '../components/FriendsPanel'
import MessengerPanel from '../components/MessengerPanel'
import LegalModal, { type LegalTab } from '../components/LegalModal'

/* ===== Movie Card (stable, memoized) ===== */
const MovieCard = memo(({ movie, onClick }: { movie: TMDBMovie; onClick: (movie: TMDBMovie) => void }) => (
  <div className="kp-card" onClick={() => onClick(movie)}>
    <div className="kp-card__poster">
      <img src={getPosterUrl(movie.poster_path, 'w342')} alt={movie.title} loading="lazy" />
      {movie.vote_average > 0 && (
        <span className={`kp-card__rating ${movie.vote_average >= 7 ? 'kp-card__rating--green' : movie.vote_average >= 5 ? 'kp-card__rating--yellow' : 'kp-card__rating--red'}`}>
          {movie.vote_average.toFixed(1)}
        </span>
      )}
      <div className="kp-card__overlay">
        <span className="kp-card__play">▶</span>
      </div>
    </div>
    <div className="kp-card__info">
      <div className="kp-card__title">{movie.title}</div>
      <div className="kp-card__year">{movie.release_date?.split('-')[0]}</div>
    </div>
  </div>
))

/* ===== Movie Row with infinite carousel (stable component) ===== */
const MovieRow = memo(({ title, movies, speed = 0.5, reverse = false, onClick }: {
  title: string
  movies: TMDBMovie[]
  speed?: number
  reverse?: boolean
  onClick: (movie: TMDBMovie) => void
}) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const firstHalfRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const posRef = useRef<number | null>(null) // null = not initialized
  const pausedRef = useRef(false)

  useEffect(() => {
    const track = trackRef.current
    const firstHalf = firstHalfRef.current
    if (!track || !firstHalf || movies.length === 0) return

    const GAP = 16
    let halfWidth = firstHalf.scrollWidth + GAP

    // Initialize position once
    if (posRef.current === null) {
      posRef.current = reverse ? -halfWidth : 0
    }

    // Re-measure when images load / content resizes
    const ro = new ResizeObserver(() => {
      halfWidth = firstHalf.scrollWidth + GAP
    })
    ro.observe(firstHalf)

    let lastTime = 0
    const step = (time: number) => {
      if (lastTime === 0) lastTime = time
      const dt = time - lastTime
      lastTime = time

      if (!pausedRef.current && dt < 100) { // skip big gaps (tab switch etc)
        const px = speed * dt * 0.06 // normalize: ~0.5px per frame at 60fps
        if (reverse) {
          posRef.current! += px
          if (posRef.current! >= 0) posRef.current! -= halfWidth
        } else {
          posRef.current! -= px
          if (posRef.current! <= -halfWidth) posRef.current! += halfWidth
        }
        track.style.transform = `translateX(${posRef.current}px)`
      } else if (dt >= 100) {
        // After long pause, just keep position, don't jump
      }
      rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [movies, speed, reverse])

  return (
    <section className="kp-row">
      <div className="kp-row__header">
        <h2 className="kp-row__title">{title}</h2>
      </div>
      <div
        className="kp-carousel"
        onMouseEnter={() => { pausedRef.current = true }}
        onMouseLeave={() => { pausedRef.current = false }}
      >
        <div className="kp-carousel__fade kp-carousel__fade--left" />
        <div className="kp-carousel__fade kp-carousel__fade--right" />
        <div className="kp-carousel__track" ref={trackRef}>
          <div className="kp-carousel__set" ref={firstHalfRef}>
            {movies.map(m => <MovieCard key={`a-${m.id}`} movie={m} onClick={onClick} />)}
          </div>
          <div className="kp-carousel__set">
            {movies.map(m => <MovieCard key={`b-${m.id}`} movie={m} onClick={onClick} />)}
          </div>
        </div>
      </div>
    </section>
  )
})

const faqData = [
  {
    question: 'Как смотреть вместе?',
    answer: 'Создайте комнату, выберите фильм из каталога или вставьте свою ссылку и поделитесь приглашением с друзьями. Воспроизведение, пауза и перемотка синхронизируются для всех участников автоматически.'
  },
  {
    question: 'Нужна ли регистрация?',
    answer: 'Можно войти как гость и сразу присоединяться к комнатам. Регистрация открывает: личный профиль, друзей, личные сообщения, историю просмотров, оценки фильмов и избранное.'
  },
  {
    question: 'Сколько людей могут быть в комнате?',
    answer: 'Технических жёстких ограничений нет — комната рассчитана на дружескую компанию (обычно до 20 человек). Лидер комнаты может приглашать друзей по ссылке или прямо из списка друзей.'
  },
  {
    question: 'Какие фильмы доступны?',
    answer: 'Каталог построен на базе TMDB — это десятки тысяч фильмов и сериалов с описаниями, постерами и оценками. Однако воспроизведение доступно не для всех тайтлов: часть фильмов проигрывается через RuTube и другие открытые источники, поэтому в редких случаях видео может быть недоступно в вашем регионе или временно отсутствовать. Также можно вставить любую свою ссылку — YouTube, RuTube, VK Видео или прямой MP4.'
  },
  {
    question: 'Какие источники видео поддерживаются?',
    answer: 'YouTube, RuTube, VK Видео, прямые ссылки на MP4/HLS, а также встраиваемые плееры из каталога. Достаточно вставить ссылку — сервис сам подберёт нужный плеер.'
  },
  {
    question: 'Что ещё есть на сайте?',
    answer: 'Чат в реальном времени с эмодзи, GIF и опросами, голосовые реакции, система друзей и личные сообщения, мини-профили участников прямо в чате, приватные и публичные комнаты, режим одиночного просмотра, оценки и избранное фильмов.'
  },
  {
    question: 'Это бесплатно?',
    answer: 'Да, сервис полностью бесплатный. Создавайте комнаты, приглашайте друзей и смотрите фильмы вместе без ограничений и без рекламы.'
  }
]

const featureCards = [
  {
    title: 'Совместный просмотр',
    text: 'Создайте комнату и смотрите фильмы с друзьями. Видео синхронизируется для всех участников.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none"><rect x="4" y="8" width="40" height="28" rx="3" stroke="currentColor" strokeWidth="2.5"/><polygon points="20,15 20,29 32,22" fill="currentColor" opacity="0.6"/><line x1="14" y1="42" x2="34" y2="42" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><line x1="24" y1="36" x2="24" y2="42" stroke="currentColor" strokeWidth="2.5"/></svg>
    )
  },
  {
    title: 'Чат в реальном времени',
    text: 'Обсуждайте моменты прямо во время просмотра. Текстовые сообщения и голосовые реакции.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none"><rect x="6" y="8" width="36" height="24" rx="4" stroke="currentColor" strokeWidth="2.5"/><polygon points="12,32 12,40 20,32" fill="currentColor" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/><circle cx="17" cy="20" r="2" fill="currentColor" opacity="0.6"/><circle cx="24" cy="20" r="2" fill="currentColor" opacity="0.6"/><circle cx="31" cy="20" r="2" fill="currentColor" opacity="0.6"/></svg>
    )
  },
  {
    title: 'Мгновенный старт',
    text: 'Без регистрации и скачивания. Просто создайте комнату и поделитесь ссылкой.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth="2.5"/><path d="M24 14v10l7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
    )
  },
  {
    title: 'До 20 участников',
    text: 'Приглашайте друзей, семью или коллег. Всё управление синхронизируется автоматически.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none"><path d="M18 8a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM30 8a6 6 0 1 1 0 12 6 6 0 0 1 0-12z" stroke="currentColor" strokeWidth="2.5"/><path d="M8 38c0-7 4.5-12 10-12h12c5.5 0 10 5 10 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
    )
  }
]

export default function Home() {
  const navigate = useNavigate()
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [legalTab, setLegalTab] = useState<LegalTab | null>(null)
  const [showUrlPasteModal, setShowUrlPasteModal] = useState(false)
  const [showFriendsPanel, setShowFriendsPanel] = useState(false)
  const [showMessengerPanel, setShowMessengerPanel] = useState(false)
  const [messengerInitialUserId, setMessengerInitialUserId] = useState<string | null>(null)
  const { user, logout } = useAuth()
  const { currentRoomId, createRoom, pendingFriendRequests, unreadDmCount } = useSocket()

  // Movie data
  const [heroMovie, setHeroMovie] = useState<TMDBMovie | null>(null)
  const [popularMovies, setPopularMovies] = useState<TMDBMovie[]>([])
  const [nowPlaying, setNowPlaying] = useState<TMDBMovie[]>([])
  const [topRated, setTopRated] = useState<TMDBMovie[]>([])
  const [heroIndex, setHeroIndex] = useState(0)
  const [heroMovies, setHeroMovies] = useState<TMDBMovie[]>([])
  const [headerSearch, setHeaderSearch] = useState('')
  const [headerResults, setHeaderResults] = useState<TMDBMovie[]>([])
  const [showHeaderResults, setShowHeaderResults] = useState(false)
  const [headerSearching, setHeaderSearching] = useState(false)
  const headerSearchRef = useRef<HTMLDivElement>(null)
  const headerSearchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)


  // Load movie data
  useEffect(() => {
    const loadMovies = async () => {
      try {
        const [popular, playing, top] = await Promise.all([
          getPopularMovies(1),
          getNowPlayingMovies(1),
          getTopRatedMovies(1)
        ])
        setPopularMovies(popular.results)
        setNowPlaying(playing.results)
        setTopRated(top.results)

        // Hero movies — top 5 with backdrop
        const heroes = popular.results.filter(m => m.backdrop_path).slice(0, 5)
        setHeroMovies(heroes)
        if (heroes.length > 0) setHeroMovie(heroes[0])
      } catch (err) {
        console.error('Failed to load movies:', err)
      }
    }
    loadMovies()
  }, [])

  // Auto-rotate hero
  useEffect(() => {
    if (heroMovies.length <= 1) return
    const timer = setInterval(() => {
      setHeroIndex(prev => {
        const next = (prev + 1) % heroMovies.length
        setHeroMovie(heroMovies[next])
        return next
      })
    }, 6000)
    return () => clearInterval(timer)
  }, [heroMovies])

  const handleWatchTogether = useCallback(() => navigate('/library'), [navigate])
  const handleMovieClick = useCallback((movie: TMDBMovie) => {
    const slug = buildMovieSlug({
      id: movie.id,
      title: movie.title,
      originalTitle: movie.original_title,
      year: movie.release_date
    })
    navigate(`/library/${slug}`)
  }, [navigate])

  // Header search with debounce
  useEffect(() => {
    if (!headerSearch.trim() || headerSearch.trim().length < 2) {
      setHeaderResults([])
      setShowHeaderResults(false)
      return
    }
    clearTimeout(headerSearchTimer.current)
    setHeaderSearching(true)
    headerSearchTimer.current = setTimeout(async () => {
      try {
        const res = await searchMovies(headerSearch, 1)
        setHeaderResults(res.results.slice(0, 5))
        setShowHeaderResults(res.results.length > 0)
      } catch {
        setHeaderResults([])
      } finally {
        setHeaderSearching(false)
      }
    }, 400)
    return () => clearTimeout(headerSearchTimer.current)
  }, [headerSearch])

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (headerSearchRef.current && !headerSearchRef.current.contains(e.target as Node)) {
        setShowHeaderResults(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!showMobileMenu) {
      document.body.style.removeProperty('overflow')
      return
    }

    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.removeProperty('overflow')
    }
  }, [showMobileMenu])

  const closeMobileMenu = useCallback(() => setShowMobileMenu(false), [])

  const renderHeaderSearch = (inDrawer = false) => (
    <div className={`kp-header-search${inDrawer ? ' kp-header-search--drawer' : ''}`} ref={!inDrawer ? headerSearchRef : undefined}>
      <div className="kp-header-search__bar">
        <svg className="kp-header-search__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="kp-header-search__input"
          placeholder="Фильмы, сериалы, актёры..."
          value={headerSearch}
          onChange={e => setHeaderSearch(e.target.value)}
          onFocus={() => headerResults.length > 0 && setShowHeaderResults(true)}
        />
      </div>
      {showHeaderResults && (
        <div className={`kp-header-search__dropdown${inDrawer ? ' kp-header-search__dropdown--drawer' : ''}`}>
          {headerSearching ? (
            <div className="kp-header-search__loading">Поиск...</div>
          ) : (
            headerResults.map(movie => (
              <div
                key={movie.id}
                className="kp-header-search__result"
                onClick={() => {
                  setShowHeaderResults(false)
                  setHeaderSearch('')
                  closeMobileMenu()
                  handleMovieClick(movie)
                }}
              >
                <img src={getPosterUrl(movie.poster_path, 'w185')} alt={movie.title} className="kp-header-search__poster" />
                <div className="kp-header-search__info">
                  <span className="kp-header-search__title">{movie.title}</span>
                  <span className="kp-header-search__meta">
                    {formatReleaseDate(movie.release_date)}
                    {movie.vote_average > 0 && <span className="kp-header-search__rating">⭐ {movie.vote_average.toFixed(1)}</span>}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className="kp-page">
      {/* Header */}
      <header className="kp-header">
        <div className="kp-mobileTopbar">
          <button className="kp-mobileTopbar__menu" onClick={() => setShowMobileMenu(true)} type="button" aria-label="Открыть меню">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>
          <a href="#" className="kp-logo kp-mobileTopbar__logo" onClick={e => e.preventDefault()}>
            <span className="kp-logo__star">✦</span>
            <span>ВместеКино</span>
          </a>
          {user && !user.isGuest ? (
            <button className="kp-mobileTopbar__avatar" onClick={() => navigate('/profile')} type="button" aria-label="Профиль">
              {user.avatar ? <img src={user.avatar} alt={user.username} className="avatar__img" /> : (user.initials || '?')}
            </button>
          ) : (
            <button className="kp-mobileTopbar__login" onClick={() => navigate('/login')} type="button">Войти</button>
          )}
        </div>

        {showMobileMenu && <div className="kp-mobileDrawerBackdrop" onClick={closeMobileMenu} />}
        <aside className={`kp-mobileDrawer${showMobileMenu ? ' kp-mobileDrawer--open' : ''}`} aria-hidden={!showMobileMenu}>
          <div className="kp-mobileDrawer__header">
            <div className="kp-mobileDrawer__brand">
              <span className="kp-logo__star">✦</span>
              <span>ВместеКино</span>
            </div>
            <button className="kp-mobileDrawer__close" onClick={closeMobileMenu} type="button" aria-label="Закрыть меню">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="kp-mobileDrawer__body">
            {renderHeaderSearch(true)}

            <div className="kp-mobileDrawer__section">
              <button className="kp-mobileDrawer__action" onClick={() => { closeMobileMenu(); navigate('/rooms') }} type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="2" />
                  <rect x="14" y="3" width="7" height="7" rx="2" />
                  <rect x="3" y="14" width="7" height="7" rx="2" />
                  <rect x="14" y="14" width="7" height="7" rx="2" />
                </svg>
                Комнаты
              </button>
              <button className="kp-mobileDrawer__action" onClick={() => { closeMobileMenu(); navigate('/library') }} type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="2" width="20" height="20" rx="2" />
                  <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" />
                </svg>
                Библиотека
              </button>
              <button
                className="kp-mobileDrawer__action"
                onClick={() => { closeMobileMenu(); if (currentRoomId) navigate(`/room/${currentRoomId}`) }}
                type="button"
                disabled={!currentRoomId}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                {currentRoomId ? 'Вернуться в комнату' : 'Нет активной комнаты'}
              </button>
              {user && !user.isGuest && (
                <button className="kp-mobileDrawer__action" onClick={() => { closeMobileMenu(); navigate('/library?favorites=1') }} type="button">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  Избранное
                </button>
              )}
              <button className="kp-mobileDrawer__action" onClick={() => { closeMobileMenu(); setShowUrlPasteModal(true) }} type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                Вставить ссылку
              </button>
              {!user && (
                <button className="kp-mobileDrawer__action kp-mobileDrawer__action--primary" onClick={() => { closeMobileMenu(); navigate('/register') }} type="button">
                  Создать аккаунт
                </button>
              )}
            </div>

            {user && !user.isGuest && (
              <div className="kp-mobileDrawer__section">
                <button
                  className={`kp-mobileDrawer__action${showFriendsPanel ? ' kp-mobileDrawer__action--active' : ''}`}
                  onClick={() => { closeMobileMenu(); setShowMessengerPanel(false); setShowFriendsPanel(true) }}
                  type="button"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  <span className="kp-mobileDrawer__actionLabel">Друзья</span>
                  {pendingFriendRequests > 0 && (
                    <span className="kp-mobileDrawer__badge">{pendingFriendRequests}</span>
                  )}
                </button>
                <button
                  className={`kp-mobileDrawer__action${showMessengerPanel ? ' kp-mobileDrawer__action--active' : ''}`}
                  onClick={() => { closeMobileMenu(); setShowFriendsPanel(false); setMessengerInitialUserId(null); setShowMessengerPanel(true) }}
                  type="button"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="kp-mobileDrawer__actionLabel">Сообщения</span>
                  {unreadDmCount > 0 && (
                    <span className="kp-mobileDrawer__badge">{unreadDmCount}</span>
                  )}
                </button>
              </div>
            )}

            <div className="kp-mobileDrawer__section kp-mobileDrawer__section--account">
              {user && !user.isGuest ? (
                <>
                  <button className="kp-mobileDrawer__action" onClick={() => { closeMobileMenu(); navigate('/profile') }} type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 0 0-16 0" /></svg>
                    Мой аккаунт
                  </button>
                  <button className="kp-mobileDrawer__action kp-mobileDrawer__action--danger" onClick={() => { closeMobileMenu(); logout() }} type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                    Выйти
                  </button>
                </>
              ) : (
                <button className="kp-mobileDrawer__action" onClick={() => { closeMobileMenu(); navigate('/login') }} type="button">
                  Войти
                </button>
              )}
            </div>
          </div>
        </aside>

        <a href="#" className="kp-logo" onClick={e => e.preventDefault()}>
          <span className="kp-logo__star">✦</span>
          <span>ВместеКино</span>
        </a>
        <nav className="kp-nav">
          {renderHeaderSearch()}
          {user && !user.isGuest ? (
            <>
              <div className="avatar-wrapper">
                <button className="avatar" onClick={() => setShowUserMenu(!showUserMenu)} aria-label="Меню пользователя">
                  {user.avatar ? <img src={user.avatar} alt={user.username} className="avatar__img" /> : (user.initials || '?')}
                </button>
                {showUserMenu && (
                  <div className="avatar-menu">
                    <button className="avatar-menu__item" onClick={() => { setShowUserMenu(false); navigate('/profile') }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>
                      Мой аккаунт
                    </button>
                    <button className="avatar-menu__item" onClick={() => { logout(); setShowUserMenu(false) }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                      Выйти
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <button className="kp-btn kp-btn--ghost" onClick={() => navigate('/login')}>Войти</button>
            </>
          )}
        </nav>
      </header>

      {/* Hero */}
      <section className="kp-hero">
        <div className="kp-hero__bg">
          {heroMovie?.backdrop_path && (
            <img src={getBackdropUrl(heroMovie.backdrop_path, 'original')} alt="" className="kp-hero__bg-img" key={heroMovie.id} />
          )}
          <div className="kp-hero__gradient" />
        </div>
        <div className="kp-hero__content">
          <h1 className="kp-hero__title">
            Смотрите фильмы и сериалы<br />
            <span className="kp-hero__title--accent">вместе с друзьями</span>
          </h1>
          <p className="kp-hero__sub">
            Тысячи фильмов и сериалов. Создайте комнату, пригласите друзей<br />
            и наслаждайтесь просмотром в синхронном режиме
          </p>
          <div className="kp-hero__actions">
            <button className="kp-btn kp-btn--cta" onClick={handleWatchTogether}>
              Начать просмотр
            </button>
            {!user && (
              <button className="kp-btn kp-btn--outline" onClick={() => navigate('/register')}>
                Создать аккаунт
              </button>
            )}
          </div>
          {heroMovie && (
            <div className="kp-hero__now">
              <span className="kp-hero__now-label">Сейчас популярно:</span>
              <span className="kp-hero__now-title">{heroMovie.title}</span>
              {heroMovie.vote_average > 0 && (
                <span className="kp-hero__now-rating">⭐ {heroMovie.vote_average.toFixed(1)}</span>
              )}
            </div>
          )}
          {/* Hero dots */}
          <div className="kp-hero__dots">
            {heroMovies.map((_, i) => (
              <button
                key={i}
                className={`kp-hero__dot ${i === heroIndex ? 'kp-hero__dot--active' : ''}`}
                onClick={() => { setHeroIndex(i); setHeroMovie(heroMovies[i]) }}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Movie Rows */}
      <div className="kp-content">
        {popularMovies.length > 0 && (
          <MovieRow title="Популярные фильмы" movies={popularMovies} speed={0.5} onClick={handleMovieClick} />
        )}
        {nowPlaying.length > 0 && (
          <MovieRow title="Сейчас в кино" movies={nowPlaying} speed={0.4} reverse onClick={handleMovieClick} />
        )}
        {topRated.length > 0 && (
          <MovieRow title="Лучшие по оценкам" movies={topRated} speed={0.45} onClick={handleMovieClick} />
        )}

        {/* Features */}
        <section className="kp-features">
          <div className="kp-sectionIntro kp-sectionIntro--centered">
            <span className="kp-sectionIntro__eyebrow">Почему это удобно</span>
            <h2 className="kp-sectionIntro__title">Все важное для совместного просмотра в одном месте</h2>
            <p className="kp-sectionIntro__text">Быстрое создание комнаты, синхронный просмотр и живое общение без лишних шагов.</p>
          </div>
          <div className="kp-features__grid">
            {featureCards.map((feature, index) => (
              <div key={feature.title} className="kp-feature" style={{ animationDelay: `${0.08 * index}s` }}>
                <div className="kp-feature__glow" aria-hidden="true" />
                <div className="kp-feature__index">0{index + 1}</div>
                <div className="kp-feature__icon">{feature.icon}</div>
                <h3 className="kp-feature__title">{feature.title}</h3>
                <p className="kp-feature__text">{feature.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="kp-faq">
          <div className="kp-sectionIntro kp-sectionIntro--faq">
            <span className="kp-sectionIntro__eyebrow">FAQ</span>
            <h2 className="kp-faq__heading">Частые вопросы</h2>
            <p className="kp-sectionIntro__text">Коротко о том, как работает сервис и что ждать от совместного просмотра.</p>
          </div>
          <div className="kp-faq__list">
            {faqData.map((item, index) => (
              <div key={index} className={`kp-faq__item ${openFaq === index ? 'kp-faq__item--open' : ''}`} style={{ animationDelay: `${0.08 * index}s` }}>
                <button className="kp-faq__question" onClick={() => setOpenFaq(openFaq === index ? null : index)}>
                  <span>{item.question}</span>
                  <svg className="kp-faq__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div className="kp-faq__answer">{item.answer}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="kp-footer">
        <div className="kp-footer__inner">
          <div className="kp-footer__brand">
            <span className="kp-logo__star">✦</span> ВместеКино
          </div>
          <div className="kp-footer__links">
            <a href="#" onClick={e => { e.preventDefault(); handleWatchTogether() }}>Начать просмотр</a>
            <a href="#" onClick={e => { e.preventDefault(); navigate('/login') }}>Войти</a>
            <a href="#" onClick={e => { e.preventDefault(); setLegalTab('privacy') }}>Политика конфиденциальности</a>
            <a href="#" onClick={e => { e.preventDefault(); setLegalTab('terms') }}>Условия использования</a>
          </div>
          <div className="kp-footer__copy">© 2026 ВместеКино. Совместный просмотр фильмов.</div>
        </div>
      </footer>

      <UrlPasteModal
        isOpen={showUrlPasteModal}
        onClose={() => setShowUrlPasteModal(false)}
        onSubmit={({ url, mode, isPrivate }) => {
          const safeUrl = encodeURIComponent(url)
          const isAuthedUser = Boolean(user && !user.isGuest)
          if (mode === 'room' && isAuthedUser) {
            createRoom(isPrivate)
              .then(newRoomId => {
                if (newRoomId) {
                  navigate(`/room/${newRoomId}?autostartUrl=${safeUrl}`)
                } else {
                  navigate(`/room?autostartUrl=${safeUrl}&solo=1`)
                }
              })
              .catch(err => {
                console.error('createRoom failed', err)
                navigate(`/room?autostartUrl=${safeUrl}&solo=1`)
              })
          } else {
            navigate(`/room?autostartUrl=${safeUrl}&solo=1`)
          }
          setShowUrlPasteModal(false)
        }}
        guestMode={!user || user.isGuest}
      />

      <LegalModal isOpen={legalTab !== null} initialTab={legalTab ?? 'privacy'} onClose={() => setLegalTab(null)} />

      {user && !user.isGuest && (
        <>
          <FriendsPanel
            isOpen={showFriendsPanel}
            onClose={() => setShowFriendsPanel(false)}
            onOpenChat={(userId) => {
              setMessengerInitialUserId(userId)
              setShowMessengerPanel(true)
              setShowFriendsPanel(false)
            }}
            onOpenProfile={(userId, handle) => {
              setShowFriendsPanel(false)
              navigate(handle ? `/${handle}` : `/profile/${userId}`)
            }}
          />
          <MessengerPanel
            isOpen={showMessengerPanel}
            onClose={() => { setShowMessengerPanel(false); setMessengerInitialUserId(null) }}
            initialUserId={messengerInitialUserId}
            onOpenProfile={(userId, handle) => {
              setShowMessengerPanel(false)
              navigate(handle ? `/${handle}` : `/profile/${userId}`)
            }}
          />
        </>
      )}

    </div>
  )
}
