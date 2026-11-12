import { useCallback, useEffect, useRef } from 'react'
import L from 'leaflet'
import type { Dispatch, SetStateAction } from 'react'
import type { ErrorBanner } from './appTypes'
import { CachedTileLayer } from './cachedTileLayer'
import { layers, overlayLayers, type LayerDefinition } from './mapLayers'

type Props = {
  map: L.Map | null
  layerId: string
  overlayIds: string[]
  retry: { layerId: string; sequence: number } | null
  setErrorBanner: Dispatch<SetStateAction<ErrorBanner | null>>
  setCacheWarning: Dispatch<SetStateAction<string>>
}

export function useMapTileLayers({
  map,
  layerId,
  overlayIds,
  retry,
  setErrorBanner,
  setCacheWarning,
}: Props) {
  const tileLayersRef = useRef(new Map<string, { layer: L.TileLayer; dispose: () => void }>())
  const failedTileLayersRef = useRef(new Map<string, LayerDefinition>())
  const lastRetryRef = useRef(0)
  const overlayKey = overlayIds.join(',')

  const disposeAll = useCallback(() => {
    tileLayersRef.current.forEach(({ dispose }) => dispose())
    tileLayersRef.current.clear()
    failedTileLayersRef.current.clear()
  }, [])

  useEffect(() => disposeAll, [disposeAll, map])

  useEffect(() => {
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
    const retryId = retry && retry.sequence !== lastRetryRef.current
      ? retry.layerId
      : null
    if (retry) lastRetryRef.current = retry.sequence

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
  }, [layerId, overlayKey, map, retry, setErrorBanner, setCacheWarning])

  return disposeAll
}
