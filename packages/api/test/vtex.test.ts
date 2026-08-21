import { describe, expect, it, vi } from 'vitest'
import { composeBundle, type Product } from '@sba/core'
import { LocalCatalogAdapter } from '../src/adapters/catalog.js'
import { normalizeVtexProducts, VtexCatalogAdapter, type VtexProduct } from '../src/adapters/vtex.js'

const vtexResponse: VtexProduct[] = [
  {
    productId: 'product-100',
    productName: 'Detergente limón',
    brand: 'Marca Demo',
    link: '/detergente-limon/p',
    categories: ['/Limpieza/Detergentes/'],
    items: [
      {
        itemId: 'sku-100',
        nameComplete: 'Detergente limón 500 ml',
        images: [{ imageUrl: 'https://example.test/detergente.jpg' }],
        sellers: [
          {
            sellerId: 'seller-no-stock',
            sellerName: 'Sin stock',
            sellerDefault: true,
            commertialOffer: {
              Price: 2000,
              ListPrice: 2000,
              AvailableQuantity: 0,
              IsAvailable: false,
            },
          },
          {
            sellerId: 'carrefour',
            sellerName: 'Carrefour',
            commertialOffer: {
              Price: 2499.9,
              ListPrice: 2999.9,
              AvailableQuantity: 8,
              IsAvailable: true,
            },
          },
        ],
      },
      {
        itemId: 'sku-101',
        nameComplete: 'Detergente concentrado 300 ml',
        sellers: [
          {
            sellerId: 'carrefour',
            sellerName: 'Carrefour',
            sellerDefault: true,
            commertialOffer: {
              Price: 1800.25,
              ListPrice: 1800.25,
              AvailableQuantity: 3,
              IsAvailable: true,
            },
          },
        ],
      },
    ],
  },
]

const localCatalog: Product[] = [
  {
    id: 'local-detergente',
    name: 'Detergente local',
    category: 'limpieza',
    price: 900,
    inStock: true,
    tags: ['detergente'],
  },
]

describe('normalizeVtexProducts', () => {
  it('normaliza SKU, precio, promoción, vendedor, stock, imagen y enlace', () => {
    const products = normalizeVtexProducts(vtexResponse, 'limpieza')
    expect(products).toHaveLength(2)
    expect(products[0]).toMatchObject({
      id: 'sku-100',
      productId: 'product-100',
      skuId: 'sku-100',
      name: 'Detergente limón 500 ml',
      category: 'limpieza',
      price: 2499.9,
      listPrice: 2999.9,
      promotionalPrice: 2499.9,
      seller: 'Carrefour',
      inStock: true,
      availableQuantity: 8,
      imageUrl: 'https://example.test/detergente.jpg',
      productUrl: 'https://www.carrefour.com.ar/detergente-limon/p',
      source: 'vtex',
    })
    expect(products[0].tags).toEqual(expect.arrayContaining(['marca demo', 'limpieza', 'detergentes']))
  })

  it('permite armar un combo real respetando presupuesto aun con centavos', () => {
    const products = normalizeVtexProducts(vtexResponse, 'limpieza')
    const bundle = composeBundle(products, 'limpieza', 5000, ['detergente'])
    expect(bundle.items).toHaveLength(2)
    expect(bundle.totalPrice).toBe(4300.15)
    expect(bundle.totalPrice).toBeLessThanOrEqual(5000)
  })
})

describe('VtexCatalogAdapter', () => {
  it('busca la preferencia explicita en Carrefour y devuelve origen VTEX', async () => {
    let requestedUrl = ''
    const fetchFn: typeof fetch = async (input) => {
      requestedUrl = String(input)
      return new Response(JSON.stringify(vtexResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const adapter = new VtexCatalogAdapter(new LocalCatalogAdapter(localCatalog), { fetchFn })

    const result = await adapter.getCatalog({ category: 'limpieza', preferences: ['detergente'] })

    expect(requestedUrl).toContain('/api/catalog_system/pub/products/search/detergente')
    expect(result.source).toBe('vtex')
    expect(result.searchTerm).toBe('detergente')
    expect(result.products[0].source).toBe('vtex')
  })

  it('usa catalog.json como fallback si VTEX no responde', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchFn: typeof fetch = async () => {
      throw new Error('VTEX fuera de servicio')
    }
    const adapter = new VtexCatalogAdapter(new LocalCatalogAdapter(localCatalog), { fetchFn })

    const result = await adapter.getCatalog({ category: 'limpieza', preferences: ['detergente'] })

    expect(result.provider).toBe('vtex')
    expect(result.source).toBe('local-fallback')
    expect(result.products[0]).toMatchObject({ id: 'local-detergente', source: 'local' })
    expect(result.fallbackReason).toContain('VTEX fuera de servicio')
    warning.mockRestore()
  })
})
