import type { PoiIconId } from './poiIcons'

export type RouteType = 'hiking' | 'cycling'
export type DistanceMarkerMode = 'auto' | 'manual'
export type Coordinate = [number, number]

export type RouteNode = {
  id: string
  coordinate: Coordinate
}

export type Route = {
  id: string
  name: string
  description: string
  type: RouteType
  gpxType?: string
  color?: string
  customColor?: string
  editable: boolean
  nodes: RouteNode[]
  geometry?: Coordinate[]
  elevations?: number[]
  timestamps?: Array<string | null>
  routingState?: 'idle' | 'loading' | 'ready' | 'fallback'
  routingError?: string
  showDistanceMarkers?: boolean
  distanceMarkerMode?: DistanceMarkerMode
  distanceMarkerStepKm?: number
}

export type ProfilePointDetails = {
  routeId: string
  profileFraction: number
  distance: number
  elevation: number
  elapsedMinutes: number
  coordinate: Coordinate
  nodeIndex?: number
}

export type MapPoint = {
  id: string
  name: string
  description: string
  coordinate: Coordinate
  source: 'manual' | 'poi'
  editable?: boolean
  icon?: PoiIconId
}

export type ProjectFile = {
  version: 1
  name: string
  description: string
  routes: Route[]
  points: MapPoint[]
  activeRouteId: string
  mapLayerId: string
  mapOverlayIds?: string[]
}

export function distanceKm(a: Coordinate, b: Coordinate) {
  const earthRadiusKm = 6371
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function getRouteCoordinates(route: Route): Coordinate[] {
  if (route.nodes.length < 2) return route.nodes.map((node) => node.coordinate)
  const coordinates: Coordinate[] = []
  for (let index = 0; index < route.nodes.length - 1; index += 1) {
    const from = route.nodes[index].coordinate
    const to = route.nodes[index + 1].coordinate
    const steps = 12
    for (let step = 0; step < steps; step += 1) {
      const fraction = step / steps
      coordinates.push([
        from[0] + (to[0] - from[0]) * fraction,
        from[1] + (to[1] - from[1]) * fraction,
      ])
    }
  }
  coordinates.push(route.nodes.at(-1)!.coordinate)
  return coordinates
}

export function getDisplayedRouteCoordinates(route: Route): Coordinate[] {
  return route.geometry?.length ? route.geometry : getRouteCoordinates(route)
}

export function getRouteInsertionIndex(
  nodes: RouteNode[],
  coordinate: Coordinate,
): number | null {
  if (nodes.length < 2) return null

  let insertIndex = nodes.length
  let closestDistance = Number.POSITIVE_INFINITY
  for (let index = 1; index < nodes.length; index += 1) {
    const from = nodes[index - 1].coordinate
    const to = nodes[index].coordinate
    const latitudeScale =
      Math.cos((((from[1] + to[1] + coordinate[1]) / 3) * Math.PI) / 180) || 1
    const pointX = coordinate[0] * latitudeScale
    const pointY = coordinate[1]
    const fromX = from[0] * latitudeScale
    const fromY = from[1]
    const toX = to[0] * latitudeScale
    const toY = to[1]
    const deltaX = toX - fromX
    const deltaY = toY - fromY
    const segmentLengthSquared = deltaX * deltaX + deltaY * deltaY
    const projection =
      segmentLengthSquared === 0
        ? 0
        : Math.min(
            1,
            Math.max(
              0,
              ((pointX - fromX) * deltaX + (pointY - fromY) * deltaY) /
                segmentLengthSquared,
            ),
          )
    const closestX = fromX + projection * deltaX
    const closestY = fromY + projection * deltaY
    const distance = (pointX - closestX) ** 2 + (pointY - closestY) ** 2
    if (distance < closestDistance) {
      closestDistance = distance
      insertIndex = index
    }
  }

  return insertIndex
}

export function getCumulativeDistances(coordinates: Coordinate[]) {
  const distances = [0]
  for (let index = 1; index < coordinates.length; index += 1) {
    distances.push(distances[index - 1] + distanceKm(coordinates[index - 1], coordinates[index]))
  }
  return distances
}
