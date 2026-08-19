import { describe, it, expect } from 'vitest'
import { buildBundle } from '../../src/bundle/knapsack.js'
import type { Product } from '../../src/types.js'

const p = (id: string, price: number, inStock = true, category = 'limpieza'): Product => ({
  id, name: id, category, price, inStock, tags: [],
})

describe('buildBundle', () => {
  it('elige la combinación que más presupuesto aprovecha sin pasarse', () => {
    // Óptimo a mano: 1200 + 1800 = 3000 (exacto). Cualquier otra combinación
    // usa menos presupuesto o se pasa.
    const catalog = [p('a', 1200), p('b', 1800), p('c', 2500), p('d', 900)]
    const bundle = buildBundle(catalog, 3000)
    const total = bundle.items.reduce((s, i) => s + i.price, 0)
    expect(total).toBe(3000)
    expect(bundle.totalPrice).toBe(3000)
    expect(bundle.leftoverBudget).toBe(0)
  })

  it('nunca devuelve un total que supere el presupuesto', () => {
    const catalog = [p('a', 1700), p('b', 1300), p('c', 999)]
    const bundle = buildBundle(catalog, 2000)
    expect(bundle.totalPrice).toBeLessThanOrEqual(2000)
  })

  it('cada producto entra como máximo una vez', () => {
    const catalog = [p('a', 500), p('b', 500)]
    const bundle = buildBundle(catalog, 5000)
    const ids = bundle.items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ignora productos sin stock', () => {
    const catalog = [p('a', 1000, false), p('b', 1000, true)]
    const bundle = buildBundle(catalog, 5000)
    expect(bundle.items.map((i) => i.id)).toEqual(['b'])
  })

  it('devuelve carrito vacío si nada entra en el presupuesto', () => {
    const catalog = [p('a', 5000)]
    const bundle = buildBundle(catalog, 100)
    expect(bundle.items).toEqual([])
    expect(bundle.totalPrice).toBe(0)
    expect(bundle.leftoverBudget).toBe(100)
  })

  it('presupuesto cero no rompe nada', () => {
    const catalog = [p('a', 100)]
    const bundle = buildBundle(catalog, 0)
    expect(bundle.items).toEqual([])
  })

  it('es determinístico: mismo catálogo y presupuesto dan siempre el mismo resultado', () => {
    const catalog = [p('a', 1200), p('b', 1800), p('c', 2500), p('d', 900), p('e', 700)]
    const r1 = buildBundle(catalog, 4000).items.map((i) => i.id).sort()
    const r2 = buildBundle(catalog, 4000).items.map((i) => i.id).sort()
    expect(r1).toEqual(r2)
  })
})
