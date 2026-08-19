import { describe, it, expect } from 'vitest'
import { findSubstitute } from '../../src/bundle/substitute.js'
import type { Product } from '../../src/types.js'

const p = (id: string, category: string, price: number, inStock = true): Product => ({
  id, name: id, category, price, inStock, tags: [],
})

describe('findSubstitute', () => {
  it('elige el reemplazo de la misma categoría con precio más cercano', () => {
    const target = p('out', 'limpieza', 1000, false)
    const catalog = [
      target,
      p('lejos', 'limpieza', 3000),
      p('cerca', 'limpieza', 1100),
      p('otra-categoria', 'tecnologia', 1050),
    ]
    const sub = findSubstitute(target, catalog)
    expect(sub?.id).toBe('cerca')
  })

  it('nunca devuelve un producto sin stock', () => {
    const target = p('out', 'limpieza', 1000, false)
    const catalog = [target, p('tambien-sin-stock', 'limpieza', 1000, false)]
    expect(findSubstitute(target, catalog)).toBeNull()
  })

  it('nunca se devuelve a sí mismo como sustituto', () => {
    const target = p('out', 'limpieza', 1000, false)
    const catalog = [target]
    expect(findSubstitute(target, catalog)).toBeNull()
  })

  it('no cruza categorías aunque el precio sea idéntico', () => {
    const target = p('out', 'limpieza', 1000, false)
    const catalog = [target, p('otra', 'tecnologia', 1000)]
    expect(findSubstitute(target, catalog)).toBeNull()
  })

  it('excluye productos ya elegidos en el combo', () => {
    const target = p('out', 'limpieza', 1000, false)
    const already = p('ya-en-combo', 'limpieza', 1000)
    const catalog = [target, already, p('libre', 'limpieza', 1200)]
    const sub = findSubstitute(target, catalog, [already])
    expect(sub?.id).toBe('libre')
  })
})
