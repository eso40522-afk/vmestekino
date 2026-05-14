export interface HeaderQuickActionsProps {
  onLogoClick: () => void
  onRoomsClick?: () => void
  showRoomsButton?: boolean
  roomsOnline?: boolean
  roomsLocked?: boolean
  roomsTitle?: string
  onLibraryClick: () => void
  libraryActive?: boolean
  onPlayerClick: () => void
  playerActive?: boolean
  playerDisabled?: boolean
  playerTitle?: string
  showFavoriteButton?: boolean
  onFavoriteClick?: () => void
  favoriteActive?: boolean
  favoriteDisabled?: boolean
  favoriteLocked?: boolean
  favoriteTitle?: string
  onLinkClick: () => void
  linkDisabled?: boolean
  linkTitle?: string
}

function LogoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" />
    </svg>
  )
}

function PlayerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  )
}

function HeartIcon({ active = false }: { active?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={active ? '#ef4444' : 'none'} stroke={active ? '#ef4444' : 'currentColor'} strokeWidth="2">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function LockBadge({ size = 12, strokeWidth = 2.5 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function RoomsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  )
}

export default function HeaderQuickActions({
  onLogoClick,
  onRoomsClick,
  showRoomsButton = true,
  roomsOnline = true,
  roomsLocked = false,
  roomsTitle = 'Комнаты',
  onLibraryClick,
  libraryActive = false,
  onPlayerClick,
  playerActive = false,
  playerDisabled = false,
  playerTitle = 'Плеер',
  showFavoriteButton = true,
  onFavoriteClick,
  favoriteActive = false,
  favoriteDisabled = false,
  favoriteLocked = false,
  favoriteTitle = 'Избранное',
  onLinkClick,
  linkDisabled = false,
  linkTitle = 'Вставить ссылку'
}: HeaderQuickActionsProps) {
  return (
    <div className="room__headerLeft">
      <a href="#" className="room__logo" onClick={(event) => { event.preventDefault(); onLogoClick() }}>
        <span className="room__logoStar">✦</span>
        <span>ВместеКино</span>
      </a>

      {showRoomsButton && (
        <div
          className={`room__roomId${roomsLocked ? ' room__iconBtn--locked' : ''}${!roomsOnline && !roomsLocked ? ' room__roomId--inactive' : ''}`}
          onClick={() => !roomsLocked && onRoomsClick?.()}
          style={{ cursor: roomsLocked ? 'default' : 'pointer' }}
          title={roomsLocked ? 'Авторизуйтесь для доступа' : 'Все комнаты'}
        >
          <span className="room__roomIdIcon" aria-hidden="true">
            <RoomsIcon />
          </span>
          <span className="room__roomIdLabel">{roomsTitle}</span>
          {roomsOnline && <span className="room__connectionStatus room__connectionStatus--online" />}
          {roomsLocked && <span className="room__lockIcon"><LockBadge size={14} strokeWidth={2} /></span>}
        </div>
      )}

      <div className="room__headerActions">
        <button className={`room__iconBtn ${libraryActive ? 'active' : ''}`} title="Библиотека фильмов" onClick={onLibraryClick} type="button">
          <LogoIcon />
        </button>
        <button className={`room__iconBtn ${playerActive ? 'active' : ''}`} title={playerTitle} onClick={onPlayerClick} disabled={playerDisabled} type="button">
          <PlayerIcon />
        </button>
        {showFavoriteButton && (
          favoriteLocked ? (
            <button className="room__iconBtn room__iconBtn--locked" title={favoriteTitle} onClick={() => {}} type="button">
              <HeartIcon />
              <span className="room__lockIcon"><LockBadge /></span>
            </button>
          ) : (
            <button
              className={`room__iconBtn room__iconBtn--fav ${favoriteActive ? 'active' : ''}`}
              title={favoriteTitle}
              onClick={onFavoriteClick}
              disabled={favoriteDisabled}
              type="button"
            >
              <HeartIcon active={favoriteActive} />
            </button>
          )
        )}
        <button className="room__iconBtn" title={linkTitle} onClick={onLinkClick} disabled={linkDisabled} type="button">
          <LinkIcon />
        </button>
      </div>
    </div>
  )
}
