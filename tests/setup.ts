import L from 'leaflet'
import { afterEach, beforeEach, expect, vi } from 'vitest'

let unexpectedFetch: ReturnType<typeof vi.fn>
let unexpectedRequest: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  unexpectedFetch = vi.fn(() => {
    throw new Error('Unexpected network request: mock fetch in the test')
  })
  vi.stubGlobal('fetch', unexpectedFetch)
  unexpectedRequest = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => {
    throw new Error('Unexpected XMLHttpRequest in test')
  })
  vi.spyOn(L.TileLayer.prototype, 'getTileUrl')
    .mockReturnValue('data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=')
})

afterEach(() => {
  try {
    expect(unexpectedFetch, 'Unexpected fetch without a test double').not.toHaveBeenCalled()
    expect(unexpectedRequest, 'Unexpected XMLHttpRequest').not.toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
