import { useEffect, useRef, useState } from 'react'
import { PLACE_CATEGORIES, PLACES_PROVIDER } from '../../features/osm-places/places'
import type { PlacesControlState } from '../../features/osm-places/useOsmPlaces'
import { OSM_COPYRIGHT_URL } from '../../domain/mapLayers'
import { ExternalLink } from '../shared/ExternalLink'

export function PlacesControl({ places, disabled }: { places: PlacesControlState; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const status = [
    places.error,
    places.error && !places.progress
      ? ''
      : places.categories.length === 0
      ? 'Keine Kategorien ausgewählt.'
      : places.progress
      ? `${places.progress.message} ${places.progress.available}/${places.progress.total} Zell-Kategorien verfügbar, ${places.progress.pending} ausstehend${places.progress.stale ? `, ${places.progress.stale} veraltet` : ''}.`
      : 'Karte wird vorbereitet …',
  ].filter(Boolean).join(' ')

  return <div className="osm-places-control" ref={root} onKeyDown={(event) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
  }}>
    <button ref={button} type="button" className={`map-tool-button ${places.enabled ? 'active' : ''}`}
      aria-label="OSM-Orte und Filter" aria-expanded={open && !disabled} aria-controls="osm-places-panel"
      title="OSM-Orte und Filter" data-tooltip="OSM-Orte" disabled={disabled}
      onClick={() => setOpen((value) => !value)}>
      <svg viewBox="0 0 20 20" className="map-tool-icon" aria-hidden="true">
        <path d="M10 18s6-5.7 6-10a6 6 0 1 0-12 0c0 4.3 6 10 6 10Z" />
        <circle cx="10" cy="8" r="2" />
      </svg>
    </button>
    {open && !disabled && <section id="osm-places-panel" className="map-layer-panel osm-places-panel" aria-label="OSM-Orte">
      <div className="map-layer-panel-header">
        <strong>OSM-Orte</strong>
        <button type="button" className="map-layer-close" aria-label="OSM-Orte schließen"
          onClick={() => { setOpen(false); button.current?.focus() }}>×</button>
      </div>
      <label className="osm-places-option">
        <input type="checkbox" checked={places.enabled} onChange={(event) => places.setEnabled(event.target.checked)} />
        Orte auf der Karte anzeigen
      </label>
      <fieldset>
        <legend>Kategorien</legend>
        {PLACE_CATEGORIES.map((category) => <label className="osm-places-option" key={category.id}>
          <input type="checkbox" checked={places.categories.includes(category.id)}
            onChange={(event) => places.toggleCategory(category.id, event.target.checked)} />
          {category.label}
        </label>)}
      </fieldset>
      {(places.enabled || places.error) && <p className="osm-places-panel-status" role="status">{status}</p>}
      <button type="button" disabled={!places.canRefresh} onClick={places.refresh}>Sichtbare Orte aktualisieren</button>
      <button type="button" onClick={() => {
        if (window.confirm('Alle lokal gespeicherten OSM-Orte löschen?')) void places.clear()
      }}>Orte-Cache löschen</button>
      <p className="osm-places-attribution">
        Daten © <ExternalLink url={OSM_COPYRIGHT_URL}>OpenStreetMap-Mitwirkende</ExternalLink>
        {' · '}<ExternalLink url={PLACES_PROVIDER.url}>Overpass von Private.coffee</ExternalLink>
      </p>
      <p className="osm-places-attribution">Beim Laden wird der angezeigte Kartenausschnitt an Private.coffee übermittelt.</p>
    </section>}
    {places.enabled && !open && <div className="osm-places-status" role="status" aria-live="polite">
      <span>{status}</span>
      <ExternalLink url={OSM_COPYRIGHT_URL} title="OpenStreetMap Copyright und Lizenz">© OpenStreetMap</ExternalLink>
    </div>}
  </div>
}
