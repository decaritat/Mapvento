import { useState, type ChangeEvent } from 'react'
import { tileDiagnostics, parseTileLog, summarizeTileLog, type TileDiagnosticLog } from '../../../integrations/map/tileDiagnostics'
import { saveTextFile } from '../../../features/project-files/projectFileAdapter'

function Summary({ log, title }: { log: TileDiagnosticLog; title: string }) {
  const summary = summarizeTileLog(log)
  const layerZooms = [...new Set(log.events.map((event) => `${event.layer}: ${event.zoom}`))].sort()
  return (
    <div className="diagnostic-summary">
      <strong>{title}: {log.environment === 'desktop' ? 'Desktop' : 'Browser'} · {log.appVersion}</strong>
      <span>{log.startedAt} – {log.stoppedAt}</span>
      <span>{summary.count} abgeschlossene Kachelladevorgänge · {summary.hits} Treffer · {summary.misses} nicht im Cache · {summary.stale} veraltet</span>
      <span>{summary.requests} Fetch-Aufrufe · {summary.errors} Fehler · {summary.aborted} abgebrochen · {summary.evicted} verdrängt</span>
      <span>Davon {summary.storageErrors} Cache-Speicherfehler · {summary.httpErrors} HTTP-Fehlerantworten</span>
      {summary.hasTouchAttempts && <span>{summary.touchAttempts} Zugriffsaktualisierungen bei {summary.hits} Cache-Treffern</span>}
      <span>Ø IndexedDB in ms: Öffnen {summary.openMs.toFixed(1)} · Lesen {summary.readMs.toFixed(1)} · Treffer aktualisieren {summary.touchMs.toFixed(1)} · Schreiben {summary.writeMs.toFixed(1)}</span>
      <span>Ø Fetch {summary.fetchMs.toFixed(1)} ms · Antwortinhalt {summary.bodyMs.toFixed(1)} ms</span>
      <span>Layer und Zoom: {layerZooms.join(', ') || 'keine'}</span>
      {(log.incomplete > 0 || log.dropped > 0) && <span>Unvollständig beim Stoppen: {log.incomplete} · wegen Limit nicht gespeichert: {log.dropped}</span>}
    </div>
  )
}

export function TileDiagnosticsControl() {
  const [recording, setRecording] = useState(tileDiagnostics.isRecording())
  const [current, setCurrent] = useState<TileDiagnosticLog | null>(tileDiagnostics.lastLog())
  const [reference, setReference] = useState<TileDiagnosticLog | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function importLog(event: ChangeEvent<HTMLInputElement>, target: 'current' | 'reference') {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Datei ist größer als 20 MiB')
      const log = parseTileLog(await file.text())
      if (target === 'current') setCurrent(log)
      else setReference(log)
      setError('')
    } catch (reason) {
      setError(`Diagnosedatei konnte nicht gelesen werden: ${String(reason)}`)
    }
  }

  async function exportLog() {
    if (!current) return
    try {
      const stamp = current.startedAt.replaceAll(/[^a-zA-Z0-9-]/g, '-')
      await saveTextFile(`mapvento-cache-${current.environment}-${stamp}.json`, JSON.stringify(current, null, 2), 'application/json')
      setNotice('Diagnosedatei gespeichert.')
      setError('')
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') {
        setNotice('Speichern abgebrochen.')
      } else {
        setError(`Diagnosedatei konnte nicht gespeichert werden: ${String(reason)}`)
      }
    }
  }

  return (
    <section className="tile-diagnostics" aria-labelledby="diagnostic-title">
      <h3 id="diagnostic-title">Cache-Diagnose</h3>
      <p className="cache-hint">Nur auf Wunsch und bis zum Schließen der Anwendung im Arbeitsspeicher. Enthält Layer, Zoomstufe, Zeitpunkte und Messwerte, aber keine Kartenkoordinaten, URLs oder Projektdaten. Eine neue Messung ersetzt die letzte.</p>
      <p className="cache-hint">Fetch-Aufrufe können aus dem HTTP-Cache kommen; echte Netzwerkzugriffe sind hier nicht unterscheidbar. Bei nicht verfügbarem IndexedDB wird die direkte Bildladung nicht erfasst.</p>
      <div className="cache-actions">
        <button type="button" disabled={recording} onClick={() => {
          tileDiagnostics.start()
          setCurrent(null)
          setRecording(true)
          setError('')
          setNotice('')
        }}>Messung starten</button>
        <button type="button" disabled={!recording} onClick={() => {
          setCurrent(tileDiagnostics.stop())
          setRecording(false)
          setNotice('')
        }}>Messung stoppen</button>
        <button type="button" disabled={recording || !current} onClick={() => void exportLog()}>Diagnose speichern</button>
      </div>
      <p role="status">{recording ? 'Messung läuft. Dialog schließen und Karte bewegen.' : notice || 'Messung nicht aktiv.'}</p>
      {error && <p className="cache-error" role="alert">{error}</p>}
      <div className="diagnostic-imports">
        <label>Messung laden <input type="file" accept=".json,application/json" disabled={recording} onChange={(event) => void importLog(event, 'current')} /></label>
        <label>Vergleichsmessung laden <input type="file" accept=".json,application/json" onChange={(event) => void importLog(event, 'reference')} /></label>
      </div>
      {current && <Summary log={current} title="Messung" />}
      {reference && <Summary log={reference} title="Vergleich" />}
    </section>
  )
}
