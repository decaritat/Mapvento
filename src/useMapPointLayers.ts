import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { MutableRefObject } from 'react'
import type { NodeContextMenu, NodeSelection, ToolMode } from './appTypes'
import { escapeXml } from './xml'
import { projectCoordinate } from './mapCoordinates'
import { getPoiIcon, poiIconSvg } from './poiIcons'
import type { Coordinate, MapPoint, ProjectFile } from './routeModel'

type Props = {
  map: L.Map | null
  project: ProjectFile
  routePropertiesOpen: boolean
  toolMode: ToolMode
  selectedNode: NodeSelection | null
  selectedNodeRef: MutableRefObject<NodeSelection | null>
  focusedRouteNodeRef: MutableRefObject<string | null>
  pointerDownRouteNodeRef: MutableRefObject<string | null>
  setProject: (action: (current: ProjectFile) => ProjectFile) => void
  setSelectedNode: (selection: NodeSelection | null) => void
  setContextMenu: (menu: NodeContextMenu | null) => void
  setNotice: (notice: string) => void
  updateNode: (routeId: string, nodeId: string, coordinate: Coordinate) => void
  openPointEditor: (point: MapPoint, isNew: boolean, clientX: number, clientY: number) => void
  clearRouteNodeFocus: () => void
}

export function useMapPointLayers({
  map,
  project,
  routePropertiesOpen,
  toolMode,
  selectedNode,
  selectedNodeRef,
  focusedRouteNodeRef,
  pointerDownRouteNodeRef,
  setProject,
  setSelectedNode,
  setContextMenu,
  setNotice,
  updateNode,
  openPointEditor,
  clearRouteNodeFocus,
}: Props) {
  const markersRef = useRef<L.Layer[]>([])
  const routeNodeMarkersRef = useRef(new Map<string, { marker: L.Marker; routeId: string; nodeId: string }>())

  useEffect(() => {
    if (!map) return
    const routeNodeMarkers = routeNodeMarkersRef.current
    markersRef.current.forEach((marker) => marker.removeFrom(map))
    markersRef.current = []
    routeNodeMarkers.clear()
    project.routes.forEach((route) => {
      if (!route.editable) return
      route.nodes.forEach((node, index) => {
        const start = index === 0
        const end = index === route.nodes.length - 1 && route.nodes.length > 1
        const positionClass = start ? 'start' : end ? 'end' : 'waypoint'
        const nodeKey = `${route.id}\u0000${node.id}`
        const marker = L.marker([node.coordinate[1], node.coordinate[0]], {
          alt: `${start ? 'Start' : end ? 'Ziel' : `Zwischenpunkt ${index + 1}`}, Routenpunkt ${index + 1}`,
          draggable:
            !routePropertiesOpen &&
            toolMode === 'route' &&
            route.editable &&
            route.id === project.activeRouteId,
          keyboard: true,
          icon: L.divIcon({
            className: `route-node-wrapper ${route.id === project.activeRouteId ? 'active' : ''}`,
            html: `<span class="route-node ${positionClass}"><span class="route-node-symbol"></span><span class="route-node-number">${index + 1}</span></span>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          }),
          title: `${start ? 'Start' : end ? 'Ziel' : `Zwischenpunkt ${index + 1}`} – Routenpunkt ${index + 1}`,
        }).addTo(map)
        routeNodeMarkers.set(nodeKey, { marker, routeId: route.id, nodeId: node.id })
        marker.on('click', (event: L.LeafletMouseEvent) => {
          if (routePropertiesOpen) return
          event.originalEvent.stopPropagation()
          const currentSelection = selectedNodeRef.current
          if (currentSelection?.routeId === route.id && currentSelection.nodeId === node.id) {
            clearRouteNodeFocus()
          } else {
            setSelectedNode({ routeId: route.id, nodeId: node.id })
          }
          setProject((current) => ({ ...current, activeRouteId: route.id }))
          setNotice(`Routenpunkt ${index + 1} ausgewählt.`)
        })
        const onFocus = () => {
          if (routePropertiesOpen) return
          focusedRouteNodeRef.current = nodeKey
          if (pointerDownRouteNodeRef.current === nodeKey) return
          setSelectedNode({ routeId: route.id, nodeId: node.id })
          setProject((current) =>
            current.activeRouteId === route.id ? current : { ...current, activeRouteId: route.id },
          )
        }
        const markerElement = marker.getElement()
        const onMouseDown = (event: MouseEvent) => {
          if (event.button === 0) pointerDownRouteNodeRef.current = nodeKey
        }
        markerElement?.addEventListener('mousedown', onMouseDown, true)
        markerElement?.addEventListener('focus', onFocus)
        marker.once('remove', () => {
          markerElement?.removeEventListener('mousedown', onMouseDown, true)
          markerElement?.removeEventListener('focus', onFocus)
        })
        marker.on('contextmenu', (event: L.LeafletMouseEvent) => {
          if (routePropertiesOpen) return
          event.originalEvent.stopPropagation()
          setSelectedNode({ routeId: route.id, nodeId: node.id })
          setContextMenu({
            x: event.originalEvent.clientX,
            y: event.originalEvent.clientY,
            routeId: route.id,
            nodeId: node.id,
          })
        })
        marker.on('dragend', () => {
          const coordinate = marker.getLatLng()
          updateNode(route.id, node.id, projectCoordinate(coordinate))
        })
        markersRef.current.push(marker)
      })
    })
    project.points.forEach((point) => {
      const icon = getPoiIcon(point.icon)
      const label = escapeXml(point.name.trim() || 'POI')
      const marker = L.marker([point.coordinate[1], point.coordinate[0]], {
        icon: L.divIcon({
          className: 'point-marker-wrapper',
          html: `<span class="point-marker"><span class="point-marker-badge"><span class="point-marker-symbol">${poiIconSvg(
            icon,
          )}</span></span><span class="point-marker-label">${label}</span></span>`,
          iconSize: [28, 36],
          iconAnchor: [14, 36],
        }),
      }).addTo(map)
      marker.on('click', (event: L.LeafletMouseEvent) => {
        if (routePropertiesOpen) return
        event.originalEvent.stopPropagation()
        openPointEditor(
          { ...point, icon: icon.id },
          false,
          event.originalEvent.clientX,
          event.originalEvent.clientY,
        )
      })
      markersRef.current.push(marker)
    })
    return () => {
      markersRef.current.forEach((marker) => marker.removeFrom(map))
      markersRef.current = []
      routeNodeMarkers.clear()
    }
  }, [map, project.activeRouteId, project.points, project.routes, routePropertiesOpen, toolMode, updateNode, openPointEditor, setProject, setSelectedNode, setContextMenu, setNotice, clearRouteNodeFocus, selectedNodeRef, focusedRouteNodeRef, pointerDownRouteNodeRef])

  useEffect(() => {
    const routeNodeMarkers = routeNodeMarkersRef.current
    routeNodeMarkers.forEach(({ marker, routeId, nodeId }) => {
      marker.getElement()?.querySelector('.route-node')?.classList.toggle(
        'selected',
        selectedNode?.routeId === routeId && selectedNode.nodeId === nodeId,
      )
    })
    if (!focusedRouteNodeRef.current) return
    const focusedMarker = routeNodeMarkers.get(focusedRouteNodeRef.current)?.marker
    if (focusedMarker) focusedMarker.getElement()?.focus()
    else focusedRouteNodeRef.current = null
  }, [selectedNode, project.activeRouteId, project.routes, project.points, focusedRouteNodeRef])

  return routeNodeMarkersRef
}
