import type { Product } from '../types.js'

/**
 * Sustitución por reglas: misma categoría, con stock, y la más cercana en
 * precio al producto agotado. Determinístico y gratis — reservar un LLM
 * para "qué es similar" sería pagar latencia y costo por algo que un filtro
 * simple resuelve igual de bien para el catálogo de un MVP.
 */
export function findSubstitute(
  outOfStock: Product,
  catalog: Product[],
  exclude: Product[] = [],
): Product | null {
  const excludedIds = new Set([outOfStock.id, ...exclude.map((p) => p.id)])

  const candidates = catalog.filter(
    (p) => p.inStock && p.category === outOfStock.category && !excludedIds.has(p.id),
  )

  if (candidates.length === 0) return null

  return candidates.reduce((closest, current) =>
    Math.abs(current.price - outOfStock.price) < Math.abs(closest.price - outOfStock.price)
      ? current
      : closest,
  )
}
