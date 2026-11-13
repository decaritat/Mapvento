import { POI_ICON_IDS, type PoiIconId } from '../../domain/poiIconIds'

export const PLACES_PROVIDER = {
  id: 'private-coffee',
  endpoint: 'https://overpass.private.coffee/api/interpreter',
  url: 'https://overpass.private.coffee/',
} as const

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

export async function fetchPlaces(bounds: Bounds, categories: readonly PlaceCategory[], signal: AbortSignal): Promise<Place[]> {
  const response = await fetch(PLACES_PROVIDER.endpoint, {
    method: 'POST',
    body: new URLSearchParams({ data: buildPlacesQuery(bounds, categories) }),
    signal,
    referrerPolicy: 'strict-origin-when-cross-origin',
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new OverpassHttpError(response.status, response.headers.get('retry-after'))
  }
  const maxBytes = 4 * 1024 * 1024
  const advertised = Number(response.headers.get('content-length'))
  if (Number.isFinite(advertised) && advertised > maxBytes) {
    await response.body?.cancel()
    throw new OverpassSizeError('Overpass-Antwort zu groß')
  }
  if (!response.body) throw new Error('Overpass-Antwort enthält keine Daten')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new OverpassSizeError('Overpass-Antwort zu groß')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  const data: unknown = JSON.parse(text)
  if (isRecord(data) && data.remark !== undefined) throw new OverpassSizeError('Overpass-Abfrage unvollständig')
  return parsePlaces(data)
}
