import { describe, expect, it } from 'vitest'
import { findClosestPriceCandidates, type Product } from '../../src/index.js'

const product = (id: string, price: number): Product => ({
  id,
  name: id,
  category: 'zapatillas',
  price,
  tags: ['zapatillas'],
})

describe('findClosestPriceCandidates', () => {
  const products = [
    product('inferior-lejana', 82000),
    product('inferior-cercana', 87000),
    product('exacta', 90000),
    product('superior-cercana', 94000),
    product('superior-lejana', 99000),
  ]

  it('prioriza coincidencia exacta, inferior cercana y superior cercana', () => {
    const result = findClosestPriceCandidates(products, 90000)
    expect(result.exact?.product.id).toBe('exacta')
    expect(result.closestBelow?.product.id).toBe('inferior-cercana')
    expect(result.closestAbove?.product.id).toBe('superior-cercana')
    expect(result.candidates.slice(0, 3).map((candidate) => candidate.product.id)).toEqual([
      'exacta', 'inferior-cercana', 'superior-cercana',
    ])
  })

  it('calcula diferencias firmadas, absolutas y porcentuales', () => {
    const result = findClosestPriceCandidates(products, 90000)
    expect(result.closestBelow).toMatchObject({
      price: 87000,
      difference: -3000,
      absoluteDifference: 3000,
      differencePercent: 3.33,
      aboveTarget: false,
    })
    expect(result.closestAbove).toMatchObject({
      price: 94000,
      difference: 4000,
      absoluteDifference: 4000,
      differencePercent: 4.44,
      aboveTarget: true,
    })
  })

  it('excluye la última recomendación rechazada', () => {
    const result = findClosestPriceCandidates(products, 90000, { excludeProductIds: ['exacta'] })
    expect(result.exact).toBeNull()
    expect(result.candidates.map((candidate) => candidate.product.id)).not.toContain('exacta')
  })
})
