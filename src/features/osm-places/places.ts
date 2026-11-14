import { POI_ICON_IDS, type PoiIconId } from '../../domain/poiIconIds'
import { diagnosticErrorName, overpassErrorDetail, placesAbortReason, type PlacesDiagnostic } from './placesDiagnostics'
import { PRIVATE_COFFEE, type PlacesProvider } from './placesProviders'
export type { PlacesDiagnostic } from './placesDiagnostics'

export const PLACE_CATEGORIES = [
  { id: 'water', label: 'Wasser' },
  { id: 'lodging', label: 'Unterkunft' },
  { id: 'info', label: 'Info' },
  { id: 'food', label: 'Essen und Trinken' },
  { id: 'service', label: 'Service' },
  { id: 'transport', label: 'Transport' },
] as const

export type PlaceCategory = typeof PLACE_CATEGORIES[number]['id']
export type Bounds = { south: number; west: number; north: number; east: number }
export type Place = {
  type: 'node' | 'way' | 'relation'
  id: number
  latitude: number
  longitude: number
  tags: Record<string, string>
}

export class OverpassHttpError extends Error {
  status: number
  retryAfterMs: number

  constructor(status: number, retryAfter: string | null) {
    super(`Overpass HTTP ${status}`)
    this.status = status
    const seconds = Number(retryAfter)
    const date = retryAfter ? Date.parse(retryAfter) : NaN
    this.retryAfterMs = Math.max(30_000, Number.isFinite(seconds) && retryAfter !== null
      ? seconds * 1000 : Number.isFinite(date) ? date - Date.now() : 0)
  }
}

export class OverpassSizeError extends Error {}
export class OverpassUnavailableError extends Error {}
export class OverpassNetworkError extends Error {}
export class OverpassInvalidResponseError extends Error {}

type PlaceKind = { category: PlaceCategory; key: string; value: string; icon: PoiIconId }

export const PLACE_KINDS: readonly PlaceKind[] = [
  { category: 'water', key: 'natural', value: 'spring', icon: POI_ICON_IDS.spring },
  { category: 'water', key: 'amenity', value: 'drinking_water', icon: POI_ICON_IDS.drinkingWater },
  { category: 'lodging', key: 'amenity', value: 'shelter', icon: POI_ICON_IDS.shelter },
  { category: 'lodging', key: 'tourism', value: 'camp_site', icon: POI_ICON_IDS.camp },
  { category: 'lodging', key: 'tourism', value: 'alpine_hut', icon: POI_ICON_IDS.alpineHut },
  { category: 'lodging', key: 'tourism', value: 'wilderness_hut', icon: POI_ICON_IDS.wildernessHut },
  { category: 'lodging', key: 'tourism', value: 'picnic_site', icon: POI_ICON_IDS.picnic },
  { category: 'info', key: 'natural', value: 'peak', icon: POI_ICON_IDS.summit },
  { category: 'info', key: 'tourism', value: 'viewpoint', icon: POI_ICON_IDS.viewpoint },
  { category: 'info', key: 'tourism', value: 'attraction', icon: POI_ICON_IDS.attraction },
  { category: 'info', key: 'tourism', value: 'museum', icon: POI_ICON_IDS.museum },
  { category: 'food', key: 'amenity', value: 'restaurant', icon: POI_ICON_IDS.restaurant },
  { category: 'food', key: 'amenity', value: 'cafe', icon: POI_ICON_IDS.cafe },
  { category: 'food', key: 'shop', value: 'supermarket', icon: POI_ICON_IDS.supermarket },
  { category: 'service', key: 'amenity', value: 'toilets', icon: POI_ICON_IDS.toilet },
  { category: 'service', key: 'amenity', value: 'shower', icon: POI_ICON_IDS.shower },
  { category: 'service', key: 'amenity', value: 'atm', icon: POI_ICON_IDS.atm },
  { category: 'service', key: 'amenity', value: 'parking', icon: POI_ICON_IDS.parking },
  { category: 'transport', key: 'railway', value: 'station', icon: POI_ICON_IDS.train },
  { category: 'transport', key: 'highway', value: 'bus_stop', icon: POI_ICON_IDS.bus },
  { category: 'transport', key: 'amenity', value: 'bus_station', icon: POI_ICON_IDS.bus },
  { category: 'transport', key: 'amenity', value: 'ferry_terminal', icon: POI_ICON_IDS.ferry },
]

export function placeKind(place: Place, categories: readonly PlaceCategory[]): PlaceKind | undefined {
  return PLACE_KINDS.find((kind) => categories.includes(kind.category) && place.tags[kind.key] === kind.value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parsePlaces(value: unknown): Place[] {
  if (!isRecord(value) || !Array.isArray(value.elements) || value.remark !== undefined) {
    throw new Error('Unvollständige oder ungültige Overpass-Antwort')
  }
  return value.elements.map((element: unknown): Place => {
    if (!isRecord(element) || (element.type !== 'node' && element.type !== 'way' && element.type !== 'relation') ||
      typeof element.id !== 'number' || !Number.isSafeInteger(element.id) || element.id <= 0 ||
      !isRecord(element.tags)) throw new Error('Ungültiges OSM-Objekt')
    const position = element.type === 'node' ? element : element.center
    if (!isRecord(position) || typeof position.lat !== 'number' || typeof position.lon !== 'number' ||
      !Number.isFinite(position.lat) || !Number.isFinite(position.lon) ||
      Math.abs(position.lat) > 90 || Math.abs(position.lon) > 180) throw new Error('Ungültige OSM-Koordinaten')
    const tags: Record<string, string> = {}
    for (const [key, tag] of Object.entries(element.tags)) {
      if (typeof tag !== 'string') throw new Error('Ungültige OSM-Tags')
      Object.defineProperty(tags, key, { value: tag, enumerable: true, writable: true, configurable: true })
    }
    return { type: element.type, id: element.id, latitude: position.lat, longitude: position.lon, tags }
  }).filter((place: Place) => ![
    'private', 'no', 'customers', 'permit', 'restricted', 'military', 'agricultural', 'forestry',
  ].includes(place.tags.access?.trim().toLowerCase() ?? ''))
}

export function buildPlacesQuery(bounds: Bounds, categories: readonly PlaceCategory[]): string {
  if (![bounds.south, bounds.west, bounds.north, bounds.east].every(Number.isFinite) ||
    bounds.south < -90 || bounds.north > 90 || bounds.west < -180 || bounds.east > 180 ||
    bounds.south >= bounds.north || bounds.west >= bounds.east || categories.length === 0) {
    throw new Error('Ungültiger Kartenbereich oder keine Kategorie ausgewählt')
  }
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`
  const selectors = PLACE_KINDS.filter((kind) => categories.includes(kind.category))
    .map((kind) => `nwr["${kind.key}"="${kind.value}"](${bbox});`).join('')
  return `[out:json][timeout:25];(${selectors});out center;`
}

async function readErrorDetail(response: Response, signal: AbortSignal): Promise<PlacesDiagnostic['detail']> {
  if (!response.body) return null
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 1000) })
  try {
    while (bytes < 4096) {
      const result = await Promise.race([reader.read(), timeout])
      if (!result) return 'body-unavailable'
      const { done, value } = result
      if (done) break
      bytes += value.byteLength
      text += decoder.decode(value.subarray(0, Math.max(0, 4096 - (bytes - value.byteLength))), { stream: true })
      const detail = overpassErrorDetail(text)
      if (detail) return detail
    }
    return overpassErrorDetail(text)
  } catch {
    signal.throwIfAborted()
    return 'body-unavailable'
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function fetchPlaces(bounds: Bounds, categories: readonly PlaceCategory[], signal: AbortSignal,
  onDiagnostic?: (event: PlacesDiagnostic) => void, collectDetails: () => boolean = () => Boolean(onDiagnostic),
  provider: PlacesProvider = PRIVATE_COFFEE): Promise<Place[]> {
  const startedAt = new Date().toISOString()
  const start = performance.now()
  let httpStatus: number | null = null
  let outcome: PlacesDiagnostic['outcome'] = 'client-error'
  let phase: PlacesDiagnostic['phase'] = 'prepare'
  let detail: PlacesDiagnostic['detail'] = null
  let errorName: string | null = null
  let responseBytes: number | null = null
  let retryAfterMs: number | null = null
  let itemCount: number | null = null
  try {
    const query = buildPlacesQuery(bounds, categories)
    phase = 'request'
    outcome = 'network-error'
    let response: Response
    try {
      response = await fetch(provider.endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal,
        referrerPolicy: 'strict-origin-when-cross-origin',
      })
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof TypeError) throw new OverpassNetworkError('Overpass-Netzwerk- oder CORS-Fehler')
      throw error
    }
    httpStatus = response.status
    if (!response.ok) {
      outcome = 'http-error'
      const httpError = new OverpassHttpError(response.status, response.headers.get('retry-after'))
      if (response.status === 429 || response.status === 406) retryAfterMs = httpError.retryAfterMs
      if (collectDetails()) {
        phase = 'body'
        try {
          detail = await readErrorDetail(response, signal)
        } catch {
          signal.throwIfAborted()
          detail = 'body-unavailable'
        }
      } else {
        await response.body?.cancel()
      }
      throw httpError
    }
    outcome = 'invalid-response'
    phase = 'body'
    detail = 'body-unavailable'
    const maxBytes = 4 * 1024 * 1024
    const advertised = Number(response.headers.get('content-length'))
    if (Number.isFinite(advertised) && advertised > maxBytes) {
      detail = 'response-too-large'
      await response.body?.cancel()
      throw new OverpassSizeError('Overpass-Antwort zu groß')
    }
    if (!response.body) throw new OverpassInvalidResponseError('Overpass-Antwort enthält keine Daten')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    let bytes = 0
    responseBytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        responseBytes = bytes
        if (bytes > maxBytes) {
          detail = 'response-too-large'
          await reader.cancel()
          throw new OverpassSizeError('Overpass-Antwort zu groß')
        }
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof OverpassSizeError) throw error
      throw new OverpassNetworkError('Overpass-Antwort konnte nicht gelesen werden', { cause: error })
    } finally {
      reader.releaseLock()
    }
    phase = 'parse'
    detail = 'invalid-json'
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch (error) {
      detail = overpassErrorDetail(text) ?? 'invalid-json'
      throw new OverpassInvalidResponseError('Ungültiges JSON in der Overpass-Antwort', { cause: error })
    }
    detail = 'invalid-data'
    if (isRecord(data) && data.remark !== undefined) {
      detail = typeof data.remark === 'string' ? overpassErrorDetail(data.remark) ?? 'overpass-error' : 'overpass-error'
      if (detail === 'out-of-memory') {
        throw new OverpassSizeError('Overpass-Abfrage hat das Ressourcenlimit überschritten')
      }
      if (detail === 'server-busy') throw new OverpassUnavailableError('Overpass meldet eine Überlastung. Bitte später erneut versuchen.')
      if (detail === 'query-timeout') throw new OverpassUnavailableError('Overpass-Abfrage hat das Zeitlimit des Servers erreicht. Bitte später erneut versuchen.')
      throw new OverpassInvalidResponseError('Overpass meldet eine unvollständige Antwort')
    }
    let result: Place[]
    try {
      result = parsePlaces(data)
    } catch (error) {
      throw new OverpassInvalidResponseError('Ungültige Overpass-Antwort', { cause: error })
    }
    outcome = 'success'
    phase = 'complete'
    detail = null
    itemCount = result.length
    return result
  } catch (error) {
    errorName = diagnosticErrorName(error)
    if (signal.aborted) {
      outcome = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError' ? 'timeout' : 'aborted'
    } else if (outcome === 'network-error') {
      detail = 'network-or-cors'
    } else if (outcome === 'client-error') {
      detail = 'invalid-request'
    }
    throw error
  } finally {
    onDiagnostic?.({ startedAt, durationMs: Math.round(performance.now() - start), provider: provider.id, phase, httpStatus, outcome,
      detail, abortReason: outcome === 'aborted' ? placesAbortReason(signal) : null,
      errorName, categoryCount: categories.length, itemCount, responseBytes, splitDepth: null, retryAfterMs })
  }
}
