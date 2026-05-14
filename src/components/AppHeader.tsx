import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from '../contexts/AuthContext'
import { getPosterUrl, formatReleaseDate, type TMDBMovie } from '../services/tmdb'
import HeaderQuickActions, { type HeaderQuickActionsProps } from './HeaderQuickActions'

function MobileRoomsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  )
}

function MobileLibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" />
    </svg>
  )
}

function MobilePlayerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  )
}

function MobileHeartIcon({ active = false }: { active?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={active ? '#ef4444' : 'none'} stroke={active ? '#ef4444' : 'currentColor'} strokeWidth="2">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function MobileLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

interface InteractiveSearchProps {
  mode: 'interactive'
  value: string
  onChange: (value: string) => void
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  onFocus?: () => void
  results: TMDBMovie[]
  showResults: boolean
  searching: boolean
  onCloseResults: () => void
  onSelectResult: (movie: TMDBMovie) => void
  placeholder?: string
}

interface ReadonlySearchProps {
  mode: 'readonly'
  onClick: () => void
  placeholder?: string
}

type HeaderSearchProps = InteractiveSearchProps | ReadonlySearchProps

interface AppHeaderProps extends HeaderQuickActionsProps {
  search: HeaderSearchProps
  user: User | null
  onLoginClick: () => void
  onProfileClick: () => void
  onLogoutClick: () => void
}

export default function AppHeader({
  search,
  user,
  onLoginClick,
  onProfileClick,
  onLogoutClick,
  ...quickActions
}: AppHeaderProps) {
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const headerSearchRef = useRef<HTMLDivElement>(null)
  const avatarMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (
        search.mode === 'interactive' &&
        headerSearchRef.current &&
        !headerSearchRef.current.contains(event.target as Node)
      ) {
        search.onCloseResults()
      }

      if (
        avatarMenuRef.current &&
        !avatarMenuRef.current.contains(event.target as Node)
      ) {
        setShowUserMenu(false)
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [search])

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

  const closeMobileMenu = () => setShowMobileMenu(false)

  const handleMobileLoginClick = () => {
    closeMobileMenu()
    onLoginClick()
  }

  const handleMobileProfileClick = () => {
    closeMobileMenu()
    onProfileClick()
  }

  const handleMobileLogoutClick = () => {
    closeMobileMenu()
    onLogoutClick()
  }

  const handleMobileRoomsClick = () => {
    closeMobileMenu()
    quickActions.onRoomsClick?.()
  }

  const handleMobileLibraryClick = () => {
    closeMobileMenu()
    quickActions.onLibraryClick()
  }

  const handleMobilePlayerClick = () => {
    closeMobileMenu()
    quickActions.onPlayerClick()
  }

  const handleMobileFavoriteClick = () => {
    closeMobileMenu()
    quickActions.onFavoriteClick?.()
  }

  const handleMobileLinkClick = () => {
    closeMobileMenu()
    quickActions.onLinkClick()
  }

  const renderSearch = (inDrawer = false) => {
    const searchClassName = inDrawer ? 'room__search room__search--drawer' : 'room__search'
    const containerClassName = inDrawer ? 'room__searchContainer room__searchContainer--drawer' : 'room__searchContainer'

    return (
      <div className={containerClassName} ref={!inDrawer ? headerSearchRef : undefined}>
        {search.mode === 'interactive' ? (
          <>
            <form className={searchClassName} onSubmit={search.onSubmit}>
              <svg className="room__searchIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="room__searchInput"
                placeholder={search.placeholder || 'Фильмы, сериалы, актёры...'}
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                onFocus={search.onFocus}
              />
            </form>
            {search.showResults && (
              <div className={`room__searchDropdown${inDrawer ? ' room__searchDropdown--drawer' : ''}`}>
                {search.searching ? (
                  <div className="room__searchLoading">Поиск...</div>
                ) : (
                  search.results.map(movie => (
                    <div
                      key={movie.id}
                      className="room__searchResult"
                      onClick={() => {
                        search.onSelectResult(movie)
                        closeMobileMenu()
                      }}
                    >
                      <img
                        src={getPosterUrl(movie.poster_path, 'w185')}
                        alt={movie.title}
                        className="room__searchResultPoster"
                      />
                      <div className="room__searchResultInfo">
                        <span className="room__searchResultTitle">{movie.title}</span>
                        <span className="room__searchResultMeta">
                          {formatReleaseDate(movie.release_date)}
                          {movie.vote_average > 0 && (
                            <span className="room__searchResultRating">⭐ {movie.vote_average.toFixed(1)}</span>
                          )}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        ) : (
          <div className={searchClassName}>
            <svg className="room__searchIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="room__searchInput"
              placeholder={search.placeholder || 'Фильмы, сериалы, актёры...'}
              readOnly
              onClick={() => {
                search.onClick()
                closeMobileMenu()
              }}
              style={{ cursor: 'pointer' }}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <header className="room__header">
      <div className="room__mobileHeader">
        <button
          className="room__mobileMenuButton"
          onClick={() => setShowMobileMenu(true)}
          type="button"
          aria-label="Открыть меню"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
        <button className="room__mobileLogo" onClick={quickActions.onLogoClick} type="button">
          <span className="room__logoStar">✦</span>
          <span>ВместеКино</span>
        </button>
        {user && !user.isGuest ? (
          <button className="room__mobileAvatar" onClick={handleMobileProfileClick} type="button" aria-label="Профиль">
            {user.avatar ? <img src={user.avatar} alt={user.username} className="avatar__img" /> : (user.initials || '?')}
          </button>
        ) : (
          <button className="room__mobileLogin" onClick={handleMobileLoginClick} type="button">Войти</button>
        )}
      </div>

      {showMobileMenu && <div className="room__mobileDrawerBackdrop" onClick={closeMobileMenu} />}
      <aside className={`room__mobileDrawer${showMobileMenu ? ' room__mobileDrawer--open' : ''}`} aria-hidden={!showMobileMenu}>
        <div className="room__mobileDrawerHeader">
          <div className="room__mobileDrawerBrand">
            <span className="room__logoStar">✦</span>
            <span>ВместеКино</span>
          </div>
          <button className="room__mobileDrawerClose" onClick={closeMobileMenu} type="button" aria-label="Закрыть меню">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="room__mobileDrawerBody">
          {renderSearch(true)}

          <div className="room__mobileDrawerSection">
            {quickActions.showRoomsButton !== false && (
              <button
                className="room__mobileDrawerAction"
                onClick={handleMobileRoomsClick}
                type="button"
                disabled={!quickActions.onRoomsClick || quickActions.roomsLocked}
              >
                <MobileRoomsIcon />
                {quickActions.roomsTitle || 'Комнаты'}
              </button>
            )}
            <button className={`room__mobileDrawerAction${quickActions.libraryActive ? ' room__mobileDrawerAction--active' : ''}`} onClick={handleMobileLibraryClick} type="button">
              <MobileLibraryIcon />
              Библиотека
            </button>
            <button
              className={`room__mobileDrawerAction${quickActions.playerActive ? ' room__mobileDrawerAction--active' : ''}`}
              onClick={handleMobilePlayerClick}
              type="button"
              disabled={quickActions.playerDisabled}
            >
              <MobilePlayerIcon />
              {quickActions.playerTitle || 'Плеер'}
            </button>
            {quickActions.showFavoriteButton && (
              <button
                className={`room__mobileDrawerAction${quickActions.favoriteActive ? ' room__mobileDrawerAction--active' : ''}`}
                onClick={handleMobileFavoriteClick}
                type="button"
                disabled={quickActions.favoriteDisabled || !quickActions.onFavoriteClick || quickActions.favoriteLocked}
              >
                <MobileHeartIcon active={quickActions.favoriteActive} />
                {quickActions.favoriteTitle || 'Избранное'}
              </button>
            )}
            <button className="room__mobileDrawerAction" onClick={handleMobileLinkClick} type="button" disabled={quickActions.linkDisabled}>
              <MobileLinkIcon />
              {quickActions.linkTitle || 'Вставить ссылку'}
            </button>
          </div>

          <div className="room__mobileDrawerSection room__mobileDrawerSection--account">
            {user && !user.isGuest ? (
              <>
                <button className="room__mobileDrawerAction" onClick={handleMobileProfileClick} type="button">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M20 21a8 8 0 0 0-16 0" />
                  </svg>
                  Мой аккаунт
                </button>
                <button className="room__mobileDrawerAction room__mobileDrawerAction--danger" onClick={handleMobileLogoutClick} type="button">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Выйти
                </button>
              </>
            ) : (
              <button className="room__mobileDrawerAction room__mobileDrawerAction--primary" onClick={handleMobileLoginClick} type="button">
                Войти
              </button>
            )}
          </div>
        </div>
      </aside>

      <HeaderQuickActions {...quickActions} />

      <div className="room__headerRight">
        {renderSearch()}

        {user && !user.isGuest ? (
          <div className="avatar-wrapper" ref={avatarMenuRef}>
            <button className="avatar" onClick={() => setShowUserMenu(prev => !prev)} aria-label="Меню пользователя" type="button">
              {user.avatar ? <img src={user.avatar} alt={user.username} className="avatar__img" /> : (user.initials || '?')}
            </button>
            {showUserMenu && (
              <div className="avatar-menu">
                <button className="avatar-menu__item" onClick={() => { setShowUserMenu(false); onProfileClick() }} type="button">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M20 21a8 8 0 0 0-16 0" />
                  </svg>
                  Мой аккаунт
                </button>
                <button className="avatar-menu__item" onClick={() => { setShowUserMenu(false); onLogoutClick() }} type="button">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Выйти
                </button>
              </div>
            )}
          </div>
        ) : (
          <button className="kp-btn kp-btn--ghost" onClick={onLoginClick} type="button">Войти</button>
        )}
      </div>
    </header>
  )
}
