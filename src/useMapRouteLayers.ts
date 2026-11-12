import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { MutableRefObject } from 'react'
import type { ToolMode } from './appTypes'
import { projectCoordinate } from './mapCoordinates'
import { getDisplayedRouteCoordinates, getRouteInsertionIndex, type ProjectFile, type RouteNode } from './routeModel'

const activeRouteLineWeight = 4
const inactiveRouteLineWeight = 3
const routeOutlineColor = '#111820'

type Props = {
  map: L.Map | null
  project: ProjectFile
  toolMode: ToolMode
  routePropertiesOpen: boolean
  clearRouteNodeFocus: () => void
  insertNodeAtCoordinate: (routeId: string, coordinate: [number, number], neighbors: [string, string]) => void
  activeDragCleanupRef: MutableRefObject<(() => void) | null>
  suppressNextRouteClickRef: MutableRefObject<boolean>
  suppressClickTimerRef: MutableRefObject<number | null>
}

export function useMapRouteLayers({
  map,
  project,
  toolMode,
  routePropertiesOpen,
  clearRouteNodeFocus,
  insertNodeAtCoordinate,
  activeDragCleanupRef,
  suppressNextRouteClickRef,
  suppressClickTimerRef,
}: Props) {
  const routeLayersRef = useRef<L.Polyline[]>([])

  useEffect(() => {
    if (!map) return
    routeLayersRef.current.forEach((layer) => layer.removeFrom(map))
    routeLayersRef.current = []
    const dragCleanups: Array<() => void> = []
    project.routes.forEach((route) => {
      const coordinates = getDisplayedRouteCoordinates(route).map(([lon, lat]) => [lat, lon] as L.LatLngExpression)
      if (coordinates.length < 2) return
      const active = route.id === project.activeRouteId
      const lineWeight = active ? activeRouteLineWeight : inactiveRouteLineWeight
      const outline = L.polyline(coordinates, {
        color: routeOutlineColor,
        interactive: false,
        lineCap: 'round',
        lineJoin: 'round',
        opacity: active ? 0.92 : 0.75,
        weight: lineWeight + 2,
      }).addTo(map)
      const line = L.polyline(coordinates, {
        color: active ? route.color ?? '#7ee787' : '#78909c',
        lineCap: 'round',
        lineJoin: 'round',
        opacity: active ? 0.95 : 0.6,
        weight: lineWeight,
      }).addTo(map)
      const neighborsAt = (latlng: L.LatLng): [RouteNode, RouteNode] | null => {
        const index = getRouteInsertionIndex(route.nodes, projectCoordinate(latlng), getDisplayedRouteCoordinates(route))
        return index === null ? null : [route.nodes[index - 1], route.nodes[index]]
      }
      let insertionCursor: L.CircleMarker | null = null
      const onMouseMove = (event: L.LeafletMouseEvent) => {
        if (
          routePropertiesOpen ||
          toolMode !== 'route' ||
          route.id !== project.activeRouteId ||
          !route.editable
        ) {
          insertionCursor?.removeFrom(map)
          insertionCursor = null
          return
        }
        if (!insertionCursor) {
          insertionCursor = L.circleMarker(event.latlng, {
            className: 'route-insertion-cursor',
            color: '#ffffff',
            fillColor: '#111820',
            fillOpacity: 1,
            interactive: false,
            radius: 3,
            weight: 1.5,
          }).addTo(map)
        } else {
          insertionCursor.setLatLng(event.latlng)
        }
      }
      const onMouseOut = () => {
        insertionCursor?.removeFrom(map)
        insertionCursor = null
      }
      let cleanupDrag: (() => void) | null = null
      const onMouseDown = (event: L.LeafletMouseEvent) => {
        if (
          event.originalEvent.button !== 0 ||
          routePropertiesOpen ||
          toolMode !== 'route' ||
          route.id !== project.activeRouteId ||
          !route.editable
        ) return
        if (activeDragCleanupRef.current) return
        const neighboringNodes = neighborsAt(event.latlng)
        if (!neighboringNodes) return
        L.DomEvent.stopPropagation(event)
        let moved = false
        let previewMarker: L.CircleMarker | null = null
        let previewGuides: L.Polyline[] = []
        const draggingWasEnabled = map.dragging.enabled()
        map.dragging.disable()
        const preventNativeDrag = (dragEvent: DragEvent) => dragEvent.preventDefault()
        window.addEventListener('dragstart', preventNativeDrag)
        const onDragMove = (moveEvent: MouseEvent) => {
          if (
            Math.hypot(
              moveEvent.clientX - event.originalEvent.clientX,
              moveEvent.clientY - event.originalEvent.clientY,
            ) > 5
          ) {
            moved = true
          }
          if (!moved) return

          const rect = map.getContainer().getBoundingClientRect()
          const cursorPoint = map.containerPointToLatLng(
            L.point(moveEvent.clientX - rect.left, moveEvent.clientY - rect.top),
          )
          if (!previewMarker) {
            previewMarker = L.circleMarker(cursorPoint, {
              color: '#ffffff',
              fillColor: '#000000',
              fillOpacity: 1,
              interactive: false,
              radius: 5,
              weight: 1,
            }).addTo(map)
          } else {
            previewMarker.setLatLng(cursorPoint)
          }

          if (previewGuides.length === 0) {
            previewGuides = neighboringNodes.map((node) =>
              L.polyline([cursorPoint, [node.coordinate[1], node.coordinate[0]]], {
                color: '#000000',
                dashArray: '4 6',
                interactive: false,
                opacity: 0.9,
                weight: 2,
              }).addTo(map),
            )
          } else {
            previewGuides.forEach((guide, index) => {
              const node = neighboringNodes[index]
              guide.setLatLngs([cursorPoint, [node.coordinate[1], node.coordinate[0]]])
            })
          }
        }
        const onMouseUp = (upEvent: MouseEvent) => {
          cleanupDrag?.()
          if (!moved) return
          const rect = map.getContainer().getBoundingClientRect()
          if (
            upEvent.clientX < rect.left ||
            upEvent.clientX > rect.right ||
            upEvent.clientY < rect.top ||
            upEvent.clientY > rect.bottom
          ) return
          const releasePoint = map.containerPointToLatLng(
            L.point(upEvent.clientX - rect.left, upEvent.clientY - rect.top),
          )
          clearRouteNodeFocus()
          insertNodeAtCoordinate(route.id, projectCoordinate(releasePoint), [
            neighboringNodes[0].id,
            neighboringNodes[1].id,
          ])
        }
        const onCancel = () => cleanupDrag?.()
        cleanupDrag = () => {
          document.removeEventListener('mousemove', onDragMove)
          document.removeEventListener('mouseup', onMouseUp)
          window.removeEventListener('blur', onCancel)
          window.removeEventListener('dragstart', preventNativeDrag)
          previewMarker?.removeFrom(map)
          previewGuides.forEach((guide) => guide.removeFrom(map))
          if (moved) {
            suppressNextRouteClickRef.current = true
            if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current)
            suppressClickTimerRef.current = window.setTimeout(() => {
              suppressNextRouteClickRef.current = false
              suppressClickTimerRef.current = null
            }, 350)
          }
          if (draggingWasEnabled) map.dragging.enable()
          activeDragCleanupRef.current = null
          cleanupDrag = null
        }
        activeDragCleanupRef.current = cleanupDrag
        document.addEventListener('mousemove', onDragMove)
        document.addEventListener('mouseup', onMouseUp)
        window.addEventListener('blur', onCancel)
      }
      const onClick = (event: L.LeafletMouseEvent) => {
        if (
          routePropertiesOpen ||
          toolMode !== 'route' ||
          route.id !== project.activeRouteId ||
          !route.editable
        ) return
        L.DomEvent.stopPropagation(event)
        if (suppressNextRouteClickRef.current) {
          suppressNextRouteClickRef.current = false
          return
        }
        const neighboringNodes = neighborsAt(event.latlng)
        if (!neighboringNodes) return
        clearRouteNodeFocus()
        insertNodeAtCoordinate(route.id, projectCoordinate(event.latlng), [
          neighboringNodes[0].id,
          neighboringNodes[1].id,
        ])
      }
      line.on('click', onClick)
      line.on('mousemove', onMouseMove)
      line.on('mouseout', onMouseOut)
      line.on('mousedown', onMouseDown)
      routeLayersRef.current.push(outline, line)
      dragCleanups.push(() => {
        cleanupDrag?.()
        line.off('click', onClick)
        line.off('mousemove', onMouseMove)
        line.off('mouseout', onMouseOut)
        onMouseOut()
        line.off('mousedown', onMouseDown)
      })
    })
    return () => {
      dragCleanups.forEach((cleanup) => cleanup())
      routeLayersRef.current.forEach((layer) => layer.removeFrom(map))
      routeLayersRef.current = []
    }
  }, [map, insertNodeAtCoordinate, project.activeRouteId, project.routes, routePropertiesOpen, toolMode, clearRouteNodeFocus, activeDragCleanupRef, suppressNextRouteClickRef, suppressClickTimerRef])
}
