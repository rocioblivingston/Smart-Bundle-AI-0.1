import { buildApp, loadCatalog } from './app.js'
import { LocalCatalogAdapter } from './adapters/catalog.js'
import { VtexCatalogAdapter } from './adapters/vtex.js'

const PORT = Number(process.env.PORT ?? 3001)
const provider = (process.env.ECOMMERCE_PROVIDER ?? 'vtex').trim().toLowerCase()
const localCatalog = new LocalCatalogAdapter(loadCatalog())

if (provider !== 'local' && provider !== 'vtex') {
  throw new Error(`ECOMMERCE_PROVIDER inválido: ${provider}. Valores admitidos: vtex, local`)
}

const catalogAdapter = provider === 'vtex'
  ? new VtexCatalogAdapter(localCatalog)
  : localCatalog
const app = buildApp(catalogAdapter, process.env.ANTHROPIC_API_KEY)

app.listen(PORT, () => {
  console.log(`SmartBundle API escuchando en http://localhost:${PORT}`)
  console.log(`ECOMMERCE_PROVIDER: ${catalogAdapter.provider}`)
  console.log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'configurada' : 'ausente (usando stub)'}`)
})
