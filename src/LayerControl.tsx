import { useEffect, useRef, useState } from 'react'
import { ExternalLink } from './ExternalLink'
import { layers, overlayLayers } from './mapLayers'
import { TileCacheControl } from './TileCacheControl'
import type { ProjectFile } from './routeModel'

export function LayerControl({ layerId, overlayIds, disabled, changeLayer, toggleOverlay, retryLayer, project, mapZoom }: {
  layerId: string
  overlayIds: string[]
  disabled: boolean
  changeLayer: (id: string) => void
  toggleOverlay: (id: string, enabled: boolean) => void
  retryLayer: (id: string) => void
  project: ProjectFile
  mapZoom: number
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  function closePanel() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div
      className="map-layer-control"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          closePanel()
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`map-tool-button ${open && !disabled ? 'active' : ''}`}
        aria-label="Kartenlayer auswählen"
        aria-expanded={open && !disabled}
        aria-controls="map-layer-panel"
        data-tooltip="Kartenlayer"
        title="Kartenlayer"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 20 20" className="map-tool-icon" aria-hidden="true">
          <path d="m2 6 8-4 8 4-8 4-8-4ZM2 10l8 4 8-4M2 14l8 4 8-4" />
        </svg>
      </button>
      {open && !disabled && (
        <section id="map-layer-panel" className="map-layer-panel" aria-label="Kartenlayer">
          <div className="map-layer-panel-header">
            <strong>Kartenlayer</strong>
            <button type="button" className="map-layer-close" aria-label="Kartenlayer schließen"
              title="Schließen" onClick={closePanel}>×</button>
          </div>
          <fieldset>
            <legend>Basiskarte</legend>
            {layers.map((layer) => (
              <div className="map-layer-option" key={layer.id}>
                <label>
                  <input type="radio" name="base-map" value={layer.id}
                    checked={layer.id === layerId} disabled={layer.requiresKey}
                    onChange={() => changeLayer(layer.id)} />
                  {layer.label}{layer.requiresKey ? ' · API-Key erforderlich' : ''}
                </label>
                <ExternalLink url={layer.attributionUrl} title={`Attribution und Bedingungen: ${layer.label}`}>©</ExternalLink>
              </div>
            ))}
          </fieldset>
          <fieldset>
            <legend>Kartenebenen</legend>
            {overlayLayers.map((layer) => (
              <div className="map-layer-option" key={layer.id}>
                <label>
                  <input type="checkbox" checked={overlayIds.includes(layer.id)}
                    disabled={layer.requiresKey}
                    onChange={(event) => toggleOverlay(layer.id, event.target.checked)} />
                  {layer.label}{layer.requiresKey ? ' · API-Key erforderlich' : ''}
                </label>
                <ExternalLink url={layer.attributionUrl} title={`Attribution und Bedingungen: ${layer.provider} – ${layer.label}`}>©</ExternalLink>
              </div>
            ))}
          </fieldset>
          <TileCacheControl layerIds={[layerId, ...overlayIds]} retry={retryLayer} project={project} mapZoom={mapZoom} />
        </section>
      )}
    </div>
  )
}
