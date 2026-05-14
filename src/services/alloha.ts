import { API_URL } from '../config/api'

export interface Balancer {
  id: string
  name: string
  description: string
}

export const DEFAULT_BALANCER_ID = 'vidsrc-vip'

export function buildEmbedUrl(imdbId: string, balancerId: string = DEFAULT_BALANCER_ID): string {
  const normalizedImdbId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`
  const url = new URL(`${API_URL}/embed/source`)
  url.searchParams.set('imdbId', normalizedImdbId)
  url.searchParams.set('balancerId', balancerId)
  return url.toString()
}

export async function fetchBalancers(): Promise<Balancer[]> {
  const response = await fetch(`${API_URL}/embed/balancers`)

  if (!response.ok) {
    throw new Error(`Embed balancers error: ${response.status}`)
  }

  const data = await response.json() as { balancers?: Balancer[] }
  return data.balancers || []
}
