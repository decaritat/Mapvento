import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

export async function openExternalUrl(url: string) {
  if (isTauri()) {
    try {
      await openUrl(url)
      return
    } catch (error) {
      console.error('Link konnte nicht geöffnet werden', error)
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
