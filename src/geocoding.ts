import { invoke, isTauri } from '@tauri-apps/api/core'
import type { Geometry, Position } from 'geojson'
import type { PlaceSearchResult } from './appTypes'
import { GEOCODING_PROVIDER } from './providers'

function invalidResponse(): never {
  throw new Error('Invalid geocoding response')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function position(value: unknown): Position {
  if (!Array.isArray(value) || value.length < 2) return invalidResponse()
  const coordinates = Array.from(value, (coordinate) => {
    if (typeof coordinate !== 'number' || !Number.isFinite(coordinate)) {
      return invalidResponse()
    }
    return coordinate
  })
  if (
    coordinates[0] < -180 ||
    coordinates[0] > 180 ||
    coordinates[1] < -90 ||
    coordinates[1] > 90
  ) return invalidResponse()
  return coordinates
}

function positions(value: unknown, minimumLength = 2): Position[] {
  if (!Array.isArray(value)) return invalidResponse()
  const result = Array.from(value, position)
  if (result.length < minimumLength) return invalidResponse()
  return result
}

function polygonCoordinates(value: unknown): Position[][] {
  if (!Array.isArray(value) || value.length === 0) return invalidResponse()
  return Array.from(value, (ring) => positions(ring, 4))
}

function multiPolygonCoordinates(value: unknown): Position[][][] {
  if (!Array.isArray(value) || value.length === 0) return invalidResponse()
  return Array.from(value, polygonCoordinates)
}

function geometry(value: unknown): Geometry {
  if (!isRecord(value)) return invalidResponse()
  const data = value
  switch (data.type) {
    case 'Point':
      return { type: 'Point', coordinates: position(data.coordinates) }
    case 'LineString':
      return { type: 'LineString', coordinates: positions(data.coordinates) }
    case 'MultiLineString': {
      if (!Array.isArray(data.coordinates) || data.coordinates.length === 0) return invalidResponse()
      return {
        type: 'MultiLineString',
        coordinates: Array.from(data.coordinates, (line) => positions(line)),
      }
    }
    case 'Polygon':
      return { type: 'Polygon', coordinates: polygonCoordinates(data.coordinates) }
    case 'MultiPolygon':
      return { type: 'MultiPolygon', coordinates: multiPolygonCoordinates(data.coordinates) }
    default:
      return invalidResponse()
  }
}

function parseBoundingBox(value: unknown): [string, string, string, string] {
  if (!Array.isArray(value) || value.length !== 4) {
    return invalidResponse()
  }
  const [southValue, northValue, westValue, eastValue] = value
  if (
    typeof southValue !== 'string' ||
    typeof northValue !== 'string' ||
    typeof westValue !== 'string' ||
    typeof eastValue !== 'string' ||
    !southValue.trim() ||
    !northValue.trim() ||
    !westValue.trim() ||
    !eastValue.trim()
  ) return invalidResponse()
  const south = Number(southValue)
  const north = Number(northValue)
  const west = Number(westValue)
  const east = Number(eastValue)
  if (
    ![south, north, west, east].every(Number.isFinite) ||
    south < -90 ||
    north > 90 ||
    west < -180 ||
    east > 180 ||
    south > north ||
    west > east
  ) {
    return invalidResponse()
  }
  return [southValue, northValue, westValue, eastValue]
}

function parseResult(value: unknown): PlaceSearchResult {
  if (!isRecord(value)) return invalidResponse()
  const data = value
  if (
    typeof data.place_id !== 'number' ||
    !Number.isSafeInteger(data.place_id) ||
    typeof data.display_name !== 'string' ||
    !data.display_name.trim() ||
    typeof data.lat !== 'string' ||
    typeof data.lon !== 'string'
  ) {
    return invalidResponse()
  }
  const latitude = Number(data.lat)
  const longitude = Number(data.lon)
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return invalidResponse()
  }
  const result: PlaceSearchResult = {
    place_id: data.place_id,
    display_name: data.display_name,
    lat: data.lat,
    lon: data.lon,
  }
  if (data.boundingbox !== undefined) result.boundingbox = parseBoundingBox(data.boundingbox)
  if (data.geojson !== undefined) result.geojson = geometry(data.geojson)
  return result
}

export function parseGeocodingResponse(value: unknown): PlaceSearchResult[] {
  if (!Array.isArray(value)) return invalidResponse()
  return Array.from(value, parseResult)
}

export async function searchPlaces(query: string, signal: AbortSignal): Promise<PlaceSearchResult[]> {
  if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
  let payload: unknown
  if (isTauri()) {
    const response = await invoke<string>('search_places', { query })
    if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    payload = JSON.parse(response)
  } else {
    const url = new URL(GEOCODING_PROVIDER.endpoint)
    url.search = new URLSearchParams({
      q: query,
      ...GEOCODING_PROVIDER.searchParameters,
    }).toString()
    const response = await fetch(url, {
      signal,
      referrerPolicy: 'strict-origin-when-cross-origin',
    })
    if (!response.ok) throw new Error(`Geocoding request failed: ${response.status}`)
    payload = await response.json()
  }
  return parseGeocodingResponse(payload)
}
