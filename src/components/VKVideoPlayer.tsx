import { forwardRef, useImperativeHandle, useState } from 'react'
import './VKVideoPlayer.css'

interface VKVideoPlayerProps {
  embedUrl: string
  onReady?: () => void
}

export interface VKVideoPlayerHandle {
  reload: () => void
}

// Извлечение oid и id из VK Video URL
// Поддерживает: vkvideo.ru/video-123_456, vk.com/video-123_456, vk.com/video123_456
export function extractVKVideoParams(url: string): { oid: string; id: string } | null {
  const patterns = [
    /(?:vkvideo\.ru|vk\.com)\/(?:video|clip)(-?\d+)_(\d+)/i,
    /(?:vkvideo\.ru|vk\.com)\/shorts\/(-?\d+)_(\d+)/i
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) {
      return { oid: match[1], id: match[2] }
    }
  }

  return null
}

// Проверка, является ли URL ссылкой на VK Video
export function isVKVideoUrl(url: string): boolean {
  return /(?:vkvideo\.ru|vk\.com\/(?:video|clip|shorts))/.test(url)
}

// Получение embed URL для VK Video
export function getVKVideoEmbedUrl(oid: string, id: string): string {
  return `https://vk.com/video_ext.php?oid=${oid}&id=${id}&hd=2`
}

// Построить embed URL из полного URL
export function buildVKVideoEmbedFromUrl(url: string): string | null {
  const params = extractVKVideoParams(url)
  if (!params) return null
  return getVKVideoEmbedUrl(params.oid, params.id)
}

export const VKVideoPlayer = forwardRef<VKVideoPlayerHandle, VKVideoPlayerProps>(
  ({ embedUrl, onReady }, ref) => {
    const [isLoading, setIsLoading] = useState(true)
    const [iframeKey, setIframeKey] = useState(0)

    useImperativeHandle(ref, () => ({
      reload: () => {
        setIframeKey(prev => prev + 1)
        setIsLoading(true)
      }
    }))

    const handleLoad = () => {
      setIsLoading(false)
      onReady?.()
    }

    return (
      <div className="vkvideo-player-wrapper">
        <iframe
          key={iframeKey}
          className="vkvideo-player-iframe"
          src={embedUrl}
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          onLoad={handleLoad}
          title="VK Video Player"
        />
        {isLoading && (
          <div className="vkvideo-player-loading">
            <div className="vkvideo-player-spinner" />
            <p>Загрузка VK Video плеера...</p>
          </div>
        )}
      </div>
    )
  }
)

VKVideoPlayer.displayName = 'VKVideoPlayer'
