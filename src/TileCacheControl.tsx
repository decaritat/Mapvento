import { useEffect, useRef, useState } from 'react'
import { layers, overlayLayers } from './mapLayers'
import { TILE_CACHE_LIMIT, tileCache, type TileCacheStats } from './tileCache'
import { projectCoverage } from './tileCoverage'
import type { ProjectFile } from './routeModel'

const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`

export function TileCacheControl({ layerIds, retry, project, mapZoom }: {
  layerIds: string[]
  retry: (id: string) => void
  project: ProjectFile
  mapZoom: number
}) {
  const [stats, setStats] = useState<TileCacheStats | null>(null)
  const [error, setError] = useState('')
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
          if (active && current === revision) { setStats(value); setError('') }
        }).catch((reason: unknown) => {
          if (active && current === revision) setError(`Kachelcache nicht verfügbar: ${String(reason)}`)
        })
      }, 100)
    }
    update()
    const unsubscribe = tileCache.subscribe(update)
    return () => { active = false; mounted.current = false; clearTimeout(timer); unsubscribe() }
  }, [])

  async function perform(action: () => Promise<void>) {
    setBusy(true)
    try { await action(); if (mounted.current) setError('') }
    catch (reason) { if (mounted.current) setError(`Kachelcache: ${String(reason)}`) }
    finally { if (mounted.current) setBusy(false) }
  }

  return (
    <fieldset className="tile-cache-control">
      <legend>Kachelcache</legend>
      {error && <p role="alert">{error}</p>}
      {stats && (
        <>
          <p>{formatSize(stats.bytes)} von {formatSize(TILE_CACHE_LIMIT)} · {stats.count} Kacheln</p>
          <p>Nur besuchte Ausschnitte; keine vollständige Gebietsabdeckung. Der Cache wird projektübergreifend geteilt.</p>
          {[...new Set([...layerIds, ...Object.keys(stats.layers)])].map((id) => {
            const definition = [...layers, ...overlayLayers].find((item) => item.id === id)
            if (!definition) return null
            const entry = stats.layers[id]
            const zoom = Math.min(mapZoom, definition.maxNativeZoom)
            const coverage = projectCoverage(project, zoom, entry?.tiles ?? [])
            return (
              <div className="tile-cache-provider" key={id}>
                <strong>{definition.provider} – {definition.label}{layerIds.includes(id) ? '' : ' (nicht aktiv)'}</strong>
                <span>{entry?.count ?? 0} Kacheln · {formatSize(entry?.bytes ?? 0)} · {entry?.stale ?? 0} veraltet
                  {entry?.zooms.length ? ` · Zoom ${[...entry.zooms].sort((a, b) => a - b).join(', ')}` : ''}</span>
                <span>{coverage
                  ? `Projekt-Rechteck bei Zoom ${zoom}: ${coverage.cached}/${coverage.total}, davon ${coverage.stale} veraltet`
                  : 'Projektabdeckung: keine Routen- oder Punktkoordinaten'}</span>
                <div>
                  <button type="button" disabled={busy || !entry?.count} onClick={() => void perform(async () => {
                    await tileCache.revalidate(id)
                    retry(id)
                  })}>Aktualisieren</button>
                  <button type="button" disabled={busy || !entry?.count} onClick={() => void perform(() => tileCache.clear(id))}>Löschen</button>
                </div>
              </div>
            )
          })}
          <button type="button" disabled={busy || !stats.count}
            onClick={() => void perform(() => tileCache.clear())}>Gesamten Kachelcache löschen</button>
        </>
      )}
    </fieldset>
  )
}
