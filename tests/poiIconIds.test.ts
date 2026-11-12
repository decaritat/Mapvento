import { describe, expect, it } from 'vitest'
import { defaultPoiIcon, isPoiIconId, POI_ICON_IDS } from '../src/poiIconIds'

describe('POI icon identities', () => {
  it('validates every registered ID and keeps the default ID valid', () => {
    expect(Object.values(POI_ICON_IDS).every(isPoiIconId)).toBe(true)
    expect(defaultPoiIcon).toBe('flag')
    expect(isPoiIconId(defaultPoiIcon)).toBe(true)
  })

  it.each([undefined, null, 1, 'unknown', 'Flag'])('rejects invalid ID %s', (value) => {
    expect(isPoiIconId(value)).toBe(false)
  })
})