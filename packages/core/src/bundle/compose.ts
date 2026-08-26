import type {
  Bundle,
  BundleRequest,
  CommercialPolicy,
  CommercialPolicyResult,
  NeedSlot,
  Product,
  PurchaseStrategy,
  Substitution,
} from '../types.js'
import { byCategory, normalizeSearchText } from '../catalog.js'
import { DEFAULT_COMPLEMENTARITY_RULES, productMatchesNeed, type ComplementarityRule } from './complementarity.js'
import { buildBundle } from './knapsack.js'
import { productMatchesSlot, resolveNeedSlots } from './needs.js'
import { evaluateBundlePricing } from './policies.js'

const unique = (values: string[]): string[] => [...new Set(values.map((value) => value.trim()).filter(Boolean))]
const money = (value: number): number => Math.round(value * 100) / 100

function normalizeRequest(
  categoryOrRequest: string | BundleRequest,
  maxBudget?: number,
  preferences: string[] = [],
): BundleRequest {
  if (typeof categoryOrRequest !== 'string') return categoryOrRequest
  return {
    category: categoryOrRequest,
    maxBudget: maxBudget ?? 0,
    preferences,
    requiredProducts: preferences,
    strategy: 'balanced',
  }
}

function isExcluded(product: Product, excludedTags: string[], avoidedProducts: string[]): boolean {
  return [...excludedTags, ...avoidedProducts].some((term) => productMatchesNeed(product, term))
}

function preferenceScore(product: Product, preferredTags: string[], economicThreshold: number): number {
  return preferredTags.reduce((score, preference) => {
    const normalized = normalizeSearchText(preference)
    if (['economico', 'barato', 'ahorro'].includes(normalized)) {
      return score + (product.price <= economicThreshold ? 2 : 0)
    }
    return score + (productMatchesNeed(product, preference) ? 2 : 0)
  }, 0)
}

interface DecisionCandidate {
  items: Product[]
  selectedBySlot: Map<string, Product>
  pricing: ReturnType<typeof evaluateBundlePricing>['pricing']
  policyResult?: CommercialPolicyResult
  requiredPriority: number
  requiredCount: number
  complementPriority: number
  complementCount: number
  strategyScore: number
  preferenceScore: number
  promotionScore: number
  utilityScore: number
  signature: string
}

function compareCandidate(left: DecisionCandidate, right: DecisionCandidate | null): number {
  if (!right) return 1
  const numericOrder: Array<[number, number]> = [
    [left.requiredPriority, right.requiredPriority],
    [left.requiredCount, right.requiredCount],
    [left.complementPriority, right.complementPriority],
    [left.complementCount, right.complementCount],
    [left.strategyScore, right.strategyScore],
    [left.preferenceScore, right.preferenceScore],
    [left.promotionScore, right.promotionScore],
    [left.utilityScore, right.utilityScore],
    [left.pricing.finalTotal, right.pricing.finalTotal],
  ]
  for (const [leftValue, rightValue] of numericOrder) {
    if (leftValue !== rightValue) return leftValue > rightValue ? 1 : -1
  }
  return right.signature.localeCompare(left.signature)
}

function strategyScore(
  strategy: PurchaseStrategy,
  items: Product[],
  finalTotal: number,
  hasQualitySignals: boolean,
): number {
  const value = items.reduce((sum, product) => sum + (product.decisionSignals?.valueScore ?? 0), 0)
  const quality = items.reduce((sum, product) => sum + (product.decisionSignals?.qualityScore ?? 0), 0)
  if (strategy === 'lowest-cost') return -finalTotal
  if (strategy === 'maximize-budget') return finalTotal
  if (strategy === 'quality-first' && hasQualitySignals) return quality
  return value
}

function optimizeNeedSlots(
  products: Product[],
  slots: NeedSlot[],
  request: BundleRequest,
  preferredTags: string[],
  economicThreshold: number,
  policy?: CommercialPolicy,
): DecisionCandidate | null {
  const hasQualitySignals = products.some((product) => product.decisionSignals?.qualityScore != null)
  const candidatesBySlot = slots.map((slot) => products
    .filter((product) => product.inStock !== false && product.price > 0 && productMatchesSlot(product, slot))
    .sort((left, right) => left.id.localeCompare(right.id)))
  let best: DecisionCandidate | null = null

  const visit = (slotIndex: number, selectedBySlot: Map<string, Product>, selectedIds: Set<string>): void => {
    if (slotIndex < slots.length) {
      const slot = slots[slotIndex]
      const candidates = candidatesBySlot[slotIndex]
      const options: Array<Product | null> = slot.required && candidates.length > 0
        ? candidates
        : [null, ...candidates]
      for (const product of options) {
        if (product && selectedIds.has(product.id)) continue
        const nextBySlot = new Map(selectedBySlot)
        const nextIds = new Set(selectedIds)
        if (product) {
          nextBySlot.set(slot.id, product)
          nextIds.add(product.id)
        }
        visit(slotIndex + 1, nextBySlot, nextIds)
      }
      return
    }

    const missingRequired = slots.some((slot) => slot.required && !selectedBySlot.has(slot.id))
    if (missingRequired && [...selectedBySlot.keys()].some((id) => !slots.find((slot) => slot.id === id)?.required)) return
    const items = [...selectedBySlot.values()]
    const evaluated = evaluateBundlePricing(items, request.maxBudget, policy)
    if (evaluated.pricing.finalTotal > request.maxBudget) return

    const requiredSlots = slots.filter((slot) => slot.required && selectedBySlot.has(slot.id))
    const complementSlots = slots.filter((slot) => !slot.required && selectedBySlot.has(slot.id))
    const preference = items.reduce(
      (sum, product) => sum + preferenceScore(product, preferredTags, economicThreshold),
      0,
    )
    const ecommerceSavings = evaluated.pricing.ecommercePromotionSavings
    const smartBenefit = evaluated.pricing.smartBundleDemoBenefit
    const utility = items.reduce((sum, product) =>
      sum + (product.decisionSignals?.valueScore ?? 0) + (product.decisionSignals?.qualityScore ?? 0), 0)
    const candidate: DecisionCandidate = {
      items,
      selectedBySlot,
      pricing: evaluated.pricing,
      policyResult: evaluated.policyResult,
      requiredPriority: requiredSlots.reduce((sum, slot) => sum + slot.priority, 0),
      requiredCount: requiredSlots.length,
      complementPriority: complementSlots.reduce((sum, slot) => sum + slot.priority, 0),
      complementCount: complementSlots.length,
      strategyScore: strategyScore(request.strategy ?? 'balanced', items, evaluated.pricing.finalTotal, hasQualitySignals),
      preferenceScore: preference,
      promotionScore: money(ecommerceSavings + smartBenefit),
      utilityScore: utility,
      signature: items.map((product) => product.id).sort().join('|'),
    }
    if (compareCandidate(candidate, best) > 0) best = candidate
  }

  visit(0, new Map(), new Set())
  return best
}

function openCategoryBundle(
  products: Product[],
  request: BundleRequest,
  preferredTags: string[],
  economicThreshold: number,
  policy?: CommercialPolicy,
): DecisionCandidate {
  const strategy = request.strategy ?? 'balanced'
  let items: Product[]
  if (strategy === 'lowest-cost') {
    items = [...products].filter((product) => product.inStock !== false && product.price > 0)
      .sort((left, right) => left.price - right.price || left.id.localeCompare(right.id)).slice(0, 1)
  } else if (strategy === 'quality-first' && products.some((product) => product.decisionSignals?.qualityScore != null)) {
    items = [...products].filter((product) => product.inStock !== false && product.price > 0 && product.price <= request.maxBudget)
      .sort((left, right) =>
        (right.decisionSignals?.qualityScore ?? 0) - (left.decisionSignals?.qualityScore ?? 0) ||
        left.id.localeCompare(right.id),
      ).slice(0, 1)
  } else {
    items = buildBundle(products, request.maxBudget, (product) => ({
      preference: preferenceScore(product, preferredTags, economicThreshold) + (product.decisionSignals?.valueScore ?? 0),
      complementarity: 0,
    })).items
  }
  const evaluated = evaluateBundlePricing(items, request.maxBudget, policy)
  return {
    items,
    selectedBySlot: new Map(),
    pricing: evaluated.pricing,
    policyResult: evaluated.policyResult,
    requiredPriority: 0,
    requiredCount: 0,
    complementPriority: 0,
    complementCount: 0,
    strategyScore: strategyScore(strategy, items, evaluated.pricing.finalTotal, true),
    preferenceScore: 0,
    promotionScore: money(evaluated.pricing.ecommercePromotionSavings + evaluated.pricing.smartBundleDemoBenefit),
    utilityScore: 0,
    signature: items.map((product) => product.id).sort().join('|'),
  }
}

export function composeBundle(
  catalog: Product[],
  request: BundleRequest,
  complementarityRules?: ComplementarityRule[],
  commercialPolicy?: CommercialPolicy,
): Bundle
export function composeBundle(
  catalog: Product[],
  category: string,
  maxBudget: number,
  preferences?: string[],
  complementarityRules?: ComplementarityRule[],
  commercialPolicy?: CommercialPolicy,
): Bundle
export function composeBundle(
  catalog: Product[],
  categoryOrRequest: string | BundleRequest,
  maxBudgetOrRules?: number | ComplementarityRule[],
  legacyPreferencesOrPolicy: string[] | CommercialPolicy = [],
  legacyRules: ComplementarityRule[] = DEFAULT_COMPLEMENTARITY_RULES,
  legacyPolicy?: CommercialPolicy,
): Bundle {
  const request = normalizeRequest(
    categoryOrRequest,
    typeof maxBudgetOrRules === 'number' ? maxBudgetOrRules : undefined,
    Array.isArray(legacyPreferencesOrPolicy) ? legacyPreferencesOrPolicy : [],
  )
  const rules = Array.isArray(maxBudgetOrRules) ? maxBudgetOrRules : legacyRules
  const policy = typeof categoryOrRequest === 'string'
    ? legacyPolicy
    : (!Array.isArray(legacyPreferencesOrPolicy) ? legacyPreferencesOrPolicy : undefined)
  const requiredProducts = unique(request.requiredProducts?.length ? request.requiredProducts : request.preferences)
  const preferredTags = unique(request.preferredTags ?? [])
  const excludedTags = unique(request.excludedTags ?? [])
  const avoidedProducts = unique(request.avoidedProducts ?? [])
  const categoryProducts = byCategory(catalog, request.category)
  const eligible = categoryProducts.filter((product) => !isExcluded(product, excludedTags, avoidedProducts))
  const eligibleIds = new Set(eligible.map((product) => product.id))
  const excludedProductIds = categoryProducts.filter((product) => !eligibleIds.has(product.id))
    .map((product) => product.id).sort()
  const sortedPrices = eligible.filter((product) => product.inStock !== false && product.price > 0)
    .map((product) => product.price).sort((left, right) => left - right)
  const economicThreshold = sortedPrices[Math.floor((sortedPrices.length - 1) / 2)] ?? 0
  const needSlots = resolveNeedSlots(request.category, requiredProducts, rules)
  const decision = needSlots.length
    ? optimizeNeedSlots(eligible, needSlots, request, preferredTags, economicThreshold, policy)
    : openCategoryBundle(eligible, request, preferredTags, economicThreshold, policy)
  const selected = decision ?? openCategoryBundle([], request, preferredTags, economicThreshold, policy)
  const selectedIds = new Set(selected.items.map((product) => product.id))

  const substitutions: Substitution[] = []
  for (const required of requiredProducts) {
    const matches = categoryProducts.filter((product) => productMatchesNeed(product, required))
    const selectedMatch = selected.items.some((product) => productMatchesNeed(product, required))
    const unavailable = matches.find((product) => product.inStock === false) ??
      (!selectedMatch ? matches.find((product) => product.price > request.maxBudget) : undefined)
    if (!unavailable) continue
    const replacement = selected.items.find((product) =>
      product.id !== unavailable.id &&
      needSlots.some((slot) => slot.required && productMatchesSlot(product, slot)),
    ) ?? null
    substitutions.push({
      outOfStock: unavailable,
      replacement,
      reason: unavailable.inStock === false ? 'out-of-stock' : 'over-budget',
      requestedTerm: required,
    })
  }

  const coveredSlots = needSlots.filter((slot) => selected.selectedBySlot.has(slot.id))
  const uncoveredSlots = needSlots.filter((slot) => !selected.selectedBySlot.has(slot.id))
  const requiredCovered = coveredSlots.filter((slot) => slot.required).length
  const coveredRequiredProducts = requiredCovered > 0
    ? requiredProducts.slice(0, requiredCovered)
    : requiredProducts.filter((required) => selected.items.some((product) => productMatchesNeed(product, required)))
  const uncoveredRequiredProducts = requiredProducts.filter((required) => !coveredRequiredProducts.includes(required))
  const primaryProduct = coveredSlots.find((slot) => slot.required)
    ? selected.selectedBySlot.get(coveredSlots.find((slot) => slot.required)!.id)
    : undefined
  const complementarityApplied = coveredSlots.filter((slot) => !slot.required).map((slot) => {
    const product = selected.selectedBySlot.get(slot.id)!
    return `${primaryProduct?.name ?? 'necesidad principal'} -> ${product.name}`
  })

  return {
    items: selected.items.filter((product) => selectedIds.has(product.id)),
    substitutions,
    totalPrice: selected.pricing.finalTotal,
    leftoverBudget: selected.pricing.remainingBudget,
    pricing: selected.pricing,
    commercialPolicy: selected.policyResult,
    strategyNotice: request.strategy === 'quality-first' &&
      !eligible.some((product) => product.decisionSignals?.qualityScore != null)
      ? 'La estrategia “Priorizar calidad” no puede evaluarse con datos reales del retailer porque el catálogo no publica una señal explícita de calidad.'
      : undefined,
    strategy: request.strategy ?? 'balanced',
    needSlots,
    personalization: {
      requiredProducts,
      coveredRequiredProducts,
      uncoveredRequiredProducts,
      preferredTags,
      satisfiedPreferredTags: preferredTags.filter((preference) =>
        selected.items.some((product) => productMatchesNeed(product, preference)) ||
        (['economico', 'barato', 'ahorro'].includes(normalizeSearchText(preference)) &&
          selected.items.some((product) => product.price <= economicThreshold)),
      ),
      excludedProductIds,
      complementarityApplied,
      coveredNeedSlots: coveredSlots.map((slot) => slot.id),
      uncoveredNeedSlots: uncoveredSlots.map((slot) => slot.id),
    },
  }
}
