import { describe, expect, it } from 'vitest'
import { cumulativeElevationGain } from './elevationGain'

describe('cumulativeElevationGain', () => {
  it('ignores noise around a constant elevation', () => {
    const elevations = Array.from({ length: 200 }, (_, i) => 500 + (i % 2 ? 2 : -2))
    const distances = elevations.map((_, i) => i * 0.01)
    const { ascent, descent } = cumulativeElevationGain(elevations, distances)
    expect(ascent.at(-1)).toBeLessThan(5)
    expect(descent.at(-1)).toBeLessThan(5)
  })

  it('keeps real climbs close to the true value', () => {
    const elevations = Array.from({ length: 101 }, (_, i) => 400 + i * 2 + (i % 2 ? 1.5 : -1.5))
    const distances = elevations.map((_, i) => i * 0.02)
    const { ascent, descent } = cumulativeElevationGain(elevations, distances)
    expect(ascent.at(-1)).toBeGreaterThan(180)
    expect(ascent.at(-1)).toBeLessThan(215)
    expect(descent.at(-1)).toBeLessThan(10)
  })
})
