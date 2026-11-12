import { afterEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { openProjectFile, readTextFile, saveProjectFile, saveTextFile } from '../src/projectFileAdapter'

const tauriState = vi.hoisted(() => ({ active: false }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => tauriState.active,
}))

function setPicker(name: 'showOpenFilePicker' | 'showSaveFilePicker', value: unknown) {
  Object.defineProperty(window, name, { configurable: true, value })
}

afterEach(() => {
  tauriState.active = false
  Reflect.deleteProperty(window, 'showOpenFilePicker')
  Reflect.deleteProperty(window, 'showSaveFilePicker')
  vi.restoreAllMocks()
})

describe('project file adapters', () => {
  it('opens a browser project through the file picker and preserves its handle', async () => {
    const handle = {
      getFile: vi.fn().mockResolvedValue({ text: async () => '{"name":"Tour"}' }),
      createWritable: vi.fn(),
    }
    const picker = vi.fn().mockResolvedValue([handle])
    setPicker('showOpenFilePicker', picker)

    await expect(openProjectFile()).resolves.toEqual({
      content: '{"name":"Tour"}',
      file: { kind: 'browser', handle },
    })
    expect(picker).toHaveBeenCalledWith({
      types: [{ description: 'Projektdatei', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    })
  })

  it('returns cancellation and legacy-browser fallback distinctly', async () => {
    setPicker('showOpenFilePicker', vi.fn().mockResolvedValue([]))
    await expect(openProjectFile()).resolves.toBeNull()
    Reflect.deleteProperty(window, 'showOpenFilePicker')
    await expect(openProjectFile()).resolves.toBe('fallback')
  })

  it('saves through a browser handle and honors Save As by requesting a new handle', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    const previousHandle = { getFile: vi.fn(), createWritable: vi.fn().mockResolvedValue({ write, close }) }
    const selectedHandle = { getFile: vi.fn(), createWritable: vi.fn().mockResolvedValue({ write, close }) }
    const picker = vi.fn().mockResolvedValue(selectedHandle)
    setPicker('showSaveFilePicker', picker)

    await expect(saveProjectFile('tour.mapvento.json', '{"name":"Tour"}', {
      kind: 'browser',
      handle: previousHandle,
    }, false)).resolves.toEqual({
      file: { kind: 'browser', handle: previousHandle },
      downloadStarted: false,
    })
    expect(previousHandle.createWritable).toHaveBeenCalledOnce()
    expect(picker).not.toHaveBeenCalled()

    await expect(saveProjectFile('tour.mapvento.json', '{"name":"Tour"}', {
      kind: 'browser',
      handle: previousHandle,
    }, true)).resolves.toEqual({
      file: { kind: 'browser', handle: selectedHandle },
      downloadStarted: false,
    })
    expect(picker).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('uses the Tauri commands for desktop open, save, and text export', async () => {
    tauriState.active = true
    vi.mocked(invoke)
      .mockResolvedValueOnce({ path: 'C:\\routes\\tour.json', content: '{"name":"Tour"}' })
      .mockResolvedValueOnce('C:\\routes\\tour.json')
      .mockResolvedValueOnce(true)

    await expect(openProjectFile()).resolves.toEqual({
      content: '{"name":"Tour"}',
      file: { kind: 'desktop', path: 'C:\\routes\\tour.json' },
    })
    await expect(saveProjectFile('tour.mapvento.json', '{"name":"Tour"}', {
      kind: 'desktop',
      path: 'C:\\routes\\tour.json',
    }, false)).resolves.toEqual({
      file: { kind: 'desktop', path: 'C:\\routes\\tour.json' },
      downloadStarted: false,
    })
    await expect(saveTextFile('tour.gpx', '<gpx/>', 'application/gpx+xml')).resolves.toBeUndefined()
    expect(invoke).toHaveBeenNthCalledWith(2, 'save_project_file', {
      filename: 'tour.mapvento.json',
      content: '{"name":"Tour"}',
      path: 'C:\\routes\\tour.json',
    })
    expect(invoke).toHaveBeenNthCalledWith(3, 'save_text_file', {
      filename: 'tour.gpx',
      content: '<gpx/>',
    })
  })

  it('does not report a cancelled desktop save as successful', async () => {
    tauriState.active = true
    vi.mocked(invoke).mockResolvedValueOnce(null)
    await expect(saveProjectFile('tour.mapvento.json', '{}', null, false))
      .rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reads imported files through the adapter and downloads when no picker is available', async () => {
    const file = { text: vi.fn().mockResolvedValue('contents') }
    await expect(readTextFile(file)).resolves.toBe('contents')

    const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await saveTextFile('data.json', '{}', 'application/json')
    expect(url).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:test')
  })
})
