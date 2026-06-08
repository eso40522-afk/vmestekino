import { useState, useRef, useCallback, useEffect } from 'react'
import './ImageCropModal.css'

interface ImageCropModalProps {
  image: string // data URL или URL изображения
  aspectRatio: number // ширина/высота (1 для аватара, 3 для баннера)
  title: string
  isCircle?: boolean
  onSave: (croppedImage: string) => void
  onClose: () => void
  outputWidth: number
  outputHeight: number
}

export default function ImageCropModal({
  image,
  aspectRatio,
  title,
  isCircle = false,
  onSave,
  onClose,
  outputWidth,
  outputHeight
}: ImageCropModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })

  // Рассчитываем размеры при загрузке
  const handleImageLoad = useCallback(() => {
    if (!imgRef.current || !containerRef.current) return

    const container = containerRef.current.getBoundingClientRect()
    const img = imgRef.current

    setContainerSize({ w: container.width, h: container.height })
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight })

    // Рассчитываем начальный масштаб, чтобы изображение покрывало область кропа
    const cropW = Math.min(container.width, container.height * aspectRatio)
    const cropH = cropW / aspectRatio

    const scaleW = cropW / img.naturalWidth
    const scaleH = cropH / img.naturalHeight
    const initialScale = Math.max(scaleW, scaleH)

    setScale(initialScale)
    setPosition({
      x: (container.width - img.naturalWidth * initialScale) / 2,
      y: (container.height - img.naturalHeight * initialScale) / 2
    })
  }, [aspectRatio])

  // Масштабирование
  const handleScaleChange = (newScale: number) => {
    if (!containerRef.current) return

    const container = containerRef.current.getBoundingClientRect()
    const cropW = Math.min(container.width, container.height * aspectRatio)
    const cropH = cropW / aspectRatio
    const cropX = (container.width - cropW) / 2
    const cropY = (container.height - cropH) / 2

    // Центр кропа
    const cx = cropX + cropW / 2
    const cy = cropY + cropH / 2

    // Корректируем позицию чтобы центр оставался на месте
    const ratio = newScale / scale
    const newX = cx - (cx - position.x) * ratio
    const newY = cy - (cy - position.y) * ratio

    setScale(newScale)
    setPosition(clampPosition(newX, newY, newScale))
  }

  // Ограничение позиции
  const clampPosition = useCallback((x: number, y: number, s: number) => {
    if (!containerRef.current) return { x, y }

    const container = containerRef.current.getBoundingClientRect()
    const cropW = Math.min(container.width, container.height * aspectRatio)
    const cropH = cropW / aspectRatio
    const cropX = (container.width - cropW) / 2
    const cropY = (container.height - cropH) / 2

    const imgW = imgSize.w * s
    const imgH = imgSize.h * s

    // Изображение не должно уходить за границы кропа
    const maxX = cropX
    const minX = cropX + cropW - imgW
    const maxY = cropY
    const minY = cropY + cropH - imgH

    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y))
    }
  }, [aspectRatio, imgSize])

  // Drag events
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true)
      setDragStart({
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y
      })
    }
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return
      const newX = e.clientX - dragStart.x
      const newY = e.clientY - dragStart.y
      setPosition(clampPosition(newX, newY, scale))
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging || e.touches.length !== 1) return
      const newX = e.touches[0].clientX - dragStart.x
      const newY = e.touches[0].clientY - dragStart.y
      setPosition(clampPosition(newX, newY, scale))
    }

    const handleEnd = () => setIsDragging(false)

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleEnd)
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', handleEnd)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleEnd)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleEnd)
    }
  }, [isDragging, dragStart, scale, clampPosition])

  // Колёсико мыши для масштаба
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    const minScale = getMinScale()
    const newScale = Math.min(Math.max(scale + delta, minScale), minScale * 5)
    handleScaleChange(newScale)
  }

  const getMinScale = () => {
    if (!containerRef.current || imgSize.w === 0) return 0.1
    const container = containerRef.current.getBoundingClientRect()
    const cropW = Math.min(container.width, container.height * aspectRatio)
    const cropH = cropW / aspectRatio
    return Math.max(cropW / imgSize.w, cropH / imgSize.h)
  }

  // Сохранение
  const handleSave = () => {
    if (!containerRef.current || !imgRef.current) return

    const container = containerRef.current.getBoundingClientRect()
    const cropW = Math.min(container.width, container.height * aspectRatio)
    const cropH = cropW / aspectRatio
    const cropX = (container.width - cropW) / 2
    const cropY = (container.height - cropH) / 2

    // Координаты кропа относительно изображения
    const srcX = (cropX - position.x) / scale
    const srcY = (cropY - position.y) / scale
    const srcW = cropW / scale
    const srcH = cropH / scale

    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = outputHeight
    const ctx = canvas.getContext('2d')!

    // Если круг — делаем clip
    if (isCircle) {
      ctx.beginPath()
      ctx.arc(outputWidth / 2, outputHeight / 2, outputWidth / 2, 0, Math.PI * 2)
      ctx.closePath()
      ctx.clip()
    }

    ctx.drawImage(imgRef.current, srcX, srcY, srcW, srcH, 0, 0, outputWidth, outputHeight)
    onSave(canvas.toDataURL('image/jpeg', 0.85))
  }

  // Aspect-fit viewport inside the container so the crop box never overflows.
  const cropW = containerSize.w > 0 && containerSize.h > 0
    ? Math.min(containerSize.w, containerSize.h * aspectRatio)
    : 0
  const cropH = cropW > 0 ? cropW / aspectRatio : 0
  const cropX = containerSize.w > 0 ? (containerSize.w - cropW) / 2 : 0
  const cropY = containerSize.h > 0 ? (containerSize.h - cropH) / 2 : 0

  return (
    <div className="crop-modal-overlay" onClick={onClose}>
      <div className="crop-modal" onClick={e => e.stopPropagation()}>
        <div className="crop-modal__header">
          <button className="crop-modal__close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <h3 className="crop-modal__title">{title}</h3>
          <button className="crop-modal__save" onClick={handleSave}>Применить</button>
        </div>

        <div
          ref={containerRef}
          className={`crop-modal__area ${isCircle ? 'crop-modal__area--circle' : ''}`}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onWheel={handleWheel}
        >
          <img
            ref={imgRef}
            src={image}
            alt=""
            className="crop-modal__image"
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transformOrigin: '0 0'
            }}
            onLoad={handleImageLoad}
            draggable={false}
          />

          {/* Затемнение вне области кропа */}
          <div className="crop-modal__mask">
            <div className="crop-modal__mask-top" style={{ height: cropY }} />
            <div className="crop-modal__mask-center" style={{ height: cropH }}>
              <div className="crop-modal__mask-side" style={{ width: cropX }} />
              <div className={`crop-modal__viewport ${isCircle ? 'crop-modal__viewport--circle' : ''}`} style={{ width: cropW }} />
              <div className="crop-modal__mask-side" style={{ width: cropX }} />
            </div>
            <div className="crop-modal__mask-bottom" style={{ height: cropY }} />
          </div>
        </div>

        <div className="crop-modal__controls">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
          <input
            type="range"
            className="crop-modal__slider"
            min={getMinScale() * 100}
            max={getMinScale() * 500}
            value={scale * 100}
            onChange={e => handleScaleChange(Number(e.target.value) / 100)}
          />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </div>
      </div>
    </div>
  )
}
