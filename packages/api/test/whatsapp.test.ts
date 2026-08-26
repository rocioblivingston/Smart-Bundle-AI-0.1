import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import type { Product } from '@sba/core'
import { buildApp } from '../src/app.js'
import { createWhatsAppHandoff } from '../src/whatsapp.js'

const product: Product = {
  id: 'nike-air-force-lila',
  name: 'Nike AIR FORCE LILA',
  category: 'zapatillas',
  brand: 'Nike',
  price: 79000,
  inStock: undefined,
  tags: ['zapatillas', 'nike', 'claras', 'uso diario'],
  source: 'lenaldi',
}

let server: Server
let baseUrl: string

beforeAll(() => {
  const app = buildApp([product], undefined, '5491178236492')
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

describe('handoff comercial a WhatsApp', () => {
  it('prefilla texto solo en destinos que lo soportan', () => {
    const handoff = createWhatsAppHandoff('https://wa.me/5491112345678', 'SBA-R-TEST', [product])
    expect(handoff?.prefillSupported).toBe(true)
    expect(handoff?.url).toContain('text=')
    expect(handoff?.message).toContain('Nike AIR FORCE LILA')
    expect(handoff?.message).toContain('$79.000')
    expect(handoff?.message).not.toMatch(/stock|talle|descuento|disponible/i)
  })

  it('acepta la recomendación, prepara el carrito y registra la trazabilidad completa', async () => {
    const recommendationResponse = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'zapatillas',
        maxBudget: 80000,
        requiredProducts: ['zapatillas'],
        preferredTags: ['nike', 'claras', 'uso diario'],
      }),
    })
    const recommendation = await recommendationResponse.json()
    expect(recommendationResponse.status).toBe(200)
    expect(recommendation.bundle.items[0].id).toBe(product.id)

    const acceptanceResponse = await fetch(`${baseUrl}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: recommendation.conversationId,
        freeText: 'me quedo con ese',
      }),
    })
    const acceptance = await acceptanceResponse.json()
    expect(acceptanceResponse.status).toBe(200)
    expect(acceptance).toMatchObject({
      accepted: true,
      recommendationId: recommendation.recommendationId,
      cart: { total: 79000 },
      whatsappHandoff: {
        prefillSupported: true,
      },
    })
    const whatsappUrl = new URL(acceptance.whatsappHandoff.url)
    expect(whatsappUrl.hostname).toBe('wa.me')
    expect(whatsappUrl.pathname).toBe('/5491178236492')
    expect(whatsappUrl.searchParams.get('text')).toBe(acceptance.whatsappHandoff.message)
    expect(acceptance.whatsappHandoff.message).toContain(recommendation.recommendationId)

    const beforeClick = await (await fetch(`${baseUrl}/conversations/${recommendation.conversationId}`)).json()
    expect(beforeClick.events.map((event: { event: string }) => event.event)).toEqual([
      'recommendation_created',
      'recommendation_accepted',
      'whatsapp_handoff_created',
    ])

    const clickResponse = await fetch(`${baseUrl}/conversations/${recommendation.conversationId}/whatsapp-click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recommendationId: recommendation.recommendationId }),
    })
    expect(clickResponse.status).toBe(204)

    const afterClick = await (await fetch(`${baseUrl}/conversations/${recommendation.conversationId}`)).json()
    expect(afterClick.events.at(-1)).toMatchObject({
      event: 'whatsapp_handoff_clicked',
      conversationId: recommendation.conversationId,
      recommendationId: recommendation.recommendationId,
      products: [{ id: product.id, name: product.name, price: product.price }],
      total: 79000,
    })
    expect(Number.isNaN(Date.parse(afterClick.events.at(-1).timestamp))).toBe(false)
  })
})
