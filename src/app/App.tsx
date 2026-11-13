import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { isTauri } from '@tauri-apps/api/core'
import 'leaflet/dist/leaflet.css'
import './App.css'
import AboutDialog from '../components/about/AboutDialog'
import { CacheDialog } from '../components/cache/CacheDialog'
import { ProjectHeader } from '../components/project/ProjectHeader'
import { RouteList } from '../components/routes/RouteList'
import { RouteEditor } from '../components/routes/RouteEditor'
import { RouteCreationDialog } from '../components/routes/RouteCreationDialog'
import { PointEditor } from '../components/points/PointEditor'
import { MapToolbar } from '../components/map/MapToolbar'
import { ElevationProfile } from '../components/elevation-profile/ElevationProfile'
import { SettingsDialog } from '../components/settings/SettingsDialog'
import { ExitDialog } from '../components/exit/ExitDialog'
import { distanceInUnit, readSettings, SETTINGS_KEY, type Settings } from '../domain/settings'
import { tileDiagnostics } from '../integrations/map/tileDiagnostics'
import { openExternalUrl } from '../integrations/desktop/externalUrl'
import { ROUTING_PROVIDER } from '../domain/routing'
import {
  type Coordinate,
  type MapPoint,
  type ProfilePointDetails,
  type ProjectFile,
  type Route,
  type RouteNode,
} from '../domain/routeModel'
import {
  isValidDistanceMarkerStepKm,
  selectedRoutePointDetails,
  DISTANCE_MARKER_MAX_STEP_KM,
  DISTANCE_MARKER_MIN_STEP_KM,
} from '../domain/routeMetrics'
import { readInitialProject } from '../domain/project'
import { useLeafletMap } from '../integrations/map/useLeafletMap'
import { useProjectFiles } from '../features/project-files/useProjectFiles'
import { uid } from '../domain/uid'
import type { ErrorBanner, NodeContextMenu, NodeSelection, ToolMode } from './appTypes'
import { useRouteRouting } from '../features/route-routing/useRouteRouting'
import { usePlaceSearch } from '../features/geocoding/usePlaceSearch'
import { useDesktopExit } from '../features/desktop-exit/useDesktopExit'
import {
  getPoiIcon,
} from '../integrations/map/poiIcons'

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

function App() {
  const [initial] = useState(() => {
    let warning = ''
    const project = readInitialProject(localStorage, (message) => { warning = message })
    const stored = readSettings(localStorage)
    return {
      project: stored.saved ? { ...project, mapLayerId: stored.settings.start.layerId, mapOverlayIds: stored.settings.start.overlayIds } : project,
      settings: stored.settings,
      warning: [warning, stored.warning].filter(Boolean).join(' '),
    }
  })
  const [project, setProject] = useState<ProjectFile>(initial.project)
  const [settings, setSettings] = useState(initial.settings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingProjectName, setEditingProjectName] = useState(false)
  const [projectNameDraft, setProjectNameDraft] = useState('')
  const [projectDescriptionDraft, setProjectDescriptionDraft] = useState('')
  const projectDraftRef = useRef({ editingProjectName, projectNameDraft, projectDescriptionDraft })
  useLayoutEffect(() => {
    projectDraftRef.current = { editingProjectName, projectNameDraft, projectDescriptionDraft }
  }, [editingProjectName, projectNameDraft, projectDescriptionDraft])
  const [toolMode, setToolMode] = useState<ToolMode>('route')
  const [routeCreationDialogOpen, setRouteCreationDialogOpen] = useState(false)
  const [routeCreationMode, setRouteCreationMode] = useState<'new' | 'gpx'>('new')
  const [elevationExpanded, setElevationExpanded] = useState(false)
  const [notice, setNotice] = useState(initial.warning)
  const [cacheWarning, setCacheWarning] = useState('')
  const [errorBanner, setErrorBanner] = useState<ErrorBanner | null>(null)
  const [mapLayerRetry, setMapLayerRetry] = useState<{ layerId: string; sequence: number } | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [cacheOpen, setCacheOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<NodeContextMenu | null>(null)
  const [layerId, setLayerId] = useState(initial.project.mapLayerId)
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
  const [selectedNode, setSelectedNode] = useState<NodeSelection | null>(null)
  const [hoveredProfilePoint, setHoveredProfilePoint] = useState<ProfilePointDetails | null>(null)
  const [poiIconPickerOpen, setPoiIconPickerOpen] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)
  const routeCreationOptionRef = useRef<HTMLInputElement>(null)
  const projectInput = useRef<HTMLInputElement>(null)
  const projectDescriptionInput = useRef<HTMLTextAreaElement>(null)
  const routeEditorRef = useRef<HTMLElement>(null)
  const routeMenuRef = useRef<HTMLDivElement>(null)
  const routeMenuPopoverRef = useRef<HTMLDivElement>(null)
  const routeMenuButtonRef = useRef<HTMLButtonElement>(null)
  const routeCardRefs = useRef(new Map<string, HTMLDivElement>())

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
  const retryRouteRouting = useRouteRouting(project, setProject, {
    onSuccess: (routeId) => {
      setErrorBanner((current) =>
        current?.action === 'routing-retry' && current.routeId === routeId ? null : current,
      )
      setNotice(`Route über ${ROUTING_PROVIDER.label} berechnet.`)
    },
    onFailure: (routeId, message) => {
      setErrorBanner({
        title: 'Routing fehlgeschlagen',
        message: `${message} Die direkte Verbindung bleibt als Fallback sichtbar.`,
        action: 'routing-retry',
        routeId,
      })
    },
  })

  const bannerRoute = errorBanner?.action === 'routing-retry'
    ? project.routes.find((route) => route.id === errorBanner.routeId)
    : undefined
  const visibleErrorBanner = errorBanner?.action === 'routing-retry' &&
    (bannerRoute?.routingState !== 'fallback' || !bannerRoute.routingError)
    ? null
    : errorBanner

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

  const openPointEditor = useCallback((point: MapPoint, isNew: boolean, clientX: number, clientY: number) => {
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
  }, [])

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

  const insertNodeAtCoordinate = useCallback((routeId: string, coordinate: Coordinate, neighbors: [string, string]) => {
    const route = project.routes.find((item) => item.id === routeId)
    if (toolMode !== 'route' || !route?.editable) return
    setProject((current) => ({
      ...current,
      routes: current.routes.map((route) => {
        if (route.id !== routeId || !route.editable || current.activeRouteId !== routeId) return route
        const insertIndex = route.nodes.findIndex((node, index) =>
          index > 0 && node.id === neighbors[1] && route.nodes[index - 1].id === neighbors[0],
        )
        if (insertIndex < 0) return route
        const node: RouteNode = { id: uid('node'), coordinate }
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

  const clearSearchLayerRef = useRef<() => void>(() => {})
  const placeSearch = usePlaceSearch(() => clearSearchLayerRef.current())
  const {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchResults,
    searchLoading,
    searchMessage,
    setSearchMessage,
    searchInput,
    closeSearch,
    searchPlaces,
  } = placeSearch
  const { mapContainer, focusRouteOnMap, focusSearchResultOnMap, clearSearchLayer, getMapView, mapZoom, osmPlaces } = useLeafletMap({
    project, setProject, activeRoute, layerId, mapLayerRetry, toolMode, routePropertiesOpen,
    start: initial.settings.start, units: settings.units,
    mapHoveredPoint: hoveredProfilePoint, selectedNode, contextMenu, setSelectedNode, setContextMenu,
    setErrorBanner, setNotice, setCacheWarning, setSearchMessage, openPointEditor, updateNode, insertNodeAtCoordinate,
  })
  useEffect(() => {
    clearSearchLayerRef.current = clearSearchLayer
  }, [clearSearchLayer])

  function focusRoute(route: Route) {
    setProject((current) => ({ ...current, activeRouteId: route.id }))
    focusRouteOnMap(route)
  }

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

  const { exportRoute, saveProject, confirmBeforeExit, newProject, openProject, importGpx, importProject } = useProjectFiles({
    project, activeRoute, setProject, setLayerId, setNotice,
  })

  function projectWithDraft() {
    const draft = projectDraftRef.current
    const projectToSave = draft.editingProjectName ? {
      ...project,
      name: draft.projectNameDraft.trim() || project.name,
      description: draft.projectDescriptionDraft.slice(0, 180),
    } : project
    return { projectToSave, isCurrent: () => {
      const current = projectDraftRef.current
      return current.editingProjectName === draft.editingProjectName &&
        current.projectNameDraft === draft.projectNameDraft &&
        current.projectDescriptionDraft === draft.projectDescriptionDraft
    } }
  }

  const { exitDialogOpen, chooseExit, exitApp } = useDesktopExit({
    getProjectToSave: projectWithDraft,
    confirmBeforeExit,
    setNotice,
  })

  const saveShortcutRef = useRef(() => {})
  useLayoutEffect(() => {
    saveShortcutRef.current = () => {
      if (routePropertiesOpen || aboutOpen || cacheOpen || settingsOpen || routeCreationDialogOpen || exitDialogOpen) return
      void saveProject(projectWithDraft().projectToSave)
    }
  })
  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
          event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (!event.repeat) saveShortcutRef.current()
    }
    window.addEventListener('keydown', handleSaveShortcut)
    return () => window.removeEventListener('keydown', handleSaveShortcut)
  }, [])

  async function createNewProject() {
    const { projectToSave, isCurrent } = projectWithDraft()
    if (!await newProject(projectToSave, isCurrent)) return
    cancelProjectNameEdit()
    setRouteEditor(null)
    setPointEditor(null)
    setOpenRouteMenu(null)
    setSelectedNode(null)
    setHoveredProfilePoint(null)
    setContextMenu(null)
    setErrorBanner(null)
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
        `Die manuelle Schrittweite muss zwischen ${distanceInUnit(DISTANCE_MARKER_MIN_STEP_KM, settings.units.distance).toFixed(settings.units.distance === 'km' ? 1 : 6)} und ${distanceInUnit(DISTANCE_MARKER_MAX_STEP_KM, settings.units.distance).toFixed(settings.units.distance === 'km' ? 0 : 6)} ${settings.units.distance} liegen.`,
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
                name: routeEditor.draft.name,
                description: routeEditor.draft.description,
                type: routeEditor.draft.type,
                color: routeEditor.draft.color,
                customColor: routeEditor.draft.customColor,
                showDistanceMarkers: routeEditor.draft.showDistanceMarkers,
                distanceMarkerMode: routeEditor.draft.distanceMarkerMode,
                distanceMarkerStepKm: routeEditor.draft.distanceMarkerStepKm,
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

  function retryRouting(route: Route) {
    if (!route.editable || route.nodes.length < 2) return
    retryRouteRouting(route.id)
    setErrorBanner((current) =>
      current?.action === 'routing-retry' && current.routeId === route.id
        ? null
        : current,
    )
    setNotice(`${ROUTING_PROVIDER.label} wird erneut versucht.`)
  }

  function retryMapLayer(failedLayerId: string) {
    setMapLayerRetry((current) => ({ layerId: failedLayerId, sequence: (current?.sequence ?? 0) + 1 }))
  }

  function saveSettings(next: Settings): string | null {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
      if (settings.developer.cacheDiagnostics && !next.developer.cacheDiagnostics) {
        tileDiagnostics.clear()
      }
      setSettings(next)
      return null
    } catch (error) {
      console.error('Einstellungen konnten nicht gespeichert werden.', error)
      return 'Einstellungen konnten nicht gespeichert werden.'
    }
  }

  return (
    <>
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
      <div
        className="app-shell"
        inert={routePropertiesOpen || aboutOpen || cacheOpen || settingsOpen || routeCreationDialogOpen || exitDialogOpen}
        onClick={() => contextMenu && setContextMenu(null)}
      >

      <ProjectHeader projectInput={projectInput} newProject={() => { void createNewProject() }}
        openProject={() => { void openProject(() => projectInput.current?.click()) }}
        saveProject={() => { void saveProject(projectWithDraft().projectToSave) }}
        saveProjectAs={() => { void saveProject(projectWithDraft().projectToSave, true) }} importProject={importProject}
        openCache={() => setCacheOpen(true)} openAbout={() => setAboutOpen(true)} openSettings={() => setSettingsOpen(true)}
        desktop={isTauri()} exitApp={() => { void exitApp() }} />

      <main className="workspace">
        <aside className="sidebar">
          <div className={`sidebar-heading ${editingProjectName ? 'editing' : ''}`}>
            <div>
              <span className="eyebrow">Projekt</span>
              <div className="project-title-row">
                {editingProjectName ? (
                  <input
                    className="project-name"
                    value={projectNameDraft}
                    onChange={(event) => setProjectNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        saveProjectName()
                      } else if (event.key === 'Escape') {
                        cancelProjectNameEdit()
                      }
                    }}
                    aria-label="Projektname"
                  />
                ) : (
                  <div className="project-name-display" aria-label="Projektname">
                    {project.name}
                  </div>
                )}
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

          <RouteList project={project} units={settings.units} openRouteMenu={openRouteMenu} setOpenRouteMenu={setOpenRouteMenu}
            routeMenuRef={routeMenuRef} routeMenuPopoverRef={routeMenuPopoverRef}
            routeMenuButtonRef={routeMenuButtonRef} routeCardRefs={routeCardRefs}
            focusRoute={focusRoute} openRouteActions={openRouteActions}
            showRouteProperties={showRouteProperties} exportRoute={exportRoute} confirmDeleteRoute={confirmDeleteRoute} />
          {routeEditor &&
            createPortal(
              <>
                <div className="route-editor-backdrop" aria-hidden="true" />
                <RouteEditor route={routeEditor.draft} units={settings.units} top={routeEditor.top} left={routeEditor.left}
                  routeEditorRef={routeEditorRef} updateRouteDraft={updateRouteDraft}
                  saveRouteProperties={saveRouteProperties} close={() => setRouteEditor(null)} />
              </>,
              document.body,
            )}
          {pointEditor &&
            createPortal(
              <>
                <div className="route-editor-backdrop" aria-hidden="true" />
                <PointEditor point={pointEditor.draft} isNew={pointEditor.isNew}
                  top={pointEditor.top} left={pointEditor.left} poiIconPickerOpen={poiIconPickerOpen}
                  setPoiIconPickerOpen={setPoiIconPickerOpen} updatePointDraft={updatePointDraft}
                  confirmDeletePoint={confirmDeletePoint} savePointProperties={savePointProperties}
                  close={() => setPointEditor(null)} />
              </>,
              document.body,
            )}
          {routeCreationDialogOpen &&
            createPortal(
              <>
                <div className="route-editor-backdrop" aria-hidden="true" />
                <RouteCreationDialog mode={routeCreationMode} inputRef={routeCreationOptionRef}
                  onModeChange={setRouteCreationMode} onClose={() => setRouteCreationDialogOpen(false)}
                  onConfirm={confirmRouteCreation} />
              </>,
              document.body,
            )}

        </aside>

        <section className="content-column">
          <section className="map-panel">
            <div className={`map-canvas map-mode-${toolMode}`}>
              <div ref={mapContainer} className="map-container" />
            </div>
            <MapToolbar searchOpen={searchOpen} routePropertiesOpen={routePropertiesOpen}
              closeSearch={closeSearch} setSearchOpen={setSearchOpen} searchPlaces={searchPlaces}
              searchInput={searchInput} searchQuery={searchQuery} setSearchQuery={setSearchQuery}
              searchLoading={searchLoading} searchMessage={searchMessage} searchResults={searchResults}
              focusSearchResultOnMap={focusSearchResultOnMap} setSearchMessage={setSearchMessage}
              toolMode={toolMode} activateToolMode={activateToolMode} activeRoute={activeRoute}
              focusRoute={focusRoute} layerId={layerId} overlayIds={project.mapOverlayIds ?? []} osmPlaces={osmPlaces}
              changeLayer={(nextLayerId) => {
                setLayerId(nextLayerId)
                setProject((current) => ({ ...current, mapLayerId: nextLayerId }))
              }}
              toggleOverlay={(id, enabled) => setProject((current) => ({
                ...current,
                mapOverlayIds: enabled
                  ? [...(current.mapOverlayIds ?? []).filter((item) => item !== id), id]
                  : (current.mapOverlayIds ?? []).filter((item) => item !== id),
              }))} />
            {notice && (
              <div className="map-notice" role="status" aria-live="polite">
                {notice}
              </div>
            )}
            {cacheWarning && (
              <div className="map-notice map-cache-warning" role="status">
                {cacheWarning}
                <button type="button" onClick={() => setCacheWarning('')} aria-label="Cachewarnung schließen">×</button>
              </div>
            )}
            {visibleErrorBanner && (
              <StatusBanner
                title={visibleErrorBanner.title}
                message={visibleErrorBanner.message}
                actionLabel={
                  visibleErrorBanner.action === 'map-retry'
                    ? 'Kartenlayer erneut laden'
                    : 'Routing erneut versuchen'
                }
                onAction={() => {
                  if (visibleErrorBanner.action === 'map-retry') {
                    retryMapLayer(visibleErrorBanner.layerId ?? layerId)
                    return
                  }
                  const route = visibleErrorBanner.routeId
                    ? project.routes.find((item) => item.id === visibleErrorBanner.routeId)
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

          <ElevationProfile activeRoute={activeRoute} profilePointDetails={profilePointDetails}
            setHoveredProfilePoint={setHoveredProfilePoint} elevationExpanded={elevationExpanded}
            setElevationExpanded={setElevationExpanded} units={settings.units} />
        </section>
      </main>
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {settingsOpen && <SettingsDialog settings={settings} getMapView={getMapView} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />}
      {cacheOpen && <CacheDialog onClose={() => setCacheOpen(false)}
        layerIds={[layerId, ...(project.mapOverlayIds ?? [])]} retry={retryMapLayer}
        project={project} mapZoom={mapZoom}
        diagnosticsEnabled={settings.developer.cacheDiagnostics} />}
      </div>
      {exitDialogOpen && <ExitDialog onChoose={chooseExit} />}
    </>
  )
}

export default App
