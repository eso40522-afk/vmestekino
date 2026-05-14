import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { SocketProvider } from './contexts/SocketContext'
import { useAuth } from './contexts/AuthContext'
import Home from './pages/Home'
import Room from './pages/Room'
import Rooms from './pages/Rooms'
import Profile from './pages/Profile'
import Login from './pages/Login'
import Register from './pages/Register'
import AdminPanel from './pages/AdminPanel'
import NotFound from './pages/NotFound'
import './App.css'

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
      <Route path="/room/:roomId?" element={isAdmin ? <Navigate to="/admin" replace /> : <Room />} />
      <Route path="/profile" element={isAdmin ? <Navigate to="/admin" replace /> : <Profile />} />
      <Route path="/profile/:userId" element={isAdmin ? <Navigate to="/admin" replace /> : <Profile />} />
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
