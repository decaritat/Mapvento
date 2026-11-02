import type { LatLng } from 'leaflet'
import type { Coordinate } from './routeModel'

export function projectCoordinate(latLng: LatLng): Coordinate {
  const wrapped = latLng.wrap()
  return [wrapped.lng, wrapped.lat]
}
