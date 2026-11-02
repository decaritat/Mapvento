import { getDisplayedRouteCoordinates, type Coordinate, type MapPoint, type ProjectFile, type Route, type RouteNode } from './routeModel'
import { isPoiIconId } from './poiIcons'
import { layers } from './providers'

const initialRoute: Route = {
  id: 'route-1',
  name: 'Neue 1. Route',
  description: '',
  type: 'hiking',
  editable: true,
  nodes: [],
  showDistanceMarkers: false,
  distanceMarkerMode: 'auto',
  distanceMarkerStepKm: 1,
}

export const initialProject: ProjectFile = {
  version: 1,
  name: 'Mein Outdoor-Projekt',
  description: '',
  routes: [initialRoute],
  points: [],
  activeRouteId: initialRoute.id,
  mapLayerId: 'osm',
}

function invalid(path: string, detail: string): never {
  throw new Error(`Ungültiges Projekt: ${path} ${detail}`)
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(path, 'muss ein Objekt sein.')
  }
  return value as Record<string, unknown>
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') return invalid(path, 'muss eine Zeichenfolge sein.')
  return value
}

function id(value: unknown, path: string): string {
  const result = string(value, path)
  if (!result.trim()) return invalid(path, 'darf nicht leer sein.')
  return result
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return invalid(path, 'muss ein Wahrheitswert sein.')
  return value
}

function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalid(path, 'muss eine endliche Zahl sein.')
  }
  return value
}

function oneOf<const T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
): T {
  if (typeof value !== 'string') return invalid(path, 'enthält einen unbekannten Wert.')
  const result = values.find((item) => item === value)
  if (result === undefined) return invalid(path, 'enthält einen unbekannten Wert.')
  return result
}

function array<T>(
  value: unknown,
  path: string,
  parse: (item: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value)) return invalid(path, 'muss eine Liste sein.')
  return Array.from(value, (item: unknown, index: number) => parse(item, `${path}[${index}]`))
}

function optional<T>(
  value: unknown,
  path: string,
  parse: (item: unknown, path: string) => T,
): T | undefined {
  return value === undefined ? undefined : parse(value, path)
}

function coordinate(value: unknown, path: string): Coordinate {
  if (!Array.isArray(value) || value.length !== 2) {
    return invalid(path, 'muss aus Längen- und Breitengrad bestehen.')
  }
  const longitude = number(value[0], `${path}[0]`)
  const latitude = number(value[1], `${path}[1]`)
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return invalid(path, 'liegt außerhalb des gültigen Koordinatenbereichs.')
  }
  return [longitude, latitude]
}

function node(value: unknown, path: string): RouteNode {
  const data = object(value, path)
  return {
    id: id(data.id, `${path}.id`),
    coordinate: coordinate(data.coordinate, `${path}.coordinate`),
  }
}

function uniqueIds(items: Array<{ id: string }>, path: string) {
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    invalid(path, 'enthält mehrfach vergebene IDs.')
  }
}

function timestamp(value: unknown, path: string): string | null {
  if (value === null) return null
  const result = string(value, path)
  if (!Number.isFinite(Date.parse(result))) return invalid(path, 'ist kein gültiger Zeitstempel.')
  return result
}

function route(value: unknown, path: string): Route {
  const data = object(value, path)
  const nodes = array(data.nodes, `${path}.nodes`, node)
  uniqueIds(nodes, `${path}.nodes`)
  const geometry = optional(data.geometry, `${path}.geometry`, (item, itemPath) =>
    array(item, itemPath, coordinate),
  )
  if (geometry && geometry.length === 0) invalid(`${path}.geometry`, 'darf nicht leer sein.')
  const elevations = optional(data.elevations, `${path}.elevations`, (item, itemPath) =>
    array(item, itemPath, number),
  )
  const timestamps = optional(data.timestamps, `${path}.timestamps`, (item, itemPath) =>
    array(item, itemPath, timestamp),
  )
  const result: Route = {
    id: id(data.id, `${path}.id`),
    name: string(data.name, `${path}.name`),
    description: string(data.description, `${path}.description`).slice(0, 180),
    type: oneOf(data.type, ['hiking', 'cycling'], `${path}.type`),
    editable: boolean(data.editable, `${path}.editable`),
    nodes,
    gpxType: optional(data.gpxType, `${path}.gpxType`, string),
    color: optional(data.color, `${path}.color`, string),
    customColor: optional(data.customColor, `${path}.customColor`, string),
    geometry,
    elevations,
    timestamps,
    routingState: optional(data.routingState, `${path}.routingState`, (item, itemPath) =>
      oneOf(item, ['idle', 'loading', 'ready', 'fallback'], itemPath),
    ),
    routingError: optional(data.routingError, `${path}.routingError`, string),
    showDistanceMarkers: optional(data.showDistanceMarkers, `${path}.showDistanceMarkers`, boolean),
    distanceMarkerMode: optional(data.distanceMarkerMode, `${path}.distanceMarkerMode`, (item, itemPath) =>
      oneOf(item, ['auto', 'manual'], itemPath),
    ),
    distanceMarkerStepKm: optional(data.distanceMarkerStepKm, `${path}.distanceMarkerStepKm`, number),
  }
  const coordinateCount = getDisplayedRouteCoordinates(result).length
  if (elevations && elevations.length !== coordinateCount) {
    invalid(`${path}.elevations`, 'muss zur Routengeometrie passen.')
  }
  if (timestamps && timestamps.length !== coordinateCount) {
    invalid(`${path}.timestamps`, 'muss zur Routengeometrie passen.')
  }
  return result
}

function point(value: unknown, path: string): MapPoint {
  const data = object(value, path)
  const icon = optional(data.icon, `${path}.icon`, (item, itemPath) => {
    if (!isPoiIconId(item)) return invalid(itemPath, 'enthält ein unbekanntes POI-Symbol.')
    return item
  })
  return {
    id: id(data.id, `${path}.id`),
    name: string(data.name, `${path}.name`),
    description: string(data.description, `${path}.description`),
    coordinate: coordinate(data.coordinate, `${path}.coordinate`),
    source: oneOf(data.source, ['manual', 'poi'], `${path}.source`),
    editable: optional(data.editable, `${path}.editable`, boolean),
    icon,
  }
}

export function normalizeProject(value: unknown): ProjectFile {
  const data = object(value, 'Projekt')
  if (data.version !== 1) invalid('version', 'wird nicht unterstützt.')
  const routes = array(data.routes, 'routes', route)
  const points = array(data.points, 'points', point)
  uniqueIds(routes, 'routes')
  uniqueIds(points, 'points')
  const activeRouteId = string(data.activeRouteId, 'activeRouteId')
  if (
    (routes.length === 0 && activeRouteId !== '') ||
    (routes.length > 0 && !routes.some((item) => item.id === activeRouteId))
  ) {
    invalid('activeRouteId', 'verweist nicht auf eine vorhandene Route.')
  }
  const mapLayerId = string(data.mapLayerId, 'mapLayerId')
  if (!layers.some((layer) => layer.id === mapLayerId && !layer.requiresKey)) {
    invalid('mapLayerId', 'enthält einen unbekannten Kartenlayer.')
  }
  return {
    version: 1,
    name: string(data.name, 'name'),
    description: string(data.description, 'description').slice(0, 180),
    routes,
    points,
    activeRouteId,
    mapLayerId,
  }
}

export function readInitialProject(storage: Pick<Storage, 'getItem'> = localStorage): ProjectFile {
  try {
    const saved = storage.getItem('trailforge-project')
    if (!saved) return initialProject
    return normalizeProject(JSON.parse(saved))
  } catch (error) {
    console.warn('Gespeichertes Projekt konnte nicht geladen werden.', error)
    return initialProject
  }
}
