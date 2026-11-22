import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('declares German as the document language', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
  const document = new DOMParser().parseFromString(html, 'text/html')
  expect(document.documentElement.lang).toBe('de')
})
