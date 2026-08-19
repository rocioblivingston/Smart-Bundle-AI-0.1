import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Server } from 'node:http'
import { buildApp } from '../src/app.js'
import type { Product } from '@sba/core'

const catalog: Product[] = [
  { id: 'det-a', name: 'Detergente A', category: 'limpieza', price: 1200, inStock: false, tags: ['detergente'] },
  { id: 'det-b', name: 'Detergente B', category: 'limpieza', price: 1350, inStock: true, tags: ['detergente'] },
  { id: 'esponja', name: 'Esponja', category: 'limpieza', price: 650, inStock: true, tags: ['esponja'] },
  { id: 'mouse', name: 'Mouse', category: 'tecnologia', price: 8000, inStock: true, tags: ['mouse'] },
]

let server: Server
let baseUrl: string

beforeAll(() => {
  // sin ANTHROPIC_API_KEY -> corre con el stub, determinístico y sin red.
  const app = buildApp(catalog, undefined)
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
    expect(body.categories).toEqual(['limpieza', 'tecnologia'])
    expect(body.aiEnabled).toBe(false)
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
  })
})
