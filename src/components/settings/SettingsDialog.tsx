import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useModalFocus } from '../shared/useModalFocus'
import { layers, overlayLayers } from '../../domain/mapLayers'
import { DEFAULT_SETTINGS, durationFormats, durationInUnit, isDurationFormat, parseSettings, type Settings } from '../../domain/settings'
import { formatNumberInput, parseNumberInput } from '../../domain/numberFormat'
import './SettingsDialog.css'

type View = { latitude: number; longitude: number; zoom: number }

export function SettingsDialog({ settings, getMapView, onSave, onClose }: {
  settings: Settings
  getMapView: () => View | null
  onSave: (settings: Settings) => string | null
  onClose: () => void
}) {
  const [category, setCategory] = useState<'general' | 'start' | 'units' | 'developer'>('general')
  const [draft, setDraft] = useState(settings)
  const [latitude, setLatitude] = useState(formatNumberInput(settings.start.latitude))
  const [longitude, setLongitude] = useState(formatNumberInput(settings.start.longitude))
  const [zoom, setZoom] = useState(String(settings.start.zoom))
  const [error, setError] = useState('')
  const { dialogRef, onKeyDown } = useModalFocus<HTMLDivElement>(onClose)

  function setView(view: View) {
    setLatitude(formatNumberInput(view.latitude))
    setLongitude(formatNumberInput(view.longitude))
    setZoom(String(view.zoom))
  }

  function save(event: FormEvent) {
    event.preventDefault()
    try {
      if (!latitude.trim() || !longitude.trim() || !zoom.trim()) throw new Error('Bitte alle Werte für die Startposition eingeben.')
      const parsedLatitude = parseNumberInput(latitude)
      const parsedLongitude = parseNumberInput(longitude)
      if (parsedLatitude === null || parsedLongitude === null) throw new Error('Bitte gültige Dezimalzahlen für Breitengrad und Längengrad eingeben.')
      const next = parseSettings({ ...draft, start: { ...draft.start, latitude: parsedLatitude, longitude: parsedLongitude, zoom: Number(zoom) } })
      const saveError = onSave(next)
      if (saveError) { setError(saveError); return }
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ungültige Einstellungen.')
    }
  }

  return createPortal(
    <div className="settings-backdrop">
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={dialogRef} onKeyDown={onKeyDown}>
        <header><h2 id="settings-title">Einstellungen</h2><button type="button" className="icon-button" aria-label="Einstellungen schließen" onClick={onClose}>×</button></header>
        <form onSubmit={save}>
          <div className="settings-body">
            <nav aria-label="Einstellungskategorien">
              <button className="action-button" type="button" aria-current={category === 'general' ? 'page' : undefined} onClick={() => setCategory('general')}>Allgemein</button>
              <button className="action-button" type="button" aria-current={category === 'start' ? 'page' : undefined} onClick={() => setCategory('start')}>Start</button>
              <button className="action-button" type="button" aria-current={category === 'units' ? 'page' : undefined} onClick={() => setCategory('units')}>Einheiten</button>
              <button className="action-button" type="button" aria-current={category === 'developer' ? 'page' : undefined} onClick={() => setCategory('developer')}>Entwicklung</button>
            </nav>
            <section className="settings-fields">
              {category === 'general' ? <>
                <h3>Allgemein</h3>
                <p>Allgemeine Einstellungen für Mapvento.</p>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.general.checkForUpdates}
                    onChange={(event) => setDraft({
                      ...draft,
                      general: { ...draft.general, checkForUpdates: event.target.checked },
                    })}
                  />
                  Beim Programmstart nach Updates suchen
                </label>
              </> : category === 'start' ? <>
                <h3>Start</h3>
                <p>Diese Kartenansicht und Layer werden beim nächsten Programmstart verwendet.</p>
                <label>Basiskarte<select value={draft.start.layerId} onChange={(event) => setDraft({ ...draft, start: { ...draft.start, layerId: event.target.value } })}>
                  {layers.filter((layer) => !layer.requiresKey).map((layer) => <option key={layer.id} value={layer.id}>{layer.label}</option>)}
                </select></label>
                <div className="settings-overlay-row" role="group" aria-labelledby="settings-overlays-label">
                  <span id="settings-overlays-label">Overlays</span>
                  <div className="settings-overlays">{overlayLayers.filter((layer) => !layer.requiresKey).map((layer) =>
                  <label className="settings-checkbox" key={layer.id}><input type="checkbox" checked={draft.start.overlayIds.includes(layer.id)} onChange={(event) => setDraft({ ...draft, start: { ...draft.start, overlayIds: event.target.checked ? [...draft.start.overlayIds, layer.id] : draft.start.overlayIds.filter((id) => id !== layer.id) } })} />{layer.label}</label>
                  )}</div>
                </div>
                <div className="settings-position" role="group" aria-labelledby="settings-position-title">
                  <h4 id="settings-position-title">Kartenposition beim Start</h4>
                  <div className="settings-position-values">
                    <label>Breitengrad<input type="text" inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
                    <label>Längengrad<input type="text" inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
                    <label>Zoom<input type="number" step="1" min="0" max="19" value={zoom} onChange={(event) => setZoom(event.target.value)} /></label>
                  </div>
                  <button className="action-button" type="button" onClick={() => { const view = getMapView(); if (view) { setView(view); setError('') } else setError('Die Kartenansicht ist nicht verfügbar.') }}>Aktuelle Kartenposition übernehmen</button>
                </div>
              </> : category === 'units' ? <>
                <h3>Einheiten</h3>
                <p>Wähle die Anzeigeeinheiten für Karte, Höhenprofil und Routenstatistiken.</p>
                <label>Distanz<select value={draft.units.distance} onChange={(event) => setDraft({ ...draft, units: { ...draft.units, distance: event.target.value === 'mi' ? 'mi' : 'km' } })}><option value="km">Kilometer (km)</option><option value="mi">Meilen (mi)</option></select></label>
                <label>Höhe<select value={draft.units.elevation} onChange={(event) => setDraft({ ...draft, units: { ...draft.units, elevation: event.target.value === 'ft' ? 'ft' : 'm' } })}><option value="m">Meter (m)</option><option value="ft">Fuß (ft)</option></select></label>
                <label>Dauer<select value={draft.units.duration} onChange={(event) => {
                  const value = event.target.value
                  if (isDurationFormat(value)) setDraft({ ...draft, units: { ...draft.units, duration: value } })
                }}>{durationFormats.map((format) => <option key={format.value} value={format.value}>{format.label} ({durationInUnit(402, format.value)})</option>)}</select></label>
              </> : <>
                <h3>Entwicklung</h3>
                <p>Optionen für die Diagnose und Analyse der Anwendung.</p>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.developer.cacheDiagnostics}
                    onChange={(event) => setDraft({
                      ...draft,
                      developer: { ...draft.developer, cacheDiagnostics: event.target.checked },
                    })}
                  />
                  Cache-Diagnose
                </label>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.developer.placesDiagnostics}
                    onChange={(event) => setDraft({
                      ...draft,
                      developer: { ...draft.developer, placesDiagnostics: event.target.checked },
                    })}
                  />
                  Overpass-Diagnose
                </label>
                <p>Zeigt Anfrage-, Abbruch- und Cache-Status im OSM-Orte-Menü; keine Kartenkoordinaten, URLs oder Ortsdaten.</p>
              </>}
              <div className="settings-reset">
                <button className="action-button" type="button" onClick={() => {
                  if (category === 'start') { setDraft({ ...draft, start: DEFAULT_SETTINGS.start }); setView(DEFAULT_SETTINGS.start) }
                  else if (category === 'units') setDraft({ ...draft, units: DEFAULT_SETTINGS.units })
                  else if (category === 'developer') setDraft({ ...draft, developer: DEFAULT_SETTINGS.developer })
                  else setDraft({ ...draft, general: DEFAULT_SETTINGS.general })
                  setError('')
                }}>Standardeinstellungen wiederherstellen</button>
              </div>
            </section>
          </div>
          {error && <p className="settings-error" role="alert">{error}</p>}
          <footer><button className="action-button" type="button" onClick={onClose}>Abbrechen</button><button className="action-button primary" type="submit">Übernehmen</button></footer>
        </form>
      </div>
    </div>, document.body,
  )
}
