const queryApi = new URLSearchParams(window.location.search).get('api')
const standaloneLocalWeb = ['localhost', '127.0.0.1'].includes(window.location.hostname) && ['5500', '5701'].includes(window.location.port)
const apiBase = queryApi ?? (standaloneLocalWeb ? 'http://localhost:3001' : window.location.origin)
const API = apiBase.replace(/\/$/, '')
const endpoints = { health: `${API}/health`, products: `${API}/products`, bundle: `${API}/bundle` }

const CATEGORY_LABELS = { limpieza: 'Limpieza', tecnologia: 'Tecnología', 'cuidado-personal': 'Cuidado personal', zapatillas: 'Zapatillas' }
const STRATEGY_LABELS = { 'lowest-cost': 'Más económico', balanced: 'Equilibrado', 'quality-first': 'Priorizar calidad', 'maximize-budget': 'Aprovechar presupuesto' }
const priceFormatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 })

const elements = {
  nav: document.getElementById('category-nav'), grid: document.getElementById('product-grid'), message: document.getElementById('catalog-message'),
  badge: document.getElementById('source-badge'), heroSignal: document.getElementById('hero-signal'), drawerIntro: document.getElementById('drawer-intro'),
  searchForm: document.getElementById('search-form'), search: document.getElementById('store-search'), launcher: document.getElementById('agent-launcher'),
  heroLauncher: document.getElementById('hero-agent-button'), drawer: document.getElementById('agent-drawer'), backdrop: document.getElementById('drawer-backdrop'),
  close: document.getElementById('drawer-close'), thread: document.getElementById('chat-thread'), chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'), chatSubmit: document.getElementById('chat-submit'), typing: document.getElementById('typing-indicator'),
  manual: document.getElementById('manual-config'), form: document.getElementById('bundle-form'), category: document.getElementById('bundle-category'),
  budget: document.getElementById('budget-number'), required: document.getElementById('required-product'), preferences: document.getElementById('preferences'),
  submit: document.getElementById('submit-btn'), hint: document.getElementById('form-hint'), result: document.getElementById('result'),
  empty: document.getElementById('empty-result'), error: document.getElementById('error'),
  accept: document.getElementById('accept-recommendation'), cart: document.querySelector('.cart-button'),
}

let selectedCategory = 'limpieza'
let lastFocusedElement = null
let lastBundleResponse = null
let conversationId = null
let requestInFlight = false

function sourceLabel(catalog) {
  if (catalog?.source === 'lenaldi') return 'Catálogo: Lenaldi — datos públicos del sitio'
  if (catalog?.source === 'vtex') return 'Demo con catálogo público VTEX'
  if (catalog?.source === 'local-fallback') return 'Modo demostración — catálogo local (respaldo)'
  return 'Modo demostración — catálogo local'
}

function renderSource(catalog) {
  elements.badge.textContent = sourceLabel(catalog)
  const sourceClass = catalog?.source === 'vtex' ? 'source-badge--vtex' : catalog?.source === 'lenaldi' ? 'source-badge--lenaldi' : 'source-badge--local'
  elements.badge.className = `source-badge ${sourceClass}`
  const lenaldi = catalog?.source === 'lenaldi'
  elements.heroSignal.textContent = lenaldi ? 'Presupuesto + preferencias + datos públicos' : 'Presupuesto + preferencias + stock real'
  elements.drawerIntro.textContent = lenaldi
    ? 'Decime qué zapatillas buscás y cuánto querés gastar. Voy a interpretar tu pedido y comparar los datos públicos disponibles.'
    : 'Decime qué necesitás y cuánto querés gastar. Voy a interpretar tu pedido y reoptimizar cada respuesta.'
}

function renderLoading() {
  elements.grid.replaceChildren(...Array.from({ length: 8 }, () => {
    const card = document.createElement('div')
    card.className = 'skeleton'
    card.setAttribute('aria-hidden', 'true')
    return card
  }))
  elements.message.textContent = 'Cargando productos…'
}

function productCard(product) {
  const card = document.createElement('article')
  card.className = 'product-card'
  const media = document.createElement('div')
  media.className = 'product-media'
  if (product.listPrice > product.price) {
    const tag = document.createElement('span')
    tag.className = 'promo-tag'
    tag.textContent = 'Precio promocional'
    media.appendChild(tag)
  }
  if (product.imageUrl) {
    const image = document.createElement('img')
    image.src = product.imageUrl
    image.alt = product.name
    image.loading = 'lazy'
    media.appendChild(image)
  } else {
    const placeholder = document.createElement('span')
    placeholder.className = 'product-placeholder'
    placeholder.textContent = '📦'
    placeholder.setAttribute('aria-hidden', 'true')
    media.appendChild(placeholder)
  }
  const body = document.createElement('div')
  body.className = 'product-body'
  const category = document.createElement('p')
  category.className = 'product-category'
  category.textContent = CATEGORY_LABELS[product.category] ?? product.category
  const name = product.productUrl ? document.createElement('a') : document.createElement('span')
  name.className = 'product-name'
  name.textContent = product.name
  if (product.productUrl) { name.href = product.productUrl; name.target = '_blank'; name.rel = 'noreferrer' }
  const seller = document.createElement('p')
  seller.className = 'seller'
  seller.textContent = product.seller ? `Vendido por ${product.seller}` : product.source === 'lenaldi' ? `Marca: ${product.brand ?? 'no informada'}` : 'Producto de demostración'
  const priceBlock = document.createElement('div')
  priceBlock.className = 'price-block'
  const oldPrice = document.createElement('del')
  oldPrice.className = 'old-price'
  oldPrice.textContent = product.listPrice > product.price ? priceFormatter.format(product.listPrice) : ''
  const price = document.createElement('span')
  price.className = 'price'
  price.textContent = priceFormatter.format(product.price)
  const availability = document.createElement('span')
  availability.className = 'availability'
  availability.textContent = product.inStock == null ? 'Disponibilidad no informada por la tienda' : product.inStock ? 'Disponible' : 'Sin stock'
  if (product.inStock == null) availability.classList.add('availability--unknown')
  priceBlock.append(oldPrice, price, availability)
  const useButton = document.createElement('button')
  useButton.className = 'use-product'
  useButton.type = 'button'
  useButton.disabled = product.inStock === false
  useButton.textContent = product.inStock === false ? 'No disponible' : 'Pedirle al agente'
  useButton.addEventListener('click', () => {
    selectedCategory = product.category
    elements.category.value = product.category
    elements.required.value = product.name
    elements.chatInput.value = `Quiero ${product.name}`
    openDrawer()
  })
  body.append(category, name, seller, priceBlock, useButton)
  if (product.orderUrl) {
    const orderLink = document.createElement('a')
    orderLink.className = 'order-link'
    orderLink.href = product.orderUrl
    orderLink.target = '_blank'
    orderLink.rel = 'noreferrer'
    orderLink.textContent = 'Hacé tu pedido'
    body.appendChild(orderLink)
  }
  card.append(media, body)
  return card
}

async function loadProducts(search = '') {
  renderLoading()
  try {
    const query = new URLSearchParams({ category: selectedCategory })
    if (search) query.set('search', search)
    const response = await fetch(`${endpoints.products}?${query}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'No se pudo cargar el catálogo')
    renderSource(data.catalog)
    elements.grid.replaceChildren(...data.products.map(productCard))
    elements.message.textContent = data.products.length
      ? data.catalog?.source === 'lenaldi'
        ? `${data.products.length} resultado${data.products.length === 1 ? '' : 's'} del catálogo público${search ? ` para “${search}”` : ''}.`
        : `${data.products.length} producto${data.products.length === 1 ? '' : 's'} disponible${data.products.length === 1 ? '' : 's'}${search ? ` para “${search}”` : ''}.`
      : `No encontramos resultados${search ? ` para “${search}”` : ''}.`
  } catch (error) {
    elements.grid.replaceChildren()
    elements.message.textContent = `No se pudo consultar el catálogo: ${error.message}`
    elements.badge.textContent = 'API no disponible'
    elements.badge.className = 'source-badge source-badge--local'
  }
}

function selectCategory(category) {
  selectedCategory = category
  elements.category.value = category
  ;[...elements.nav.children].forEach((button) => button.setAttribute('aria-current', String(button.dataset.category === category)))
  elements.search.value = ''
  updateCategoryCopy(category)
  loadProducts()
}

function updateCategoryCopy(category) {
  const footwear = category === 'zapatillas'
  elements.required.placeholder = footwear ? 'Ej: Nike Dunk' : 'Ej: detergente'
  elements.preferences.placeholder = footwear ? 'Ej: claras, casual, uso diario' : 'Ej: económico, sin perfume, no lavandina'
  elements.hint.textContent = footwear ? 'Podés indicar marca, color, modelo, presupuesto, estilo o uso.' : 'Podés escribir “económico”, “sin perfume” o “no lavandina”.'
  elements.budget.min = footwear ? '10000' : '100'
  elements.budget.step = footwear ? '1000' : '100'
  if (footwear && Number(elements.budget.value) < 10000) elements.budget.value = '75000'
}

async function initialize() {
  renderLoading()
  try {
    const response = await fetch(endpoints.health)
    const health = await response.json()
    if (!response.ok) throw new Error('API no disponible')
    selectedCategory = health.categories.includes('zapatillas') ? 'zapatillas' : health.categories.includes('limpieza') ? 'limpieza' : health.categories[0]
    elements.nav.replaceChildren(...health.categories.map((category) => {
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'category-link'; button.dataset.category = category
      button.textContent = CATEGORY_LABELS[category] ?? category
      button.setAttribute('aria-current', String(category === selectedCategory))
      button.addEventListener('click', () => selectCategory(category))
      return button
    }))
    elements.category.replaceChildren(...health.categories.map((category) => {
      const option = document.createElement('option')
      option.value = category; option.textContent = CATEGORY_LABELS[category] ?? category; option.selected = category === selectedCategory
      return option
    }))
    updateCategoryCopy(selectedCategory)
    await loadProducts()
  } catch (error) {
    elements.grid.replaceChildren()
    elements.message.textContent = `No se pudo conectar con la API (${error.message}). Levantala con npm run dev:api.`
    elements.badge.textContent = 'API no disponible'
  }
}

function openDrawer() {
  lastFocusedElement = document.activeElement
  elements.drawer.hidden = false; elements.backdrop.hidden = false
  document.body.classList.add('drawer-open')
  requestAnimationFrame(() => elements.chatInput.focus())
}
function closeDrawer() {
  elements.drawer.hidden = true; elements.backdrop.hidden = true
  document.body.classList.remove('drawer-open')
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus()
}

function parsePreferences(value) {
  const preferredTags = [], excludedTags = [], avoidedProducts = []
  for (const part of value.split(',').map((item) => item.trim()).filter(Boolean)) {
    const avoided = part.match(/\b(?:no quiero|no|evitar?)\s+(.+)$/i)
    const excluded = part.match(/\bsin\s+(.+)$/i)
    if (avoided) avoidedProducts.push(avoided[1].trim())
    else if (excluded) excludedTags.push(excluded[1].trim())
    else if (/\b(econ[oó]mico|barato|ahorro)\b/i.test(part)) preferredTags.push('economico')
    else preferredTags.push(part.replace(/^(quiero|prefiero|busco)\s+(productos?\s+)?/i, '').trim())
  }
  return { preferredTags, excludedTags, avoidedProducts }
}

function conversationalPayload(message) {
  return { ...(conversationId ? { conversationId } : {}), freeText: message }
}
function actionPayload(strategy, label, tryAlternative = false) {
  if (!conversationId || !lastBundleResponse) return null
  return {
    conversationId,
    freeText: label,
    strategy,
    action: tryAlternative ? 'alternative' : 'strategy',
  }
}

function appendChatMessage(role, text) {
  const message = document.createElement('article')
  message.className = `chat-message chat-message--${role}`
  if (role === 'assistant') {
    const avatar = document.createElement('span')
    avatar.className = 'chat-avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = 'AI'
    message.appendChild(avatar)
  }
  const bubble = document.createElement('div')
  bubble.className = 'chat-bubble'
  const paragraph = document.createElement('p')
  paragraph.textContent = text
  bubble.appendChild(paragraph); message.appendChild(bubble)
  elements.thread.insertBefore(message, elements.typing)
  scrollChat()
}

function renderWhatsAppHandoff(data) {
  conversationId = data.conversationId
  const article = document.createElement('article')
  article.className = 'chat-message chat-message--assistant whatsapp-handoff'
  const avatar = document.createElement('span')
  avatar.className = 'chat-avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = 'AI'
  const bubble = document.createElement('div')
  bubble.className = 'chat-bubble whatsapp-handoff__bubble'
  const heading = document.createElement('strong')
  heading.textContent = data.confirmation
  const message = document.createElement('p')
  message.textContent = data.message
  bubble.append(heading, message)

  if (!data.whatsappHandoff.prefillSupported) {
    const note = document.createElement('p')
    note.className = 'whatsapp-handoff__note'
    note.textContent = 'El canal no admite texto prearmado. Copiá este mensaje y pegalo al abrir WhatsApp:'
    const preview = document.createElement('textarea')
    preview.className = 'whatsapp-handoff__message'
    preview.readOnly = true
    preview.rows = 4
    preview.value = data.whatsappHandoff.message
    const copy = document.createElement('button')
    copy.type = 'button'; copy.className = 'whatsapp-copy'; copy.textContent = 'Copiar mensaje'
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(data.whatsappHandoff.message)
        copy.textContent = 'Mensaje copiado'
      } catch {
        preview.focus(); preview.select(); copy.textContent = 'Seleccionado para copiar'
      }
    })
    bubble.append(note, preview, copy)
  }

  const link = document.createElement('a')
  link.className = 'whatsapp-continue'
  link.href = data.whatsappHandoff.url
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.textContent = 'Continuar compra por WhatsApp'
  link.addEventListener('click', () => {
    if (!data.whatsappHandoff.prefillSupported) {
      navigator.clipboard?.writeText(data.whatsappHandoff.message).catch(() => {})
    }
    fetch(`${API}/conversations/${encodeURIComponent(data.conversationId)}/whatsapp-click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recommendationId: data.recommendationId }),
      keepalive: true,
    }).catch(() => {})
  })
  bubble.appendChild(link)
  article.append(avatar, bubble)
  elements.thread.insertBefore(article, elements.typing)

  const count = data.cart?.items?.length ?? 0
  elements.cart.querySelector('b').textContent = String(count)
  elements.cart.setAttribute('aria-label', `Carrito Smart Bundle, ${count} producto${count === 1 ? '' : 's'}`)
  elements.cart.title = 'Selección preparada para continuar por WhatsApp'
  scrollChat()
}
function scrollChat() { requestAnimationFrame(() => { elements.thread.scrollTop = elements.thread.scrollHeight }) }
function hideBundleStates() { elements.result.hidden = true; elements.empty.hidden = true; elements.error.hidden = true }
function archiveCurrentRecommendation() {
  if (elements.result.hidden) return
  const archived = elements.result.cloneNode(true)
  archived.removeAttribute('id')
  archived.classList.add('bundle-result--history')
  archived.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'))
  archived.querySelector('.decision-actions')?.remove()
  archived.querySelector('.accept-recommendation')?.remove()
  const heading = archived.querySelector('.result-heading h3')
  if (heading) heading.textContent = 'Recomendación anterior'
  elements.thread.insertBefore(archived, elements.typing)
  elements.result.hidden = true
}
function setBusy(busy) {
  requestInFlight = busy
  elements.chatSubmit.disabled = busy; elements.submit.disabled = busy; elements.typing.hidden = !busy
  elements.chatSubmit.querySelector('span').textContent = busy ? 'Analizando' : 'Enviar'
  elements.submit.dataset.loading = String(busy)
  elements.submit.querySelector('.btn-label').textContent = busy ? 'Analizando…' : 'Aplicar configuración'
  if (busy) scrollChat()
}

function renderBundleItem(item) {
  const row = document.createElement('li')
  if (item.imageUrl) {
    const image = document.createElement('img')
    image.className = 'bundle-item-image'; image.src = item.imageUrl; image.alt = ''; image.loading = 'lazy'
    row.appendChild(image)
  }
  const description = document.createElement('div')
  const name = item.productUrl ? document.createElement('a') : document.createElement('span')
  name.className = 'bundle-item-name'; name.textContent = item.name
  if (item.productUrl) { name.href = item.productUrl; name.target = '_blank'; name.rel = 'noreferrer' }
  const meta = document.createElement('span')
  meta.className = 'bundle-item-meta'
  const brand = item.brand ? `${item.brand} · ` : ''
  const availability = item.inStock == null ? 'Disponibilidad no informada por la tienda' : item.inStock ? 'Disponible' : 'Sin stock'
  meta.textContent = `${brand}${item.seller ? `Vendido por ${item.seller}` : availability}`
  description.append(name, meta)
  if (item.orderUrl) {
    const order = document.createElement('a')
    order.className = 'bundle-item-order'; order.href = item.orderUrl; order.target = '_blank'; order.rel = 'noreferrer'; order.textContent = 'Hacé tu pedido'
    description.appendChild(order)
  }
  const price = document.createElement('span')
  price.className = 'bundle-item-price'; price.textContent = priceFormatter.format(item.price)
  row.append(description, price)
  return row
}

function renderPriceAlternative(candidate, targetPrice) {
  const card = document.createElement('div')
  card.className = 'price-alternative'
  const name = candidate.product.productUrl ? document.createElement('a') : document.createElement('strong')
  name.textContent = candidate.product.name
  if (candidate.product.productUrl) {
    name.href = candidate.product.productUrl
    name.target = '_blank'
    name.rel = 'noreferrer'
  }
  const tradeoff = document.createElement('span')
  tradeoff.textContent = candidate.exact
    ? `Coincide exactamente con ${priceFormatter.format(targetPrice)}`
    : `${priceFormatter.format(candidate.absoluteDifference)} ${candidate.aboveTarget ? 'por encima' : 'por debajo'} · ${candidate.differencePercent}% de diferencia`
  const price = document.createElement('span')
  price.className = 'price-alternative__price'
  price.textContent = priceFormatter.format(candidate.price)
  card.append(name, tradeoff, price)
  return card
}

function renderBundle(data) {
  hideBundleStates()
  lastBundleResponse = data
  conversationId = data.conversationId
  if (!data.bundle.items.length && !data.commercialResponse) {
    appendChatMessage('assistant', data.explanation || `Entendí tu pedido, pero no encontré una opción que entre en ${priceFormatter.format(data.request.maxBudget)}. Probá cambiando una preferencia o el presupuesto.`)
    return
  }
  elements.result.hidden = false
  const targetPrice = data.request.priceIntent?.targetPrice
  const budgetMax = data.request.priceIntent?.budgetMax
  elements.result.querySelector('.result-heading h3').textContent = data.commercialResponse && !data.commercialResponse.exactMatch
    ? 'Encontré estas opciones cercanas'
    : 'Encontré esta opción para vos'
  const strategyLabel = STRATEGY_LABELS[data.bundle.strategy] ?? data.bundle.strategy ?? 'Equilibrado'
  const preferenceText = data.request.preferredTags?.length ? ` Preferencias: ${data.request.preferredTags.join(', ')}.` : ''
  const priceUnderstanding = targetPrice
    ? `precio objetivo ${priceFormatter.format(targetPrice)}${budgetMax ? ` y máximo ${priceFormatter.format(budgetMax)}` : ''}`
    : `hasta ${priceFormatter.format(data.request.maxBudget)}`
  document.getElementById('understood').textContent = `Entendí: ${CATEGORY_LABELS[data.request.category] ?? data.request.category}, ${priceUnderstanding}.${preferenceText} Estrategia: ${strategyLabel.toLowerCase()}.`
  document.getElementById('explanation').textContent = data.explanation
  const strategyNotice = document.getElementById('strategy-notice')
  strategyNotice.textContent = data.bundle.strategyNotice ?? ''; strategyNotice.hidden = !data.bundle.strategyNotice
  document.getElementById('engine-badge').textContent = data.intentSource === 'gemini'
    ? 'intención: Gemini'
    : 'fallback: reglas'
  document.getElementById('recommendation-id').textContent = data.recommendationId
  const details = data.bundle.personalization ?? {}
  const chips = [
    ...(details.coveredRequiredProducts ?? []).map((value) => `Incluye: ${value}`),
    ...(details.satisfiedPreferredTags ?? []).map((value) => `Preferencia: ${value}`),
    ...(details.complementarityApplied ?? []).map((value) => `Complemento: ${value.replace(' -> ', ' + ')}`),
  ]
  document.getElementById('personalization').replaceChildren(...chips.map((text) => { const chip = document.createElement('span'); chip.textContent = text; return chip }))
  document.getElementById('items').replaceChildren(...data.bundle.items.map(renderBundleItem))
  const selectedIds = new Set(data.bundle.items.map((item) => item.id))
  const priceAlternatives = document.getElementById('price-alternatives')
  const alternativeCandidates = (data.commercialResponse?.alternatives ?? [])
    .filter((candidate) => !selectedIds.has(candidate.product.id))
    .slice(0, 3)
  priceAlternatives.replaceChildren(...alternativeCandidates.map((candidate) => renderPriceAlternative(candidate, targetPrice)))
  priceAlternatives.hidden = alternativeCandidates.length === 0
  const commercialActions = document.getElementById('commercial-actions')
  commercialActions.hidden = !data.commercialResponse
  const brandButton = commercialActions.querySelector('[data-price-action="maintain-brand"]')
  if (brandButton) brandButton.textContent = data.conversation.state.brand ? `Mantener ${data.conversation.state.brand}` : 'Mantener preferencias'
  document.getElementById('subs').replaceChildren(...data.bundle.substitutions.map((substitution) => {
    const note = document.createElement('p'); note.className = 'sub-note'
    note.textContent = substitution.replacement ? `Reemplazamos ${substitution.outOfStock.name} por ${substitution.replacement.name} y lo incluimos en la selección.` : `No encontramos reemplazo para ${substitution.requestedTerm ?? substitution.outOfStock.name}.`
    return note
  }))
  const used = data.bundle.totalPrice + data.bundle.leftoverBudget
  const pricing = data.bundle.pricing ?? { observedSubtotal: data.bundle.totalPrice, ecommercePromotionSavings: 0, smartBundleDemoBenefit: 0, finalTotal: data.bundle.totalPrice, remainingBudget: data.bundle.leftoverBudget }
  const pricingRows = [
    ['Subtotal con precios observados', pricing.observedSubtotal, false], ['Ahorro promocional del ecommerce', -pricing.ecommercePromotionSavings, true],
    ['Beneficio Smart Bundle demo', -pricing.smartBundleDemoBenefit, true], ['Total final', pricing.finalTotal, false],
  ]
  document.getElementById('pricing-breakdown').replaceChildren(...pricingRows.flatMap(([label, value, benefit]) => {
    const term = document.createElement('dt'); term.textContent = label
    const amount = document.createElement('dd'); amount.textContent = priceFormatter.format(value); if (benefit && value) amount.className = 'benefit'
    return [term, amount]
  }))
  const hasPricedSelection = data.bundle.items.length > 0
  document.getElementById('pricing-breakdown').hidden = !hasPricedSelection
  elements.result.querySelector('.budget-track').hidden = !hasPricedSelection
  elements.result.querySelector('.total-row').hidden = !hasPricedSelection
  document.getElementById('policy-result').hidden = !hasPricedSelection
  document.getElementById('budget-fill').style.width = `${used ? Math.min(100, (data.bundle.totalPrice / used) * 100) : 0}%`
  document.getElementById('total-label').textContent = `Total ${priceFormatter.format(data.bundle.totalPrice)}`
  document.getElementById('leftover-label').textContent = `Margen ${priceFormatter.format(data.bundle.leftoverBudget)}`
  const policy = data.bundle.commercialPolicy
  document.getElementById('policy-result').textContent = policy ? `${policy.label}: ${policy.promotionApplied ? `beneficio válido del ${policy.discountPercent}%` : 'sin beneficio aplicable en esta combinación'}.` : 'Sin política promocional configurada.'
  elements.accept.hidden = !hasPricedSelection
  document.getElementById('result-source').textContent = sourceLabel(data.catalog)
  scrollChat()
}

async function sendBundle(payload, userLabel) {
  if (requestInFlight) return
  archiveCurrentRecommendation()
  hideBundleStates()
  if (userLabel) appendChatMessage('user', userLabel)
  setBusy(true)
  try {
    const response = await fetch(endpoints.bundle, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'No se pudo crear la recomendación')
    if (data.whatsappHandoff) renderWhatsAppHandoff(data)
    else renderBundle(data)
  } catch (error) {
    appendChatMessage('assistant', `No pude completar la recomendación: ${error.message}`)
  } finally {
    setBusy(false); scrollChat()
  }
}

elements.searchForm.addEventListener('submit', (event) => { event.preventDefault(); loadProducts(elements.search.value.trim()) })
elements.launcher.addEventListener('click', openDrawer)
elements.heroLauncher.addEventListener('click', openDrawer)
elements.close.addEventListener('click', closeDrawer)
elements.backdrop.addEventListener('click', closeDrawer)
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !elements.drawer.hidden) closeDrawer() })
elements.category.addEventListener('change', () => { selectedCategory = elements.category.value; updateCategoryCopy(selectedCategory) })

elements.chatForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const message = elements.chatInput.value.trim()
  if (!message) return
  elements.chatInput.value = ''
  await sendBundle(conversationalPayload(message), message)
})
elements.chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); elements.chatForm.requestSubmit() }
})
elements.accept.addEventListener('click', async () => {
  await sendBundle(conversationalPayload('quiero ese'), 'Quiero este')
})
document.querySelectorAll('[data-chat-prompt]').forEach((button) => {
  button.addEventListener('click', () => { elements.chatInput.value = button.dataset.chatPrompt; elements.chatForm.requestSubmit() })
})

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const required = elements.required.value.trim(), preferenceText = elements.preferences.value.trim()
  const preferences = parsePreferences(preferenceText)
  const payload = { ...(conversationId ? { conversationId } : {}), category: elements.category.value, maxBudget: Number(elements.budget.value), requiredProducts: required ? [required] : [], freeText: preferenceText || undefined, ...preferences }
  const description = `Configuración manual: ${required || CATEGORY_LABELS[payload.category] || payload.category}, hasta ${priceFormatter.format(payload.maxBudget)}${preferenceText ? `, ${preferenceText}` : ''}`
  elements.manual.open = false
  await sendBundle(payload, description)
})

document.querySelectorAll('.decision-actions button').forEach((button) => {
  button.addEventListener('click', async () => {
    if (button.dataset.composePreference === 'true') {
      archiveCurrentRecommendation()
      hideBundleStates()
      appendChatMessage('assistant', 'Perfecto. Decime qué marca, color, modelo, estilo o uso querés cambiar.')
      elements.chatInput.placeholder = 'Ej: ahora prefiero Adidas negras'
      elements.chatInput.focus()
      return
    }
    const label = button.textContent.trim()
    const payload = actionPayload(button.dataset.strategy, label, button.dataset.alternative === 'true')
    if (payload) await sendBundle(payload, label)
  })
})

document.querySelectorAll('.commercial-actions button').forEach((button) => {
  button.addEventListener('click', async () => {
    const brand = lastBundleResponse?.conversation?.state?.brand
    const message = button.dataset.priceAction === 'maintain-brand'
      ? `Mantené ${brand || 'las preferencias'} y dame otra opción cercana a ese precio`
      : button.dataset.priceAction === 'maintain-price'
        ? 'Otra marca, mantené ese precio'
        : 'Dame otra opción cercana a ese precio'
    await sendBundle(conversationalPayload(message), button.textContent.trim())
  })
})

initialize()
