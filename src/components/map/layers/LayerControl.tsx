import { ExternalLink } from '../../shared/ExternalLink'
import { layers, overlayLayers } from '../../../domain/mapLayers'

export function LayerControl({ layerId, overlayIds, disabled, open, onToggle, onClose, changeLayer, toggleOverlay }: {
  layerId: string
  overlayIds: string[]
  disabled: boolean
  open: boolean
  onToggle: () => void
  onClose: (restoreFocus: boolean) => void
  changeLayer: (id: string) => void
  toggleOverlay: (id: string, enabled: boolean) => void
}) {
  function closePanel() {
    onClose(true)
  }

  return (
    <div
      className="map-layer-control"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          closePanel()
        }
      }}
    >
      <button
        type="button"
        className={`map-tool-button ${open && !disabled ? 'active' : ''}`}
        aria-label="Kartenlayer auswählen"
        aria-expanded={open && !disabled}
        aria-controls="map-layer-panel"
        data-map-panel-trigger="layers"
        data-tooltip="Kartenlayer"
        title="Kartenlayer"
        disabled={disabled}
        onClick={onToggle}
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
        </section>
      )}
    </div>
  )
}
