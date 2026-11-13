import { parsePlaces, type Place } from './places'

export const PLACES_MAX_AGE = 14 * 24 * 60 * 60 * 1000
const CACHE_LIMIT_BYTES = 20 * 1024 * 1024
const CACHE_VERSION = 1

export type CachedPlaces = { key: string; downloadedAt: number; places: Place[] }
type StoredEntry = CachedPlaces & { version: number; bytes: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error ?? new Error('Orte-Cache-Anfrage fehlgeschlagen'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  const result = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('Orte-Cache-Transaktion fehlgeschlagen'))
  })
  void result.catch(() => {})
  return result
}

function readEntry(value: unknown): CachedPlaces {
  if (!isRecord(value)) throw new Error('Ungültiger Orte-Cache-Eintrag')
  const entry = value
  if (entry.version !== CACHE_VERSION || typeof entry.key !== 'string' ||
    typeof entry.downloadedAt !== 'number' || !Number.isFinite(entry.downloadedAt) ||
    !Array.isArray(entry.places)) throw new Error('Ungültiger Orte-Cache-Eintrag')
  const elements = entry.places.map((item: unknown) => {
    if (!isRecord(item)) throw new Error('Ungültiger Ort im Cache')
    const place = item
    return {
      type: place.type,
      id: place.id,
      lat: place.latitude,
      lon: place.longitude,
      center: { lat: place.latitude, lon: place.longitude },
      tags: place.tags,
    }
  })
  return { key: entry.key, downloadedAt: entry.downloadedAt, places: parsePlaces({ elements }) }
}

export function isPlacesEntryFresh(entry: CachedPlaces, now = Date.now()): boolean {
  return entry.downloadedAt <= now && now - entry.downloadedAt < PLACES_MAX_AGE
}

export class PlacesCache {
  private database: Promise<IDBDatabase> | null = null
  private readonly name: string
  private readonly limit: number

  constructor(name = 'mapvento-osm-places', limit = CACHE_LIMIT_BYTES) {
    this.name = name
    this.limit = limit
  }

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        if (!globalThis.indexedDB) {
          reject(new Error('IndexedDB ist nicht verfügbar'))
          return
        }
        const opening = indexedDB.open(this.name, 1)
        opening.onupgradeneeded = () => opening.result.createObjectStore('places', { keyPath: 'key' })
        opening.onsuccess = () => {
          opening.result.onversionchange = () => {
            opening.result.close()
            this.database = null
          }
          resolve(opening.result)
        }
        opening.onerror = () => reject(opening.error ?? new Error('Orte-Cache konnte nicht geöffnet werden'))
        opening.onblocked = () => reject(new Error('Orte-Cache ist durch ein anderes Fenster blockiert'))
      }).catch((error: unknown) => {
        this.database = null
        throw error
      })
    }
    return this.database
  }

  async get(keys: readonly string[]): Promise<Map<string, CachedPlaces>> {
    const db = await this.open()
    const tx = db.transaction('places', 'readwrite')
    const done = transactionDone(tx)
    const store = tx.objectStore('places')
    const entries = await Promise.all(keys.map((key) => request<unknown>(store.get(key))))
    const result = new Map<string, CachedPlaces>()
    entries.forEach((value, index) => {
      if (value === undefined) return
      try {
        const entry = readEntry(value)
        if (entry.key !== keys[index]) throw new Error('Orte-Cache-Schlüssel stimmt nicht überein')
        result.set(entry.key, entry)
      } catch {
        store.delete(keys[index])
      }
    })
    await done
    return result
  }

  async put(entries: readonly CachedPlaces[], signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const encoded = entries.map((entry): StoredEntry => {
      const validated = readEntry({ ...entry, version: CACHE_VERSION })
      const bytes = new TextEncoder().encode(JSON.stringify(validated)).byteLength
      if (bytes > this.limit) throw new Error('Orte-Daten sind zu groß für den Cache')
      return { ...validated, version: CACHE_VERSION, bytes }
    })
    if (encoded.reduce((sum, entry) => sum + entry.bytes, 0) > this.limit) {
      throw new Error('Orte-Daten sind zu groß für den Cache')
    }
    const db = await this.open()
    signal?.throwIfAborted()
    const tx = db.transaction('places', 'readwrite')
    const done = transactionDone(tx)
    const abort = () => tx.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const store = tx.objectStore('places')
      const existing = await request<unknown[]>(store.getAll())
      signal?.throwIfAborted()
      const current = new Map<string, StoredEntry>()
      for (const item of existing) {
        if (!isRecord(item)) continue
        try {
          const entry = readEntry(item)
          const bytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength
          current.set(entry.key, { ...entry, version: CACHE_VERSION, bytes })
        } catch {
          if (typeof item.key === 'string') store.delete(item.key)
        }
      }
      for (const entry of encoded) current.set(entry.key, entry)
      let total = Array.from(current.values()).reduce((sum, entry) => sum + entry.bytes, 0)
      const protectedKeys = new Set(encoded.map((entry) => entry.key))
      for (const entry of Array.from(current.values()).sort((a, b) => a.downloadedAt - b.downloadedAt)) {
        if (total <= this.limit) break
        if (!protectedKeys.has(entry.key)) {
          store.delete(entry.key)
          total -= entry.bytes
        }
      }
      for (const entry of encoded) store.put(entry)
      await done
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  async clear(): Promise<void> {
    const db = await this.open()
    const tx = db.transaction('places', 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore('places').clear()
    await done
  }
}

export const placesCache = new PlacesCache()
