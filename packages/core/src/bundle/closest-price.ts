import type { Product } from '../types.js'

export interface ClosestPriceCandidate {
  product: Product
  price: number
  difference: number
  absoluteDifference: number
  differencePercent: number
  aboveTarget: boolean
  exact: boolean
}

export interface ClosestPriceResult {
  targetPrice: number
  exact: ClosestPriceCandidate | null
  closestBelow: ClosestPriceCandidate | null
  closestAbove: ClosestPriceCandidate | null
  candidates: ClosestPriceCandidate[]
}

export interface ClosestPriceOptions {
  excludeProductIds?: string[]
  maxResults?: number
}

const money = (value: number): number => Math.round(value * 100) / 100

function candidate(product: Product, targetPrice: number): ClosestPriceCandidate {
  const difference = money(product.price - targetPrice)
  const absoluteDifference = Math.abs(difference)
  return {
    product,
    price: product.price,
    difference,
    absoluteDifference,
    differencePercent: money((absoluteDifference / targetPrice) * 100),
    aboveTarget: difference > 0,
    exact: difference === 0,
  }
}

/**
 * Orden comercial determinístico: exacta, inferior más cercana, superior más
 * cercana y luego el resto por distancia absoluta. Nunca altera precios.
 */
export function findClosestPriceCandidates(
  products: Product[],
  targetPrice: number,
  options: ClosestPriceOptions = {},
): ClosestPriceResult {
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
    throw new Error('targetPrice debe ser un número positivo')
  }
  const excluded = new Set(options.excludeProductIds ?? [])
  const available = products
    .filter((product) => product.inStock !== false && product.price > 0 && !excluded.has(product.id))
    .map((product) => candidate(product, targetPrice))
  const exact = available.filter((item) => item.exact).sort((left, right) => left.product.id.localeCompare(right.product.id))
  const below = available.filter((item) => item.difference < 0)
    .sort((left, right) => right.price - left.price || left.product.id.localeCompare(right.product.id))
  const above = available.filter((item) => item.difference > 0)
    .sort((left, right) => left.price - right.price || left.product.id.localeCompare(right.product.id))

  const prioritized = [exact[0], below[0], above[0]].filter((item): item is ClosestPriceCandidate => Boolean(item))
  const prioritizedIds = new Set(prioritized.map((item) => item.product.id))
  const remaining = available.filter((item) => !prioritizedIds.has(item.product.id))
    .sort((left, right) => left.absoluteDifference - right.absoluteDifference || left.price - right.price || left.product.id.localeCompare(right.product.id))
  const maxResults = Math.max(1, options.maxResults ?? 6)

  return {
    targetPrice,
    exact: exact[0] ?? null,
    closestBelow: below[0] ?? null,
    closestAbove: above[0] ?? null,
    candidates: [...prioritized, ...remaining].slice(0, maxResults),
  }
}
