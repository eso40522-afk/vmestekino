import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { SocketProvider } from './contexts/SocketContext'
import { useAuth } from './contexts/AuthContext'
import Home from './pages/Home'
import Room from './pages/Room'
import Rooms from './pages/Rooms'
import Library from './pages/Library'
import Profile from './pages/Profile'
import Login from './pages/Login'
import Register from './pages/Register'
import AdminPanel from './pages/AdminPanel'
import NotFound from './pages/NotFound'
import { useParams } from 'react-router-dom'
import './App.css'

// Зарезервированные слова первого уровня — не могут быть handle
const RESERVED_HANDLES = new Set([
  'admin', 'login', 'register', 'rooms', 'room', 'library', 'profile',
  'api', 'static', 'assets', 'public', 'uploads', 'favicon.ico'
])

function HandleOrNotFound({ isAdmin }: { isAdmin: boolean }) {
  const { handle } = useParams<{ handle: string }>()
  if (!handle || RESERVED_HANDLES.has(handle.toLowerCase())) {
    return <NotFound isAdmin={isAdmin} />
  }
  return isAdmin ? <Navigate to="/admin" replace /> : <Profile />
}

function AppRoutes() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return null
  }

  const isAdmin = user?.role === 'admin'

  return (
    <Routes>
      <Route path="/admin" element={isAdmin ? <AdminPanel /> : <Navigate to="/login" replace />} />
      <Route path="/login" element={isAdmin ? <Navigate to="/admin" replace /> : <Login />} />
      <Route path="/register" element={isAdmin ? <Navigate to="/admin" replace /> : <Register />} />
      <Route path="/" element={isAdmin ? <Navigate to="/admin" replace /> : <Home />} />
      <Route path="/rooms" element={isAdmin ? <Navigate to="/admin" replace /> : <Rooms />} />
      <Route path="/library" element={isAdmin ? <Navigate to="/admin" replace /> : <Library />} />
      <Route path="/library/:slug" element={isAdmin ? <Navigate to="/admin" replace /> : <Library />} />
      <Route path="/room/:roomId?" element={isAdmin ? <Navigate to="/admin" replace /> : <Room />} />
      <Route path="/profile" element={isAdmin ? <Navigate to="/admin" replace /> : <Profile />} />
      <Route path="/profile/:userId" element={isAdmin ? <Navigate to="/admin" replace /> : <Profile />} />
      <Route path="/:handle" element={<HandleOrNotFound isAdmin={isAdmin} />} />
      <Route path="*" element={<NotFound isAdmin={isAdmin} />} />
    </Routes>
  )
}

function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </SocketProvider>
    </AuthProvider>
  )
}

export default App
