import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { getPoiIcon, poiIconSvg } from '../../integrations/map/poiIcons'
import { cellsForBounds, PLACES_ZOOM, type PlaceCell } from './placeCells'
import { loadPlaces, type PlacesProgress } from './loadPlaces'
import { PLACE_CATEGORIES, placeKind, type Bounds, type Place, type PlaceCategory, type PlacesDiagnostic } from './places'
import { placesCache, type CachedPlaces } from './placesCache'
import { abortPlaces, diagnosticErrorName } from './placesDiagnostics'

export type PlacesControlState = {
  enabled: boolean
  categories: PlaceCategory[]
  progress: PlacesProgress | null
  error: string
  canRefresh: boolean
  diagnosticsEnabled: boolean
  diagnostics: PlacesDiagnostic[]
  setEnabled: (enabled: boolean) => void
  toggleCategory: (category: PlaceCategory, enabled: boolean) => void
  refresh: () => void
  clear: () => Promise<void>
}

type Viewport = { bounds: Bounds; zoom: number; sequence: number }

export function useOsmPlaces(map: L.Map | null, diagnosticsEnabled = false): PlacesControlState {
  const [enabled, setEnabled] = useState(false)
  const [categories, setCategories] = useState<PlaceCategory[]>([])
  const [viewport, setViewport] = useState<Viewport | null>(null)
  const [entries, setEntries] = useState<ReadonlyMap<string, CachedPlaces>>(new Map())
  const [progress, setProgress] = useState<PlacesProgress | null>(null)
  const [error, setError] = useState('')
  const [diagnostics, setDiagnostics] = useState<PlacesDiagnostic[]>([])
  const diagnosticsEnabledRef = useRef(diagnosticsEnabled)
  const mounted = useRef(false)
  const [refreshSequence, setRefreshSequence] = useState(0)
  const handledRefresh = useRef(0)
  const activeRequest = useRef<AbortController | null>(null)
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
  const viewportIssue = useMemo(() => {
    if (!enabled || !viewport) return ''
    if (viewport.zoom < PLACES_ZOOM) {
      return `Zum Laden der Orte bitte mindestens auf Zoomstufe ${PLACES_ZOOM} hineinzoomen.`
    }
    try {
      cellsForBounds(viewport.bounds)
      return ''
    } catch (reason) {
      return reason instanceof Error ? reason.message : String(reason)
    }
  }, [enabled, viewport])

  useEffect(() => {
    if (!map) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const moving = () => {
      abortPlaces(activeRequest.current, 'map-movement')
      if (timer) clearTimeout(timer)
    }
    const moved = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const bounds = map.getBounds()
        setViewport((current) => ({
          bounds: { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() },
          zoom: map.getZoom(), sequence: (current?.sequence ?? 0) + 1,
        }))
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
    abortPlaces(activeRequest.current, 'viewport-update')
    if (!enabled || !viewport || !categories.length || viewportIssue) return
    const cells: PlaceCell[] = cellsForBounds(viewport.bounds)
    const controller = new AbortController()
    activeRequest.current = controller
    const force = handledRefresh.current !== refreshSequence
    handledRefresh.current = refreshSequence
    void loadPlaces({
      cells, categories, force, cache: placesCache, signal: controller.signal,
      onDiagnostic: recordDiagnostic,
      collectDiagnosticDetails: () => diagnosticsEnabledRef.current,
      onUpdate: (next, status) => {
        if (controller.signal.aborted) return
        setError('')
        setEntries(next)
        setProgress(status)
      },
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setError(`Orte konnten nicht geladen werden: ${reason instanceof Error ? reason.message : String(reason)}`)
        setProgress((current) => current && { ...current, message: `${current.message} Laden angehalten; erneuter Versuch möglich.` })
      }
    }).finally(() => {
      if (activeRequest.current === controller) activeRequest.current = null
    })
    return () => abortPlaces(controller, 'effect-cleanup')
  }, [enabled, viewport, categories, refreshSequence, viewportIssue, recordDiagnostic])

  useEffect(() => {
    if (!map || !enabled || !viewport || viewport.zoom < PLACES_ZOOM) return
    const markers = L.layerGroup().addTo(map)
    const unique = new Map<string, { place: Place; downloadedAt: number }>()
    for (const entry of entries.values()) {
      for (const place of entry.places) {
        if (!placeKind(place, categories)) continue
        const key = `${place.type}:${place.id}`
        const previous = unique.get(key)
        if (!previous || previous.downloadedAt < entry.downloadedAt) unique.set(key, { place, downloadedAt: entry.downloadedAt })
      }
    }
    for (const { place } of unique.values()) {
      const kind = placeKind(place, categories)
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
      marker.on('click', (event: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(event))
    }
    return () => { markers.remove() }
  }, [map, enabled, viewport, categories, entries])

  const toggleCategory = useCallback((category: PlaceCategory, selected: boolean) => {
    abortPlaces(activeRequest.current, 'category-change')
    setCategories((current) => selected
      ? PLACE_CATEGORIES.map((item) => item.id).filter((id) => id === category || current.includes(id))
      : current.filter((id) => id !== category))
  }, [])

  const clear = useCallback(async () => {
    abortPlaces(activeRequest.current, 'cache-clear')
    const startedAt = new Date().toISOString()
    const start = performance.now()
    let errorName: string | null = null
    let outcome: PlacesDiagnostic['outcome'] = 'success'
    try {
      await placesCache.clear()
      setEntries(new Map())
      setError('')
      setProgress({ available: 0, total: 0, pending: 0, stale: 0,
        message: 'Orte-Cache gelöscht. Zum erneuten Laden „Sichtbare Orte aktualisieren“ wählen.' })
    } catch (reason) {
      outcome = 'cache-error'
      errorName = diagnosticErrorName(reason)
      setError(`Orte-Cache konnte nicht gelöscht werden: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      recordDiagnostic({ startedAt, durationMs: Math.round(performance.now() - start), provider: null, phase: 'cache-clear',
        httpStatus: null, outcome, detail: null, abortReason: null, errorName, categoryCount: 0,
        itemCount: null, responseBytes: null, splitDepth: null, retryAfterMs: null })
    }
  }, [recordDiagnostic])

  const canRefresh = Boolean(enabled && categories.length && viewport && viewport.zoom >= PLACES_ZOOM)
  const visibleError = enabled ? viewportIssue || (categories.length ? error : '') : ''
  const visibleProgress = categories.length && !viewportIssue ? progress : null
  return {
    enabled, categories, progress: visibleProgress, error: visibleError, canRefresh, diagnosticsEnabled, diagnostics,
    setEnabled: (value) => { abortPlaces(activeRequest.current, 'visibility-change'); setEnabled(value) },
    toggleCategory,
    refresh: () => { abortPlaces(activeRequest.current, 'manual-refresh'); setRefreshSequence((value) => value + 1) },
    clear,
  }
}
