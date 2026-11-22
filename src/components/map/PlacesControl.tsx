import { useLayoutEffect, useRef, useState } from 'react'
import { PLACE_CATEGORIES, PLACE_KINDS } from '../../features/osm-places/places'
import { DRESEL_EUROPE, PRIVATE_COFFEE } from '../../features/osm-places/placesProviders'
import type { PlacesControlState } from '../../features/osm-places/useOsmPlaces'
import { OSM_COPYRIGHT_URL } from '../../domain/mapLayers'
import { ExternalLink } from '../shared/ExternalLink'
import { saveTextFile } from '../../features/project-files/projectFileAdapter'
import { isTauri } from '@tauri-apps/api/core'
import { version } from '../../../package.json'
import { formatAppVersion } from '../../integrations/desktop/appVersion'
import type { PlacesDiagnostic } from '../../features/osm-places/placesDiagnostics'
import type { Place } from '../../features/osm-places/places'
import { getPoiIcon, poiIconSvg } from '../../integrations/map/poiIcons'
import { OsmPlaceDetails } from './OsmPlaceDetails'
import { formatNumber } from '../../domain/numberFormat'

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
    `${formatNumber(event.durationMs)} ms`,
  ].filter(Boolean).join(', ')
}

export function PlacesControl({ places, disabled, open, onToggle, onClose, onCreatePoi }: {
  places: PlacesControlState
  disabled: boolean
  open: boolean
  onToggle: () => void
  onClose: (restoreFocus: boolean) => void
  onCreatePoi: (place: Place, clientX: number, clientY: number) => boolean
}) {
  const [diagnosticMessage, setDiagnosticMessage] = useState('')
  const [clearMessage, setClearMessage] = useState('')
  const panel = useRef<HTMLElement>(null)
  const [panelMaxHeight, setPanelMaxHeight] = useState<number>()

  useLayoutEffect(() => {
    if (!open || disabled) return
    const element = panel.current
    const mapPanel = element?.closest('.map-panel')
    if (!element || !mapPanel) return
    const resize = () => {
      const bounds = mapPanel.getBoundingClientRect()
      if (bounds.height > 0) setPanelMaxHeight(Math.max(0, Math.min(window.innerHeight, bounds.bottom) - element.getBoundingClientRect().top - 8))
    }
    resize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(mapPanel)
    window.addEventListener('resize', resize)
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize) }
  }, [open, disabled])

  const status = [
    places.progress && [
      places.progress.message,
      places.progress.total > 0
        ? `${formatNumber(places.progress.available)}/${formatNumber(places.progress.total)} Zell-Typen verfügbar, ${formatNumber(places.progress.pending)} ausstehend${places.progress.stale ? `, ${formatNumber(places.progress.stale)} veraltet` : ''}.`
        : '',
    ].filter(Boolean).join(' '),
    places.needsLoad ? 'Neue Ortstypen mit dem Symbol laden.' : '',
  ].filter(Boolean).join(' ')

  async function saveDiagnostics() {
    try {
      await saveTextFile('mapvento-overpass-diagnose.json', JSON.stringify({
        format: 'mapvento-overpass-diagnostics', version: 4,
        appVersion: formatAppVersion(version, import.meta.env.VITE_APP_VERSION),
        environment: isTauri() ? 'desktop' : 'browser', events: places.diagnostics,
      }, null, 2), 'application/json')
      setDiagnosticMessage('Diagnose gespeichert.')
    } catch (reason) {
      setDiagnosticMessage(reason instanceof DOMException && reason.name === 'AbortError'
        ? 'Speichern abgebrochen.' : `Diagnose konnte nicht gespeichert werden: ${String(reason)}`)
    }
  }

  return <div className="osm-places-control" onKeyDown={(event) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      onClose(true)
    }
  }}>
    <button type="button" className={`map-tool-button ${open && !disabled ? 'active' : ''}`}
      aria-label="OSM-Orte und Filter" aria-expanded={open && !disabled} aria-controls="osm-places-panel"
      data-map-panel-trigger="places"
      title="OSM-Orte und Filter" data-tooltip="OSM-Orte" disabled={disabled}
      onClick={onToggle}>
      <svg viewBox="0 0 20 20" className="map-tool-icon" aria-hidden="true">
        <path d="M10 18s6-5.7 6-10a6 6 0 1 0-12 0c0 4.3 6 10 6 10Z" />
        <circle cx="10" cy="8" r="2" />
      </svg>
    </button>
    {open && !disabled && <section ref={panel} id="osm-places-panel" className="map-layer-panel osm-places-panel"
      aria-label="OSM-Orte" style={panelMaxHeight === undefined ? undefined : { maxHeight: panelMaxHeight }}>
      <div className="map-layer-panel-header">
        <strong>OSM-Orte</strong>
        <button type="button" className="map-layer-close" aria-label="OSM-Orte schließen"
          onClick={() => onClose(true)}>×</button>
      </div>
      {places.error && <p className="osm-places-panel-status" role="alert">{places.error}</p>}
      {clearMessage && <p className="osm-places-panel-status" role="status">{clearMessage}</p>}
      {(places.needsLoad || status) && <div className="osm-places-status-row">
        <p className="osm-places-panel-status" role="status">{status}</p>
        {places.needsLoad && <button type="button" className="osm-places-load"
          aria-label="Orte laden" title="Orte laden" disabled={!places.canLoad} onClick={places.load}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4" />
          </svg>
        </button>}
      </div>}
      <div className="osm-places-panel-content">
        {PLACE_CATEGORIES.map((category) => {
          const kinds = PLACE_KINDS.filter((kind) => kind.category === category.id)
          const allSelected = kinds.every((kind) => places.selectedKinds.includes(kind.id))
          return <fieldset key={category.id} disabled={places.clearing}>
            <legend><span className="osm-places-group-heading">
              <span>{category.label}</span>
              <button type="button" className="osm-places-select-all"
                aria-label={`${category.label}: ${allSelected ? 'alle abwählen' : 'alle auswählen'}`}
                disabled={places.clearing}
                onClick={() => places.toggleCategory(category.id, !allSelected)}>
                {allSelected ? 'Alle abwählen' : 'Alle auswählen'}
              </button>
            </span></legend>
            {kinds.map((kind) => <label className="osm-places-option" key={kind.id}>
              <span className="osm-places-kind-icon" dangerouslySetInnerHTML={{ __html: poiIconSvg(getPoiIcon(kind.icon)) }} />
              <span>{kind.label}</span>
              <input type="checkbox" checked={places.selectedKinds.includes(kind.id)}
                onChange={(event) => places.toggleKind(kind.id, event.target.checked)} />
            </label>)}
          </fieldset>
        })}
        {places.needsRetry && <button className="action-button" type="button" disabled={!places.canRefresh} onClick={places.retry}>Erneut versuchen</button>}
        {!places.needsRetry && places.activeKinds.length > 0 &&
          <button className="action-button" type="button" disabled={!places.canRefresh} onClick={places.refresh}>Bereich um Kartenmitte aktualisieren</button>}
        <button className="action-button danger" type="button" disabled={places.clearing} onClick={() => {
          if (window.confirm('Alle lokal gespeicherten OSM-Orte löschen? Sie müssen bei Bedarf erneut geladen werden und stehen offline nicht mehr zur Verfügung. Der Kachelcache bleibt unverändert.')) {
            setClearMessage('')
            void places.clear()
          } else setClearMessage('Löschen des Orte-Caches abgebrochen.')
        }}>Orte-Cache löschen</button>
        {places.diagnosticsEnabled && <section aria-label="Overpass-Diagnose">
          <h4>Overpass-Diagnose</h4>
          <p>Nur im Arbeitsspeicher, ohne Koordinaten, URLs oder Ortsdaten. Kartenereignisse können auch programmatisch ausgelöst werden.</p>
          <p role="status">{places.diagnostics.length
            ? places.diagnostics.slice(-3).map(describeDiagnostic).join(' · ')
            : 'Noch keine Diagnoseereignisse.'}</p>
          <button className="action-button" type="button" disabled={!places.diagnostics.length} onClick={() => void saveDiagnostics()}>Overpass-Diagnose speichern</button>
          {diagnosticMessage && <p role="status">{diagnosticMessage}</p>}
        </section>}
        <p className="osm-places-attribution">
          Daten © <ExternalLink url={OSM_COPYRIGHT_URL}>OpenStreetMap-Mitwirkende</ExternalLink>
          {' · '}<ExternalLink url={DRESEL_EUROPE.url}>Overpass von Dresel</ExternalLink>
          {' · '}<ExternalLink url={PRIVATE_COFFEE.url}>Overpass von Private.coffee</ExternalLink>
        </p>
      </div>
    </section>}
    <OsmPlaceDetails selection={places.selectedPlace} onClose={places.closePlaceDetails} onCreatePoi={onCreatePoi} />
  </div>
}
