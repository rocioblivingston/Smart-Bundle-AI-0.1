import type { NeedSlot, Product } from '../types.js'
import { normalizeSearchText } from '../catalog.js'
import { activeComplementarityRules, productMatchesNeed, type ComplementarityRule } from './complementarity.js'

export interface NeedPlan {
  id: string
  category: string
  triggers: string[]
  slots: NeedSlot[]
}

/** Taxonomia de demostracion: reemplazable por la taxonomia propia del retailer. */
export const DEFAULT_NEED_PLANS: NeedPlan[] = [
  {
    id: 'laundry',
    category: 'limpieza',
    triggers: ['lavar ropa', 'lavado de ropa', 'detergente', 'jabon en polvo', 'jabon para ropa'],
    slots: [
      { id: 'laundry-main', required: true, alternatives: ['detergente', 'jabon en polvo', 'jabon para ropa'], priority: 100 },
      { id: 'laundry-care', required: false, alternatives: ['suavizante'], priority: 30 },
      { id: 'laundry-treatment', required: false, alternatives: ['quitamanchas'], priority: 20 },
    ],
  },
  {
    id: 'surface-cleaning',
    category: 'limpieza',
    triggers: ['limpiador', 'limpiar superficies', 'limpieza de casa'],
    slots: [
      { id: 'surface-cleaner', required: true, alternatives: ['limpiador', 'lavandina'], priority: 100 },
      { id: 'surface-application', required: false, alternatives: ['esponja', 'trapo', 'pano'], priority: 30 },
      { id: 'surface-protection', required: false, alternatives: ['guantes'], priority: 20 },
    ],
  },
  {
    id: 'hair-care',
    category: 'cuidado-personal',
    triggers: ['cabello', 'pelo', 'shampoo'],
    slots: [
      { id: 'hair-cleaning', required: true, alternatives: ['shampoo'], priority: 100 },
      { id: 'hair-conditioning', required: false, alternatives: ['acondicionador'], priority: 30 },
      { id: 'hair-treatment', required: false, alternatives: ['tratamiento', 'mascara capilar'], priority: 20 },
    ],
  },
  {
    id: 'notebook-setup',
    category: 'tecnologia',
    triggers: ['notebook', 'computadora portatil'],
    slots: [
      { id: 'notebook-main', required: true, alternatives: ['notebook'], priority: 100 },
      { id: 'notebook-navigation', required: false, alternatives: ['mouse'], priority: 30 },
      { id: 'notebook-support', required: false, alternatives: ['base notebook', 'funda notebook'], priority: 20 },
    ],
  },
  {
    id: 'mouse-setup',
    category: 'tecnologia',
    triggers: ['mouse'],
    slots: [
      { id: 'mouse-main', required: true, alternatives: ['mouse'], priority: 100 },
      { id: 'mouse-surface', required: false, alternatives: ['mousepad'], priority: 30 },
      { id: 'mouse-keyboard', required: false, alternatives: ['teclado'], priority: 20 },
    ],
  },
]

const matchesText = (value: string, target: string): boolean => {
  const normalizedValue = normalizeSearchText(value)
  const normalizedTarget = normalizeSearchText(target)
  return normalizedValue.includes(normalizedTarget) || normalizedTarget.includes(normalizedValue)
}

export function resolveNeedSlots(
  category: string,
  requiredProducts: string[],
  complementarityRules: ComplementarityRule[],
  plans: NeedPlan[] = DEFAULT_NEED_PLANS,
): NeedSlot[] {
  if (requiredProducts.length === 0) return []
  const plan = plans.find((candidate) =>
    candidate.category === category &&
    requiredProducts.some((required) => candidate.triggers.some((trigger) => matchesText(required, trigger))),
  )
  if (plan) return plan.slots.map((slot) => ({ ...slot, alternatives: [...slot.alternatives] }))

  const primarySlots: NeedSlot[] = requiredProducts.map((required, index) => ({
    id: `required-${normalizeSearchText(required).replace(/\s+/g, '-') || index}`,
    required: true,
    alternatives: [required],
    priority: 100 - index,
  }))
  const complements = activeComplementarityRules(category, requiredProducts, complementarityRules)
    .flatMap((rule) => rule.complements.map((alternative, index) => ({
      id: `complement-${normalizeSearchText(alternative).replace(/\s+/g, '-')}`,
      required: false,
      alternatives: [alternative],
      priority: Math.max(1, rule.score * 10 - index),
    })))
  return [...primarySlots, ...new Map(complements.map((slot) => [slot.id, slot])).values()]
}

export function productMatchesSlot(product: Product, slot: NeedSlot): boolean {
  if (product.decisionSignals?.needIds.includes(slot.id)) return true
  return slot.alternatives.some((alternative) => productMatchesNeed(product, alternative))
}
