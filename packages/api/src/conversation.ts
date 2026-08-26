import { randomUUID } from 'node:crypto'
import type {
  ConversationMessage,
  ConversationState,
  ParsedIntent,
  PriceIntent,
  Product,
  PurchaseStrategy,
} from '@sba/core'

export interface ConversationSession {
  state: ConversationState
  messages: ConversationMessage[]
  events: CommercialEvent[]
}

export type CommercialEventName =
  | 'recommendation_created'
  | 'recommendation_accepted'
  | 'whatsapp_handoff_created'
  | 'whatsapp_handoff_clicked'

export interface CommercialEvent {
  event: CommercialEventName
  conversationId: string
  recommendationId: string
  products: Array<{ id: string; name: string; price: number }>
  total: number
  timestamp: string
}

export interface ConversationStatePatch {
  category?: string | null
  budget?: number | null
  requiredProducts?: string[]
  preferredTags?: string[]
  exclusions?: string[]
  strategy?: PurchaseStrategy | null
  priceIntent?: PriceIntent
}

const BRANDS = ['adidas', 'new balance', 'nike', 'puma', 'vans']
const LIGHT_COLORS = ['claro', 'clara', 'claros', 'claras', 'blanco', 'blanca', 'blancos', 'blancas', 'white', 'crema', 'nude', 'rosa', 'lila', 'celeste']
const DARK_COLORS = ['negro', 'negra', 'negros', 'negras', 'black', 'oscuro', 'oscura', 'oscuros', 'oscuras', 'gris', 'grises', 'bordo', 'marron']
const COLOR_TERMS = [...LIGHT_COLORS, ...DARK_COLORS]

const normalize = (value: string): string => value
  .toLowerCase()
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')

const unique = (values: string[]): string[] => [...new Set(values.map((value) => value.trim()).filter(Boolean))]
const includesTerm = (value: string, term: string): boolean => {
  const escaped = normalize(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\W)${escaped}(?=$|\\W)`, 'i').test(normalize(value))
}

function firstMention(message: string, values: string[]): string | undefined {
  return values.find((value) => includesTerm(message, value))
}

function withoutGroup(values: string[], group: string[]): string[] {
  return values.filter((value) => !group.some((term) => includesTerm(value, term)))
}

function relativeBudget(message: string, current?: number): number | undefined {
  if (!current) return undefined
  const text = normalize(message)
  if (/\b(subi|subir|aumenta|aumentar)\b.*\b(poco|presupuesto)\b/.test(text)) {
    return Math.round((current * 1.1) / 100) * 100
  }
  if (/\b(baja|bajar|reduci|reducir)\b.*\b(poco|presupuesto)\b/.test(text)) {
    return Math.max(100, Math.round((current * 0.9) / 100) * 100)
  }
  return undefined
}

function contextualStrategy(message: string): PurchaseStrategy | undefined {
  const text = normalize(message)
  if (/esta muy caro|algo mas barato|gastar menos|mas economico/.test(text)) return 'lowest-cost'
  if (/una mejor|prioriza.*calidad|mejor calidad/.test(text)) return 'quality-first'
  if (/aprovecha.*presupuesto|usa.*presupuesto|gastar todo/.test(text)) return 'maximize-budget'
  return undefined
}

const MONEY_PATTERN = String.raw`(\d{1,3}(?:[.\s]\d{3})+|\d{2,7})`
const moneyValue = (value: string | undefined): number | undefined => {
  if (!value) return undefined
  const amount = Number(value.replace(/[.\s]/g, ''))
  return Number.isFinite(amount) && amount > 0 ? amount : undefined
}

/** Distingue un techo comercial de un precio de referencia sin delegar matemática al LLM. */
export function parsePriceIntent(
  message: string,
  current: PriceIntent = {},
  parsedBudget?: number | null,
): PriceIntent {
  const text = normalize(message)
  const budgetMatch = text.match(new RegExp(
    String.raw`(?:tengo\s+hasta|hasta|no\s+puedo\s+gastar\s+mas\s+de|no\s+puedo\s+pasar\s+de|presupuesto\s+maximo(?:\s+de)?|como\s+maximo)\D{0,18}${MONEY_PATTERN}`,
  ))
  const targetMatch = text.match(new RegExp(
    String.raw`(?:alrededor\s+de|cerca\s+de|cercan[oa]\s+a|aproximadamente|aprox(?:imado)?|una\s+de|uno\s+de|precio\s+de)\D{0,18}${MONEY_PATTERN}`,
  ))
  const referencesCurrentPrice = /\b(ese|ese mismo|dicho) precio\b/.test(text)
  const explicitBudget = moneyValue(budgetMatch?.[1])
  const explicitTarget = moneyValue(targetMatch?.[1])
  const relative = relativeBudget(message, current.budgetMax)

  const result: PriceIntent = { ...current }
  if (explicitBudget) result.budgetMax = explicitBudget
  else if (!explicitTarget && parsedBudget) result.budgetMax = parsedBudget
  else if (relative) result.budgetMax = relative

  if (explicitTarget) {
    result.targetPrice = explicitTarget
    result.targetTolerancePercent ??= 10
  } else if (referencesCurrentPrice && result.targetPrice == null && result.budgetMax != null) {
    result.targetPrice = result.budgetMax
    result.targetTolerancePercent ??= 10
  }
  return result
}

export function conversationAction(message: string): string | undefined {
  const text = normalize(message)
  if (/\b(quiero ese|quiero esa|me quedo con ese|me quedo con esa|comprar|continuar)\b/.test(text)) {
    return 'recommendation-accepted'
  }
  if (/\bno\s+(?:quiero\s+)?(?:la\s+)?de\b|\bno\s+esa\b|\bdescarta\b.*\banterior\b/.test(text)) {
    return 'recommendation-rejected'
  }
  if (/\b(otra|otro)\b.*\b(opcion|alternativa|parecida|parecido|marca)?\b|\bdame (otra|otro)\b|\bla anterior\b/.test(text)) {
    return 'alternative-requested'
  }
  if (/esta muy caro|algo mas barato|gastar menos|mas economico/.test(text)) return 'lower-price-requested'
  if (/\b(mantene|mantener)\b/.test(text)) return 'preference-maintained'
  return undefined
}

export function updateConversationState(
  current: ConversationState,
  message: string,
  parsed: ParsedIntent | null,
  patch: ConversationStatePatch = {},
): ConversationState {
  const detectedBrand = firstMention(message, BRANDS)
  const detectedColor = firstMention(message, COLOR_TERMS)
  const asksOtherBrand = /\botra marca\b/i.test(normalize(message))
  const modelMatch = normalize(message).match(/\bmodelo\s+([a-z0-9][a-z0-9 -]{1,28})/)
  const useCaseMatch = normalize(message).match(/\b(?:para|uso)\s+(?:uso\s+)?(diario|diaria|correr|running|entrenar|gimnasio|skate|trabajo)\b/)

  let softPreferences = unique([
    ...current.softPreferences,
    ...(patch.preferredTags ?? []),
  ])
  if (detectedBrand || asksOtherBrand) softPreferences = withoutGroup(softPreferences, BRANDS)
  if (detectedColor) softPreferences = withoutGroup(softPreferences, COLOR_TERMS)
  softPreferences = unique([...softPreferences, ...(parsed?.preferredTags ?? [])])

  const priceIntent = parsePriceIntent(
    message,
    {
      ...(current.priceIntent ?? {}),
      ...(current.budget && current.priceIntent?.budgetMax == null ? { budgetMax: current.budget } : {}),
      ...(patch.priceIntent ?? {}),
      ...(patch.budget ? { budgetMax: patch.budget } : {}),
    },
    parsed?.maxBudget,
  )
  const parsedRequired = parsed?.requiredProducts ?? []
  const requiredProducts = patch.requiredProducts?.length
    ? patch.requiredProducts
    : parsedRequired.length ? parsedRequired : current.requiredProducts
  const exclusions = unique([
    ...(current.exclusions ?? []),
    ...(patch.exclusions ?? []),
    ...(parsed?.excludedTags ?? []),
    ...(parsed?.avoidedProducts ?? []),
  ])

  return {
    ...current,
    category: parsed?.category ?? patch.category ?? current.category,
    budget: priceIntent.budgetMax,
    priceIntent,
    brand: asksOtherBrand ? undefined : detectedBrand ?? current.brand,
    color: detectedColor ?? current.color,
    model: modelMatch?.[1]?.trim() ?? current.model,
    useCase: useCaseMatch?.[1] ? `uso ${useCaseMatch[1]}` : current.useCase,
    requiredProducts,
    exclusions,
    strategy: patch.strategy ?? parsed?.strategy ?? contextualStrategy(message) ?? current.strategy ?? 'balanced',
    hardConstraints: current.hardConstraints,
    softPreferences,
  }
}

export class InMemoryConversationStore {
  private readonly sessions = new Map<string, ConversationSession>()

  getOrCreate(conversationId?: string): ConversationSession {
    if (conversationId) {
      const existing = this.sessions.get(conversationId)
      if (existing) return existing
    }
    const id = `SBA-C-${randomUUID()}`
    const session: ConversationSession = {
      state: {
        conversationId: id,
        hardConstraints: [],
        softPreferences: [],
      },
      messages: [],
      events: [],
    }
    this.sessions.set(id, session)
    return session
  }

  get(conversationId: string): ConversationSession | undefined {
    return this.sessions.get(conversationId)
  }

  append(
    session: ConversationSession,
    role: ConversationMessage['role'],
    content: string,
    options: { recommendationId?: string; products?: Product[]; action?: string } = {},
  ): ConversationMessage {
    const message: ConversationMessage = {
      id: `SBA-M-${randomUUID()}`,
      role,
      content,
      timestamp: new Date().toISOString(),
      ...options,
    }
    session.messages.push(message)
    return message
  }

  recommendationId(): string {
    return `SBA-R-${randomUUID()}`
  }

  track(
    session: ConversationSession,
    event: CommercialEventName,
    recommendationId: string,
    products: Product[],
  ): CommercialEvent {
    const record: CommercialEvent = {
      event,
      conversationId: session.state.conversationId,
      recommendationId,
      products: products.map(({ id, name, price }) => ({ id, name, price })),
      total: products.reduce((sum, product) => sum + product.price, 0),
      timestamp: new Date().toISOString(),
    }
    session.events.push(record)
    return record
  }
}
