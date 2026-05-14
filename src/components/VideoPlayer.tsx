import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import './VideoPlayer.css'

interface VideoPlayerProps {
  src: string
  title?: string
  onEnded?: () => void
  onPlay?: (currentTime: number) => void
  onPause?: (currentTime: number) => void
  onSeek?: (currentTime: number) => void
}

export interface VideoPlayerRef {
  getCurrentTime: () => number
  seek: (time: number) => void
  play: () => void
  pause: () => void
}

export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(
  ({ src, title, onEnded, onPlay, onPause, onSeek }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [buffered, setBuffered] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showSettings, setShowSettings] = useState(false)

  const hideControlsTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)
  const isSeeking = useRef(false)

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    getCurrentTime: () => videoRef.current?.currentTime || 0,
    seek: (time: number) => {
      if (videoRef.current) {
        isSeeking.current = true
        videoRef.current.currentTime = time
        setTimeout(() => { isSeeking.current = false }, 100)
      }
    },
    play: () => videoRef.current?.play(),
    pause: () => videoRef.current?.pause()
  }))

  // Форматирование времени
  const formatTime = (time: number): string => {
    const hours = Math.floor(time / 3600)
    const minutes = Math.floor((time % 3600) / 60)
    const seconds = Math.floor(time % 60)

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // Play/Pause
  const togglePlay = useCallback(() => {
    if (!videoRef.current) return
    
    if (isPlaying) {
      videoRef.current.pause()
    } else {
      videoRef.current.play()
    }
  }, [isPlaying])

  // Volume
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    setVolume(value)
    if (videoRef.current) {
      videoRef.current.volume = value
      setIsMuted(value === 0)
    }
  }

  const toggleMute = () => {
    if (!videoRef.current) return
    
    if (isMuted) {
      videoRef.current.muted = false
      videoRef.current.volume = volume || 0.5
      setIsMuted(false)
      if (volume === 0) setVolume(0.5)
    } else {
      videoRef.current.muted = true
      setIsMuted(true)
    }
  }

  // Progress
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !videoRef.current) return
    
    const rect = progressRef.current.getBoundingClientRect()
    const pos = (e.clientX - rect.left) / rect.width
    videoRef.current.currentTime = pos * duration
  }

  // Fullscreen
  const toggleFullscreen = async () => {
    if (!containerRef.current) return

    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen()
      setIsFullscreen(true)
    } else {
      await document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  // Playback rate
  const changePlaybackRate = (rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate
      setPlaybackRate(rate)
    }
    setShowSettings(false)
  }

  // Skip forward/backward
  const skip = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime += seconds
    }
  }

  // Controls visibility
  const handleMouseMove = () => {
    setShowControls(true)
    clearTimeout(hideControlsTimeout.current)
    hideControlsTimeout.current = setTimeout(() => {
      if (isPlaying) setShowControls(false)
    }, 3000)
  }

  const handleMouseLeave = () => {
    if (isPlaying) {
      hideControlsTimeout.current = setTimeout(() => {
        setShowControls(false)
      }, 1000)
    }
  }

  // Event listeners
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handlePlay = () => {
      setIsPlaying(true)
      if (!isSeeking.current) {
        onPlay?.(video.currentTime)
      }
    }
    const handlePause = () => {
      setIsPlaying(false)
      if (!isSeeking.current) {
        onPause?.(video.currentTime)
      }
    }
    const handleTimeUpdate = () => setCurrentTime(video.currentTime)
    const handleDurationChange = () => setDuration(video.duration)
    const handleProgress = () => {
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1))
      }
    }
    const handleEnded = () => {
      setIsPlaying(false)
      onEnded?.()
    }
    const handleSeeked = () => {
      if (!isSeeking.current) {
        onSeek?.(video.currentTime)
      }
    }

    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('durationchange', handleDurationChange)
    video.addEventListener('progress', handleProgress)
    video.addEventListener('ended', handleEnded)
    video.addEventListener('seeked', handleSeeked)

    return () => {
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('durationchange', handleDurationChange)
      video.removeEventListener('progress', handleProgress)
      video.removeEventListener('ended', handleEnded)
      video.removeEventListener('seeked', handleSeeked)
    }
  }, [onEnded, onPlay, onPause, onSeek])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          skip(-10)
          break
        case 'ArrowRight':
          e.preventDefault()
          skip(10)
          break
        case 'ArrowUp':
          e.preventDefault()
          setVolume(v => Math.min(1, v + 0.1))
          if (videoRef.current) videoRef.current.volume = Math.min(1, volume + 0.1)
          break
        case 'ArrowDown':
          e.preventDefault()
          setVolume(v => Math.max(0, v - 0.1))
          if (videoRef.current) videoRef.current.volume = Math.max(0, volume - 0.1)
          break
        case 'm':
          e.preventDefault()
          toggleMute()
          break
        case 'f':
          e.preventDefault()
          toggleFullscreen()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePlay, volume])

  // Fullscreen change detection
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedProgress = duration > 0 ? (buffered / duration) * 100 : 0

  return (
    <div
      ref={containerRef}
      className={`video-player ${isFullscreen ? 'fullscreen' : ''} ${showControls ? 'show-controls' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <video
        ref={videoRef}
        src={src}
        className="video-player__video"
        onClick={togglePlay}
        playsInline
      />

      {/* Overlay при паузе */}
      {!isPlaying && (
        <div className="video-player__overlay" onClick={togglePlay}>
          <button className="video-player__big-play">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      )}

      {/* Название */}
      {title && showControls && (
        <div className="video-player__title">{title}</div>
      )}

      {/* Контролы */}
      <div className={`video-player__controls ${showControls ? 'visible' : ''}`}>
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="video-player__progress"
          onClick={handleProgressClick}
        >
          <div className="video-player__progress-buffered" style={{ width: `${bufferedProgress}%` }} />
          <div className="video-player__progress-played" style={{ width: `${progress}%` }} />
          <div className="video-player__progress-handle" style={{ left: `${progress}%` }} />
        </div>

        <div className="video-player__controls-row">
          {/* Left controls */}
          <div className="video-player__controls-left">
            <button className="video-player__btn" onClick={togglePlay} title={isPlaying ? 'Пауза' : 'Воспроизведение'}>
              {isPlaying ? (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <button className="video-player__btn" onClick={() => skip(-10)} title="Назад 10 сек">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" transform="scale(-1, 1) translate(-24, 0)" />
              </svg>
              <span className="video-player__btn-label">10</span>
            </button>

            <button className="video-player__btn" onClick={() => skip(10)} title="Вперёд 10 сек">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
              </svg>
              <span className="video-player__btn-label">10</span>
            </button>

            <div className="video-player__volume">
              <button className="video-player__btn" onClick={toggleMute} title={isMuted ? 'Включить звук' : 'Выключить звук'}>
                {isMuted || volume === 0 ? (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                  </svg>
                ) : volume < 0.5 ? (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="video-player__volume-slider"
              />
            </div>

            <span className="video-player__time">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Right controls */}
          <div className="video-player__controls-right">
            <div className="video-player__settings-wrapper">
              <button 
                className="video-player__btn" 
                onClick={() => setShowSettings(!showSettings)}
                title="Настройки"
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
                </svg>
              </button>

              {showSettings && (
                <div className="video-player__settings-menu">
                  <div className="video-player__settings-title">Скорость воспроизведения</div>
                  {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => (
                    <button
                      key={rate}
                      className={`video-player__settings-item ${playbackRate === rate ? 'active' : ''}`}
                      onClick={() => changePlaybackRate(rate)}
                    >
                      {rate === 1 ? 'Обычная' : `${rate}x`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button className="video-player__btn" onClick={toggleFullscreen} title="Полноэкранный режим">
              {isFullscreen ? (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})
