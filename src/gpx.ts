import {
  defaultElevationProvider,
  getDisplayedRouteElevations,
  type ElevationProvider,
} from './elevation'
import {
  getDisplayedRouteCoordinates,
  type Coordinate,
  type MapPoint,
  type Route,
  type RouteNode,
} from './routeModel'
import { defaultPoiIcon } from './poiIcons'

export type ParsedGpx = {
  route: Route
  waypoints: MapPoint[]
  skippedWaypoints: number
}

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

export function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function toGpx(
  route: Route,
  points: MapPoint[],
  fallback: ElevationProvider = defaultElevationProvider,
) {
  if (!route.editable) {
    throw new Error('Schreibgeschützte GPX-Routen können nicht exportiert werden.')
  }
  const routeCoordinates = getDisplayedRouteCoordinates(route)
  const elevations = getDisplayedRouteElevations(route, fallback)
  const timestamps =
    route.timestamps?.length === routeCoordinates.length ? route.timestamps : []
  const track = routeCoordinates
    .map(([lon, lat], index) => {
      const timestamp = timestamps[index]
      const time =
        timestamp && Number.isFinite(Date.parse(timestamp))
          ? `<time>${escapeXml(timestamp)}</time>`
          : ''
      return `      <trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>${elevations[index]}</ele>${time}</trkpt>`
    })
    .join('\n')
  const waypoints = points
    .map(
      (point) =>
        `  <wpt lat="${point.coordinate[1].toFixed(7)}" lon="${point.coordinate[0].toFixed(7)}"><name>${escapeXml(
          point.name,
        )}</name><desc>${escapeXml(point.description)}</desc></wpt>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trailforge" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(route.name)}</name><desc>${escapeXml(route.description)}</desc></metadata>
${waypoints}
  <trk><name>${escapeXml(route.name)}</name><type>${route.type}</type><trkseg>
${track}
    </trkseg></trk>
</gpx>`
}

function completeElevations(elevations: number[]) {
  const completed = [...elevations]
  let previousKnownIndex = -1

  elevations.forEach((elevation, index) => {
    if (!Number.isFinite(elevation)) return
    if (previousKnownIndex < 0) {
      for (let missingIndex = 0; missingIndex < index; missingIndex += 1) {
        completed[missingIndex] = elevation
      }
    } else {
      const previousElevation = elevations[previousKnownIndex]
      const gap = index - previousKnownIndex
      for (let missingIndex = previousKnownIndex + 1; missingIndex < index; missingIndex += 1) {
        const fraction = (missingIndex - previousKnownIndex) / gap
        completed[missingIndex] = previousElevation + (elevation - previousElevation) * fraction
      }
    }
    previousKnownIndex = index
  })

  if (previousKnownIndex >= 0) {
    for (let index = previousKnownIndex + 1; index < completed.length; index += 1) {
      completed[index] = elevations[previousKnownIndex]
    }
  }
  return completed
}

function parseCoordinate(element: Element): Coordinate | null {
  const longitudeText = element.getAttribute('lon')
  const latitudeText = element.getAttribute('lat')
  if (!longitudeText?.trim() || !latitudeText?.trim()) return null

  const longitude = Number(longitudeText)
  const latitude = Number(latitudeText)
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null
  }
  return [longitude, latitude]
}

export function parseGpx(xml: string): ParsedGpx | null {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.querySelector('parsererror')) return null
  const points = Array.from(document.querySelectorAll('trkpt'))
  if (!points.length) return null
  const coordinates = points.map(parseCoordinate)
  if (!coordinates.every((coordinate): coordinate is Coordinate => coordinate !== null)) return null
  const nodes: RouteNode[] = coordinates.map((coordinate) => ({
    id: uid('node'),
    coordinate,
  }))
  const waypointElements = Array.from(document.querySelectorAll('wpt'))
  const parsedWaypoints = waypointElements.map((waypoint, index) => {
    const coordinate = parseCoordinate(waypoint)
    if (!coordinate) return null
    return {
      id: uid('point'),
      name: waypoint.querySelector('name')?.textContent?.trim() || `GPX-Wegpunkt ${index + 1}`,
      description: (waypoint.querySelector('desc')?.textContent?.trim() || '').slice(0, 180),
      coordinate,
      source: 'poi' as const,
      editable: false,
      icon: defaultPoiIcon,
    }
  })
  const waypoints = parsedWaypoints.filter((waypoint) => waypoint !== null)
  const elevations = points.map((point) => {
    const value = point.querySelector('ele')?.textContent?.trim()
    return value ? Number(value) : Number.NaN
  })
  const timestamps = points.map((point) => {
    const value = point.querySelector('time')?.textContent?.trim()
    return value && Number.isFinite(Date.parse(value)) ? value : null
  })
  const name =
    document.querySelector('metadata name, trk name')?.textContent?.trim() ||
    'Importierte GPX-Route'
  const description =
    document.querySelector('metadata desc')?.textContent?.trim() ||
    'Aus einer GPX-Datei importiert.'
  const gpxType = document.querySelector('trk type')?.textContent?.trim()
  const type = /cycl|bik|bicycl/i.test(gpxType ?? '') ? 'cycling' : 'hiking'
  return {
    route: {
      id: uid('route'),
      name,
      description,
      type,
      ...(gpxType ? { gpxType } : {}),
      color: '#7ee787',
      editable: false,
      nodes,
      geometry: nodes.map((node) => node.coordinate),
      ...(elevations.some(Number.isFinite)
        ? { elevations: completeElevations(elevations) }
        : {}),
      ...(timestamps.some(Boolean) ? { timestamps } : {}),
      routingState: 'ready',
    },
    waypoints,
    skippedWaypoints: waypointElements.length - waypoints.length,
  }
}
