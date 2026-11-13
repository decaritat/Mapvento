import { describe, expect, it } from 'vitest'
import { batchesForCells, cellForPosition, cellKey, cellsForBounds } from '../src/features/osm-places/placeCells'
import { PLACES_MAX_AGE } from '../src/features/osm-places/placesCache'

describe('OSM place cell planning', () => {
  it('batches adjacent missing cells without requesting already fresh categories', () => {
    const cells = cellsForBounds({ south: 50, north: 50.02, west: 8, east: 8.04 })
    const now = PLACES_MAX_AGE + 100
    const freshKey = cellKey(cells[0], 'water')
    const cached = new Map([[freshKey, { key: freshKey, downloadedAt: now, places: [] }]])
    const batches = batchesForCells(cells, ['water', 'food'], cached, false, now)
    expect(batches.some((batch) => batch.cells.length > 1)).toBe(true)
    const first = batches.find((batch) => batch.cells.some((cell) => cell.x === cells[0].x && cell.y === cells[0].y))
    expect(first?.categories).toEqual(['food'])
    expect(batches.flatMap((batch) => batch.cells).length).toBe(cells.length)
    expect(batchesForCells(cells, ['water'], cached, true, now)
      .some((batch) => batch.cells.some((cell) => cell.x === cells[0].x && cell.y === cells[0].y))).toBe(true)
  })

  it('wraps the antimeridian and never builds an inverted query', () => {
    const cells = cellsForBounds({ south: 0, north: 0.01, west: 179.99, east: 180.01 })
    const batches = batchesForCells(cells, ['water'], new Map())
    expect(batches).toHaveLength(2)
    expect(batches.every((batch) => batch.bounds.west < batch.bounds.east)).toBe(true)
    expect(cells.some((cell) => cell.x === cellForPosition(0, -179.999).x)).toBe(true)
  })

  it('rejects very large viewports', () => {
    expect(() => cellsForBounds({ south: 40, north: 60, west: 0, east: 20 })).toThrow(/hineinzoomen/)
  })
})
