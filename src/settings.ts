import { DEFAULT_LAYER_ID, isPersistableLayerId, isPersistableOverlayId } from './mapLayers'

export const durationFormats = [
  { value: 'hours-minutes', label: 'h min' },
  { value: 'clock', label: 'hh:mm' },
  { value: 'minutes', label: 'min' },
  { value: 'hours', label: 'h' },
] as const

export type DurationFormat = (typeof durationFormats)[number]['value']

export function isDurationFormat(value: unknown): value is DurationFormat {
  return durationFormats.some((format) => format.value === value)
}

export type Units = {
  distance: 'km' | 'mi'
  elevation: 'm' | 'ft'
  duration: DurationFormat
}

export type StartSettings = {
  layerId: string
  overlayIds: string[]
  latitude: number
  longitude: number
  zoom: number
}

export type Settings = { version: 1; start: StartSettings; units: Units }

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  start: { layerId: DEFAULT_LAYER_ID, overlayIds: [], latitude: 51.1657, longitude: 10.4515, zoom: 7 },
  units: { distance: 'km', elevation: 'm', duration: 'hours-minutes' },
}

export const SETTINGS_KEY = 'trailforge-settings'

export function parseSettings(value: unknown): Settings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Einstellungen sind kein Objekt.')
  const data = value as Record<string, unknown>
  if (data.version !== 1 || typeof data.start !== 'object' || data.start === null ||
      Array.isArray(data.start) || typeof data.units !== 'object' || data.units === null || Array.isArray(data.units)) {
    throw new Error('Einstellungen haben ein ungültiges Format oder eine unbekannte Version.')
  }
  const start = data.start as Record<string, unknown>
  const units = data.units as Record<string, unknown>
  if (typeof start.layerId !== 'string' || !isPersistableLayerId(start.layerId) ||
      !Array.isArray(start.overlayIds) || !start.overlayIds.every((id: unknown) => typeof id === 'string' && isPersistableOverlayId(id)) ||
      new Set(start.overlayIds).size !== start.overlayIds.length ||
      typeof start.latitude !== 'number' || !Number.isFinite(start.latitude) || Math.abs(start.latitude) > 85.05112878 ||
      typeof start.longitude !== 'number' || !Number.isFinite(start.longitude) || Math.abs(start.longitude) > 180 ||
      typeof start.zoom !== 'number' || !Number.isInteger(start.zoom) || start.zoom < 0 || start.zoom > 19 ||
      (units.distance !== 'km' && units.distance !== 'mi') ||
      (units.elevation !== 'm' && units.elevation !== 'ft') ||
      !isDurationFormat(units.duration)) {
    throw new Error('Einstellungen enthalten ungültige Werte.')
  }
  return {
    version: 1,
    start: { layerId: start.layerId, overlayIds: [...start.overlayIds], latitude: start.latitude, longitude: start.longitude, zoom: start.zoom },
    units: { distance: units.distance, elevation: units.elevation, duration: units.duration },
  }
}

export function readSettings(storage: Pick<Storage, 'getItem'>): { settings: Settings; saved: boolean; warning: string } {
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    return raw
      ? { settings: parseSettings(JSON.parse(raw)), saved: true, warning: '' }
      : { settings: DEFAULT_SETTINGS, saved: false, warning: '' }
  } catch (error) {
    console.warn('Einstellungen konnten nicht geladen werden.', error)
    return { settings: DEFAULT_SETTINGS, saved: false, warning: 'Gespeicherte Einstellungen sind ungültig oder nicht verfügbar. Standardeinstellungen werden verwendet.' }
  }
}

export function distanceInUnit(km: number, unit: Units['distance']) {
  return unit === 'mi' ? km / 1.609344 : km
}

export function distanceInKm(value: number, unit: Units['distance']) {
  return unit === 'mi' ? value * 1.609344 : value
}

export function elevationInUnit(meters: number, unit: Units['elevation']) {
  return unit === 'ft' ? meters / 0.3048 : meters
}

export function durationInUnit(minutes: number, unit: Units['duration']) {
  if (unit === 'minutes') return `${minutes} min`
  if (unit === 'hours') return `${(minutes / 60).toFixed(1).replace('.', ',')} h`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (unit === 'clock') return `${hours}:${String(rest).padStart(2, '0')}`
  return hours ? `${hours} h ${rest} min` : `${rest} min`
}
