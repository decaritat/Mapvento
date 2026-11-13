import geocodingProvider from '../features/geocoding/geocodingProvider.json'
import { ROUTING_PROVIDER } from '../domain/routing'
import { OSM_COPYRIGHT_URL } from '../domain/mapLayers'
import { PLACES_PROVIDER } from '../features/osm-places/places'

export const GEOCODING_PROVIDER = geocodingProvider

export const LEAFLET_INFO = {
  id: 'leaflet',
  label: 'Leaflet',
  url: 'https://leafletjs.com/',
} as const

export const ALL_PROVIDER_ATTRIBUTIONS = [
  {
    name: 'OpenStreetMap',
    text: 'Kartendaten © OpenStreetMap-Mitwirkende, lizenziert unter der Open Database License (ODbL).',
    url: OSM_COPYRIGHT_URL,
  },
  {
    name: 'OpenTopoMap',
    text: 'Kartenstil © OpenTopoMap (CC-BY-SA 3.0), Daten © OpenStreetMap-Mitwirkende, SRTM.',
    url: 'https://opentopomap.org/about',
  },
  {
    name: 'Waymarked Trails',
    text: 'Wander- und Fahrradrouten © Waymarked Trails (CC BY-SA 3.0 DE), Daten © OpenStreetMap-Mitwirkende.',
    url: 'https://hiking.waymarkedtrails.org/#help-legal',
  },
  {
    name: 'Nominatim',
    text: 'Ortssuche über den öffentlichen Nominatim-Dienst der OpenStreetMap Foundation.',
    url: GEOCODING_PROVIDER.url,
  },
  {
    name: 'Overpass (Private.coffee)',
    text: 'OSM-Orte über die öffentliche Overpass-Instanz von Private.coffee.',
    url: PLACES_PROVIDER.url,
  },
  {
    name: 'BRouter',
    text: 'Routenberechnung über die öffentliche BRouter-Instanz auf Basis von OpenStreetMap-Daten.',
    url: ROUTING_PROVIDER.attributionUrl,
  },
  {
    name: 'Leaflet',
    text: 'Kartendarstellung mit Leaflet, © Volodymyr Agafonkin und Mitwirkende (BSD-2-Clause).',
    url: LEAFLET_INFO.url,
  },
]
