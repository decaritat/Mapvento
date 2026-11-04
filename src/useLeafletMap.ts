import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import L from 'leaflet'
import type { GeoJsonObject } from 'geojson'
import type { ErrorBanner, NodeContextMenu, NodeSelection, PlaceSearchResult, ToolMode } from './appTypes'
import { escapeXml } from './gpx'
import { projectCoordinate } from './mapCoordinates'
import { defaultPoiIcon, getPoiIcon, poiIconSvg } from './poiIcons'
import { layers, overlayLayers, type LayerDefinition } from './mapLayers'
import { formatDistanceAxis, getAutomaticDistanceMarkerStepKm, getDistanceMarkers, isValidDistanceMarkerStepKm } from './routeMetrics'
import { getDisplayedRouteCoordinates, getRouteInsertionIndex, type Coordinate, type MapPoint, type ProfilePointDetails, type ProjectFile, type Route, type RouteNode } from './routeModel'
import { uid } from './uid'
import { CachedTileLayer } from './cachedTileLayer'

const activeRouteLineWeight = 4
const inactiveRouteLineWeight = 3
const routeOutlineColor = '#111820'

type Props = {
  project: ProjectFile
  setProject: Dispatch<SetStateAction<ProjectFile>>
  activeRoute: Route | undefined
  layerId: string
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
  insertNodeAtCoordinate: (routeId: string, coordinate: Coordinate) => void
}

export function useLeafletMap({
  project, setProject, activeRoute, layerId, mapLayerRetry, toolMode, routePropertiesOpen,
  mapHoveredPoint: hoveredProfilePoint, selectedNode, contextMenu, setSelectedNode,
  setContextMenu, setErrorBanner, setNotice, setCacheWarning, setSearchMessage, openPointEditor,
  updateNode, insertNodeAtCoordinate,
}: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileLayersRef = useRef(new Map<string, { layer: L.TileLayer; dispose: () => void }>())
  const failedTileLayersRef = useRef(new Map<string, LayerDefinition>())
  const lastRetryRef = useRef(0)
  const routeLayersRef = useRef<L.Polyline[]>([])
  const distanceMarkersRef = useRef<L.Marker[]>([])
  const profileMarkerRef = useRef<L.CircleMarker | null>(null)
  const markersRef = useRef<L.Layer[]>([])
  const searchLayerRef = useRef<L.Layer | null>(null)
  const suppressNextRouteClickRef = useRef(false)
  const [mapScale, setMapScale] = useState({ zoom: 7, latitude: 51.1657 })

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return
    const map = L.map(mapContainer.current, { zoomControl: true }).setView([51.1657, 10.4515], 7)
    const tileLayers = tileLayersRef.current
    const failedTileLayers = failedTileLayersRef.current
    map.createPane('routeOverlays').style.zIndex = '300'
    const updateMapScale = () => {
      setMapScale({ zoom: map.getZoom(), latitude: map.getCenter().lat })
    }
    map.on('zoomend moveend', updateMapScale)
    L.control
      .scale({ position: 'topright', metric: true, imperial: false, maxWidth: 120 })
      .addTo(map)
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
    updateMapScale()
    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 0)
    return () => {
      window.clearTimeout(resizeTimer)
      map.off('zoomend moveend', updateMapScale)
      profileMarkerRef.current?.remove()
      profileMarkerRef.current = null
      tileLayers.forEach(({ dispose }) => dispose())
      tileLayers.clear()
      failedTileLayers.clear()
      searchLayerRef.current?.remove()
      searchLayerRef.current = null
      markersRef.current.forEach((marker) => marker.remove())
      distanceMarkersRef.current.forEach((marker) => marker.remove())
      routeLayersRef.current.forEach((layer) => layer.remove())
      map.remove()
      mapRef.current = null
    }
  }, [])

  const overlayKey = (project.mapOverlayIds ?? []).join(',')
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const base = layers.find((item) => item.id === layerId && !item.requiresKey) ?? layers[0]
    const selected = [
      base,
      ...overlayLayers.filter((item) => !item.requiresKey && overlayKey.split(',').includes(item.id)),
    ]
    const selectedIds = new Set(selected.map((item) => item.id))
    if (!globalThis.indexedDB) {
      setCacheWarning('Kachelcache nicht verfügbar. Der HTTP-Cache des Browsers wird verwendet.')
    }
    const retryId = mapLayerRetry && mapLayerRetry.sequence !== lastRetryRef.current
      ? mapLayerRetry.layerId
      : null
    if (mapLayerRetry) lastRetryRef.current = mapLayerRetry.sequence

    const bannerFor = (definition: LayerDefinition): ErrorBanner => ({
      title: 'Kartenlayer nicht erreichbar',
      message: `${definition.provider} – ${definition.label} konnte keine Kartenkacheln laden. Prüfe die Internetverbindung oder deaktiviere den Layer.`,
      action: 'map-retry',
      layerId: definition.id,
    })
    const clearFailure = (id: string) => {
      if (!failedTileLayersRef.current.delete(id)) return
      setErrorBanner((current) => {
        if (current?.action !== 'map-retry' || current.layerId !== id) return current
        const next = failedTileLayersRef.current.values().next().value
        return next ? bannerFor(next) : null
      })
    }

    tileLayersRef.current.forEach(({ dispose }, id) => {
      if (!selectedIds.has(id) || id === retryId) {
        dispose()
        tileLayersRef.current.delete(id)
        clearFailure(id)
      }
    })

    selected.forEach((definition) => {
      if (tileLayersRef.current.has(definition.id)) return
      const tileOptions: L.TileLayerOptions = {
        attribution: definition.attribution,
        maxZoom: 19,
        maxNativeZoom: definition.maxNativeZoom,
        pane: definition.id === base.id ? 'tilePane' : 'routeOverlays',
      }
      const tileLayer = globalThis.indexedDB
        ? new CachedTileLayer(definition.tiles, tileOptions, definition.id, setCacheWarning)
        : L.tileLayer(definition.tiles, tileOptions)
      let failed = false
      const onLoading = () => { failed = false }
      const onTileError = () => {
        if (tileLayersRef.current.get(definition.id)?.layer !== tileLayer) return
        failed = true
        failedTileLayersRef.current.set(definition.id, definition)
        setErrorBanner((current) =>
          current?.action === 'map-retry' ? current : bannerFor(definition),
        )
      }
      const onLoad = () => {
        if (failed || tileLayersRef.current.get(definition.id)?.layer !== tileLayer) return
        clearFailure(definition.id)
      }
      tileLayer.on('loading', onLoading)
      tileLayer.on('tileerror', onTileError)
      tileLayer.on('load', onLoad)
      const dispose = () => {
        tileLayer.off('loading', onLoading)
        tileLayer.off('tileerror', onTileError)
        tileLayer.off('load', onLoad)
        tileLayer.removeFrom(map)
      }
      tileLayersRef.current.set(definition.id, { layer: tileLayer, dispose })
      tileLayer.addTo(map)
    })
  }, [layerId, overlayKey, mapLayerRetry, setErrorBanner, setCacheWarning])

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
      let cleanupDrag: (() => void) | null = null
      const onMouseDown = (event: L.LeafletMouseEvent) => {
        if (
          routePropertiesOpen ||
          toolMode !== 'route' ||
          route.id !== project.activeRouteId ||
          !route.editable
        ) return
        event.originalEvent.stopPropagation()
        let moved = false
        let previewMarker: L.CircleMarker | null = null
        let previewGuides: L.Polyline[] = []
        const draggingWasEnabled = map.dragging.enabled()
        map.dragging.disable()
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

          const insertIndex = getRouteInsertionIndex(route.nodes, [
            cursorPoint.lng,
            cursorPoint.lat,
          ])
          if (insertIndex === null) return
          const neighboringNodes = [
            route.nodes[insertIndex - 1],
            route.nodes[insertIndex],
          ]
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
          suppressNextRouteClickRef.current = true
          window.setTimeout(() => {
            suppressNextRouteClickRef.current = false
          }, 350)
          insertNodeAtCoordinate(route.id, projectCoordinate(releasePoint))
        }
        cleanupDrag = () => {
          document.removeEventListener('mousemove', onMouseMove)
          document.removeEventListener('mouseup', onMouseUp)
          previewMarker?.removeFrom(map)
          previewGuides.forEach((guide) => guide.removeFrom(map))
          if (draggingWasEnabled) map.dragging.enable()
          cleanupDrag = null
        }
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
      }
      line.on('click', (event: L.LeafletMouseEvent) => {
        if (
          routePropertiesOpen ||
          toolMode !== 'route' ||
          route.id !== project.activeRouteId ||
          !route.editable
        ) return
        event.originalEvent.stopPropagation()
        if (suppressNextRouteClickRef.current) {
          suppressNextRouteClickRef.current = false
          return
        }
        insertNodeAtCoordinate(route.id, projectCoordinate(event.latlng))
      })
      line.on('mousedown', onMouseDown)
      routeLayersRef.current.push(outline, line)
      dragCleanups.push(() => {
        cleanupDrag?.()
        line.off('mousedown', onMouseDown)
      })
    })
    return () => {
      dragCleanups.forEach((cleanup) => cleanup())
      routeLayersRef.current.forEach((layer) => layer.removeFrom(map))
      routeLayersRef.current = []
    }
  }, [insertNodeAtCoordinate, project.activeRouteId, project.routes, routePropertiesOpen, toolMode])

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
        const label = `${formatDistanceAxis(distance)} km`
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
  }, [mapScale, project.activeRouteId, project.routes])

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
    markersRef.current.forEach((marker) => marker.removeFrom(map))
    markersRef.current = []
    project.routes.forEach((route) => {
      if (!route.editable) return
      route.nodes.forEach((node, index) => {
        const marker = L.marker([node.coordinate[1], node.coordinate[0]], {
          draggable:
            !routePropertiesOpen &&
            toolMode === 'route' &&
            route.editable &&
            route.id === project.activeRouteId,
          icon: L.divIcon({
            className: `route-node-wrapper ${route.id === project.activeRouteId ? 'active' : ''}`,
            html: `<span class="route-node ${
              selectedNode?.routeId === route.id && selectedNode.nodeId === node.id ? 'selected' : ''
            }">${index + 1}</span>`,
            iconSize: [23, 23],
            iconAnchor: [11, 11],
          }),
        }).addTo(map)
        marker.on('click', (event: L.LeafletMouseEvent) => {
          if (routePropertiesOpen) return
          event.originalEvent.stopPropagation()
          setSelectedNode({ routeId: route.id, nodeId: node.id })
          setProject((current) => ({ ...current, activeRouteId: route.id }))
          setNotice(`Routenpunkt ${index + 1} ausgewählt.`)
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
    }
  }, [project.activeRouteId, project.points, project.routes, routePropertiesOpen, selectedNode, toolMode, updateNode, openPointEditor, setProject, setSelectedNode, setContextMenu, setNotice])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const onClick = (event: L.LeafletMouseEvent) => {
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
  }, [activeRoute, contextMenu, routePropertiesOpen, toolMode, openPointEditor, setContextMenu, setProject, setNotice])

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
      const layer = L.geoJSON(result.geojson as GeoJsonObject, {
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

  return { mapContainer, focusRouteOnMap, focusSearchResultOnMap, clearSearchLayer, mapZoom: mapScale.zoom }
}
