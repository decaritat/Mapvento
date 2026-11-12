import { getDisplayedRouteCoordinates, type Coordinate, type Route } from './routeModel'

export type ElevationProvider = {
  elevationAt: (coordinate: Coordinate) => number
}

export const syntheticElevationProvider: ElevationProvider = {
  elevationAt: ([lon, lat]) =>
    Math.round(540 + Math.sin(lon * 18) * 34 + Math.cos(lat * 13) * 48),
}

export const defaultElevationProvider: ElevationProvider = syntheticElevationProvider

export function getDisplayedRouteElevations(
  route: Route,
  fallback: ElevationProvider = defaultElevationProvider,
): number[] {
  const coordinates = getDisplayedRouteCoordinates(route)
  if (
    route.elevations?.length === coordinates.length &&
    route.elevations.every(Number.isFinite)
  ) {
    return route.elevations
  }
  return coordinates.map((coordinate) => fallback.elevationAt(coordinate))
}
