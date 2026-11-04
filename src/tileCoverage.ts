import { getDisplayedRouteCoordinates, type Coordinate, type ProjectFile } from './routeModel'

export type CachedCoordinate = { z: number; x: number; y: number; stale: boolean }

export function projectCoverage(project: ProjectFile, zoom: number, tiles: CachedCoordinate[]) {
  const coordinates: Coordinate[] = [
    ...project.routes.flatMap(getDisplayedRouteCoordinates),
    ...project.points.map((point) => point.coordinate),
  ]
  if (!coordinates.length) return null
  const width = 2 ** zoom
  const pointToTile = ([lon, lat]: Coordinate) => {
    const limitedLat = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180
    return {
      x: Math.max(0, Math.min(width - 1, Math.floor((lon + 180) / 360 * width))),
      y: Math.max(0, Math.min(width - 1, Math.floor((1 - Math.asinh(Math.tan(limitedLat)) / Math.PI) / 2 * width))),
    }
  }
  const first = pointToTile(coordinates[0])
  const bounds = { minX: first.x, maxX: first.x, minY: first.y, maxY: first.y }
  for (const coordinate of coordinates.slice(1)) {
    const { x, y } = pointToTile(coordinate)
    bounds.minX = Math.min(bounds.minX, x)
    bounds.maxX = Math.max(bounds.maxX, x)
    bounds.minY = Math.min(bounds.minY, y)
    bounds.maxY = Math.max(bounds.maxY, y)
  }
  const covered = tiles.filter(({ z, x, y }) =>
    z === zoom && x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY)
  return {
    total: (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1),
    cached: covered.length,
    stale: covered.filter((item) => item.stale).length,
  }
}
