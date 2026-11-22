import { useEffect, useRef, useState } from 'react'
import { layers, overlayLayers } from '../../../domain/mapLayers'
import { TILE_CACHE_LIMIT, tileCache, type TileCacheStats } from '../../../integrations/map/tileCache'
import { projectCoverage } from '../../../integrations/map/tileCoverage'
import type { ProjectFile } from '../../../domain/routeModel'
import { TileDiagnosticsControl } from './TileDiagnosticsControl'
import { formatNumber } from '../../../domain/numberFormat'

const formatSize = (bytes: number) => `${formatNumber(bytes / 1024 / 1024, 1)} MiB`

export function TileCacheControl({ layerIds, retry, project, mapZoom, diagnosticsEnabled, reportProblem, onBusyChange }: {
  layerIds: string[]
  retry: (id: string) => void
  project: ProjectFile
  mapZoom: number
  diagnosticsEnabled: boolean
  reportProblem: (message: string) => void
  onBusyChange: (busy: boolean) => void
}) {
  const [stats, setStats] = useState<TileCacheStats | null>(null)
  const [statsError, setStatsError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionStatus, setActionStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const mounted = useRef(false)
  const busyRef = useRef(false)

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
          if (active && current === revision) {
            const message = `Kachelcache nicht verfügbar: ${String(reason)}. Bitte Speicherzugriff prüfen und den Dialog erneut öffnen.`
            setStatsError(message)
            reportProblem(message)
          }
        })
      }, 100)
    }
    update()
    const unsubscribe = tileCache.subscribe(update)
    return () => { active = false; mounted.current = false; clearTimeout(timer); unsubscribe() }
  }, [reportProblem])

  async function perform(action: () => Promise<void>, progress: string, success: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    onBusyChange(true)
    setActionError('')
    setActionStatus(progress)
    try { await action(); if (mounted.current) setActionStatus(success) }
    catch (reason) {
      const message = `Kachelcache: ${String(reason)}. Bitte Speicherzugriff prüfen und erneut versuchen.`
      reportProblem(message)
      if (mounted.current) {
        setActionStatus('')
        setActionError(message)
      }
    } finally {
      busyRef.current = false
      if (mounted.current) { setBusy(false); onBusyChange(false) }
    }
  }

  function confirmClear(id?: string, label?: string) {
    if (busyRef.current) return
    const target = id ? `die gespeicherten Kacheln für ${label}` : 'alle gespeicherten Kartenkacheln'
    if (!window.confirm(`Möchtest du ${target} aus dem Kachelcache löschen? Sie müssen bei Bedarf erneut geladen werden; offline stehen sie dann nicht mehr zur Verfügung. Der Orte-Cache bleibt unverändert.`)) {
      setActionStatus('Löschen des Kachelcaches abgebrochen.')
      return
    }
    void perform(() => id ? tileCache.clear(id) : tileCache.clear(), 'Kachelcache wird gelöscht …', 'Kachelcache gelöscht.')
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
      {actionStatus && <p role="status">{actionStatus}</p>}
      {!stats && !statsError && <p role="status">Cacheinformationen werden geladen …</p>}
      {stats && (
        <>
          <p className="cache-summary"><strong>{formatSize(stats.bytes)}</strong> von {formatSize(TILE_CACHE_LIMIT)} · {formatNumber(stats.count)} Kacheln</p>
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
                    <span>{formatNumber(entry?.count ?? 0)} Kacheln · {formatSize(entry?.bytes ?? 0)} · {formatNumber(entry?.stale ?? 0)} veraltet
                      {entry?.zooms.length ? ` · Zoom ${[...entry.zooms].sort((a, b) => a - b).join(', ')}` : ' · Keine Zoomstufen'}</span>
                    {coverage && <span>Projekt-Rechteck bei Zoom {zoom}: {formatNumber(coverage.cached)}/{formatNumber(coverage.total)}, davon {formatNumber(coverage.stale)} veraltet</span>}
                    <div className="cache-actions">
                      <button type="button" aria-label={`${label} aktualisieren`} disabled={busy || !entry?.count} onClick={() => void perform(async () => {
                        await tileCache.revalidate(id)
                        retry(id)
                      }, `${label} wird aktualisiert …`, `${label} zur Aktualisierung vorgemerkt.`)}>Aktualisieren</button>
                      <button className="danger" type="button" aria-label={`${label} löschen`} disabled={busy || !entry?.count}
                        onClick={() => confirmClear(id, label)}>Löschen</button>
                    </div>
                  </div>
                )
              })}
            </section>
          ))}
          <button className="cache-clear" type="button" disabled={busy || !stats.count}
            onClick={() => confirmClear()}>Gesamten Kachelcache löschen</button>
        </>
      )}
      {diagnosticsEnabled && <TileDiagnosticsControl />}
    </section>
  )
}
