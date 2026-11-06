import { useEffect, useRef, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { TileCacheControl } from './TileCacheControl'
import type { ProjectFile } from './routeModel'
import './CacheDialog.css'

export function CacheDialog({ onClose, layerIds, retry, project, mapZoom, diagnosticsEnabled }: {
  onClose: () => void
  layerIds: string[]
  retry: (id: string) => void
  project: ProjectFile
  mapZoom: number
  diagnosticsEnabled: boolean
}) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement) setTimeout(() => previous.focus(), 0)
    }
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const controls = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return createPortal(
    <div className="cache-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} className="cache-dialog" role="dialog" aria-modal="true"
        aria-labelledby="cache-title" tabIndex={-1} onKeyDown={handleKeyDown}>
        <header className="cache-dialog-header">
          <div>
            <h2 id="cache-title">Cache verwalten</h2>
            <p>Lokale Daten und Speicherplatz</p>
          </div>
          <button type="button" className="icon-button cache-dialog-close" onClick={onClose} aria-label="Schließen">×</button>
        </header>
        <div className="cache-dialog-body">
          <TileCacheControl layerIds={layerIds} retry={retry} project={project} mapZoom={mapZoom}
            diagnosticsEnabled={diagnosticsEnabled} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
