import { describe, it, expect } from 'vitest'
import { StubIntentParser, StubExplainer } from '../../src/agent/stub.js'
import type { Bundle, BundleRequest } from '../../src/types.js'

const categories = ['limpieza', 'tecnologia', 'cuidado-personal']

describe('StubIntentParser', () => {
  const parser = new StubIntentParser()

  it('detecta la categoría por palabra clave', async () => {
    const intent = await parser.parse('quiero armar un combo de limpieza', categories)
    expect(intent.category).toBe('limpieza')
  })

  it('extrae el presupuesto con símbolo $', async () => {
    const intent = await parser.parse('tengo $5000 para gastar', categories)
    expect(intent.maxBudget).toBe(5000)
  })

  it('extrae el presupuesto escrito en pesos', async () => {
    const intent = await parser.parse('mi presupuesto es 3500 pesos', categories)
    expect(intent.maxBudget).toBe(3500)
  })

  it('entiende separador de miles con punto', async () => {
    const intent = await parser.parse('tengo $10.000 para tecnologia', categories)
    expect(intent.maxBudget).toBe(10000)
    expect(intent.category).toBe('tecnologia')
  })

  it('category null si no matchea ninguna categoría conocida', async () => {
    const intent = await parser.parse('quiero comprar juguetes', categories)
    expect(intent.category).toBeNull()
  })

  it('maxBudget null si no hay ningún número', async () => {
    const intent = await parser.parse('quiero limpieza para mi casa', categories)
    expect(intent.maxBudget).toBeNull()
  })

  it('nunca lanza con texto vacío', async () => {
    const intent = await parser.parse('', categories)
    expect(intent).toEqual({ category: null, maxBudget: null, preferences: [] })
  })
})

describe('StubExplainer', () => {
  const explainer = new StubExplainer()
  const request: BundleRequest = { category: 'limpieza', maxBudget: 3000, preferences: [] }

  it('menciona cada producto y el total', async () => {
    const bundle: Bundle = {
      items: [
        { id: 'a', name: 'Detergente', category: 'limpieza', price: 1200, inStock: true, tags: [] },
        { id: 'b', name: 'Esponja', category: 'limpieza', price: 300, inStock: true, tags: [] },
      ],
      substitutions: [],
      totalPrice: 1500,
      leftoverBudget: 1500,
    }
    const text = await explainer.explain(bundle, request)
    expect(text).toContain('Detergente')
    expect(text).toContain('Esponja')
    expect(text).toContain('1500')
  })

  it('avisa si el combo quedó vacío', async () => {
    const bundle: Bundle = { items: [], substitutions: [], totalPrice: 0, leftoverBudget: 100 }
    const text = await explainer.explain(bundle, { ...request, maxBudget: 100 })
    expect(text.length).toBeGreaterThan(0)
  })

  it('menciona la sustitución cuando existe', async () => {
    const bundle: Bundle = {
      items: [{ id: 'b', name: 'Detergente 2', category: 'limpieza', price: 1350, inStock: true, tags: [] }],
      substitutions: [{
        outOfStock: { id: 'a', name: 'Detergente', category: 'limpieza', price: 1200, inStock: false, tags: [] },
        replacement: { id: 'b', name: 'Detergente 2', category: 'limpieza', price: 1350, inStock: true, tags: [] },
      }],
      totalPrice: 1350,
      leftoverBudget: 1650,
    }
    const text = await explainer.explain(bundle, request)
    expect(text).toContain('Detergente 2')
  })
})
