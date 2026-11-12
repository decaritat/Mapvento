import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import L from 'leaflet'
import type { NodeContextMenu, NodeSelection, ToolMode } from '../../app/appTypes'
import { projectCoordinate } from '../../domain/mapCoordinates'
import { defaultPoiIcon } from '../../domain/poiIconIds'
import type { MapPoint, ProjectFile, Route, RouteNode } from '../../domain/routeModel'
import { uid } from '../../domain/uid'

type Props = {
  map: L.Map | null
  activeRoute: Route | undefined
  toolMode: ToolMode
  routePropertiesOpen: boolean
  contextMenu: NodeContextMenu | null
  selectedNode: NodeSelection | null
  setProject: Dispatch<SetStateAction<ProjectFile>>
  setSelectedNode: Dispatch<SetStateAction<NodeSelection | null>>
  setContextMenu: Dispatch<SetStateAction<NodeContextMenu | null>>
  setNotice: Dispatch<SetStateAction<string>>
  openPointEditor: (point: MapPoint, isNew: boolean, clientX: number, clientY: number) => void
}

export function useMapEditingInteractions({
  map,
  activeRoute,
  toolMode,
  routePropertiesOpen,
  contextMenu,
  selectedNode,
  setProject,
  setSelectedNode,
  setContextMenu,
  setNotice,
  openPointEditor,
}: Props) {
  const focusedRouteNodeRef = useRef<string | null>(null)
  const selectedNodeRef = useRef(selectedNode)
  const pointerDownRouteNodeRef = useRef<string | null>(null)
  const activeDragCleanupRef = useRef<(() => void) | null>(null)
  const suppressNextRouteClickRef = useRef(false)
  const suppressClickTimerRef = useRef<number | null>(null)

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
    if (!map) return
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
    return () => {
      clearSuppressedClick()
      map.getContainer().removeEventListener('mousedown', clearSuppressedClick, true)
      map.off('dragstart', onMapDragStart)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onMouseUp)
    }
  }, [map, clearRouteNodeFocus])

  useEffect(() => {
    if (toolMode !== 'route') clearRouteNodeFocus()
  }, [clearRouteNodeFocus, toolMode])

  useEffect(() => {
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
        openPointEditor(point, true, event.originalEvent.clientX, event.originalEvent.clientY)
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
  }, [map, activeRoute, contextMenu, routePropertiesOpen, toolMode, openPointEditor, setContextMenu, setProject, setNotice, clearRouteNodeFocus])

  return {
    focusedRouteNodeRef,
    selectedNodeRef,
    pointerDownRouteNodeRef,
    activeDragCleanupRef,
    suppressNextRouteClickRef,
    suppressClickTimerRef,
    clearRouteNodeFocus,
  }
}
