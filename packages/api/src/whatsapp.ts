import type { Product } from '@sba/core'

export interface WhatsAppHandoff {
  recommendationId: string
  url: string
  message: string
  prefillSupported: boolean
}

const formatArs = (value: number): string =>
  `$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value)}`

function validatedWhatsAppNumber(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  const number = value.replace(/[^\d]/g, '')
  return /^\d{8,15}$/.test(number) ? number : undefined
}

export function whatsappConfigured(value: string | undefined): boolean {
  return Boolean(validatedWhatsAppNumber(value))
}

export function createWhatsAppHandoff(
  configuredNumber: string | undefined,
  recommendationId: string,
  products: Product[],
): WhatsAppHandoff | undefined {
  const number = validatedWhatsAppNumber(configuredNumber)
  if (!number || products.length === 0) return undefined

  const total = products.reduce((sum, product) => sum + product.price, 0)
  const message = products.length === 1
    ? `Hola, vengo desde Smart Bundle AI. Me interesa esta recomendación: ${products[0].name}, precio publicado ${formatArs(products[0].price)}. Recommendation ID: ${recommendationId}. ¿Me ayudan a continuar la compra?`
    : `Hola, vengo desde Smart Bundle AI. Quiero consultar por este bundle: ${products.map((product) => product.name).join(', ')}. Total observado: ${formatArs(total)}. Recommendation ID: ${recommendationId}.`
  const target = new URL(`https://wa.me/${number}`)
  target.searchParams.set('text', message)

  return {
    recommendationId,
    url: target.toString(),
    message,
    prefillSupported: true,
  }
}
