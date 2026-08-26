export interface Product {
  id: string
  name: string
  category: string
  price: number      // precio efectivo en pesos ARS
  /** true/false solo cuando la fuente publica disponibilidad; undefined significa desconocida. */
  inStock?: boolean
  tags: string[]
  /** Datos opcionales de ecommerce. El núcleo no depende del proveedor. */
  productId?: string
  skuId?: string
  listPrice?: number
  promotionalPrice?: number
  seller?: string
  availableQuantity?: number
  imageUrl?: string
  productUrl?: string
  orderUrl?: string
  brand?: string
  source?: 'local' | 'vtex' | 'lenaldi'
  /** Solo se completa cuando el retailer o un fixture demo aporta estas señales. */
  decisionSignals?: ProductDecisionSignals
}

export type PurchaseStrategy =
  | 'lowest-cost'
  | 'balanced'
  | 'quality-first'
  | 'maximize-budget'

export interface PriceIntent {
  budgetMax?: number
  targetPrice?: number
  targetTolerancePercent?: number
}

export interface ProductDecisionSignals {
  needIds: string[]
  qualityScore?: number
  valueScore?: number
}

export interface NeedSlot {
  id: string
  required: boolean
  alternatives: string[]
  priority: number
}

export interface CommercialPolicy {
  id: string
  label: string
  maxBundleDiscountPercent: number
  minItemsForPromotion: number
  excludedProductIds: string[]
  excludedCategories: string[]
  allowStackingWithRetailerPromotions: boolean
}

export interface BundleRequest {
  category: string
  maxBudget: number
  /** Campo histórico: se interpreta como producto requerido. */
  preferences: string[]
  requiredProducts?: string[]
  preferredTags?: string[]
  excludedTags?: string[]
  avoidedProducts?: string[]
  strategy?: PurchaseStrategy
  priceIntent?: PriceIntent
}

export interface Substitution {
  outOfStock: Product
  replacement: Product | null
  reason?: 'out-of-stock' | 'over-budget' | 'unavailable'
  requestedTerm?: string
}

export interface BundlePersonalization {
  requiredProducts: string[]
  coveredRequiredProducts: string[]
  uncoveredRequiredProducts: string[]
  preferredTags: string[]
  satisfiedPreferredTags: string[]
  excludedProductIds: string[]
  complementarityApplied: string[]
  coveredNeedSlots?: string[]
  uncoveredNeedSlots?: string[]
}

export interface BundlePricing {
  observedSubtotal: number
  ecommercePromotionSavings: number
  smartBundleDemoBenefit: number
  finalTotal: number
  remainingBudget: number
}

export interface CommercialPolicyResult {
  id: string
  label: string
  promotionApplied: boolean
  discountPercent: number
  eligibleSubtotal: number
  reasons: string[]
}

export interface Bundle {
  items: Product[]
  substitutions: Substitution[]
  totalPrice: number
  leftoverBudget: number
  personalization?: BundlePersonalization
  strategy?: PurchaseStrategy
  needSlots?: NeedSlot[]
  pricing?: BundlePricing
  commercialPolicy?: CommercialPolicyResult
  strategyNotice?: string
}

/** Mensaje persistido dentro de una sesión de compra. No contiene razonamiento interno del modelo. */
export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  recommendationId?: string
  products?: Product[]
  action?: string
}

/** Estado acumulativo que se modifica turno a turno sin reconstruir la intención desde cero. */
export interface ConversationState {
  conversationId: string
  category?: string
  budget?: number
  priceIntent?: PriceIntent
  brand?: string
  color?: string
  model?: string
  useCase?: string
  requiredProducts?: string[]
  exclusions?: string[]
  strategy?: PurchaseStrategy
  lastRecommendationId?: string
  lastProducts?: string[]
  hardConstraints: string[]
  softPreferences: string[]
}

/** Lo que el parser de intención extrae de un texto libre del comprador. */
export interface ParsedIntent {
  category: string | null
  maxBudget: number | null
  preferences: string[]
  requiredProducts: string[]
  preferredTags: string[]
  excludedTags: string[]
  avoidedProducts: string[]
  strategy: PurchaseStrategy | null
}
