import { indexedDB, IDBCursor, IDBDatabase, IDBIndex, IDBObjectStore } from 'fake-indexeddb'
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

  it('updates access time at most once per 30 seconds, including across cache instances', async () => {
    const time = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    const db = `tile-test-${name++}`
    const cache = new TileCache(100, db)
    const second = new TileCache(100, db)
    const fetch = vi.fn().mockResolvedValue(response('tile'))
    vi.stubGlobal('fetch', fetch)
    await cache.load('osm', 7, 1, 1, '/1', signal())

    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction')
    time.mockReturnValue(1_800_000_029_999)
    await Promise.all([
      cache.load('osm', 7, 1, 1, '/1', signal()),
      second.load('osm', 7, 1, 1, '/1', signal()),
    ])
    expect(transactions.mock.calls.filter(([stores, mode]) => stores === 'metadata' && mode === 'readwrite')).toHaveLength(0)
    time.mockReturnValue(1_800_000_030_000)
    const puts = vi.spyOn(IDBObjectStore.prototype, 'put')
    await Promise.all([
      cache.load('osm', 7, 1, 1, '/1', signal()),
      second.load('osm', 7, 1, 1, '/1', signal()),
    ])
    expect(puts).toHaveBeenCalledTimes(1)
    transactions.mockClear()
    time.mockReturnValue(1_800_000_059_999)
    await second.load('osm', 7, 1, 1, '/1', signal())
    expect(transactions.mock.calls.filter(([stores, mode]) => stores === 'metadata' && mode === 'readwrite')).toHaveLength(0)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('preserves approximate LRU ordering within the access update interval', async () => {
    const time = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    const cache = new TileCache(6, `tile-test-${name++}`)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('abc')))
    await cache.load('osm', 7, 1, 1, '/1', signal())
    time.mockReturnValue(1_800_000_010_000)
    await cache.load('osm', 7, 2, 1, '/2', signal())
    time.mockReturnValue(1_800_000_029_999)
    await cache.load('osm', 7, 1, 1, '/1', signal())
    await cache.load('osm', 7, 3, 1, '/3', signal())
    expect((await cache.stats()).layers.osm.tiles.map((tile) => tile.x).sort()).toEqual([2, 3])
  })

  it('protects tiles accessed after the update interval from LRU eviction', async () => {
    const time = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    const cache = new TileCache(6, `tile-test-${name++}`)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('abc')))
    await cache.load('osm', 7, 1, 1, '/1', signal())
    time.mockReturnValue(1_800_000_010_000)
    await cache.load('osm', 7, 2, 1, '/2', signal())
    time.mockReturnValue(1_800_000_030_000)
    await cache.load('osm', 7, 1, 1, '/1', signal())
    await cache.load('osm', 7, 3, 1, '/3', signal())
    expect((await cache.stats()).layers.osm.tiles.map((tile) => tile.x).sort()).toEqual([1, 3])
  })

  it('migrates existing version 1 tiles and enforces the limit using their sizes', async () => {
    const dbName = `tile-test-${name++}`
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(dbName, 1)
      open.onupgradeneeded = () => {
        open.result.createObjectStore('tiles', { keyPath: 'key' })
        open.result.createObjectStore('metadata', { keyPath: 'key' })
        const tx = open.transaction!
        for (const [x, accessed] of [[1, 1], [2, 2]]) {
          const item = { key: `osm/7/${x}/1`, layerId: 'osm', expires: Date.now() + 60000, accessed }
          tx.objectStore('tiles').put({ ...item, blob: new Blob(['abc'], { type: 'image/png' }) })
          tx.objectStore('metadata').put({ ...item, size: 3 })
        }
      }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    old.close()
    const fetch = vi.fn().mockResolvedValue(response('xyz'))
    vi.stubGlobal('fetch', fetch)
    const cache = new TileCache(6, dbName)
    expect(await cache.stats()).toMatchObject({ bytes: 6, count: 2 })
    await cache.load('osm', 7, 2, 1, '/cached', signal())
    expect(fetch).not.toHaveBeenCalled()
    await cache.load('osm', 7, 3, 1, '/new', signal())
    const stats = await cache.stats()
    expect(stats).toMatchObject({ bytes: 6, count: 2 })
    expect(stats.layers.osm.tiles.map((tile) => tile.x).sort()).toEqual([2, 3])
  })

  it('does not scan or sort all metadata for ordinary writes and only opens the LRU index over the limit', async () => {
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
    const cursor = vi.spyOn(IDBIndex.prototype, 'openCursor')
    const cache = new TileCache(6, `tile-test-${name++}`)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('abc')))
    await cache.load('osm', 7, 1, 1, '/1', signal())
    await cache.load('osm', 7, 2, 1, '/2', signal())
    expect(getAll).not.toHaveBeenCalled()
    expect(cursor).not.toHaveBeenCalled()
    await cache.load('osm', 7, 3, 1, '/3', signal())
    expect(getAll).not.toHaveBeenCalled()
    expect(cursor).toHaveBeenCalledTimes(1)
    expect(await cache.stats()).toMatchObject({ bytes: 6, count: 2 })
  })

  it('keeps sizes accurate across replacement, no-store, layer clearing, and concurrent cache instances', async () => {
    const db = `tile-test-${name++}`
    const cache = new TileCache(12, db)
    const second = new TileCache(12, db)
    const fetch = vi.fn()
      .mockResolvedValueOnce(response('aaa', { 'cache-control': 'max-age=0' }))
      .mockResolvedValueOnce(response('bb'))
      .mockResolvedValueOnce(response('cccc'))
      .mockResolvedValueOnce(response('ddddd', { 'cache-control': 'max-age=0' }))
      .mockResolvedValueOnce(response('not-stored', { 'cache-control': 'no-store' }))
    vi.stubGlobal('fetch', fetch)
    await cache.load('osm', 7, 1, 1, '/1', signal())
    await second.load('overlay', 7, 1, 1, '/2', signal())
    await cache.load('osm', 7, 1, 1, '/1', signal())
    expect(await cache.stats()).toMatchObject({ bytes: 6, count: 2 })
    await second.load('overlay', 7, 2, 1, '/3', signal())
    expect(await cache.stats()).toMatchObject({ bytes: 11, count: 3 })
    await second.load('overlay', 7, 2, 1, '/3', signal())
    expect(await cache.stats()).toMatchObject({ bytes: 6, count: 2 })
    await cache.clear('overlay')
    expect(await cache.stats()).toMatchObject({ bytes: 4, count: 1 })
    fetch.mockResolvedValue(response('abc'))
    await Promise.all(Array.from({ length: 10 }, (_, x) => (x % 2 ? cache : second).load('overlay', 8, x, 1, `/${x}`, signal())))
    const stats = await cache.stats()
    expect(stats.bytes).toBeLessThanOrEqual(12)
    expect(stats.bytes).toBe(Object.values(stats.layers).reduce((sum, layer) => sum + layer.bytes, 0))
    await second.clear()
    await cache.load('osm', 9, 1, 1, '/after-clear', signal())
    expect(await cache.stats()).toMatchObject({ bytes: 3, count: 1 })
  })

  it('rolls back partial evictions when an in-flight write is cancelled', async () => {
    const cache = new TileCache(6, `tile-test-${name++}`)
    const fetch = vi.fn().mockResolvedValue(response('abc'))
    vi.stubGlobal('fetch', fetch)
    await cache.load('osm', 7, 1, 1, '/1', signal())
    await cache.load('osm', 7, 2, 1, '/2', signal())
    fetch.mockResolvedValue(response('123456'))
    const controller = new AbortController()
    const original = IDBCursor.prototype.continue
    const cursor = vi.spyOn(IDBCursor.prototype, 'continue').mockImplementation(function (this: IDBCursor, key?: IDBValidKey) {
      controller.abort()
      original.call(this, key)
    })
    await expect(cache.load('osm', 7, 3, 1, '/3', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    cursor.mockRestore()
    expect(await cache.stats()).toMatchObject({ bytes: 6, count: 2 })
    fetch.mockResolvedValue(response('abc'))
    await cache.load('osm', 7, 3, 1, '/3', signal())
    expect(await cache.stats()).toMatchObject({ bytes: 6, count: 2 })
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
