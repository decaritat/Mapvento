export type RouteType = 'hiking' | 'cycling'
export type Coordinate = [number, number]
export type RoutingProfile = 'trekking' | 'hiking-beta'
export type RouteGeometry = {
  coordinates: Coordinate[]
  elevations?: number[]
}
export type RoutingErrorKind =
  | 'network'
  | 'rate-limit'
  | 'authentication'
  | 'provider'
  | 'request'
  | 'invalid-response'
  | 'no-route'

export class RoutingError extends Error {
  readonly kind: RoutingErrorKind
  readonly status?: number

  constructor(
    kind: RoutingErrorKind,
    message: string,
    status?: number,
  ) {
    super(message)
    this.kind = kind
    this.status = status
    this.name = 'RoutingError'
  }
}

export const ROUTING_PROVIDER = {
  id: 'brouter',
  label: 'BRouter',
  attributionUrl: 'https://brouter.de/brouter-web/',
  endpoint: 'https://brouter.de/brouter',
  profiles: {
    hiking: 'hiking-beta',
    cycling: 'trekking',
  } satisfies Record<RouteType, RoutingProfile>,
} as const

type BRouterResponse = {
  features?: Array<{
    geometry?: {
      type?: string
      coordinates?: Array<number[]>
    }
  }>
}

function routeProfileFor(routeType: RouteType): RoutingProfile {
  return ROUTING_PROVIDER.profiles[routeType]
}

export function routingProfileLabel(routeType: RouteType) {
  return routeProfileFor(routeType) === 'hiking-beta'
    ? 'Wandern (hiking-beta)'
    : 'Radfahren (trekking)'
}

function httpErrorKind(status: number): RoutingErrorKind {
  if (status === 401 || status === 403) return 'authentication'
  if (status === 429) return 'rate-limit'
  if (status >= 500) return 'provider'
  return 'request'
}

function httpErrorMessage(status: number, detail: string) {
  const suffix = detail ? `: ${detail.slice(0, 160)}` : ''
  if (status === 401 || status === 403) {
    return `${ROUTING_PROVIDER.label} verweigert die Anfrage (HTTP ${status})${suffix}`
  }
  if (status === 429) {
    return `${ROUTING_PROVIDER.label} meldet ein Rate-Limit (HTTP 429). Bitte später erneut versuchen${suffix}`
  }
  if (status >= 500) {
    return `${ROUTING_PROVIDER.label} ist vorübergehend nicht verfügbar (HTTP ${status})${suffix}`
  }
  return `${ROUTING_PROVIDER.label} meldet einen Anfragefehler (HTTP ${status})${suffix}`
}

export function describeRoutingError(error: unknown) {
  if (error instanceof RoutingError) return error.message
  if (error instanceof TypeError) {
    return `${ROUTING_PROVIDER.label} ist nicht erreichbar. Prüfe die Internetverbindung.`
  }
  if (error instanceof Error) return error.message
  return 'Unbekannter Fehler beim Routing.'
}

export async function requestRouteGeometry(
  routeType: RouteType,
  coordinates: readonly Coordinate[],
  signal: AbortSignal,
): Promise<RouteGeometry> {
  if (coordinates.length < 2) throw new Error('Mindestens zwei Routenpunkte erforderlich')

  const params = new URLSearchParams({
    lonlats: coordinates.map(([longitude, latitude]) => `${longitude},${latitude}`).join('|'),
    profile: routeProfileFor(routeType),
    alternativeidx: '0',
    format: 'geojson',
  })
  let response: Response
  try {
    response = await fetch(`${ROUTING_PROVIDER.endpoint}?${params.toString()}`, {
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new RoutingError(
      'network',
      describeRoutingError(error),
    )
  }

  if (!response.ok) {
    const message = (await response.text()).trim()
    throw new RoutingError(
      httpErrorKind(response.status),
      httpErrorMessage(response.status, message),
      response.status,
    )
  }

  let payload: BRouterResponse
  try {
    payload = (await response.json()) as BRouterResponse
  } catch {
    throw new RoutingError(
      'invalid-response',
      `${ROUTING_PROVIDER.label} hat keine gültige Routingantwort geliefert.`,
    )
  }

  const rawCoordinates = payload.features?.[0]?.geometry?.coordinates
  const validCoordinates = rawCoordinates
    ?.filter(
      (coordinate): coordinate is number[] =>
        Array.isArray(coordinate) &&
        Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1]),
    )
  if (validCoordinates?.some(([longitude, latitude]) =>
    longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90,
  )) {
    throw new RoutingError(
      'invalid-response',
      `${ROUTING_PROVIDER.label} hat ungültige Koordinaten geliefert.`,
    )
  }
  const geometry = validCoordinates?.map(
    ([longitude, latitude]) => [longitude, latitude] as Coordinate,
  )

  if (!geometry?.length) {
    throw new RoutingError(
      'no-route',
      `${ROUTING_PROVIDER.label} konnte für diese Punkte keine Route finden.`,
    )
  }
  const elevations = validCoordinates?.map((coordinate) => coordinate[2])
  return {
    coordinates: geometry,
    ...(elevations?.every((elevation): elevation is number => Number.isFinite(elevation))
      ? { elevations }
      : {}),
  }
}
