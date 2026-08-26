import { describe, expect, it } from 'vitest'
import { composeBundle } from '../../src/bundle/compose.js'
import type { BundleRequest, CommercialPolicy, Product, PurchaseStrategy } from '../../src/types.js'

const product = (
  id: string,
  price: number,
  needId: string,
  qualityScore?: number,
  valueScore?: number,
  extra: Partial<Product> = {},
): Product => ({
  id,
  name: id.replaceAll('-', ' '),
  category: 'limpieza',
  price,
  inStock: true,
  tags: [needId === 'laundry-main' ? 'detergente' : needId === 'laundry-care' ? 'suavizante' : 'quitamanchas'],
  decisionSignals: { needIds: [needId], qualityScore, valueScore },
  ...extra,
})

const catalog: Product[] = [
  product('det-cheap', 700, 'laundry-main', 30, 50),
  product('det-balanced', 1100, 'laundry-main', 70, 100),
  product('det-quality', 1400, 'laundry-main', 95, 70),
  product('det-splurge', 1600, 'laundry-main', 80, 60),
  product('soft-cheap', 500, 'laundry-care', 30, 50),
  product('soft-balanced', 800, 'laundry-care', 70, 100),
  product('soft-quality', 1100, 'laundry-care', 95, 70),
  product('soft-splurge', 1200, 'laundry-care', 80, 60),
  product('stain-cheap', 600, 'laundry-treatment', 30, 50),
  product('stain-balanced', 900, 'laundry-treatment', 70, 100),
  product('stain-quality', 1000, 'laundry-treatment', 95, 70),
  product('stain-splurge', 1150, 'laundry-treatment', 80, 60),
]

const request = (strategy: PurchaseStrategy): BundleRequest => ({
  category: 'limpieza',
  maxBudget: 4000,
  preferences: [],
  requiredProducts: ['lavar ropa'],
  strategy,
})

const ids = (strategy: PurchaseStrategy): string[] =>
  composeBundle(catalog, request(strategy)).items.map((item) => item.id)

describe('motor de decision Caso 3', () => {
  it('produce cuatro decisiones observables con el mismo catalogo y presupuesto', () => {
    expect(ids('lowest-cost')).toEqual(['det-cheap', 'soft-cheap', 'stain-cheap'])
    expect(ids('balanced')).toEqual(['det-balanced', 'soft-balanced', 'stain-balanced'])
    expect(ids('quality-first')).toEqual(['det-quality', 'soft-quality', 'stain-quality'])
    expect(ids('maximize-budget')).toEqual(['det-splurge', 'soft-splurge', 'stain-splurge'])
  })

  it('lowest-cost devuelve la solucion completa mas barata y maximize-budget usa mas presupuesto', () => {
    const cheap = composeBundle(catalog, request('lowest-cost'))
    const maximum = composeBundle(catalog, request('maximize-budget'))
    expect(cheap.totalPrice).toBe(1800)
    expect(maximum.totalPrice).toBe(3950)
    expect(maximum.totalPrice).toBeGreaterThan(cheap.totalPrice)
  })

  it('quality-first solo cambia por calidad cuando existen señales explicitas', () => {
    const withoutQuality = catalog.map((item) => ({
      ...item,
      decisionSignals: { needIds: item.decisionSignals!.needIds, valueScore: item.decisionSignals!.valueScore },
    }))
    const balanced = composeBundle(withoutQuality, request('balanced')).items.map((item) => item.id)
    const quality = composeBundle(withoutQuality, request('quality-first')).items.map((item) => item.id)
    expect(quality).toEqual(balanced)
    expect(ids('quality-first')).not.toEqual(ids('balanced'))
  })

  it('cubre la necesidad principal y no duplica alternativas equivalentes', () => {
    for (const strategy of ['lowest-cost', 'balanced', 'quality-first', 'maximize-budget'] as const) {
      const bundle = composeBundle(catalog, request(strategy))
      expect(bundle.personalization?.coveredNeedSlots).toContain('laundry-main')
      expect(bundle.items).toHaveLength(3)
      const roles = bundle.items.map((item) => item.decisionSignals!.needIds[0])
      expect(new Set(roles).size).toBe(roles.length)
      expect(bundle.totalPrice).toBeLessThanOrEqual(4000)
    }
  })

  it('un cambio de stock reejecuta el motor y produce otra canasta con sustitucion real', () => {
    const explicitRequest: BundleRequest = {
      ...request('quality-first'),
      requiredProducts: ['detergente'],
    }
    const before = composeBundle(catalog, explicitRequest)
    const changed = catalog.map((item) => item.id === 'det-quality' ? { ...item, inStock: false } : item)
    const after = composeBundle(changed, explicitRequest)
    expect(before.items.map((item) => item.id)).toContain('det-quality')
    expect(after.items.map((item) => item.id)).not.toContain('det-quality')
    expect(after.substitutions[0].replacement?.id).toBe('det-splurge')
    expect(after.items.map((item) => item.id)).toContain('det-splurge')
    expect(after.totalPrice).toBe(after.items.reduce((sum, item) => sum + item.price, 0))
  })
})

describe('politicas comerciales de demostracion', () => {
  const policy: CommercialPolicy = {
    id: 'demo-10',
    label: 'Políticas comerciales de demostración',
    maxBundleDiscountPercent: 10,
    minItemsForPromotion: 3,
    excludedProductIds: [],
    excludedCategories: [],
    allowStackingWithRetailerPromotions: false,
  }

  it('aplica beneficio solo cuando se alcanza el minimo de productos', () => {
    const eligible = composeBundle(catalog, request('lowest-cost'), undefined, policy)
    const blocked = composeBundle(catalog, request('lowest-cost'), undefined, { ...policy, minItemsForPromotion: 4 })
    expect(eligible.pricing?.smartBundleDemoBenefit).toBe(180)
    expect(eligible.totalPrice).toBe(1620)
    expect(blocked.pricing?.smartBundleDemoBenefit).toBe(0)
    expect(blocked.totalPrice).toBe(1800)
  })

  it('no acumula el beneficio sobre un producto ya promocionado por el ecommerce', () => {
    const promoted = catalog.map((item) => item.id === 'det-cheap' ? { ...item, listPrice: 900 } : item)
    const bundle = composeBundle(promoted, request('lowest-cost'), undefined, policy)
    expect(bundle.pricing?.ecommercePromotionSavings).toBe(200)
    expect(bundle.commercialPolicy?.eligibleSubtotal).toBe(1100)
    expect(bundle.pricing?.smartBundleDemoBenefit).toBe(110)
    expect(bundle.totalPrice).toBe(1690)
  })

  it('productos y categorias excluidos no reciben beneficio', () => {
    const productExcluded = composeBundle(catalog, request('lowest-cost'), undefined, {
      ...policy,
      excludedProductIds: ['soft-cheap'],
    })
    const categoryExcluded = composeBundle(catalog, request('lowest-cost'), undefined, {
      ...policy,
      excludedCategories: ['limpieza'],
    })
    expect(productExcluded.commercialPolicy?.eligibleSubtotal).toBe(1300)
    expect(productExcluded.pricing?.smartBundleDemoBenefit).toBe(130)
    expect(categoryExcluded.pricing?.smartBundleDemoBenefit).toBe(0)
    expect(categoryExcluded.commercialPolicy?.promotionApplied).toBe(false)
  })

  it('el total final coincide con subtotal menos beneficios y nunca supera presupuesto', () => {
    const bundle = composeBundle(catalog, request('maximize-budget'), undefined, policy)
    expect(bundle.totalPrice).toBe(
      Math.round((bundle.pricing!.observedSubtotal - bundle.pricing!.smartBundleDemoBenefit) * 100) / 100,
    )
    expect(bundle.totalPrice).toBeLessThanOrEqual(request('maximize-budget').maxBudget)
    expect(bundle.leftoverBudget).toBe(4000 - bundle.totalPrice)
  })
})
