import { useRef, useEffect, useImperativeHandle, forwardRef, useState } from 'react'

declare namespace YT {
  interface OnStateChangeEvent {
    data: number
  }

  interface Player {
    playVideo: () => void
    pauseVideo: () => void
    seekTo: (time: number, allowSeekAhead?: boolean) => void
    getCurrentTime: () => number
    getDuration: () => number
    destroy: () => void
  }
}

interface YouTubePlayerProps {
  videoId: string
  onPlay?: () => void
  onPause?: () => void
  onSeek?: (time: number) => void
  onTimeUpdate?: (time: number) => void
  onReady?: () => void
}

export interface YouTubePlayerHandle {
  play: () => void
  pause: () => void
  seekTo: (time: number) => void
  getCurrentTime: () => number
  getDuration: () => number
  isPlaying: () => boolean
}

// Глобальное состояние для YouTube IFrame API
declare global {
  interface Window {
    YT: {
      Player: new (elementId: string, config: unknown) => YT.Player
      PlayerState: {
        PLAYING: number
        PAUSED: number
        ENDED: number
      }
    }
    onYouTubeIframeAPIReady: () => void
  }
}

let apiLoaded = false
let apiLoading = false
const apiCallbacks: (() => void)[] = []

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (apiLoaded) {
      resolve()
      return
    }

    apiCallbacks.push(resolve)

    if (apiLoading) {
      return
    }

    apiLoading = true

    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    const firstScriptTag = document.getElementsByTagName('script')[0]
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag)

    window.onYouTubeIframeAPIReady = () => {
      apiLoaded = true
      apiCallbacks.forEach(cb => cb())
      apiCallbacks.length = 0
    }
  })
}

// Извлечение ID видео из YouTube URL
export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/,
    /youtube\.com\/shorts\/([^&?/]+)/,
    /youtube\.com\/v\/([^&?/]+)/
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) {
      return match[1]
    }
  }

  return null
}

// Проверка, является ли URL YouTube ссылкой
export function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)/.test(url)
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(
  ({ videoId, onPlay, onPause, onSeek, onTimeUpdate, onReady }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const playerRef = useRef<YT.Player | null>(null)
    const [isReady, setIsReady] = useState(false)
    const [isPlayerPlaying, setIsPlayerPlaying] = useState(false)
    const timeUpdateIntervalRef = useRef<number | null>(null)

    useImperativeHandle(ref, () => ({
      play: () => {
        if (playerRef.current && isReady) {
          playerRef.current.playVideo()
        }
      },
      pause: () => {
        if (playerRef.current && isReady) {
          playerRef.current.pauseVideo()
        }
      },
      seekTo: (time: number) => {
        if (playerRef.current && isReady) {
          playerRef.current.seekTo(time, true)
          onSeek?.(time)
        }
      },
      getCurrentTime: () => {
        if (playerRef.current && isReady) {
          return playerRef.current.getCurrentTime()
        }
        return 0
      },
      getDuration: () => {
        if (playerRef.current && isReady) {
          return playerRef.current.getDuration()
        }
        return 0
      },
      isPlaying: () => isPlayerPlaying
    }))

    useEffect(() => {
      let mounted = true

      const initPlayer = async () => {
        await loadYouTubeAPI()

        if (!mounted || !containerRef.current) return

        // Создаём уникальный ID для контейнера
        const playerId = `youtube-player-${Date.now()}`
        containerRef.current.id = playerId

        playerRef.current = new window.YT.Player(playerId, {
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 1,
            modestbranding: 1,
            rel: 0,
            fs: 1,
            playsinline: 1
          },
          events: {
            onReady: () => {
              if (mounted) {
                setIsReady(true)
                onReady?.()
              }
            },
            onStateChange: (event: YT.OnStateChangeEvent) => {
              if (!mounted) return

              switch (event.data) {
                case window.YT.PlayerState.PLAYING:
                  setIsPlayerPlaying(true)
                  onPlay?.()
                  break
                case window.YT.PlayerState.PAUSED:
                  setIsPlayerPlaying(false)
                  onPause?.()
                  break
                case window.YT.PlayerState.ENDED:
                  setIsPlayerPlaying(false)
                  onPause?.()
                  break
              }
            }
          }
        })
      }

      initPlayer()

      return () => {
        mounted = false
        if (timeUpdateIntervalRef.current) {
          clearInterval(timeUpdateIntervalRef.current)
        }
        if (playerRef.current) {
          playerRef.current.destroy()
          playerRef.current = null
        }
      }
    }, [videoId])

    // Time update interval
    useEffect(() => {
      if (isReady && onTimeUpdate) {
        timeUpdateIntervalRef.current = window.setInterval(() => {
          if (playerRef.current && isPlayerPlaying) {
            const time = playerRef.current.getCurrentTime()
            onTimeUpdate(time)
          }
        }, 1000)

        return () => {
          if (timeUpdateIntervalRef.current) {
            clearInterval(timeUpdateIntervalRef.current)
          }
        }
      }
    }, [isReady, isPlayerPlaying, onTimeUpdate])

    return (
      <div className="youtube-player-wrapper">
        <div ref={containerRef} className="youtube-player-container" />
        {!isReady && (
          <div className="youtube-player-loading">
            <div className="youtube-player-spinner" />
            <p>Загрузка YouTube плеера...</p>
          </div>
        )}
      </div>
    )
  }
)

YouTubePlayer.displayName = 'YouTubePlayer'
