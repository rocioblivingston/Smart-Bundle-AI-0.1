import type { Bundle, Product } from '../types.js'

/**
 * Arma el combo que más presupuesto aprovecha sin pasarse ni un peso.
 *
 * Es el problema clásico de la mochila 0/1 con peso = valor = precio:
 * maximizar la suma de precios elegidos sujeto a que no supere `maxBudget`.
 * Programación dinámica exacta y determinística — nada de esto necesita IA,
 * y usar un LLM acá arriesgaría justamente la promesa que no puede fallar:
 * no pasarse del presupuesto.
 *
 * Complejidad O(n · budget). Para un catálogo de prueba y presupuestos en
 * pesos enteros de hasta unas pocas decenas de miles, es instantáneo.
 */
export function buildBundle(catalog: Product[], maxBudget: number): Bundle {
  const items = catalog.filter((p) => p.inStock && p.price > 0 && p.price <= maxBudget)

  if (maxBudget <= 0 || items.length === 0) {
    return { items: [], substitutions: [], totalPrice: 0, leftoverBudget: Math.max(0, maxBudget) }
  }

  // table[i][b] = mejor suma alcanzable usando los primeros i productos con presupuesto b.
  // Se guarda la tabla completa (no solo la última fila) para poder reconstruir la selección.
  const table = Array.from({ length: items.length + 1 }, () => new Array<number>(maxBudget + 1).fill(0))

  for (let i = 1; i <= items.length; i++) {
    const price = items[i - 1].price
    for (let b = 0; b <= maxBudget; b++) {
      const without = table[i - 1][b]
      const withItem = price <= b ? table[i - 1][b - price] + price : -1
      table[i][b] = Math.max(without, withItem)
    }
  }

  const bestTotal = table[items.length][maxBudget]

  // Reconstrucción: recorre la tabla de atrás hacia adelante.
  const chosen: Product[] = []
  let b = maxBudget
  for (let i = items.length; i > 0; i--) {
    if (table[i][b] !== table[i - 1][b]) {
      chosen.push(items[i - 1])
      b -= items[i - 1].price
    }
  }

  return {
    items: chosen.reverse(),
    substitutions: [],
    totalPrice: bestTotal,
    leftoverBudget: maxBudget - bestTotal,
  }
}
