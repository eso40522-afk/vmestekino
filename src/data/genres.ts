// Список жанров TMDB — продублирован чтобы быстро использовать в любых компонентах
// без асинхронных запросов. Сопоставим с translations внутри tmdb.ts.

export interface GenreOption {
  id: number
  name: string
  emoji: string
  gradient: string
  /** Основной акцентный цвет жанра — используется для обводки стеклянных пилюль */
  accent: string
}

export const GENRE_OPTIONS: GenreOption[] = [
  { id: 28, name: 'Боевик', emoji: '💥', accent: '#ef4444', gradient: 'linear-gradient(135deg, #ef4444, #dc2626)' },
  { id: 12, name: 'Приключения', emoji: '🗺️', accent: '#f59e0b', gradient: 'linear-gradient(135deg, #f59e0b, #ea580c)' },
  { id: 16, name: 'Анимация', emoji: '🎨', accent: '#f472b6', gradient: 'linear-gradient(135deg, #f472b6, #ec4899)' },
  { id: 35, name: 'Комедия', emoji: '😂', accent: '#facc15', gradient: 'linear-gradient(135deg, #facc15, #eab308)' },
  { id: 80, name: 'Криминал', emoji: '🔫', accent: '#94a3b8', gradient: 'linear-gradient(135deg, #475569, #1e293b)' },
  { id: 99, name: 'Документальный', emoji: '📷', accent: '#9ca3af', gradient: 'linear-gradient(135deg, #6b7280, #4b5563)' },
  { id: 18, name: 'Драма', emoji: '🎭', accent: '#8b5cf6', gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' },
  { id: 10751, name: 'Семейный', emoji: '👨‍👩‍👧', accent: '#34d399', gradient: 'linear-gradient(135deg, #34d399, #10b981)' },
  { id: 14, name: 'Фэнтези', emoji: '🐉', accent: '#a78bfa', gradient: 'linear-gradient(135deg, #a78bfa, #7c3aed)' },
  { id: 36, name: 'История', emoji: '🏛️', accent: '#d97706', gradient: 'linear-gradient(135deg, #b45309, #92400e)' },
  { id: 27, name: 'Ужасы', emoji: '👻', accent: '#64748b', gradient: 'linear-gradient(135deg, #1f2937, #111827)' },
  { id: 10402, name: 'Музыка', emoji: '🎵', accent: '#ec4899', gradient: 'linear-gradient(135deg, #ec4899, #db2777)' },
  { id: 9648, name: 'Детектив', emoji: '🕵️', accent: '#64748b', gradient: 'linear-gradient(135deg, #334155, #1e293b)' },
  { id: 10749, name: 'Мелодрама', emoji: '💖', accent: '#f9a8d4', gradient: 'linear-gradient(135deg, #f9a8d4, #ec4899)' },
  { id: 878, name: 'Фантастика', emoji: '🚀', accent: '#06b6d4', gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)' },
  { id: 10770, name: 'ТВ фильм', emoji: '📺', accent: '#94a3b8', gradient: 'linear-gradient(135deg, #64748b, #475569)' },
  { id: 53, name: 'Триллер', emoji: '🔪', accent: '#3b82f6', gradient: 'linear-gradient(135deg, #1e40af, #1e3a8a)' },
  { id: 10752, name: 'Военный', emoji: '⚔️', accent: '#22c55e', gradient: 'linear-gradient(135deg, #166534, #14532d)' },
  { id: 37, name: 'Вестерн', emoji: '🤠', accent: '#ca8a04', gradient: 'linear-gradient(135deg, #a16207, #854d0e)' }
]

const GENRE_MAP = new Map(GENRE_OPTIONS.map(g => [g.id, g]))

export function getGenreOption(id: number): GenreOption | undefined {
  return GENRE_MAP.get(id)
}

export function getGenreLabel(id: number): string {
  return GENRE_MAP.get(id)?.name || 'Другое'
}
