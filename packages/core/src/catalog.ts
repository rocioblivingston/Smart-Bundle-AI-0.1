import type { Product } from './types.js'

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export function categoriesOf(catalog: Product[]): string[] {
  return [...new Set(catalog.map((p) => p.category))].sort()
}

export function byCategory(catalog: Product[], category: string): Product[] {
  return catalog.filter((p) => p.category === category)
}

/** Busca productos del catálogo cuyo nombre o tags contengan la palabra dada. */
export function matchByKeyword(catalog: Product[], keyword: string): Product[] {
  const needle = normalizeSearchText(keyword)
  if (!needle) return []
  return catalog.filter(
    (p) =>
      normalizeSearchText(p.id).includes(needle) ||
      normalizeSearchText(p.name).includes(needle) ||
      p.tags.some((t) => normalizeSearchText(t).includes(needle)),
  )
}
