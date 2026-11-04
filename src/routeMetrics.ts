import {
  defaultElevationProvider,
  getDisplayedRouteElevations,
  type ElevationProvider,
} from './elevation'
import { cumulativeElevationGain } from './elevationGain'
import {
  distanceKm,
  getCumulativeDistances,
  getDisplayedRouteCoordinates,
  type Coordinate,
  type ProfilePointDetails,
  type Route,
} from './routeModel'

export const DISTANCE_MARKER_MIN_STEP_KM = 0.1
export const DISTANCE_MARKER_MAX_STEP_KM = 1000

export type DistanceMarker = {
  distance: number
  coordinate: Coordinate
}

function roundedDistanceStep(distance: number) {
  const safeDistance = Math.max(DISTANCE_MARKER_MIN_STEP_KM, distance)
  const magnitude = 10 ** Math.floor(Math.log10(safeDistance))
  const normalized = safeDistance / magnitude
  const rounded =
    (normalized <= 1.5 ? 1 : normalized <= 3 ? 2 : normalized <= 7 ? 5 : 10) * magnitude
  return Number(Math.max(DISTANCE_MARKER_MIN_STEP_KM, rounded).toPrecision(6))
}

export function getAutomaticDistanceMarkerStepKm(zoom: number, latitude: number) {
  const safeZoom = Number.isFinite(zoom) ? Math.min(24, Math.max(0, zoom)) : 7
  const safeLatitude = Number.isFinite(latitude) ? Math.min(85, Math.max(-85, latitude)) : 0
  const metersPerPixel =
    (156543.03392 * Math.cos((safeLatitude * Math.PI) / 180)) / 2 ** safeZoom
  return roundedDistanceStep((metersPerPixel * 120) / 1000)
}

export function isValidDistanceMarkerStepKm(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= DISTANCE_MARKER_MIN_STEP_KM &&
    value <= DISTANCE_MARKER_MAX_STEP_KM
  )
}

function coordinateAtDistance(
  coordinates: Coordinate[],
  distances: number[],
  targetDistance: number,
): Coordinate {
  if (targetDistance <= 0) return coordinates[0]
  const totalDistance = distances.at(-1) ?? 0
  if (targetDistance >= totalDistance) return coordinates.at(-1) ?? coordinates[0]

  const upperIndex = distances.findIndex((distance, index) => index > 0 && distance >= targetDistance)
  const index = upperIndex < 0 ? distances.length - 1 : upperIndex
  const segmentStart = distances[index - 1]
  const segmentEnd = distances[index]
  const fraction =
    segmentEnd > segmentStart
      ? (targetDistance - segmentStart) / (segmentEnd - segmentStart)
      : 0
  const from = coordinates[index - 1]
  const to = coordinates[index]
  return [
    from[0] + (to[0] - from[0]) * fraction,
    from[1] + (to[1] - from[1]) * fraction,
  ]
}

export function getDistanceMarkers(route: Route, stepKm: number): DistanceMarker[] {
  if (!isValidDistanceMarkerStepKm(stepKm)) return []
  const coordinates = getDisplayedRouteCoordinates(route)
  if (coordinates.length < 2) return []
  const distances = getCumulativeDistances(coordinates)
  const totalDistance = distances.at(-1) ?? 0
  if (!(totalDistance > 0)) return []

  const markers: DistanceMarker[] = []
  for (let distance = stepKm; distance < totalDistance; distance += stepKm) {
    markers.push({
      distance,
      coordinate: coordinateAtDistance(coordinates, distances, distance),
    })
  }
  if (!markers.length || totalDistance - (markers.at(-1)?.distance ?? 0) > 0.000001) {
    markers.push({
      distance: totalDistance,
      coordinate: coordinateAtDistance(coordinates, distances, totalDistance),
    })
  }
  return markers
}

export function profileDetailsAtIndex(
  route: Route,
  profileIndex: number,
  nodeIndex?: number,
  fallback: ElevationProvider = defaultElevationProvider,
): ProfilePointDetails {
  const geometry = getDisplayedRouteCoordinates(route)
  const elevations = getDisplayedRouteElevations(route, fallback)
  const closestIndex = Math.min(Math.max(0, profileIndex), Math.max(0, geometry.length - 1))
  const coordinate = geometry[closestIndex] ?? route.nodes[0]?.coordinate ?? [0, 0]
  const distances = getCumulativeDistances(geometry)
  const distance = distances[closestIndex] ?? 0
  const ascent = cumulativeElevationGain(elevations, distances).ascent[closestIndex] ?? 0
  const speed = route.type === 'hiking' ? 4.5 : 15
  const totalDistance = distances.at(-1) ?? 0
  return {
    routeId: route.id,
    nodeIndex,
    profileFraction: distance / Math.max(1, totalDistance),
    distance,
    elevation: elevations[closestIndex] ?? fallback.elevationAt(coordinate),
    elapsedMinutes:
      recordedElapsedMinutesAtIndex(route, closestIndex) ??
      Math.max(0, Math.round((distance / speed) * 60 + ascent / 10)),
    coordinate,
  }
}

export function profileDetailsAtFraction(
  route: Route,
  fraction: number,
  fallback: ElevationProvider = defaultElevationProvider,
): ProfilePointDetails | null {
  if (!Number.isFinite(fraction)) return null
  const geometry = getDisplayedRouteCoordinates(route)
  const distances = getCumulativeDistances(geometry)
  const targetDistance = Math.min(1, Math.max(0, fraction)) * (distances.at(-1) ?? 0)
  const profileIndex = distances.reduce(
    (closestIndex, distance, index) =>
      Math.abs(distance - targetDistance) < Math.abs(distances[closestIndex] - targetDistance)
        ? index
        : closestIndex,
    0,
  )
  return profileDetailsAtIndex(route, profileIndex, undefined, fallback)
}

export function selectedRoutePointDetails(
  route: Route,
  nodeId: string,
  fallback: ElevationProvider = defaultElevationProvider,
) {
  const nodeIndex = route.nodes.findIndex((node) => node.id === nodeId)
  if (nodeIndex < 0) return null
  const node = route.nodes[nodeIndex]
  const geometry = getDisplayedRouteCoordinates(route)
  let closestIndex = 0
  let closestDistance = Number.POSITIVE_INFINITY
  geometry.forEach((coordinate, index) => {
    const distance = distanceKm(coordinate, node.coordinate)
    if (distance < closestDistance) {
      closestDistance = distance
      closestIndex = index
    }
  })
  return profileDetailsAtIndex(route, closestIndex, nodeIndex, fallback)
}

function recordedDurationMinutes(route: Route) {
  const timestamps = route.timestamps
  if (!timestamps) return null
  const validTimes = timestamps
    .map((timestamp) => (timestamp ? Date.parse(timestamp) : Number.NaN))
    .filter(Number.isFinite)
  if (validTimes.length < 2) return null
  const elapsedMilliseconds = validTimes.at(-1)! - validTimes[0]
  return elapsedMilliseconds > 0
    ? Math.max(1, Math.round(elapsedMilliseconds / 60_000))
    : null
}

function recordedElapsedMinutesAtIndex(route: Route, index: number) {
  const timestamps = route.timestamps
  if (!timestamps) return null
  const firstTime = timestamps
    .map((timestamp) => (timestamp ? Date.parse(timestamp) : Number.NaN))
    .find(Number.isFinite)
  const currentTimestamp = timestamps[index]
  if (firstTime === undefined || !currentTimestamp) return null
  const currentTime = Date.parse(currentTimestamp)
  return Number.isFinite(currentTime) && currentTime >= firstTime
    ? Math.round((currentTime - firstTime) / 60_000)
    : null
}

export function routeMetrics(route: Route, fallback: ElevationProvider = defaultElevationProvider) {
  const coordinates = getDisplayedRouteCoordinates(route)
  const elevations = getDisplayedRouteElevations(route, fallback)
  const distances = getCumulativeDistances(coordinates)
  const length = distances.at(-1) ?? 0
  const gain = cumulativeElevationGain(elevations, distances)
  const ascent = gain.ascent.at(-1) ?? 0
  const descent = gain.descent.at(-1) ?? 0
  const speed = route.type === 'hiking' ? 4.5 : 15
  const durationMinutes =
    recordedDurationMinutes(route) ?? Math.max(1, Math.round((length / speed) * 60 + ascent / 10))
  return {
    length,
    ascent,
    descent,
    durationMinutes,
    high: elevations.length ? Math.max(...elevations) : 0,
    low: elevations.length ? Math.min(...elevations) : 0,
    elevations,
    distances,
  }
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours} h ${rest} min` : `${rest} min`
}

export type ElevationScale = {
  min: number
  max: number
  step: number
}

export type DistanceScale = {
  max: number
  step: number
  ticks: number[]
}

export function getDistanceScale(distance: number): DistanceScale {
  const max = Math.max(0, distance)
  if (max === 0) return { max: 1, step: 1, ticks: [0, 1] }
  const targetStep = max / 5
  const magnitude = 10 ** Math.floor(Math.log10(targetStep))
  const normalizedStep = targetStep / magnitude
  const step =
    (normalizedStep <= 1.5 ? 1 : normalizedStep <= 3 ? 2 : normalizedStep <= 7 ? 5 : 10) *
    magnitude
  const ticks = [0]
  for (let value = step; value < max - step * 0.01; value += step) {
    ticks.push(Number(value.toFixed(6)))
  }
  if (ticks.at(-1) !== max) ticks.push(max)
  return { max, step, ticks }
}

export function formatDistanceAxis(distance: number) {
  return distance >= 100 ? distance.toFixed(0) : distance.toFixed(1).replace(/\.0$/, '')
}

export function getElevationScale(elevations: number[]): ElevationScale {
  if (!elevations.length) return { min: 0, max: 50, step: 50 }
  const minimum = Math.min(...elevations)
  const maximum = Math.max(...elevations)
  const range = Math.max(50, maximum - minimum)
  const step = Math.max(50, Math.ceil(range / 4 / 50) * 50)
  const min = Math.floor(minimum / step) * step
  const max = Math.max(min + step, Math.ceil(maximum / step) * step)
  return { min, max, step }
}
