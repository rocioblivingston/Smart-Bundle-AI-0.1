// Apunta directo a la API por default: es lo que hace que la demo funcione
// siempre, sin depender de que n8n esté corriendo y con el workflow activo.
// Para probar el camino real (web -> n8n -> API), cambiá esta constante por
// la URL del webhook que te da n8n al importar n8n/smart-bundle-workflow.json.
const ENDPOINT = 'http://localhost:3001/bundle'

const statusEl = document.getElementById('status')
const form = document.getElementById('bundle-form')
const resultEl = document.getElementById('result')
const errorEl = document.getElementById('error')

async function checkHealth() {
  try {
    const res = await fetch('http://localhost:3001/health')
    const body = await res.json()
    statusEl.textContent = `conectado · categorías: ${body.categories.join(', ')} · IA: ${body.aiEnabled ? 'Claude' : 'reglas (sin API key)'}`
    statusEl.className = 'status ok'
  } catch {
    statusEl.textContent = 'no se pudo conectar con la API en :3001 — ¿está corriendo `npm run dev:api`?'
    statusEl.className = 'status err'
  }
}

function renderResult(data) {
  errorEl.hidden = true
  resultEl.hidden = false

  document.getElementById('explanation').textContent = data.explanation

  const itemsEl = document.getElementById('items')
  itemsEl.innerHTML = ''
  for (const item of data.bundle.items) {
    const li = document.createElement('li')
    li.innerHTML = `<span>${item.name}</span><span>$${item.price}</span>`
    itemsEl.appendChild(li)
  }

  document.getElementById('totals').innerHTML =
    `<span>Total: $${data.bundle.totalPrice}</span><span>Margen libre: $${data.bundle.leftoverBudget}</span>`

  const subsEl = document.getElementById('subs')
  subsEl.innerHTML = data.bundle.substitutions
    .map((s) =>
      s.replacement
        ? `🔁 No había <strong>${s.outOfStock.name}</strong>, lo reemplazamos por <strong>${s.replacement.name}</strong>.`
        : `⚠️ No había <strong>${s.outOfStock.name}</strong> ni encontramos un reemplazo en esa categoría.`,
    )
    .join('<br>')

  document.getElementById('badge').textContent = `motor: ${data.usedAI ? 'Claude' : 'reglas / stub'}`
}

function renderError(message) {
  resultEl.hidden = true
  errorEl.hidden = false
  errorEl.textContent = message
}

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const button = form.querySelector('button')
  button.disabled = true
  button.textContent = 'Armando...'

  try {
    const freeText = document.getElementById('freeText').value
    const preferenceRaw = document.getElementById('preference').value.trim()
    const preferences = preferenceRaw ? [preferenceRaw] : []

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ freeText, preferences }),
    })
    const data = await res.json()

    if (!res.ok) {
      renderError(data.error ?? 'Error desconocido')
    } else {
      renderResult(data)
    }
  } catch (err) {
    renderError(`No se pudo conectar: ${err.message}`)
  } finally {
    button.disabled = false
    button.textContent = 'Armar combo'
  }
})

checkHealth()
