import { useEffect, useRef, useState } from 'react'
import { layers, overlayLayers } from '../../../domain/mapLayers'
import { TILE_CACHE_LIMIT, tileCache, type TileCacheStats } from '../../../integrations/map/tileCache'
import { projectCoverage } from '../../../integrations/map/tileCoverage'
import type { ProjectFile } from '../../../domain/routeModel'
import { TileDiagnosticsControl } from './TileDiagnosticsControl'

const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`

export function TileCacheControl({ layerIds, retry, project, mapZoom, diagnosticsEnabled }: {
  layerIds: string[]
  retry: (id: string) => void
  project: ProjectFile
  mapZoom: number
  diagnosticsEnabled: boolean
}) {
  const [stats, setStats] = useState<TileCacheStats | null>(null)
  const [statsError, setStatsError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const mounted = useRef(false)

  useEffect(() => {
    let active = true
    let revision = 0
    mounted.current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      const current = ++revision
      clearTimeout(timer)
      timer = setTimeout(() => {
        tileCache.stats().then((value) => {
          if (active && current === revision) { setStats(value); setStatsError('') }
        }).catch((reason: unknown) => {
          if (active && current === revision) setStatsError(`Kachelcache nicht verfügbar: ${String(reason)}`)
        })
      }, 100)
    }
    update()
    const unsubscribe = tileCache.subscribe(update)
    return () => { active = false; mounted.current = false; clearTimeout(timer); unsubscribe() }
  }, [])

  async function perform(action: () => Promise<void>) {
    setBusy(true)
    try { await action(); if (mounted.current) setActionError('') }
    catch (reason) { if (mounted.current) setActionError(`Kachelcache: ${String(reason)}`) }
    finally { if (mounted.current) setBusy(false) }
  }

  const cachedLayers = [...new Set([...layerIds, ...Object.keys(stats?.layers ?? {})])].map((id) => ({
    id,
    definition: [...layers, ...overlayLayers].find((item) => item.id === id),
  }))
  const providers = [...new Set(cachedLayers.map(({ definition }) => definition?.provider ?? 'Unbekannter Anbieter'))]

  return (
    <section className="tile-cache-control" aria-labelledby="tile-cache-title">
      <h3 id="tile-cache-title">Kachelcache</h3>
      {statsError && <p className="cache-error" role="alert">{statsError}</p>}
      {actionError && <p className="cache-error" role="alert">{actionError}</p>}
      {!stats && !statsError && <p role="status">Cacheinformationen werden geladen …</p>}
      {stats && (
        <>
          <p className="cache-summary"><strong>{formatSize(stats.bytes)}</strong> von {formatSize(TILE_CACHE_LIMIT)} · {stats.count} Kacheln</p>
          <p className="cache-hint">Nur besuchte Ausschnitte; keine vollständige Gebietsabdeckung. Der Cache wird projektübergreifend geteilt.</p>
          {providers.map((provider) => (
            <section className="tile-cache-provider" key={provider} aria-label={provider}>
              <h4>{provider}</h4>
              {cachedLayers.filter(({ definition }) => (definition?.provider ?? 'Unbekannter Anbieter') === provider).map(({ id, definition }) => {
                const entry = stats.layers[id]
                const label = definition?.label ?? id
                const active = layerIds.includes(id)
                const zoom = Math.min(mapZoom, definition?.maxNativeZoom ?? mapZoom)
                const coverage = projectCoverage(project, zoom, entry?.tiles ?? [])
                return (
                  <div className="tile-cache-layer" key={id}>
                    <strong>{label} <span className={`cache-layer-state ${active ? 'active' : ''}`}>{active ? 'Aktiv' : 'Nicht aktiv'}</span></strong>
                    <span>{entry?.count ?? 0} Kacheln · {formatSize(entry?.bytes ?? 0)} · {entry?.stale ?? 0} veraltet
                      {entry?.zooms.length ? ` · Zoom ${[...entry.zooms].sort((a, b) => a - b).join(', ')}` : ' · Keine Zoomstufen'}</span>
                    {coverage && <span>Projekt-Rechteck bei Zoom {zoom}: {coverage.cached}/{coverage.total}, davon {coverage.stale} veraltet</span>}
                    <div className="cache-actions">
                      <button type="button" aria-label={`${label} aktualisieren`} disabled={busy || !entry?.count} onClick={() => void perform(async () => {
                        await tileCache.revalidate(id)
                        retry(id)
                      })}>Aktualisieren</button>
                      <button type="button" aria-label={`${label} löschen`} disabled={busy || !entry?.count}
                        onClick={() => void perform(() => tileCache.clear(id))}>Löschen</button>
                    </div>
                  </div>
                )
              })}
            </section>
          ))}
          <button className="cache-clear" type="button" disabled={busy || !stats.count}
            onClick={() => void perform(() => tileCache.clear())}>Gesamten Kachelcache löschen</button>
        </>
      )}
      {diagnosticsEnabled && <TileDiagnosticsControl />}
    </section>
  )
}
