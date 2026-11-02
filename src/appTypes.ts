export type ToolMode = 'pan' | 'route' | 'point'

export type ErrorBanner = {
  title: string
  message: string
  action: 'map-retry' | 'routing-retry'
  routeId?: string
}

export type NodeSelection = { routeId: string; nodeId: string }

export type NodeContextMenu = NodeSelection & { x: number; y: number }

export type PlaceSearchResult = {
  place_id: number
  display_name: string
  lat: string
  lon: string
  boundingbox?: [string, string, string, string]
  geojson?: { type: string; coordinates: unknown }
}
