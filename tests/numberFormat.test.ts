import { describe, expect, it } from 'vitest'
import { formatNumber, formatNumberInput, parseNumberInput } from '../src/domain/numberFormat'

describe('German number formatting', () => {
  it('formats displayed values with the requested precision and grouping', () => {
    expect(formatNumber(1234.56, 1)).toBe('1.234,6')
    expect(formatNumber(0.005, 0, 3)).toBe('0,005')
    expect(formatNumber(0, 0, 3)).toBe('0')
    expect(formatNumber(1, 2)).toBe('1,00')
  })

  it('preserves editable precision and accepts decimal commas, dots and exponents', () => {
    const coordinate = 52.12345678912345
    expect(formatNumberInput(coordinate)).toBe('52,12345678912345')
    expect(parseNumberInput(formatNumberInput(coordinate))).toBe(coordinate)
    expect(parseNumberInput(' -1,25 ')).toBe(-1.25)
    expect(parseNumberInput('1.234')).toBe(1.234)
    expect(parseNumberInput('1,23e-7')).toBe(1.23e-7)
    for (const invalid of ['', ' ', '-', ',', '1,2.3', '1 234', 'Infinity', '1e999']) {
      expect(parseNumberInput(invalid)).toBeNull()
    }
  })
})
