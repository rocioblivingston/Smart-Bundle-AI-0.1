import { buildApp, loadCatalog } from './app.js'
import { LocalCatalogAdapter } from './adapters/catalog.js'
import { LenaldiCatalogAdapter } from './adapters/lenaldi.js'
import { VtexCatalogAdapter } from './adapters/vtex.js'

const PORT = Number(process.env.PORT ?? 3001)
const provider = (process.env.ECOMMERCE_PROVIDER ?? 'vtex').trim().toLowerCase()
const localCatalog = new LocalCatalogAdapter(loadCatalog())

if (provider !== 'local' && provider !== 'vtex' && provider !== 'lenaldi') {
  throw new Error(`ECOMMERCE_PROVIDER inválido: ${provider}. Valores admitidos: vtex, lenaldi, local`)
}

const cacheTtlSeconds = Number(process.env.LENALDI_CACHE_TTL_SECONDS ?? 900)
const catalogAdapter = provider === 'vtex'
  ? new VtexCatalogAdapter(localCatalog)
  : provider === 'lenaldi'
    ? new LenaldiCatalogAdapter(localCatalog, {
      cacheTtlSeconds: Number.isFinite(cacheTtlSeconds) ? cacheTtlSeconds : 900,
    })
    : localCatalog
const app = buildApp(catalogAdapter, process.env.GEMINI_API_KEY, process.env.LENALDI_WHATSAPP_NUMBER)

app.listen(PORT, () => {
  console.log(`SmartBundle API escuchando en http://localhost:${PORT}`)
  console.log(`ECOMMERCE_PROVIDER: ${catalogAdapter.provider}`)
  console.log(`Gemini: ${process.env.GEMINI_API_KEY ? 'configurado' : 'no configurado (fallback por reglas)'}`)
  console.log(`WhatsApp Lenaldi: ${process.env.LENALDI_WHATSAPP_NUMBER ? 'configurado' : 'no configurado'}`)
})
