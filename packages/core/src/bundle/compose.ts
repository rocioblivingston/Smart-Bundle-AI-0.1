import type { Bundle, Product, Substitution } from '../types.js'
import { byCategory, matchByKeyword } from '../catalog.js'
import { buildBundle } from './knapsack.js'
import { findSubstitute } from './substitute.js'

/**
 * Orquesta el combo completo: filtra por categoría, arma sustituciones para
 * las preferencias explícitas que están sin stock, y corre el knapsack sobre
 * lo disponible. Es la función que llama la API — el punto de entrada único
 * al núcleo de negocio, sin ningún acoplamiento a n8n, Express ni al modelo.
 */
export function composeBundle(
  catalog: Product[],
  category: string,
  maxBudget: number,
  preferences: string[] = [],
): Bundle {
  const inCategory = byCategory(catalog, category)

  const substitutions: Substitution[] = []
  for (const pref of preferences) {
    const matches = matchByKeyword(inCategory, pref)
    const outOfStock = matches.find((p) => !p.inStock)
    if (outOfStock) {
      substitutions.push({ outOfStock, replacement: findSubstitute(outOfStock, inCategory) })
    }
  }

  const bundle = buildBundle(inCategory, maxBudget)
  return { ...bundle, substitutions }
}
