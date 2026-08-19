import { buildApp, loadCatalog } from './app.js'

const PORT = Number(process.env.PORT ?? 3001)
const app = buildApp(loadCatalog(), process.env.ANTHROPIC_API_KEY)

app.listen(PORT, () => {
  console.log(`SmartBundle API escuchando en http://localhost:${PORT}`)
  console.log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'configurada' : 'ausente (usando stub)'}`)
})
