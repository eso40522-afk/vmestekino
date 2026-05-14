import { Link, useLocation, useNavigate } from 'react-router-dom'
import './NotFound.css'

interface NotFoundProps {
  isAdmin: boolean
}

export default function NotFound({ isAdmin }: NotFoundProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const homePath = isAdmin ? '/admin' : '/'

  return (
    <main className="notFound">
      <div className="notFound__ambient notFound__ambient--left" aria-hidden="true" />
      <div className="notFound__ambient notFound__ambient--right" aria-hidden="true" />

      <section className="notFound__card">
        <span className="notFound__badge">404</span>
        <p className="notFound__eyebrow">Страница не найдена</p>
        <h1 className="notFound__title">Такого маршрута здесь нет</h1>
        <p className="notFound__text">
          Похоже, вы перешли по несуществующей ссылке или страница была перемещена.
        </p>

        <div className="notFound__path">
          <span className="notFound__pathLabel">Запрошенный путь</span>
          <code className="notFound__pathValue">{location.pathname}</code>
        </div>

        <div className="notFound__actions">
          <Link to={homePath} className="notFound__action notFound__action--primary">
            {isAdmin ? 'Вернуться в админку' : 'На главную'}
          </Link>
          <button type="button" className="notFound__action notFound__action--ghost" onClick={() => navigate(-1)}>
            Назад
          </button>
        </div>
      </section>
    </main>
  )
}