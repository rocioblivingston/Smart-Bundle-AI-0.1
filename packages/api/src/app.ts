import express, { type Express } from 'express'
import { fileURLToPath } from 'node:url'
import {
  composeBundle,
  DEMO_COMMERCIAL_POLICY,
  DEFAULT_COMPLEMENTARITY_RULES,
  findClosestPriceCandidates,
  matchByKeyword,
  productMatchesNeed,
  resolveNeedSlots,
  type BundleRequest,
  type ParsedIntent,
  type Product,
  type PurchaseStrategy,
} from '@sba/core'
import { buildAgents, type IntentProviderTelemetry } from './adapters/gemini.js'
import { LocalCatalogAdapter, type CatalogAdapter } from './adapters/catalog.js'
import {
  conversationAction,
  InMemoryConversationStore,
  updateConversationState,
} from './conversation.js'
import catalogData from './data/catalog.json' with { type: 'json' }
import { createWhatsAppHandoff, whatsappConfigured } from './whatsapp.js'

export function loadCatalog(): Product[] {
  return catalogData as Product[]
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
    : []
const PURCHASE_STRATEGIES = new Set<PurchaseStrategy>([
  'lowest-cost', 'balanced', 'quality-first', 'maximize-budget',
])

const ars = (value: number): string => `$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(value)}`

function preferredPricePool(products: Product[], preferredTags: string[]): Product[] {
  if (!preferredTags.length) return products
  const scored = products.map((product) => ({
    product,
    score: preferredTags.filter((preference) => productMatchesNeed(product, preference)).length,
  }))
  const bestScore = Math.max(0, ...scored.map((item) => item.score))
  return bestScore > 0 ? scored.filter((item) => item.score === bestScore).map((item) => item.product) : []
}

function commercialPriceResponse(
  targetPrice: number,
  preferred: ReturnType<typeof findClosestPriceCandidates>,
  global: ReturnType<typeof findClosestPriceCandidates>,
) {
  const lines: string[] = []
  if (preferred.exact) {
    lines.push(`Encontré una opción de ${ars(targetPrice)} que coincide con lo que pediste.`)
  } else {
    lines.push(`No encontré una opción exacta de ${ars(targetPrice)} con las preferencias actuales.`)
    if (preferred.closestBelow) {
      lines.push(`La más cercana por debajo cuesta ${ars(preferred.closestBelow.price)}, es decir ${ars(preferred.closestBelow.absoluteDifference)} menos.`)
    }
    if (preferred.closestAbove) {
      lines.push(`La más cercana por encima cuesta ${ars(preferred.closestAbove.price)}, ${ars(preferred.closestAbove.absoluteDifference)} más.`)
    }
  }
  const preferredIds = new Set(preferred.candidates.map((candidate) => candidate.product.id))
  const crossPreference = global.candidates.find((candidate) => !preferredIds.has(candidate.product.id))
  if (crossPreference) {
    const direction = crossPreference.difference > 0 ? 'por encima' : crossPreference.difference < 0 ? 'por debajo' : 'exactamente en el precio'
    lines.push(`También hay ${crossPreference.product.name} por ${ars(crossPreference.price)} (${direction}) si querés flexibilizar una preferencia.`)
  }
  lines.push('¿Qué preferís priorizar?')
  return {
    exactMatch: Boolean(preferred.exact),
    message: lines.join(' '),
    alternatives: [...preferred.candidates, ...global.candidates]
      .filter((candidate, index, values) => values.findIndex((item) => item.product.id === candidate.product.id) === index)
      .slice(0, 4),
  }
}

const catalogMetadata = (catalog: Awaited<ReturnType<CatalogAdapter['getCatalog']>>) => ({
  configuredProvider: catalog.provider,
  source: catalog.source,
  label: catalog.label,
  searchTerm: catalog.searchTerm,
  fallbackReason: catalog.fallbackReason,
  cacheHit: catalog.cacheHit,
})

const WEB_DIRECTORY = fileURLToPath(new URL('../../web', import.meta.url))

function isLocalDevelopmentOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

function configuredFrontendOrigins(value: string | undefined): Set<string> {
  return new Set((value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean))
}

export function buildApp(
  catalogOrAdapter: Product[] | CatalogAdapter,
  geminiApiKey: string | undefined,
  lenaldiWhatsAppNumber?: string,
  frontendOrigin?: string,
): Express {
  const catalogAdapter = Array.isArray(catalogOrAdapter)
    ? new LocalCatalogAdapter(catalogOrAdapter)
    : catalogOrAdapter
  const agents = buildAgents(geminiApiKey)
  const categories = catalogAdapter.categories()
  const conversations = new InMemoryConversationStore()
  const allowedFrontendOrigins = configuredFrontendOrigins(frontendOrigin)
  const app = express()

  app.use(express.json())
  app.use((req, res, next) => {
    const origin = req.get('Origin')?.replace(/\/$/, '')
    if (!origin) {
      next()
      return
    }
    if (!isLocalDevelopmentOrigin(origin) && !allowedFrontendOrigins.has(origin)) {
      res.status(403).json({ error: 'Origen no permitido' })
      return
    }
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Vary', 'Origin')
    next()
  })
  app.options('*', (_req, res) => res.sendStatus(204))

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      categories,
      aiEnabled: agents.geminiConfigured,
      geminiConfigured: agents.geminiConfigured,
      aiProvider: 'gemini',
      catalogProvider: catalogAdapter.provider,
      whatsappConfigured: whatsappConfigured(lenaldiWhatsAppNumber),
    })
  })

  app.get('/products', async (req, res) => {
    const requestedCategory = typeof req.query.category === 'string' ? req.query.category : ''
    const category = categories.includes(requestedCategory)
      ? requestedCategory
      : categories.includes('limpieza') ? 'limpieza' : categories[0]
    if (!category) {
      res.status(503).json({ error: 'No hay categorias configuradas' })
      return
    }
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : ''
    const catalog = await catalogAdapter.getCatalog({
      category,
      preferences: search ? [search] : [],
      requiredProducts: search ? [search] : [],
    })
    const categoryProducts = catalog.products.filter((product) => product.category === category)
    const products = search ? matchByKeyword(categoryProducts, search) : categoryProducts
    res.json({ products: products.slice(0, 24), catalog: catalogMetadata(catalog) })
  })

  app.get('/conversations/:conversationId', (req, res) => {
    const session = conversations.get(req.params.conversationId)
    if (!session) {
      res.status(404).json({ error: 'Conversación no encontrada' })
      return
    }
    res.json({
      conversationId: session.state.conversationId,
      state: session.state,
      messages: session.messages,
      events: session.events,
    })
  })

  app.post('/conversations/:conversationId/whatsapp-click', (req, res) => {
    const session = conversations.get(req.params.conversationId)
    if (!session) {
      res.status(404).json({ error: 'Conversación no encontrada' })
      return
    }
    const recommendationId = typeof req.body?.recommendationId === 'string'
      ? req.body.recommendationId.trim().slice(0, 100)
      : ''
    const recommendation = [...session.messages].reverse().find((message) =>
      message.recommendationId === recommendationId && message.action === 'recommendation-generated')
    if (!recommendation?.products?.length) {
      res.status(409).json({ error: 'Recomendación no disponible para continuar' })
      return
    }
    conversations.track(session, 'whatsapp_handoff_clicked', recommendationId, recommendation.products)
    res.status(204).send()
  })

  app.post('/bundle', async (req, res) => {
    const body = req.body as Record<string, unknown>
    const requestedConversationId = typeof body.conversationId === 'string'
      ? body.conversationId.trim().slice(0, 100)
      : undefined
    const existingSession = requestedConversationId ? conversations.get(requestedConversationId) : undefined
    if (requestedConversationId && !existingSession) {
      res.status(404).json({ error: 'Conversación no encontrada' })
      return
    }
    const session = existingSession ?? conversations.getOrCreate()
    const freeText = typeof body.freeText === 'string' ? body.freeText.trim().slice(0, 2000) : ''
    const action = freeText ? conversationAction(freeText) : undefined

    if (action === 'recommendation-accepted') {
      conversations.append(session, 'user', freeText, { action })
      const recommendationId = session.state.lastRecommendationId
      const recommendation = recommendationId
        ? [...session.messages].reverse().find((message) =>
          message.recommendationId === recommendationId && message.action === 'recommendation-generated')
        : undefined
      const products = recommendation?.products ?? []
      if (!recommendationId || products.length === 0) {
        res.status(409).json({
          error: 'Primero necesitás elegir una recomendación para continuar.',
          conversationId: session.state.conversationId,
        })
        return
      }
      const handoff = createWhatsAppHandoff(lenaldiWhatsAppNumber, recommendationId, products)
      if (!handoff) {
        res.status(503).json({
          error: 'La continuidad por WhatsApp no está configurada.',
          conversationId: session.state.conversationId,
        })
        return
      }

      conversations.track(session, 'recommendation_accepted', recommendationId, products)
      conversations.track(session, 'whatsapp_handoff_created', recommendationId, products)
      const confirmation = 'Perfecto, te preparo esta opción.'
      const message = 'Ya está. Podés continuar la compra directamente con Lenaldi por WhatsApp.'
      conversations.append(session, 'assistant', `${confirmation} ${message}`, {
        recommendationId,
        products,
        action: 'whatsapp-handoff-ready',
      })
      res.json({
        conversationId: session.state.conversationId,
        recommendationId,
        accepted: true,
        confirmation,
        message,
        cart: {
          items: products,
          total: products.reduce((sum, product) => sum + product.price, 0),
        },
        whatsappHandoff: handoff,
      })
      return
    }
    const explicitCategory = typeof body.category === 'string' ? body.category : null
    const explicitBudget = typeof body.maxBudget === 'number' ? body.maxBudget : null
    const legacyPreferences = stringList(body.preferences)
    const explicitRequiredProducts = stringList(body.requiredProducts)
    const explicitPreferredTags = stringList(body.preferredTags)
    const explicitExcludedTags = stringList(body.excludedTags)
    let avoidedProducts = stringList(body.avoidedProducts)
    const explicitStrategy = typeof body.strategy === 'string' && PURCHASE_STRATEGIES.has(body.strategy as PurchaseStrategy)
      ? body.strategy as PurchaseStrategy
      : null
    let providerTelemetry: IntentProviderTelemetry = {
      geminiConfigured: agents.geminiConfigured,
      providerAttempted: false,
      providerSucceeded: false,
      fallbackUsed: false,
      intentSource: 'rules',
    }
    let parsedIntent: ParsedIntent | null = null

    if (freeText) {
      const categoryContext = explicitCategory ?? session.state.category
      const contextualText = categoryContext ? `${categoryContext}. ${freeText}` : freeText
      const parsed = await agents.parse(contextualText, categories)
      parsedIntent = parsed.intent
      providerTelemetry = parsed.telemetry
      conversations.append(session, 'user', freeText, { action: conversationAction(freeText) })
    }

    session.state = updateConversationState(session.state, freeText, parsedIntent, {
      category: explicitCategory,
      budget: explicitBudget,
      requiredProducts: explicitRequiredProducts.length ? explicitRequiredProducts : legacyPreferences,
      preferredTags: explicitPreferredTags,
      exclusions: explicitExcludedTags,
      strategy: explicitStrategy,
    })

    const category = session.state.category ?? null
    const maxBudget = session.state.budget ?? null
    const requiredProducts = session.state.requiredProducts ?? []
    const preferredTags = session.state.softPreferences
    const excludedTags = session.state.exclusions ?? []
    const strategy = session.state.strategy ?? 'balanced'
    if ((action === 'alternative-requested' || action === 'recommendation-rejected') && session.state.lastProducts?.[0]) {
      avoidedProducts = [...new Set([...avoidedProducts, session.state.lastProducts[0]])]
    }

    if (!category || !categories.includes(category)) {
      res.status(400).json({
        error: `categoria invalida o faltante. Disponibles: ${categories.join(', ')}`,
        conversationId: session.state.conversationId,
      })
      return
    }
    const targetPrice = session.state.priceIntent?.targetPrice
    if ((!maxBudget || maxBudget <= 0 || !Number.isFinite(maxBudget)) && !targetPrice) {
      res.status(400).json({ error: 'presupuesto o precio objetivo invalido o faltante', conversationId: session.state.conversationId })
      return
    }

    const needSlots = resolveNeedSlots(
      category,
      requiredProducts,
      DEFAULT_COMPLEMENTARITY_RULES,
    )
    const complementarySearchTerms = needSlots.map((slot) => slot.alternatives[0]).filter(Boolean)
    const catalog = await catalogAdapter.getCatalog({
      category,
      preferences: [...requiredProducts, ...preferredTags],
      requiredProducts,
      searchTerms: [...new Set([...requiredProducts, ...complementarySearchTerms])],
    })
    let priceSearch: ReturnType<typeof findClosestPriceCandidates> | undefined
    let commercialResponse: ReturnType<typeof commercialPriceResponse> | undefined
    let selectedForTarget: Product | undefined
    if (targetPrice) {
      const excludedIds = new Set(avoidedProducts)
      const eligible = catalog.products.filter((product) =>
        product.category === category &&
        product.inStock !== false &&
        !excludedIds.has(product.id) &&
        !excludedTags.some((term) => productMatchesNeed(product, term)))
      const preferredPool = preferredPricePool(eligible, preferredTags)
      priceSearch = findClosestPriceCandidates(preferredPool, targetPrice, { maxResults: 6 })
      const globalPriceSearch = findClosestPriceCandidates(eligible, targetPrice, { maxResults: 6 })
      commercialResponse = commercialPriceResponse(targetPrice, priceSearch, globalPriceSearch)
      selectedForTarget = maxBudget
        ? priceSearch.candidates.find((candidate) => candidate.price <= maxBudget)?.product
        : priceSearch.candidates[0]?.product
    }

    const effectiveMaxBudget = maxBudget ?? selectedForTarget?.price ?? targetPrice ?? 0
    const request: BundleRequest = {
      category,
      maxBudget: effectiveMaxBudget,
      preferences: requiredProducts,
      requiredProducts,
      preferredTags,
      excludedTags,
      avoidedProducts,
      strategy,
      priceIntent: session.state.priceIntent,
    }
    const bundle = targetPrice
      ? composeBundle(selectedForTarget ? [selectedForTarget] : [], request, [], DEMO_COMMERCIAL_POLICY)
      : composeBundle(catalog.products, request, DEFAULT_COMPLEMENTARITY_RULES, DEMO_COMMERCIAL_POLICY)
    const explained = commercialResponse
      ? { text: commercialResponse.message, usedAI: false }
      : await agents.explain(bundle, request)
    const recommendationId = conversations.recommendationId()
    session.state.lastRecommendationId = recommendationId
    session.state.lastProducts = bundle.items.map((product) => product.id)
    const groundedProducts = commercialResponse
      ? commercialResponse.alternatives.map((candidate) => candidate.product)
      : bundle.items
    conversations.append(session, 'assistant', explained.text, {
      recommendationId,
      products: groundedProducts,
      action: commercialResponse
        ? commercialResponse.exactMatch ? 'target-price-exact' : 'target-price-alternatives'
        : bundle.items.length ? 'recommendation-generated' : 'no-exact-result',
    })
    if (bundle.items.length) {
      conversations.track(session, 'recommendation_created', recommendationId, bundle.items)
    }

    res.json({
      conversationId: session.state.conversationId,
      recommendationId,
      conversation: {
        state: session.state,
        messages: session.messages,
      },
      request,
      bundle,
      priceSearch,
      commercialResponse,
      catalog: catalogMetadata(catalog),
      explanation: explained.text,
      usedAI: providerTelemetry.intentSource === 'gemini',
      geminiConfigured: providerTelemetry.geminiConfigured,
      providerAttempted: providerTelemetry.providerAttempted,
      providerSucceeded: providerTelemetry.providerSucceeded,
      fallbackUsed: providerTelemetry.fallbackUsed,
      intentSource: providerTelemetry.intentSource,
    })
  })

  // En producción la misma URL HTTPS sirve API y landing. Esto evita exponer
  // secretos en el navegador y permite embeber la página publicada en Google Sites.
  app.use(express.static(WEB_DIRECTORY))

  return app
}
