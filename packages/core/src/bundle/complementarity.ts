import type { Product } from '../types.js'
import { normalizeSearchText } from '../catalog.js'

export interface ComplementarityRule {
  category: string
  selectedNeed: string
  complements: string[]
  score: number
}

/**
 * Configuración de demostración. El algoritmo recibe estas reglas como
 * parámetro, por lo que un retailer puede reemplazarlas sin reescribir core.
 */
export const DEFAULT_COMPLEMENTARITY_RULES: ComplementarityRule[] = [
  { category: 'limpieza', selectedNeed: 'detergente', complements: ['suavizante', 'quitamanchas'], score: 3 },
  { category: 'limpieza', selectedNeed: 'limpiador', complements: ['esponja', 'guantes', 'trapo'], score: 3 },
  { category: 'limpieza', selectedNeed: 'jabon', complements: ['quitamanchas', 'suavizante'], score: 2 },
  { category: 'cuidado-personal', selectedNeed: 'shampoo', complements: ['acondicionador', 'tratamiento'], score: 3 },
  { category: 'cuidado-personal', selectedNeed: 'jabon', complements: ['crema', 'desodorante'], score: 2 },
  { category: 'tecnologia', selectedNeed: 'notebook', complements: ['mouse', 'funda', 'base'], score: 3 },
  { category: 'tecnologia', selectedNeed: 'mouse', complements: ['mousepad', 'teclado'], score: 2 },
]

export function productMatchesNeed(product: Product, need: string): boolean {
  const normalizedNeed = normalizeSearchText(need)
  if (!normalizedNeed) return false
  return (
    normalizeSearchText(product.id).includes(normalizedNeed) ||
    normalizeSearchText(product.name).includes(normalizedNeed) ||
    product.tags.some((tag) => normalizeSearchText(tag).includes(normalizedNeed))
  )
}

export function activeComplementarityRules(
  category: string,
  selectedNeeds: string[],
  rules: ComplementarityRule[],
): ComplementarityRule[] {
  const needs = selectedNeeds.map(normalizeSearchText)
  return rules.filter((rule) => {
    if (rule.category !== category) return false
    const selected = normalizeSearchText(rule.selectedNeed)
    return needs.some((need) => need.includes(selected) || selected.includes(need))
  })
}
