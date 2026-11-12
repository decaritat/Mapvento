import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { ProfilePointDetails, Route } from './routeModel'

const activeRouteLineWeight = 4
const inactiveRouteLineWeight = 3

type Props = {
  map: L.Map | null
  activeRoute: Route | undefined
  activeRouteId: string
  point: ProfilePointDetails | null
}

export function useMapProfileMarker({ map, activeRoute, activeRouteId, point }: Props) {
  const markerRef = useRef<L.CircleMarker | null>(null)
  const markerMapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    const marker = markerRef.current
    if (!map || !activeRoute || !point || point.routeId !== activeRoute.id) {
      marker?.remove()
      markerRef.current = null
      markerMapRef.current = null
      return
    }
    const [longitude, latitude] = point.coordinate
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      marker?.remove()
      markerRef.current = null
      markerMapRef.current = null
      return
    }

    if (marker && markerMapRef.current !== map) {
      marker.remove()
      markerRef.current = null
      markerMapRef.current = null
    }

    const color = activeRoute.color ?? '#7ee787'
    const weight =
      activeRoute.id === activeRouteId ? activeRouteLineWeight : inactiveRouteLineWeight
    if (markerRef.current) {
      markerRef.current.setLatLng([latitude, longitude])
      markerRef.current.setStyle({
        color,
        fillColor: '#ffffff',
        fillOpacity: 1,
        opacity: 1,
        weight,
      })
      markerRef.current.bringToFront()
      return
    }
    markerRef.current = L.circleMarker([latitude, longitude], {
      color,
      fillColor: '#ffffff',
      fillOpacity: 1,
      interactive: false,
      opacity: 1,
      radius: 8,
      weight,
    }).addTo(map)
    markerMapRef.current = map
  }, [map, activeRoute, point, activeRouteId])

  useEffect(() => () => {
    markerRef.current?.remove()
    markerRef.current = null
    markerMapRef.current = null
  }, [])
}
