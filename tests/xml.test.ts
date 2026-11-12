import { describe, expect, it } from 'vitest'
import { escapeXml } from '../src/xml'

describe('XML utilities', () => {
  it('escapes XML special characters without changing other text', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;')
    expect(escapeXml('Mapvento')).toBe('Mapvento')
  })
})
