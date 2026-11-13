import { describe, expect, it, vi } from 'vitest'
import { loadPlaces, type PlacesProgress } from '../src/features/osm-places/loadPlaces'
import { cellForPosition, cellKey } from '../src/features/osm-places/placeCells'
import { OverpassHttpError, type Place } from '../src/features/osm-places/places'
import { PLACES_MAX_AGE, type CachedPlaces } from '../src/features/osm-places/placesCache'

const cell = cellForPosition(50, 8)
const key = cellKey(cell, 'water')
const place: Place = { type: 'node', id: 1, latitude: 50, longitude: 8, tags: { natural: 'spring' } }
const immediateWait = async () => {}

describe('OSM place loading', () => {
  it('displays stale data first and atomically replaces it after a complete fetch', async () => {
    const old: CachedPlaces = { key, downloadedAt: Date.now() - PLACES_MAX_AGE, places: [] }
    const cache = { get: vi.fn().mockResolvedValue(new Map([[key, old]])), put: vi.fn().mockResolvedValue(undefined) }
    const updates: Array<{ entries: ReadonlyMap<string, CachedPlaces>; progress: PlacesProgress }> = []
    await loadPlaces({ cells: [cell], categories: ['water'], force: false, cache,
      signal: new AbortController().signal, fetch: vi.fn().mockResolvedValue([place]), wait: immediateWait,
      onUpdate: (entries, progress) => updates.push({ entries, progress }) })
    expect(updates[0].progress).toMatchObject({ available: 1, stale: 1, pending: 1 })
    expect(updates.at(-1)?.progress).toMatchObject({ available: 1, stale: 0, pending: 0 })
    expect(updates.at(-1)?.entries.get(key)?.places).toEqual([place])
    expect(cache.put).toHaveBeenCalledOnce()
  })

  it('waits after a rate limit and keeps existing data on failure', async () => {
    const old: CachedPlaces = { key, downloadedAt: Date.now(), places: [place] }
    const cache = { get: vi.fn().mockResolvedValue(new Map([[key, old]])), put: vi.fn() }
    const fetch = vi.fn().mockRejectedValueOnce(new OverpassHttpError(429, null)).mockRejectedValueOnce(new Error('offline'))
    const wait = vi.fn().mockResolvedValue(undefined)
    await expect(loadPlaces({ cells: [cell], categories: ['water'], force: true, cache,
      signal: new AbortController().signal, fetch, wait, onUpdate: () => {} })).rejects.toThrow('offline')
    expect(wait.mock.calls.some(([duration]) => duration === 30_000)).toBe(true)
    expect(cache.put).not.toHaveBeenCalled()
    expect(old.places).toEqual([place])
  })

  it('does not save a result when the request was cancelled', async () => {
    const controller = new AbortController()
    const cache = { get: vi.fn().mockResolvedValue(new Map()), put: vi.fn() }
    const fetch = vi.fn().mockImplementation(async () => { controller.abort(); return [place] })
    await expect(loadPlaces({ cells: [cell], categories: ['water'], force: false, cache,
      signal: controller.signal, fetch, wait: immediateWait, onUpdate: () => {} })).rejects.toBeDefined()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('splits a rejected large batch and only caches after all pieces finish', async () => {
    const cache = { get: vi.fn().mockResolvedValue(new Map()), put: vi.fn().mockResolvedValue(undefined) }
    const fetch = vi.fn()
      .mockRejectedValueOnce(new OverpassHttpError(504, null))
      .mockResolvedValue([])
    await loadPlaces({ cells: [cell], categories: ['water'], force: false, cache,
      signal: new AbortController().signal, fetch, wait: immediateWait, onUpdate: () => {} })
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(cache.put).toHaveBeenCalledOnce()
  })
})
