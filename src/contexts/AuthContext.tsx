import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { API_URL } from '../config/api'

// ==================== ТИПЫ ====================

export interface User {
  id: string
  email?: string
  username: string
  color: string
  initials: string
  role?: 'user' | 'admin'
  isGuest?: boolean
  bio?: string
  avatar?: string
  banner?: string
  createdAt?: string
  isBanned?: boolean
  banReason?: string
  timeoutUntil?: number | null
  timeoutReason?: string
}

export interface WatchedMovie {
  movieId: number | string
  title: string
  posterPath: string
  year: string
  rating: number
  ratedAt: string
}

interface AuthContextType {
  user: User | null
  token: string | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
  loginAsGuest: (username?: string) => void
  updateProfile: (data: { username?: string; bio?: string; avatar?: string; banner?: string }) => Promise<void>
  syncUser: (data: Partial<User>) => void
}

// ==================== КОНТЕКСТ ====================

const AuthContext = createContext<AuthContextType | null>(null)

// Убираем тяжёлые base64 поля перед сохранением в localStorage (лимит ~5 МБ)
function userForStorage(u: User): Omit<User, 'avatar' | 'banner'> {
  const { avatar, banner, ...light } = u
  return light
}

// ==================== ПРОВАЙДЕР ==

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const syncUser = useCallback((data: Partial<User>) => {
    setUser(prev => {
      if (!prev) return prev
      const nextUser = { ...prev, ...data }
      localStorage.setItem('uniscreen_user', JSON.stringify(userForStorage(nextUser)))
      return nextUser
    })
  }, [])

  // Загружаем сессию из localStorage при старте
  useEffect(() => {
    const savedToken = localStorage.getItem('uniscreen_token')
    const savedUser = localStorage.getItem('uniscreen_user')

    if (savedToken && savedUser) {
      setToken(savedToken)
      setUser(JSON.parse(savedUser))

      // Проверяем валидность токена
      fetch(`${API_URL}/me`, {
        headers: { Authorization: `Bearer ${savedToken}` }
      })
        .then(res => {
          if (!res.ok) throw new Error('Invalid token')
          return res.json()
        })
        .then(data => {
          setUser(data.user)
          localStorage.setItem('uniscreen_user', JSON.stringify(userForStorage(data.user)))
        })
        .catch(() => {
          // Токен невалиден, очищаем
          localStorage.removeItem('uniscreen_token')
          localStorage.removeItem('uniscreen_user')
          setToken(null)
          setUser(null)
        })
        .finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [])

  // Регистрация
  const register = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || 'Ошибка регистрации')
    }

    setToken(data.token)
    setUser(data.user)
    localStorage.setItem('uniscreen_token', data.token)
    localStorage.setItem('uniscreen_user', JSON.stringify(userForStorage(data.user)))
  }, [])

  // Вход
  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || 'Ошибка входа')
    }

    setToken(data.token)
    setUser(data.user)
    localStorage.setItem('uniscreen_token', data.token)
    localStorage.setItem('uniscreen_user', JSON.stringify(userForStorage(data.user)))
  }, [])

  // Выход
  const logout = useCallback(() => {
    if (token) {
      fetch(`${API_URL}/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {})
    }

    setToken(null)
    setUser(null)
    localStorage.removeItem('uniscreen_token')
    localStorage.removeItem('uniscreen_user')
  }, [token])

  // Вход как гость
  const loginAsGuest = useCallback((username?: string) => {
    const colors = [
      '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#10b981',
      '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899'
    ]
    const guestName = username || `Гость ${Math.floor(Math.random() * 10000)}`
    const initials = guestName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

    const guestUser: User = {
      id: `guest_${Date.now()}`,
      username: guestName,
      color: colors[Math.floor(Math.random() * colors.length)],
      initials,
      isGuest: true,
      role: 'user',
      isBanned: false,
      banReason: '',
      timeoutUntil: null,
      timeoutReason: ''
    }

    setUser(guestUser)
    localStorage.setItem('uniscreen_user', JSON.stringify(userForStorage(guestUser)))
  }, [])

  // Обновление профиля
  const updateProfile = useCallback(async (data: { username?: string; bio?: string; avatar?: string; banner?: string }) => {
    if (!token) throw new Error('Не авторизован')

    const res = await fetch(`${API_URL}/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(data)
    })

    if (!res.ok) {
      // Если сессия истекла — автоматически выходим
      if (res.status === 401) {
        setToken(null)
        setUser(null)
        localStorage.removeItem('uniscreen_token')
        localStorage.removeItem('uniscreen_user')
        throw new Error('Сессия истекла. Войдите заново.')
      }
      const contentType = res.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        const errData = await res.json()
        throw new Error(errData.error || 'Ошибка обновления профиля')
      }
      throw new Error(res.status === 413 ? 'Изображение слишком большое. Попробуйте файл меньшего размера.' : 'Ошибка обновления профиля')
    }

    const result = await res.json()

    const updatedUser: User = {
      id: result.profile.id,
      email: result.profile.email,
      username: result.profile.username,
      color: result.profile.color,
      initials: result.profile.initials,
      role: result.profile.role || user?.role || 'user',
      bio: result.profile.bio,
      avatar: result.profile.avatar,
      banner: result.profile.banner,
      createdAt: result.profile.createdAt,
      isBanned: result.profile.isBanned || false,
      banReason: result.profile.banReason || '',
      timeoutUntil: result.profile.timeoutUntil || null,
      timeoutReason: result.profile.timeoutReason || ''
    }

    setUser(updatedUser)
    localStorage.setItem('uniscreen_user', JSON.stringify(userForStorage(updatedUser)))
  }, [token])

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout, loginAsGuest, updateProfile, syncUser }}>
      {children}
    </AuthContext.Provider>
  )
}

// ==================== ХУК ====================

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth должен использоваться внутри AuthProvider')
  }
  return context
}
