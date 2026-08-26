import type { Product } from '@sba/core'
import type { CatalogAdapter, CatalogRequest, CatalogResult } from './catalog.js'
import { LocalCatalogAdapter } from './catalog.js'

const CARREFOUR_SEARCH_ENDPOINT = 'https://www.carrefour.com.ar/api/catalog_system/pub/products/search'
const CATEGORY_SEARCH_TERMS: Record<string, string> = {
  limpieza: 'limpieza',
  tecnologia: 'tecnologia',
  'cuidado-personal': 'cuidado personal',
}

interface VtexOffer {
  Price?: number
  ListPrice?: number
  AvailableQuantity?: number
  IsAvailable?: boolean
}
interface VtexSeller {
  sellerId?: string
  sellerName?: string
  sellerDefault?: boolean
  commertialOffer?: VtexOffer
}
interface VtexImage { imageUrl?: string }
interface VtexItem {
  itemId?: string
  name?: string
  nameComplete?: string
  images?: VtexImage[]
  sellers?: VtexSeller[]
}
export interface VtexProduct {
  productId?: string
  productName?: string
  brand?: string
  link?: string
  linkText?: string
  categories?: string[]
  items?: VtexItem[]
}
export interface VtexCatalogAdapterOptions {
  endpoint?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
  pageSize?: number
}

function money(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.round(value * 100) / 100
}

function absoluteProductUrl(link: string | undefined, linkText: string | undefined): string | undefined {
  const candidate = link?.trim() || (linkText ? `/${linkText.replace(/^\/+/, '')}/p` : '')
  if (!candidate) return undefined
  try {
    return new URL(candidate, 'https://www.carrefour.com.ar').toString()
  } catch {
    return undefined
  }
}

function chooseSeller(sellers: VtexSeller[] = []): VtexSeller | undefined {
  return [...sellers].sort((left, right) => {
    const leftOffer = left.commertialOffer
    const rightOffer = right.commertialOffer
    const leftAvailable = Boolean(leftOffer?.IsAvailable && (leftOffer.AvailableQuantity ?? 0) > 0 && (leftOffer.Price ?? 0) > 0)
    const rightAvailable = Boolean(rightOffer?.IsAvailable && (rightOffer.AvailableQuantity ?? 0) > 0 && (rightOffer.Price ?? 0) > 0)
    if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1
    if (Boolean(left.sellerDefault) !== Boolean(right.sellerDefault)) return left.sellerDefault ? -1 : 1
    const priceDifference = (leftOffer?.Price ?? Number.MAX_SAFE_INTEGER) - (rightOffer?.Price ?? Number.MAX_SAFE_INTEGER)
    if (priceDifference !== 0) return priceDifference
    return (left.sellerId ?? '').localeCompare(right.sellerId ?? '')
  })[0]
}

/** Convierte cada SKU VTEX al contrato puro consumido por el optimizador. */
export function normalizeVtexProducts(products: VtexProduct[], category: string): Product[] {
  const normalized: Product[] = []
  for (const product of products) {
    for (const item of product.items ?? []) {
      if (!item.itemId) continue
      const seller = chooseSeller(item.sellers)
      const offer = seller?.commertialOffer
      const price = money(offer?.Price)
      const listPriceValue = money(offer?.ListPrice)
      const hasPromotion = listPriceValue > price && price > 0
      const quantity = Math.max(0, Math.trunc(offer?.AvailableQuantity ?? 0))
      const name = item.nameComplete?.trim() || item.name?.trim() || product.productName?.trim()
      if (!name) continue

      const tags = new Set<string>()
      if (product.brand) tags.add(product.brand.toLowerCase())
      for (const externalCategory of product.categories ?? []) {
        for (const part of externalCategory.split('/').map((value) => value.trim()).filter(Boolean)) {
          tags.add(part.toLowerCase())
        }
      }
      normalized.push({
        id: item.itemId,
        productId: product.productId,
        skuId: item.itemId,
        name,
        category,
        price,
        listPrice: hasPromotion ? listPriceValue : undefined,
        promotionalPrice: hasPromotion ? price : undefined,
        inStock: Boolean(offer?.IsAvailable && quantity > 0 && price > 0),
        availableQuantity: quantity,
        seller: seller?.sellerName || seller?.sellerId,
        imageUrl: item.images?.find((image) => image.imageUrl)?.imageUrl,
        productUrl: absoluteProductUrl(product.link, product.linkText),
        tags: [...tags],
        source: 'vtex',
      })
    }
  }
  return [...new Map(normalized.map((product) => [product.id, product])).values()]
}

function searchTermFor(request: CatalogRequest): string {
  const explicit = [...(request.requiredProducts ?? []), ...request.preferences]
    .map((value) => value.trim())
    .find(Boolean)
  return (explicit ?? CATEGORY_SEARCH_TERMS[request.category] ?? request.category).slice(0, 120)
}

export class VtexCatalogAdapter implements CatalogAdapter {
  readonly provider = 'vtex' as const
  private readonly endpoint: string
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number
  private readonly pageSize: number

  constructor(private readonly fallback: LocalCatalogAdapter, options: VtexCatalogAdapterOptions = {}) {
    this.endpoint = (options.endpoint ?? CARREFOUR_SEARCH_ENDPOINT).replace(/\/$/, '')
    this.fetchFn = options.fetchFn ?? fetch
    this.timeoutMs = options.timeoutMs ?? 8_000
    this.pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 50)
  }

  categories(): string[] { return this.fallback.categories() }

  async getCatalog(request: CatalogRequest): Promise<CatalogResult> {
    const primarySearchTerm = searchTermFor(request)
    const searchTerms = [...new Set(
      (request.searchTerms?.length ? request.searchTerms : [primarySearchTerm])
        .map((term) => term.trim().slice(0, 120))
        .filter(Boolean),
    )].slice(0, 4)

    try {
      const attempts = await Promise.allSettled(searchTerms.map(async (searchTerm) => {
        const url = `${this.endpoint}/${encodeURIComponent(searchTerm)}?_from=0&_to=${this.pageSize - 1}`
        const response = await this.fetchFn(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
        })
        if (!response.ok) throw new Error(`${searchTerm}: HTTP ${response.status}`)
        const payload: unknown = await response.json()
        if (!Array.isArray(payload)) throw new Error(`${searchTerm}: respuesta VTEX invalida`)
        return payload as VtexProduct[]
      }))
      const successfulPayloads = attempts
        .filter((attempt): attempt is PromiseFulfilledResult<VtexProduct[]> => attempt.status === 'fulfilled')
        .flatMap((attempt) => attempt.value)
      if (!attempts.some((attempt) => attempt.status === 'fulfilled')) {
        const reasons = attempts
          .filter((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected')
          .map((attempt) => attempt.reason instanceof Error ? attempt.reason.message : 'error desconocido')
        throw new Error(reasons.join('; ') || 'VTEX no disponible')
      }

      return {
        products: normalizeVtexProducts(successfulPayloads, request.category),
        provider: this.provider,
        source: 'vtex',
        label: 'Carrefour Argentina / VTEX',
        searchTerm: searchTerms.join(', '),
      }
    } catch (error) {
      const local = await this.fallback.getCatalog(request)
      const reason = error instanceof Error ? error.message : 'error desconocido'
      console.warn(`Catalogo VTEX no disponible (${reason}); usando fallback local.`)
      return {
        ...local,
        provider: this.provider,
        source: 'local-fallback',
        label: 'Catalogo local (fallback de Carrefour / VTEX)',
        searchTerm: searchTerms.join(', '),
        fallbackReason: reason,
      }
    }
  }
}
