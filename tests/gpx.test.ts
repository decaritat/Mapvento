import { describe, expect, it } from 'vitest'
import { parseGpx, toGpx } from '../src/gpx'
import { routeMetrics } from '../src/routeMetrics'
import type { MapPoint, Route } from '../src/routeModel'

const route: Route = {
  id: 'route-1',
  name: 'Wald & Fluss',
  description: 'Eine <schöne> "Tour" & mehr',
  type: 'cycling',
  color: '#123456',
  editable: true,
  nodes: [
    { id: 'node-1', coordinate: [13.4, 52.5] },
    { id: 'node-2', coordinate: [13.41, 52.51] },
  ],
  geometry: [[13.4, 52.5], [13.41, 52.51]],
  elevations: [34, 41],
}

const points: MapPoint[] = [
  {
    id: 'point-1',
    name: 'Quelle & Rastplatz',
    description: 'Wasser <hier>',
    coordinate: [13.405, 52.505],
    source: 'manual',
  },
]

describe('GPX import and export', () => {
  it('exports route metadata, coordinates, elevations, and escaped waypoints', () => {
    const document = new DOMParser().parseFromString(toGpx(route, points), 'application/xml')

    expect(document.querySelector('parsererror')).toBeNull()
    expect(document.querySelector('metadata name')?.textContent).toBe(route.name)
    expect(document.querySelector('metadata desc')?.textContent).toBe(route.description)
    expect(document.querySelector('trk type')?.textContent).toBe('cycling')
    expect(document.querySelectorAll('trkpt')).toHaveLength(2)
    expect(document.querySelector('trkpt ele')?.textContent).toBe('34')
    expect(document.querySelector('wpt name')?.textContent).toBe(points[0].name)
    expect(document.querySelector('wpt desc')?.textContent).toBe(points[0].description)
  })

  it('imports route metadata, coordinates, and elevations as read-only', () => {
    const imported = parseGpx(toGpx(route, []))

    expect(imported).not.toBeNull()
    expect(imported?.route).toMatchObject({
      name: route.name,
      description: route.description,
      type: 'cycling',
      gpxType: 'cycling',
      editable: false,
      geometry: route.geometry,
      elevations: route.elevations,
      routingState: 'ready',
    })
  })

  it('imports GPX waypoints as POIs with their names, descriptions, and coordinates', () => {
    const imported = parseGpx(toGpx(route, points))

    expect(imported?.waypoints).toMatchObject([
      {
        name: points[0].name,
        description: points[0].description,
        coordinate: points[0].coordinate,
        source: 'poi',
        editable: false,
      },
    ])
    expect(imported?.waypoints[0].icon).toBeDefined()
  })

  it('uses metadata defaults and available elevation data while remaining read-only', () => {
    const imported = parseGpx(
      '<gpx><trk><trkseg><trkpt lat="52.5" lon="13.4"><ele>10</ele></trkpt><trkpt lat="52.6" lon="13.5"/></trkseg></trk></gpx>',
    )

    expect(imported?.route).toMatchObject({
      name: 'Importierte GPX-Route',
      description: 'Aus einer GPX-Datei importiert.',
      editable: false,
    })
    expect(imported?.route.gpxType).toBeUndefined()
    expect(imported?.route.elevations).toHaveLength(2)
    expect(imported?.route.elevations?.[0]).toBe(10)
    expect(imported?.route.elevations?.[1]).toBe(10)
    expect(imported?.route.nodes[0].coordinate).toEqual([13.4, 52.5])
  })

  it('imports timestamps for duration metrics and preserves them in GPX data', () => {
    const routeWithTimes: Route = {
      ...route,
      timestamps: ['2025-05-01T10:00:00Z', '2025-05-01T11:30:00Z'],
    }

    const imported = parseGpx(toGpx(routeWithTimes, []))

    expect(imported?.route.timestamps).toEqual(routeWithTimes.timestamps)
    expect(imported?.route.editable).toBe(false)
  })

  it('prevents GPX export of read-only routes', () => {
    expect(() => toGpx({ ...route, editable: false }, [])).toThrow(
      'Schreibgeschützte GPX-Routen können nicht exportiert werden.',
    )
  })

  it('uses imported timestamps and elevations in route statistics', () => {
    const imported = parseGpx(
      '<gpx><trk><trkseg><trkpt lat="52.5" lon="13.4"><ele>100</ele><time>2025-05-01T10:00:00Z</time></trkpt><trkpt lat="52.51" lon="13.41"><ele>140</ele><time>2025-05-01T11:00:00Z</time></trkpt></trkseg></trk></gpx>',
    )

    expect(imported).not.toBeNull()
    expect(routeMetrics(imported!.route).durationMinutes).toBe(60)
    expect(routeMetrics(imported!.route).high).toBe(140)
    expect(routeMetrics(imported!.route).ascent).toBe(40)
  })

  it('prefers imported and interpolated GPX heights over a replacement fallback', () => {
    const imported = parseGpx(
      '<gpx><trk><trkseg><trkpt lat="52.5" lon="13.4"><ele>100</ele></trkpt><trkpt lat="52.51" lon="13.41"/><trkpt lat="52.52" lon="13.42"><ele>140</ele></trkpt></trkseg></trk></gpx>',
    )
    expect(imported).not.toBeNull()
    const fallback = { elevationAt: () => 999 }

    expect(imported!.route.elevations).toEqual([100, 120, 140])
    expect(routeMetrics(imported!.route, fallback).elevations).toEqual([100, 120, 140])
    expect(routeMetrics(imported!.route, fallback).ascent).toBe(40)
  })

  it('uses the same replacement fallback for GPX exports', () => {
    const document = new DOMParser().parseFromString(
      toGpx({ ...route, elevations: undefined }, [], { elevationAt: () => 123 }),
      'application/xml',
    )

    expect(Array.from(document.querySelectorAll('trkpt ele'), (ele) => ele.textContent))
      .toEqual(['123', '123'])
  })

  it('exports stored elevations in preference to a replacement fallback', () => {
    const document = new DOMParser().parseFromString(
      toGpx(route, [], { elevationAt: () => 123 }),
      'application/xml',
    )

    expect(Array.from(document.querySelectorAll('trkpt ele'), (ele) => ele.textContent))
      .toEqual(['34', '41'])
  })

  it('rejects malformed GPX and documents without track points', () => {
    expect(parseGpx('<gpx><broken></gpx>')).toBeNull()
    expect(parseGpx('<gpx><metadata><name>Kein Track</name></metadata></gpx>')).toBeNull()
    expect(
      parseGpx('<gpx><trk><trkseg><trkpt lat="91" lon="13"/></trkseg></trk></gpx>'),
    ).toBeNull()
    expect(parseGpx('<gpx><trk><trkseg><trkpt lat="52.5"/></trkseg></trk></gpx>')).toBeNull()
  })
})
