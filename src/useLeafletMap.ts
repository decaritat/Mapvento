import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import L from 'leaflet'
import type { ErrorBanner, NodeContextMenu, NodeSelection, PlaceSearchResult, ToolMode } from './appTypes'
import { escapeXml } from './xml'
import { projectCoordinate } from './mapCoordinates'
import { getPoiIcon, poiIconSvg } from './poiIcons'
import { defaultPoiIcon } from './poiIconIds'
import { formatDistanceAxis, getAutomaticDistanceMarkerStepKm, getDistanceMarkers, isValidDistanceMarkerStepKm } from './routeMetrics'
import { getDisplayedRouteCoordinates, getRouteInsertionIndex, type Coordinate, type MapPoint, type ProfilePointDetails, type ProjectFile, type Route, type RouteNode } from './routeModel'
import { uid } from './uid'
import { useMapTileLayers } from './useMapTileLayers'
import { distanceInUnit, type StartSettings, type Units } from './settings'

const activeRouteLineWeight = 4
const inactiveRouteLineWeight = 3
const routeOutlineColor = '#111820'

type Props = {
  project: ProjectFile
  setProject: Dispatch<SetStateAction<ProjectFile>>
  activeRoute: Route | undefined
  layerId: string
  start: StartSettings
  units: Units
  mapLayerRetry: { layerId: string; sequence: number } | null
  toolMode: ToolMode
  routePropertiesOpen: boolean
  mapHoveredPoint: ProfilePointDetails | null
  selectedNode: NodeSelection | null
  contextMenu: NodeContextMenu | null
  setSelectedNode: Dispatch<SetStateAction<NodeSelection | null>>
  setContextMenu: Dispatch<SetStateAction<NodeContextMenu | null>>
  setErrorBanner: Dispatch<SetStateAction<ErrorBanner | null>>
  setNotice: Dispatch<SetStateAction<string>>
  setCacheWarning: Dispatch<SetStateAction<string>>
  setSearchMessage: Dispatch<SetStateAction<string>>
  openPointEditor: (point: MapPoint, isNew: boolean, clientX: number, clientY: number) => void
  updateNode: (routeId: string, nodeId: string, coordinate: Coordinate) => void
  insertNodeAtCoordinate: (routeId: string, coordinate: Coordinate, neighbors: [string, string]) => void
}

export function useLeafletMap({
  project, setProject, activeRoute, layerId, start, units, mapLayerRetry, toolMode, routePropertiesOpen,
  mapHoveredPoint: hoveredProfilePoint, selectedNode, contextMenu, setSelectedNode,
  setContextMenu, setErrorBanner, setNotice, setCacheWarning, setSearchMessage, openPointEditor,
  updateNode, insertNodeAtCoordinate,
}: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null)
  const initialView = useRef(start)
  const routeLayersRef = useRef<L.Polyline[]>([])
  const distanceMarkersRef = useRef<L.Marker[]>([])
  const profileMarkerRef = useRef<L.CircleMarker | null>(null)
  const markersRef = useRef<L.Layer[]>([])
  const routeNodeMarkersRef = useRef(new Map<string, { marker: L.Marker; routeId: string; nodeId: string }>())
  const focusedRouteNodeRef = useRef<string | null>(null)
  const selectedNodeRef = useRef(selectedNode)
  const pointerDownRouteNodeRef = useRef<string | null>(null)
  const searchLayerRef = useRef<L.Layer | null>(null)
  const activeDragCleanupRef = useRef<(() => void) | null>(null)
  const suppressNextRouteClickRef = useRef(false)
  const suppressClickTimerRef = useRef<number | null>(null)
  const [mapScale, setMapScale] = useState({ zoom: 7, latitude: 51.1657 })
  const disposeTileLayers = useMapTileLayers({
    map: mapInstance,
    layerId,
    overlayIds: project.mapOverlayIds ?? [],
    retry: mapLayerRetry,
    setErrorBanner,
    setCacheWarning,
  })

  const clearRouteNodeFocus = useCallback(() => {
    focusedRouteNodeRef.current = null
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && activeElement.closest('.route-node-wrapper')) {
      activeElement.blur()
    }
    setSelectedNode(null)
  }, [setSelectedNode])

  useEffect(() => {
    selectedNodeRef.current = selectedNode
  }, [selectedNode])

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return
    const map = L.map(mapContainer.current, { zoomControl: true }).setView([initialView.current.latitude, initialView.current.longitude], initialView.current.zoom)
    map.createPane('routeOverlays').style.zIndex = '300'
    const updateMapScale = () => {
      setMapScale({ zoom: map.getZoom(), latitude: map.getCenter().lat })
    }
    map.on('zoomend moveend', updateMapScale)
    const northArrow = new L.Control({ position: 'topright' })
    northArrow.onAdd = () => {
      const container = L.DomUtil.create('div', 'north-arrow-control')
      container.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" class="north-arrow-svg" role="img" aria-label="Norden" focusable="false">
          <path d="M12 2L6 22L12 18L18 22L12 2Z"/>
        </svg>
      `
      L.DomEvent.disableClickPropagation(container)
      return container
    }
    northArrow.addTo(map)
    mapRef.current = map
    setMapInstance(map)
    const clearSuppressedClick = () => {
      suppressNextRouteClickRef.current = false
      if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current)
      suppressClickTimerRef.current = null
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.route-node-wrapper')) {
        focusedRouteNodeRef.current = null
      }
    }
    const onMouseUp = () => { pointerDownRouteNodeRef.current = null }
    const onMapDragStart = () => clearRouteNodeFocus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (!focusedRouteNodeRef.current && !selectedNodeRef.current)) return
      event.preventDefault()
      event.stopPropagation()
      clearRouteNodeFocus()
    }
    map.getContainer().addEventListener('mousedown', clearSuppressedClick, true)
    map.on('dragstart', onMapDragStart)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onMouseUp)
    updateMapScale()
    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 0)
    return () => {
      window.clearTimeout(resizeTimer)
      activeDragCleanupRef.current?.()
      clearSuppressedClick()
      map.getContainer().removeEventListener('mousedown', clearSuppressedClick, true)
      map.off('dragstart', onMapDragStart)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onMouseUp)
      map.off('zoomend moveend', updateMapScale)
      profileMarkerRef.current?.remove()
      profileMarkerRef.current = null
      disposeTileLayers()
      searchLayerRef.current?.remove()
      searchLayerRef.current = null
      markersRef.current.forEach((marker) => marker.remove())
      distanceMarkersRef.current.forEach((marker) => marker.remove())
      routeLayersRef.current.forEach((layer) => layer.remove())
      map.remove()
      mapRef.current = null
    }
  }, [clearRouteNodeFocus, disposeTileLayers])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const scale = L.control.scale({ position: 'topright', metric: units.distance === 'km', imperial: units.distance === 'mi', maxWidth: 120 }).addTo(map)
    return () => { scale.remove() }
  }, [units.distance])

  useEffect(() => {
    if (toolMode !== 'route') clearRouteNodeFocus()
  }, [clearRouteNodeFocus, toolMode])

  useEffect(() => {
    const map = mapRef.current
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
        const onMouseMove = (moveEvent: MouseEvent) => {
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
              guide.setLatLngs([
                cursorPoint,
                [node.coordinate[1], node.coordinate[0]],
              ])
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
          ) {
            return
          }
          const releasePoint = map.containerPointToLatLng(
            L.point(upEvent.clientX - rect.left, upEvent.clientY - rect.top),
          )
          clearRouteNodeFocus()
          insertNodeAtCoordinate(route.id, projectCoordinate(releasePoint), [
            neighboringNodes[0].id,
            neighboringNodes[1].id,
          ])
        }
        cleanupDrag = () => {
          document.removeEventListener('mousemove', onMouseMove)
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
        const onCancel = () => cleanupDrag?.()
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
        window.addEventListener('blur', onCancel)
      }
      line.on('click', (event: L.LeafletMouseEvent) => {
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
      })
      line.on('mousemove', onMouseMove)
      line.on('mouseout', onMouseOut)
      line.on('mousedown', onMouseDown)
      routeLayersRef.current.push(outline, line)
      dragCleanups.push(() => {
        cleanupDrag?.()
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
  }, [insertNodeAtCoordinate, project.activeRouteId, project.routes, routePropertiesOpen, toolMode, clearRouteNodeFocus])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    distanceMarkersRef.current.forEach((marker) => marker.removeFrom(map))
    distanceMarkersRef.current = []

    project.routes.forEach((route) => {
      if (!route.showDistanceMarkers) return
      const mode = route.distanceMarkerMode === 'manual' ? 'manual' : 'auto'
      const stepKm =
        mode === 'manual'
          ? route.distanceMarkerStepKm
          : getAutomaticDistanceMarkerStepKm(mapScale.zoom, mapScale.latitude)
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
        distanceMarkersRef.current.push(marker)
      })
    })

    return () => {
      distanceMarkersRef.current.forEach((marker) => marker.removeFrom(map))
      distanceMarkersRef.current = []
    }
  }, [mapScale, project.activeRouteId, project.routes, units.distance])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const point = hoveredProfilePoint
    const [longitude, latitude] = point?.coordinate ?? [Number.NaN, Number.NaN]
    const validPoint =
      Boolean(activeRoute) &&
      point?.routeId === activeRoute?.id &&
      Number.isFinite(longitude) &&
      Number.isFinite(latitude)

    if (!validPoint || !activeRoute) {
      profileMarkerRef.current?.removeFrom(map)
      profileMarkerRef.current = null
      return
    }

    const color = activeRoute.color ?? '#7ee787'
    const weight =
      activeRoute.id === project.activeRouteId ? activeRouteLineWeight : inactiveRouteLineWeight
    const marker = profileMarkerRef.current
    if (marker) {
      marker.setLatLng([latitude, longitude])
      marker.setStyle({
        color,
        fillColor: '#ffffff',
        fillOpacity: 1,
        opacity: 1,
        weight,
      })
      marker.bringToFront()
      return
    }

    profileMarkerRef.current = L.circleMarker([latitude, longitude], {
      color,
      fillColor: '#ffffff',
      fillOpacity: 1,
      interactive: false,
      opacity: 1,
      radius: 8,
      weight,
    }).addTo(map)
  }, [activeRoute, hoveredProfilePoint, project.activeRouteId])

  useEffect(() => {
    const map = mapRef.current
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
      })
        .addTo(map)
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
  }, [project.activeRouteId, project.points, project.routes, routePropertiesOpen, toolMode, updateNode, openPointEditor, setProject, setSelectedNode, setContextMenu, setNotice, clearRouteNodeFocus])

  const selectedRouteId = selectedNode?.routeId
  const selectedNodeId = selectedNode?.nodeId
  useEffect(() => {
    const routeNodeMarkers = routeNodeMarkersRef.current
    routeNodeMarkers.forEach(({ marker, routeId, nodeId }) => {
      marker.getElement()?.querySelector('.route-node')?.classList.toggle(
        'selected',
        selectedRouteId === routeId && selectedNodeId === nodeId,
      )
    })
    if (!focusedRouteNodeRef.current) return
    const focusedMarker = routeNodeMarkers.get(focusedRouteNodeRef.current)?.marker
    if (focusedMarker) focusedMarker.getElement()?.focus()
    else focusedRouteNodeRef.current = null
  }, [selectedRouteId, selectedNodeId, project.activeRouteId, project.routes, project.points])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const onClick = (event: L.LeafletMouseEvent) => {
      if (suppressNextRouteClickRef.current) {
        suppressNextRouteClickRef.current = false
        return
      }
      if (routePropertiesOpen) return
      if (contextMenu) setContextMenu(null)
      if (toolMode === 'point') {
        const point: MapPoint = {
          id: uid('point'),
          name: 'Neuer POI',
          description: '',
          coordinate: projectCoordinate(event.latlng),
          source: 'poi',
          icon: defaultPoiIcon,
        }
        openPointEditor(
          point,
          true,
          event.originalEvent.clientX,
          event.originalEvent.clientY,
        )
        return
      }
      if (toolMode === 'pan') return
      if (!activeRoute || !activeRoute.editable) {
        setNotice('Diese Route ist schreibgeschützt.')
        return
      }
      const node: RouteNode = {
        id: uid('node'),
        coordinate: projectCoordinate(event.latlng),
      }
      clearRouteNodeFocus()
      setProject((current) => ({
        ...current,
        routes: current.routes.map((route) =>
          route.id === current.activeRouteId
            ? {
                ...route,
                nodes: [...route.nodes, node],
                geometry: undefined,
                elevations: undefined,
                timestamps: undefined,
                routingState: 'idle',
                routingError: undefined,
              }
            : route,
        ),
      }))
      setNotice('Routenpunkt gesetzt; das Segment wurde lokal neu berechnet.')
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [activeRoute, contextMenu, routePropertiesOpen, toolMode, openPointEditor, setContextMenu, setProject, setNotice, clearRouteNodeFocus])

  function focusRouteOnMap(route: Route) {
    const coordinates = getDisplayedRouteCoordinates(route)
    if (coordinates.length > 1) {
      const bounds = L.latLngBounds(
        coordinates.map(([longitude, latitude]) => [latitude, longitude] as L.LatLngExpression),
      )
      mapRef.current?.fitBounds(bounds, { padding: [100, 100], animate: true, duration: 0.7 })
    } else if (coordinates.length === 1) {
      mapRef.current?.setView([coordinates[0][1], coordinates[0][0]], 13, { animate: true })
    }
  }

  function focusSearchResultOnMap(result: PlaceSearchResult) {
    const map = mapRef.current
    if (!map) return
    const latitude = Number(result.lat)
    const longitude = Number(result.lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setSearchMessage('Der Suchtreffer enthält keine gültigen Koordinaten.')
      return
    }

    searchLayerRef.current?.remove()
    searchLayerRef.current = null
    if (result.geojson && ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(result.geojson.type)) {
      const layer = L.geoJSON(result.geojson, {
        style: {
          color: '#e04455',
          weight: 4,
          opacity: 0.95,
          fillColor: '#f06575',
          fillOpacity: 0.2,
        },
      }).addTo(map)
      searchLayerRef.current = layer
      map.fitBounds(layer.getBounds(), { padding: [70, 70], maxZoom: 15, animate: true })
      return
    }

    if (result.boundingbox) {
      const [south, north, west, east] = result.boundingbox.map(Number)
      if ([south, north, west, east].every(Number.isFinite) && south <= north && west <= east) {
        const bounds = L.latLngBounds([south, west], [north, east])
        if (Math.max(north - south, east - west) > 0.002) {
          searchLayerRef.current = L.rectangle(bounds, {
            color: '#e04455',
            weight: 3,
            fillColor: '#f06575',
            fillOpacity: 0.16,
          }).addTo(map)
          map.fitBounds(bounds, { padding: [70, 70], maxZoom: 15, animate: true })
          return
        }
      }
    }

    const marker = L.marker([latitude, longitude], {
      icon: L.divIcon({
        className: 'search-result-pin-wrapper',
        html: '<span class="search-result-pin"></span>',
        iconSize: [26, 34],
        iconAnchor: [13, 32],
      }),
      title: result.display_name,
    }).addTo(map)
    searchLayerRef.current = marker
    map.setView([latitude, longitude], 15, { animate: true })
  }

  function clearSearchLayer() {
    searchLayerRef.current?.remove()
    searchLayerRef.current = null
  }

  const getMapView = useCallback(() => {
    const map = mapRef.current
    if (!map) return null
    const center = map.getCenter().wrap()
    return {
      latitude: Math.max(-85.05112878, Math.min(85.05112878, center.lat)),
      longitude: center.lng,
      zoom: Math.min(19, Math.max(0, map.getZoom())),
    }
  }, [])

  return { mapContainer, focusRouteOnMap, focusSearchResultOnMap, clearSearchLayer, getMapView, mapZoom: mapScale.zoom }
}
