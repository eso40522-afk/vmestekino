import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getPopularMovies, getPosterUrl } from '../services/tmdb'
import './Auth.css'

export default function Login() {
  const navigate = useNavigate()
  const { user, login, loginAsGuest } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [posters, setPosters] = useState<string[]>([])

  useEffect(() => {
    if (user && !user.isGuest) navigate(user.role === 'admin' ? '/admin' : '/')
  }, [user, navigate])

  useEffect(() => {
    getPopularMovies(1).then(data => {
      const urls = data.results
        .filter(m => m.poster_path)
        .slice(0, 12)
        .map(m => getPosterUrl(m.poster_path, 'w342'))
      setPosters(urls)
    }).catch(() => {})
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email || !password) { setError('Заполните все поля'); return }
    setIsSubmitting(true)
    try {
      await login(email, password)
    } catch (err: any) {
      setError(err.message || 'Произошла ошибка')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleGuest = () => {
    loginAsGuest()
    navigate('/room')
  }

  return (
    <div className="auth-page">
      {/* Left — form */}
      <div className="auth-left">
        <Link to="/" className="auth-logo">
          <span className="auth-logo__star">✦</span>
          <span>ВместеКино</span>
        </Link>

        <div className="auth-left__inner">
          <h1 className="auth-heading">Войти в ваш аккаунт</h1>

          {error && <div className="auth-error">{error}</div>}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-input-group">
              <span className="auth-input-group__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7L13.03 12.7c-.63.39-1.43.39-2.06 0L2 7"/></svg>
              </span>
              <input
                type="email"
                className="auth-input-group__field"
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div className="auth-input-group">
              <span className="auth-input-group__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </span>
              <input
                type="password"
                className="auth-input-group__field"
                placeholder="Пароль"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            <a href="#" className="auth-forgot" onClick={e => e.preventDefault()}>Забыли пароль?</a>

            <button type="submit" className="auth-submit" disabled={isSubmitting}>
              {isSubmitting ? 'Подождите...' : 'Войти'}
            </button>
          </form>

          <div className="auth-switch">
            Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
          </div>

          <div className="auth-guest-divider">
            <span className="auth-divider__line" />
            <span className="auth-divider__text">или</span>
            <span className="auth-divider__line" />
          </div>

          <button className="auth-guest-btn" onClick={handleGuest}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>
            Войти как гость
          </button>
        </div>

        <div className="auth-footer">
          Продолжая, вы соглашаетесь с <a href="#">Условиями использования</a> и <a href="#">Политикой конфиденциальности</a>
        </div>
      </div>

      {/* Right — branding with movie posters */}
      <div className="auth-right">
        <div className="auth-right__posters">
          {[...posters, ...posters].map((url, i) => (
            <img key={i} src={url} alt="" className="auth-right__poster-item" loading="lazy" />
          ))}
        </div>
        <div className="auth-right__glow" />
        <div className="auth-right__vignette" />
        <div className="auth-right__decor">
          <div className="auth-right__icon">✦</div>
          <div className="auth-right__title">ВместеКино</div>
          <div className="auth-right__sub">Смотрите фильмы и сериалы вместе с друзьями</div>
        </div>
      </div>
    </div>
  )
}
