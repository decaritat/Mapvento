import type { CachedCoordinate } from './tileCoverage'
import { measureTile, tileDiagnostics, type TileDiagnosticHandle } from './tileDiagnostics'

export const TILE_CACHE_LIMIT = 100 * 1024 * 1024
const FALLBACK_LIFETIME = 7 * 24 * 60 * 60 * 1000
const ACCESS_UPDATE_INTERVAL = 30 * 1000

export type TileRecord = {
  key: string
  layerId: string
  blob: Blob
  expires: number
  accessed: number
  refresh?: boolean
}
type TileMetadata = Omit<TileRecord, 'blob'> & { size: number }
const SIZE_KEY = 'bytes'

export type TileCacheStats = {
  bytes: number
  count: number
  stale: number
  layers: Record<string, { bytes: number; count: number; stale: number; zooms: number[]; tiles: CachedCoordinate[] }>
}

export class TileCacheStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TileCacheStorageError'
  }
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(new TileCacheStorageError(value.error?.message ?? 'IndexedDB-Anfrage fehlgeschlagen'))
  })
}

function completed(transaction: IDBTransaction): Promise<void> {
  const result = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = transaction.onerror = () => reject(new TileCacheStorageError(transaction.error?.message ?? 'Cache-Transaktion fehlgeschlagen'))
  })
  // A failed request can abort the transaction before its completion is awaited.
  void result.catch(() => {})
  return result
}

export function tileExpiry(headers: Headers, now: number): number | null {
  const control = headers.get('cache-control')?.toLowerCase() ?? ''
  if (/(?:^|,)\s*no-store\b/.test(control)) return null
  if (/(?:^|,)\s*no-cache\b/.test(control)) return now
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/.exec(control)
  const expires = Date.parse(headers.get('expires') ?? '')
  const absolute = Number.isFinite(expires) ? expires : Infinity
  if (maxAge) {
    const date = Date.parse(headers.get('date') ?? '')
    const ageValue = headers.get('age')
    const age = ageValue !== null && /^\d+$/.test(ageValue) ? Number(ageValue) * 1000 : null
    const apparentAge = Number.isFinite(date) ? Math.max(0, now - date) : 0
    if (!Number.isFinite(expires) && !Number.isFinite(date) && age === null) return now
    return Math.min(now + Math.max(0, Number(maxAge[1]) * 1000 - Math.max(apparentAge, age ?? 0)), absolute)
  }
  return Number.isFinite(expires) ? expires : now + FALLBACK_LIFETIME
}

export class TileCache {
  private database: Promise<IDBDatabase> | null = null
  private generation = 0
  private listeners = new Set<() => void>()
  private readonly limit: number
  private readonly dbName: string

  constructor(limit = TILE_CACHE_LIMIT, dbName = 'trailforge-tile-cache') {
    this.limit = limit
    this.dbName = dbName
  }

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        if (!globalThis.indexedDB) {
          reject(new TileCacheStorageError('IndexedDB ist nicht verfügbar'))
          return
        }
        const opening = indexedDB.open(this.dbName, 2)
        opening.onupgradeneeded = (event) => {
          const db = opening.result
          const transaction = opening.transaction!
          if (event.oldVersion === 0) {
            db.createObjectStore('tiles', { keyPath: 'key' })
            db.createObjectStore('metadata', { keyPath: 'key' })
          }
          const metadata = transaction.objectStore('metadata')
          metadata.createIndex('accessed', 'accessed')
          metadata.createIndex('layerId', 'layerId')
          const totals = db.createObjectStore('totals')
          let bytes = 0
          const cursor = metadata.openCursor()
          cursor.onsuccess = () => {
            const current = cursor.result
            if (current) {
              bytes += (current.value as TileMetadata).size
              current.continue()
            } else {
              totals.put(bytes, SIZE_KEY)
            }
          }
        }
        opening.onsuccess = () => {
          opening.result.onversionchange = () => {
            opening.result.close()
            this.database = null
          }
          resolve(opening.result)
        }
        opening.onerror = () => reject(new TileCacheStorageError(opening.error?.message ?? 'Cache konnte nicht geöffnet werden'))
        opening.onblocked = () => reject(new TileCacheStorageError('Cache ist durch ein anderes Fenster blockiert'))
      }).catch((error: unknown) => {
        this.database = null
        throw error instanceof TileCacheStorageError ? error : new TileCacheStorageError(String(error))
      })
    }
    return this.database
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private changed() {
    this.listeners.forEach((listener) => listener())
  }

  async load(layerId: string, z: number, x: number, y: number, url: string, signal: AbortSignal): Promise<Blob> {
    const diagnostic = tileDiagnostics.begin(layerId, z)
    try {
      const blob = await this.loadTile(layerId, z, x, y, url, signal, diagnostic)
      diagnostic?.finish()
      return blob
    } catch (error) {
      if (diagnostic && error instanceof TileCacheStorageError) diagnostic.event.storageError = true
      diagnostic?.finish(error)
      throw error
    }
  }

  private async loadTile(layerId: string, z: number, x: number, y: number, url: string, signal: AbortSignal, diagnostic: TileDiagnosticHandle | null): Promise<Blob> {
    const key = `${layerId}/${z}/${x}/${y}`
    const generation = this.generation
    const db = await measureTile(diagnostic, 'openMs', () => this.open())
    const [record, metadata] = await measureTile(diagnostic, 'readMs', () => {
      const read = db.transaction(['tiles', 'metadata'], 'readonly')
      return Promise.all([
        request<TileRecord | undefined>(read.objectStore('tiles').get(key)),
        request<TileMetadata | undefined>(read.objectStore('metadata').get(key)),
      ])
    })
    if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError')
    if (record && metadata && metadata.expires > Date.now()) {
      if (diagnostic) diagnostic.event.cache = 'hit'
      if (Date.now() - metadata.accessed >= ACCESS_UPDATE_INTERVAL) {
        if (diagnostic) diagnostic.event.touchAttempted = true
        await measureTile(diagnostic, 'touchMs', async () => {
          const touch = db.transaction('metadata', 'readwrite')
          const done = completed(touch)
          const store = touch.objectStore('metadata')
          const current = await request<TileMetadata | undefined>(store.get(key))
          const now = Date.now()
          if (current && generation === this.generation && now - current.accessed >= ACCESS_UPDATE_INTERVAL) {
            store.put({ ...current, accessed: now })
          }
          await done
        })
      }
      return record.blob
    }
    if (diagnostic) diagnostic.event.cache = record && metadata ? 'stale' : 'miss'

    // The browser's HTTP cache owns validators: these providers do not expose
    // ETag or allow conditional request headers through CORS.
    if (diagnostic) diagnostic.event.fetchAttempted = true
    const response = await measureTile(diagnostic, 'fetchMs', () => fetch(url, { signal, cache: metadata?.refresh ? 'no-cache' : 'default' }))
    if (diagnostic) diagnostic.event.httpStatus = response.status
    if (!response.ok) throw new Error(`Kachel-Anfrage fehlgeschlagen (${response.status})`)
    const blob = await measureTile(diagnostic, 'bodyMs', () => response.blob())
    if (!blob.type.startsWith('image/')) throw new Error('Kachelantwort ist kein Bild')
    const now = Date.now()
    const expires = tileExpiry(response.headers, now)
    if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError')
    if (expires === null && record && generation === this.generation) {
      await measureTile(diagnostic, 'writeMs', async () => {
        const transaction = db.transaction(['tiles', 'metadata', 'totals'], 'readwrite')
        const done = completed(transaction)
        const metaStore = transaction.objectStore('metadata')
        const totals = transaction.objectStore('totals')
        const [current, bytes] = await Promise.all([
          request<TileMetadata | undefined>(metaStore.get(key)),
          request<number>(totals.get(SIZE_KEY)),
        ])
        if (generation === this.generation && current) {
          transaction.objectStore('tiles').delete(key)
          metaStore.delete(key)
          totals.put(bytes - current.size, SIZE_KEY)
        }
        await done
      })
      this.changed()
    }
    if (expires !== null && blob.size <= this.limit && generation === this.generation) {
      await measureTile(diagnostic, 'writeMs', async () => {
        const transaction = db.transaction(['tiles', 'metadata', 'totals'], 'readwrite')
        const done = completed(transaction)
        const store = transaction.objectStore('tiles')
        const metaStore = transaction.objectStore('metadata')
        const totals = transaction.objectStore('totals')
        const [previous, bytes] = await Promise.all([
          request<TileMetadata | undefined>(metaStore.get(key)),
          request<number>(totals.get(SIZE_KEY)),
        ])
        let evicted = 0
        if (generation === this.generation && !signal.aborted) {
          let total = bytes - (previous?.size ?? 0) + blob.size
          if (total > this.limit) {
            await new Promise<void>((resolve, reject) => {
              const cursor = metaStore.index('accessed').openCursor()
              cursor.onerror = () => reject(new TileCacheStorageError(cursor.error?.message ?? 'Cache-Verdrängung fehlgeschlagen'))
              cursor.onsuccess = () => {
                const current = cursor.result
                if (!current || total <= this.limit || generation !== this.generation || signal.aborted) {
                  resolve()
                  return
                }
                const item = current.value as TileMetadata
                if (item.key !== key) {
                  store.delete(item.key)
                  current.delete()
                  total -= item.size
                  evicted++
                }
                current.continue()
              }
            })
          }
          if (generation !== this.generation || signal.aborted) {
            transaction.abort()
            await done.catch(() => {})
            if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError')
            return
          }
          store.put({ key, layerId, blob, expires, accessed: now } satisfies TileRecord)
          metaStore.put({ key, layerId, size: blob.size, expires, accessed: now } satisfies TileMetadata)
          totals.put(total, SIZE_KEY)
        }
        await done
        if (diagnostic) diagnostic.event.evicted += evicted
      })
      this.changed()
    }
    return blob
  }

  async clear(layerId?: string): Promise<void> {
    this.generation += 1
    const db = await this.open()
    const transaction = db.transaction(['tiles', 'metadata', 'totals'], 'readwrite')
    const done = completed(transaction)
    const store = transaction.objectStore('tiles')
    const metaStore = transaction.objectStore('metadata')
    const totals = transaction.objectStore('totals')
    if (!layerId) { store.clear(); metaStore.clear(); totals.put(0, SIZE_KEY) }
    else {
      const [records, bytes] = await Promise.all([
        request<TileMetadata[]>(metaStore.index('layerId').getAll(layerId)),
        request<number>(totals.get(SIZE_KEY)),
      ])
      records.forEach((item) => {
        store.delete(item.key)
        metaStore.delete(item.key)
      })
      totals.put(bytes - records.reduce((sum, item) => sum + item.size, 0), SIZE_KEY)
    }
    await done
    this.changed()
  }

  async revalidate(layerId: string): Promise<void> {
    this.generation += 1
    const db = await this.open()
    const transaction = db.transaction('metadata', 'readwrite')
    const done = completed(transaction)
    const store = transaction.objectStore('metadata')
    const records = await request<TileMetadata[]>(store.getAll())
    records.filter((item) => item.layerId === layerId)
      .forEach((item) => store.put({ ...item, expires: 0, refresh: true }))
    await done
    this.changed()
  }

  async stats(): Promise<TileCacheStats> {
    const db = await this.open()
    const transaction = db.transaction('metadata', 'readonly')
    const records = await request<TileMetadata[]>(transaction.objectStore('metadata').getAll())
    const result: TileCacheStats = { bytes: 0, count: 0, stale: 0, layers: {} }
    for (const item of records) {
      const layer = result.layers[item.layerId] ??= { bytes: 0, count: 0, stale: 0, zooms: [], tiles: [] }
      const stale = item.expires <= Date.now() ? 1 : 0
      const [, zoomValue, x, y] = item.key.split('/')
      const zoom = Number(zoomValue)
      result.bytes += item.size
      result.count += 1
      result.stale += stale
      layer.bytes += item.size
      layer.count += 1
      layer.stale += stale
      layer.tiles.push({ z: zoom, x: Number(x), y: Number(y), stale: Boolean(stale) })
      if (!layer.zooms.includes(zoom)) layer.zooms.push(zoom)
    }
    return result
  }
}

export const tileCache = new TileCache()
