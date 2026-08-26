import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { composeBundle, type Product } from '@sba/core'
import { describe, expect, it, vi } from 'vitest'
import { LocalCatalogAdapter } from '../src/adapters/catalog.js'
import {
  deduplicateLenaldiProducts,
  LenaldiCatalogAdapter,
  normalizeLenaldiPage,
  parseLenaldiPrice,
} from '../src/adapters/lenaldi.js'

const fixture = (name: string): string => readFileSync(
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
  'utf8',
)
const adidasHtml = fixture('lenaldi-adidas.html')
const nikeHtml = fixture('lenaldi-nike.html')
const adidasPage = { brand: 'Adidas', path: 'adidas' }
const nikePage = { brand: 'Nike', path: 'nike' }
const adidasUrl = 'https://sites.google.com/view/lenaldi/zapatillas-brasilera/adidas'
const nikeUrl = 'https://sites.google.com/view/lenaldi/zapatillas-brasilera/nike'
const localCatalog: Product[] = [
  { id: 'local-demo', name: 'Producto local', category: 'limpieza', price: 1000, inStock: true, tags: [] },
]

describe('normalización Lenaldi', () => {
  it('extrae Adidas con marca, imagen, URL pública y enlace de pedido sin inventar stock o SKU', () => {
    const products = deduplicateLenaldiProducts(normalizeLenaldiPage(adidasHtml, adidasPage, adidasUrl))
    expect(products).toHaveLength(3)
    expect(products[0]).toMatchObject({
      brand: 'Adidas',
      category: 'zapatillas',
      source: 'lenaldi',
      productUrl: adidasUrl,
      orderUrl: 'https://wa.me/message/DEMO123',
    })
    expect(products[0].imageUrl).toMatch(/^https:\/\/images\.example\.test\//)
    expect(products[0].inStock).toBeUndefined()
    expect(products[0].skuId).toBeUndefined()
    expect(products[0].decisionSignals).toBeUndefined()
  })

  it('extrae Nike aunque el nombre esté en un encabezado', () => {
    const products = normalizeLenaldiPage(nikeHtml, nikePage, nikeUrl)
    expect(products.map((product) => product.name)).toContain('Nike LOW PANDA')
    expect(products.every((product) => product.brand === 'Nike')).toBe(true)
    expect(products.find((product) => product.name.includes('LOW PANDA'))?.imageUrl)
      .toBe('https://images.example.test/nike-low-panda.jpg')
  })

  it('normaliza precios compactos y con espacios', () => {
    expect(parseLenaldiPrice('$70000')).toBe(70000)
    expect(parseLenaldiPrice('$6 8 000')).toBe(68000)
    expect(parseLenaldiPrice('$72 000')).toBe(72000)
  })

  it('elimina duplicados exactos conservando una imagen válida', () => {
    const parsed = normalizeLenaldiPage(adidasHtml, adidasPage, adidasUrl)
    expect(parsed).toHaveLength(4)
    const products = deduplicateLenaldiProducts(parsed)
    expect(products.filter((product) => product.name === 'Adidas CAMPUS BROWN')).toHaveLength(1)
  })
})

describe('LenaldiCatalogAdapter', () => {
  const request = { category: 'zapatillas', preferences: ['nike'], requiredProducts: ['zapatillas'] }
  const responseForFixtures: typeof fetch = async (input) => new Response(
    String(input).endsWith('/nike') ? nikeHtml : adidasHtml,
    { status: 200, headers: { 'Content-Type': 'text/html' } },
  )

  it('usa una copia reciente en memoria y no repite consultas', async () => {
    const fetchFn = vi.fn(responseForFixtures)
    const adapter = new LenaldiCatalogAdapter(new LocalCatalogAdapter(localCatalog), {
      fetchFn,
      pages: [adidasPage, nikePage],
      cacheTtlSeconds: 900,
    })
    const first = await adapter.getCatalog(request)
    const second = await adapter.getCatalog(request)
    expect(first.source).toBe('lenaldi')
    expect(first.cacheHit).toBe(false)
    expect(second.cacheHit).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('usa fallback local ante timeout', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchFn: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })
    const adapter = new LenaldiCatalogAdapter(new LocalCatalogAdapter(localCatalog), {
      fetchFn,
      pages: [adidasPage],
      timeoutMs: 5,
    })
    const result = await adapter.getCatalog(request)
    expect(result.source).toBe('local-fallback')
    expect(result.products[0].id).toBe('local-demo')
    expect(result.fallbackReason).toBeTruthy()
    warning.mockRestore()
  })

  it('usa fallback local ante HTML inválido', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchFn: typeof fetch = async () => new Response('<html><body>sin tarjetas</body></html>', { status: 200 })
    const adapter = new LenaldiCatalogAdapter(new LocalCatalogAdapter(localCatalog), {
      fetchFn,
      pages: [nikePage],
    })
    const result = await adapter.getCatalog(request)
    expect(result.source).toBe('local-fallback')
    expect(result.fallbackReason).toContain('HTML inesperado')
    warning.mockRestore()
  })

  it('usa fallback local ante un error HTTP', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fetchFn: typeof fetch = async () => new Response('bloqueado', { status: 429 })
    const adapter = new LenaldiCatalogAdapter(new LocalCatalogAdapter(localCatalog), {
      fetchFn,
      pages: [adidasPage],
    })
    const result = await adapter.getCatalog(request)
    expect(result.source).toBe('local-fallback')
    expect(result.fallbackReason).toContain('HTTP 429')
    warning.mockRestore()
  })

  it('respeta presupuesto y permite una alternativa de la misma marca', () => {
    const products = deduplicateLenaldiProducts([
      ...normalizeLenaldiPage(adidasHtml, adidasPage, adidasUrl),
      ...normalizeLenaldiPage(nikeHtml, nikePage, nikeUrl),
    ])
    const baseRequest = {
      category: 'zapatillas',
      maxBudget: 75000,
      preferences: ['zapatillas'],
      requiredProducts: ['zapatillas'],
      preferredTags: ['nike'],
      strategy: 'balanced' as const,
    }
    const first = composeBundle(products, baseRequest, [])
    const alternative = composeBundle(products, {
      ...baseRequest,
      avoidedProducts: [first.items[0].id],
    }, [])
    expect(first.items).toHaveLength(1)
    expect(first.items[0].brand).toBe('Nike')
    expect(first.totalPrice).toBeLessThanOrEqual(75000)
    expect(alternative.items).toHaveLength(1)
    expect(alternative.items[0].brand).toBe('Nike')
    expect(alternative.items[0].id).not.toBe(first.items[0].id)
    expect(alternative.totalPrice).toBeLessThanOrEqual(75000)

    const quality = composeBundle(products, { ...baseRequest, strategy: 'quality-first' }, [])
    expect(quality.strategyNotice).toContain('no puede evaluarse')
    expect(quality.items.map((product) => product.id)).toEqual(first.items.map((product) => product.id))
  })
})
