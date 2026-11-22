import { createPortal } from 'react-dom'
import { useState } from 'react'
import { useModalFocus } from '../shared/useModalFocus'
import { TileCacheControl } from '../map/cache/TileCacheControl'
import type { ProjectFile } from '../../domain/routeModel'
import './CacheDialog.css'

export function CacheDialog({ onClose, layerIds, retry, project, mapZoom, diagnosticsEnabled, reportProblem }: {
  onClose: () => void
  layerIds: string[]
  retry: (id: string) => void
  project: ProjectFile
  mapZoom: number
  diagnosticsEnabled: boolean
  reportProblem: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const closeWhenIdle = () => { if (!busy) onClose() }
  const { dialogRef, onKeyDown } = useModalFocus<HTMLDivElement>(closeWhenIdle)

  return createPortal(
    <div className="cache-backdrop">
      <div ref={dialogRef} className="cache-dialog" role="dialog" aria-modal="true"
        aria-labelledby="cache-title" tabIndex={-1} onKeyDown={onKeyDown}>
        <header className="cache-dialog-header">
          <div>
            <h2 id="cache-title">Cache verwalten</h2>
            <p>Lokale Daten und Speicherplatz</p>
          </div>
          <button type="button" className="icon-button cache-dialog-close" onClick={closeWhenIdle} disabled={busy} aria-label="Schließen">×</button>
        </header>
        <div className="cache-dialog-body">
          <TileCacheControl layerIds={layerIds} retry={retry} project={project} mapZoom={mapZoom}
            diagnosticsEnabled={diagnosticsEnabled} reportProblem={reportProblem} onBusyChange={setBusy} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
