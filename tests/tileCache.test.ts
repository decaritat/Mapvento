import { indexedDB } from 'fake-indexeddb'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TileCache, TileCacheStorageError, tileExpiry } from '../src/tileCache'

const signal = () => new AbortController().signal
let name = 0

function response(body: string, headers: Record<string, string> = {
  'cache-control': 'max-age=3600',
  expires: new Date(Date.now() + 3600000).toUTCString(),
}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    blob: async () => new Blob([body], { type: 'image/png' }),
  } as Response
}

describe('tile cache', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', indexedDB)
    vi.stubGlobal('Blob', NodeBlob)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('honours HTTP freshness, no-store, no-cache and fallback lifetimes', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(tileExpiry(new Headers({ 'cache-control': 'max-age=60', date: 'Thu, 01 Jan 2026 00:00:00 GMT' }), now)).toBe(now + 60000)
    expect(tileExpiry(new Headers({ 'cache-control': 'max-age=60', age: '20' }), now)).toBe(now + 40000)
    expect(tileExpiry(new Headers({ 'cache-control': 'max-age=60' }), now)).toBe(now)
    expect(tileExpiry(new Headers({ expires: 'Thu, 01 Jan 2026 00:00:10 GMT', 'cache-control': 'max-age=60' }), now)).toBe(now + 10000)
    expect(tileExpiry(new Headers({ 'cache-control': 'no-store' }), now)).toBeNull()
    expect(tileExpiry(new Headers({ 'cache-control': 'no-cache' }), now)).toBe(now)
    expect(tileExpiry(new Headers(), now)).toBe(now + 7 * 86400000)
  })

  it('persists fresh tiles across instances and isolates providers and overlays', async () => {
    const db = `tile-test-${name++}`
    const cache = new TileCache(100, db)
    const fetch = vi.fn().mockResolvedValue(response('hiking'))
    vi.stubGlobal('fetch', fetch)
    await cache.load('waymarked-hiking', 7, 1, 2, 'https://example.test/hiking', signal())
    const restored = new TileCache(100, db)
    expect((await restored.load('waymarked-hiking', 7, 1, 2, 'https://example.test/hiking', signal())).size).toBe(6)
    await restored.load('waymarked-cycling', 7, 1, 2, 'https://example.test/cycling', signal())
    await restored.load('osm', 7, 1, 2, 'https://example.test/osm', signal())
    expect(fetch).toHaveBeenCalledTimes(3)
    expect((await restored.stats()).count).toBe(3)
    await restored.clear('waymarked-hiking')
    expect((await cache.stats()).layers['waymarked-cycling'].count).toBe(1)
  })

  it('evicts least recently used records without exceeding the size limit', async () => {
    const cache = new TileCache(6, `tile-test-${name++}`)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('1234')))
    await cache.load('osm', 7, 1, 1, '/1', signal())
    await cache.load('osm', 7, 1, 2, '/2', signal())
    expect(await cache.stats()).toMatchObject({ bytes: 4, count: 1 })
  })

  it('revalidates only requested visible tiles after a manual refresh', async () => {
    const cache = new TileCache(100, `tile-test-${name++}`)
    const fetch = vi.fn().mockResolvedValue(response('tile'))
    vi.stubGlobal('fetch', fetch)
    await cache.load('osm', 7, 1, 1, '/1', signal())
    await cache.load('osm', 7, 1, 2, '/2', signal())
    await cache.revalidate('osm')
    expect((await cache.stats()).stale).toBe(2)
    await cache.load('osm', 7, 1, 1, '/1', signal())
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls[2][1].cache).toBe('no-cache')
    expect((await cache.stats()).stale).toBe(1)
  })

  it('uses the HTTP cache for expired tiles and does not serve them on network failure', async () => {
    const cache = new TileCache(100, `tile-test-${name++}`)
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('old', { 'cache-control': 'max-age=0' }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response('new'))
    vi.stubGlobal('fetch', fetch)
    await cache.load('osm', 7, 1, 1, '/1', signal())
    await expect(cache.load('osm', 7, 1, 1, '/1', signal())).rejects.toThrow('offline')
    expect((await cache.stats()).stale).toBe(1)
    await cache.load('osm', 7, 1, 1, '/1', signal())
    expect(fetch.mock.calls[2][1].cache).toBe('default')
    expect((await cache.stats()).stale).toBe(0)
  })

  it('removes previously stored data when a later response says no-store', async () => {
    const cache = new TileCache(100, `tile-test-${name++}`)
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('old', { 'cache-control': 'max-age=0' }))
      .mockResolvedValueOnce(response('new', { 'cache-control': 'no-store' }))
    vi.stubGlobal('fetch', fetch)
    await cache.load('osm', 7, 1, 1, '/1', signal())
    await cache.load('osm', 7, 1, 1, '/1', signal())
    expect((await cache.stats()).count).toBe(0)
  })

  it('does not save failed, aborted, no-store, or invalid image responses', async () => {
    const cache = new TileCache(100, `tile-test-${name++}`)
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(response('text', { 'cache-control': 'no-store' }))
      .mockResolvedValueOnce({ ...response('bad'), blob: async () => new Blob(['bad'], { type: 'text/plain' }) })
    vi.stubGlobal('fetch', fetch)
    await expect(cache.load('osm', 7, 1, 1, '/1', signal())).rejects.toThrow('503')
    await cache.load('osm', 7, 1, 1, '/1', signal())
    await expect(cache.load('osm', 7, 1, 1, '/1', signal())).rejects.toThrow('kein Bild')
    const controller = new AbortController()
    controller.abort()
    await expect(cache.load('osm', 7, 1, 1, '/1', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect((await cache.stats()).count).toBe(0)
  })

  it('reports blocked storage without attempting network access', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new DOMException('Denied', 'SecurityError') } })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const cache = new TileCache(100, `tile-test-${name++}`)
    await expect(cache.load('osm', 7, 1, 1, '/1', signal())).rejects.toBeInstanceOf(TileCacheStorageError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not resurrect a tile cleared during a pending request', async () => {
    const cache = new TileCache(100, `tile-test-${name++}`)
    let finish!: (value: Response) => void
    let started!: () => void
    const startedRequest = new Promise<void>((resolve) => { started = resolve })
    vi.stubGlobal('fetch', vi.fn(() => {
      started()
      return new Promise<Response>((resolve) => { finish = resolve })
    }))
    const loading = cache.load('osm', 7, 1, 1, '/1', signal())
    await startedRequest
    await cache.clear('osm')
    finish(response('tile'))
    await loading
    expect((await cache.stats()).count).toBe(0)
  })
})
