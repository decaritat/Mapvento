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
  geometry: Coordinate[] = nodes.map((node) => node.coordinate),
): number | null {
  if (nodes.length < 2) return null
  if (geometry.length < 2) geometry = nodes.map((node) => node.coordinate)

  function project(point: Coordinate, segment: number, minimumFraction = 0) {
    const from = geometry[segment]
    const to = geometry[segment + 1]
    const latitudeScale =
      Math.cos((((from[1] + to[1] + point[1]) / 3) * Math.PI) / 180) || 1
    const pointX = point[0] * latitudeScale
    const pointY = point[1]
    const fromX = from[0] * latitudeScale
    const fromY = from[1]
    const toX = to[0] * latitudeScale
    const toY = to[1]
    const deltaX = toX - fromX
    const deltaY = toY - fromY
    const segmentLengthSquared = deltaX * deltaX + deltaY * deltaY
    const projection =
      segmentLengthSquared === 0
        ? minimumFraction
        : Math.min(
            1,
            Math.max(
              minimumFraction,
              ((pointX - fromX) * deltaX + (pointY - fromY) * deltaY) /
                segmentLengthSquared,
            ),
          )
    const closestX = fromX + projection * deltaX
    const closestY = fromY + projection * deltaY
    return {
      position: segment + projection,
      distance: (pointX - closestX) ** 2 + (pointY - closestY) ** 2,
    }
  }

  const segmentCount = geometry.length - 1
  let clicked = project(coordinate, 0)
  for (let segment = 1; segment < segmentCount; segment += 1) {
    const candidate = project(coordinate, segment)
    if (candidate.distance < clicked.distance) clicked = candidate
  }

  // Match intermediate waypoints to the routed geometry in route order, even
  // when the geometry loops back near a later waypoint.
  type Match = { position: number; cost: number; precedingNodes: number }
  let previous: Match[] = []
  for (let nodeIndex = 1; nodeIndex < nodes.length - 1; nodeIndex += 1) {
    const current: Match[] = []
    let bestEarlier: Match | undefined
    for (let segment = 0; segment < segmentCount; segment += 1) {
      if (segment > 0) {
        const earlier = previous[segment - 1]
        if (earlier && (!bestEarlier || earlier.cost < bestEarlier.cost)) bestEarlier = earlier
      }
      const projection = project(nodes[nodeIndex].coordinate, segment)
      const sameSegment = previous[segment]
      const makeMatch = (candidate: typeof projection, previousMatch?: Match): Match => ({
        position: candidate.position,
        cost: (previousMatch?.cost ?? 0) + candidate.distance,
        precedingNodes: (previousMatch?.precedingNodes ?? 0) + (candidate.position <= clicked.position ? 1 : 0),
      })
      if (nodeIndex === 1 || bestEarlier) {
        current[segment] = makeMatch(projection, bestEarlier)
      }
      if (sameSegment) {
        const constrained = project(nodes[nodeIndex].coordinate, segment, sameSegment.position - segment)
        const match = makeMatch(constrained, sameSegment)
        if (!current[segment] || match.cost < current[segment].cost) current[segment] = match
      }
    }
    previous = current
  }
  const best = previous.reduce<Match | undefined>(
    (closest, match) => !closest || match.cost < closest.cost ? match : closest,
    undefined,
  )
  return 1 + (best?.precedingNodes ?? 0)
}

export function getCumulativeDistances(coordinates: Coordinate[]) {
  const distances = [0]
  for (let index = 1; index < coordinates.length; index += 1) {
    distances.push(distances[index - 1] + distanceKm(coordinates[index - 1], coordinates[index]))
  }
  return distances
}
