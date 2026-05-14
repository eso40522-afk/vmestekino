import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { VideoPlayer } from '../components/VideoPlayer'
import { TMDBLibrary, type SelectedMovieData } from '../components/TMDBLibrary'
import { YouTubePlayer, isYouTubeUrl, extractYouTubeId, type YouTubePlayerHandle } from '../components/YouTubePlayer'
import { EmbedPlayer } from '../components/EmbedPlayer'
import { RuTubePlayer, isRuTubeUrl, extractRuTubeId, type RuTubePlayerHandle } from '../components/RuTubePlayer'
import { VKVideoPlayer, isVKVideoUrl, buildVKVideoEmbedFromUrl } from '../components/VKVideoPlayer'
import { EmojiPicker } from '../components/EmojiPicker'
import '../components/EmojiPicker.css'
import { GifPicker } from '../components/GifPicker'
import '../components/GifPicker.css'
import { PollCreate } from '../components/PollCreate'
import AppHeader from '../components/AppHeader'
import '../components/PollCreate.css'
import '../components/YouTubePlayer.css'
import '../components/EmbedPlayer.css'
import '../components/RuTubePlayer.css'
import '../components/VKVideoPlayer.css'
import { API_URL } from '../config/api'
import { useAuth } from '../contexts/AuthContext'
import { useSocket, type ChatMessage, type MovieCardData } from '../contexts/SocketContext'
import { searchMovies, getMovieDetails, getMovieExternalIds, getPosterUrl, type TMDBMovie } from '../services/tmdb'
import { buildEmbedUrl } from '../services/alloha'
import './Room.css'

interface SelectedMovie extends SelectedMovieData {
  // Включает всё из SelectedMovieData
}

type TabType = 'chat' | 'settings'
type ViewType = 'player' | 'library'
type PlayerType = 'html5' | 'youtube' | 'embed' | 'rutube' | 'vkvideo'

interface MiniProfile {
  id: string
  username: string
  color: string
  avatar: string
  banner: string
  createdAt: string
  watchedCount: number
}

function getTimeoutDismissKey(userId: string | undefined, timeoutUntil: number | null) {
  if (!userId || !timeoutUntil) return null
  return `uniscreen_timeout_dismissed:${userId}:${timeoutUntil}`
}

export default function Room() {
  const navigate = useNavigate()
  const { roomId: urlRoomId } = useParams<{ roomId?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialMovieId = searchParams.get('movie') ? Number(searchParams.get('movie')) : null
  const forceLibrary = searchParams.get('view') === 'library'
  const autoStartMovieId = searchParams.get('autostartMovie') ? Number(searchParams.get('autostartMovie')) : null
  const autoStartUrl = searchParams.get('autostartUrl')
  const autoStartSolo = searchParams.get('solo') === '1'
  
  const { user, logout, loginAsGuest, login, register } = useAuth()
  const { 
    isConnected, 
    roomState, 
    typingUsers,
    moderationState,
    joinRoom, 
    leaveRoom,
    selectVideo,
    sendPlay,
    sendPause,
    sendSeek,
    sendMessage,
    setTyping,
    updateUsername,
    createRoom,
    kickUser,
    togglePrivacy,
    toggleSync,
    socket,
    syncStartState,
    userTimes,
    sendTimeUpdate,
    createPoll,
    votePoll,
    setRoomSolo,
    transferLeader
  } = useSocket()

  const [activeTab, setActiveTab] = useState<TabType>('chat')
  const [currentView, setCurrentView] = useState<ViewType>('library')
  const [currentFavView, setCurrentFavView] = useState(false)
  const [currentMovie, setCurrentMovie] = useState<SelectedMovie | null>(null)
  const [playerType, setPlayerType] = useState<PlayerType>('html5')
  const [customUrl, setCustomUrl] = useState('')
  const [showUrlModal, setShowUrlModal] = useState(false)
  const [urlModalClosing, setUrlModalClosing] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [urlWatchMode, setUrlWatchMode] = useState<'solo' | 'room'>('solo')
  const [urlRoomPrivate, setUrlRoomPrivate] = useState(false)
  const [message, setMessage] = useState('')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showSoloWarning, setShowSoloWarning] = useState(false)
  const [soloWarningClosing, setSoloWarningClosing] = useState(false)
  const [showSoloBlockedModal, setShowSoloBlockedModal] = useState(false)
  const [soloBlockedClosing, setSoloBlockedClosing] = useState(false)
  const [syncEnabled, setSyncEnabled] = useState(true)
  const [showAllUsers, setShowAllUsers] = useState(false)
  const [notificationsEnabled] = useState(true)
  const [displayName, setDisplayName] = useState('')
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authUsername, setAuthUsername] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authConfirmPassword, setAuthConfirmPassword] = useState('')
  const [authAgreeTerms, setAuthAgreeTerms] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [showChatTimeoutModal, setShowChatTimeoutModal] = useState(false)
  const [showBanModal, setShowBanModal] = useState(false)
  const [hideChatTimeoutModal, setHideChatTimeoutModal] = useState(false)
  const [nowTick, setNowTick] = useState(Date.now())

  // Emoji, GIF, Poll
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [showPollCreate, setShowPollCreate] = useState(false)
  const [closingEmojiPicker, setClosingEmojiPicker] = useState(false)
  const [closingGifPicker, setClosingGifPicker] = useState(false)
  const [closingPollCreate, setClosingPollCreate] = useState(false)

  const closeEmojiPicker = useCallback(() => {
    setClosingEmojiPicker(true)
    setTimeout(() => { setShowEmojiPicker(false); setClosingEmojiPicker(false) }, 250)
  }, [])
  const closeGifPicker = useCallback(() => {
    setClosingGifPicker(true)
    setTimeout(() => { setShowGifPicker(false); setClosingGifPicker(false) }, 250)
  }, [])
  const closePollCreate = useCallback(() => {
    setClosingPollCreate(true)
    setTimeout(() => { setShowPollCreate(false); setClosingPollCreate(false) }, 250)
  }, [])

  // Mini profile
  const [miniProfile, setMiniProfile] = useState<MiniProfile | null>(null)
  const [miniProfilePos, setMiniProfilePos] = useState({ x: 0, y: 0 })
  const [miniProfileLoading, setMiniProfileLoading] = useState(false)
  
  // Поиск фильмов
  const [searchResults, setSearchResults] = useState<TMDBMovie[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showSearchResults, setShowSearchResults] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)
  
  const chatRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<{ getCurrentTime: () => number; seek: (time: number) => void; play: () => void; pause: () => void } | null>(null)
  const youtubeRef = useRef<YouTubePlayerHandle | null>(null)
  const rutubeRef = useRef<RuTubePlayerHandle | null>(null)
  const isRemoteAction = useRef(false)
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)
  const lastInitKeyRef = useRef<string | null>(null)
  const autoStartKeyRef = useRef<string | null>(null)

  // Лидер комнаты
  const isLeader = socket?.id != null && roomState?.leaderId === socket.id
  const isChatTimedOut = Boolean(moderationState.timeoutUntil && moderationState.timeoutUntil > nowTick)
  const isChatBlocked = isChatTimedOut || moderationState.isBanned

  const formatRestrictionTime = (targetTime: number | null) => {
    if (!targetTime) return '0м 00с'
    const diff = Math.max(0, targetTime - nowTick)
    const totalSeconds = Math.ceil(diff / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}м ${seconds.toString().padStart(2, '0')}с`
  }

  // Слушаем переключение синхронизации от лидера
  useEffect(() => {
    const handler = (e: Event) => {
      const { syncEnabled: newSync } = (e as CustomEvent).detail
      setSyncEnabled(newSync)
    }
    window.addEventListener('sync-toggled', handler)
    return () => window.removeEventListener('sync-toggled', handler)
  }, [])

  // Поиск фильмов с debounce
  useEffect(() => {
    if (!customUrl.trim() || customUrl.startsWith('http')) {
      setSearchResults([])
      setShowSearchResults(false)
      return
    }

    clearTimeout(searchTimeout.current)
    setIsSearching(true)

    searchTimeout.current = setTimeout(async () => {
      try {
        const response = await searchMovies(customUrl, 1)
        setSearchResults(response.results.slice(0, 5))
        setShowSearchResults(response.results.length > 0)
      } catch (error) {
        console.error('Ошибка поиска:', error)
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 400)

    return () => clearTimeout(searchTimeout.current)
  }, [customUrl])

  const startCustomUrlPlayback = useCallback((url: string) => {
    const customMovie: SelectedMovie = {
      id: Date.now(),
      title: 'Видео по ссылке',
      original_title: 'Video from URL',
      overview: '',
      poster_path: null,
      backdrop_path: null,
      release_date: '',
      vote_average: 0,
      vote_count: 0,
      genre_ids: [],
      popularity: 0,
      adult: false,
      runtime: 0,
      genres: [],
      tagline: '',
      status: '',
      budget: 0,
      revenue: 0,
      production_companies: [],
      videoUrl: url
    }

    setCurrentMovie(customMovie)
    setCurrentView('player')

    if (isRuTubeUrl(url)) {
      setPlayerType('rutube')
    } else if (isVKVideoUrl(url)) {
      setPlayerType('vkvideo')
    } else {
      setPlayerType('html5')
    }

    selectVideo(url, null, 'Видео по ссылке')
  }, [selectVideo])

  const startTmdbMoviePlayback = useCallback(async (movieId: number, previewMovie?: TMDBMovie) => {
    try {
      const details = await getMovieDetails(movieId)
      const externalIds = await getMovieExternalIds(movieId)

      if (!externalIds.imdb_id) {
        return false
      }

      const embedUrl = buildEmbedUrl(externalIds.imdb_id)
      const selectedMovie: SelectedMovie = {
        ...details,
        videoUrl: embedUrl,
        kinopoiskId: null,
        imdbId: externalIds.imdb_id,
        useEmbed: true
      }

      setCurrentMovie(selectedMovie)
      setCurrentView('player')
      setPlayerType('embed')

      sendMessage(`MOVIE_SELECTED:${JSON.stringify({
        movieId,
        title: previewMovie?.title || details.title,
        posterPath: previewMovie?.poster_path || details.poster_path,
        year: previewMovie?.release_date?.split('-')[0] || details.release_date?.split('-')[0],
        imdbId: externalIds.imdb_id
      })}`)

      selectVideo(
        embedUrl,
        movieId.toString(),
        previewMovie?.title || details.title,
        externalIds.imdb_id,
        previewMovie?.poster_path || details.poster_path,
        previewMovie?.release_date?.split('-')[0] || details.release_date?.split('-')[0]
      )

      return true
    } catch (error) {
      console.error('Ошибка загрузки фильма:', error)
      return false
    }
  }, [selectVideo, sendMessage])

  // Выбор фильма из поиска
  const handleSearchResultClick = async (movie: TMDBMovie) => {
    setShowSearchResults(false)
    setCustomUrl('')
    await startTmdbMoviePlayback(movie.id, movie)
  }

  const clearAutoStartParams = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('autostartMovie')
    nextParams.delete('autostartUrl')
    nextParams.delete('solo')
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  // Автоматический вход как гость если не авторизован
  useEffect(() => {
    if (!user) {
      console.log('👤 Автоматический вход как гость')
      loginAsGuest()
    }
  }, [user, loginAsGuest])

  useEffect(() => {
    if (!isChatTimedOut) {
      setHideChatTimeoutModal(false)
      setShowChatTimeoutModal(false)
      return
    }

    const storageKey = getTimeoutDismissKey(user?.id, moderationState.timeoutUntil)
    const isDismissedForCurrentTimeout = storageKey ? localStorage.getItem(storageKey) === '1' : false

    setHideChatTimeoutModal(isDismissedForCurrentTimeout)
    setShowChatTimeoutModal(!isDismissedForCurrentTimeout)
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isChatTimedOut, moderationState.timeoutUntil, user?.id])

  useEffect(() => {
    if (moderationState.isBanned) {
      setShowBanModal(true)
    }
  }, [moderationState.isBanned])

  // Создаём или присоединяемся к комнате при загрузке
  useEffect(() => {
    const initRoom = async () => {
      console.log('🔄 Инициализация комнаты, urlRoomId:', urlRoomId)

      if (urlRoomId) {
        // Присоединяемся к существующей комнате
        console.log('🚪 Присоединяемся к комнате:', urlRoomId)
        joinRoom(urlRoomId)
      } else {
        // Создаём новую комнату
        console.log('🆕 Создаём новую комнату...')
        const newRoomId = await createRoom(true)
        console.log('✅ Комната создана:', newRoomId)
        const currentParams = searchParams.toString()
        navigate(`/room/${newRoomId}${currentParams ? `?${currentParams}` : ''}`, { replace: true })
        joinRoom(newRoomId)
      }
    }

    const initKey = `${isConnected ? '1' : '0'}:${user?.id || 'no-user'}:${urlRoomId || 'new-room'}`

    if (isConnected && user && lastInitKeyRef.current !== initKey) {
      lastInitKeyRef.current = initKey
      console.log('✅ Подключено к серверу, user:', user.username)
      initRoom()
    } else {
      console.log('⏳ Ожидание подключения... isConnected:', isConnected, 'user:', user?.username)
    }

    return () => {
      leaveRoom()
    }
  }, [isConnected, urlRoomId, user?.id])

  // Синхронизация видео
  useEffect(() => {
    if (!socket || !syncEnabled) return

    const handleVideoSync = ({ action, currentTime, isPlaying }: { 
      action: string
      currentTime: number
      isPlaying?: boolean 
    }) => {
      isRemoteAction.current = true

      switch (action) {
        case 'play':
          if (playerType === 'youtube') {
            youtubeRef.current?.seekTo(currentTime)
            youtubeRef.current?.play()
          } else if (playerType === 'rutube') {
            rutubeRef.current?.seekTo(currentTime)
            rutubeRef.current?.play()
          } else {
            videoRef.current?.seek(currentTime)
            videoRef.current?.play()
          }
          break
        case 'pause':
          if (playerType === 'youtube') {
            youtubeRef.current?.seekTo(currentTime)
            youtubeRef.current?.pause()
          } else if (playerType === 'rutube') {
            rutubeRef.current?.seekTo(currentTime)
            rutubeRef.current?.pause()
          } else {
            videoRef.current?.seek(currentTime)
            videoRef.current?.pause()
          }
          break
        case 'seek':
          if (playerType === 'youtube') {
            youtubeRef.current?.seekTo(currentTime)
          } else if (playerType === 'rutube') {
            rutubeRef.current?.seekTo(currentTime)
          } else {
            videoRef.current?.seek(currentTime)
          }
          break
        case 'sync':
          if (playerType === 'youtube') {
            youtubeRef.current?.seekTo(currentTime)
            if (isPlaying) {
              youtubeRef.current?.play()
            } else {
              youtubeRef.current?.pause()
            }
          } else if (playerType === 'rutube') {
            rutubeRef.current?.seekTo(currentTime)
            if (isPlaying) {
              rutubeRef.current?.play()
            } else {
              rutubeRef.current?.pause()
            }
          } else {
            videoRef.current?.seek(currentTime)
            if (isPlaying) {
              videoRef.current?.play()
            } else {
              videoRef.current?.pause()
            }
          }
          break
      }

      setTimeout(() => {
        isRemoteAction.current = false
      }, 100)
    }

    socket.on('video-sync', handleVideoSync)

    return () => {
      socket.off('video-sync', handleVideoSync)
    }
  }, [socket, syncEnabled, playerType])

  // Синхронизация видео из состояния комнаты (когда видео меняется)
  useEffect(() => {
    if (!roomState?.video?.url || !roomState.video.title) return
    
    // Проверяем, изменился ли фильм (по movieId или url)
    const videoChanged = !currentMovie || 
      currentMovie.id.toString() !== roomState.video.movieId ||
      currentMovie.videoUrl !== roomState.video.url
    
    if (!videoChanged) return
    
    console.log('📺 Синхронизация видео из комнаты:', roomState.video)
    
    // Создаём currentMovie из данных комнаты
    const syncedMovie = {
      id: parseInt(roomState.video.movieId || '0'),
      title: roomState.video.title,
      videoUrl: roomState.video.url,
      imdbId: roomState.video.imdbId || null,
      useEmbed: !!roomState.video.imdbId,
      poster_path: roomState.video.posterPath || null,
      overview: '',
      release_date: roomState.video.year ? `${roomState.video.year}-01-01` : '',
      vote_average: 0,
      genres: [],
      runtime: 0,
      adult: false,
      backdrop_path: null,
      genre_ids: [],
      original_title: '',
      popularity: 0,
      video: false,
      vote_count: 0,
      tagline: '',
      status: '',
      budget: 0,
      revenue: 0,
      production_companies: []
    } as SelectedMovie
    
    setCurrentMovie(syncedMovie)
    
    // Определяем тип плеера
    if (roomState.video.imdbId) {
      setPlayerType('embed')
    } else if (isYouTubeUrl(roomState.video.url)) {
      setPlayerType('youtube')
    } else if (isRuTubeUrl(roomState.video.url)) {
      setPlayerType('rutube')
    } else if (isVKVideoUrl(roomState.video.url)) {
      setPlayerType('vkvideo')
    } else {
      setPlayerType('html5')
    }
    
    if (!forceLibrary) {
      setCurrentView('player')
    }
  }, [roomState?.video?.movieId, roomState?.video?.url])

  useEffect(() => {
    if (!roomState?.roomId) return
    if (!autoStartMovieId && !autoStartUrl) return

    const autoStartKey = `${roomState.roomId}:${autoStartMovieId || autoStartUrl}:${autoStartSolo ? 'solo' : 'room'}`
    if (autoStartKeyRef.current === autoStartKey) return
    autoStartKeyRef.current = autoStartKey

    let cancelled = false

    const runAutoStart = async () => {
      if (autoStartSolo) {
        setRoomSolo(true)
      }

      if (autoStartMovieId) {
        await startTmdbMoviePlayback(autoStartMovieId)
      } else if (autoStartUrl) {
        startCustomUrlPlayback(autoStartUrl)
      }

      if (!cancelled) {
        clearAutoStartParams()
      }
    }

    runAutoStart()

    return () => {
      cancelled = true
    }
  }, [roomState?.roomId, autoStartMovieId, autoStartUrl, autoStartSolo, setRoomSolo, startTmdbMoviePlayback, startCustomUrlPlayback, clearAutoStartParams])

  // Автопрокрутка чата + уведомление о новом сообщении
  const prevMessageCountRef = useRef(0)
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }

    // Звук уведомления при новом сообщении
    const currentCount = roomState?.messages?.length || 0
    if (notificationsEnabled && currentCount > prevMessageCountRef.current && prevMessageCountRef.current > 0) {
      const lastMsg = roomState?.messages?.[currentCount - 1]
      // Не уведомлять о своих сообщениях
      if (lastMsg && lastMsg.userId !== user?.id) {
        // Уведомление звуком
        try {
          const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
          const oscillator = audioCtx.createOscillator()
          const gainNode = audioCtx.createGain()
          oscillator.connect(gainNode)
          gainNode.connect(audioCtx.destination)
          oscillator.frequency.value = 800
          oscillator.type = 'sine'
          gainNode.gain.value = 0.15
          oscillator.start()
          gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3)
          oscillator.stop(audioCtx.currentTime + 0.3)
        } catch {
          // AudioContext может быть заблокирован
        }

        // Браузерное уведомление если вкладка не в фокусе
        if (document.hidden && Notification.permission === 'granted' && lastMsg.username) {
          new Notification('ВместеКино — Новое сообщение', {
            body: `${lastMsg.username}: ${lastMsg.text?.substring(0, 100)}`,
            icon: '/favicon.ico'
          })
        } else if (document.hidden && Notification.permission === 'default') {
          Notification.requestPermission()
        }
      }
    }
    prevMessageCountRef.current = currentCount
  }, [roomState?.messages, notificationsEnabled, user?.id])

  // Обработчики видео
  const handleVideoPlay = useCallback((currentTime: number) => {
    if (isRemoteAction.current || !syncEnabled) return
    sendPlay(currentTime)
  }, [sendPlay, syncEnabled])

  const handleVideoPause = useCallback((currentTime: number) => {
    if (isRemoteAction.current || !syncEnabled) return
    sendPause(currentTime)
  }, [sendPause, syncEnabled])

  const handleVideoSeek = useCallback((currentTime: number) => {
    if (isRemoteAction.current || !syncEnabled) return
    sendSeek(currentTime)
  }, [sendSeek, syncEnabled])

  // YouTube события
  const handleYouTubePlay = useCallback(() => {
    if (isRemoteAction.current || !syncEnabled || !youtubeRef.current) return
    const time = youtubeRef.current.getCurrentTime()
    sendPlay(time)
  }, [sendPlay, syncEnabled])

  const handleYouTubePause = useCallback(() => {
    if (isRemoteAction.current || !syncEnabled || !youtubeRef.current) return
    const time = youtubeRef.current.getCurrentTime()
    sendPause(time)
  }, [sendPause, syncEnabled])

  const handleYouTubeSeek = useCallback((time: number) => {
    if (isRemoteAction.current || !syncEnabled) return
    sendSeek(time)
  }, [sendSeek, syncEnabled])

  // RuTube события
  const handleRuTubePlay = useCallback(() => {
    if (isRemoteAction.current || !syncEnabled || !rutubeRef.current) return
    const time = rutubeRef.current.getCurrentTime()
    sendPlay(time)
  }, [sendPlay, syncEnabled])

  const handleRuTubePause = useCallback(() => {
    if (isRemoteAction.current || !syncEnabled || !rutubeRef.current) return
    const time = rutubeRef.current.getCurrentTime()
    sendPause(time)
  }, [sendPause, syncEnabled])

  // Периодическая отправка текущего времени плеера для отображения таймеров
  const timeReportIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined)
  useEffect(() => {
    if (!currentView || currentView !== 'player' || !currentMovie) {
      return
    }

    timeReportIntervalRef.current = setInterval(() => {
      let time = 0
      if (playerType === 'youtube' && youtubeRef.current) {
        time = youtubeRef.current.getCurrentTime()
      } else if (playerType === 'rutube' && rutubeRef.current) {
        time = rutubeRef.current.getCurrentTime()
      } else if (videoRef.current) {
        time = videoRef.current.getCurrentTime()
      }
      sendTimeUpdate(time)
    }, 1000)

    return () => {
      if (timeReportIntervalRef.current) {
        clearInterval(timeReportIntervalRef.current)
      }
    }
  }, [currentView, currentMovie, playerType, sendTimeUpdate])

  // Форматирование времени для таймера плеера
  const formatPlayerTime = useCallback((seconds: number): string => {
    const s = Math.floor(seconds)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
    }
    return `${m}:${sec.toString().padStart(2, '0')}`
  }, [])

  // Выбор фильма из TMDB
  const handleSelectMovie = (movie: SelectedMovieData) => {
    const videoUrl = movie.videoUrl || ''
    
    if (!videoUrl) {
      return
    }

    const selectedMovie: SelectedMovie = {
      ...movie,
      videoUrl
    }
    
    setCurrentMovie(selectedMovie)
    setCurrentView('player')
    
    // Определяем тип плеера
    if (movie.useEmbed && movie.imdbId) {
      setPlayerType('embed')
    } else if (isYouTubeUrl(videoUrl)) {
      setPlayerType('youtube')
    } else if (isRuTubeUrl(videoUrl)) {
      setPlayerType('rutube')
    } else if (isVKVideoUrl(videoUrl)) {
      setPlayerType('vkvideo')
    } else {
      setPlayerType('html5')
    }
    
    // Отправляем сообщение о выборе фильма
    sendMessage(`MOVIE_SELECTED:${JSON.stringify({
      movieId: movie.id,
      title: movie.title,
      posterPath: movie.poster_path,
      year: movie.release_date?.split('-')[0],
      imdbId: movie.imdbId
    })}`)
    
    selectVideo(videoUrl, movie.id.toString(), movie.title, movie.imdbId, movie.poster_path, movie.release_date?.split('-')[0])
  }

  // Модальное окно для ввода URL
  const handleOpenUrlModal = () => {
    setShowUrlModal(true)
    setUrlModalClosing(false)
    setUrlInput('')
    setUrlWatchMode('solo')
    setUrlRoomPrivate(false)
  }

  const handleCloseUrlModal = () => {
    setUrlModalClosing(true)
    setTimeout(() => {
      setShowUrlModal(false)
      setUrlModalClosing(false)
    }, 250)
  }

  const handleSubmitUrlModal = async () => {
    if (urlInput.trim()) {
      if (urlWatchMode === 'room') {
        const newRoomId = await createRoom(urlRoomPrivate)
        navigate(`/room/${newRoomId}`, { replace: true })
        joinRoom(newRoomId)
      } else {
        setRoomSolo(true)
      }

      startCustomUrlPlayback(urlInput)
      handleCloseUrlModal()
    }
  }

  // Поиск/URL
  const handleSubmitUrl = (e: React.FormEvent) => {
    e.preventDefault()
    if (customUrl.trim()) {
      if (customUrl.startsWith('http')) {
        startCustomUrlPlayback(customUrl)
      }
      setCustomUrl('')
    }
  }

  // Отправка сообщения
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (isChatBlocked) return
    if (message.trim()) {
      console.log('📤 Отправка сообщения:', message, 'roomState:', roomState?.roomId)
      sendMessage(message.slice(0, 200))
      setMessage('')
      setTyping(false)
      if (showEmojiPicker) closeEmojiPicker()
      if (showGifPicker) closeGifPicker()
    }
  }

  // Отправка GIF в чат
  const handleSendGif = async (gifUrl: string) => {
    if (isChatBlocked) return
    let urlToSend = gifUrl
    const token = localStorage.getItem('uniscreen_token')

    // Если это base64, сначала загружаем на сервер и получаем URL файла
    if (gifUrl.startsWith('data:')) {
      try {
        const res = await fetch(`${API_URL}/gifs/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionToken: token, gifUrl })
        })
        const data = await res.json()
        if (data.url) urlToSend = data.url
      } catch (err) {
        console.error('Failed to upload GIF:', err)
      }
    }

    sendMessage(`GIF:${urlToSend}`)
    closeGifPicker()
    // Сохранить в последние
    if (token) {
      fetch(`${API_URL}/gifs/recent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: token, gifUrl: urlToSend })
      }).catch(() => {})
    }
  }

  // Выбор эмодзи
  const handleEmojiSelect = (emoji: string) => {
    const newMsg = (message + emoji).slice(0, 200)
    setMessage(newMsg)
  }

  // Создание опроса
  const handleCreatePoll = (question: string, options: string[], multiSelect: boolean) => {
    if (isChatBlocked) return
    createPoll(question, options, multiSelect)
    closePollCreate()
  }

  // Печатает...
  const handleMessageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isChatBlocked) return
    const val = e.target.value.slice(0, 200)
    setMessage(val)
    
    if (e.target.value) {
      setTyping(true)
      clearTimeout(typingTimeout.current)
      typingTimeout.current = setTimeout(() => {
        setTyping(false)
      }, 2000)
    } else {
      setTyping(false)
    }
  }

  // Копирование ссылки
  const handleCopyLink = () => {
    if (roomState?.solo) {
      setShowSoloWarning(true)
      setSoloWarningClosing(false)
      return
    }
    navigator.clipboard.writeText(`${window.location.origin}/room/${roomState?.roomId || urlRoomId}`)
    setShowInviteModal(true)
    setTimeout(() => setShowInviteModal(false), 2000)
  }

  const handleCloseSoloWarning = () => {
    setSoloWarningClosing(true)
    setTimeout(() => { setShowSoloWarning(false); setSoloWarningClosing(false) }, 250)
  }

  const handleCloseSoloBlocked = () => {
    setSoloBlockedClosing(true)
    setTimeout(() => { setShowSoloBlockedModal(false); setSoloBlockedClosing(false) }, 250)
  }

  const handleCloseChatTimeoutModal = () => {
    setShowChatTimeoutModal(false)
  }

  const handleChatTimeoutModalVisibilityChange = (shouldShow: boolean) => {
    const storageKey = getTimeoutDismissKey(user?.id, moderationState.timeoutUntil)
    if (storageKey) {
      if (shouldShow) {
        localStorage.removeItem(storageKey)
      } else {
        localStorage.setItem(storageKey, '1')
      }
    }
    setHideChatTimeoutModal(!shouldShow)
  }

  const handleCloseBanModal = () => {
    setShowBanModal(false)
    logout()
    navigate('/')
  }

  // Сброс формы авторизации при смене таба
  useEffect(() => {
    setAuthUsername('')
    setAuthPassword('')
    setAuthConfirmPassword('')
    setAuthAgreeTerms(false)
    setAuthError('')
    setAuthSubmitting(false)
  }, [showAuthModal, authMode])

  // Авторизация
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')

    if (!authUsername || !authPassword) {
      setAuthError('Заполните все поля')
      return
    }

    if (authMode === 'register') {
      if (authPassword !== authConfirmPassword) {
        setAuthError('Пароли не совпадают')
        return
      }
      if (!authAgreeTerms) {
        setAuthError('Примите условия использования')
        return
      }
    }

    setAuthSubmitting(true)
    try {
      if (authMode === 'login') {
        await login(authUsername, authPassword)
      } else {
        await register(authUsername, authPassword)
      }
      setShowAuthModal(false)
      
      // Присоединяемся заново с новым пользователем
      if (urlRoomId) {
        joinRoom(urlRoomId)
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Произошла ошибка')
    } finally {
      setAuthSubmitting(false)
    }
  }

  // Форматирование времени сообщения
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('ru-RU', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  // Открытие мини профиля при клике на ник
  const handleOpenMiniProfile = async (userId: string | undefined, e: React.MouseEvent) => {
    if (!userId) return
    e.stopPropagation()

    const rect = (e.target as HTMLElement).getBoundingClientRect()
    const popupHeight = 280 // примерная высота мини-профиля
    const spaceBelow = window.innerHeight - rect.bottom
    const yPos = spaceBelow < popupHeight + 16
      ? Math.max(8, rect.top - popupHeight - 8) // показываем сверху
      : rect.bottom + 8                          // показываем снизу
    setMiniProfilePos({ x: rect.left, y: yPos })
    setMiniProfileLoading(true)
    setMiniProfile(null)

    try {
      const res = await fetch(`${API_URL}/profile/${userId}`)
      if (res.ok) {
        const data = await res.json()
        const p = data.profile
        setMiniProfile({
          id: p.id,
          username: p.username,
          color: p.color,
          avatar: p.avatar || '',
          banner: p.banner || '',
          createdAt: p.createdAt,
          watchedCount: (p.watchedMovies || []).length
        })
      }
    } catch {
      // ignore
    } finally {
      setMiniProfileLoading(false)
    }
  }

  // Закрытие мини профиля
  const handleCloseMiniProfile = () => {
    setMiniProfile(null)
    setMiniProfileLoading(false)
  }

  return (
    <div className="room">
      {/* Header */}
      <AppHeader
          onLogoClick={() => navigate('/')}
          showRoomsButton={Boolean(roomState)}
          onRoomsClick={() => navigate('/rooms')}
          roomsOnline={isConnected}
          roomsLocked={Boolean(user?.isGuest)}
          onLibraryClick={() => { setCurrentView('library'); setCurrentFavView(false) }}
          libraryActive={currentView === 'library' && !currentFavView}
          onPlayerClick={() => { setCurrentView('player'); setCurrentFavView(false) }}
          playerActive={currentView === 'player'}
          playerDisabled={!currentMovie}
          onFavoriteClick={() => {
            if (currentView === 'library' && currentFavView) {
              setCurrentFavView(false)
            } else {
              setCurrentView('library')
              setCurrentFavView(true)
            }
          }}
          favoriteActive={currentView === 'library' && currentFavView}
          favoriteLocked={Boolean(!user || user.isGuest)}
          favoriteTitle={user && !user.isGuest ? 'Избранное' : 'Авторизуйтесь для доступа к избранному'}
          onLinkClick={handleOpenUrlModal}
          search={{
            mode: 'interactive',
            value: customUrl,
            onChange: setCustomUrl,
            onSubmit: handleSubmitUrl,
            onFocus: () => searchResults.length > 0 && setShowSearchResults(true),
            results: searchResults,
            showResults: showSearchResults,
            searching: isSearching,
            onCloseResults: () => setShowSearchResults(false),
            onSelectResult: handleSearchResultClick,
            placeholder: 'Фильмы, сериалы, актёры...'
          }}
          user={user}
          onLoginClick={() => navigate('/login')}
          onProfileClick={() => navigate('/profile')}
          onLogoutClick={logout}
        />

      {/* Sync Start Overlay */}
      {syncStartState.countdown !== null && syncStartState.countdown > 0 && (
        <div className="room__syncOverlay">
          <div className="room__syncCountdown">
            <span className="room__syncNumber">{syncStartState.countdown}</span>
            <span className="room__syncText">Приготовьтесь!</span>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="room__body">
        {/* Video Player or Library */}
        <div className="room__player">
          {currentView === 'library' ? (
            <TMDBLibrary onSelectMovie={handleSelectMovie} showFavorites={currentFavView} initialMovieId={initialMovieId} onClearInitialMovie={() => setSearchParams({}, { replace: true })} onCreateRoom={async (isPrivate: boolean) => {
              const newRoomId = await createRoom(isPrivate)
              navigate(`/room/${newRoomId}`, { replace: true })
              joinRoom(newRoomId)
            }} />
          ) : currentMovie ? (
            <div className="room__videoWrapper">
              {/* Если есть imdbId - используем EmbedPlayer */}
              {currentMovie.imdbId ? (
                <EmbedPlayer
                  key={currentMovie.imdbId}
                  imdbId={currentMovie.imdbId}
                  title={currentMovie.title}
                />
              ) : playerType === 'youtube' && extractYouTubeId(currentMovie.videoUrl) ? (
                <YouTubePlayer
                  ref={youtubeRef}
                  videoId={extractYouTubeId(currentMovie.videoUrl)!}
                  onPlay={handleYouTubePlay}
                  onPause={handleYouTubePause}
                  onSeek={handleYouTubeSeek}
                />
              ) : playerType === 'rutube' && extractRuTubeId(currentMovie.videoUrl) ? (
                <RuTubePlayer
                  ref={rutubeRef}
                  videoId={extractRuTubeId(currentMovie.videoUrl)!}
                  onPlay={handleRuTubePlay}
                  onPause={handleRuTubePause}
                />
              ) : playerType === 'vkvideo' && buildVKVideoEmbedFromUrl(currentMovie.videoUrl) ? (
                <VKVideoPlayer
                  embedUrl={buildVKVideoEmbedFromUrl(currentMovie.videoUrl)!}
                />
              ) : (
                <VideoPlayer 
                  ref={videoRef}
                  src={currentMovie.videoUrl}
                  title={currentMovie.title}
                  onPlay={handleVideoPlay}
                  onPause={handleVideoPause}
                  onSeek={handleVideoSeek}
                />
              )}
            </div>
          ) : (
            <div className="room__noVideo">
              <div className="room__noVideoIcon">🎬</div>
              <h3>Выберите фильм для просмотра</h3>
              <p>Перейдите в библиотеку фильмов или вставьте ссылку на видео</p>
              <div className="room__noVideoActions">
                <button 
                  className="room__goToLibrary"
                  onClick={() => setCurrentView('library')}
                >
                  Открыть библиотеку
                </button>
                <button 
                  className="room__goToLibrary room__goToLibrary--secondary"
                  onClick={handleOpenUrlModal}
                >
                  Вставить ссылку
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar - только на странице плеера */}
        {currentView === 'player' && (
        <aside className={`room__sidebar${user?.isGuest ? ' room__sidebar--guest' : ''}`}>
          {user?.isGuest && (
            <div className="room__sidebarLock">
              <div className="room__sidebarLockIcon">
                <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
              <p className="room__sidebarLockText">Чтобы использовать полноценный функционал сайта, зарегистрируйтесь или авторизуйтесь</p>
              <button className="room__sidebarLockBtn" onClick={() => navigate('/login')}>Войти</button>
            </div>
          )}
          {/* Users */}
          <div className="room__users">
            <button className="room__addUser" title="Пригласить" onClick={handleCopyLink}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <line x1="19" y1="8" x2="19" y2="14"/>
                <line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
            </button>
            {(() => {
              const users = roomState?.users || []
              const visibleUsers = showAllUsers ? users : users.slice(0, 3)
              const hiddenCount = users.length - 3
              return (
                <>
                  {visibleUsers.map(u => (
                    <div 
                      key={u.id} 
                      className="room__avatarWrapper"
                      title={u.username}
                    >
                      <div
                        className="room__avatar"
                        style={{ background: u.avatar ? 'transparent' : u.color }}
                      >
                        {u.avatar ? (
                          <img src={u.avatar} alt={u.username} className="room__sidebarAvatarImg" />
                        ) : (
                          u.initials
                        )}
                      </div>
                      {u.socketId === roomState?.leaderId && (
                        <div className="room__avatarLeaderBadge" aria-label="Лидер комнаты" title="Лидер комнаты">
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M2.5 19h19v2h-19zM22.5 7l-5 5-5-7-5 7-5-5 2.5 12h15z"/>
                          </svg>
                        </div>
                      )}
                      {currentMovie && playerType !== 'embed' && userTimes[u.id] !== undefined && (
                        <div className="room__avatarTimer">
                          {formatPlayerTime(userTimes[u.id])}
                        </div>
                      )}
                    </div>
                  ))}
                  {hiddenCount > 0 && !showAllUsers && (
                    <button 
                      className="room__avatarMore"
                      onClick={() => setShowAllUsers(true)}
                      title={`Ещё ${hiddenCount} участник(ов)`}
                    >
                      +{hiddenCount}
                    </button>
                  )}
                  {showAllUsers && users.length > 3 && (
                    <button 
                      className="room__avatarMore room__avatarMore--collapse"
                      onClick={() => setShowAllUsers(false)}
                      title="Свернуть"
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6"/>
                      </svg>
                    </button>
                  )}
                </>
              )
            })()}
          </div>

          {/* Tabs */}
          <div className="room__tabs">
            <div className={`room__tabPill room__tabPill--${activeTab}`} />
            <button
              className={`room__tab ${activeTab === 'chat' ? 'room__tab--active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              Чат
            </button>
            <button
              className={`room__tab ${activeTab === 'settings' ? 'room__tab--active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              Настройки
            </button>
          </div>

          {/* Tab content */}
          <div className="room__tabContent">
            {activeTab === 'chat' ? (
              <div className={`room__chatPanel ${isChatBlocked ? 'room__chatPanel--blocked' : ''}`}>
                {/* Chat messages */}
                <div className="room__chatMessages" ref={chatRef}>
                  {/* Показываем карточку текущего фильма из roomState.video если есть */}
                  {roomState?.video?.posterPath && roomState?.video?.title && !roomState?.messages?.some(m => m.text.startsWith('MOVIE_SELECTED:')) && (
                    <div className="room__message room__message--movie">
                      <div 
                        className="room__messageAvatar" 
                        style={{ background: '#6366f1' }}
                      >
                        {roomState.video.selectedBy?.slice(0, 2).toUpperCase() || '??'}
                      </div>
                      <div className="room__messageContent">
                        <div className="room__messageHeader">
                          <span className="room__messageAuthor">{roomState.video.selectedBy || 'Участник'}</span>
                        </div>
                        <div className="room__messageText room__messageText--action">
                          РЕШИЛ ПОСМОТРЕТЬ
                        </div>
                        <div className="room__movieCard">
                          <img 
                            src={roomState.video.posterPath ? getPosterUrl(roomState.video.posterPath, 'w342') : 'https://via.placeholder.com/200x300?text=No+Poster'} 
                            alt={roomState.video.title}
                            className="room__movieCardPoster"
                          />
                          <div className="room__movieCardInfo">
                            <span className="room__movieCardTitle">{roomState.video.title}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {(!roomState?.messages || roomState.messages.length === 0) && !roomState?.video?.posterPath ? (
                    <div className="room__chatEmpty">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                      </svg>
                      <span>Сообщений пока нет</span>
                      <span className="room__chatEmptyHint">Выберите фильм или напишите сообщение</span>
                    </div>
                  ) : (
                    roomState?.messages.map((msg: ChatMessage) => {
                      // Проверяем, является ли сообщение карточкой фильма
                      const isMovieMessage = msg.text.startsWith('MOVIE_SELECTED:')
                      let movieData: MovieCardData | null = null
                      
                      if (isMovieMessage) {
                        try {
                          movieData = JSON.parse(msg.text.replace('MOVIE_SELECTED:', ''))
                        } catch {
                          movieData = null
                        }
                      }
                      
                      if (msg.type === 'system') {
                        return (
                          <div key={msg.id} className="room__systemMessage">
                            {msg.text}
                          </div>
                        )
                      }

                      // Опрос
                      if (msg.type === 'poll' && msg.poll) {
                        const poll = msg.poll
                        const totalVotes = poll.options.reduce((sum, o) => sum + o.votes.length, 0)
                        const hasVoted = poll.options.some(o => o.votes.includes(user?.id || ''))
                        return (
                          <div key={msg.id} className="room__message room__message--poll">
                            <div 
                              className="room__messageAvatar" 
                              style={{ background: msg.avatar ? 'transparent' : msg.color }}
                            >
                              {msg.avatar ? (
                                <img src={msg.avatar} alt={msg.username} className="room__messageAvatarImg" />
                              ) : (
                                msg.initials
                              )}
                            </div>
                            <div className="room__messageContent">
                              <div className="room__messageHeader">
                                <span className="room__messageAuthor room__messageAuthor--clickable" onClick={(e) => handleOpenMiniProfile(msg.userId, e)}>{msg.username}</span>
                                <span className="room__messageTime">{formatTime(msg.timestamp)}</span>
                              </div>
                              <div className="room__poll">
                                <div className="room__pollQuestion">📊 {poll.question}</div>
                                <div className="room__pollOptions">
                                  {poll.options.map(opt => {
                                    const pct = totalVotes > 0 ? Math.round((opt.votes.length / totalVotes) * 100) : 0
                                    const isMyVote = opt.votes.includes(user?.id || '')
                                    return (
                                      <button
                                        key={opt.id}
                                        className={`room__pollOption ${isMyVote ? 'room__pollOption--voted' : ''}`}
                                        onClick={() => votePoll(poll.id, opt.id)}
                                      >
                                        <div className="room__pollOptionBar" style={{ width: `${pct}%` }} />
                                        <span className="room__pollOptionText">{opt.text}</span>
                                        <span className="room__pollOptionPct">{hasVoted ? `${pct}%` : ''}</span>
                                      </button>
                                    )
                                  })}
                                </div>
                                <div className="room__pollFooter">
                                  {poll.totalVoters} {poll.totalVoters === 1 ? 'голос' : poll.totalVoters < 5 ? 'голоса' : 'голосов'}
                                  {poll.multiSelect && ' · Несколько ответов'}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      }
                      
                      if (isMovieMessage && movieData) {
                        return (
                          <div key={msg.id} className="room__message room__message--movie">
                            <div 
                              className="room__messageAvatar" 
                              style={{ background: msg.avatar ? 'transparent' : msg.color }}
                            >
                              {msg.avatar ? (
                                <img src={msg.avatar} alt={msg.username} className="room__messageAvatarImg" />
                              ) : (
                                msg.initials
                              )}
                            </div>
                            <div className="room__messageContent">
                              <div className="room__messageHeader">
                                <span className="room__messageAuthor room__messageAuthor--clickable" onClick={(e) => handleOpenMiniProfile(msg.userId, e)}>{msg.username}</span>
                                <span className="room__messageTime">{formatTime(msg.timestamp)}</span>
                              </div>
                              <div className="room__messageText room__messageText--action">
                                РЕШИЛ ПОСМОТРЕТЬ
                              </div>
                              <div className="room__movieCard">
                                <img 
                                  src={movieData.posterPath ? getPosterUrl(movieData.posterPath, 'w342') : 'https://via.placeholder.com/200x300?text=No+Poster'} 
                                  alt={movieData.title}
                                  className="room__movieCardPoster"
                                />
                                <div className="room__movieCardInfo">
                                  <span className="room__movieCardTitle">{movieData.title}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      }
                      
                      return (
                        <div key={msg.id} className="room__message">
                          <div 
                            className="room__messageAvatar" 
                            style={{ background: msg.avatar ? 'transparent' : msg.color }}
                          >
                            {msg.avatar ? (
                              <img src={msg.avatar} alt={msg.username} className="room__messageAvatarImg" />
                            ) : (
                              msg.initials
                            )}
                          </div>
                          <div className="room__messageContent">
                            <div className="room__messageHeader">
                              <span className="room__messageAuthor room__messageAuthor--clickable" onClick={(e) => handleOpenMiniProfile(msg.userId, e)}>{msg.username}</span>
                              <span className="room__messageTime">{formatTime(msg.timestamp)}</span>
                            </div>
                            <div className="room__messageText">
                              {msg.text.startsWith('GIF:') ? (
                                <img src={msg.text.slice(4)} alt="GIF" className="room__chatGif" loading="lazy" />
                              ) : (
                                msg.text
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Typing indicator */}
                {typingUsers.length > 0 && (
                  <div className="room__typing">
                    {typingUsers.join(', ')} {typingUsers.length === 1 ? 'печатает' : 'печатают'}...
                  </div>
                )}

                {/* Chat input */}
                <form className="room__chatForm" onSubmit={handleSendMessage}>
                  <div className="room__chatInputWrap">
                    <input
                      type="text"
                      className="room__chatInput"
                      placeholder={isChatTimedOut ? 'Чат временно недоступен' : moderationState.isBanned ? 'Аккаунт заблокирован' : 'Введите сообщение...'}
                      value={message}
                      onChange={handleMessageChange}
                      maxLength={200}
                      disabled={isChatBlocked}
                    />
                    {message.length > 150 && (
                      <span className="room__chatCharCount">{message.length}/200</span>
                    )}
                  </div>
                  <div className="room__chatActions">
                    <div className="room__chatIcons">
                      <button 
                        type="button" 
                        className={`room__chatBtn ${showEmojiPicker ? 'room__chatBtn--active' : ''}`} 
                        title="Смайлики"
                        disabled={isChatBlocked}
                        onClick={() => { 
                          if (showEmojiPicker) { closeEmojiPicker() } 
                          else { setShowEmojiPicker(true); if (showGifPicker) closeGifPicker(); if (showPollCreate) closePollCreate() }
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"/>
                          <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                          <line x1="9" y1="9" x2="9.01" y2="9"/>
                          <line x1="15" y1="9" x2="15.01" y2="9"/>
                        </svg>
                      </button>
                      <button 
                        type="button" 
                        className={`room__chatBtn ${showGifPicker ? 'room__chatBtn--active' : ''}`} 
                        title="GIF"
                        disabled={isChatBlocked}
                        onClick={() => { 
                          if (showGifPicker) { closeGifPicker() } 
                          else { setShowGifPicker(true); if (showEmojiPicker) closeEmojiPicker(); if (showPollCreate) closePollCreate() }
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="2" y="4" width="20" height="16" rx="2"/>
                          <text x="12" y="15" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor" stroke="none">GIF</text>
                        </svg>
                      </button>
                      <button 
                        type="button" 
                        className={`room__chatBtn ${showPollCreate ? 'room__chatBtn--active' : ''}`} 
                        title="Создать опрос"
                        disabled={isChatBlocked}
                        onClick={() => { 
                          if (showPollCreate) { closePollCreate() } 
                          else { setShowPollCreate(true); if (showGifPicker) closeGifPicker(); if (showEmojiPicker) closeEmojiPicker() }
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 6h16M4 12h10M4 18h14"/>
                          <rect x="18" y="9" width="3" height="12" rx="1" fill="currentColor" stroke="none" opacity="0.4"/>
                        </svg>
                      </button>
                    </div>
                    <button type="submit" className="room__sendBtn" disabled={!message.trim() || isChatBlocked}>
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                      </svg>
                      Отправить
                    </button>
                  </div>
                  {showEmojiPicker && (
                    <div className={`emojiPicker__wrapper ${closingEmojiPicker ? 'emojiPicker__wrapper--exit' : 'emojiPicker__wrapper--enter'}`}>
                      <EmojiPicker 
                        onSelect={handleEmojiSelect} 
                        onClose={closeEmojiPicker} 
                      />
                    </div>
                  )}
                  {showGifPicker && (
                    <div className={`gifPicker__wrapper ${closingGifPicker ? 'gifPicker__wrapper--exit' : ''}`}>
                      <GifPicker
                        onSelect={handleSendGif}
                        onClose={closeGifPicker}
                        sessionToken={user && 'token' in user ? null : localStorage.getItem('uniscreen_token')}
                      />
                    </div>
                  )}
                  {showPollCreate && (
                    <div className={`pollCreate__wrapper ${closingPollCreate ? 'pollCreate__wrapper--exit' : ''}`}>
                      <PollCreate
                        onSubmit={handleCreatePoll}
                        onClose={closePollCreate}
                      />
                    </div>
                  )}
                </form>
                {isChatTimedOut && (
                  <div className="room__chatBlockedOverlay">
                    <div className="room__chatBlockedIcon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </div>
                    <div className="room__chatBlockedTitle">Доступ к чату временно ограничен</div>
                    <div className="room__chatBlockedText">Вы сможете снова писать через {formatRestrictionTime(moderationState.timeoutUntil)}</div>
                  </div>
                )}
                {moderationState.isBanned && (
                  <div className="room__chatBlockedOverlay room__chatBlockedOverlay--banned">
                    <div className="room__chatBlockedIcon room__chatBlockedIcon--banned" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </div>
                    <div className="room__chatBlockedTitle">Аккаунт заблокирован</div>
                    <div className="room__chatBlockedText">Чат недоступен для этого аккаунта</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="room__settings">
                {/* Локальные настройки */}
                <div className="room__settingsSection">
                  <h3 className="room__settingsSectionTitle">ЛОКАЛЬНЫЕ НАСТРОЙКИ</h3>
                  
                  <div className="room__settingCard">
                    <div className="room__settingCardHeader">
                      <svg className="room__settingIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                      </svg>
                      <span>Имя пользователя</span>
                    </div>
                    <p className="room__settingHint">Данное имя будет отображаться в чате</p>
                    <input 
                      type="text"
                      className="room__settingInput"
                      placeholder={user?.username || 'Гость'}
                      value={displayName}
                      maxLength={20}
                      onChange={(e) => setDisplayName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && displayName.trim()) {
                          updateUsername(displayName.trim())
                          ;(e.target as HTMLInputElement).blur()
                        }
                      }}
                    />
                    <p className="room__settingHintSmall">Нажмите Enter для подтверждения</p>
                  </div>
                </div>

                {/* Настройки сессии */}
                <div className="room__settingsSection">
                  <h3 className="room__settingsSectionTitle">НАСТРОЙКИ СЕССИИ</h3>

                  {/* Solo / Together toggle */}
                  <div className="room__settingCard">
                    <div className="room__settingCardHeader">
                      <svg className="room__settingIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                      </svg>
                      <span>Режим просмотра</span>
                    </div>
                    <div className={`room__soloToggle${!isLeader ? ' room__soloToggle--disabled' : ''}`}>
                      <div className={`room__soloTogglePill room__soloTogglePill--${roomState?.solo ? 'solo' : 'together'}`} />
                      <button
                        className={`room__soloToggleTab ${roomState?.solo ? 'room__soloToggleTab--active' : ''}`}
                        onClick={() => {
                          if (!isLeader) return
                          if (!roomState?.solo) {
                            if ((roomState?.users.length || 0) > 1) {
                              setShowSoloBlockedModal(true)
                              setSoloBlockedClosing(false)
                            } else {
                              setRoomSolo(true)
                            }
                          }
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                          <circle cx="12" cy="7" r="4"/>
                        </svg>
                        В одиночку
                      </button>
                      <button
                        className={`room__soloToggleTab ${!roomState?.solo ? 'room__soloToggleTab--active' : ''}`}
                        onClick={() => { if (isLeader && roomState?.solo) setRoomSolo(false) }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                          <circle cx="9" cy="7" r="4"/>
                          <line x1="19" y1="8" x2="19" y2="14"/>
                          <line x1="22" y1="11" x2="16" y2="11"/>
                        </svg>
                        Смотреть вместе
                      </button>
                    </div>
                    <p className="room__settingHint" style={{ marginTop: 8 }}>
                      {roomState?.solo 
                        ? 'Вы смотрите в одиночку. Комната скрыта из списка' 
                        : 'Комната отображается в списке комнат'}
                      {!isLeader && ' (управляет лидер)'}
                    </p>
                  </div>

                  {/* Sync & Privacy — locked when solo */}
                  <div className={`room__settingSoloGroup${roomState?.solo ? ' room__settingSoloGroup--locked' : ''}`}>
                    {roomState?.solo && (
                      <div className="room__settingSoloLock">
                        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="11" width="18" height="11" rx="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                      </div>
                    )}

                  <div className="room__settingCard room__settingCard--row">
                    <div className="room__settingCardLeft">
                      <div className="room__settingCardHeader">
                        <svg className="room__settingIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                        </svg>
                        <span>Синхронизация</span>
                      </div>
                      <p className="room__settingHint">
                        {syncEnabled ? 'Включена' : 'Выключена'}
                        {!isLeader && ' (управляет лидер)'}
                      </p>
                    </div>
                    <label className={`room__switch${!isLeader || roomState?.solo ? ' room__switch--disabled' : ''}`}>
                      <input 
                        type="checkbox"
                        checked={syncEnabled}
                        disabled={!isLeader || !!roomState?.solo}
                        onChange={(e) => {
                          setSyncEnabled(e.target.checked)
                          toggleSync(e.target.checked)
                        }}
                      />
                      <span className="room__switchSlider"></span>
                    </label>
                  </div>
                  <p className="room__settingNote">
                    Когда включено, видео синхронизируется у всех участников комнаты
                  </p>

                  <div className="room__settingCard room__settingCard--row">
                    <div className="room__settingCardLeft">
                      <div className="room__settingCardHeader">
                        <svg className="room__settingIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        <span>Приватная комната</span>
                      </div>
                      <p className="room__settingHint">
                        {roomState?.isPrivate ? 'Комната скрыта в списке' : 'Комната видна всем'}
                        {!isLeader && ' (управляет лидер)'}
                      </p>
                    </div>
                    <label className={`room__switch${!isLeader || roomState?.solo ? ' room__switch--disabled' : ''}`}>
                      <input 
                        type="checkbox"
                        checked={roomState?.isPrivate || false}
                        disabled={!isLeader || !!roomState?.solo}
                        onChange={(e) => togglePrivacy(e.target.checked)}
                      />
                      <span className="room__switchSlider"></span>
                    </label>
                  </div>
                  <p className="room__settingNote">
                    Приватная комната будет заблюрена в списке комнат
                  </p>
                  <div className="room__settingCard">
                    <div className="room__settingCardHeader">
                      <svg className="room__settingIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                      </svg>
                      <span>Ссылка на комнату</span>
                    </div>
                    <div className="room__copyLinkWrap">
                      <div className="room__copyLink">
                        <input
                          type="text"
                          readOnly
                          value={`${window.location.origin}/room/${roomState?.roomId || urlRoomId}`}
                          className="room__linkInput"
                        />
                        <button type="button" className="room__copyBtn" onClick={handleCopyLink}>
                          Копировать
                        </button>
                      </div>
                    </div>
                    {roomState?.solo && (
                      <p className="room__settingNote">
                        В режиме «В одиночку» ссылка заблокирована для других участников.
                      </p>
                    )}
                  </div>
                  </div>

                  <div className="room__settingCard">
                    <div className="room__settingCardHeader">
                      <svg className="room__settingIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                      </svg>
                      <span>Участники ({roomState?.users.length || 0})</span>
                    </div>
                    <div className="room__userList">
                      {roomState?.users.map(u => (
                        <div key={u.id} className="room__userItem">
                          <div className="room__avatar room__avatar--small" style={{ background: u.avatar ? 'transparent' : u.color }}>
                            {u.avatar ? (
                              <img src={u.avatar} alt={u.username} className="room__sidebarAvatarImg" />
                            ) : (
                              u.initials
                            )}
                          </div>
                          {u.socketId === roomState?.leaderId && (
                            <svg className="room__crownIcon" viewBox="0 0 24 24" fill="#f59e0b" width="16" height="16">
                              <path d="M2.5 19h19v2h-19zM22.5 7l-5 5-5-7-5 7-5-5 2.5 12h15z"/>
                            </svg>
                          )}
                          <span className="room__userName">{u.username}</span>
                          {u.isGuest && <span className="room__guestBadge">Гость</span>}
                          {isLeader && u.socketId !== socket?.id && (
                            <button
                              className="room__transferBtn"
                              title="Передать лидерство"
                              onClick={() => u.socketId && transferLeader(u.socketId)}
                            >
                              Сделать лидером
                            </button>
                          )}
                          {isLeader && u.socketId !== socket?.id && (
                            <button
                              className="room__kickBtn"
                              title="Выгнать"
                              onClick={() => u.socketId && kickUser(u.socketId)}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
      </div>

      {showChatTimeoutModal && isChatTimedOut && (
        <div className="room__restrictionModal" onClick={handleCloseChatTimeoutModal}>
          <div className="room__restrictionCard" onClick={event => event.stopPropagation()}>
            <button className="room__restrictionClose" onClick={handleCloseChatTimeoutModal} aria-label="Закрыть">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <div className="room__restrictionIcon room__restrictionIcon--timeout">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 3" />
              </svg>
            </div>
            <h3 className="room__restrictionTitle">Доступ временно ограничен</h3>
            <p className="room__restrictionText">
              Вы получили временное ограничение за нарушение правил нашего сайта. В течение указанного времени вы не сможете отправлять сообщения в чат.
            </p>
            <div className="room__restrictionTimerBox">
              <span>Осталось:</span>
              <strong>{formatRestrictionTime(moderationState.timeoutUntil)}</strong>
            </div>
            <div className="room__restrictionPreference">
              <div className="room__restrictionPreferenceText">
                <span className="room__restrictionPreferenceLabel">Показывать это уведомление</span>
                <span className="room__restrictionPreferenceHint">Отключается только для текущего ограничения</span>
              </div>
              <label className="room__switch room__restrictionSwitch">
                <input
                  type="checkbox"
                  checked={!hideChatTimeoutModal}
                  onChange={(event) => handleChatTimeoutModalVisibilityChange(event.target.checked)}
                />
                <span className="room__switchSlider"></span>
              </label>
            </div>
            <div className="room__restrictionActions">
              <button className="room__restrictionAction room__restrictionAction--primary" onClick={handleCloseChatTimeoutModal}>
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}

      {showBanModal && moderationState.isBanned && (
        <div className="room__restrictionModal" onClick={handleCloseBanModal}>
          <div className="room__restrictionCard room__restrictionCard--ban" onClick={event => event.stopPropagation()}>
            <div className="room__restrictionIcon room__restrictionIcon--ban">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 3" />
              </svg>
            </div>
            <h3 className="room__restrictionTitle room__restrictionTitle--ban">Доступ заблокирован</h3>
            <p className="room__restrictionText">
              Вы получили перманентную блокировку в связи с неоднократными нарушениями правил нашего сайта. Ваш аккаунт забанен. Если вы считаете, что это ошибка, свяжитесь с тех поддержкой по адресу tpkino2026@gmail.com.
            </p>
            <button className="room__restrictionLogout" onClick={handleCloseBanModal}>
              Закрыть
            </button>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {showInviteModal && (
        <div className="room__toast">
          ✓ Ссылка скопирована в буфер обмена!
        </div>
      )}

      {/* Solo warning modal */}
      {showSoloWarning && (
        <div className={`room__modal${soloWarningClosing ? ' room__modal--closing' : ''}`} onClick={handleCloseSoloWarning}>
          <div className={`room__soloWarningModal${soloWarningClosing ? ' room__soloWarningModal--closing' : ''}`} onClick={e => e.stopPropagation()}>
            <div className="room__soloWarningIcon">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#f59e0b" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <h3 className="room__soloWarningTitle">Режим «В одиночку»</h3>
            <p className="room__soloWarningText">
              В данный момент у вас выбран режим просмотра в одиночку. 
              Чтобы пригласить других пользователей, переключитесь на режим 
              «Смотреть вместе» в настройках комнаты.
            </p>
            <div className="room__soloWarningActions">
              <button className="room__soloWarningBtn room__soloWarningBtn--secondary" onClick={handleCloseSoloWarning}>
                Понятно
              </button>
              <button className="room__soloWarningBtn room__soloWarningBtn--primary" onClick={() => {
                setRoomSolo(false)
                handleCloseSoloWarning()
                setActiveTab('settings')
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <line x1="19" y1="8" x2="19" y2="14"/>
                  <line x1="22" y1="11" x2="16" y2="11"/>
                </svg>
                Смотреть вместе
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Solo blocked modal (can't go solo with >1 user) */}
      {showSoloBlockedModal && (
        <div className={`room__modal${soloBlockedClosing ? ' room__modal--closing' : ''}`} onClick={handleCloseSoloBlocked}>
          <div className={`room__soloWarningModal${soloBlockedClosing ? ' room__soloWarningModal--closing' : ''}`} onClick={e => e.stopPropagation()}>
            <div className="room__soloWarningIcon">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#f59e0b" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <h3 className="room__soloWarningTitle">Невозможно переключить</h3>
            <p className="room__soloWarningText">
              Для одиночного просмотра исключите всех пользователей из комнаты 
              либо пересоздайте комнату для одиночного просмотра.
            </p>
            <div className="room__soloWarningActions">
              <button className="room__soloWarningBtn room__soloWarningBtn--secondary" onClick={handleCloseSoloBlocked}>
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auth modal */}
      {showAuthModal && (
        <div className="modal" onClick={() => setShowAuthModal(false)}>
          <div className="modal__panel" onClick={e => e.stopPropagation()}>
            <div className="modal__tabs">
              <button
                className={`modal__tab ${authMode === 'login' ? 'modal__tab--active' : ''}`}
                onClick={() => setAuthMode('login')}
              >
                Вход
              </button>
              <button
                className={`modal__tab ${authMode === 'register' ? 'modal__tab--active' : ''}`}
                onClick={() => setAuthMode('register')}
              >
                Регистрация
              </button>
            </div>

            {authError && (
              <div className="modal__error">{authError}</div>
            )}

            <form className="modal__form" onSubmit={handleAuth}>
              <div className="input-group">
                <span className="input-group__icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2"/>
                    <path d="M22 7L13.03 12.7c-.63.39-1.43.39-2.06 0L2 7"/>
                  </svg>
                </span>
                <input
                  type="email"
                  className="input-group__field"
                  placeholder="Email"
                  value={authUsername}
                  onChange={e => setAuthUsername(e.target.value)}
                  autoComplete="email"
                />
              </div>

              <div className="input-group">
                <span className="input-group__icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </span>
                <input
                  type="password"
                  className="input-group__field"
                  placeholder="Пароль"
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                />
              </div>

              {authMode === 'register' && (
                <div className="input-group">
                  <span className="input-group__icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </span>
                  <input
                    type="password"
                    className="input-group__field"
                    placeholder="Повторите пароль"
                    value={authConfirmPassword}
                    onChange={e => setAuthConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              )}

              {authMode === 'login' && (
                <a href="#" className="modal__forgot">Забыли пароль?</a>
              )}

              {authMode === 'register' && (
                <label className="modal__terms">
                  <input
                    type="checkbox"
                    checked={authAgreeTerms}
                    onChange={e => setAuthAgreeTerms(e.target.checked)}
                    className="modal__terms-checkbox"
                  />
                  <span className="modal__terms-text">
                    Я прочитал(а) и согласен(на) с условиями{' '}
                    <a href="#" className="modal__terms-link">Политики конфиденциальности</a> и{' '}
                    <a href="#" className="modal__terms-link">Пользовательского соглашения</a>
                  </span>
                </label>
              )}

              <button
                type="submit"
                className="modal__submit"
                disabled={authSubmitting}
              >
                {authSubmitting
                  ? 'Подождите...'
                  : authMode === 'login'
                    ? 'Войти'
                    : 'Создать аккаунт'
                }
              </button>
            </form>
          </div>
        </div>
      )}

      {/* URL Modal */}
      {showUrlModal && (
        <div className={`room__modal ${urlModalClosing ? 'room__modal--closing' : ''}`} onClick={handleCloseUrlModal}>
          <div className={`room__modalContent room__modalContent--url ${urlModalClosing ? 'room__modalContent--closing' : ''}`} onClick={e => e.stopPropagation()}>
            
            <h2 className="room__urlModalTitle">🔗 Вставьте ссылку на видео</h2>
            <p className="room__urlModalHint">
              Поддерживаются: RuTube, VK Video, прямые ссылки на .mp4 и другие видеоформаты
            </p>
            
            <input
              type="text"
              className="room__urlModalInput"
              placeholder="https://rutube.ru/video/... или ссылка на VK Video / .mp4"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              autoFocus
            />

            <div className="room__urlModalExamples">
              <p>Примеры:</p>
              <ul>
                <li>RuTube: https://rutube.ru/video/abc123def456/</li>
                <li>VK Video: https://vkvideo.ru/video-123456_789012</li>
                <li>Прямая ссылка: https://example.com/video.mp4</li>
              </ul>
            </div>

            {/* Toggle solo/room */}
            <div className="room__urlModalToggle">
              <div className={`room__urlModalPill room__urlModalPill--${urlWatchMode}`} />
              <button
                className={`room__urlModalTab ${urlWatchMode === 'solo' ? 'room__urlModalTab--active' : ''}`}
                onClick={() => setUrlWatchMode('solo')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
                В одиночку
              </button>
              <button
                className={`room__urlModalTab ${urlWatchMode === 'room' ? 'room__urlModalTab--active' : ''}${!user || user.isGuest ? ' room__urlModalTab--locked' : ''}`}
                onClick={() => { if (user && !user.isGuest) setUrlWatchMode('room') }}
              >
                {(!user || user.isGuest) && (
                  <svg className="room__urlModalTabLock" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )}
                <span className="room__urlModalTabContent">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <line x1="19" y1="8" x2="19" y2="14"/>
                    <line x1="22" y1="11" x2="16" y2="11"/>
                  </svg>
                  Создать комнату
                </span>
              </button>
            </div>

            {urlWatchMode === 'room' && user && !user.isGuest && (
              <div className="room__urlModalPrivacy">
                <div className="room__urlModalPrivacyInfo">
                  <span className="room__urlModalPrivacyLabel">Приватная комната</span>
                  <span className="room__urlModalPrivacyDesc">
                    {urlRoomPrivate
                      ? 'Комната будет скрыта в списке'
                      : 'Комната видна всем пользователям'}
                  </span>
                </div>
                <button
                  className={`room__urlModalSwitch${urlRoomPrivate ? ' room__urlModalSwitch--active' : ''}`}
                  onClick={() => setUrlRoomPrivate(!urlRoomPrivate)}
                  type="button"
                >
                  <span className="room__urlModalSwitchThumb" />
                </button>
              </div>
            )}

            <div className="room__urlModalHintRow">
              {urlWatchMode === 'solo' || !user || user.isGuest ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  <span>Видео начнёт воспроизводиться в текущей комнате</span>
                </>
              ) : (
                <>
                  {urlRoomPrivate ? (
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
                  <span>{urlRoomPrivate ? 'Информация о видео и участниках будет скрыта' : 'Все пользователи могут видеть и присоединяться'}</span>
                </>
              )}
            </div>
            
            <div className="room__urlModalActions">
              <button 
                className="room__urlModalCancel"
                onClick={handleCloseUrlModal}
              >
                Отмена
              </button>
              {urlWatchMode === 'solo' || !user || user.isGuest ? (
                <button 
                  className="room__urlModalSubmit"
                  onClick={handleSubmitUrlModal}
                  disabled={!urlInput.trim()}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  Смотреть
                </button>
              ) : (
                <button 
                  className="room__urlModalSubmit"
                  onClick={handleSubmitUrlModal}
                  disabled={!urlInput.trim()}
                >
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

      {/* Mini Profile Popup */}
      {(miniProfile || miniProfileLoading) && (
        <div className="room__miniProfileOverlay" onClick={handleCloseMiniProfile}>
          <div 
            className="room__miniProfile"
            style={{
              left: Math.min(miniProfilePos.x, window.innerWidth - 320),
              top: Math.max(8, Math.min(miniProfilePos.y, window.innerHeight - 290))
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {miniProfileLoading ? (
              <div className="room__miniProfileLoading">
                <div className="room__miniProfileSpinner" />
              </div>
            ) : miniProfile && (
              <>
                <div className="room__miniProfileBanner" style={{ background: miniProfile.banner ? 'none' : (miniProfile.color || '#6366f1') }}>
                  {miniProfile.banner && <img src={miniProfile.banner} alt="" className="room__miniProfileBannerImg" />}
                </div>
                <div className="room__miniProfileBody">
                  <div className="room__miniProfileAvatarWrap">
                    {miniProfile.avatar ? (
                      <img src={miniProfile.avatar} alt={miniProfile.username} className="room__miniProfileAvatarImg" />
                    ) : (
                      <div className="room__miniProfileAvatarFallback" style={{ background: miniProfile.color }}>
                        {miniProfile.username.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="room__miniProfileName">{miniProfile.username}</div>
                  <div className="room__miniProfileDivider" />
                  <div className="room__miniProfileInfo">
                    <div className="room__miniProfileInfoRow">
                      <span className="room__miniProfileInfoLabel">Зарегистрирован</span>
                      <span className="room__miniProfileInfoValue">
                        {miniProfile.createdAt ? new Date(miniProfile.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Неизвестно'}
                      </span>
                    </div>
                    <div className="room__miniProfileInfoRow">
                      <span className="room__miniProfileInfoLabel">Просмотрено фильмов</span>
                      <span className="room__miniProfileInfoValue">{miniProfile.watchedCount}</span>
                    </div>
                  </div>
                  <button className="room__miniProfileBtn" onClick={() => { handleCloseMiniProfile(); navigate(`/profile/${miniProfile.id}`); }}>
                    Перейти в профиль
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
