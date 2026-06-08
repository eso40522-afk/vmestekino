// Helpers for building / parsing movie page slugs like:
//   the-mummy-2026-12345
// Format: <slugified-title>-<year>-<tmdbId>
// The TMDB id is ALWAYS the last numeric segment, so parsing is unambiguous
// even if the title itself contains numbers (e.g. "blade-runner-2049-2017-335984").

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
}

function transliterate(input: string): string {
  return input
    .toLowerCase()
    .split('')
    .map(ch => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join('')
}

function slugify(input: string): string {
  return transliterate(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export interface MovieSlugInput {
  id: number | string
  title?: string | null
  originalTitle?: string | null
  /** Either a TMDB date "YYYY-MM-DD" or a plain year. */
  year?: string | number | null
}

export function buildMovieSlug({ id, title, originalTitle, year }: MovieSlugInput): string {
  const base = (originalTitle?.trim() || title?.trim() || '')
  const titlePart = slugify(base)
  const yearStr = year != null ? String(year).slice(0, 4) : ''
  const yearPart = /^\d{4}$/.test(yearStr) ? yearStr : ''
  const head = [titlePart, yearPart].filter(Boolean).join('-')
  return head ? `${head}-${id}` : String(id)
}

/** Extracts the trailing numeric id from a slug. Returns null if absent. */
export function parseMovieIdFromSlug(slug: string | undefined | null): number | null {
  if (!slug) return null
  const match = /(\d+)$/.exec(slug.trim())
  if (!match) return null
  const id = Number(match[1])
  return Number.isFinite(id) && id > 0 ? id : null
}
