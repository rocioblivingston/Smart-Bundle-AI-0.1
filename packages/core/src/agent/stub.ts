import type { Bundle, BundleRequest, ParsedIntent } from '../types.js'
import type { Explainer, IntentParser } from './contracts.js'

const normalize = (text: string): string =>
  text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

/**
 * Extractor determinístico por reglas: keyword matching de categoría +
 * regex de montos en pesos. Cubre el caso feliz sin costo ni latencia de IA,
 * y es lo que corre cuando falta ANTHROPIC_API_KEY o Claude falla.
 */
export class StubIntentParser implements IntentParser {
  async parse(freeText: string, availableCategories: string[]): Promise<ParsedIntent> {
    const text = normalize(freeText)

    const category = availableCategories.find((c) => text.includes(normalize(c))) ?? null

    // $5000, $10.000, "3500 pesos" — el punto de miles se descarta antes del regex.
    const withoutThousands = text.replace(/(\d)\.(\d{3})/g, '$1$2')
    const match = withoutThousands.match(/\$?\s*(\d{2,7})\s*(pesos)?/)
    const maxBudget = match ? Number(match[1]) : null

    return { category, maxBudget, preferences: [] }
  }
}

/** Redactor determinístico por plantilla: nunca inventa nada porque solo repite `bundle`. */
export class StubExplainer implements Explainer {
  async explain(bundle: Bundle, request: BundleRequest): Promise<string> {
    if (bundle.items.length === 0) {
      return `No encontré productos de ${request.category} que entren en $${request.maxBudget}. Probá con más presupuesto.`
    }

    const lines = bundle.items.map((i) => `${i.name} ($${i.price})`).join(', ')
    const subLines = bundle.substitutions
      .filter((s) => s.replacement)
      .map((s) => `Como no había ${s.outOfStock.name}, sumamos ${s.replacement!.name}.`)
      .join(' ')

    return `Armamos tu combo de ${request.category}: ${lines}. Total: $${bundle.totalPrice}, te quedan $${bundle.leftoverBudget} de margen. ${subLines}`.trim()
  }
}
