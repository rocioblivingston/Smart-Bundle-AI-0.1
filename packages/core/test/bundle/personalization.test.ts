import { describe, expect, it } from 'vitest'
import { composeBundle } from '../../src/bundle/compose.js'
import type { Product } from '../../src/types.js'

const product = (id: string, price: number, tags: string[], inStock = true): Product => ({
  id, name: id, category: 'limpieza', price, inStock, tags,
})

describe('personalizacion deterministica del bundle', () => {
  it('incluye un producto requerido si existe y entra en presupuesto', () => {
    const catalog = [product('detergente', 900, ['detergente']), product('papel', 1400, ['papel'])]
    const bundle = composeBundle(catalog, {
      category: 'limpieza', maxBudget: 1500, preferences: [], requiredProducts: ['detergente'],
    })
    expect(bundle.items.map((item) => item.id)).toContain('detergente')
    expect(bundle.personalization?.coveredRequiredProducts).toEqual(['detergente'])
  })

  it('trata exclusiones y productos evitados como restricciones duras', () => {
    const catalog = [
      product('limpiador-perfumado', 1000, ['limpiador', 'perfume']),
      product('lavandina', 800, ['lavandina']),
      product('trapo', 600, ['trapo']),
    ]
    const bundle = composeBundle(catalog, {
      category: 'limpieza', maxBudget: 5000, preferences: [], excludedTags: ['perfume'], avoidedProducts: ['lavandina'],
    })
    expect(bundle.items.map((item) => item.id)).toEqual(['trapo'])
    expect(bundle.personalization?.excludedProductIds).toEqual(['lavandina', 'limpiador-perfumado'])
  })

  it('hace que una preferencia blanda influya en la seleccion', () => {
    const catalog = [product('premium', 1000, ['premium']), product('eco', 900, ['economico'])]
    const bundle = composeBundle(catalog, {
      category: 'limpieza', maxBudget: 1000, preferences: [], preferredTags: ['economico'],
    })
    expect(bundle.items.map((item) => item.id)).toEqual(['eco'])
  })

  it('prioriza complementos configurados frente a productos no relacionados', () => {
    const catalog = [
      product('limpiador', 1000, ['limpiador']),
      product('esponja', 500, ['esponja']),
      product('papel', 600, ['papel']),
    ]
    const bundle = composeBundle(catalog, {
      category: 'limpieza', maxBudget: 1600, preferences: [], requiredProducts: ['limpiador'],
    })
    expect(bundle.items.map((item) => item.id)).toEqual(['limpiador', 'esponja'])
    expect(bundle.personalization?.complementarityApplied).toContain('limpiador -> esponja')
  })

  it('incluye el reemplazo real en items, total y metadatos', () => {
    const catalog = [
      product('detergente-a', 1000, ['detergente'], false),
      product('detergente-b', 1100, ['detergente']),
    ]
    const bundle = composeBundle(catalog, {
      category: 'limpieza', maxBudget: 1200, preferences: [], requiredProducts: ['detergente-a'],
    })
    expect(bundle.substitutions[0].replacement?.id).toBe('detergente-b')
    expect(bundle.items.map((item) => item.id)).toContain('detergente-b')
    expect(bundle.totalPrice).toBe(1100)
    expect(bundle.leftoverBudget).toBe(100)
  })
})
