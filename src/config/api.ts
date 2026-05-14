const LOCAL_API_ORIGIN = 'http://localhost:3001'

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, '')
}

function resolveBrowserOrigin(): string {
  if (typeof window === 'undefined') {
    return LOCAL_API_ORIGIN
  }

  return window.location.origin
}

export const API_ORIGIN = normalizeOrigin(
  import.meta.env.VITE_API_ORIGIN || (import.meta.env.DEV ? LOCAL_API_ORIGIN : resolveBrowserOrigin())
)

export const API_URL = `${API_ORIGIN}/api`
export const SOCKET_URL = normalizeOrigin(import.meta.env.VITE_SOCKET_URL || API_ORIGIN)
