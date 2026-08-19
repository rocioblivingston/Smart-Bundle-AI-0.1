import type { Bundle, BundleRequest, ParsedIntent } from '../types.js'

export interface IntentParser {
  /** Convierte el texto libre del comprador en categoría + presupuesto + preferencias. */
  parse(freeText: string, availableCategories: string[]): Promise<ParsedIntent>
}

export interface Explainer {
  /**
   * Redacta la explicación del combo para el comprador. Nunca inventa
   * productos ni precios: solo describe lo que ya viene armado en `bundle`.
   */
  explain(bundle: Bundle, request: BundleRequest): Promise<string>
}
