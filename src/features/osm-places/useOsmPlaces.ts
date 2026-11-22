import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { getPoiIcon, poiIconSvg } from '../../integrations/map/poiIcons'
import { cellsForBounds, PLACES_ZOOM, type PlaceCell } from './placeCells'
import { loadPlaces, type PlacesProgress } from './loadPlaces'
import { PLACE_KINDS, placeKind, type Bounds, type Place, type PlaceCategory, type PlaceKindId, type PlacesDiagnostic } from './places'
import { placesCache, type CachedPlaces } from './placesCache'
import { abortPlaces, diagnosticErrorName } from './placesDiagnostics'

export type PlacesControlState = {
  selectedPlace: { place: Place; anchor: { x: number; y: number; bounds: DOMRect } } | null
  selectedKinds: PlaceKindId[]
  activeKinds: PlaceKindId[]
  progress: PlacesProgress | null
  error: string
  clearing: boolean
  needsLoad: boolean
  canLoad: boolean
  canRefresh: boolean
  needsRetry: boolean
  diagnosticsEnabled: boolean
  diagnostics: PlacesDiagnostic[]
  toggleKind: (kind: PlaceKindId, enabled: boolean) => void
  toggleCategory: (category: PlaceCategory, enabled: boolean) => void
  load: () => void
  refresh: () => void
  retry: () => void
  clear: () => Promise<void>
  closePlaceDetails: () => void
}

type Viewport = { bounds: Bounds; loadBounds: Bounds; sequence: number }
const noop = () => {}

function viewportForMap(map: L.Map, sequence: number): Viewport {
  const bounds = map.getBounds()
  const center = map.project(map.getCenter(), PLACES_ZOOM)
  const size = map.getSize()
  const halfWidth = Math.max(1, Math.min(size.x, 7 * 256)) / 2
  const halfHeight = Math.max(1, Math.min(size.y, 7 * 256)) / 2
  const world = 256 * 2 ** PLACES_ZOOM
  const northWest = map.unproject(L.point(center.x - halfWidth, Math.max(0, center.y - halfHeight)), PLACES_ZOOM)
  const southEast = map.unproject(L.point(center.x + halfWidth, Math.min(world, center.y + halfHeight)), PLACES_ZOOM)
  return {
    bounds: { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() },
    loadBounds: { south: southEast.lat, west: northWest.lng, north: northWest.lat, east: southEast.lng },
    sequence,
  }
}

export function useOsmPlaces(map: L.Map | null, diagnosticsEnabled = false, onPlaceSelected: () => void = noop): PlacesControlState {
  const [selectedKinds, setSelectedKinds] = useState<PlaceKindId[]>([])
  const [activeKinds, setActiveKinds] = useState<PlaceKindId[]>([])
  const [viewport, setViewport] = useState<Viewport | null>(null)
  const [needsRetry, setNeedsRetry] = useState(false)
  const [loading, setLoading] = useState(false)
  const [moving, setMoving] = useState(false)
  const [entries, setEntries] = useState<ReadonlyMap<string, CachedPlaces>>(new Map())
  const [selectedPlace, setSelectedPlace] = useState<PlacesControlState['selectedPlace']>(null)
  const [progress, setProgress] = useState<PlacesProgress | null>(null)
  const [error, setError] = useState('')
  const [clearing, setClearing] = useState(false)
  const [diagnostics, setDiagnostics] = useState<PlacesDiagnostic[]>([])
  const diagnosticsEnabledRef = useRef(diagnosticsEnabled)
  const mounted = useRef(false)
  const clearingRef = useRef(false)
  const activeRequest = useRef<AbortController | null>(null)
  const selectedMarker = useRef<L.Marker | null>(null)
  const selectedMarkerKey = useRef<string | null>(null)
  const [reloadSequence, setReloadSequence] = useState(0)
  const nextForce = useRef(false)
  const lastForce = useRef(false)
  const recordDiagnostic = useCallback((event: PlacesDiagnostic) => {
    if (mounted.current && diagnosticsEnabledRef.current) {
      setDiagnostics((current) => [...current.slice(-99), event])
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    diagnosticsEnabledRef.current = diagnosticsEnabled
    if (!diagnosticsEnabled) return
    return () => { diagnosticsEnabledRef.current = false; setDiagnostics([]) }
  }, [diagnosticsEnabled])
  useEffect(() => {
    if (!map) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const moving = () => {
      setMoving(true)
      if (activeRequest.current && !activeRequest.current.signal.aborted) {
        setNeedsRetry(true)
        setLoading(false)
        setProgress((current) => current && { ...current, message: 'Laden durch Kartenbewegung angehalten.' })
      }
      abortPlaces(activeRequest.current, 'map-movement')
      if (timer) clearTimeout(timer)
    }
    const moved = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        setMoving(false)
        setViewport((current) => viewportForMap(map, (current?.sequence ?? 0) + 1))
      }, 600)
    }
    map.on('movestart zoomstart', moving)
    map.on('moveend zoomend', moved)
    moved()
    return () => {
      if (timer) clearTimeout(timer)
      map.off('movestart zoomstart', moving)
      map.off('moveend zoomend', moved)
    }
  }, [map])

  useEffect(() => {
    if (!activeKinds.length || !viewport || moving || clearingRef.current) return
    const controller = new AbortController()
    activeRequest.current = controller
    const force = nextForce.current
    nextForce.current = false
    lastForce.current = force
    // The following state marks the start of the external request lifecycle.
    /* oxlint-disable react/set-state-in-effect */
    setNeedsRetry(false)
    setLoading(true)
    setError('')
    setProgress({ available: 0, total: 0, pending: 0, stale: 0, message: 'Orte werden vorbereitet …' })
    /* oxlint-enable react/set-state-in-effect */
    void (async () => {
      const visible = await placesCache.getVisible(viewport.bounds, activeKinds)
      controller.signal.throwIfAborted()
      setEntries(visible)
      const cells: PlaceCell[] = cellsForBounds(viewport.loadBounds)
      await loadPlaces({
        cells, kinds: activeKinds, force, cache: placesCache, signal: controller.signal,
        onDiagnostic: recordDiagnostic,
        collectDiagnosticDetails: () => diagnosticsEnabledRef.current,
        onUpdate: (next, status) => {
          if (controller.signal.aborted) return
          setError('')
          setEntries(new Map([...visible, ...next]))
          setProgress(status)
        },
      })
    })().catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setNeedsRetry(true)
        setError(`Orte konnten nicht geladen werden: ${reason instanceof Error ? reason.message : String(reason)}`)
        setProgress((current) => current && { ...current, message: `${current.message} Laden angehalten; erneuter Versuch möglich.` })
      }
    }).finally(() => {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setLoading(false)
      }
    })
    return () => {
      abortPlaces(controller, 'effect-cleanup')
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }, [viewport, activeKinds, moving, reloadSequence, recordDiagnostic])

  useEffect(() => {
    if (!map || !activeKinds.length || !viewport) return
    const markers = L.layerGroup().addTo(map)
    const unique = new Map<string, { place: Place; downloadedAt: number }>()
    for (const entry of entries.values()) {
      for (const place of entry.places) {
        if (place.tags.shelter_type?.trim().toLowerCase() === 'public_transport') continue
        if (!placeKind(place, activeKinds)) continue
        const key = `${place.type}:${place.id}`
        const previous = unique.get(key)
        if (!previous || previous.downloadedAt < entry.downloadedAt) unique.set(key, { place, downloadedAt: entry.downloadedAt })
      }
    }
    for (const { place } of unique.values()) {
      const kind = placeKind(place, activeKinds)
      if (!kind) continue
      const longitude = place.longitude + 360 * Math.round((map.getCenter().lng - place.longitude) / 360)
      if (!map.getBounds().contains([place.latitude, longitude])) continue
      const icon = getPoiIcon(kind.icon)
      const title = place.tags.name ? `${icon.label}: ${place.tags.name}` : icon.label
      const marker = L.marker([place.latitude, longitude], {
        title, alt: title, keyboard: true,
        icon: L.divIcon({
          className: 'osm-place-marker-wrapper',
          html: `<span class="osm-place-marker">${poiIconSvg(icon)}</span>`,
          iconSize: [26, 26], iconAnchor: [13, 13],
        }),
      }).addTo(markers)
      const markerElement = marker.getElement()
      const isSelected = selectedMarkerKey.current === `${place.type}:${place.id}`
      marker.setZIndexOffset(isSelected ? 1000 : 0)
      markerElement?.classList.toggle('osm-place-marker-selected', isSelected)
      markerElement?.setAttribute('aria-pressed', String(isSelected))
      if (isSelected) selectedMarker.current = marker
      marker.on('click', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event)
        onPlaceSelected()
        const previous = selectedMarker.current
        previous?.getElement()?.classList.remove('osm-place-marker-selected')
        previous?.getElement()?.setAttribute('aria-pressed', 'false')
        previous?.setZIndexOffset(0)
        selectedMarker.current = marker
        selectedMarkerKey.current = `${place.type}:${place.id}`
        marker.setZIndexOffset(1000)
        marker.getElement()?.focus()
        marker.getElement()?.classList.add('osm-place-marker-selected')
        marker.getElement()?.setAttribute('aria-pressed', 'true')
        const markerBounds = marker.getElement()?.getBoundingClientRect()
        const bounds = map.getContainer().getBoundingClientRect()
        setSelectedPlace({
          place,
          anchor: {
            x: markerBounds ? markerBounds.left + markerBounds.width / 2 : event.originalEvent.clientX,
            y: markerBounds ? markerBounds.top + markerBounds.height / 2 : event.originalEvent.clientY,
            bounds,
          },
        })
      })
    }
    return () => { markers.remove() }
  }, [map, activeKinds, viewport, entries, onPlaceSelected])

  const toggleKind = useCallback((kind: PlaceKindId, selected: boolean) => {
    if (!selected) {
      if (activeKinds.includes(kind)) abortPlaces(activeRequest.current, 'category-change')
      if (activeKinds.length === 1 && activeKinds[0] === kind) {
        setEntries(new Map())
        setProgress(null)
        setNeedsRetry(false)
        setLoading(false)
        setError('')
      }
      setActiveKinds((current) => current.includes(kind) ? current.filter((id) => id !== kind) : current)
    }
    setSelectedKinds((current) => PLACE_KINDS.map((item) => item.id)
      .filter((id) => id === kind ? selected : current.includes(id)))
  }, [activeKinds])

  const toggleCategory = useCallback((category: PlaceCategory, selected: boolean) => {
    if (!selected) {
      if (PLACE_KINDS.some((kind) => kind.category === category && activeKinds.includes(kind.id))) {
        abortPlaces(activeRequest.current, 'category-change')
        if (activeKinds.every((id) => PLACE_KINDS.some((kind) => kind.id === id && kind.category === category))) {
          setEntries(new Map())
          setProgress(null)
          setNeedsRetry(false)
          setLoading(false)
          setError('')
        }
      }
      setActiveKinds((current) => {
        const remaining = current.filter((id) => !PLACE_KINDS.some((kind) => kind.id === id && kind.category === category))
        return remaining.length === current.length ? current : remaining
      })
    }
    setSelectedKinds((current) => PLACE_KINDS.filter((kind) =>
      kind.category === category ? selected : current.includes(kind.id)).map((kind) => kind.id))
  }, [activeKinds])

  const load = useCallback(() => {
    if (!viewport || moving || clearingRef.current) return
    abortPlaces(activeRequest.current, 'manual-refresh')
    nextForce.current = false
    setActiveKinds(selectedKinds)
  }, [selectedKinds, viewport, moving])

  const reload = useCallback((force: boolean) => {
    if (!viewport || moving || !activeKinds.length || clearingRef.current) return
    abortPlaces(activeRequest.current, 'manual-refresh')
    nextForce.current = force
    setReloadSequence((current) => current + 1)
  }, [viewport, moving, activeKinds])

  const clear = useCallback(async () => {
    if (clearingRef.current) return
    clearingRef.current = true
    setClearing(true)
    abortPlaces(activeRequest.current, 'cache-clear')
    setLoading(false)
    setError('')
    setProgress({ available: 0, total: 0, pending: 0, stale: 0,
      message: 'Orte-Cache wird gelöscht …' })
    const startedAt = new Date().toISOString()
    const start = performance.now()
    let errorName: string | null = null
    let outcome: PlacesDiagnostic['outcome'] = 'success'
    try {
      await placesCache.clear()
      if (mounted.current) {
        setEntries(new Map())
        setNeedsRetry(true)
        setProgress({ available: 0, total: 0, pending: 0, stale: 0,
          message: 'Orte-Cache gelöscht.' })
      }
    } catch (reason) {
      outcome = 'cache-error'
      errorName = diagnosticErrorName(reason)
      if (mounted.current) {
        setNeedsRetry(true)
        setProgress(null)
        setError(`Orte-Cache konnte nicht gelöscht werden: ${reason instanceof Error ? reason.message : String(reason)}. Bitte Speicherzugriff prüfen und erneut versuchen.`)
      }
    } finally {
      clearingRef.current = false
      if (mounted.current) setClearing(false)
      recordDiagnostic({ startedAt, durationMs: Math.round(performance.now() - start), provider: null, phase: 'cache-clear',
        httpStatus: null, outcome, detail: null, abortReason: null, errorName, kindCount: 0,
        itemCount: null, responseBytes: null, splitDepth: null, retryAfterMs: null })
    }
  }, [recordDiagnostic])

  const closePlaceDetails = useCallback(() => {
    selectedMarker.current?.getElement()?.classList.remove('osm-place-marker-selected')
    selectedMarker.current?.getElement()?.setAttribute('aria-pressed', 'false')
    selectedMarker.current?.setZIndexOffset(0)
    selectedMarker.current = null
    selectedMarkerKey.current = null
    setSelectedPlace(null)
  }, [])

  const needsLoad = selectedKinds.some((kind) => !activeKinds.includes(kind))
  const canLoad = Boolean(needsLoad && viewport && !moving && !clearing)
  const canRefresh = Boolean(!loading && !moving && !clearing && activeKinds.length && viewport)
  return {
    selectedPlace, selectedKinds, activeKinds, progress, error, clearing, needsLoad, canLoad, canRefresh, needsRetry,
    diagnosticsEnabled, diagnostics,
    toggleKind, toggleCategory,
    load,
    refresh: () => reload(true),
    retry: () => reload(lastForce.current),
    clear,
    closePlaceDetails,
  }
}
