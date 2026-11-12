import { invoke, isTauri } from '@tauri-apps/api/core'

export type BrowserProjectHandle = {
  getFile: () => Promise<File>
  createWritable: () => Promise<{
    write: (content: string) => Promise<void>
    close: () => Promise<void>
  }>
}

type FilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<BrowserProjectHandle>
  showOpenFilePicker?: (options: {
    types: Array<{ description: string; accept: Record<string, string[]> }>
    multiple: boolean
  }) => Promise<BrowserProjectHandle[]>
}

export type ProjectFileReference =
  | { kind: 'desktop'; path: string }
  | { kind: 'browser'; handle: BrowserProjectHandle }

export type OpenProjectFileResult =
  | { content: string; file: ProjectFileReference }
  | null
  | 'fallback'

export async function readTextFile(file: Pick<File, 'text'>) {
  return file.text()
}

export async function saveTextFile(filename: string, content: string, type: string) {
  if (isTauri()) {
    const saved = await invoke<boolean>('save_text_file', { filename, content })
    if (!saved) throw new DOMException('Save cancelled', 'AbortError')
    return
  }

  const savePicker = (window as FilePickerWindow).showSaveFilePicker
  if (savePicker) {
    const extension = filename.split('.').pop() ?? 'txt'
    const handle = await savePicker({
      suggestedName: filename,
      types: [{ description: type, accept: { [type]: [`.${extension}`] } }],
    })
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
    return
  }

  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export async function saveProjectFile(
  filename: string,
  content: string,
  currentFile: ProjectFileReference | null,
  saveAs: boolean,
): Promise<{ file: ProjectFileReference | null; downloadStarted: boolean }> {
  let selectedFile = saveAs ? null : currentFile
  if (isTauri()) {
    const path = await invoke<string | null>('save_project_file', {
      filename,
      content,
      path: selectedFile?.kind === 'desktop' ? selectedFile.path : null,
    })
    if (!path) throw new DOMException('Save cancelled', 'AbortError')
    return { file: { kind: 'desktop', path }, downloadStarted: false }
  }

  let handle = selectedFile?.kind === 'browser' ? selectedFile.handle : null
  const picker = (window as FilePickerWindow).showSaveFilePicker
  if (!handle && picker) {
    handle = await picker({
      suggestedName: filename,
      types: [{ description: 'application/json', accept: { 'application/json': ['.json'] } }],
    })
  }
  if (handle) {
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
    selectedFile = { kind: 'browser', handle }
    return { file: selectedFile, downloadStarted: false }
  }

  await saveTextFile(filename, content, 'application/json')
  return { file: selectedFile, downloadStarted: true }
}

export async function openProjectFile(): Promise<OpenProjectFileResult> {
  if (isTauri()) {
    const opened = await invoke<{ path: string; content: string } | null>('open_project_file')
    return opened ? { content: opened.content, file: { kind: 'desktop', path: opened.path } } : null
  }

  const picker = (window as FilePickerWindow).showOpenFilePicker
  if (!picker) return 'fallback'
  const [handle] = await picker({
    types: [{ description: 'Projektdatei', accept: { 'application/json': ['.json'] } }],
    multiple: false,
  })
  if (!handle) return null
  return {
    content: await (await handle.getFile()).text(),
    file: { kind: 'browser', handle },
  }
}
