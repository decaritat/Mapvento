import { isTauri } from '@tauri-apps/api/core'
import { version } from '../package.json'
import { formatAppVersion } from './appVersion'

export type TileDiagnosticEvent = {
  layer: string
  zoom: number
  cache: 'unknown' | 'hit' | 'miss' | 'stale'
  outcome: 'success' | 'error' | 'aborted'
  storageError: boolean
  fetchAttempted: boolean
  touchAttempted?: boolean
  httpStatus: number | null
  evicted: number
  totalMs: number
  openMs: number
  readMs: number
  touchMs: number
  writeMs: number
  fetchMs: number
  bodyMs: number
}

export type TileDiagnosticLog = {
  format: 'mapvento-tile-diagnostics'
  version: 1
  appVersion: string
  environment: 'desktop' | 'browser'
  startedAt: string
  stoppedAt: string
  incomplete: number
  dropped: number
  events: TileDiagnosticEvent[]
}

type Active = {
  startedAt: string
  environment: 'desktop' | 'browser'
  events: TileDiagnosticEvent[]
  pending: number
  dropped: number
}

const MAX_EVENTS = 20000

export class TileDiagnostics {
  private active: Active | null = null
  private last: TileDiagnosticLog | null = null

  start() {
    this.active = {
      startedAt: new Date().toISOString(),
      environment: isTauri() ? 'desktop' : 'browser',
      events: [], pending: 0, dropped: 0,
    }
    this.last = null
  }

  stop(): TileDiagnosticLog | null {
    if (!this.active) return this.last
    const { startedAt, environment, events, pending, dropped } = this.active
    this.last = {
      format: 'mapvento-tile-diagnostics', version: 1,
      appVersion: formatAppVersion(version, import.meta.env.VITE_APP_VERSION),
      environment, startedAt, stoppedAt: new Date().toISOString(),
      incomplete: pending, dropped, events,
    }
    this.active = null
    return this.last
  }

  clear() {
    this.active = null
    this.last = null
  }

  isRecording() { return this.active !== null }
  lastLog() { return this.last }

  begin(layer: string, zoom: number) {
    const session = this.active
    if (!session) return null
    session.pending++
    const started = performance.now()
    const event: TileDiagnosticEvent = {
      layer, zoom, cache: 'unknown', outcome: 'success', storageError: false,
      fetchAttempted: false, touchAttempted: false, httpStatus: null, evicted: 0,
      totalMs: 0, openMs: 0, readMs: 0, touchMs: 0, writeMs: 0, fetchMs: 0, bodyMs: 0,
    }
    return {
      event,
      finish: (error?: unknown) => {
        if (this.active !== session) return
        session.pending--
        event.totalMs = performance.now() - started
        if (error !== undefined) {
          event.outcome = error instanceof DOMException && error.name === 'AbortError' ? 'aborted' : 'error'
        }
        if (session.events.length < MAX_EVENTS) session.events.push(event)
        else session.dropped++
      },
    }
  }
}

export type TileDiagnosticHandle = NonNullable<ReturnType<TileDiagnostics['begin']>>
export type TileTiming = 'openMs' | 'readMs' | 'touchMs' | 'writeMs' | 'fetchMs' | 'bodyMs'

export function measureTile<T>(handle: TileDiagnosticHandle | null, field: TileTiming, action: () => Promise<T>): Promise<T> {
  if (!handle) return action()
  const start = performance.now()
  try {
    return action().finally(() => { handle.event[field] += performance.now() - start })
  } catch (error) {
    handle.event[field] += performance.now() - start
    throw error
  }
}

export function summarizeTileLog(log: TileDiagnosticLog) {
  const events = log.events
  const mean = (field: TileTiming) => {
    const measured = events.filter((event) => event[field] > 0)
    return measured.length ? measured.reduce((sum, event) => sum + event[field], 0) / measured.length : 0
  }
  return {
    count: events.length,
    hits: events.filter((event) => event.cache === 'hit').length,
    misses: events.filter((event) => event.cache === 'miss').length,
    stale: events.filter((event) => event.cache === 'stale').length,
    requests: events.filter((event) => event.fetchAttempted).length,
    touchAttempts: events.filter((event) => event.touchAttempted === true).length,
    hasTouchAttempts: events.some((event) => typeof event.touchAttempted === 'boolean'),
    errors: events.filter((event) => event.outcome === 'error').length,
    storageErrors: events.filter((event) => event.storageError).length,
    httpErrors: events.filter((event) => event.httpStatus !== null && event.httpStatus >= 400).length,
    aborted: events.filter((event) => event.outcome === 'aborted').length,
    evicted: events.reduce((sum, event) => sum + event.evicted, 0),
    openMs: mean('openMs'), readMs: mean('readMs'), touchMs: mean('touchMs'),
    writeMs: mean('writeMs'), fetchMs: mean('fetchMs'), bodyMs: mean('bodyMs'),
  }
}

export function parseTileLog(text: string): TileDiagnosticLog {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object') throw new Error('Ungültiges Diagnoseformat')
  const log = value as Record<string, unknown>
  const nonnegative = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  if (log.format !== 'mapvento-tile-diagnostics' || log.version !== 1 ||
      typeof log.appVersion !== 'string' || (log.environment !== 'desktop' && log.environment !== 'browser') ||
      typeof log.startedAt !== 'string' || typeof log.stoppedAt !== 'string' ||
      !nonnegative(log.incomplete) || !nonnegative(log.dropped) ||
      !Array.isArray(log.events) || log.events.length > MAX_EVENTS) throw new Error('Ungültiges Diagnoseformat')
  for (const item of log.events) {
    if (!item || typeof item !== 'object') throw new Error('Ungültiges Diagnoseereignis')
    const event = item as Record<string, unknown>
    if (typeof event.layer !== 'string' || !nonnegative(event.zoom) ||
        !['unknown', 'hit', 'miss', 'stale'].includes(String(event.cache)) ||
        !['success', 'error', 'aborted'].includes(String(event.outcome)) ||
        typeof event.storageError !== 'boolean' || typeof event.fetchAttempted !== 'boolean' ||
        !(event.touchAttempted === undefined || typeof event.touchAttempted === 'boolean') ||
        !(event.httpStatus === null || nonnegative(event.httpStatus)) ||
        !['evicted', 'totalMs', 'openMs', 'readMs', 'touchMs', 'writeMs', 'fetchMs', 'bodyMs']
          .every((key) => nonnegative(event[key]))) throw new Error('Ungültiges Diagnoseereignis')
  }
  return value as TileDiagnosticLog
}

export const tileDiagnostics = new TileDiagnostics()
