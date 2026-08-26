import { describe, expect, it, vi } from 'vitest'
import { buildAgents } from '../src/adapters/gemini.js'

const geminiPayload = {
  candidates: [{
    content: {
      parts: [{
        text: JSON.stringify({
          category: 'zapatillas',
          maxBudget: 80000,
          requiredProducts: ['zapatillas'],
          preferredTags: ['nike', 'claras', 'uso diario'],
          excludedTags: [],
          avoidedProducts: [],
          strategy: null,
        }),
      }],
    },
  }],
}

describe('adaptador Gemini', () => {
  it('usa Gemini y reporta telemetría de éxito sin incluir la key en la URL', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(geminiPayload), { status: 200 }))
    const agents = buildAgents('fake-gemini-key', { fetchFn })
    const result = await agents.parse(
      'Tengo $80.000 y quiero unas Nike claras para uso diario',
      ['zapatillas'],
    )
    expect(result.intent).toMatchObject({ category: 'zapatillas', maxBudget: 80000 })
    expect(result.intent.preferredTags).toEqual(['nike', 'claras', 'uso diario'])
    expect(result.telemetry).toEqual({
      geminiConfigured: true,
      providerAttempted: true,
      providerSucceeded: true,
      fallbackUsed: false,
      intentSource: 'gemini',
    })
    const [url, init] = fetchFn.mock.calls[0]
    expect(String(url)).not.toContain('fake-gemini-key')
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('fake-gemini-key')
  })

  it('usa reglas y lo informa si Gemini falla', async () => {
    const fetchFn: typeof fetch = async () => new Response('no autorizado', { status: 401 })
    const agents = buildAgents('fake-gemini-key', { fetchFn })
    const result = await agents.parse(
      'Tengo $80.000 y quiero unas Nike claras para uso diario',
      ['zapatillas'],
    )
    expect(result.intent).toMatchObject({ category: 'zapatillas', maxBudget: 80000 })
    expect(result.telemetry).toEqual({
      geminiConfigured: true,
      providerAttempted: true,
      providerSucceeded: false,
      fallbackUsed: true,
      intentSource: 'rules',
    })
  })

  it('intenta un segundo modelo Gemini ante limite transitorio', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('cuota temporal', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(geminiPayload), { status: 200 }))
    const agents = buildAgents('fake-gemini-key', { fetchFn })
    const result = await agents.parse(
      'Tengo hasta $80.000 y quiero unas Nike claras para uso diario',
      ['zapatillas'],
    )
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(String(fetchFn.mock.calls[0][0])).toContain('gemini-3.5-flash-lite')
    expect(String(fetchFn.mock.calls[1][0])).toContain('gemini-3.6-flash')
    expect(result.telemetry).toMatchObject({
      providerSucceeded: true,
      fallbackUsed: false,
      intentSource: 'gemini',
    })
  })
})
