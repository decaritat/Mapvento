import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import L from 'leaflet'
import type { ErrorBanner, NodeContextMenu, NodeSelection, PlaceSearchResult, ToolMode } from './appTypes'
import { projectCoordinate } from './mapCoordinates'
import { defaultPoiIcon } from './poiIconIds'
import { getDisplayedRouteCoordinates, type Coordinate, type MapPoint, type ProfilePointDetails, type ProjectFile, type Route, type RouteNode } from './routeModel'
import type { StartSettings, Units } from './settings'
import { uid } from './uid'
import { useMapTileLayers } from './useMapTileLayers'
import { useMapRouteLayers } from './useMapRouteLayers'
import { useMapPointLayers } from './useMapPointLayers'
import { useMapDistanceMarkers } from './useMapDistanceMarkers'
import { useMapProfileMarker } from './useMapProfileMarker'

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

  useMapPointLayers({
    map: mapInstance,
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
  })
  useMapRouteLayers({
    map: mapInstance,
    project,
    toolMode,
    routePropertiesOpen,
    clearRouteNodeFocus,
    insertNodeAtCoordinate,
    activeDragCleanupRef,
    suppressNextRouteClickRef,
    suppressClickTimerRef,
  })
  useMapDistanceMarkers({
    map: mapInstance,
    project,
    zoom: mapScale.zoom,
    latitude: mapScale.latitude,
    units,
  })
  useMapProfileMarker({
    map: mapInstance,
    activeRoute,
    activeRouteId: project.activeRouteId,
    point: hoveredProfilePoint,
  })

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
      clearSuppressedClick()
      map.getContainer().removeEventListener('mousedown', clearSuppressedClick, true)
      map.off('dragstart', onMapDragStart)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onMouseUp)
      map.off('zoomend moveend', updateMapScale)
      disposeTileLayers()
      searchLayerRef.current?.remove()
      searchLayerRef.current = null
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
