import { batchesForCells, cellForPosition, cellKey, type PlaceCell } from './placeCells'
import { fetchPlaces, OverpassHttpError, OverpassInvalidResponseError, OverpassNetworkError, OverpassSizeError, OverpassUnavailableError, placeKind, type Bounds, type Place, type PlaceCategory, type PlacesDiagnostic } from './places'
import { isPlacesEntryFresh, type CachedPlaces, type PlacesCache } from './placesCache'
import { diagnosticErrorName, placesAbortReason } from './placesDiagnostics'
import { providersForBounds, type PlacesProvider } from './placesProviders'

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
  onDiagnostic?: (event: PlacesDiagnostic) => void
  collectDiagnosticDetails?: () => boolean
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
  async function cacheOperation<T>(phase: 'cache-read' | 'cache-write', count: number, operation: () => Promise<T>): Promise<T> {
    const startedAt = new Date().toISOString()
    const start = performance.now()
    let outcome: PlacesDiagnostic['outcome'] = 'success'
    let errorName: string | null = null
    try {
      return await operation()
    } catch (error) {
      outcome = signal.aborted ? 'aborted' : 'cache-error'
      errorName = diagnosticErrorName(error)
      throw error
    } finally {
      options.onDiagnostic?.({ startedAt, durationMs: Math.round(performance.now() - start), provider: null, phase, httpStatus: null,
        outcome, detail: null, abortReason: outcome === 'aborted' ? placesAbortReason(signal) : null, errorName,
        categoryCount: categories.length, itemCount: count, responseBytes: null, splitDepth: null, retryAfterMs: null })
    }
  }
  const entries = await cacheOperation('cache-read', keys.length, () => cache.get(keys))
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
  const unavailableProviders = new Set<string>()

  async function attempt(bounds: Bounds, selected: PlaceCategory[], depth: number, provider: PlacesProvider, fallbackFrom?: string): Promise<Place[]> {
    signal.throwIfAborted()
    const delay = Math.max(0, lastRequestAt + 1000 - Date.now(), nextAllowedAt - Date.now())
    if (delay) {
      const switching = fallbackFrom ? `Wechsel zu ${provider.name} (${fallbackFrom} nicht verfügbar). ` : ''
      message = `${switching}Warte auf die nächste Overpass-Abfrage (${Math.ceil(delay / 1000)} Sekunden) …`
      report()
      await pause(delay, signal)
    }
    signal.throwIfAborted()
    lastRequestAt = Date.now()
    message = `Orte werden über ${provider.name} geladen${fallbackFrom ? ` (Fallback für ${fallbackFrom})` : ''} …`
    report()
    const request = new AbortController()
    const abort = () => request.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      request.abort(new DOMException('Overpass-Zeitlimit erreicht', 'TimeoutError'))
    }, 50_000)
    try {
      return await doFetch(bounds, selected, request.signal, options.onDiagnostic
        ? (event) => options.onDiagnostic?.({ ...event, splitDepth: depth })
        : undefined, options.collectDiagnosticDetails, provider)
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof OverpassHttpError && (error.status === 429 || error.status === 406)) {
        nextAllowedAt = Math.max(nextAllowedAt, Date.now() + error.retryAfterMs)
      }
      if (timedOut) throw new OverpassUnavailableError('Overpass hat innerhalb von 50 Sekunden nicht vollständig geantwortet. Bitte später erneut versuchen.')
      throw error
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
  }

  async function fetchPart(bounds: Bounds, selected: PlaceCategory[], depth: number): Promise<Place[]> {
    const providers = providersForBounds(bounds)
    try {
      for (let index = 0; index < providers.length; index++) {
        const provider = providers[index]
        if (index < providers.length - 1 && unavailableProviders.has(provider.id)) continue
        try {
          const fallbackFrom = index > 0 && unavailableProviders.has(providers[0].id) ? providers[0].name : undefined
          return await attempt(bounds, selected, depth, provider, fallbackFrom)
        } catch (error) {
          signal.throwIfAborted()
          const canFallback = error instanceof OverpassNetworkError || error instanceof OverpassUnavailableError ||
            error instanceof OverpassInvalidResponseError ||
            (error instanceof OverpassHttpError &&
              ([401, 403, 404, 408].includes(error.status) || error.status >= 500))
          if (!canFallback || index === providers.length - 1) throw error
          unavailableProviders.add(provider.id)
          message = `${provider.name} nicht verfügbar; Wechsel zu ${providers[index + 1].name} …`
          report()
        }
      }
      throw new Error('Kein Overpass-Anbieter verfügbar')
    } catch (error) {
      if (!(error instanceof OverpassSizeError) || depth >= 2) throw error
      message = 'Overpass-Ressourcenlimit erreicht; Abfrage wird aufgeteilt …'
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
    await cacheOperation('cache-write', updates.length, () => cache.put(updates, signal))
    signal.throwIfAborted()
    for (const entry of updates) entries.set(entry.key, entry)
    pending -= updates.length
    message = pending ? 'Orte werden geladen …' : 'Orte sind aktuell.'
    report()
  }
}
