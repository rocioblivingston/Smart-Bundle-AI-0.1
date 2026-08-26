import { normalizeSearchText, type Product } from '@sba/core'
import type { CatalogAdapter, CatalogRequest, CatalogResult } from './catalog.js'
import { LocalCatalogAdapter } from './catalog.js'

export const LENALDI_BASE_URL = 'https://sites.google.com/view/lenaldi/zapatillas-brasilera'
export const LENALDI_CATALOG_LABEL = 'Catálogo: Lenaldi — datos públicos del sitio'

export interface LenaldiPage {
  brand: string
  path: string
}

export const LENALDI_PAGES: LenaldiPage[] = [
  { brand: 'Adidas', path: 'adidas' },
  { brand: 'New Balance', path: 'new-balance' },
  { brand: 'Nike', path: 'nike' },
  { brand: 'Puma', path: 'puma' },
  { brand: 'Vans', path: 'vans' },
]

export interface LenaldiCatalogAdapterOptions {
  baseUrl?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
  cacheTtlSeconds?: number
  pages?: LenaldiPage[]
  now?: () => number
}

interface CacheEntry {
  products: Product[]
  expiresAt: number
}

const CARD_MARKER = /<div\s+class=["']JNdkSc-SmKAyb LkDMRd["']>/i

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&', quot: '"', apos: "'", '#39': "'", lt: '<', gt: '>', nbsp: ' ',
  }
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    const normalized = code.toLowerCase()
    if (normalized.startsWith('#x')) return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16))
    if (normalized.startsWith('#')) return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10))
    return named[normalized] ?? entity
  })
}

function textContent(html: string): string {
  return decodeHtml(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

export function parseLenaldiPrice(value: string): number | undefined {
  if (!value.includes('$')) return undefined
  const digits = value.replace(/[^\d]/g, '')
  if (!digits) return undefined
  const price = Number(digits)
  return Number.isFinite(price) && price > 0 ? price : undefined
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))
  return match ? decodeHtml(match[1]) : undefined
}

function directOrderUrl(href: string): string {
  try {
    const url = new URL(href, LENALDI_BASE_URL)
    return url.hostname === 'www.google.com' && url.pathname === '/url'
      ? url.searchParams.get('q') ?? url.toString()
      : url.toString()
  } catch {
    return href
  }
}

function orderUrlFrom(html: string): string | undefined {
  const links = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? []
  const orderLink = links.find((link) => /hace\s+tu\s+pedido/i.test(textContent(link)))
  const openingTag = orderLink?.match(/<a\b[^>]*>/i)?.[0]
  const href = openingTag ? attribute(openingTag, 'href') : undefined
  return href ? directOrderUrl(href) : undefined
}

function slug(value: string): string {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72)
}

function hash(value: string): string {
  let result = 2166136261
  for (const character of value) {
    result ^= character.charCodeAt(0)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(36)
}

function descriptiveTags(brand: string, name: string): string[] {
  const normalized = normalizeSearchText(name)
  const tags = new Set(['zapatilla', 'zapatillas', normalizeSearchText(brand)])
  for (const part of normalized.split(/[^a-z0-9]+/).filter((value) => value.length > 2)) tags.add(part)

  const lightColors = ['white', 'blanco', 'blanca', 'crema', 'nude', 'rosa', 'rose', 'celeste', 'lila', 'gris']
  const darkColors = ['black', 'negro', 'negra', 'marron', 'chocolate', 'bordo']
  if (lightColors.some((color) => normalized.includes(color))) {
    for (const value of ['claro', 'clara', 'claras', 'color claro']) tags.add(value)
  }
  if (darkColors.some((color) => normalized.includes(color))) {
    for (const value of ['negro', 'negra', 'negras', 'black', 'oscuro', 'oscura', 'oscuras', 'color oscuro']) tags.add(value)
  }
  return [...tags]
}

/**
 * Parsea una página pública de Google Sites. El ID generado es únicamente
 * interno y estable; no representa SKU ni stock del retailer.
 */
export function normalizeLenaldiPage(html: string, page: LenaldiPage, pageUrl: string): Product[] {
  if (!/<html\b/i.test(html) || !CARD_MARKER.test(html)) {
    throw new Error(`${page.brand}: HTML inesperado`)
  }

  const orderUrl = orderUrlFrom(html)
  const fragments = html.split(CARD_MARKER).slice(1)
  const products: Product[] = []

  for (const fragment of fragments) {
    const imageTag = fragment.match(/<img\b[^>]*>/i)?.[0]
    const imageUrl = imageTag ? attribute(imageTag, 'src') : undefined
    if (!imageUrl) continue

    const visibleBlocks = [...fragment.matchAll(/<(p|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)]
      .map((match) => textContent(match[2]))
      .filter(Boolean)
    const priceIndex = visibleBlocks.findIndex((value) => parseLenaldiPrice(value) != null)
    if (priceIndex <= 0) continue

    const rawName = visibleBlocks.slice(0, priceIndex).find((value) => !/hace\s+tu\s+pedido/i.test(value))
    const price = parseLenaldiPrice(visibleBlocks[priceIndex])
    if (!rawName || !price) continue

    const name = normalizeSearchText(rawName).startsWith(normalizeSearchText(page.brand))
      ? rawName
      : `${page.brand} ${rawName}`
    const identity = `${normalizeSearchText(page.brand)}|${normalizeSearchText(rawName)}|${price}`
    products.push({
      id: `lenaldi-${slug(`${page.brand}-${rawName}`)}-${hash(identity)}`,
      name,
      brand: page.brand,
      category: 'zapatillas',
      price,
      inStock: undefined,
      tags: descriptiveTags(page.brand, rawName),
      imageUrl,
      productUrl: pageUrl,
      orderUrl,
      source: 'lenaldi',
    })
  }

  if (products.length === 0) throw new Error(`${page.brand}: HTML sin productos reconocibles`)
  return products
}

export function deduplicateLenaldiProducts(products: Product[]): Product[] {
  const unique = new Map<string, Product>()
  for (const product of products) {
    const key = `${normalizeSearchText(product.brand ?? '')}|${normalizeSearchText(product.name)}|${product.price}`
    if (!unique.has(key)) unique.set(key, product)
  }
  return [...unique.values()].sort((left, right) =>
    (left.brand ?? '').localeCompare(right.brand ?? '') ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id),
  )
}

export class LenaldiCatalogAdapter implements CatalogAdapter {
  readonly provider = 'lenaldi' as const
  private readonly baseUrl: string
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number
  private readonly cacheTtlMs: number
  private readonly pages: LenaldiPage[]
  private readonly now: () => number
  private cache?: CacheEntry

  constructor(private readonly fallback: LocalCatalogAdapter, options: LenaldiCatalogAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? LENALDI_BASE_URL).replace(/\/$/, '')
    this.fetchFn = options.fetchFn ?? fetch
    this.timeoutMs = Math.max(1, options.timeoutMs ?? 8_000)
    this.cacheTtlMs = Math.max(0, options.cacheTtlSeconds ?? 900) * 1_000
    this.pages = options.pages ?? LENALDI_PAGES
    this.now = options.now ?? Date.now
  }

  categories(): string[] { return ['zapatillas'] }

  private result(products: Product[], request: CatalogRequest, cacheHit: boolean, fallbackReason?: string): CatalogResult {
    return {
      products: products.map((product) => ({ ...product, tags: [...product.tags] })),
      provider: this.provider,
      source: 'lenaldi',
      label: LENALDI_CATALOG_LABEL,
      searchTerm: [...new Set([...(request.requiredProducts ?? []), ...request.preferences])].join(', ') || undefined,
      fallbackReason,
      cacheHit,
    }
  }

  async getCatalog(request: CatalogRequest): Promise<CatalogResult> {
    const now = this.now()
    if (this.cache && now < this.cache.expiresAt) return this.result(this.cache.products, request, true)

    try {
      const attempts = await Promise.allSettled(this.pages.map(async (page) => {
        const pageUrl = `${this.baseUrl}/${page.path}`
        const response = await this.fetchFn(pageUrl, {
          headers: { Accept: 'text/html,application/xhtml+xml' },
          signal: AbortSignal.timeout(this.timeoutMs),
        })
        if (!response.ok) throw new Error(`${page.brand}: HTTP ${response.status}`)
        const html = await response.text()
        return normalizeLenaldiPage(html, page, pageUrl)
      }))
      const products = deduplicateLenaldiProducts(attempts
        .filter((attempt): attempt is PromiseFulfilledResult<Product[]> => attempt.status === 'fulfilled')
        .flatMap((attempt) => attempt.value))
      if (products.length === 0) {
        const reasons = attempts
          .filter((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected')
          .map((attempt) => attempt.reason instanceof Error ? attempt.reason.message : 'error desconocido')
        throw new Error(reasons.join('; ') || 'HTML sin productos reconocibles')
      }
      this.cache = { products, expiresAt: now + this.cacheTtlMs }
      return this.result(products, request, false)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'error desconocido'
      if (this.cache?.products.length) {
        console.warn(`Catalogo Lenaldi no disponible (${reason}); usando la ultima copia en memoria.`)
        return this.result(this.cache.products, request, true, reason)
      }
      const local = await this.fallback.getCatalog(request)
      console.warn(`Catalogo Lenaldi no disponible (${reason}); usando fallback local.`)
      return {
        ...local,
        provider: this.provider,
        source: 'local-fallback',
        label: 'Catálogo local (fallback de Lenaldi)',
        fallbackReason: reason,
        cacheHit: false,
      }
    }
  }
}
