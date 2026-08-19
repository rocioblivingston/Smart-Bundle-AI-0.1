import express, { type Express } from 'express'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { categoriesOf, composeBundle, type Product } from '@sba/core'
import { buildAgents } from './adapters/claude.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function loadCatalog(): Product[] {
  const raw = readFileSync(join(__dirname, '..', 'src', 'data', 'catalog.json'), 'utf-8')
  return JSON.parse(raw) as Product[]
}

/**
 * Punto de entrada único que llama n8n vía HTTP Request. Contiene la única
 * lógica que un test unitario no puede cubrir (parsear JSON, responder HTTP);
 * todo lo demás ya vive testeado en @sba/core.
 */
export function buildApp(catalog: Product[], apiKey: string | undefined): Express {
  const agents = buildAgents(apiKey)
  const categories = categoriesOf(catalog)

  const app = express()
  app.use(express.json())

  app.get('/health', (_req, res) => {
    res.json({ ok: true, categories, aiEnabled: Boolean(apiKey) })
  })

  app.post('/bundle', async (req, res) => {
    const body = req.body as {
      freeText?: string
      category?: string
      maxBudget?: number
      preferences?: string[]
    }

    let category = body.category ?? null
    let maxBudget = body.maxBudget ?? null
    // Las preferencias explícitas del body (n8n, un form estructurado) tienen
    // prioridad; si no vienen, se completan con lo que extraiga el parser.
    let preferences: string[] = body.preferences ?? []
    let usedAI = false

    if (body.freeText && body.freeText.trim()) {
      const { intent, usedAI: ai } = await agents.parse(body.freeText, categories)
      category ??= intent.category
      maxBudget ??= intent.maxBudget
      if (preferences.length === 0) preferences = intent.preferences
      usedAI = ai
    }

    if (!category || !categories.includes(category)) {
      res.status(400).json({ error: `categoría inválida o faltante. Disponibles: ${categories.join(', ')}` })
      return
    }
    if (!maxBudget || maxBudget <= 0) {
      res.status(400).json({ error: 'presupuesto inválido o faltante' })
      return
    }

    const bundle = composeBundle(catalog, category, maxBudget, preferences)
    const request = { category, maxBudget, preferences }
    const { text: explanation, usedAI: explainAI } = await agents.explain(bundle, request)

    res.json({ request, bundle, explanation, usedAI: usedAI || explainAI })
  })

  return app
}
