import { latLng } from 'leaflet'
import { describe, expect, it } from 'vitest'
import { projectCoordinate } from '../src/mapCoordinates'

describe('project map coordinates', () => {
  it.each([
    [52, 13, [13, 52]],
    [52, 181, [-179, 52]],
    [-90, -181, [179, -90]],
    [90, 540, [-180, 90]],
  ])('wraps longitude from repeated map worlds: %s, %s', (latitude, longitude, expected) => {
    expect(projectCoordinate(latLng(latitude, longitude))).toEqual(expected)
  })
})
