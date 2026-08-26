import type {
  BundlePricing,
  CommercialPolicy,
  CommercialPolicyResult,
  Product,
} from '../types.js'

const money = (value: number): number => Math.round(value * 100) / 100

export const DEMO_COMMERCIAL_POLICY: CommercialPolicy = {
  id: 'smart-bundle-demo-5',
  label: 'Políticas comerciales de demostración',
  maxBundleDiscountPercent: 5,
  minItemsForPromotion: 3,
  excludedProductIds: [],
  excludedCategories: ['tecnologia'],
  allowStackingWithRetailerPromotions: false,
}

export function evaluateBundlePricing(
  items: Product[],
  maxBudget: number,
  policy?: CommercialPolicy,
): { pricing: BundlePricing; policyResult?: CommercialPolicyResult } {
  const observedSubtotal = money(items.reduce((sum, product) => sum + product.price, 0))
  const ecommercePromotionSavings = money(items.reduce(
    (sum, product) => sum + Math.max(0, (product.listPrice ?? product.price) - product.price),
    0,
  ))

  if (!policy) {
    return {
      pricing: {
        observedSubtotal,
        ecommercePromotionSavings,
        smartBundleDemoBenefit: 0,
        finalTotal: observedSubtotal,
        remainingBudget: money(Math.max(0, maxBudget - observedSubtotal)),
      },
    }
  }

  const reasons: string[] = []
  const enoughItems = items.length >= policy.minItemsForPromotion
  if (!enoughItems) reasons.push(`Requiere al menos ${policy.minItemsForPromotion} productos`)
  const eligibleItems = items.filter((product) => {
    if (policy.excludedProductIds.includes(product.id)) return false
    if (policy.excludedCategories.includes(product.category)) return false
    const alreadyPromoted = (product.listPrice ?? product.price) > product.price
    return policy.allowStackingWithRetailerPromotions || !alreadyPromoted
  })
  if (eligibleItems.length !== items.length) reasons.push('Hay productos excluidos o con promocion no acumulable')
  const eligibleSubtotal = money(eligibleItems.reduce((sum, product) => sum + product.price, 0))
  const discountPercent = Math.max(0, Math.min(100, policy.maxBundleDiscountPercent))
  const promotionApplied = enoughItems && eligibleSubtotal > 0 && discountPercent > 0
  const smartBundleDemoBenefit = promotionApplied ? money(eligibleSubtotal * discountPercent / 100) : 0
  const finalTotal = money(Math.max(0, observedSubtotal - smartBundleDemoBenefit))

  return {
    pricing: {
      observedSubtotal,
      ecommercePromotionSavings,
      smartBundleDemoBenefit,
      finalTotal,
      remainingBudget: money(Math.max(0, maxBudget - finalTotal)),
    },
    policyResult: {
      id: policy.id,
      label: policy.label,
      promotionApplied,
      discountPercent: promotionApplied ? discountPercent : 0,
      eligibleSubtotal,
      reasons,
    },
  }
}
