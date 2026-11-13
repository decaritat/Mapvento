import { batchesForCells, cellForPosition, cellKey, type PlaceCell } from './placeCells'
import { fetchPlaces, OverpassHttpError, OverpassSizeError, placeKind, type Bounds, type Place, type PlaceCategory } from './places'
import { isPlacesEntryFresh, type CachedPlaces, type PlacesCache } from './placesCache'

export type PlacesProgress = {
  available: number
  total: number
  pending: number
  stale: number
  message: string
}

type LoaderOptions = {
  cells: PlaceCell[]
  categories: PlaceCategory[]
  force: boolean
  cache: Pick<PlacesCache, 'get' | 'put'>
  signal: AbortSignal
  onUpdate: (entries: ReadonlyMap<string, CachedPlaces>, progress: PlacesProgress) => void
  fetch?: typeof fetchPlaces
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

let lastRequestAt = 0
let nextAllowedAt = 0

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function loadPlaces(options: LoaderOptions): Promise<void> {
  const { cells, categories, force, cache, signal, onUpdate } = options
  const doFetch = options.fetch ?? fetchPlaces
  const pause = options.wait ?? wait
  const keys = cells.flatMap((cell) => categories.map((category) => cellKey(cell, category)))
  const entries = await cache.get(keys)
  signal.throwIfAborted()
  const batches = batchesForCells(cells, categories, entries, force)
  let pending = batches.reduce((total, batch) => total + batch.cells.length * batch.categories.length, 0)
  let message = pending ? 'Orte werden geladen …' : 'Orte sind aktuell.'
  function report() {
    const stale = keys.filter((key) => {
      const entry = entries.get(key)
      return entry && !isPlacesEntryFresh(entry)
    }).length
    onUpdate(new Map(entries), {
      available: keys.filter((key) => entries.has(key)).length,
      total: keys.length,
      pending,
      stale,
      message,
    })
  }
  report()

  async function fetchPart(bounds: Bounds, selected: PlaceCategory[], depth: number): Promise<Place[]> {
    signal.throwIfAborted()
    const delay = Math.max(0, lastRequestAt + 1000 - Date.now(), nextAllowedAt - Date.now())
    if (delay) {
      message = `Warte auf die nächste Overpass-Abfrage (${Math.ceil(delay / 1000)} Sekunden) …`
      report()
      await pause(delay, signal)
    }
    signal.throwIfAborted()
    lastRequestAt = Date.now()
    const request = new AbortController()
    const abort = () => request.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      request.abort()
    }, 50_000)
    try {
      return await doFetch(bounds, selected, request.signal)
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof OverpassHttpError && (error.status === 429 || error.status === 406)) {
        nextAllowedAt = Math.max(nextAllowedAt, Date.now() + error.retryAfterMs)
      }
      if ((error instanceof OverpassSizeError || timedOut ||
        error instanceof OverpassHttpError && error.status === 504) && depth < 2) {
        message = 'Großer Bereich wird in kleinere Abfragen aufgeteilt …'
        report()
        const midLat = (bounds.south + bounds.north) / 2
        const midLon = (bounds.west + bounds.east) / 2
        const halves: Bounds[] = [
          { south: bounds.south, north: midLat, west: bounds.west, east: midLon },
          { south: bounds.south, north: midLat, west: midLon, east: bounds.east },
          { south: midLat, north: bounds.north, west: bounds.west, east: midLon },
          { south: midLat, north: bounds.north, west: midLon, east: bounds.east },
        ]
        const result = new Map<string, Place>()
        for (const part of halves) {
          for (const place of await fetchPart(part, selected, depth + 1)) result.set(`${place.type}:${place.id}`, place)
        }
        return Array.from(result.values())
      }
      if (timedOut) throw new Error('Overpass-Abfrage hat zu lange gedauert')
      throw error
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
  }

  for (const batch of batches) {
    let result: Place[]
    try {
      result = await fetchPart(batch.bounds, batch.categories, 0)
    } catch (error) {
      if (!(error instanceof OverpassHttpError) || error.status !== 429) throw error
      message = `Overpass bittet um eine Pause (${Math.ceil(error.retryAfterMs / 1000)} Sekunden) …`
      report()
      await pause(error.retryAfterMs, signal)
      signal.throwIfAborted()
      result = await fetchPart(batch.bounds, batch.categories, 0)
    }
    signal.throwIfAborted()
    const downloadedAt = Date.now()
    const updates = batch.cells.flatMap((cell) => batch.categories.map((category): CachedPlaces => ({
      key: cellKey(cell, category),
      downloadedAt,
      places: result.filter((place) => {
        const location = cellForPosition(place.latitude, place.longitude)
        return location.x === cell.x && location.y === cell.y && Boolean(placeKind(place, [category]))
      }),
    })))
    await cache.put(updates, signal)
    signal.throwIfAborted()
    for (const entry of updates) entries.set(entry.key, entry)
    pending -= updates.length
    message = pending ? 'Orte werden geladen …' : 'Orte sind aktuell.'
    report()
  }
}
