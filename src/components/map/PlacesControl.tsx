import { useEffect, useRef, useState } from 'react'
import { PLACE_CATEGORIES } from '../../features/osm-places/places'
import { DRESEL_EUROPE, DRESEL_NORTH_AMERICA, PRIVATE_COFFEE } from '../../features/osm-places/placesProviders'
import type { PlacesControlState } from '../../features/osm-places/useOsmPlaces'
import { OSM_COPYRIGHT_URL } from '../../domain/mapLayers'
import { ExternalLink } from '../shared/ExternalLink'
import { saveTextFile } from '../../features/project-files/projectFileAdapter'
import { isTauri } from '@tauri-apps/api/core'
import { version } from '../../../package.json'
import { formatAppVersion } from '../../integrations/desktop/appVersion'
import type { PlacesDiagnostic } from '../../features/osm-places/placesDiagnostics'

const abortLabels: Record<NonNullable<PlacesDiagnostic['abortReason']>, string> = {
  'map-movement': 'Kartenbewegung oder Zoom',
  'viewport-update': 'Kartenausschnitt aktualisiert',
  'category-change': 'Kategorie geändert',
  'visibility-change': 'Orte-Anzeige geändert',
  'manual-refresh': 'Manuelle Aktualisierung',
  'cache-clear': 'Cache gelöscht',
  'effect-cleanup': 'Ladevorgang beendet oder neu gestartet',
  unknown: 'Unbekannter Auslöser',
}

const detailLabels: Record<NonNullable<PlacesDiagnostic['detail']>, string> = {
  'server-busy': 'Server meldet Überlastung',
  'query-timeout': 'Serverseitiges Abfrage-Zeitlimit',
  'out-of-memory': 'Serverseitiges Speicherlimit',
  'response-too-large': 'Antwort überschreitet Größenlimit',
  'invalid-json': 'Ungültiges JSON',
  'invalid-data': 'Ungültige Antwortdaten',
  'overpass-error': 'Overpass meldet einen Fehler',
  'network-or-cors': 'Netzwerk- oder CORS-Fehler (nicht unterscheidbar)',
  'body-unavailable': 'Antwortinhalt nicht lesbar',
  'invalid-request': 'Ungültige lokale Anfrage',
}

function describeDiagnostic(event: PlacesDiagnostic): string {
  return [
    `${event.startedAt}: ${event.provider ?? 'Cache'}, ${event.phase}, ${event.outcome}`,
    event.httpStatus === null ? '' : `HTTP ${event.httpStatus}`,
    event.abortReason ? abortLabels[event.abortReason] : '',
    event.detail ? detailLabels[event.detail] : '',
    `${event.durationMs} ms`,
  ].filter(Boolean).join(', ')
}

export function PlacesControl({ places, disabled }: { places: PlacesControlState; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [diagnosticMessage, setDiagnosticMessage] = useState('')
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

  async function saveDiagnostics() {
    try {
      await saveTextFile('mapvento-overpass-diagnose.json', JSON.stringify({
        format: 'mapvento-overpass-diagnostics', version: 3,
        appVersion: formatAppVersion(version, import.meta.env.VITE_APP_VERSION),
        environment: isTauri() ? 'desktop' : 'browser', events: places.diagnostics,
      }, null, 2), 'application/json')
      setDiagnosticMessage('Diagnose gespeichert.')
    } catch (reason) {
      setDiagnosticMessage(reason instanceof DOMException && reason.name === 'AbortError'
        ? 'Speichern abgebrochen.' : `Diagnose konnte nicht gespeichert werden: ${String(reason)}`)
    }
  }

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
      {places.diagnosticsEnabled && <section aria-label="Overpass-Diagnose">
        <h4>Overpass-Diagnose</h4>
        <p>Nur im Arbeitsspeicher, ohne Koordinaten, URLs oder Ortsdaten. Kartenereignisse können auch programmatisch ausgelöst werden.</p>
        <p role="status">{places.diagnostics.length
          ? places.diagnostics.slice(-3).map(describeDiagnostic).join(' · ')
          : 'Noch keine Diagnoseereignisse.'}</p>
        <button type="button" disabled={!places.diagnostics.length} onClick={() => void saveDiagnostics()}>Overpass-Diagnose speichern</button>
        {diagnosticMessage && <p role="status">{diagnosticMessage}</p>}
      </section>}
      <p className="osm-places-attribution">
        Daten © <ExternalLink url={OSM_COPYRIGHT_URL}>OpenStreetMap-Mitwirkende</ExternalLink>
        {' · '}<ExternalLink url={DRESEL_EUROPE.url}>Overpass von Dresel</ExternalLink>
        {' · '}<ExternalLink url={PRIVATE_COFFEE.url}>Overpass von Private.coffee</ExternalLink>
      </p>
      <p className="osm-places-attribution">Beim Laden wird der Kartenausschnitt an {DRESEL_EUROPE.name} oder {DRESEL_NORTH_AMERICA.name} und bei Ausfall oder außerhalb der Abdeckung an {PRIVATE_COFFEE.name} übermittelt.</p>
    </section>}
    {places.enabled && !open && <div className="osm-places-status" role="status" aria-live="polite">
      <span>{status}</span>
      <ExternalLink url={OSM_COPYRIGHT_URL} title="OpenStreetMap Copyright und Lizenz">© OpenStreetMap</ExternalLink>
    </div>}
  </div>
}
