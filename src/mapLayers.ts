export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'
export const DEFAULT_LAYER_ID = 'osm'

export type LayerDefinition = {
  id: string
  label: string
  provider: string
  tiles: string
  attribution: string
  attributionUrl: string
  requiresKey?: boolean
}

export const layers: LayerDefinition[] = [
  {
    id: 'osm',
    label: 'OpenStreetMap Carto',
    provider: 'OpenStreetMap',
    tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    attributionUrl: OSM_COPYRIGHT_URL,
  },
  {
    id: 'opentopomap',
    label: 'OpenTopoMap',
    provider: 'OpenTopoMap',
    tiles: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      'Kartendaten: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>, SRTM | Kartendarstellung: &copy; <a href="https://opentopomap.org/about" target="_blank" rel="noopener noreferrer">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">CC-BY-SA</a>)',
    attributionUrl: 'https://opentopomap.org/about',
  },
]

export function isPersistableLayerId(id: string): boolean {
  return layers.some((layer) => layer.id === id && !layer.requiresKey)
}
