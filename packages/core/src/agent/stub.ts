import type { Bundle, BundleRequest, ParsedIntent } from '../types.js'
import type { Explainer, IntentParser } from './contracts.js'

const normalize = (text: string): string =>
  text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

const FOOTWEAR_BRANDS = ['adidas', 'new balance', 'nike', 'puma', 'vans']
const FOOTWEAR_COLORS = [
  'claro', 'clara', 'claras', 'blanco', 'blanca', 'blancas', 'white', 'crema', 'nude',
  'negro', 'negra', 'negras', 'black', 'gris', 'grises', 'rosa', 'lila', 'celeste',
  'azul', 'verde', 'bordo', 'marron', 'caramelo', 'chocolate',
]
const FOOTWEAR_STYLES = ['casual', 'urbano', 'urbana', 'deportivo', 'deportiva', 'running', 'retro', 'clasico', 'clasica', 'skate']
const unique = (values: string[]): string[] => [...new Set(values.map((value) => value.trim()).filter(Boolean))]

const cleanPhrase = (value: string): string => value
  .replace(/\b(con|para|y|pero|que|tengo|hasta|presupuesto).*$/i, '')
  .replace(/[.,;:!?]/g, ' ')
  .trim()

function captures(text: string, patterns: RegExp[]): string[] {
  const values = patterns.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => cleanPhrase(match[1] ?? '')),
  )
  return [...new Set(values.filter(Boolean))]
}

/** Extractor deterministico usado cuando el proveedor de IA no esta disponible. */
export class StubIntentParser implements IntentParser {
  async parse(freeText: string, availableCategories: string[]): Promise<ParsedIntent> {
    const text = normalize(freeText)
    const explicitCategory = availableCategories.find((candidate) => text.includes(normalize(candidate))) ?? null
    const footwearCategory = availableCategories.find((candidate) => normalize(candidate) === 'zapatillas')
    const mentionsFootwear = /\b(zapatillas?|sneakers?|calzado|adidas|new balance|nike|puma|vans)\b/.test(text)
    const category = explicitCategory ?? (footwearCategory && mentionsFootwear ? footwearCategory : null)
    const withoutThousands = text.replace(/(\d)\.(\d{3})/g, '$1$2')
    const budgetMatch = withoutThousands.match(/\$?\s*(\d{2,7})\s*(pesos)?/)
    const maxBudget = budgetMatch ? Number(budgetMatch[1]) : null

    const excludedTags = captures(text, [/(?:sin|evitar que tenga)\s+([a-z][a-z0-9 -]{1,30})/g])
    const avoidedProducts = captures(text, [
      /(?:no quiero|evita|sin incluir)\s+(?:un |una |el |la )?([a-z][a-z0-9 -]{1,40})/g,
    ])
    let preferredTags = captures(text, [
      /(?:prefiero|preferentemente|mejor si es|algo)\s+([a-z][a-z0-9 -]{1,30})/g,
    ])
    let requiredProducts = captures(text, [
      /(?:necesito|(?<!no )quiero)\s+(?:si o si\s+)?(?:un |una |el |la )?([a-z][a-z0-9 -]{1,40})/g,
      /(?:que incluya|con)\s+(?:un |una |el |la )?([a-z][a-z0-9 -]{1,40})/g,
    ]).filter((value) =>
      !availableCategories.some((available) => normalize(available) === value) &&
      !/^(productos?|algo)\b/.test(value) &&
      !value.includes(' sin ') &&
      !avoidedProducts.includes(value),
    )
    if (category && normalize(category) === 'zapatillas') {
      const brandPreferences = FOOTWEAR_BRANDS.filter((brand) => text.includes(brand))
      const colorPreferences = FOOTWEAR_COLORS.filter((color) => new RegExp(`\\b${color}\\b`).test(text))
      const stylePreferences = FOOTWEAR_STYLES.filter((style) => new RegExp(`\\b${style}\\b`).test(text))
      const usePreferences = captures(text, [
        /para\s+(uso\s+[a-z ]{2,24})(?:\s+y\s+tengo|,|\.|$)/g,
        /para\s+([a-z ]{2,24})(?:\s+y\s+tengo|,|\.|$)/g,
      ])
      requiredProducts = ['zapatillas']
      preferredTags = unique([...preferredTags, ...brandPreferences, ...colorPreferences, ...stylePreferences, ...usePreferences])
    }
    const strategy = /(?:priorizar|priorizo|prefiero)\s+(?:la\s+)?calidad|mayor calidad/.test(text)
      ? 'quality-first'
      : /aprovechar(?: al maximo)?|usar todo|gastar todo/.test(text)
        ? 'maximize-budget'
        : /gastar lo menos|menor costo|mas barato|economico/.test(text)
          ? 'lowest-cost'
          : null

    return {
      category,
      maxBudget,
      preferences: requiredProducts,
      requiredProducts,
      preferredTags,
      excludedTags,
      avoidedProducts,
      strategy,
    }
  }
}

/** Redactor por plantilla: solo utiliza datos calculados por el nucleo. */
export class StubExplainer implements Explainer {
  async explain(bundle: Bundle, request: BundleRequest): Promise<string> {
    if (bundle.items.length === 0) {
      return `No encontre productos de ${request.category} que entren en $${request.maxBudget}. Proba con mas presupuesto.`
    }

    const lines = bundle.items.map((item) => `${item.name} ($${item.price})`).join(', ')
    const substitutions = bundle.substitutions
      .filter((substitution) => substitution.replacement)
      .map((substitution) => substitution.reason === 'over-budget'
        ? `Como ${substitution.outOfStock.name} excedia el presupuesto, sumamos ${substitution.replacement!.name}.`
        : `Como ${substitution.outOfStock.name} no tenia stock, sumamos ${substitution.replacement!.name}.`)
      .join(' ')
    const complements = bundle.personalization?.complementarityApplied.length
      ? ` Sumamos ${bundle.personalization.complementarityApplied.length} complemento(s) util(es).`
      : ''
    const uncovered = bundle.personalization?.uncoveredRequiredProducts.length
      ? ` No encontramos dentro del presupuesto: ${bundle.personalization.uncoveredRequiredProducts.join(', ')}.`
      : ''
    const promotion = bundle.pricing?.smartBundleDemoBenefit
      ? ` La politica demo aplico un beneficio de $${bundle.pricing.smartBundleDemoBenefit}.`
      : ''
    const strategy = bundle.strategy ? ` Estrategia: ${bundle.strategy}.` : ''

    return `Armamos tu combo de ${request.category}: ${lines}. Total final: $${bundle.totalPrice}, te quedan $${bundle.leftoverBudget} de margen.${strategy}${complements}${promotion}${uncovered} ${substitutions}`.trim()
  }
}
