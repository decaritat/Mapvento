const abortReasons = [
  'map-movement', 'viewport-update', 'category-change', 'visibility-change',
  'manual-refresh', 'cache-clear', 'effect-cleanup',
] as const

export type PlacesAbortReason = typeof abortReasons[number] | 'unknown'
export type PlacesDiagnostic = {
  startedAt: string
  durationMs: number
  provider: string | null
  phase: 'prepare' | 'request' | 'body' | 'parse' | 'complete' | 'cache-read' | 'cache-write' | 'cache-clear'
  httpStatus: number | null
  outcome: 'success' | 'http-error' | 'timeout' | 'aborted' | 'network-error' | 'invalid-response' | 'cache-error' | 'client-error'
  detail: 'server-busy' | 'query-timeout' | 'out-of-memory' | 'response-too-large' | 'invalid-json' |
    'invalid-data' | 'overpass-error' | 'network-or-cors' | 'body-unavailable' | 'invalid-request' | null
  abortReason: PlacesAbortReason | null
  errorName: string | null
  categoryCount: number
  itemCount: number | null
  responseBytes: number | null
  splitDepth: number | null
  retryAfterMs: number | null
}

export function abortPlaces(controller: AbortController | null, reason: Exclude<PlacesAbortReason, 'unknown'>) {
  controller?.abort(new DOMException(reason, 'AbortError'))
}

export function placesAbortReason(signal: AbortSignal): PlacesAbortReason {
  const reason = signal.reason
  return reason instanceof DOMException && reason.name === 'AbortError' &&
    abortReasons.some((value) => value === reason.message)
    ? abortReasons.find((value) => value === reason.message) ?? 'unknown'
    : 'unknown'
}

export function diagnosticErrorName(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('name' in error) || typeof error.name !== 'string') return null
  return ['AbortError', 'TimeoutError', 'TypeError', 'SyntaxError', 'QuotaExceededError',
    'InvalidStateError', 'NotAllowedError', 'UnknownError'].includes(error.name) ? error.name : 'Error'
}

export function overpassErrorDetail(text: string): PlacesDiagnostic['detail'] {
  if (/Dispatcher_Client::request_read_and_idx::timeout|server (?:is )?(?:probably )?too busy|all query workers are busy|server is currently at capacity/i.test(text)) return 'server-busy'
  if (/run out of memory|out of memory/i.test(text)) return 'out-of-memory'
  if (/query timed out|query.*timed out/i.test(text)) return 'query-timeout'
  return null
}
