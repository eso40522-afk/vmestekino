import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { buildEmbedUrl, fetchBalancers, DEFAULT_BALANCER_ID, type Balancer } from '../services/alloha'
import './EmbedPlayer.css'

interface EmbedPlayerProps {
  imdbId: string
  title: string
  onReady?: () => void
  onError?: () => void
}

export interface EmbedPlayerHandle {
  reload: () => void
}

export const EmbedPlayer = forwardRef<EmbedPlayerHandle, EmbedPlayerProps>(
  ({ imdbId, title, onReady, onError }, ref) => {
    const fallbackBalancers: Balancer[] = [{ id: DEFAULT_BALANCER_ID, name: 'VidSrc VIP', description: 'Основной плеер' }]
    const [iframeKey, setIframeKey] = useState(0)
    const [isLoading, setIsLoading] = useState(true)
    const [showTimeoutModal, setShowTimeoutModal] = useState(false)
    const [showBalancerList, setShowBalancerList] = useState(false)
    const [selectedBalancer, setSelectedBalancer] = useState<string>(DEFAULT_BALANCER_ID)
    const [balancers, setBalancers] = useState<Balancer[]>(fallbackBalancers)
    const containerRef = useRef<HTMLDivElement>(null)
    const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const origOpenRef = useRef<typeof window.open | null>(null)

    const embedUrl = buildEmbedUrl(imdbId, selectedBalancer)
    const currentBalancer = balancers.find(b => b.id === selectedBalancer) || balancers[0] || fallbackBalancers[0]

    useEffect(() => {
      let isCancelled = false

      fetchBalancers()
        .then(items => {
          if (!isCancelled && items.length > 0) {
            setBalancers(items)
          }
        })
        .catch(() => {
          if (!isCancelled) {
            setBalancers(fallbackBalancers)
          }
        })

      return () => {
        isCancelled = true
      }
    }, [])

    // ========== ЗАЩИТА ОТ РЕКЛАМЫ ==========
    useEffect(() => {
      // Сохраняем оригинальный window.open
      origOpenRef.current = window.open

      // Полностью блокируем window.open для внешних URL
      window.open = function(...args: Parameters<typeof window.open>) {
        const url = args[0]?.toString() || ''
        if (url.includes(window.location.host)) {
          return origOpenRef.current!.apply(window, args)
        }
        console.warn('[ВместеКино] Заблокирован рекламный попап:', url)
        return null
      }

      // Блокируем postMessage навигацию
      const handleMessage = (e: MessageEvent) => {
        if (typeof e.data === 'string' && (e.data.includes('navigate') || e.data.includes('redirect'))) {
          e.stopImmediatePropagation()
        }
      }
      window.addEventListener('message', handleMessage)

      // Детектим когда iframe открывает рекламную вкладку (window теряет фокус)
      // и возвращаем фокус обратно
      const handleBlur = () => {
        setTimeout(() => {
          window.focus()
        }, 100)
      }
      window.addEventListener('blur', handleBlur)

      // Блокируем навигацию страницы от iframe
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        // Если навигация инициирована не пользователем (от iframe рекламы)
        if (document.activeElement instanceof HTMLIFrameElement) {
          e.preventDefault()
          e.returnValue = ''
          window.focus()
        }
      }
      window.addEventListener('beforeunload', handleBeforeUnload)

      return () => {
        window.removeEventListener('message', handleMessage)
        window.removeEventListener('blur', handleBlur)
        window.removeEventListener('beforeunload', handleBeforeUnload)
        if (origOpenRef.current) {
          window.open = origOpenRef.current
        }
      }
    }, [])

    // ========== ЗАГРУЗКА И ТАЙМАУТ ==========
    useEffect(() => {
      setIframeKey(prev => prev + 1)
      setIsLoading(true)
      setShowTimeoutModal(false)
    }, [imdbId, selectedBalancer])

    // Таймаут 20 секунд — если не загрузился, показываем модалку
    useEffect(() => {
      if (isLoading) {
        loadTimeoutRef.current = setTimeout(() => {
          setIsLoading(false)
          setShowTimeoutModal(true)
        }, 20000)
      }
      return () => {
        if (loadTimeoutRef.current) {
          clearTimeout(loadTimeoutRef.current)
          loadTimeoutRef.current = null
        }
      }
    }, [isLoading, iframeKey])

    useImperativeHandle(ref, () => ({
      reload: () => {
        setIframeKey(prev => prev + 1)
        setIsLoading(true)
        setShowTimeoutModal(false)
      }
    }))

    const handleIframeLoad = useCallback(() => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
      setIsLoading(false)
      setShowTimeoutModal(false)
      onReady?.()
    }, [onReady])

    const handleIframeError = useCallback(() => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
      setIsLoading(false)
      setShowTimeoutModal(true)
      onError?.()
    }, [onError])

    const handleReload = () => {
      setIframeKey(prev => prev + 1)
      setIsLoading(true)
      setShowTimeoutModal(false)
    }

    const handleSelectBalancer = (balancer: Balancer) => {
      setSelectedBalancer(balancer.id)
      setShowBalancerList(false)
      setShowTimeoutModal(false)
    }

    return (
      <div className="embed-player" ref={containerRef}>
        {/* Toolbar */}
        <div className="embed-player__toolbar">
          <div className="embed-player__title">
            <span className="embed-player__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="2" width="20" height="20" rx="2"/>
                <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>
              </svg>
            </span>
            {title}
          </div>
          
          <div className="embed-player__controls">
            {/* Balancer selector */}
            <div className="embed-player__balancer-wrapper">
              <button 
                className="embed-player__balancer-btn"
                onClick={() => setShowBalancerList(!showBalancerList)}
                title="Выбрать плеер"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
                <span className="embed-player__balancer-name">{currentBalancer.name}</span>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {showBalancerList && (
                <div className="embed-player__balancer-dropdown">
                  <div className="embed-player__balancer-header">Выберите плеер</div>
                  {balancers.map(b => (
                    <button
                      key={b.id}
                      className={`embed-player__balancer-item ${b.id === selectedBalancer ? 'active' : ''}`}
                      onClick={() => handleSelectBalancer(b)}
                    >
                      <div className="embed-player__balancer-item-name">{b.name}</div>
                      <div className="embed-player__balancer-item-desc">{b.description}</div>
                      {b.id === selectedBalancer && (
                        <svg className="embed-player__balancer-check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Reload button */}
            <button 
              className="embed-player__reload-btn"
              onClick={handleReload}
              title="Перезагрузить плеер"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          </div>
        </div>

        {/* Player area */}
        <div className="embed-player__container">
          {isLoading && (
            <div className="embed-player__loading">
              <div className="embed-player__spinner" />
              <p>Загрузка {currentBalancer.name}...</p>
              <p className="embed-player__loading-hint">Если плеер не загрузится — попробуйте другой</p>
            </div>
          )}

          <iframe
            key={iframeKey}
            src={embedUrl}
            className={`embed-player__iframe ${isLoading || showTimeoutModal ? 'hidden' : ''}`}
            allowFullScreen
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            title={title}
            referrerPolicy="no-referrer"
          />
        </div>

        {/* Модальное окно — плеер не отвечает */}
        {showTimeoutModal && (
          <div className="embed-player__timeout-overlay">
            <div className="embed-player__timeout-modal">
              <div className="embed-player__timeout-icon">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <h3 className="embed-player__timeout-title">Плеер временно не работает</h3>
              <p className="embed-player__timeout-desc">
                <strong>{currentBalancer.name}</strong> не отвечает. Выберите другой плеер:
              </p>
              <div className="embed-player__timeout-balancers">
                {balancers.filter(b => b.id !== selectedBalancer).map(b => (
                  <button
                    key={b.id}
                    className="embed-player__timeout-balancer-btn"
                    onClick={() => handleSelectBalancer(b)}
                  >
                    <span className="embed-player__timeout-balancer-name">{b.name}</span>
                    <span className="embed-player__timeout-balancer-desc">{b.description}</span>
                  </button>
                ))}
              </div>
              <button className="embed-player__timeout-retry" onClick={handleReload}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                Попробовать снова
              </button>
            </div>
          </div>
        )}

        {/* Info bar */}
        <div className="embed-player__info">
          <span className="embed-player__info-item">
            <span className="embed-player__info-label">IMDB:</span> {imdbId}
          </span>
          <span className="embed-player__info-item">
            <span className="embed-player__info-label">Плеер:</span> {currentBalancer.name}
          </span>
        </div>
      </div>
    )
  }
)

EmbedPlayer.displayName = 'EmbedPlayer'
