import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Server } from 'node:http'
import { buildApp } from '../src/app.js'
import type { Product } from '@sba/core'

const catalog: Product[] = [
  { id: 'det-a', name: 'Detergente A', category: 'limpieza', price: 1200, inStock: false, tags: ['detergente'] },
  { id: 'det-b', name: 'Detergente B', category: 'limpieza', price: 1350, inStock: true, tags: ['detergente'] },
  { id: 'esponja', name: 'Esponja', category: 'limpieza', price: 650, inStock: true, tags: ['esponja'] },
  { id: 'trapo', name: 'Trapo', category: 'limpieza', price: 400, inStock: true, tags: ['trapo'] },
  { id: 'mouse', name: 'Mouse', category: 'tecnologia', price: 8000, inStock: true, tags: ['mouse'] },
  { id: 'nike-clara', name: 'Nike clara urbana', category: 'zapatillas', price: 69000, brand: 'Nike', inStock: undefined, tags: ['zapatillas', 'nike', 'clara', 'urbana'] },
  { id: 'adidas-negra', name: 'Adidas negra urbana', category: 'zapatillas', price: 70000, brand: 'Adidas', inStock: undefined, tags: ['zapatillas', 'adidas', 'negra', 'negras', 'urbana'] },
]

let server: Server
let baseUrl: string

beforeAll(() => {
  // sin GEMINI_API_KEY -> corre con el stub, determinístico y sin red.
  const app = buildApp(catalog, undefined, undefined, 'https://smart-bundle-ai.vercel.app')
  return new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      baseUrl = `http://127.0.0.1:${port}`
      resolve()
    })
  })
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe('GET /health', () => {
  it('lista las categorías y dice que la IA está apagada', async () => {
    const res = await fetch(`${baseUrl}/health`)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.categories).toEqual(['limpieza', 'tecnologia', 'zapatillas'])
    expect(body.aiEnabled).toBe(false)
    expect(body.geminiConfigured).toBe(false)
    expect(body.aiProvider).toBe('gemini')
    expect(body.catalogProvider).toBe('local')
  })
})

describe('GET /products', () => {
  it('expone el escaparate filtrado y los metadatos de origen', async () => {
    const res = await fetch(`${baseUrl}/products?category=limpieza&search=detergente`)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.products.map((product: { id: string }) => product.id)).toEqual(['det-a', 'det-b'])
    expect(body.catalog.source).toBe('local')
  })
})

describe('CORS', () => {
  it('permite el frontend configurado y responde el preflight', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://smart-bundle-ai.vercel.app' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://smart-bundle-ai.vercel.app')
    expect(res.headers.get('vary')).toContain('Origin')
  })

  it('mantiene habilitado localhost para desarrollo', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'http://localhost:5500' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5500')
  })

  it('rechaza un origen web no configurado', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'https://example.invalid' },
    })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Origen no permitido' })
  })
})

describe('landing servida por el backend', () => {
  it('expone la interfaz desde el mismo origen para despliegue HTTPS', async () => {
    const response = await fetch(`${baseUrl}/`)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(html).toContain('Smart Bundle AI')
    expect(html).toContain('app.js')
  })
})

describe('POST /bundle', () => {
  it('arma el combo con categoría y presupuesto explícitos', async () => {
    const res = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'limpieza', maxBudget: 2000 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bundle.totalPrice).toBeLessThanOrEqual(2000)
    expect(body.bundle.items.every((i: { category: string }) => i.category === 'limpieza')).toBe(true)
    expect(typeof body.explanation).toBe('string')
    expect(body.explanation.length).toBeGreaterThan(0)
    expect(body.usedAI).toBe(false)
    expect(body).toMatchObject({
      geminiConfigured: false,
      providerAttempted: false,
      providerSucceeded: false,
      fallbackUsed: false,
      intentSource: 'rules',
    })
    expect(body.catalog.source).toBe('local')
  })

  it('extrae categoría y presupuesto de freeText con el stub', async () => {
    const res = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ freeText: 'quiero limpieza, tengo $2000' }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.request.category).toBe('limpieza')
    expect(body.request.maxBudget).toBe(2000)
  })

  it('reinterpreta una repregunta manteniendo el contexto conversacional', async () => {
    const res = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'zapatillas',
        maxBudget: 80000,
        requiredProducts: ['zapatillas'],
        preferredTags: [],
        freeText: 'Ahora prefiero Adidas negras',
      }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.request.preferredTags).toEqual(expect.arrayContaining(['adidas', 'negras']))
    expect(body.bundle.items[0].id).toBe('adidas-negra')
    expect(body.bundle.totalPrice).toBeLessThanOrEqual(80000)
  })

  it('mantiene presupuesto, marca, color y uso a través de referencias multi-turn', async () => {
    const firstResponse = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ freeText: 'Tengo hasta $80.000 y quiero unas Nike claras para uso diario' }),
    })
    const first = await firstResponse.json()
    expect(firstResponse.status).toBe(200)
    expect(first.conversation.state).toMatchObject({
      budget: 80000,
      brand: 'nike',
      color: 'claras',
      useCase: 'uso diario',
    })
    expect(first.conversation.messages).toHaveLength(2)
    expect(first.conversation.messages[1]).toMatchObject({
      role: 'assistant',
      recommendationId: first.recommendationId,
      action: 'recommendation-generated',
    })

    const budgetResponse = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: first.conversationId, freeText: 'Ahora tengo $50.000' }),
    })
    const budgetTurn = await budgetResponse.json()
    expect(budgetResponse.status).toBe(200)
    expect(budgetTurn.conversation.state).toMatchObject({
      budget: 50000,
      brand: 'nike',
      color: 'claras',
      useCase: 'uso diario',
    })
    expect(budgetTurn.request.preferredTags).toEqual(expect.arrayContaining(['nike', 'claras', 'uso diario']))

    const referenceResponse = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: first.conversationId, freeText: 'Dame una cercana a ese precio' }),
    })
    const referenceTurn = await referenceResponse.json()
    expect(referenceResponse.status).toBe(200)
    expect(referenceTurn.request.maxBudget).toBe(50000)
    expect(referenceTurn.conversation.state.brand).toBe('nike')
    expect(referenceTurn.conversation.messages).toHaveLength(6)

    const relativeResponse = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: first.conversationId, freeText: 'Subí un poco el presupuesto, mantené esa marca' }),
    })
    const relativeTurn = await relativeResponse.json()
    expect(relativeResponse.status).toBe(200)
    expect(relativeTurn.request.maxBudget).toBe(55000)
    expect(relativeTurn.conversation.state.brand).toBe('nike')

    const historyResponse = await fetch(`${baseUrl}/conversations/${first.conversationId}`)
    const history = await historyResponse.json()
    expect(historyResponse.status).toBe(200)
    expect(history.messages).toHaveLength(8)
    expect(history.messages.map((message: { role: string }) => message.role)).toEqual([
      'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant',
    ])
  })

  it('cambia solo la preferencia indicada y evita la recomendación anterior al pedir otra opción', async () => {
    const initialResponse = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ freeText: 'Tengo $80.000, quiero Nike claras para uso diario' }),
    })
    const initial = await initialResponse.json()
    expect(initial.bundle.items[0].id).toBe('nike-clara')

    const brandResponse = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: initial.conversationId, freeText: 'Cambiá a Adidas negras' }),
    })
    const brandTurn = await brandResponse.json()
    expect(brandTurn.conversation.state).toMatchObject({
      budget: 80000,
      brand: 'adidas',
      color: 'negras',
      useCase: 'uso diario',
    })
    expect(brandTurn.request.preferredTags).not.toContain('nike')
    expect(brandTurn.request.preferredTags).not.toContain('claras')
    expect(brandTurn.bundle.items[0].id).toBe('adidas-negra')

    const alternativeResponse = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: initial.conversationId, freeText: 'Dame otra opción' }),
    })
    const alternative = await alternativeResponse.json()
    expect(alternativeResponse.status).toBe(200)
    expect(alternative.request.avoidedProducts).toContain('adidas-negra')
    expect(alternative.conversation.messages.at(-2).action).toBe('alternative-requested')
  })

  it('usa targetPrice para recomendar por cercanía y no como simple presupuesto máximo', async () => {
    const response = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ freeText: 'Quiero unas zapatillas cerca de $70.000' }),
    })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.conversation.state.priceIntent).toEqual({
      targetPrice: 70000,
      targetTolerancePercent: 10,
    })
    expect(body.conversation.state.budget).toBeUndefined()
    expect(body.commercialResponse.exactMatch).toBe(true)
    expect(body.bundle.items[0].id).toBe('adidas-negra')
    expect(body.bundle.items[0].price).toBe(70000)
    expect(body.explanation).toContain('$70.000')
  })

  it('mantiene contexto, rechaza la anterior y ofrece un trade-off grounded', async () => {
    const initialResponse = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ freeText: 'Tengo hasta $80.000 y quiero Nike claras para uso diario' }),
    })
    const initial = await initialResponse.json()
    expect(initial.bundle.items[0].id).toBe('nike-clara')

    const targetResponse = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: initial.conversationId,
        freeText: 'Quiero una de $70.000, no la de $69.000',
      }),
    })
    const target = await targetResponse.json()
    expect(targetResponse.status).toBe(200)
    expect(target.conversation.state).toMatchObject({
      budget: 80000,
      brand: 'nike',
      color: 'claras',
      useCase: 'uso diario',
      priceIntent: { budgetMax: 80000, targetPrice: 70000 },
    })
    expect(target.request.avoidedProducts).toContain('nike-clara')
    expect(target.commercialResponse.exactMatch).toBe(false)
    expect(target.commercialResponse.alternatives).toEqual(expect.arrayContaining([
      expect.objectContaining({ exact: true, product: expect.objectContaining({ id: 'adidas-negra' }) }),
    ]))
    expect(target.explanation).toContain('No encontré una opción exacta')
    expect(target.explanation).toContain('Adidas negra urbana')
    expect(target.bundle.items).toHaveLength(0)
  })

  it('devuelve 400 si no hay forma de determinar la categoría', async () => {
    const res = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxBudget: 2000 }),
    })
    expect(res.status).toBe(400)
  })

  it('devuelve 400 si no hay presupuesto', async () => {
    const res = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'limpieza' }),
    })
    expect(res.status).toBe(400)
  })

  it('la sustitución llega hasta la respuesta HTTP', async () => {
    const res = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'limpieza', maxBudget: 5000, preferences: ['detergente'] }),
    })
    const body = await res.json()
    expect(body.bundle.substitutions).toHaveLength(1)
    expect(body.bundle.substitutions[0].replacement.id).toBe('det-b')
    expect(body.bundle.items.some((item: { id: string }) => item.id === 'det-b')).toBe(true)
  })

  it('aplica requeridos, preferencias y exclusiones estructuradas', async () => {
    const res = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'limpieza',
        maxBudget: 2000,
        requiredProducts: ['detergente'],
        preferredTags: ['esponja'],
        avoidedProducts: ['esponja'],
      }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.request.requiredProducts).toEqual(['detergente'])
    expect(body.bundle.items.some((item: { id: string }) => item.id === 'det-b')).toBe(true)
    expect(body.bundle.items.some((item: { id: string }) => item.id === 'esponja')).toBe(false)
    expect(body.bundle.totalPrice).toBeLessThanOrEqual(2000)
  })

  it('conecta estrategia y desglose de politicas comerciales en la respuesta', async () => {
    const res = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'limpieza', maxBudget: 3000, strategy: 'maximize-budget' }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.request.strategy).toBe('maximize-budget')
    expect(body.bundle.strategy).toBe('maximize-budget')
    expect(body.bundle.pricing).toMatchObject({
      observedSubtotal: 2400,
      smartBundleDemoBenefit: 120,
      finalTotal: 2280,
      remainingBudget: 720,
    })
    expect(body.bundle.commercialPolicy.label).toBe('Políticas comerciales de demostración')
    expect(body.bundle.totalPrice).toBe(body.bundle.pricing.finalTotal)
  })
})
