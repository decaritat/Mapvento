import { cartoSymbols } from './poiCartoSymbols'
import { POI_ICON_IDS, type PoiIconId } from '../../domain/poiIconIds'

type PoiIconDefinition = {
  id: PoiIconId
  label: string
  body: string
  viewBox?: string
}

const stroke = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'

const own = {
  spring: `<path ${stroke} d="M12 3s5 5.1 5 9a5 5 0 0 1-10 0c0-3.9 5-9 5-9Z" /><path ${stroke} d="M9 14c1.5 1.5 4.5 1.5 6 0" />`,
  lake: `<path ${stroke} d="M3 9c2.4-2 4.8 2 7.2 0s4.8-2 7.2 0 2.8 0 3.6-.6M3 14c2.4-2 4.8 2 7.2 0s4.8-2 7.2 0 2.8 0 3.6-.6M3 19c2.4-2 4.8 2 7.2 0s4.8-2 7.2 0 2.8 0 3.6-.6" />`,
  flag: `<path ${stroke} d="M6 21V4M6 5c4-3 7 3 12 0v8c-5 3-8-3-12 0" />`,
  attraction: `<path ${stroke} d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" />`,
  information: `<circle ${stroke} cx="12" cy="12" r="9" /><path ${stroke} d="M12 11v6M12 7h.01" />`,
  train: `<rect ${stroke} x="5" y="3" width="14" height="14" rx="2" /><path ${stroke} d="M8 7h3M13 7h3M8 12h.01M16 12h.01M8 17l-3 4M16 17l3 4M8 17h8" />`,
  bike: `<circle ${stroke} cx="6" cy="17" r="3" /><circle ${stroke} cx="18" cy="17" r="3" /><path ${stroke} d="M6 17 10 8h4l4 9M10 8l3 9M8 5h4" />`,
  firstAid: `<rect ${stroke} x="4" y="6" width="16" height="14" rx="2" /><path ${stroke} d="M9 6V4h6v2M8 13h8M12 9v8" />`,
  emergency: `<path ${stroke} d="M12 3 2.8 20h18.4L12 3Z" /><path ${stroke} d="M12 9v5M12 17h.01" />`,
}

const osm = (id: keyof typeof cartoSymbols, label: string) => ({
  id,
  label,
  viewBox: cartoSymbols[id].viewBox,
  body: cartoSymbols[id].body,
})

export const POI_ICON_CATEGORIES = [
  {
    id: 'water',
    label: 'Wasser',
    icons: [
      osm(POI_ICON_IDS.drinkingWater, 'Trinkwasser'),
      { id: POI_ICON_IDS.spring, label: 'Quelle', body: own.spring },
      osm(POI_ICON_IDS.waterfall, 'Wasserfall'),
      { id: POI_ICON_IDS.lake, label: 'See', body: own.lake },
    ],
  },
  {
    id: 'lodging',
    label: 'Unterkunft',
    icons: [
      osm(POI_ICON_IDS.shelter, 'Schutzhütte'),
      osm(POI_ICON_IDS.camp, 'Camping'),
      osm(POI_ICON_IDS.alpineHut, 'Berghütte'),
      osm(POI_ICON_IDS.wildernessHut, 'Wildnishütte'),
      osm(POI_ICON_IDS.hostel, 'Hostel'),
      osm(POI_ICON_IDS.hotel, 'Hotel'),
    ],
  },
  {
    id: 'info',
    label: 'Info',
    icons: [
      { id: POI_ICON_IDS.flag, label: 'Markierung', body: own.flag },
      osm(POI_ICON_IDS.summit, 'Gipfel'),
      osm(POI_ICON_IDS.viewpoint, 'Aussichtspunkt'),
      osm(POI_ICON_IDS.observationTower, 'Aussichtsturm'),
      osm(POI_ICON_IDS.guidepost, 'Wegweiser'),
      osm(POI_ICON_IDS.picnic, 'Picknick'),
      { id: POI_ICON_IDS.attraction, label: 'Sehenswürdigkeit', body: own.attraction },
      osm(POI_ICON_IDS.castle, 'Burg'),
      osm(POI_ICON_IDS.memorial, 'Denkmal'),
      osm(POI_ICON_IDS.museum, 'Museum'),
      osm(POI_ICON_IDS.playground, 'Spielplatz'),
      { id: POI_ICON_IDS.information, label: 'Information', body: own.information },
    ],
  },
  {
    id: 'food',
    label: 'Essen und Trinken',
    icons: [
      osm(POI_ICON_IDS.restaurant, 'Restaurant'),
      osm(POI_ICON_IDS.cafe, 'Café'),
      osm(POI_ICON_IDS.internetCafe, 'Internetcafé'),
      osm(POI_ICON_IDS.nightclub, 'Nachtclub'),
      osm(POI_ICON_IDS.supermarket, 'Supermarkt'),
      osm(POI_ICON_IDS.bakery, 'Bäckerei'),
    ],
  },
  {
    id: 'service',
    label: 'Service',
    icons: [
      osm(POI_ICON_IDS.toilet, 'Toiletten'),
      osm(POI_ICON_IDS.shower, 'Dusche'),
      osm(POI_ICON_IDS.atm, 'Geldautomat'),
      osm(POI_ICON_IDS.bank, 'Bank'),
      osm(POI_ICON_IDS.parking, 'Parkplatz'),
      osm(POI_ICON_IDS.recycling, 'Recycling'),
      osm(POI_ICON_IDS.library, 'Bibliothek'),
      osm(POI_ICON_IDS.communityCentre, 'Gemeindezentrum'),
    ],
  },
  {
    id: 'transport',
    label: 'Transport',
    icons: [
      { id: POI_ICON_IDS.train, label: 'Bahnhof', body: own.train },
      osm(POI_ICON_IDS.bus, 'Bushaltestelle'),
      osm(POI_ICON_IDS.ferry, 'Fähre'),
      { id: POI_ICON_IDS.bike, label: 'Fahrrad', body: own.bike },
    ],
  },
  {
    id: 'help',
    label: 'Hilfe',
    icons: [
      osm(POI_ICON_IDS.hospital, 'Krankenhaus'),
      osm(POI_ICON_IDS.pharmacy, 'Apotheke'),
      { id: POI_ICON_IDS.firstAid, label: 'Erste Hilfe', body: own.firstAid },
      osm(POI_ICON_IDS.emergencyPhone, 'Notruftelefon'),
      { id: POI_ICON_IDS.emergency, label: 'Notfall', body: own.emergency },
    ],
  },
] as const

const legacyIcons: readonly PoiIconDefinition[] = [
  {
    id: POI_ICON_IDS.heart,
    label: 'Favorit',
    body: `<path fill="currentColor" d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z" />`,
  },
  {
    id: POI_ICON_IDS.tree,
    label: 'Baum',
    body: `<path fill="currentColor" d="m12 3 5 7h-3l4 5h-4v6H10v-6H6l4-5H7l5-7Z" />`,
  },
  {
    id: POI_ICON_IDS.forest,
    label: 'Wald',
    body: `<path fill="currentColor" d="m7 4 4 6H9l3 4H9v7H5v-7H2l3-4H3l4-6ZM17 3l4 6h-2l3 4h-3v8h-4v-8h-3l3-4h-2l4-6Z" />`,
  },
  {
    id: POI_ICON_IDS.park,
    label: 'Park',
    body: `<circle fill="currentColor" cx="12" cy="9" r="6" /><path ${stroke} d="M12 15v6M7 21h10" />`,
  },
  {
    id: POI_ICON_IDS.flower,
    label: 'Blume',
    body: `<circle fill="currentColor" cx="12" cy="12" r="2" /><circle fill="currentColor" cx="12" cy="6" r="3" /><circle fill="currentColor" cx="18" cy="12" r="3" /><circle fill="currentColor" cx="12" cy="18" r="3" /><circle fill="currentColor" cx="6" cy="12" r="3" />`,
  },
  {
    id: POI_ICON_IDS.water,
    label: 'Wasser',
    body: `<path fill="currentColor" d="M12 3s6 6 6 11a6 6 0 1 1-12 0c0-5 6-11 6-11Z" />`,
  },
  {
    id: POI_ICON_IDS.market,
    label: 'Markt',
    body: `<path ${stroke} d="M4 10h16l-1 10H5L4 10ZM3 10l2-6h14l2 6M8 14h8" />`,
  },
  {
    id: POI_ICON_IDS.shop,
    label: 'Geschäft',
    body: `<path ${stroke} d="M4 10h16l-1 10H5L4 10ZM3 10l2-6h14l2 6M8 14h8" />`,
  },
  {
    id: POI_ICON_IDS.fire,
    label: 'Feuerstelle',
    body: `<path fill="currentColor" d="M12 3c2 4-1 5 2 8 1-2 2-2 2-5 3 3 4 6 2 10a6 6 0 0 1-12 0c0-3 2-5 4-7 0 3 1 4 2 5 2-4-1-6 0-11Z" />`,
  },
  {
    id: POI_ICON_IDS.swimming,
    label: 'Schwimmen',
    body: `<path ${stroke} d="M3 10c2 2 4 2 6 0s4-2 6 0 4 2 6 0M3 16c2 2 4 2 6 0s4-2 6 0 4 2 6 0M7 6h10" />`,
  },
  {
    id: POI_ICON_IDS.church,
    label: 'Kirche',
    body: `<path ${stroke} d="M5 20V9l7-5 7 5v11M3 20h18M12 4V1M10 3h4M10 20v-5h4v5" />`,
  },
  {
    id: POI_ICON_IDS.monument,
    label: 'Denkmal',
    body: `<path ${stroke} d="M12 3v13M8 20h8M6 16h12M9 3h6M7 7h10" />`,
  },
  {
    id: POI_ICON_IDS.wifi,
    label: 'WLAN',
    body: `<path ${stroke} d="M3 9a14 14 0 0 1 18 0M6 13a9 9 0 0 1 12 0M9 17a4 4 0 0 1 6 0M12 21h.01" />`,
  },
  {
    id: POI_ICON_IDS.accessibility,
    label: 'Barrierefrei',
    body: `<circle ${stroke} cx="12" cy="4" r="2" /><path ${stroke} d="M5 8h14M12 8v6l-4 7M12 14l5 4" />`,
  },
  {
    id: POI_ICON_IDS.doctor,
    label: 'Arzt',
    body: `<circle ${stroke} cx="12" cy="12" r="9" /><path ${stroke} d="M12 7v10M7 12h10" />`,
  },
] as const

export type PoiIcon = PoiIconDefinition & { id: PoiIconId }

const categoryIcons: PoiIconDefinition[] = []
for (const category of POI_ICON_CATEGORIES) {
  categoryIcons.push(...category.icons)
}

const allIcons: readonly PoiIcon[] = [...categoryIcons, ...legacyIcons]

export function getPoiIcon(value: unknown): PoiIcon {
  return allIcons.find((icon) => icon.id === value) ?? POI_ICON_CATEGORIES[0].icons[0]
}

export function poiIconSvg(icon: PoiIcon, className = 'poi-icon-graphic') {
  return `<svg class="${className}" viewBox="${icon.viewBox ?? '0 0 24 24'}" fill="currentColor" aria-hidden="true" focusable="false">${icon.body}</svg>`
}
