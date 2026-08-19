import { describe, it, expect } from 'vitest'
import { composeBundle } from '../../src/bundle/compose.js'
import type { Product } from '../../src/types.js'

const p = (id: string, category: string, price: number, inStock = true, tags: string[] = []): Product => ({
  id, name: id, category, price, inStock, tags,
})

const catalog: Product[] = [
  p('detergente', 'limpieza', 1200, false, ['detergente', 'ropa']),
  p('detergente-2', 'limpieza', 1350, true, ['detergente', 'ropa']),
  p('esponja', 'limpieza', 300),
  p('lavandina', 'limpieza', 800),
  p('mouse', 'tecnologia', 5000),
]

describe('composeBundle', () => {
  it('solo considera productos de la categoría pedida', () => {
    const bundle = composeBundle(catalog, 'limpieza', 10000)
    expect(bundle.items.every((i) => i.category === 'limpieza')).toBe(true)
  })

  it('respeta el presupuesto también con preferencias', () => {
    const bundle = composeBundle(catalog, 'limpieza', 1000, ['esponja'])
    expect(bundle.totalPrice).toBeLessThanOrEqual(1000)
  })

  it('arma la sustitución cuando la preferencia pedida está sin stock', () => {
    const bundle = composeBundle(catalog, 'limpieza', 10000, ['detergente'])
    expect(bundle.substitutions).toHaveLength(1)
    expect(bundle.substitutions[0].outOfStock.id).toBe('detergente')
    expect(bundle.substitutions[0].replacement?.id).toBe('detergente-2')
  })

  it('no arma sustitución si la preferencia ya tiene stock', () => {
    const bundle = composeBundle(catalog, 'limpieza', 10000, ['esponja'])
    expect(bundle.substitutions).toHaveLength(0)
  })

  it('sin preferencias no hay sustituciones', () => {
    const bundle = composeBundle(catalog, 'limpieza', 10000)
    expect(bundle.substitutions).toEqual([])
  })
})
