import type { Bundle, BundleRequest, Explainer, IntentParser, ParsedIntent, PurchaseStrategy } from '@sba/core'
import { EXPLAIN_SYSTEM_PROMPT, PARSE_SYSTEM_PROMPT, StubExplainer, StubIntentParser } from '@sba/core'

const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const FALLBACK_MODEL = 'gemini-3.6-flash'
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const STRATEGIES = new Set<PurchaseStrategy>(['lowest-cost', 'balanced', 'quality-first', 'maximize-budget'])

export interface IntentProviderTelemetry {
  geminiConfigured: boolean
  providerAttempted: boolean
  providerSucceeded: boolean
  fallbackUsed: boolean
  intentSource: 'gemini' | 'rules'
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
}

interface GeminiClientOptions {
  fetchFn?: typeof fetch
  model?: string
  timeoutMs?: number
}

const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
  : []

function sanitizedFailure(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout'
  if (error instanceof SyntaxError) return 'respuesta inválida'
  if (error instanceof Error) {
    const http = error.message.match(/HTTP \d{3}/)?.[0]
    if (http) return http
    if (/contenido utilizable/i.test(error.message)) return 'respuesta sin contenido'
  }
  return 'error de proveedor'
}

function responseText(response: GeminiResponse): string {
  const text = response.candidates?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text)
    .find((part): part is string => typeof part === 'string' && part.trim().length > 0)
  if (!text) throw new Error('Gemini no devolvió contenido utilizable')
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

export class GeminiClient {
  private readonly fetchFn: typeof fetch
  private readonly models: string[]
  private readonly timeoutMs: number

  constructor(private readonly apiKey: string, options: GeminiClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch
    this.models = options.model ? [options.model] : [DEFAULT_MODEL, FALLBACK_MODEL]
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  async generate(systemInstruction: string, prompt: string, responseSchema?: Record<string, unknown>): Promise<string> {
    const request = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: responseSchema ? 1_200 : 700,
          thinkingConfig: { thinkingLevel: 'minimal' },
          ...(responseSchema ? { responseMimeType: 'application/json', responseSchema } : {}),
        },
      }),
    }
    let lastError: unknown = new Error('Gemini no respondió')
    for (const model of this.models) {
      try {
        const response = await this.fetchFn(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
          ...request,
          signal: AbortSignal.timeout(this.timeoutMs),
        })
        if (response.ok) return responseText(await response.json() as GeminiResponse)
        lastError = new Error(`Gemini respondió HTTP ${response.status}`)
        if ([400, 401, 403, 404].includes(response.status)) throw lastError
      } catch (error) {
        lastError = error
        if (error instanceof Error && /HTTP (400|401|403|404)/.test(error.message)) throw error
      }
    }
    throw lastError
  }
}

const INTENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    category: { type: 'STRING', nullable: true },
    maxBudget: { type: 'NUMBER', nullable: true },
    requiredProducts: { type: 'ARRAY', items: { type: 'STRING' } },
    preferredTags: { type: 'ARRAY', items: { type: 'STRING' } },
    excludedTags: { type: 'ARRAY', items: { type: 'STRING' } },
    avoidedProducts: { type: 'ARRAY', items: { type: 'STRING' } },
    strategy: {
      type: 'STRING',
      nullable: true,
      enum: ['lowest-cost', 'balanced', 'quality-first', 'maximize-budget'],
    },
  },
  required: ['category', 'maxBudget', 'requiredProducts', 'preferredTags', 'excludedTags', 'avoidedProducts', 'strategy'],
}

export class GeminiIntentParser implements IntentParser {
  constructor(private readonly client: GeminiClient) {}

  async parse(freeText: string, availableCategories: string[]): Promise<ParsedIntent> {
    const raw = await this.client.generate(
      `${PARSE_SYSTEM_PROMPT}\n\nCategorías disponibles: ${availableCategories.join(', ')}.`,
      freeText,
      INTENT_SCHEMA,
    )
    const input = JSON.parse(raw) as Record<string, unknown>
    const category = typeof input.category === 'string' && availableCategories.includes(input.category)
      ? input.category
      : null
    const requiredProducts = strings(input.requiredProducts)
    const maxBudget = typeof input.maxBudget === 'number' && Number.isFinite(input.maxBudget) && input.maxBudget > 0
      ? input.maxBudget
      : null
    return {
      category,
      maxBudget,
      preferences: requiredProducts,
      requiredProducts,
      preferredTags: strings(input.preferredTags),
      excludedTags: strings(input.excludedTags),
      avoidedProducts: strings(input.avoidedProducts),
      strategy: typeof input.strategy === 'string' && STRATEGIES.has(input.strategy as PurchaseStrategy)
        ? input.strategy as PurchaseStrategy
        : null,
    }
  }
}

export class GeminiExplainer implements Explainer {
  constructor(private readonly client: GeminiClient) {}

  async explain(bundle: Bundle, request: BundleRequest): Promise<string> {
    return this.client.generate(EXPLAIN_SYSTEM_PROMPT, JSON.stringify({ request, bundle }))
  }
}

const rulesTelemetry = (configured: boolean, attempted: boolean): IntentProviderTelemetry => ({
  geminiConfigured: configured,
  providerAttempted: attempted,
  providerSucceeded: false,
  fallbackUsed: configured,
  intentSource: 'rules',
})

export function buildAgents(apiKey: string | undefined, options: GeminiClientOptions = {}) {
  const stubParser = new StubIntentParser()
  const stubExplainer: Explainer = new StubExplainer()
  const configured = Boolean(apiKey?.trim())
  const client = configured ? new GeminiClient(apiKey!.trim(), options) : null
  const geminiParser = client ? new GeminiIntentParser(client) : null

  return {
    geminiConfigured: configured,
    parser: geminiParser ?? stubParser,
    explainer: stubExplainer,
    parse: async (freeText: string, categories: string[]) => {
      if (!geminiParser) {
        return { intent: await stubParser.parse(freeText, categories), telemetry: rulesTelemetry(false, false) }
      }
      try {
        const intent = await geminiParser.parse(freeText, categories)
        return {
          intent,
          telemetry: {
            geminiConfigured: true,
            providerAttempted: true,
            providerSucceeded: true,
            fallbackUsed: false,
            intentSource: 'gemini' as const,
          },
        }
      } catch (error) {
        console.warn(`[Gemini] interpretación no disponible (${sanitizedFailure(error)}); usando fallback por reglas.`)
        return { intent: await stubParser.parse(freeText, categories), telemetry: rulesTelemetry(true, true) }
      }
    },
    // La intención usa Gemini; la explicación se construye con datos del motor
    // para no introducir presupuestos, stock o descuentos que el retailer no informó.
    explain: async (bundle: Bundle, request: BundleRequest) => ({
      text: await stubExplainer.explain(bundle, request),
      source: 'rules' as const,
    }),
  }
}
