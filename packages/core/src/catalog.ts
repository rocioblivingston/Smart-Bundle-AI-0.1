import type { Product } from './types.js'

export function categoriesOf(catalog: Product[]): string[] {
  return [...new Set(catalog.map((p) => p.category))].sort()
}

export function byCategory(catalog: Product[], category: string): Product[] {
  return catalog.filter((p) => p.category === category)
}

/** Busca productos del catálogo cuyo nombre o tags contengan la palabra dada. */
export function matchByKeyword(catalog: Product[], keyword: string): Product[] {
  const needle = keyword.trim().toLowerCase()
  if (!needle) return []
  return catalog.filter(
    (p) => p.name.toLowerCase().includes(needle) || p.tags.some((t) => t.toLowerCase().includes(needle)),
  )
}
