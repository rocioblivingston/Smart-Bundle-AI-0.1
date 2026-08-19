// Apunta directo a la API por default: hace que la demo funcione siempre,
// sin depender de que n8n esté corriendo y con el workflow activo.
// Para probar el camino real (web -> n8n -> API), cambiá esta constante por
// la URL del webhook de n8n/smart-bundle-workflow.json.
const ENDPOINT = 'http://localhost:3001/bundle'
const HEALTH_ENDPOINT = 'http://localhost:3001/health'

const CATEGORY_LABELS = {
  'limpieza': '🧽 Limpieza',
  'tecnologia': '💻 Tecnología',
  'cuidado-personal': '🧴 Cuidado personal',
}

const statusEl = document.getElementById('status')
const chipsEl = document.getElementById('category-chips')
const budgetSlider = document.getElementById('budget-slider')
const budgetNumber = document.getElementById('budget-number')
const form = document.getElementById('bundle-form')
const submitBtn = document.getElementById('submit-btn')
const resultEl = document.getElementById('result')
const emptyResultEl = document.getElementById('empty-result')
const errorEl = document.getElementById('error')

let selectedCategory = null

function setStatus(text, kind) {
  statusEl.textContent = text
  statusEl.className = `status-pill status-pill--${kind}`
}

function renderChips(categories) {
  chipsEl.innerHTML = ''
  categories.forEach((cat, i) => {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'chip'
    chip.setAttribute('role', 'radio')
    chip.setAttribute('aria-checked', i === 0 ? 'true' : 'false')
    chip.textContent = CATEGORY_LABELS[cat] ?? cat
    chip.dataset.category = cat
    chip.addEventListener('click', () => selectCategory(cat))
    chipsEl.appendChild(chip)
  })
  if (categories.length > 0) selectedCategory = categories[0]
}

function selectCategory(cat) {
  selectedCategory = cat
  ;[...chipsEl.children].forEach((chip) => {
    chip.setAttribute('aria-checked', String(chip.dataset.category === cat))
  })
}

async function checkHealth() {
  try {
    const res = await fetch(HEALTH_ENDPOINT)
    const body = await res.json()
    renderChips(body.categories)
    setStatus(
      `conectado · IA: ${body.aiEnabled ? 'Claude' : 'reglas (sin API key)'}`,
      'ok',
    )
  } catch {
    setStatus('no se pudo conectar con la API en :3001 — ¿corriste `npm run dev:api`?', 'err')
    chipsEl.innerHTML = '<p class="chip-placeholder">sin conexión con la API</p>'
  }
}

// slider <-> número sincronizados
budgetSlider.addEventListener('input', () => { budgetNumber.value = budgetSlider.value })
budgetNumber.addEventListener('input', () => {
  const val = Number(budgetNumber.value)
  if (!Number.isNaN(val) && val >= Number(budgetSlider.min) && val <= Number(budgetSlider.max)) {
    budgetSlider.value = String(val)
  }
})

function setLoading(loading) {
  submitBtn.disabled = loading
  submitBtn.dataset.loading = String(loading)
  submitBtn.querySelector('.btn-label').textContent = loading ? 'Armando…' : 'Armar combo'
}

function hideResults() {
  resultEl.hidden = true
  emptyResultEl.hidden = true
  errorEl.hidden = true
}

function renderReceipt(data) {
  hideResults()

  if (data.bundle.items.length === 0) {
    document.getElementById('empty-message').textContent =
      `No encontramos productos de ${data.request.category} que entren en $${data.request.maxBudget}. Probá con más presupuesto.`
    emptyResultEl.hidden = false
    return
  }

  resultEl.hidden = false
  document.getElementById('explanation').textContent = data.explanation
  document.getElementById('engine-badge').textContent =
    `motor: ${data.usedAI ? 'Claude' : 'reglas / stub'}`

  const itemsEl = document.getElementById('items')
  itemsEl.innerHTML = ''
  for (const item of data.bundle.items) {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = item.name
    const price = document.createElement('span')
    price.className = 'item-price'
    price.textContent = `$${item.price}`
    li.append(name, price)
    itemsEl.appendChild(li)
  }

  const subsEl = document.getElementById('subs')
  subsEl.innerHTML = ''
  for (const sub of data.bundle.substitutions) {
    const note = document.createElement('p')
    if (sub.replacement) {
      note.className = 'sub-note'
      note.innerHTML = `🔁 No había <strong>${sub.outOfStock.name}</strong>, lo cambiamos por <strong>${sub.replacement.name}</strong>.`
    } else {
      note.className = 'sub-note sub-note--missing'
      note.innerHTML = `⚠️ No había <strong>${sub.outOfStock.name}</strong> ni encontramos un reemplazo en esa categoría.`
    }
    subsEl.appendChild(note)
  }

  const { totalPrice, leftoverBudget } = data.bundle
  const budgetTotal = totalPrice + leftoverBudget
  const pctUsed = budgetTotal > 0 ? Math.round((totalPrice / budgetTotal) * 100) : 0
  document.getElementById('budget-bar-fill').style.width = `${pctUsed}%`
  document.getElementById('total-label').textContent = `Total: $${totalPrice}`
  document.getElementById('leftover-label').textContent = `margen libre: $${leftoverBudget}`
}

function renderError(message) {
  hideResults()
  errorEl.hidden = false
  errorEl.textContent = message
}

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  setLoading(true)

  try {
    const freeText = document.getElementById('freeText').value.trim()
    const preferenceRaw = document.getElementById('preference').value.trim()
    const preferences = preferenceRaw ? [preferenceRaw] : []

    // El texto libre reemplaza categoría/presupuesto explícitos cuando está
    // completo — es el camino que ejercita el parser de intención (IA o stub).
    const payload = freeText
      ? { freeText, preferences }
      : { category: selectedCategory, maxBudget: Number(budgetNumber.value), preferences }

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()

    if (!res.ok) {
      renderError(data.error ?? 'Error desconocido')
    } else {
      renderReceipt(data)
    }
  } catch (err) {
    renderError(`No se pudo conectar: ${err.message}`)
  } finally {
    setLoading(false)
  }
})

checkHealth()
