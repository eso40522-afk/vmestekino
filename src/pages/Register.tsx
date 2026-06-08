import { useState, useEffect, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getPopularMovies, getPosterUrl } from '../services/tmdb'
import LegalModal, { type LegalTab } from '../components/LegalModal'
import './Auth.css'

type FieldErrors = {
  email?: string
  handle?: string
  password?: string
  confirmPassword?: string
  agreeTerms?: string
}

type TouchedMap = {
  email?: boolean
  handle?: boolean
  password?: boolean
  confirmPassword?: boolean
  agreeTerms?: boolean
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const HANDLE_RE = /^[a-z0-9._]+$/
const CYRILLIC_RE = /[а-яёА-ЯЁ]/

function validateEmail(value: string): string | undefined {
  if (!value) return 'Введите email'
  if (value.length > 254) return 'Слишком длинный email'
  if (!EMAIL_RE.test(value)) return 'Некорректный email'
  return undefined
}

function validateHandle(value: string): string | undefined {
  if (!value) return 'Введите логин'
  if (CYRILLIC_RE.test(value)) return 'Используйте только латиницу'
  if (/\s/.test(value)) return 'Логин не может содержать пробелы'
  if (!HANDLE_RE.test(value)) return 'Только латиница, цифры, точка и подчёркивание'
  if (value.length < 3) return 'Минимум 3 символа'
  if (value.length > 24) return 'Максимум 24 символа'
  if (/^[._]|[._]$/.test(value)) return 'Не может начинаться/заканчиваться на . или _'
  if (/[._]{2,}/.test(value)) return 'Точки и подчёркивания не должны идти подряд'
  return undefined
}

function validatePassword(value: string): string | undefined {
  if (!value) return 'Введите пароль'
  if (CYRILLIC_RE.test(value)) return 'Пароль: только латиница, цифры и спецсимволы'
  if (/\s/.test(value)) return 'Пароль не должен содержать пробелы'
  if (value.length < 8) return 'Минимум 8 символов'
  if (value.length > 128) return 'Слишком длинный пароль'
  if (!/[a-zA-Z]/.test(value)) return 'Должна быть хотя бы одна буква'
  if (!/\d/.test(value)) return 'Должна быть хотя бы одна цифра'
  return undefined
}

function passwordStrength(value: string): { score: number; label: string } {
  if (!value) return { score: 0, label: '' }
  let score = 0
  if (value.length >= 8) score++
  if (value.length >= 12) score++
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++
  if (/\d/.test(value)) score++
  if (/[^A-Za-z0-9]/.test(value)) score++
  if (score <= 1) return { score: 1, label: 'Слабый' }
  if (score === 2) return { score: 2, label: 'Средний' }
  if (score === 3) return { score: 3, label: 'Хороший' }
  return { score: 4, label: 'Надёжный' }
}

export default function Register() {
  const navigate = useNavigate()
  const { user, register } = useAuth()
  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [touched, setTouched] = useState<TouchedMap>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [posters, setPosters] = useState<string[]>([])
  const [legalTab, setLegalTab] = useState<LegalTab | null>(null)

  useEffect(() => {
    if (user && !user.isGuest) navigate('/')
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

  const fieldErrors: FieldErrors = useMemo(() => {
    const errs: FieldErrors = {}
    errs.email = validateEmail(email)
    errs.handle = validateHandle(handle)
    errs.password = validatePassword(password)
    if (!confirmPassword) errs.confirmPassword = 'Повторите пароль'
    else if (confirmPassword !== password) errs.confirmPassword = 'Пароли не совпадают'
    if (!agreeTerms) errs.agreeTerms = 'Примите условия использования'
    return errs
  }, [email, handle, password, confirmPassword, agreeTerms])

  const strength = useMemo(() => passwordStrength(password), [password])
  const isFormValid =
    !fieldErrors.email &&
    !fieldErrors.handle &&
    !fieldErrors.password &&
    !fieldErrors.confirmPassword &&
    !fieldErrors.agreeTerms

  const handleBlur = (field: keyof TouchedMap) => () => {
    setTouched(prev => ({ ...prev, [field]: true }))
  }

  const showError = (field: keyof FieldErrors) => {
    if (!fieldErrors[field]) return false
    // Real-time: показываем ошибку, как только пользователь что-то ввёл в поле,
    // либо если поле уже было «потрогано» (blur/submit)
    if (touched[field]) return true
    if (field === 'email' && email.length > 0) return true
    if (field === 'handle' && handle.length > 0) return true
    if (field === 'password' && password.length > 0) return true
    if (field === 'confirmPassword' && confirmPassword.length > 0) return true
    return false
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError('')
    setTouched({ email: true, handle: true, password: true, confirmPassword: true, agreeTerms: true })
    if (!isFormValid) return
    setIsSubmitting(true)
    try {
      await register(email.trim(), handle.trim(), password)
      navigate('/')
    } catch (err: any) {
      setSubmitError(err.message || 'Произошла ошибка')
    } finally {
      setIsSubmitting(false)
    }
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
          <h1 className="auth-heading">Создать аккаунт</h1>

          {submitError && <div className="auth-error">{submitError}</div>}

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <div className="auth-field">
              <div className={`auth-input-group${showError('email') ? ' auth-input-group--error' : ''}`}>
                <span className="auth-input-group__icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7L13.03 12.7c-.63.39-1.43.39-2.06 0L2 7"/></svg>
                </span>
                <input
                  type="email"
                  className="auth-input-group__field"
                  placeholder="Email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onBlur={handleBlur('email')}
                  autoComplete="email"
                  maxLength={254}
                />
              </div>
              {showError('email') && <div className="auth-field-error">{fieldErrors.email}</div>}
            </div>

            <div className="auth-field">
              <div className={`auth-input-group${showError('handle') ? ' auth-input-group--error' : ''}`}>
                <span className="auth-input-group__icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </span>
                <input
                  type="text"
                  className="auth-input-group__field"
                  placeholder="Логин"
                  value={handle}
                  onChange={e => setHandle(e.target.value.toLowerCase().slice(0, 32))}
                  onBlur={handleBlur('handle')}
                  autoComplete="username"
                  maxLength={32}
                />
              </div>
              {showError('handle') && <div className="auth-field-error">{fieldErrors.handle}</div>}
            </div>

            <div className="auth-field">
              <div className={`auth-input-group${showError('password') ? ' auth-input-group--error' : ''}`}>
                <span className="auth-input-group__icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="auth-input-group__field"
                  placeholder="Пароль"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onBlur={handleBlur('password')}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="auth-input-group__toggle"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
                </button>
              </div>
              {password && (
                <div className={`auth-strength auth-strength--s${strength.score}`}>
                  <div className="auth-strength__bar"><span /></div>
                  <span className="auth-strength__label">{strength.label}</span>
                </div>
              )}
              {showError('password') && <div className="auth-field-error">{fieldErrors.password}</div>}
            </div>

            <div className="auth-field">
              <div className={`auth-input-group${showError('confirmPassword') ? ' auth-input-group--error' : ''}`}>
                <span className="auth-input-group__icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </span>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  className="auth-input-group__field"
                  placeholder="Повторите пароль"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  onBlur={handleBlur('confirmPassword')}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="auth-input-group__toggle"
                  onClick={() => setShowConfirmPassword(v => !v)}
                  aria-label={showConfirmPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  tabIndex={-1}
                >
                  {showConfirmPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
                </button>
              </div>
              {showError('confirmPassword') && <div className="auth-field-error">{fieldErrors.confirmPassword}</div>}
            </div>

            <label className="auth-terms">
              <input
                type="checkbox"
                checked={agreeTerms}
                onChange={e => { setAgreeTerms(e.target.checked); setTouched(prev => ({ ...prev, agreeTerms: true })) }}
                className="auth-terms-checkbox"
              />
              <span className="auth-terms-text">
                Я согласен(на) с условиями <a href="#" className="auth-terms-link" onClick={e => { e.preventDefault(); setLegalTab('privacy') }}>Политики конфиденциальности</a> и <a href="#" className="auth-terms-link" onClick={e => { e.preventDefault(); setLegalTab('terms') }}>Пользовательского соглашения</a>
              </span>
            </label>
            {showError('agreeTerms') && <div className="auth-field-error">{fieldErrors.agreeTerms}</div>}

            <button type="submit" className="auth-submit" disabled={isSubmitting}>
              {isSubmitting ? 'Подождите...' : 'Создать аккаунт'}
            </button>
          </form>

          <div className="auth-switch">
            Уже есть аккаунт? <Link to="/login">Войти</Link>
          </div>
        </div>

        <div className="auth-footer">
          Продолжая, вы соглашаетесь с <a href="#" onClick={e => { e.preventDefault(); setLegalTab('terms') }}>Условиями использования</a> и <a href="#" onClick={e => { e.preventDefault(); setLegalTab('privacy') }}>Политикой конфиденциальности</a>
        </div>
      </div>

      {/* Right — branding */}
      <div className="auth-right">        <div className="auth-right__posters">
          {[...posters, ...posters].map((url, i) => (
            <img key={i} src={url} alt="" className="auth-right__poster-item" loading="lazy" />
          ))}
        </div>
        <div className="auth-right__glow" />
        <div className="auth-right__vignette" />        <div className="auth-right__decor">
          <div className="auth-right__icon">✦</div>
          <div className="auth-right__title">ВместеКино</div>
          <div className="auth-right__sub">Смотрите фильмы и сериалы вместе с друзьями</div>
        </div>
      </div>

      <LegalModal isOpen={legalTab !== null} initialTab={legalTab ?? 'privacy'} onClose={() => setLegalTab(null)} />
    </div>
  )
}

