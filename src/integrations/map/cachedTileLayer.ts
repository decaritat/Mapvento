import L from 'leaflet'
import { tileCache, TileCacheStorageError } from './tileCache'

export class CachedTileLayer extends L.TileLayer {
  private resources = new Map<HTMLImageElement, { controller: AbortController; objectUrl?: string }>()
  private layerId: string
  private report: (message: string) => void

  constructor(url: string, options: L.TileLayerOptions, layerId: string, report: (message: string) => void) {
    super(url, options)
    this.layerId = layerId
    this.report = report
    this.on('tileunload', (event: L.TileEvent) => this.release(event.tile as HTMLImageElement))
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const image = document.createElement('img')
    image.alt = ''
    const resource: { controller: AbortController; objectUrl?: string } = { controller: new AbortController() }
    this.resources.set(image, resource)
    image.onload = () => done(undefined, image)
    image.onerror = () => done(new Error('Kachelbild konnte nicht angezeigt werden'), image)
    void tileCache.load(this.layerId, coords.z, coords.x, coords.y, this.getTileUrl(coords), resource.controller.signal)
      .then((blob) => {
        if (resource.controller.signal.aborted) return
        resource.objectUrl = URL.createObjectURL(blob)
        image.src = resource.objectUrl
      })
      .catch((error: unknown) => {
        if (resource.controller.signal.aborted) return
        if (error instanceof TileCacheStorageError) {
          this.report(`Kachelcache nicht verfügbar: ${error.message}. Der HTTP-Cache des Browsers wird verwendet.`)
          image.src = this.getTileUrl(coords)
          return
        }
        done(error instanceof Error ? error : new Error(String(error)), image)
      })
    return image
  }

  private release(image: HTMLImageElement) {
    const resource = this.resources.get(image)
    if (!resource) return
    resource.controller.abort()
    if (resource.objectUrl) URL.revokeObjectURL(resource.objectUrl)
    image.onload = null
    image.onerror = null
    this.resources.delete(image)
  }

  onRemove(map: L.Map): this {
    super.onRemove(map)
    this.resources.forEach((_, image) => this.release(image))
    return this
  }
}
