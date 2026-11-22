import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function stylesheet(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
}
const base = stylesheet('../src/app/base.css')
const map = stylesheet('../src/app/Map.css')
const editor = stylesheet('../src/components/routes/RouteEditor.css')
const routeList = stylesheet('../src/components/routes/RouteList.css')
const profile = stylesheet('../src/components/elevation-profile/ElevationProfile.css')

function declaration(css: string, selector: string, property: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`Missing selector: ${selector}`)
  const rule = css.slice(start, css.indexOf('}', start))
  const value = rule.match(new RegExp(`(?:^|[;{\\n])\\s*${property}\\s*:\\s*([^;]+);`))
  if (!value) throw new Error(`Missing ${property} in ${selector}`)
  return value[1].trim()
}

type Color = [number, number, number, number]

function color(value: string): Color {
  const variable = value.match(/^var\((--[\w-]+)\)$/)
  if (variable) return color(declaration(base, ':root', variable[1]))
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1]
    return [parseInt(digits.slice(0, 2), 16), parseInt(digits.slice(2, 4), 16), parseInt(digits.slice(4, 6), 16), 1]
  }
  const rgba = value.match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/)
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])]
  throw new Error(`Unsupported color: ${value}`)
}

function composite(foreground: Color, background: Color): Color {
  return [
    foreground[0] * foreground[3] + background[0] * (1 - foreground[3]),
    foreground[1] * foreground[3] + background[1] * (1 - foreground[3]),
    foreground[2] * foreground[3] + background[2] * (1 - foreground[3]),
    1,
  ]
}

function contrast(a: Color, b: Color): number {
  function luminance(c: Color) {
    return c.slice(0, 3).reduce((sum, channel, index) => {
      const value = channel / 255
      return sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
        [0.2126, 0.7152, 0.0722][index]
    }, 0)
  }
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('text contrast on actual surfaces', () => {
  it('keeps secondary text readable on dark panels and hover/focus surfaces', () => {
    const faint = color(declaration(base, ':root', '--faint'))
    const muted = color(declaration(base, ':root', '--muted'))
    for (const surface of ['--panel', '--panel-raised', '--panel-soft']) {
      expect(contrast(faint, color(declaration(base, ':root', surface)))).toBeGreaterThanOrEqual(4.5)
    }
    const raised = color(declaration(base, ':root', '--panel-raised'))
    const hover = composite([255, 255, 255, 0.08], raised)
    expect(contrast(muted, hover)).toBeGreaterThanOrEqual(4.5)
    const focus = color(declaration(base, '.header-menu button:hover:not(:disabled),\n.header-menu button:focus-visible', 'background'))
    expect(contrast(faint, focus)).toBeGreaterThanOrEqual(4.5)
    const error = color(declaration(routeList, '.route-menu-item.danger', 'color'))
    const errorHover = composite(color(declaration(routeList, '.route-menu-item.danger:hover', 'background')), raised)
    expect(contrast(error, errorHover)).toBeGreaterThanOrEqual(4.5)
  })

  it('checks translucent chart, map attribution, placeholder and notice backgrounds', () => {
    const muted = color(declaration(base, ':root', '--muted'))
    const chartBackground = composite(
      color(declaration(profile, '.profile-selection-side', 'background')),
      color(declaration(base, ':root', '--green')),
    )
    expect(contrast(muted, chartBackground)).toBeGreaterThanOrEqual(4.5)
    const attribution = composite(color(declaration(map, '.map-canvas .leaflet-container .leaflet-control-attribution', 'background')), [0, 0, 0, 1])
    expect(contrast(color(declaration(map, '.leaflet-control-attribution a', 'color')), attribution)).toBeGreaterThanOrEqual(4.5)
    const placeholder = color(declaration(map, '.map-search-form input::placeholder', 'color'))
    expect(contrast(placeholder, color(declaration(map, '.map-search-form input', 'background')))).toBeGreaterThanOrEqual(4.5)
    const notice = composite(color(declaration(map, '.map-notice', 'background')), [255, 255, 255, 1])
    expect(contrast(color(declaration(map, '.map-notice', 'color')), notice)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps read-only field values undimmed', () => {
    const selector = '.sidebar-route-input:disabled,\n.sidebar-route-description:disabled'
    expect(declaration(editor, selector, 'opacity')).toBe('1')
    const fg = color(declaration(editor, selector, 'color'))
    const bg = color(declaration(editor, '.sidebar-route-input,\n.sidebar-route-description', 'background'))
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })
})
