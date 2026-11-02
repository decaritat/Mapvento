import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { invoke, isTauri } from '@tauri-apps/api/core'
import L from 'leaflet'
import type { GeoJsonObject } from 'geojson'
import 'leaflet/dist/leaflet.css'
import './App.css'
import AboutDialog from './AboutDialog'
import { ExternalLink } from './ExternalLink'
import { openExternalUrl } from './externalUrl'
import {
  GEOCODING_PROVIDER,
  getInspectorElevationStatus,
  getInspectorRouteStatus,
  layers,
  OSM_COPYRIGHT_URL,
} from './providers'
import {
  describeRoutingError,
  requestRouteGeometry,
  ROUTING_PROVIDER,
  routingProfileLabel,
} from './routing'
import {
  getDisplayedRouteCoordinates,
  getRouteCoordinates,
  getRouteInsertionIndex,
  type Coordinate,
  type MapPoint,
  type ProfilePointDetails,
  type ProjectFile,
  type Route,
  type RouteNode,
  type RouteType,
} from './routeModel'
import {
  formatDistanceAxis,
  formatDuration,
  getAutomaticDistanceMarkerStepKm,
  getDistanceMarkers,
  getDistanceScale,
  getElevationScale,
  isValidDistanceMarkerStepKm,
  profileDetailsAtFraction,
  routeMetrics,
  selectedRoutePointDetails,
  DISTANCE_MARKER_MAX_STEP_KM,
  DISTANCE_MARKER_MIN_STEP_KM,
  type ElevationScale,
} from './routeMetrics'
import { escapeXml, parseGpx, toGpx } from './gpx'
import { normalizeProject, readInitialProject } from './project'
import { projectCoordinate } from './mapCoordinates'
import {
  defaultPoiIcon,
  getPoiIcon,
  POI_ICON_CATEGORIES,
  poiIconSvg,
  type PoiIconId,
} from './poiIcons'

type ToolMode = 'pan' | 'route' | 'point'
type MapToolIconName = 'search' | 'pan' | 'route' | 'point' | 'focus'
type ErrorBanner = {
  title: string
  message: string
  action: 'map-retry' | 'routing-retry'
  routeId?: string
}

function StatusBanner({
  title,
  message,
  actionLabel,
  onAction,
  onClose,
}: {
  title: string
  message: string
  actionLabel: string
  onAction: () => void
  onClose: () => void
}) {
  return (
    <div className="status-banner" role="alert">
      <button
        type="button"
        className="status-banner-close"
        aria-label="Fehlermeldung schließen"
        title="Fehlermeldung schließen"
        onClick={onClose}
      >
        ×
      </button>
      <strong>{title}</strong>
      <span>{message}</span>
      <button type="button" className="status-banner-action" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  )
}

function MapToolIcon({ name }: { name: MapToolIconName }) {
  if (name === 'search') {
    return (
      <svg viewBox="0 0 20 20" className="map-tool-icon" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path d="m12.5 12.5 4 4" />
      </svg>
    )
  }

  if (name === 'pan') {
    return (
      <svg viewBox="0 0 20 20" className="map-tool-icon" aria-hidden="true">
        <path d="M6 10V5.5a1 1 0 0 1 2 0V9V4.5a1 1 0 0 1 2 0V9V5a1 1 0 0 1 2 0v4l.8-.9a1 1 0 0 1 1.5 1.3l-2.5 3.1A3 3 0 0 1 9.5 14H8a3 3 0 0 1-2.1-.9l-1.3-1.3a1 1 0 0 1 1.4-1.4Z" />
      </svg>
    )
  }

  if (name === 'route') {
    return (
      <svg viewBox="0 0 20 20" className="map-tool-icon" aria-hidden="true">
        <path d="M4 14C5 6 15 6 16 14" strokeDasharray="1.5 2" />
        <circle cx="4" cy="14" r="2" fill="currentColor" />
        <circle cx="16" cy="14" r="2" fill="currentColor" />
      </svg>
    )
  }

  if (name === 'point') {
    return (
      <svg viewBox="0 0 20 20" className="map-tool-icon" aria-hidden="true">
        <path d="M10 18s6-5.7 6-10a6 6 0 1 0-12 0c0 4.3 6 10 6 10Z" />
        <path d="M10 5.5v5M7.5 8h5" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 20 20" className="map-tool-icon" aria-hidden="true">
      <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />
    </svg>
  )
}

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<{
    createWritable: () => Promise<{
      write: (content: string) => Promise<void>
      close: () => Promise<void>
    }>
  }>
}

type PlaceSearchResult = {
  place_id: number
  display_name: string
  lat: string
  lon: string
  boundingbox?: [string, string, string, string]
  geojson?: { type: string; coordinates: unknown }
}

const GEOCODING_ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const routeColors = [
  '#7ee787',
  '#ffb86c',
  '#72b7ff',
  '#d6a8ff',
  '#ff7b72',
  '#f2cc60',
  '#00c2a8',
  '#a855f7',
]
const profileViewBox = { width: 560, height: 190, plotLeft: 42, plotRight: 10, plotTop: 12, plotBottom: 34 }
const activeRouteLineWeight = 4
const inactiveRouteLineWeight = 3
const routeOutlineColor = '#111820'

function getCustomRouteColor(route: Route) {
  if (route.customColor) return route.customColor
  if (route.color && !routeColors.includes(route.color)) return route.color
  return undefined
}

function profileFractionFromPointer(clientX: number, bounds: DOMRect) {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.width) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return null
  }
  const viewBoxX = ((clientX - bounds.left) / bounds.width) * profileViewBox.width
  const plotWidth = profileViewBox.width - profileViewBox.plotLeft - profileViewBox.plotRight
  if (viewBoxX < profileViewBox.plotLeft || viewBoxX > profileViewBox.width - profileViewBox.plotRight) {
    return null
  }
  return Math.min(1, Math.max(0, (viewBoxX - profileViewBox.plotLeft) / Math.max(1, plotWidth)))
}

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

function LayerDropdown({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string
  options: Array<{ id: string; label: string; provider?: string; attributionUrl?: string }>
  disabled?: boolean
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.id === value) ?? options[0]
  const menuOpen = open && !disabled

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  function move(offset: number) {
    const index = options.findIndex((option) => option.id === selected.id)
    const next = options[Math.min(options.length - 1, Math.max(0, index + offset))]
    if (next) onChange(next.id)
  }

  return (
    <div
      className="dropdown"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
        else if (event.key === 'ArrowDown') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          move(-1)
        }
      }}
    >
      <button
        type="button"
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        aria-labelledby="layer-select-label"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {selected.label}
      </button>
      {menuOpen && (
        <ul className="dropdown-menu" role="listbox" aria-labelledby="layer-select-label">
          {options.map((option) => (
            <li
              key={option.id}
              role="option"
              aria-selected={option.id === selected.id}
              className={option.id === selected.id ? 'selected' : undefined}
              onClick={() => {
                onChange(option.id)
                setOpen(false)
              }}
            >
              <span>{option.label}</span>
              {option.attributionUrl && (
                <span
                  className="dropdown-item-attribution"
                  role="button"
                  tabIndex={0}
                  title={`Attribution & Lizenz für ${option.label} (${option.provider ?? option.label}) öffnen`}
                  onClick={(e) => {
                    e.stopPropagation()
                    openExternalUrl(option.attributionUrl!)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation()
                      e.preventDefault()
                      openExternalUrl(option.attributionUrl!)
                    }
                  }}
                >
                  ©
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

async function saveTextFile(filename: string, content: string, type: string) {
  if (isTauri()) {
    try {
      const saved = await invoke<boolean>('save_text_file', { filename, content })
      if (!saved) throw new DOMException('Save cancelled', 'AbortError')
      return
    } catch (error) {
      // Hosts without Trailforge's Rust backend (e.g. an embedded preview) lack this command.
      if (!String(error).includes('not found')) throw error
    }
  }

  const savePicker = (window as SavePickerWindow).showSaveFilePicker
  if (savePicker) {
    try {
      const extension = filename.split('.').pop() ?? 'txt'
      const handle = await savePicker({
        suggestedName: filename,
        types: [{ description: type, accept: { [type]: [`.${extension}`] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
    }
  }

  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function App() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const routeLayersRef = useRef<L.Polyline[]>([])
  const distanceMarkersRef = useRef<L.Marker[]>([])
  const profileMarkerRef = useRef<L.CircleMarker | null>(null)
  const markersRef = useRef<L.Layer[]>([])
  const searchLayerRef = useRef<L.Layer | null>(null)
  const searchRequestRef = useRef<AbortController | null>(null)
  const lastSearchAtRef = useRef(0)
  const searchCacheRef = useRef(new Map<string, PlaceSearchResult[]>())
  const suppressNextRouteClickRef = useRef(false)
  const routedSignatureRef = useRef('')
  const routedRetryRef = useRef(0)
  const [project, setProject] = useState<ProjectFile>(readInitialProject)
  const [editingProjectName, setEditingProjectName] = useState(false)
  const [projectNameDraft, setProjectNameDraft] = useState('')
  const [projectDescriptionDraft, setProjectDescriptionDraft] = useState('')
  const [toolMode, setToolMode] = useState<ToolMode>('route')
  const [mapScale, setMapScale] = useState({ zoom: 7, latitude: 51.1657 })
  const [routeCreationDialogOpen, setRouteCreationDialogOpen] = useState(false)
  const [routeCreationMode, setRouteCreationMode] = useState<'new' | 'gpx'>('new')
  const [elevationExpanded, setElevationExpanded] = useState(false)
  const [notice, setNotice] = useState('')
  const [errorBanner, setErrorBanner] = useState<ErrorBanner | null>(null)
  const [mapLayerRetry, setMapLayerRetry] = useState(0)
  const [routingRetry, setRoutingRetry] = useState(0)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchMessage, setSearchMessage] = useState('')
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    routeId: string
    nodeId: string
  } | null>(null)
  const [layerId, setLayerId] = useState(() => readInitialProject().mapLayerId)
  const [openRouteMenu, setOpenRouteMenu] = useState<{
    routeId: string
    top: number
    left: number
  } | null>(null)
  const [routeEditor, setRouteEditor] = useState<{
    routeId: string
    draft: Route
    top: number
    left: number
  } | null>(null)
  const [pointEditor, setPointEditor] = useState<{
    pointId: string
    draft: MapPoint
    isNew: boolean
    top: number
    left: number
  } | null>(null)
  const [selectedNode, setSelectedNode] = useState<{ routeId: string; nodeId: string } | null>(null)
  const [hoveredProfilePoint, setHoveredProfilePoint] = useState<ProfilePointDetails | null>(null)
  const [poiIconPickerOpen, setPoiIconPickerOpen] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)
  const routeCreationOptionRef = useRef<HTMLInputElement>(null)
  const projectInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const projectDescriptionInput = useRef<HTMLTextAreaElement>(null)
  const routeEditorRef = useRef<HTMLElement>(null)
  const routeMenuRef = useRef<HTMLDivElement>(null)
  const routeMenuPopoverRef = useRef<HTMLDivElement>(null)
  const routeMenuButtonRef = useRef<HTMLButtonElement>(null)
  const routeCardRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus()
  }, [searchOpen])

  useLayoutEffect(() => {
    const textarea = projectDescriptionInput.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 80)}px`
  }, [editingProjectName, projectDescriptionDraft, project.description])

  useEffect(() => {
    if (openRouteMenu) {
      routeMenuPopoverRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    }
  }, [openRouteMenu])

  useEffect(() => {
    if (routeEditor?.routeId) {
      routeEditorRef.current?.querySelector<HTMLInputElement>('.sidebar-route-input')?.focus()
    }
  }, [routeEditor?.routeId])

  useEffect(() => {
    if (routeCreationDialogOpen) routeCreationOptionRef.current?.focus()
  }, [routeCreationDialogOpen])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 4000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (!openRouteMenu) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        !routeMenuRef.current?.contains(target) &&
        !routeMenuPopoverRef.current?.contains(target)
      ) {
        setOpenRouteMenu(null)
      }
    }
    window.addEventListener('pointerdown', closeOnOutsideClick)
    return () => window.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [openRouteMenu])

  useEffect(() => {
    if (!isTauri()) return
    const handleLinkClick = (event: globalThis.MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest('a')
      if (target && target.href && /^https?:\/\//i.test(target.href)) {
        event.preventDefault()
        openExternalUrl(target.href)
      }
    }
    document.addEventListener('click', handleLinkClick)
    return () => {
      document.removeEventListener('click', handleLinkClick)
    }
  }, [])

  const activeRoute =
    project.routes.find((route) => route.id === project.activeRouteId) ?? project.routes[0]
  const routePropertiesOpen = Boolean(routeEditor || pointEditor)
  const activeMetrics = useMemo(
    () => (activeRoute ? routeMetrics(activeRoute) : null),
    [activeRoute],
  )
  const inspectorRouteStatus = getInspectorRouteStatus(activeRoute)
  const inspectorElevationStatus = getInspectorElevationStatus(
    activeRoute,
    activeMetrics?.elevations.length ?? 0,
  )
  const selectedPointDetails = useMemo(() => {
    if (!selectedNode) return null
    const route = project.routes.find((route) => route.id === selectedNode.routeId)
    return route ? selectedRoutePointDetails(route, selectedNode.nodeId) : null
  }, [project.routes, selectedNode])
  const activeSelectedPointDetails =
    selectedPointDetails && selectedNode?.routeId === activeRoute?.id ? selectedPointDetails : null
  const activeHoveredProfilePoint =
    hoveredProfilePoint && hoveredProfilePoint.routeId === activeRoute?.id
      ? hoveredProfilePoint
      : null
  const profilePointDetails = activeHoveredProfilePoint ?? activeSelectedPointDetails
  const activeElevationScale = getElevationScale(activeMetrics?.elevations ?? [])
  const activeDistanceScale = getDistanceScale(activeMetrics?.length ?? 0)
  const routeNodeSignature = useMemo(
    () =>
      project.routes
        .map(
          (route) =>
            `${route.id}:${route.type}:${route.nodes
              .map((node) => `${node.coordinate[0]},${node.coordinate[1]}`)
              .join(';')}`,
        )
        .join('|'),
    [project.routes],
  )

  function activateToolMode(mode: ToolMode) {
    setToolMode(mode)
    setNotice(
      mode === 'pan'
        ? 'Karte verschieben; Routen und Punkte bleiben unverändert.'
        : mode === 'route'
          ? 'Klicke auf die Karte, um einen Routenpunkt zu setzen.'
          : 'Klicke auf die Karte, um einen Punkt oder POI zu setzen.',
    )
  }

  function openPointEditor(point: MapPoint, isNew: boolean, clientX: number, clientY: number) {
    const dialogWidth = Math.min(390, window.innerWidth - 16)
    const dialogHeight = Math.min(600, window.innerHeight - 16)
    const gap = 18
    const left =
      clientX + gap + dialogWidth <= window.innerWidth - 8
        ? clientX + gap
        : Math.max(8, clientX - dialogWidth - gap)
    const top = Math.min(
      Math.max(8, clientY - 54),
      Math.max(8, window.innerHeight - dialogHeight - 8),
    )
    setPoiIconPickerOpen(false)
    setPointEditor({
      pointId: point.id,
      draft: point,
      isNew,
      top,
      left,
    })
  }

  const updateNode = useCallback((routeId: string, nodeId: string, coordinate: Coordinate) => {
    const route = project.routes.find((item) => item.id === routeId)
    if (toolMode !== 'route' || !route?.editable) {
      setNotice('Aktiviere die Routenbearbeitung, um Routenpunkte zu ändern.')
      return
    }
    setProject((current) => ({
      ...current,
      routes: current.routes.map((route) =>
        route.id === routeId
          ? {
              ...route,
              nodes: route.nodes.map((node) =>
                node.id === nodeId ? { ...node, coordinate } : node,
              ),
              geometry: undefined,
              elevations: undefined,
              timestamps: undefined,
              routingState: 'idle',
              routingError: undefined,
            }
          : route,
      ),
    }))
    setNotice('Routenpunkt verschoben; die angrenzenden Segmente wurden neu berechnet.')
  }, [project.routes, toolMode])

  const insertNodeAtCoordinate = useCallback((routeId: string, coordinate: Coordinate) => {
    const route = project.routes.find((item) => item.id === routeId)
    if (toolMode !== 'route' || !route?.editable) return
    setProject((current) => ({
      ...current,
      routes: current.routes.map((route) => {
        if (route.id !== routeId) return route
        const node: RouteNode = { id: uid('node'), coordinate }
        if (route.nodes.length < 2) {
          return {
            ...route,
            nodes: [...route.nodes, node],
            geometry: undefined,
            elevations: undefined,
            timestamps: undefined,
            routingState: 'idle',
            routingError: undefined,
          }
        }

        const insertIndex =
          getRouteInsertionIndex(route.nodes, coordinate) ?? route.nodes.length

        return {
          ...route,
          nodes: [...route.nodes.slice(0, insertIndex), node, ...route.nodes.slice(insertIndex)],
          geometry: undefined,
          elevations: undefined,
          timestamps: undefined,
          routingState: 'idle',
          routingError: undefined,
        }
      }),
    }))
    setNotice('Neuer Routenpunkt gesetzt; die Route wird neu berechnet.')
  }, [project.routes, toolMode])

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return
    const map = L.map(mapContainer.current, { zoomControl: true }).setView([51.1657, 10.4515], 7)
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
    window.setTimeout(() => map.invalidateSize(), 0)
    return () => {
      map.off('zoomend moveend', updateMapScale)
      profileMarkerRef.current?.remove()
      profileMarkerRef.current = null
      searchRequestRef.current?.abort()
      tileLayerRef.current?.remove()
      tileLayerRef.current = null
      searchLayerRef.current?.remove()
      searchLayerRef.current = null
      markersRef.current.forEach((marker) => marker.remove())
      distanceMarkersRef.current.forEach((marker) => marker.remove())
      routeLayersRef.current.forEach((layer) => layer.remove())
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (
      routedSignatureRef.current === routeNodeSignature &&
      routedRetryRef.current === routingRetry
    ) return
    routedSignatureRef.current = routeNodeSignature
    routedRetryRef.current = routingRetry
    const abortController = new AbortController()
    const candidates = project.routes.filter(
      (route) =>
        route.editable && route.nodes.length >= 2 && route.routingState !== 'ready',
    )
    if (!candidates.length) return () => abortController.abort()

    Promise.all(
      candidates.map(async (route) => {
        try {
          const routeGeometry = await requestRouteGeometry(
            route.type,
            route.nodes.map((node) => node.coordinate),
            abortController.signal,
          )
          return {
            id: route.id,
            ...routeGeometry,
            routingState: 'ready' as const,
            routingError: undefined,
          }
        } catch (error) {
          if (abortController.signal.aborted) {
            return {
              id: route.id,
              coordinates: getRouteCoordinates(route),
              elevations: undefined,
              routingState: 'fallback' as const,
              routingError: undefined,
            }
          }
          const message = describeRoutingError(error)
          return {
            id: route.id,
            coordinates: getRouteCoordinates(route),
            elevations: undefined,
            routingState: 'fallback' as const,
            routingError: message,
          }
        }
      }),
    ).then((results) => {
      if (abortController.signal.aborted) return
      setProject((current) => ({
        ...current,
        routes: current.routes.map((route) => {
          const result = results.find((item) => item.id === route.id)
          return result
            ? {
                ...route,
                geometry: result.coordinates,
                elevations: result.elevations,
                timestamps: undefined,
                routingState: result.routingState,
                routingError: result.routingError,
              }
            : route
        }),
      }))
      const fallbackUsed = results.some((result) => result.routingState === 'fallback')
      const fallbackResult = results.find(
        (result) => result.routingState === 'fallback' && result.routingError,
      )
      if (fallbackUsed && fallbackResult?.routingError) {
        setErrorBanner({
          title: 'Routing fehlgeschlagen',
          message: `${fallbackResult.routingError} Die direkte Verbindung bleibt als Fallback sichtbar.`,
          action: 'routing-retry',
          routeId: fallbackResult.id,
        })
      } else if (!fallbackUsed) {
        setErrorBanner((current) =>
          current?.action === 'routing-retry' ? null : current,
        )
        setNotice(`Route über ${ROUTING_PROVIDER.label} berechnet.`)
      }
    })

    return () => abortController.abort()
  }, [project.routes, routeNodeSignature, routingRetry])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const layer = layers.find((item) => item.id === layerId) ?? layers[0]
    if (layer.requiresKey) {
      return
    }
    const tileLayer = L.tileLayer(layer.tiles, {
      attribution: layer.attribution,
      maxZoom: 19,
    })
    const onTileError = () => {
      if (tileLayerRef.current === tileLayer) {
        setErrorBanner({
          title: 'Kartenlayer nicht erreichbar',
          message: `${layer.label} konnte keine Kartenkacheln laden. Prüfe die Internetverbindung oder wähle einen anderen Kartenlayer.`,
          action: 'map-retry',
        })
      }
    }
    const onTileLoad = () => {
      setErrorBanner((current) =>
        current?.action === 'map-retry' ? null : current,
      )
    }
    tileLayer.on('tileerror', onTileError)
    tileLayer.on('load', onTileLoad)
    tileLayerRef.current = tileLayer
    tileLayer.addTo(map)
    return () => {
      tileLayer.off('tileerror', onTileError)
      tileLayer.off('load', onTileLoad)
      tileLayer.removeFrom(map)
      if (tileLayerRef.current === tileLayer) tileLayerRef.current = null
    }
  }, [layerId, mapLayerRetry])

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
          if (draggingWasEnabled) map.dragging.enable()
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
  }, [project.activeRouteId, project.points, project.routes, routePropertiesOpen, selectedNode, toolMode, updateNode])

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
  }, [activeRoute, contextMenu, routePropertiesOpen, toolMode])

  function deleteNode() {
    if (!contextMenu) return
    removeNode(contextMenu.routeId, contextMenu.nodeId)
    setContextMenu(null)
  }

  const removeNode = useCallback((routeId: string, nodeId: string) => {
    const route = project.routes.find((item) => item.id === routeId)
    if (toolMode !== 'route' || !route?.editable) {
      setNotice('Aktiviere die Routenbearbeitung, um Routenpunkte zu löschen.')
      return
    }
    setProject((current) => ({
      ...current,
      routes: current.routes.map((route) =>
        route.id === routeId
          ? {
              ...route,
              nodes: route.nodes.filter((node) => node.id !== nodeId),
              geometry: undefined,
              elevations: undefined,
              timestamps: undefined,
              routingState: 'idle',
              routingError: undefined,
            }
          : route,
      ),
    }))
    setSelectedNode((current) =>
      current?.routeId === routeId && current.nodeId === nodeId ? null : current,
    )
    setNotice('Routenpunkt gelöscht und Route neu berechnet.')
  }, [project.routes, toolMode])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (routePropertiesOpen || event.key !== 'Delete' || !selectedNode) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return
      }
      event.preventDefault()
      removeNode(selectedNode.routeId, selectedNode.nodeId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [removeNode, routePropertiesOpen, selectedNode])

  function createRoute() {
    const route: Route = {
      id: uid('route'),
      name: `Neue ${project.routes.length + 1}. Route`,
      description: '',
      type: 'hiking',
      editable: true,
      nodes: [],
      showDistanceMarkers: false,
      distanceMarkerMode: 'auto',
      distanceMarkerStepKm: 1,
    }
    setProject((current) => ({
      ...current,
      routes: [...current.routes, route],
      activeRouteId: route.id,
    }))
    activateToolMode('route')
    setNotice('Neue Route aktiv. Klicke auf die Karte, um Routenpunkte zu setzen.')
  }

  function openRouteCreationDialog() {
    setRouteCreationMode('new')
    setRouteCreationDialogOpen(true)
  }

  function confirmRouteCreation() {
    setRouteCreationDialogOpen(false)
    if (routeCreationMode === 'new') {
      createRoute()
    } else {
      importInput.current?.click()
    }
  }

  function deleteRoute(routeId: string) {
    const remainingRoutes = project.routes.filter((route) => route.id !== routeId)
    const nextActiveRouteId =
      project.activeRouteId === routeId ? (remainingRoutes[0]?.id ?? '') : project.activeRouteId
    setProject((current) => ({
      ...current,
      routes: remainingRoutes,
      activeRouteId: nextActiveRouteId,
    }))
    setRouteEditor((current) => (current?.routeId === routeId ? null : current))
    setSelectedNode((current) => (current?.routeId === routeId ? null : current))
    setNotice('Route gelöscht.')
  }

  function beginProjectNameEdit() {
    setProjectNameDraft(project.name)
    setProjectDescriptionDraft(project.description)
    setEditingProjectName(true)
  }

  function saveProjectName() {
    setProject((current) => ({
      ...current,
      name: projectNameDraft.trim() || current.name,
      description: projectDescriptionDraft.slice(0, 180),
    }))
    setEditingProjectName(false)
  }

  function cancelProjectNameEdit() {
    setEditingProjectName(false)
    setProjectNameDraft('')
    setProjectDescriptionDraft('')
  }

  async function exportRoute(route = activeRoute) {
    if (!route) return
    if (!route.editable) {
      setNotice('Schreibgeschützte GPX-Routen können nicht exportiert werden.')
      return
    }
    try {
      await saveTextFile(
        `${route.name.toLowerCase().replaceAll(/[^a-z0-9]+/gi, '-') || 'route'}.gpx`,
        toGpx(route, project.points),
        'application/gpx+xml',
      )
      setNotice('GPX exportiert.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setNotice('GPX-Export abgebrochen.')
        return
      }
      setNotice('GPX konnte nicht gespeichert werden.')
    }
  }

  function confirmDeleteRoute(route: Route) {
    const confirmed = window.confirm(`Soll die Route „${route.name}“ wirklich entfernt werden?`)
    setOpenRouteMenu(null)
    if (!confirmed) {
      setNotice('Entfernen der Route abgebrochen.')
      return
    }
    deleteRoute(route.id)
  }

  function showRouteProperties(route: Route) {
    focusRoute(route)
    if (searchOpen) closeSearch()
    setContextMenu(null)
    const bounds = routeCardRefs.current.get(route.id)?.getBoundingClientRect()
    if (bounds) {
      setRouteEditor({
        routeId: route.id,
        draft: { ...route },
        top: Math.max(8, Math.min(bounds.top, window.innerHeight - 380)),
        left: Math.max(8, Math.min(bounds.right + 8, window.innerWidth - 320)),
      })
    }
    setOpenRouteMenu(null)
  }

  function updateRouteDraft(patch: Partial<Route>) {
    setRouteEditor((current) =>
      current ? { ...current, draft: { ...current.draft, ...patch } } : current,
    )
  }

  function updatePointDraft(patch: Partial<MapPoint>) {
    setPointEditor((current) =>
      current && current.draft.editable !== false
        ? { ...current, draft: { ...current.draft, ...patch } }
        : current,
    )
  }

  function savePointProperties() {
    if (!pointEditor || pointEditor.draft.editable === false) return
    const point = {
      ...pointEditor.draft,
      name: pointEditor.draft.name.trim() || 'Neuer POI',
      description: pointEditor.draft.description.slice(0, 180),
      icon: getPoiIcon(pointEditor.draft.icon).id,
    }
    setProject((current) => ({
      ...current,
      points: pointEditor.isNew
        ? [...current.points, point]
        : current.points.map((item) => (item.id === point.id ? point : item)),
    }))
    setPointEditor(null)
    setNotice(pointEditor.isNew ? 'POI angelegt.' : 'POI aktualisiert.')
  }

  function deletePoint(pointId: string) {
    const point = project.points.find((item) => item.id === pointId)
    if (!point || point.editable === false) {
      if (point) setNotice('Schreibgeschützte GPX-POIs können nicht gelöscht werden.')
      return
    }
    setProject((current) => ({
      ...current,
      points: current.points.filter((point) => point.id !== pointId),
    }))
    setPointEditor(null)
    setNotice('POI gelöscht.')
  }

  function confirmDeletePoint() {
    if (!pointEditor || pointEditor.isNew || pointEditor.draft.editable === false) return
    const pointName = pointEditor.draft.name.trim() || 'Neuer POI'
    if (window.confirm(`Soll der POI „${pointName}“ wirklich gelöscht werden?`)) {
      deletePoint(pointEditor.pointId)
    }
  }

  function saveRouteProperties() {
    if (!routeEditor) return
    if (
      routeEditor.draft.showDistanceMarkers &&
      routeEditor.draft.distanceMarkerMode === 'manual' &&
      !isValidDistanceMarkerStepKm(routeEditor.draft.distanceMarkerStepKm)
    ) {
      setNotice(
        `Die manuelle Schrittweite muss zwischen ${DISTANCE_MARKER_MIN_STEP_KM} und ${DISTANCE_MARKER_MAX_STEP_KM} km liegen.`,
      )
      return
    }
    setProject((current) => ({
      ...current,
      routes: current.routes.map((route) =>
        route.id !== routeEditor.routeId
          ? route
          : route.editable
            ? {
                ...route,
                ...routeEditor.draft,
                ...(route.type !== routeEditor.draft.type
                  ? {
                      geometry: undefined,
                      elevations: undefined,
                      timestamps: undefined,
                      routingState: 'idle' as const,
                      routingError: undefined,
                    }
                  : {}),
              }
            : {
                ...route,
                color: routeEditor.draft.color,
                customColor: routeEditor.draft.customColor,
                showDistanceMarkers: routeEditor.draft.showDistanceMarkers,
                distanceMarkerMode: routeEditor.draft.distanceMarkerMode,
                distanceMarkerStepKm: routeEditor.draft.distanceMarkerStepKm,
              },
      ),
    }))
    setRouteEditor(null)
  }

  function openRouteActions(routeId: string, button: HTMLButtonElement) {
    const bounds = button.getBoundingClientRect()
    setOpenRouteMenu({
      routeId,
      top: Math.max(8, Math.min(bounds.bottom + 5, window.innerHeight - 130)),
      left: Math.max(8, Math.min(bounds.right - 160, window.innerWidth - 168)),
    })
  }

  async function saveProject() {
    const serialized = JSON.stringify(project, null, 2)
    localStorage.setItem('trailforge-project', serialized)
    try {
      await saveTextFile(
        `${project.name.toLowerCase().replaceAll(/[^a-z0-9]+/gi, '-') || 'projekt'}.trailforge.json`,
        serialized,
        'application/json',
      )
      setNotice('Projekt gespeichert.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setNotice('Speichern abgebrochen.')
        return
      }
      setNotice('Projekt wurde lokal gespeichert, aber der Dateidialog konnte nicht geöffnet werden.')
    }
  }

  function importGpx(file: File) {
    file.text().then((content) => {
      const parsed = parseGpx(content)
      if (!parsed) {
        setNotice('Die GPX-Datei konnte nicht gelesen werden.')
        return
      }
      const route = {
        ...parsed.route,
        editable: false,
        description: parsed.route.description.slice(0, 180),
      }
      setProject((current) => ({
        ...current,
        routes: [...current.routes, route],
        points: [...current.points, ...parsed.waypoints],
        activeRouteId: route.id,
      }))
      const waypointNotice = parsed.waypoints.length
        ? ` ${parsed.waypoints.length} GPX-Wegpunkt${parsed.waypoints.length === 1 ? '' : 'e'} als POI übernommen.`
        : ''
      const skippedWaypointNotice = parsed.skippedWaypoints
        ? ` ${parsed.skippedWaypoints} ungültige GPX-Wegpunkte übersprungen.`
        : ''
      setNotice(`GPX schreibgeschützt importiert.${waypointNotice}${skippedWaypointNotice}`)
    }).catch(() => setNotice('Die GPX-Datei konnte nicht gelesen werden.'))
  }

  function importProject(file: File) {
    file
      .text()
      .then((content) => {
        const normalizedProject = normalizeProject(JSON.parse(content))
        const mapLayerId = normalizedProject.mapLayerId
        setProject(normalizedProject)
        setLayerId(mapLayerId)
        localStorage.setItem('trailforge-project', JSON.stringify(normalizedProject))
        setNotice('Projekt geöffnet.')
      })
      .catch(() => setNotice('Die Projektdatei konnte nicht gelesen werden.'))
  }

  function focusRoute(route: Route) {
    setProject((current) => ({ ...current, activeRouteId: route.id }))
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

  function retryRouting(route: Route) {
    if (!route.editable || route.nodes.length < 2) return
    setProject((current) => ({
      ...current,
      routes: current.routes.map((item) =>
        item.id === route.id
          ? { ...item, routingState: 'idle', routingError: undefined }
          : item,
      ),
    }))
    setRoutingRetry((value) => value + 1)
    setErrorBanner((current) =>
      current?.action === 'routing-retry' && current.routeId === route.id
        ? null
        : current,
    )
    setNotice(`${ROUTING_PROVIDER.label} wird erneut versucht.`)
  }

  function retryMapLayer() {
    setErrorBanner((current) =>
      current?.action === 'map-retry' ? null : current,
    )
    setMapLayerRetry((value) => value + 1)
  }

  function clearMapError() {
    setErrorBanner((current) =>
      current?.action === 'map-retry' ? null : current,
    )
  }

  async function searchPlaces(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = searchQuery.trim()
    if (!query) {
      setSearchMessage('Gib einen Ortsnamen ein.')
      return
    }

    const cacheKey = query.toLocaleLowerCase()
    const cachedResults = searchCacheRef.current.get(cacheKey)
    if (cachedResults) {
      setSearchResults(cachedResults)
      setSearchMessage(cachedResults.length ? '' : 'Keine passenden Orte gefunden.')
      return
    }

    const wait = 1000 - (Date.now() - lastSearchAtRef.current)
    if (wait > 0) {
      setSearchMessage('Bitte warte einen Moment, bevor du erneut suchst.')
      return
    }

    searchRequestRef.current?.abort()
    const controller = new AbortController()
    searchRequestRef.current = controller
    lastSearchAtRef.current = Date.now()
    setSearchLoading(true)
    setSearchMessage('')
    setSearchResults([])
    searchLayerRef.current?.remove()
    searchLayerRef.current = null

    try {
      const url = new URL(GEOCODING_ENDPOINT)
      url.search = new URLSearchParams({
        q: query,
        format: 'jsonv2',
        limit: '5',
        polygon_geojson: '1',
      }).toString()
      let payload: unknown
      if (isTauri()) {
        payload = JSON.parse(await invoke<string>('search_places', { query }))
      } else {
        const response = await fetch(url, {
          signal: controller.signal,
          referrerPolicy: 'strict-origin-when-cross-origin',
        })
        if (!response.ok) throw new Error(`Geocoding request failed: ${response.status}`)
        payload = await response.json()
      }
      if (!Array.isArray(payload)) throw new Error('Invalid geocoding response')
      const results = payload as PlaceSearchResult[]
      searchCacheRef.current.set(cacheKey, results)
      setSearchResults(results)
      setSearchMessage(results.length ? '' : 'Keine passenden Orte gefunden.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setSearchMessage('Die Ortssuche ist fehlgeschlagen. Prüfe deine Internetverbindung und versuche es erneut.')
    } finally {
      if (searchRequestRef.current === controller) {
        searchRequestRef.current = null
        setSearchLoading(false)
      }
    }
  }

  function focusSearchResult(result: PlaceSearchResult) {
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

  function closeSearch() {
    setSearchOpen(false)
    searchLayerRef.current?.remove()
    searchLayerRef.current = null
  }

  function renderRouteEditor(route: Route) {
    const customColor = getCustomRouteColor(route)
    const showDistanceMarkers = Boolean(route.showDistanceMarkers)
    const distanceMarkerMode = route.distanceMarkerMode === 'manual' ? 'manual' : 'auto'
    const manualDistanceMarkerInvalid =
      showDistanceMarkers &&
      distanceMarkerMode === 'manual' &&
      !isValidDistanceMarkerStepKm(route.distanceMarkerStepKm)
    const manualDistanceMarkerStep =
      typeof route.distanceMarkerStepKm === 'number' &&
      Number.isFinite(route.distanceMarkerStepKm)
        ? route.distanceMarkerStepKm
        : 1

    return (
      <section
        ref={routeEditorRef}
        className="route-editor"
        role="dialog"
        aria-modal="true"
        aria-label={`Eigenschaften von ${route.name}`}
        style={{ top: routeEditor?.top, left: routeEditor?.left }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setRouteEditor(null)
        }}
      >
        <div className="route-editor-heading">
          <span className="eyebrow">Routeneigenschaften</span>
          {!route.editable && (
            <span className="lock-badge" title="Diese Route ist schreibgeschützt">
              READ-ONLY
            </span>
          )}
        </div>
        <input
          className="sidebar-route-input"
          value={route.name}
          onChange={(event) => updateRouteDraft({ name: event.target.value })}
          disabled={!route.editable}
          aria-label="Routenname"
        />
        <textarea
          className="sidebar-route-description"
          value={route.description}
          onChange={(event) =>
            updateRouteDraft({ description: event.target.value.slice(0, 180) })
          }
          disabled={!route.editable}
          aria-label="Routenbeschreibung"
          placeholder="Routenbeschreibung"
          maxLength={180}
          rows={3}
        />
        <span className="route-description-length">{route.description.length}/180 Zeichen</span>
        {route.editable ? (
          <div className="route-editor-section">
            <div className="route-editor-section-header">
              <label className="route-editor-section-label" htmlFor={`route-type-${route.id}`}>
                Routentyp
              </label>
              <ExternalLink
                url={ROUTING_PROVIDER.attributionUrl}
                className="route-editor-provider-link"
                title={`Routing über ${ROUTING_PROVIDER.label} (${routingProfileLabel(route.type)})`}
              >
                via {ROUTING_PROVIDER.label}
              </ExternalLink>
            </div>
            <select
              id={`route-type-${route.id}`}
              value={route.type}
              onChange={(event) => updateRouteDraft({ type: event.target.value as RouteType })}
              aria-label="Routentyp"
            >
              <option value="hiking">Wandern</option>
              <option value="cycling">Radfahren</option>
            </select>
          </div>
        ) : route.gpxType ? (
          <div className="route-editor-section">
            <label className="route-editor-section-label" htmlFor={`route-type-${route.id}`}>
              Routentyp
            </label>
            <input
              id={`route-type-${route.id}`}
              className="sidebar-route-input"
              value={route.gpxType}
              readOnly
              aria-label="Routentyp (schreibgeschützt)"
            />
          </div>
        ) : null}
        <div className="route-editor-section route-color-section">
          <span className="route-editor-section-label">Routenfarbe</span>
          <div className="route-color-controls">
            <div className="color-swatches" aria-label="Schnellwahl Routenfarbe">
              {routeColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-swatch ${route.color === color ? 'selected' : ''}`}
                  style={{ backgroundColor: color }}
                  title={`Farbe ${color}`}
                  onClick={() => updateRouteDraft({ color, customColor })}
                />
              ))}
            </div>
            <label className="sidebar-color-picker" title="Eigene Routenfarbe">
              <input
                type="color"
                value={customColor ?? '#000000'}
                onChange={(event) =>
                  updateRouteDraft({
                    color: event.target.value,
                    customColor: event.target.value,
                  })
                }
                aria-label="Eigene Routenfarbe"
              />
              <span>Eigene Farbe</span>
            </label>
          </div>
        </div>
        <fieldset className="distance-marker-settings">
          <legend className="distance-marker-heading">
            <label className="distance-marker-toggle">
              <input
                type="checkbox"
                checked={showDistanceMarkers}
                onChange={(event) =>
                  updateRouteDraft({ showDistanceMarkers: event.target.checked })
                }
              />
              <span className="distance-marker-switch" aria-hidden="true" />
              <span>Abstandsmarker</span>
            </label>
            <span
              className="distance-marker-info"
              role="img"
              aria-label="Informationen zu Abstandsmarkern"
              title="Zeigt Kilometerangaben entlang der Route an."
            >
              i
            </span>
          </legend>
          <div className={`distance-marker-options ${showDistanceMarkers ? '' : 'disabled'}`}>
            <label className="distance-marker-option">
              <input
                type="radio"
                name={`distance-marker-mode-${route.id}`}
                value="auto"
                checked={distanceMarkerMode === 'auto'}
                onChange={() => updateRouteDraft({ distanceMarkerMode: 'auto' })}
                disabled={!showDistanceMarkers}
              />
              <span>Anpassung an den Kartenmaßstab</span>
            </label>
            <label className="distance-marker-option">
              <input
                type="radio"
                name={`distance-marker-mode-${route.id}`}
                value="manual"
                checked={distanceMarkerMode === 'manual'}
                onChange={() =>
                  updateRouteDraft({
                    distanceMarkerMode: 'manual',
                    distanceMarkerStepKm: isValidDistanceMarkerStepKm(route.distanceMarkerStepKm)
                      ? route.distanceMarkerStepKm
                      : 1,
                  })
                }
                disabled={!showDistanceMarkers}
              />
              <span>Anzeigen in Schritten von</span>
              <input
                className="distance-marker-step-input"
                type="number"
                min={DISTANCE_MARKER_MIN_STEP_KM}
                max={DISTANCE_MARKER_MAX_STEP_KM}
                step="0.1"
                value={manualDistanceMarkerStep}
                onChange={(event) =>
                  updateRouteDraft({
                    distanceMarkerStepKm:
                      event.target.value === '' ? undefined : Number(event.target.value),
                  })
                }
                disabled={!showDistanceMarkers || distanceMarkerMode !== 'manual'}
                aria-invalid={manualDistanceMarkerInvalid}
                aria-label="Manuelle Schrittweite in Kilometern"
              />
              <span>km</span>
            </label>
            {manualDistanceMarkerInvalid && (
              <span className="field-error" role="alert">
                Wert zwischen {DISTANCE_MARKER_MIN_STEP_KM} und {DISTANCE_MARKER_MAX_STEP_KM} km
                eingeben.
              </span>
            )}
          </div>
        </fieldset>
        <div className="route-editor-actions">
          <button
            className="route-editor-action save"
            type="button"
            onClick={saveRouteProperties}
            aria-label="Routeneigenschaften übernehmen"
            title="Übernehmen"
          >
            ✓ Übernehmen
          </button>
          <button
            className="route-editor-action cancel"
            type="button"
            onClick={() => setRouteEditor(null)}
            aria-label="Routeneigenschaften verwerfen und schließen"
            title="Abbrechen"
          >
            × Abbrechen
          </button>
        </div>
      </section>
    )
  }

  function renderPointEditor(point: MapPoint) {
    const selectedIcon = getPoiIcon(point.icon)
    const isNew = pointEditor?.isNew ?? false
    const isReadOnly = point.editable === false

    return (
      <section
        className="route-editor poi-editor"
        role="dialog"
        aria-modal="true"
        aria-label={
          isNew
            ? 'Neuen POI anlegen'
            : isReadOnly
              ? `POI ${point.name} anzeigen`
              : `POI ${point.name} bearbeiten`
        }
        style={{ top: pointEditor?.top, left: pointEditor?.left }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          if (poiIconPickerOpen) {
            event.stopPropagation()
            setPoiIconPickerOpen(false)
          } else setPointEditor(null)
        }}
      >
        <div className="route-editor-heading">
          <span className="eyebrow">{isNew ? 'POI anlegen' : 'POI-Eigenschaften'}</span>
          {isReadOnly && <span className="lock-badge">READ-ONLY</span>}
          <span
            className="poi-editor-selected-icon"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: poiIconSvg(selectedIcon) }}
          />
        </div>
        <div className={`poi-icon-picker ${poiIconPickerOpen ? 'open' : ''}`}>
          <button
            className="poi-icon-picker-toggle"
            type="button"
            aria-expanded={poiIconPickerOpen}
            aria-controls={`poi-icon-picker-options-${point.id}`}
            disabled={isReadOnly}
            onClick={() => setPoiIconPickerOpen((open) => !open)}
          >
            <span className="route-editor-section-label">Symbol</span>
            <span className="poi-icon-picker-current">
              <span
                className="poi-icon-picker-current-graphic"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: poiIconSvg(selectedIcon) }}
              />
              <span>{selectedIcon.label}</span>
            </span>
            <span className="poi-icon-picker-chevron" aria-hidden="true">
              {poiIconPickerOpen ? '▴' : '▾'}
            </span>
          </button>
          {poiIconPickerOpen && (
            <div className="poi-icon-picker-options" id={`poi-icon-picker-options-${point.id}`}>
              {POI_ICON_CATEGORIES.map((category) => (
                <fieldset className="poi-icon-category" key={category.id}>
                  <legend>{category.label}</legend>
                  <div className="poi-icon-options">
                    {category.icons.map((icon) => (
                      <button
                        className={`poi-icon-option ${point.icon === icon.id ? 'selected' : ''}`}
                        key={icon.id}
                        type="button"
                        disabled={isReadOnly}
                        aria-label={icon.label}
                        aria-pressed={point.icon === icon.id}
                        onClick={() => {
                          updatePointDraft({ icon: icon.id as PoiIconId })
                          setPoiIconPickerOpen(false)
                        }}
                      >
                        <span
                          aria-hidden="true"
                          dangerouslySetInnerHTML={{ __html: poiIconSvg(icon) }}
                        />
                      </button>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          )}
        </div>
        <input
          className="sidebar-route-input"
          value={point.name}
          onChange={(event) => updatePointDraft({ name: event.target.value })}
          disabled={isReadOnly}
          aria-label="POI-Titel"
          placeholder="POI-Titel"
        />
        <textarea
          className="sidebar-route-description"
          value={point.description}
          onChange={(event) =>
            updatePointDraft({ description: event.target.value.slice(0, 180) })
          }
          disabled={isReadOnly}
          aria-label="POI-Beschreibung"
          placeholder="POI-Beschreibung"
          maxLength={180}
          rows={3}
        />
        <span className="route-description-length">{point.description.length}/180 Zeichen</span>
        <div className="route-editor-actions">
          {!isNew && !isReadOnly && (
            <button
              className="route-editor-action delete"
              type="button"
              onClick={confirmDeletePoint}
              aria-label="POI löschen"
              title="POI löschen"
            >
              × Löschen
            </button>
          )}
          {!isReadOnly && (
            <button
              className="route-editor-action save"
              type="button"
              onClick={savePointProperties}
              aria-label="POI-Eigenschaften übernehmen"
              title="Übernehmen"
            >
              ✓ Übernehmen
            </button>
          )}
          <button
            className="route-editor-action cancel"
            type="button"
            onClick={() => setPointEditor(null)}
            aria-label={isReadOnly ? 'POI-Ansicht schließen' : 'POI-Eigenschaften verwerfen und schließen'}
            title={isReadOnly ? 'Schließen' : 'Abbrechen'}
          >
            {isReadOnly ? 'Schließen' : '× Abbrechen'}
          </button>
        </div>
      </section>
    )
  }

  const openMenuRoute = openRouteMenu
    ? project.routes.find((route) => route.id === openRouteMenu.routeId)
    : undefined

  return (
    <div
      className="app-shell"
      inert={routePropertiesOpen || aboutOpen || routeCreationDialogOpen}
      onClick={() => contextMenu && setContextMenu(null)}
    >
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/favicon.svg" alt="" />
          <div>
            <strong>Trailforge</strong>
            <span>Open route planner</span>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="layer-select">
            <span id="layer-select-label">Kartenlayer</span>
            <LayerDropdown
              value={layerId}
              disabled={routePropertiesOpen}
              options={layers.map((layer) => ({
                id: layer.id,
                label: `${layer.label}${layer.requiresKey ? ' · API-Key' : ''}`,
                provider: layer.provider,
                attributionUrl: layer.attributionUrl,
              }))}
              onChange={(nextLayerId) => {
                const nextLayer = layers.find((layer) => layer.id === nextLayerId)
                if (nextLayer?.requiresKey) {
                  setNotice('Tracestrack benötigt einen API-Key. OSM Carto bleibt aktiv.')
                  return
                }
                clearMapError()
                setLayerId(nextLayerId)
                setProject((current) => ({ ...current, mapLayerId: nextLayerId }))
              }}
            />
            {(() => {
              const activeLayerDef = layers.find((layer) => layer.id === layerId) ?? layers[0]
              return (
                <ExternalLink
                  url={activeLayerDef.attributionUrl}
                  className="layer-attribution-badge"
                  title={`Attribution & Lizenz für ${activeLayerDef.label} (${activeLayerDef.provider}) öffnen`}
                >
                  © {activeLayerDef.provider}
                </ExternalLink>
              )
            })()}
          </div>
          <button className="ghost-button" onClick={() => projectInput.current?.click()}>
            Projekt öffnen
          </button>
          <button className="solid-button" onClick={saveProject}>
            Projekt speichern
          </button>
          <button className="ghost-button" onClick={() => setAboutOpen(true)}>
            Info
          </button>
          <input
            ref={projectInput}
            className="hidden-input"
            type="file"
            accept=".json,.trailforge.json"
            onChange={(event) => event.target.files?.[0] && importProject(event.target.files[0])}
          />
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className={`sidebar-heading ${editingProjectName ? 'editing' : ''}`}>
            <div>
              <span className="eyebrow">Projekt</span>
              <div className="project-title-row">
                <input
                  className="project-name"
                  value={editingProjectName ? projectNameDraft : project.name}
                  disabled={!editingProjectName}
                  onChange={(event) => setProjectNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && editingProjectName) {
                      event.preventDefault()
                      saveProjectName()
                    } else if (event.key === 'Escape' && editingProjectName) {
                      cancelProjectNameEdit()
                    }
                  }}
                  aria-label="Projektname"
                />
                {!editingProjectName && (
                  <button
                    className="project-name-edit"
                    type="button"
                    aria-label="Projektnamen bearbeiten"
                    title="Projektnamen bearbeiten"
                    onClick={beginProjectNameEdit}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M11.8 2.2a1.4 1.4 0 0 1 2 2L6 12l-3 .8.8-3 8-7.6Z" />
                      <path d="m10.7 3.3 2 2" />
                    </svg>
                  </button>
                )}
              </div>
              <textarea
                ref={projectDescriptionInput}
                className="project-description"
                value={editingProjectName ? projectDescriptionDraft : project.description}
                onChange={(event) => setProjectDescriptionDraft(event.target.value.slice(0, 180))}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && editingProjectName) cancelProjectNameEdit()
                }}
                disabled={!editingProjectName}
                placeholder="Projektbeschreibung"
                aria-label="Projektbeschreibung"
                maxLength={180}
                rows={2}
              />
              {editingProjectName && (
                <span className="description-length">
                  {projectDescriptionDraft.length}/180 Zeichen
                </span>
              )}
              {editingProjectName && (
                <div className="project-edit-actions">
                  <button
                    className="project-edit-action save"
                    type="button"
                    aria-label="Projektänderungen übernehmen"
                    title="Übernehmen"
                    onClick={saveProjectName}
                  >
                    ✓ Übernehmen
                  </button>
                  <button
                    className="project-edit-action cancel"
                    type="button"
                    aria-label="Projektänderungen verwerfen"
                    title="Abbrechen"
                    onClick={cancelProjectNameEdit}
                  >
                    × Abbrechen
                  </button>
                </div>
              )}
            </div>
            <button
              className="icon-button"
              type="button"
              title="Neue Route erstellen oder GPX importieren"
              aria-label="Neue Route erstellen oder GPX importieren"
              onClick={openRouteCreationDialog}
            >
              +
            </button>
          </div>

          <div className="route-list">
            {project.routes.map((route) => {
              const metrics = routeMetrics(route)
              const active = route.id === project.activeRouteId
              return (
                <div className={`route-entry ${active ? 'selected' : ''}`} key={route.id}>
                  <div
                    className={`route-card ${active ? 'selected' : ''}`}
                    ref={(element) => {
                      if (element) routeCardRefs.current.set(route.id, element)
                      else routeCardRefs.current.delete(route.id)
                    }}
                  >
                    <button
                      className="route-card-main"
                      type="button"
                      onClick={() => focusRoute(route)}
                    >
                      <span
                        className={`route-color ${route.type}`}
                        style={{ backgroundColor: route.color ?? '#7ee787' }}
                      />
                      <span className="route-card-content">
                        <span className="route-card-title">
                            {route.name}
                            {!route.editable && (
                              <span className="lock-badge" title="Diese Route ist schreibgeschützt">
                                READ-ONLY
                              </span>
                            )}
                          </span>
                          {(route.editable || route.gpxType) && (
                            <span className="route-card-meta">
                              {route.gpxType ??
                                (route.type === 'hiking' ? 'Wandern' : 'Radfahren')}
                            </span>
                          )}
                        <span className="route-card-stats">
                          <span>{metrics.length.toFixed(1)} km</span>
                          <span>{formatDuration(metrics.durationMinutes)}</span>
                          <span>↗ {Math.round(metrics.ascent)} m</span>
                          <span>↘ {Math.round(metrics.descent)} m</span>
                        </span>
                      </span>
                    </button>
                    <span className="route-card-actions">
                      <div
                        className="route-menu"
                        ref={openRouteMenu?.routeId === route.id ? routeMenuRef : null}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setOpenRouteMenu(null)
                            routeMenuButtonRef.current?.focus()
                          }
                        }}
                      >
                        <button
                          ref={openRouteMenu?.routeId === route.id ? routeMenuButtonRef : null}
                          className="route-menu-trigger"
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={openRouteMenu?.routeId === route.id}
                          aria-label={`Aktionen für ${route.name}`}
                          title="Routenaktionen"
                          onClick={(event) => {
                            if (openRouteMenu?.routeId === route.id) {
                              setOpenRouteMenu(null)
                            } else {
                              openRouteActions(route.id, event.currentTarget)
                            }
                          }}
                        >
                          ⋮
                        </button>
                      </div>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {openMenuRoute &&
            openRouteMenu &&
            createPortal(
              <div
                ref={routeMenuPopoverRef}
                className="route-menu-popover"
                role="menu"
                aria-label={`Aktionen für ${openMenuRoute.name}`}
                style={{ top: openRouteMenu.top, left: openRouteMenu.left }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setOpenRouteMenu(null)
                    routeMenuButtonRef.current?.focus()
                  }
                }}
              >
                <button
                  className="route-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => showRouteProperties(openMenuRoute)}
                >
                  Eigenschaften
                </button>
                {openMenuRoute.editable && (
                  <button
                    className="route-menu-item"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpenRouteMenu(null)
                      void exportRoute(openMenuRoute)
                    }}
                  >
                    GPX exportieren
                  </button>
                )}
                <button
                  className="route-menu-item danger"
                  type="button"
                  role="menuitem"
                  onClick={() => confirmDeleteRoute(openMenuRoute)}
                >
                  Route entfernen
                </button>
              </div>,
              document.body,
            )}
          {routeEditor &&
            createPortal(
              <>
                <div className="route-editor-backdrop" aria-hidden="true" />
                {renderRouteEditor(routeEditor.draft)}
              </>,
              document.body,
            )}
          {pointEditor &&
            createPortal(
              <>
                <div className="route-editor-backdrop" aria-hidden="true" />
                {renderPointEditor(pointEditor.draft)}
              </>,
              document.body,
            )}
          {routeCreationDialogOpen &&
            createPortal(
              <>
                <div className="route-editor-backdrop" aria-hidden="true" />
                <section
                  className="route-creation-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="route-creation-title"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setRouteCreationDialogOpen(false)
                  }}
                >
                  <div className="route-editor-heading">
                    <span className="eyebrow" id="route-creation-title">
                      Was möchtest du tun?
                    </span>
                  </div>
                  <fieldset className="route-creation-options">
                    <label className="route-creation-option">
                      <input
                        ref={routeCreationOptionRef}
                        type="radio"
                        name="route-creation-mode"
                        value="new"
                        checked={routeCreationMode === 'new'}
                        onChange={() => setRouteCreationMode('new')}
                      />
                      <span>Neue Route erstellen</span>
                    </label>
                    <label className="route-creation-option">
                      <input
                        type="radio"
                        name="route-creation-mode"
                        value="gpx"
                        checked={routeCreationMode === 'gpx'}
                        onChange={() => setRouteCreationMode('gpx')}
                      />
                      <span>GPX-Datei importieren</span>
                    </label>
                  </fieldset>
                  <div className="route-editor-actions">
                    <button
                      className="route-editor-action cancel"
                      type="button"
                      onClick={() => setRouteCreationDialogOpen(false)}
                    >
                      Abbrechen
                    </button>
                    <button
                      className="route-editor-action save"
                      type="button"
                      onClick={confirmRouteCreation}
                    >
                      Weiter
                    </button>
                  </div>
                </section>
              </>,
              document.body,
            )}

          <div className="sidebar-bottom">
            <input
              ref={importInput}
              className="hidden-input"
              type="file"
              accept=".gpx,application/gpx+xml"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (file) importGpx(file)
              }}
            />
            <div className="provider-status">
              <span
                className={`status-dot ${
                  project.routes.some((route) => route.routingState === 'fallback')
                    ? 'error'
                    : project.routes.some((route) => route.routingState === 'loading')
                      ? 'loading'
                      : ''
                }`}
              />
              <ExternalLink
                url={ROUTING_PROVIDER.attributionUrl}
                className="provider-name-link"
                title={`${ROUTING_PROVIDER.label} Attribution und Projekt öffnen`}
              >
                {ROUTING_PROVIDER.label}
              </ExternalLink>
              <span>
                {project.routes.some((route) => route.routingState === 'fallback')
                  ? 'nicht erreichbar'
                  : project.routes.some((route) => route.routingState === 'loading')
                    ? 'wird verwendet'
                    : 'bereit'}
              </span>
              <span
                className="status-info"
                title={`Profile: ${routingProfileLabel('hiking')} · ${routingProfileLabel('cycling')}`}
              >
                i
              </span>
            </div>
          </div>
        </aside>

        <section className="content-column">
          <section className="map-panel">
            <div className={`map-canvas map-mode-${toolMode}`}>
              <div ref={mapContainer} className="map-container" />
            </div>
            <div className="map-tools" role="toolbar" aria-label="Kartenwerkzeuge">
              <div className="map-search">
                <button
                  type="button"
                  className={`map-tool-button ${searchOpen ? 'active' : ''}`}
                  disabled={routePropertiesOpen}
                  onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
                  aria-label="Orte suchen"
                  aria-expanded={searchOpen}
                  aria-controls="map-place-search"
                  data-tooltip="Ort suchen"
                  title="Ort suchen"
                >
                  <MapToolIcon name="search" />
                </button>
                {searchOpen && (
                  <section
                    className="map-search-panel"
                    id="map-place-search"
                    aria-label="Ortssuche"
                  >
                    <form className="map-search-form" onSubmit={searchPlaces}>
                      <input
                        ref={searchInput}
                        type="search"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Stadt, Ort oder Sehenswürdigkeit"
                        aria-label="Suchbegriff"
                      />
                      <button type="submit" disabled={searchLoading}>
                        Suchen
                      </button>
                      <button
                        type="button"
                        className="map-search-close"
                        onClick={closeSearch}
                        aria-label="Suche schließen"
                        title="Schließen"
                      >
                        ×
                      </button>
                    </form>
                    {searchLoading && <p className="map-search-message" role="status">Suche läuft …</p>}
                    {!searchLoading && searchMessage && (
                      <p className="map-search-message" role="status">{searchMessage}</p>
                    )}
                    {searchResults.length > 0 && (
                      <ul className="map-search-results" aria-label="Suchergebnisse">
                        {searchResults.map((result) => (
                          <li key={result.place_id}>
                            <button
                              type="button"
                              onClick={() => {
                                focusSearchResult(result)
                                setSearchMessage('')
                              }}
                            >
                              {result.display_name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="map-search-attribution-bar">
                      <ExternalLink
                        className="map-search-attribution"
                        url={GEOCODING_PROVIDER.url}
                        title="Nominatim Nutzungsbedingungen und Richtlinien öffnen"
                      >
                        Nominatim
                      </ExternalLink>
                      <span className="map-search-attribution-sep">·</span>
                      <ExternalLink
                        className="map-search-attribution"
                        url={OSM_COPYRIGHT_URL}
                        title="OpenStreetMap Copyright & Lizenz (ODbL) öffnen"
                      >
                        Geocoding-Daten © OpenStreetMap
                      </ExternalLink>
                    </div>
                  </section>
                )}
              </div>
              <button
                type="button"
                className={`map-tool-button ${toolMode === 'pan' ? 'active' : ''}`}
                onClick={() => activateToolMode('pan')}
                aria-label="Karte verschieben, schreibgeschützt"
                aria-pressed={toolMode === 'pan'}
                data-tooltip="Karte verschieben (schreibgeschützt)"
                title="Karte verschieben (schreibgeschützt)"
              >
                <MapToolIcon name="pan" />
              </button>
              <button
                type="button"
                className={`map-tool-button ${toolMode === 'route' ? 'active' : ''}`}
                disabled={routePropertiesOpen}
                onClick={() => activateToolMode('route')}
                aria-label="Routenbearbeitung"
                aria-pressed={toolMode === 'route'}
                data-tooltip="Routenbearbeitung"
                title="Routenbearbeitung"
              >
                <MapToolIcon name="route" />
              </button>
              <button
                type="button"
                className={`map-tool-button ${toolMode === 'point' ? 'active' : ''}`}
                disabled={routePropertiesOpen}
                onClick={() => activateToolMode('point')}
                aria-label="Punkt oder POI setzen"
                aria-pressed={toolMode === 'point'}
                data-tooltip="Punkt / POI setzen"
                title="Punkt / POI setzen"
              >
                <MapToolIcon name="point" />
              </button>
              <button
                type="button"
                className="map-tool-button"
                disabled={routePropertiesOpen || !activeRoute || getDisplayedRouteCoordinates(activeRoute).length === 0}
                onClick={() => activeRoute && focusRoute(activeRoute)}
                aria-label="Aktive Route fokussieren und vollständig einpassen"
                data-tooltip="Route fokussieren"
                title="Route fokussieren und vollständig einpassen"
              >
                <MapToolIcon name="focus" />
              </button>
            </div>
            {notice && (
              <div className="map-notice" role="status" aria-live="polite">
                {notice}
              </div>
            )}
            {errorBanner && (
              <StatusBanner
                title={errorBanner.title}
                message={errorBanner.message}
                actionLabel={
                  errorBanner.action === 'map-retry'
                    ? 'Kartenlayer erneut laden'
                    : 'Routing erneut versuchen'
                }
                onAction={() => {
                  if (errorBanner.action === 'map-retry') {
                    retryMapLayer()
                    return
                  }
                  const route = errorBanner.routeId
                    ? project.routes.find((item) => item.id === errorBanner.routeId)
                    : undefined
                  if (route) retryRouting(route)
                }}
                onClose={() => setErrorBanner(null)}
              />
            )}
            {contextMenu && (
              <div
                className="context-menu"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  onClick={deleteNode}
                  disabled={
                    toolMode !== 'route' ||
                    !project.routes.find((route) => route.id === contextMenu.routeId)?.editable
                  }
                >
                  Routenpunkt löschen
                </button>
                <button onClick={() => setContextMenu(null)}>Abbrechen</button>
              </div>
            )}
          </section>

          <section
            className={`inspector ${elevationExpanded ? 'expanded' : 'compact'}`}
            id="active-elevation-profile"
          >
            {elevationExpanded && (
              <button
                className="inspector-close"
                type="button"
                onClick={() => setElevationExpanded(false)}
                title="Höhenprofil schließen"
                aria-label="Höhenprofil schließen"
              >
                ×
              </button>
            )}
            <div className="inspector-main">
              <div className="inspector-title-row">
                <div>
                  <span className="eyebrow">Aktive Route</span>
                  <strong className="inspector-route-name">{activeRoute?.name ?? 'Keine Route'}</strong>
                </div>
                <div className="inspector-actions">
                  <span
                    className={`inspector-route-status ${
                      inspectorRouteStatus.isError ? 'error' : ''
                    }`}
                    title={inspectorRouteStatus.tooltip}
                    tabIndex={0}
                  >
                    {inspectorRouteStatus.text}
                  </span>
                  <span
                    className={`inspector-elevation-status ${
                      inspectorElevationStatus.active ? '' : 'inactive'
                    }`}
                    title={inspectorElevationStatus.tooltip}
                    tabIndex={0}
                  >
                    {inspectorElevationStatus.text}
                  </span>
                </div>
              </div>
              {!elevationExpanded && (
                <div className="compact-inspector-content">
                  <div className="compact-metric-grid">
                    <span title="Distanz: Gesamtlänge der aktiven Route">
                      <strong>{activeMetrics?.length.toFixed(1) ?? '0.0'}</strong> km
                    </span>
                    <span title="Dauer: Geschätzte Geh- bzw. Fahrzeit basierend auf Streckenlänge und Höhenmetern">
                      <strong>{activeMetrics ? formatDuration(activeMetrics.durationMinutes) : '–'}</strong>
                    </span>
                    <span title="Aufstieg: Summe aller positiven Höhenmeter entlang der Route">
                      <strong>{Math.round(activeMetrics?.ascent ?? 0)}</strong> m Aufstieg
                    </span>
                    <span title="Abstieg: Summe aller negativen Höhenmeter entlang der Route">
                      <strong>{Math.round(activeMetrics?.descent ?? 0)}</strong> m Abstieg
                    </span>
                    <span title="Höchster Punkt: Maximale Höhe über dem Meeresspiegel">
                      <strong>{activeMetrics?.high ?? 0}</strong> m höchster
                    </span>
                    <span title="Niedrigster Punkt: Minimale Höhe über dem Meeresspiegel">
                      <strong>{activeMetrics?.low ?? 0}</strong> m niedrigster
                    </span>
                  </div>
                  <button
                    className="elevation-mini-chart-button"
                    type="button"
                    onClick={() => setElevationExpanded(true)}
                    aria-label="Höhenprofil ausklappen: Interaktives Profil mit Höhen- und Distanzanalyse öffnen"
                    title="Höhenprofil ausklappen: Interaktives Profil mit Höhen- und Distanzanalyse öffnen"
                  >
                    <svg
                      viewBox="0 0 260 52"
                      preserveAspectRatio="none"
                      className="elevation-mini-chart"
                      aria-hidden="true"
                    >
                      <path
                        d={buildElevationPath(
                          activeMetrics?.elevations ?? [],
                          activeMetrics?.distances ?? [],
                          activeDistanceScale.max,
                          activeElevationScale,
                          260,
                          52,
                          0,
                          0,
                          4,
                          8,
                        )}
                        fill="rgba(126, 231, 135, 0.16)"
                        stroke="#7ee787"
                        strokeWidth="1.5"
                      />
                    </svg>
                  </button>
                </div>
              )}
              {elevationExpanded && (
                <div className="metric-grid">
                  <div className="metric" title="Distanz: Gesamtlänge der aktiven Route">
                    <span className="metric-label">Distanz</span>
                    <strong>{activeMetrics?.length.toFixed(1) ?? '0.0'} <small>km</small></strong>
                  </div>
                  <div className="metric" title="Dauer: Geschätzte Geh- bzw. Fahrzeit basierend auf Streckenlänge und Höhenmetern">
                    <span className="metric-label">Dauer</span>
                    <strong>{activeMetrics ? formatDuration(activeMetrics.durationMinutes) : '–'}</strong>
                  </div>
                  <div className="metric" title="Aufstieg: Summe aller positiven Höhenmeter entlang der Route">
                    <span className="metric-label">Aufstieg</span>
                    <strong>{Math.round(activeMetrics?.ascent ?? 0)} <small>m</small></strong>
                  </div>
                  <div className="metric" title="Abstieg: Summe aller negativen Höhenmeter entlang der Route">
                    <span className="metric-label">Abstieg</span>
                    <strong>{Math.round(activeMetrics?.descent ?? 0)} <small>m</small></strong>
                  </div>
                  <div className="metric" title="Höchster Punkt: Maximale Höhe über dem Meeresspiegel">
                    <span className="metric-label">Höchster Punkt</span>
                    <strong>{activeMetrics?.high ?? 0} <small>m</small></strong>
                  </div>
                  <div className="metric" title="Niedrigster Punkt: Minimale Höhe über dem Meeresspiegel">
                    <span className="metric-label">Niedrigster Punkt</span>
                    <strong>{activeMetrics?.low ?? 0} <small>m</small></strong>
                  </div>
                </div>
              )}
            </div>
            {elevationExpanded && (
              <div className="elevation-card">
                <div className="elevation-header">
                  <span className="eyebrow">Höhenprofil</span>
                  <span
                    className={`elevation-profile-status ${
                      inspectorElevationStatus.active ? '' : 'inactive'
                    }`}
                    title={inspectorElevationStatus.tooltip}
                    tabIndex={0}
                  >
                    {inspectorElevationStatus.text}
                  </span>
                </div>
                <div className={`profile-chart-area ${profilePointDetails ? 'has-selection' : ''}`}>
                  <svg
                    viewBox="0 0 560 190"
                    preserveAspectRatio="none"
                    className="elevation-chart"
                    role="img"
                    aria-label="Höhenprofil der aktiven Route"
                    onMouseMove={(event) => {
                      if (!activeRoute || !activeMetrics?.elevations.length) {
                        setHoveredProfilePoint(null)
                        return
                      }
                      const bounds = event.currentTarget.getBoundingClientRect()
                      const fraction = profileFractionFromPointer(event.clientX, bounds)
                      setHoveredProfilePoint(
                        fraction === null ? null : profileDetailsAtFraction(activeRoute, fraction),
                      )
                    }}
                    onMouseLeave={() => setHoveredProfilePoint(null)}
                  >
                    <defs>
                      <linearGradient id="elevation-fill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#7ee787" stopOpacity="0.42" />
                        <stop offset="100%" stopColor="#7ee787" stopOpacity="0.02" />
                      </linearGradient>
                    </defs>
                    {Array.from(
                      { length: Math.round((activeElevationScale.max - activeElevationScale.min) / activeElevationScale.step) + 1 },
                      (_, index) => index,
                    ).map((index) => {
                        const value = activeElevationScale.min + index * activeElevationScale.step
                        const y = elevationProfileY(
                        value,
                        activeMetrics?.elevations ?? [],
                        activeElevationScale,
                        profileViewBox.height,
                        profileViewBox.plotTop,
                        profileViewBox.plotBottom,
                        )
                        return (
                          <g key={value}>
                            <line x1="42" x2="550" y1={y} y2={y} className="elevation-grid-line" />
                          </g>
                        )
                      })}
                    <path
                      d={buildElevationPath(
                        activeMetrics?.elevations ?? [],
                        activeMetrics?.distances ?? [],
                        activeDistanceScale.max,
                        activeElevationScale,
                        profileViewBox.width,
                        profileViewBox.height,
                        profileViewBox.plotLeft,
                        profileViewBox.plotRight,
                        profileViewBox.plotTop,
                        profileViewBox.plotBottom,
                      )}
                      fill="url(#elevation-fill)"
                      stroke="#7ee787"
                      strokeWidth="2"
                    />
                    {activeDistanceScale.ticks.map((distance) => {
                      const x =
                        profileViewBox.plotLeft +
                        (distance / Math.max(1, activeDistanceScale.max)) *
                          (profileViewBox.width -
                            profileViewBox.plotLeft -
                            profileViewBox.plotRight)
                      return (
                        <g key={distance}>
                          <line
                            x1={x}
                            x2={x}
                            y1={profileViewBox.height - profileViewBox.plotBottom}
                            y2={profileViewBox.height - profileViewBox.plotBottom + 4}
                            className="elevation-axis-tick"
                          />
                        </g>
                      )
                    })}
                    {profilePointDetails && (
                      <>
                        <line
                          x1={
                            profileViewBox.plotLeft +
                            profilePointDetails.profileFraction *
                              (profileViewBox.width -
                                profileViewBox.plotLeft -
                                profileViewBox.plotRight)
                          }
                          x2={
                            profileViewBox.plotLeft +
                            profilePointDetails.profileFraction *
                              (profileViewBox.width -
                                profileViewBox.plotLeft -
                                profileViewBox.plotRight)
                          }
                          y1={profileViewBox.plotTop}
                          y2={profileViewBox.height - profileViewBox.plotBottom}
                          stroke="#ffb86c"
                          strokeWidth="1.5"
                        />
                        <circle
                          cx={
                            profileViewBox.plotLeft +
                            profilePointDetails.profileFraction *
                              (profileViewBox.width -
                                profileViewBox.plotLeft -
                                profileViewBox.plotRight)
                          }
                          cy={elevationProfileY(
                            profilePointDetails.elevation,
                            activeMetrics?.elevations ?? [],
                            activeElevationScale,
                            profileViewBox.height,
                            profileViewBox.plotTop,
                            profileViewBox.plotBottom,
                          )}
                          r="4"
                          fill="#ffb86c"
                          stroke="#0d1318"
                          strokeWidth="2"
                        />
                      </>
                    )}
                  </svg>
                  <div className="elevation-axis-overlay" aria-hidden="true">
                    {Array.from(
                      { length: Math.round((activeElevationScale.max - activeElevationScale.min) / activeElevationScale.step) + 1 },
                      (_, index) => index,
                    ).map((index) => {
                      const value = activeElevationScale.min + index * activeElevationScale.step
                      const y = elevationProfileY(
                        value,
                        activeMetrics?.elevations ?? [],
                        activeElevationScale,
                        profileViewBox.height,
                        profileViewBox.plotTop,
                        profileViewBox.plotBottom,
                      )
                      return (
                        <span
                          key={value}
                          className="elevation-axis-label-overlay elevation-axis-label-y"
                          style={{
                            left: `${(36 / profileViewBox.width) * 100}%`,
                            top: `${(y / profileViewBox.height) * 100}%`,
                          }}
                        >
                          {value}
                        </span>
                      )
                    })}
                    {activeDistanceScale.ticks.map((distance, index) => {
                      const x =
                        profileViewBox.plotLeft +
                        (distance / Math.max(1, activeDistanceScale.max)) *
                          (profileViewBox.width -
                            profileViewBox.plotLeft -
                            profileViewBox.plotRight)
                      const isFirst = index === 0
                      const isLast = index === activeDistanceScale.ticks.length - 1
                      return (
                        <span
                          key={distance}
                          className={`elevation-axis-label-overlay elevation-axis-label-x ${
                            isFirst ? 'align-start' : isLast ? 'align-end' : ''
                          }`}
                          style={{
                            left: `${(x / profileViewBox.width) * 100}%`,
                            top: `${(174 / profileViewBox.height) * 100}%`,
                          }}
                        >
                          {formatDistanceAxis(distance)}
                        </span>
                      )
                    })}
                    <span
                      className="elevation-axis-title-overlay elevation-axis-title-x"
                      style={{
                        left: `${(296 / profileViewBox.width) * 100}%`,
                        top: `${(187 / profileViewBox.height) * 100}%`,
                      }}
                    >
                      Entfernung (km)
                    </span>
                    <span
                      className="elevation-axis-title-overlay elevation-axis-title-y"
                      style={{
                        left: `${(10 / profileViewBox.width) * 100}%`,
                        top: `${(92 / profileViewBox.height) * 100}%`,
                      }}
                    >
                      Höhe (m)
                    </span>
                  </div>
                  {profilePointDetails && (
                    <div
                      className={`profile-selection profile-selection-side ${
                        profilePointDetails.profileFraction > 0.78 ? 'align-left' : ''
                      }`}
                      style={{
                        left: `${
                          ((profileViewBox.plotLeft +
                            profilePointDetails.profileFraction *
                              (profileViewBox.width -
                                profileViewBox.plotLeft -
                                profileViewBox.plotRight)) /
                            profileViewBox.width) *
                          100
                        }%`,
                      }}
                    >
                      <span>{profilePointDetails.elevation} m Höhe</span>
                      <span>{profilePointDetails.distance.toFixed(2)} km ab Start</span>
                      <span>{formatDuration(profilePointDetails.elapsedMinutes)} ab Start</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </section>
      </main>
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  )
}

function buildElevationPath(
  elevations: number[],
  distances: number[],
  distanceMax: number,
  scale: ElevationScale,
  width: number,
  height: number,
  plotLeft: number,
  plotRight: number,
  plotTop: number,
  plotBottom: number,
) {
  const plotWidth = Math.max(1, width - plotLeft - plotRight)
  const plotHeight = Math.max(1, height - plotTop - plotBottom)
  const baseline = height - plotBottom
  if (!elevations.length) return `M ${plotLeft} ${baseline} L ${width - plotRight} ${baseline}`
  const line = elevations
    .map((elevation, index) => {
      const distance = distances[index] ?? (index / Math.max(1, elevations.length - 1)) * distanceMax
      const x = plotLeft + (distance / Math.max(1, distanceMax)) * plotWidth
      const y = plotTop + ((scale.max - elevation) / Math.max(1, scale.max - scale.min)) * plotHeight
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  return `${line} L ${width - plotRight} ${baseline} L ${plotLeft} ${baseline} Z`
}

function elevationProfileY(
  elevation: number,
  elevations: number[],
  scale: ElevationScale,
  height: number,
  plotTop: number,
  plotBottom: number,
) {
  if (!elevations.length) return height - plotBottom
  const clampedElevation = Math.min(scale.max, Math.max(scale.min, elevation))
  const plotHeight = Math.max(1, height - plotTop - plotBottom)
  return plotTop + ((scale.max - clampedElevation) / Math.max(1, scale.max - scale.min)) * plotHeight
}

export default App
