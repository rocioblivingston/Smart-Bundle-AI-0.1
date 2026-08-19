import Anthropic from '@anthropic-ai/sdk'
import type { Bundle, BundleRequest, Explainer, IntentParser, ParsedIntent } from '@sba/core'
import { PARSE_SYSTEM_PROMPT, EXPLAIN_SYSTEM_PROMPT, StubIntentParser, StubExplainer } from '@sba/core'

const MODEL = 'claude-sonnet-5'

const EXTRACT_INTENT_TOOL: Anthropic.Tool = {
  name: 'extract_intent',
  description: 'Registra la categoría, el presupuesto y las preferencias detectadas en el mensaje.',
  input_schema: {
    type: 'object',
    properties: {
      category: { type: ['string', 'null'], description: 'Una de las categorías disponibles, o null' },
      maxBudget: { type: ['number', 'null'], description: 'Presupuesto máximo en pesos, o null' },
      preferences: { type: 'array', items: { type: 'string' }, description: 'Productos o marcas puntuales nombradas' },
    },
    required: ['category', 'maxBudget', 'preferences'],
  },
}

export class ClaudeIntentParser implements IntentParser {
  constructor(private readonly client: Anthropic) {}

  async parse(freeText: string, availableCategories: string[]): Promise<ParsedIntent> {
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: `${PARSE_SYSTEM_PROMPT}\n\nCategorías disponibles: ${availableCategories.join(', ')}.`,
      tools: [EXTRACT_INTENT_TOOL],
      tool_choice: { type: 'tool', name: 'extract_intent' },
      messages: [{ role: 'user', content: freeText }],
    })

    const call = res.content.find((b) => b.type === 'tool_use')
    if (!call || call.type !== 'tool_use') throw new Error('Claude no devolvió extract_intent')

    const input = call.input as Partial<ParsedIntent>
    return {
      category: input.category ?? null,
      maxBudget: typeof input.maxBudget === 'number' ? input.maxBudget : null,
      preferences: Array.isArray(input.preferences) ? input.preferences : [],
    }
  }
}

export class ClaudeExplainer implements Explainer {
  constructor(private readonly client: Anthropic) {}

  async explain(bundle: Bundle, request: BundleRequest): Promise<string> {
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: EXPLAIN_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify({ request, bundle }) }],
    })
    const text = res.content.find((b) => b.type === 'text')
    return text?.type === 'text' ? text.text : ''
  }
}

/**
 * Cadena de fallback idéntica en espíritu a la de TrackIO: Claude → stub.
 * El comprador nunca se queda sin respuesta, y sin ANTHROPIC_API_KEY el
 * prototipo funciona igual con el stub determinístico.
 */
export function buildAgents(apiKey: string | undefined): {
  parser: IntentParser
  explainer: Explainer
  parse: (freeText: string, categories: string[]) => Promise<{ intent: ParsedIntent; usedAI: boolean }>
  explain: (bundle: Bundle, request: BundleRequest) => Promise<{ text: string; usedAI: boolean }>
} {
  const stubParser = new StubIntentParser()
  const stubExplainer: Explainer = new StubExplainer()

  if (!apiKey) {
    return {
      parser: stubParser,
      explainer: stubExplainer,
      parse: async (t, c) => ({ intent: await stubParser.parse(t, c), usedAI: false }),
      explain: async (b, r) => ({ text: await stubExplainer.explain(b, r), usedAI: false }),
    }
  }

  const client = new Anthropic({ apiKey })
  const claudeParser = new ClaudeIntentParser(client)
  const claudeExplainer = new ClaudeExplainer(client)

  return {
    parser: claudeParser,
    explainer: claudeExplainer,
    parse: async (freeText, categories) => {
      try {
        return { intent: await claudeParser.parse(freeText, categories), usedAI: true }
      } catch {
        return { intent: await stubParser.parse(freeText, categories), usedAI: false }
      }
    },
    explain: async (bundle, request) => {
      try {
        const text = await claudeExplainer.explain(bundle, request)
        if (text.trim()) return { text, usedAI: true }
      } catch {
        // cae al stub abajo
      }
      return { text: await stubExplainer.explain(bundle, request), usedAI: false }
    },
  }
}
