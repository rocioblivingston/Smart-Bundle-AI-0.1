import type { Product } from '../types.js'

/**
 * Sustitución por reglas: misma categoría, MISMO TIPO DE PRODUCTO (al menos
 * un tag en común con el agotado), con stock, y la más cercana en precio.
 *
 * Solo filtrar por categoría no alcanza: "limpieza" mezcla detergentes,
 * esponjas, papel higiénico y lavandina. Sin el filtro de tags, el más
 * cercano en precio a un detergente agotado puede terminar siendo un rollo
 * de cocina — más cerca en plata, pero un sustituto sin sentido. Mejor
 * devolver null (sin sustituto) que una sugerencia que no sirve.
 */
export function findSubstitute(
  outOfStock: Product,
  catalog: Product[],
  exclude: Product[] = [],
): Product | null {
  const excludedIds = new Set([outOfStock.id, ...exclude.map((p) => p.id)])
  const targetTags = new Set(outOfStock.tags)

  const candidates = catalog.filter(
    (p) =>
      p.inStock &&
      p.category === outOfStock.category &&
      !excludedIds.has(p.id) &&
      p.tags.some((t) => targetTags.has(t)),
  )

  if (candidates.length === 0) return null

  return candidates.reduce((closest, current) =>
    Math.abs(current.price - outOfStock.price) < Math.abs(closest.price - outOfStock.price)
      ? current
      : closest,
  )
}
