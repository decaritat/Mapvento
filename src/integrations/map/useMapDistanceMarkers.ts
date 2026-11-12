import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { formatDistanceAxis, getAutomaticDistanceMarkerStepKm, getDistanceMarkers, isValidDistanceMarkerStepKm } from '../../domain/routeMetrics'
import type { ProjectFile } from '../../domain/routeModel'
import { distanceInUnit, type Units } from '../../domain/settings'

type Props = {
  map: L.Map | null
  project: ProjectFile
  zoom: number
  latitude: number
  units: Units
}

export function useMapDistanceMarkers({ map, project, zoom, latitude, units }: Props) {
  const markersRef = useRef<L.Marker[]>([])

  useEffect(() => {
    if (!map) return
    markersRef.current.forEach((marker) => marker.removeFrom(map))
    markersRef.current = []

    project.routes.forEach((route) => {
      if (!route.showDistanceMarkers) return
      const mode = route.distanceMarkerMode === 'manual' ? 'manual' : 'auto'
      const stepKm =
        mode === 'manual'
          ? route.distanceMarkerStepKm
          : getAutomaticDistanceMarkerStepKm(zoom, latitude)
      if (!isValidDistanceMarkerStepKm(stepKm)) return

      getDistanceMarkers(route, stepKm).forEach(({ coordinate, distance }) => {
        const displayedDistance = distanceInUnit(distance, units.distance)
        const label = `${displayedDistance < 1 ? displayedDistance.toFixed(2).replace(/\.?0+$/, '') : formatDistanceAxis(displayedDistance)} ${units.distance}`
        const marker = L.marker([coordinate[1], coordinate[0]], {
          icon: L.divIcon({
            className: `distance-marker-wrapper ${route.id === project.activeRouteId ? 'active' : ''}`,
            html: `<span class="distance-marker-label">${label}</span>`,
            iconAnchor: [28, 11],
            iconSize: [56, 22],
          }),
          interactive: false,
          keyboard: false,
          title: label,
          zIndexOffset: 500,
        }).addTo(map)
        markersRef.current.push(marker)
      })
    })

    return () => {
      markersRef.current.forEach((marker) => marker.removeFrom(map))
      markersRef.current = []
    }
  }, [map, zoom, latitude, project.activeRouteId, project.routes, units.distance])
}
