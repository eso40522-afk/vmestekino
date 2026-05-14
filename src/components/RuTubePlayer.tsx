import { forwardRef, useImperativeHandle, useState, useRef, useEffect, useCallback } from 'react'
import './RuTubePlayer.css'

interface RuTubePlayerProps {
  videoId: string
  onPlay?: () => void
  onPause?: () => void
  onSeek?: (time: number) => void
  onReady?: () => void
}

export interface RuTubePlayerHandle {
  play: () => void
  pause: () => void
  seekTo: (time: number) => void
  getCurrentTime: () => number
  getDuration: () => number
  isPlaying: () => boolean
  reload: () => void
}

// Извлечение ID видео из RuTube URL
export function extractRuTubeId(url: string): string | null {
  const patterns = [
    /rutube\.ru\/video\/([a-f0-9]+)\/?/i,
    /rutube\.ru\/play\/embed\/([a-f0-9]+)/i,
    /rutube\.ru\/shorts\/([a-f0-9]+)\/?/i
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) {
      return match[1]
    }
  }

  return null
}

// Проверка, является ли URL ссылкой на RuTube
export function isRuTubeUrl(url: string): boolean {
  return /rutube\.ru/.test(url)
}

// Получение embed URL для RuTube
export function getRuTubeEmbedUrl(videoId: string): string {
  return `https://rutube.ru/play/embed/${videoId}`
}

export const RuTubePlayer = forwardRef<RuTubePlayerHandle, RuTubePlayerProps>(
  ({ videoId, onPlay, onPause, onSeek, onReady }, ref) => {
    const [isLoading, setIsLoading] = useState(true)
    const [iframeKey, setIframeKey] = useState(0)
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const [isReady, setIsReady] = useState(false)
    const isPlayerPlayingRef = useRef(false)
    const currentTimeRef = useRef(0)
    const durationRef = useRef(0)
    const prevTimeRef = useRef(0)
    const stuckCountRef = useRef(0)
    const advanceCountRef = useRef(0)
    const timeUpdateIntervalRef = useRef<number | null>(null)
    const ignoreEventsRef = useRef(false)

    // Callbacks refs чтобы не переподписываться
    const onPlayRef = useRef(onPlay)
    const onPauseRef = useRef(onPause)
    const onSeekRef = useRef(onSeek)
    const onReadyRef = useRef(onReady)
    onPlayRef.current = onPlay
    onPauseRef.current = onPause
    onSeekRef.current = onSeek
    onReadyRef.current = onReady

    // Отправка команды в iframe через postMessage
    const sendCommand = useCallback((type: string, data?: Record<string, unknown>) => {
      if (!iframeRef.current?.contentWindow) return
      const message = { type, data: data || {} }
      try {
        iframeRef.current.contentWindow.postMessage(JSON.stringify(message), '*')
      } catch (e) {
        console.warn('[RuTube] postMessage error:', e)
      }
    }, [])

    // Обновление состояния играет/пауза
    const setPlaying = useCallback((playing: boolean) => {
      if (ignoreEventsRef.current) return
      const wasPlaying = isPlayerPlayingRef.current
      if (wasPlaying === playing) return

      isPlayerPlayingRef.current = playing
      console.log('[RuTube] State changed:', playing ? 'PLAYING' : 'PAUSED')

      if (playing) {
        onPlayRef.current?.()
      } else {
        onPauseRef.current?.()
      }
    }, [])

    useImperativeHandle(ref, () => ({
      play: () => {
        console.log('[RuTube] Remote command: PLAY')
        ignoreEventsRef.current = true
        sendCommand('player:play')
        isPlayerPlayingRef.current = true
        stuckCountRef.current = 0
        advanceCountRef.current = 0
        setTimeout(() => { ignoreEventsRef.current = false }, 500)
      },
      pause: () => {
        console.log('[RuTube] Remote command: PAUSE')
        ignoreEventsRef.current = true
        sendCommand('player:pause')
        isPlayerPlayingRef.current = false
        stuckCountRef.current = 0
        advanceCountRef.current = 0
        setTimeout(() => { ignoreEventsRef.current = false }, 500)
      },
      seekTo: (time: number) => {
        console.log('[RuTube] Remote command: SEEK to', time)
        ignoreEventsRef.current = true
        sendCommand('player:setCurrentTime', { time })
        currentTimeRef.current = time
        prevTimeRef.current = time
        stuckCountRef.current = 0
        advanceCountRef.current = 0
        setTimeout(() => { ignoreEventsRef.current = false }, 500)
      },
      getCurrentTime: () => currentTimeRef.current,
      getDuration: () => durationRef.current,
      isPlaying: () => isPlayerPlayingRef.current,
      reload: () => {
        setIframeKey(prev => prev + 1)
        setIsLoading(true)
        setIsReady(false)
      }
    }))

    // Слушаем ВСЕ postMessage и обрабатываем от RuTube
    useEffect(() => {
      const handleMessage = (event: MessageEvent) => {
        // Принимаем сообщения от RuTube (может быть rutube.ru или поддомен)
        if (!event.origin.includes('rutube')) return

        let parsed: { type?: string; data?: Record<string, unknown> }
        try {
          parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        } catch {
          return
        }

        if (!parsed || !parsed.type) return

        // Логируем все события для отладки
        if (parsed.type.startsWith('player:')) {
          console.log('[RuTube] Event:', parsed.type, parsed.data)
        }

        switch (parsed.type) {
          case 'player:ready':
            console.log('[RuTube] Player ready!')
            setIsReady(true)
            setIsLoading(false)
            onReadyRef.current?.()
            sendCommand('player:getCurrentTime')
            sendCommand('player:getDuration')
            break

          case 'player:changeState': {
            const state = (parsed.data as { state?: string })?.state
            if (!state) break

            console.log('[RuTube] changeState:', state,
              'ignoring:', ignoreEventsRef.current)

            if (state === 'playing') {
              setPlaying(true)
            } else if (state === 'paused' || state === 'stopped') {
              setPlaying(false)
            }
            break
          }

          case 'player:currentTime': {
            const time = (parsed.data as { time?: number })?.time
            if (typeof time === 'number') {
              currentTimeRef.current = time
            }
            break
          }

          case 'player:duration': {
            const duration = (parsed.data as { duration?: number })?.duration
            if (typeof duration === 'number') {
              durationRef.current = duration
            }
            break
          }
        }
      }

      window.addEventListener('message', handleMessage)
      return () => window.removeEventListener('message', handleMessage)
    }, [sendCommand, setPlaying])

    // Периодический опрос текущего времени + детекция play/pause через изменение времени
    // Это запасной механизм на случай если postMessage события не приходят
    useEffect(() => {
      if (!isReady) return

      // Инициализируем prevTime
      prevTimeRef.current = currentTimeRef.current
      stuckCountRef.current = 0
      advanceCountRef.current = 0

      timeUpdateIntervalRef.current = window.setInterval(() => {
        // Запрашиваем время у плеера
        sendCommand('player:getCurrentTime')
        sendCommand('player:getDuration')

        const now = currentTimeRef.current
        const prev = prevTimeRef.current
        const diff = Math.abs(now - prev)

        if (diff < 0.05) {
          // Время не меняется — возможно пауза
          stuckCountRef.current++
          advanceCountRef.current = 0

          // Если время стоит 2+ тика подряд (600ms) — считаем пауза
          if (stuckCountRef.current >= 2 && isPlayerPlayingRef.current) {
            console.log('[RuTube] Time stuck — detecting PAUSE (fallback)')
            setPlaying(false)
          }
        } else {
          // Время меняется — видео воспроизводится
          stuckCountRef.current = 0
          advanceCountRef.current++

          if (advanceCountRef.current >= 1 && !isPlayerPlayingRef.current) {
            console.log('[RuTube] Time advancing — detecting PLAY (fallback)')
            setPlaying(true)
          }
        }

        prevTimeRef.current = now
      }, 300)

      return () => {
        if (timeUpdateIntervalRef.current) {
          clearInterval(timeUpdateIntervalRef.current)
        }
      }
    }, [isReady, sendCommand, setPlaying])

    const handleLoad = () => {
      console.log('[RuTube] iframe loaded')
      // Ждём player:ready, но ставим fallback таймер
      setTimeout(() => {
        if (!isReady) {
          console.log('[RuTube] player:ready не получен, используем fallback')
          setIsReady(true)
          setIsLoading(false)
          onReadyRef.current?.()
        }
      }, 3000)
    }

    return (
      <div className="rutube-player-wrapper">
        <iframe
          ref={iframeRef}
          key={iframeKey}
          className="rutube-player-iframe"
          src={getRuTubeEmbedUrl(videoId)}
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          onLoad={handleLoad}
          title="RuTube Player"
        />
        {isLoading && (
          <div className="rutube-player-loading">
            <div className="rutube-player-spinner" />
            <p>Загрузка RuTube плеера...</p>
          </div>
        )}
      </div>
    )
  }
)

RuTubePlayer.displayName = 'RuTubePlayer'
