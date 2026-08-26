import { categoriesOf, type Product } from '@sba/core'

export type CatalogProviderName = 'local' | 'vtex' | 'lenaldi'
export type CatalogSource = 'local' | 'local-fallback' | 'vtex' | 'lenaldi'

export interface CatalogRequest {
  category: string
  preferences: string[]
  requiredProducts?: string[]
  searchTerms?: string[]
}

export interface CatalogResult {
  products: Product[]
  provider: CatalogProviderName
  source: CatalogSource
  label: string
  searchTerm?: string
  fallbackReason?: string
  cacheHit?: boolean
}

export interface CatalogAdapter {
  readonly provider: CatalogProviderName
  categories(): string[]
  getCatalog(request: CatalogRequest): Promise<CatalogResult>
}

/** Adaptador del catálogo histórico: fallback y modo local explícito. */
export class LocalCatalogAdapter implements CatalogAdapter {
  readonly provider = 'local' as const

  constructor(private readonly catalog: Product[]) {}

  categories(): string[] {
    return categoriesOf(this.catalog)
  }

  async getCatalog(_request?: CatalogRequest): Promise<CatalogResult> {
    return {
      products: this.catalog.map((product) => ({ ...product, source: product.source ?? 'local' })),
      provider: this.provider,
      source: 'local',
      label: 'Catálogo local de demostración',
    }
  }
}
