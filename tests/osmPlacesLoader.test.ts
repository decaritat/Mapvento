import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPlaces, type PlacesProgress } from '../src/features/osm-places/loadPlaces'
import { cellForPosition, cellKey } from '../src/features/osm-places/placeCells'
import { OverpassHttpError, OverpassSizeError, type Place } from '../src/features/osm-places/places'
import { PLACES_MAX_AGE, type CachedPlaces } from '../src/features/osm-places/placesCache'
import { DRESEL_EUROPE, PRIVATE_COFFEE } from '../src/features/osm-places/placesProviders'

const cell = cellForPosition(50, 8)
const key = cellKey(cell, 'water')
const place: Place = { type: 'node', id: 1, latitude: 50, longitude: 8, tags: { natural: 'spring' } }
const immediateWait = async () => {}

describe('OSM place loading', () => {
  afterEach(() => { vi.unstubAllGlobals() })
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
    expect(fetch.mock.calls.map((call) => call[5])).toEqual([DRESEL_EUROPE, DRESEL_EUROPE])
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
      .mockRejectedValueOnce(new OverpassSizeError('too large'))
      .mockResolvedValue([])
    await loadPlaces({ cells: [cell], categories: ['water'], force: false, cache,
      signal: new AbortController().signal, fetch, wait: immediateWait, onUpdate: () => {} })
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(cache.put).toHaveBeenCalledOnce()
  })

  it('does not split a gateway failure or assume a client timeout means the area is too large', async () => {
    const cache = { get: vi.fn().mockResolvedValue(new Map()), put: vi.fn() }
    const gateway = vi.fn().mockRejectedValue(new OverpassHttpError(504, null))
    await expect(loadPlaces({ cells: [cell], categories: ['water'], force: false, cache,
      signal: new AbortController().signal, fetch: gateway, wait: immediateWait, onUpdate: () => {} }))
      .rejects.toMatchObject({ status: 504 })
    expect(gateway).toHaveBeenCalledTimes(2)

    vi.useFakeTimers()
    try {
      const progress: PlacesProgress[] = []
      const fetch = vi.fn().mockImplementation((_bounds, _categories, signal: AbortSignal) =>
        new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))))
      const loading = loadPlaces({ cells: [cell], categories: ['water'], force: false, cache,
        signal: new AbortController().signal, fetch, wait: immediateWait, onUpdate: (_entries, status) => progress.push(status) })
      const result = expect(loading).rejects.toThrow('innerhalb von 50 Sekunden')
      await vi.advanceTimersByTimeAsync(100_001)
      await result
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(progress.some((status) => status.message.includes('aufgeteilt'))).toBe(false)
      expect(cache.put).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('identifies cache read and write failures without exposing stored keys or error text', async () => {
    const diagnostic = vi.fn()
    const readFailure = { get: vi.fn().mockRejectedValue(new Error('secret 50,8')), put: vi.fn() }
    const options = { cells: [cell], categories: ['water' as const], force: false,
      signal: new AbortController().signal, wait: immediateWait, onUpdate: () => {}, onDiagnostic: diagnostic }
    await expect(loadPlaces({ ...options, cache: readFailure })).rejects.toThrow()
    expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'cache-read', outcome: 'cache-error' }))
    const writeFailure = { get: vi.fn().mockResolvedValue(new Map()), put: vi.fn().mockRejectedValue(new DOMException('secret', 'QuotaExceededError')) }
    await expect(loadPlaces({ ...options, cache: writeFailure, fetch: vi.fn().mockResolvedValue([]) })).rejects.toBeDefined()
    expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'cache-write', outcome: 'cache-error', errorName: 'QuotaExceededError' }))
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('secret')
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(key)
  })

  it('does not split a server-side query timeout', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ remark: 'runtime error: Query timed out', elements: [] })))
    vi.stubGlobal('fetch', fetch)
    const cache = { get: vi.fn().mockResolvedValue(new Map()), put: vi.fn() }
    await expect(loadPlaces({ cells: [cell], categories: ['water'], force: false, cache,
      signal: new AbortController().signal, wait: immediateWait, onUpdate: () => {} }))
      .rejects.toThrow('Zeitlimit des Servers')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('falls back once, reports each provider and reuses the fallback for later batches', async () => {
    const first = cellForPosition(48.13, 11.57)
    const second = cellForPosition(48.14, 11.67)
    const events = vi.fn()
    const progress: PlacesProgress[] = []
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockImplementation(async () => new Response(JSON.stringify({ elements: [] })))
    vi.stubGlobal('fetch', fetch)
    const cache = { get: vi.fn().mockResolvedValue(new Map()), put: vi.fn().mockResolvedValue(undefined) }
    await loadPlaces({ cells: [first, second], categories: ['food'], force: false, cache,
      signal: new AbortController().signal, wait: immediateWait, onUpdate: (_entries, status) => progress.push(status),
      onDiagnostic: events })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      DRESEL_EUROPE.endpoint, PRIVATE_COFFEE.endpoint, PRIVATE_COFFEE.endpoint,
    ])
    expect(events.mock.calls.map(([event]) => [event.provider, event.outcome])).toContainEqual(['dresel-europe', 'http-error'])
    expect(events.mock.calls.map(([event]) => [event.provider, event.outcome])).toContainEqual(['private-coffee', 'success'])
    expect(progress.some((status) => status.message.includes('Wechsel zu Private.coffee'))).toBe(true)
    expect(progress.at(-1)?.pending).toBe(0)
    expect(cache.put).toHaveBeenCalledTimes(2)
  })

  it('does not contact another provider after cancellation', async () => {
    const cache = { get: vi.fn().mockResolvedValue(new Map()), put: vi.fn() }
    const controller = new AbortController()
    const fetch = vi.fn().mockImplementation(async () => {
      controller.abort()
      throw new OverpassHttpError(503, null)
    })
    await expect(loadPlaces({ cells: [cell], categories: ['water'], force: false, cache,
      signal: controller.signal, fetch, wait: immediateWait, onUpdate: () => {} })).rejects.toBeDefined()
    expect(fetch).toHaveBeenCalledOnce()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it.each(['network', 'invalid', 'forbidden'])('uses the fallback for a %s provider failure', async (failure) => {
    const fetch = vi.fn()
    if (failure === 'network') fetch.mockRejectedValueOnce(new TypeError('network failure'))
    if (failure === 'invalid') fetch.mockResolvedValueOnce(new Response('<html>bad response</html>'))
    if (failure === 'forbidden') fetch.mockResolvedValueOnce(new Response('', { status: 403 }))
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ elements: [] })))
    vi.stubGlobal('fetch', fetch)
    const cache = { get: vi.fn().mockResolvedValue(new Map()), put: vi.fn().mockResolvedValue(undefined) }
    await loadPlaces({ cells: [cell], categories: ['water'], force: false, cache,
      signal: new AbortController().signal, wait: immediateWait, onUpdate: () => {} })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([DRESEL_EUROPE.endpoint, PRIVATE_COFFEE.endpoint])
    expect(cache.put).toHaveBeenCalledOnce()
  })
})
