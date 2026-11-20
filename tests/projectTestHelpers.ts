import { act } from 'react'

export async function importStoredProject(container: ParentNode) {
  const project = localStorage.getItem('mapvento-project')
  if (!project) throw new Error('Stored project fixture is missing')
  const menuButton = container.querySelector<HTMLButtonElement>('[aria-label="Hauptmenü"]')
  if (!menuButton) throw new Error('Project menu button is missing')
  await act(async () => menuButton.click())
  const openAction = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    .find((button) => button.textContent?.trim() === 'Projekt öffnen')
  if (!openAction) throw new Error('Project open action is missing')
  await act(async () => openAction.click())
  const input = container.querySelector<HTMLInputElement>('input[accept=".json,.mapvento.json"]')
  if (!input) throw new Error('Project import input is missing')
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ text: async () => project }],
  })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
