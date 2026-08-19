import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dirname, '..', 'src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

describe('frontera arquitectónica de core', () => {
  it('ningún archivo de core importa express, anthropic ni n8n', () => {
    const offenders = walk(SRC).filter((file) =>
      /from ['"](express|@anthropic-ai\/sdk|n8n-workflow)/.test(readFileSync(file, 'utf-8')),
    )
    expect(offenders).toEqual([])
  })
})
