import express, { type Express } from 'express'
import { categoriesOf, composeBundle, type Product } from '@sba/core'
import { buildAgents } from './adapters/claude.js'
import catalogData from './data/catalog.json' with { type: 'json' }

/**
 * Import estático, no `fs.readFileSync`. Un `readFileSync` con una ruta
 * armada en runtime no lo traza el bundler de Vercel (@vercel/nft solo seguí
 * el grafo de imports) — el JSON quedaría afuera del deploy serverless y la
 * API tiraría ENOENT en producción aunque local funcione perfecto.
 */
export function loadCatalog(): Product[] {
  return catalogData as Product[]
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

  // CORS abierto: es un prototipo, la web y la API son orígenes distintos
  // tanto en local (5500 vs 3001) como deployadas (dos proyectos de Vercel).
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    next()
  })
  app.options('*', (_req, res) => res.sendStatus(204))

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
