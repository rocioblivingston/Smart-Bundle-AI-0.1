import { describe, expect, it } from 'vitest'
import { conversationAction, parsePriceIntent } from '../src/conversation.js'

describe('PriceIntent conversacional', () => {
  it('interpreta hasta 90000 como presupuesto máximo', () => {
    expect(parsePriceIntent('Tengo hasta $90.000', {}, 90000)).toEqual({ budgetMax: 90000 })
    expect(parsePriceIntent('No puedo gastar más de 90000', {}, 90000)).toEqual({ budgetMax: 90000 })
  })

  it('interpreta alrededor o cerca de 90000 como precio objetivo', () => {
    expect(parsePriceIntent('Quiero gastar alrededor de $90.000', {}, 90000)).toEqual({
      targetPrice: 90000,
      targetTolerancePercent: 10,
    })
    expect(parsePriceIntent('Buscame una cercana a 90000', {}, 90000)).toEqual({
      targetPrice: 90000,
      targetTolerancePercent: 10,
    })
  })

  it('toma el primer monto como objetivo y detecta el rechazo de la recomendación anterior', () => {
    expect(parsePriceIntent('Quiero una de $90.000, no la de $79.000', {}, 90000)).toEqual({
      targetPrice: 90000,
      targetTolerancePercent: 10,
    })
    expect(conversationAction('Quiero una de $90.000, no la de $79.000')).toBe('recommendation-rejected')
  })

  it('resuelve ese precio contra el estado previo', () => {
    expect(parsePriceIntent('Dame una cercana a ese precio', { budgetMax: 50000 })).toEqual({
      budgetMax: 50000,
      targetPrice: 50000,
      targetTolerancePercent: 10,
    })
  })

  it('detecta la aceptación comercial sin confundirla con una alternativa', () => {
    expect(conversationAction('quiero ese')).toBe('recommendation-accepted')
    expect(conversationAction('me quedo con ese')).toBe('recommendation-accepted')
    expect(conversationAction('comprar')).toBe('recommendation-accepted')
    expect(conversationAction('continuar')).toBe('recommendation-accepted')
  })
})
