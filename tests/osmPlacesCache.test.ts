import { indexedDB } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isPlacesEntryFresh, PLACES_MAX_AGE, PlacesCache } from '../src/features/osm-places/placesCache'

let database = 0

describe('OSM places cache', () => {
  beforeEach(() => vi.stubGlobal('indexedDB', indexedDB))
  afterEach(() => vi.unstubAllGlobals())

  it('persists empty and populated cells across cache instances and expires after 14 days', async () => {
    const name = `places-${database++}`
    const first = new PlacesCache(name)
    const entries = [
      { key: 'cell:water', downloadedAt: 1000, places: [] },
      { key: 'cell:food', downloadedAt: 1000, places: [{
        type: 'node' as const, id: 5, latitude: 50, longitude: 8, tags: { amenity: 'restaurant' },
      }] },
    ]
    await first.put(entries)
    const restored = await new PlacesCache(name).get(entries.map((entry) => entry.key))
    expect(restored.get('cell:water')?.places).toEqual([])
    expect(restored.get('cell:food')?.places[0].id).toBe(5)
    expect(isPlacesEntryFresh(entries[0], 1000 + PLACES_MAX_AGE - 1)).toBe(true)
    expect(isPlacesEntryFresh(entries[0], 1000 + PLACES_MAX_AGE)).toBe(false)
    expect(isPlacesEntryFresh(entries[0], 999)).toBe(false)
  })

  it('retains previous data when a replacement exceeds the storage limit', async () => {
    const cache = new PlacesCache(`places-${database++}`, 300)
    await cache.put([{ key: 'cell', downloadedAt: 1, places: [] }])
    await expect(cache.put([{ key: 'cell', downloadedAt: 2, places: [{
      type: 'node', id: 1, latitude: 50, longitude: 8, tags: { name: 'x'.repeat(500) },
    }] }])).rejects.toThrow()
    expect((await cache.get(['cell'])).get('cell')?.downloadedAt).toBe(1)
    await cache.clear()
    expect((await cache.get(['cell'])).size).toBe(0)
  })

  it('evicts old entries when the bounded cache fills', async () => {
    const entries = ['a', 'b', 'c'].map((key, index) => ({ key, downloadedAt: index + 1, places: [] }))
    const bytes = new TextEncoder().encode(JSON.stringify(entries[0])).byteLength
    const cache = new PlacesCache(`places-${database++}`, bytes * 2)
    for (const entry of entries) await cache.put([entry])
    const stored = await cache.get(['a', 'b', 'c'])
    expect([...stored.keys()]).toEqual(['b', 'c'])
  })

  it('discards a corrupt persisted entry and keeps other cache reads usable', async () => {
    const name = `places-${database++}`
    const cache = new PlacesCache(name)
    await cache.get([])
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = db.transaction('places', 'readwrite')
    tx.objectStore('places').put({ key: 'bad', version: 1, downloadedAt: 1, places: 'not-an-array' })
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
    expect(await cache.get(['bad'])).toEqual(new Map())
    expect(await cache.get(['bad'])).toEqual(new Map())
    db.close()
  })
})
