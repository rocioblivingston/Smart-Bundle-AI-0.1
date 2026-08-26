import { copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const sourceDirectory = fileURLToPath(new URL('../packages/web/', import.meta.url))
const outputDirectory = fileURLToPath(new URL('../dist/web/', import.meta.url))
const configuredApiUrl = (process.env.VITE_API_URL ?? '').trim().replace(/\/$/, '')

if (configuredApiUrl && !/^https?:\/\//i.test(configuredApiUrl)) {
  throw new Error('VITE_API_URL debe ser una URL absoluta http:// o https://')
}

if (process.env.VERCEL && !configuredApiUrl) {
  throw new Error('VITE_API_URL es obligatoria para publicar el frontend en Vercel')
}

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })
await cp(sourceDirectory, outputDirectory, { recursive: true })
await mkdir(new URL('../dist/web/widget/', import.meta.url), { recursive: true })
await copyFile(
  new URL('../dist/web/index.html', import.meta.url),
  new URL('../dist/web/widget/index.html', import.meta.url),
)
await writeFile(
  new URL('../dist/web/config.js', import.meta.url),
  `window.__SBA_CONFIG__ = Object.freeze({ apiUrl: ${JSON.stringify(configuredApiUrl)} })\n`,
  'utf8',
)

console.log(`Frontend generado en ${outputDirectory.replace(`${projectRoot}\\`, '')}`)
console.log(`API configurada: ${configuredApiUrl || 'mismo origen / modo local'}`)
