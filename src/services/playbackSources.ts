import { API_URL } from '../config/api'

export type PlaybackSourceType = 'html5' | 'youtube' | 'embed' | 'rutube' | 'vkvideo'

export interface PlaybackSource {
  tmdbId: string
  imdbId: string | null
  sourceType: PlaybackSourceType
  sourceUrl: string
  dubLanguage: string
  dubType: string
  title: string
}

export async function resolvePlaybackSource(tmdbId: number, imdbId?: string | null): Promise<PlaybackSource | null> {
  const url = new URL(`${API_URL}/video-sources/resolve`)
  url.searchParams.set('tmdbId', String(tmdbId))
  if (imdbId) {
    url.searchParams.set('imdbId', imdbId)
  }

  const response = await fetch(url.toString())
  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Playback source error: ${response.status}`)
  }

  const data = await response.json() as { source?: PlaybackSource }
  return data.source || null
}

export async function upsertPlaybackSource(source: {
  tmdbId: number
  imdbId?: string | null
  sourceType: PlaybackSourceType
  sourceUrl: string
  dubLanguage?: string
  dubType?: string
  title?: string
  isActive?: boolean
}): Promise<PlaybackSource> {
  const response = await fetch(`${API_URL}/video-sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source)
  })

  if (!response.ok) {
    throw new Error(`Playback source save error: ${response.status}`)
  }

  const data = await response.json() as { source?: PlaybackSource }
  if (!data.source) {
    throw new Error('Playback source save error: empty response')
  }

  return data.source
}