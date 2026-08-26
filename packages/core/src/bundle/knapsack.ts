import type { Bundle, Product } from '../types.js'

export interface ProductScore {
  preference: number
  complementarity: number
}

export type ProductScorer = (product: Product) => ProductScore

const NO_SCORE: ProductScorer = () => ({ preference: 0, complementarity: 0 })

/**
 * Mochila 0/1 deterministica. Las preferencias y la complementariedad son
 * prioridades blandas; presupuesto, stock y precio son restricciones duras.
 */
export function buildBundle(
  catalog: Product[],
  maxBudget: number,
  scoreProduct: ProductScorer = NO_SCORE,
): Bundle {
  const capacity = Math.max(0, Math.floor(maxBudget))
  const items = catalog
    .filter((product) => product.inStock !== false && product.price > 0 && product.price <= maxBudget)
    .sort((left, right) => left.id.localeCompare(right.id))

  if (capacity <= 0 || items.length === 0) {
    return { items: [], substitutions: [], totalPrice: 0, leftoverBudget: Math.max(0, maxBudget) }
  }

  const scores = items.map((product) => {
    const score = scoreProduct(product)
    return {
      preference: Math.max(0, Math.trunc(score.preference)),
      complementarity: Math.max(0, Math.trunc(score.complementarity)),
    }
  })
  const maximumComplementarity = scores.reduce((sum, score) => sum + score.complementarity, 0)
  const complementarityWeight = capacity + 1
  const preferenceWeight = (maximumComplementarity + 1) * complementarityWeight
  const utility = items.map((product, index) =>
    scores[index].preference * preferenceWeight +
    scores[index].complementarity * complementarityWeight +
    Math.ceil(product.price),
  )

  const table = Array.from(
    { length: items.length + 1 },
    () => new Array<number>(capacity + 1).fill(0),
  )

  for (let index = 1; index <= items.length; index++) {
    const price = Math.ceil(items[index - 1].price)
    for (let budget = 0; budget <= capacity; budget++) {
      const without = table[index - 1][budget]
      const withItem = price <= budget
        ? table[index - 1][budget - price] + utility[index - 1]
        : -1
      table[index][budget] = Math.max(without, withItem)
    }
  }

  const chosen: Product[] = []
  let budget = capacity
  for (let index = items.length; index > 0; index--) {
    if (table[index][budget] !== table[index - 1][budget]) {
      chosen.push(items[index - 1])
      budget -= Math.ceil(items[index - 1].price)
    }
  }

  const selected = chosen.reverse()
  const actualTotal = Math.round(selected.reduce((sum, product) => sum + product.price, 0) * 100) / 100

  return {
    items: selected,
    substitutions: [],
    totalPrice: actualTotal,
    leftoverBudget: Math.round((maxBudget - actualTotal) * 100) / 100,
  }
}
