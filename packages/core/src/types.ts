export interface Product {
  id: string
  name: string
  category: string
  price: number      // pesos ARS, entero
  inStock: boolean
  tags: string[]
}

export interface BundleRequest {
  category: string
  maxBudget: number  // pesos ARS, entero >= 0
  preferences: string[]
}

export interface Substitution {
  outOfStock: Product
  replacement: Product | null   // null si no se encontró alternativa
}

export interface Bundle {
  items: Product[]
  substitutions: Substitution[]
  totalPrice: number
  leftoverBudget: number
}

/** Lo que el parser de intención extrae de un texto libre del comprador. */
export interface ParsedIntent {
  category: string | null
  maxBudget: number | null
  preferences: string[]
}
