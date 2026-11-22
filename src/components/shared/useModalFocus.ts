import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'

const focusableSelector = [
  'a[href]', 'button:not(:disabled)', 'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)', 'textarea:not(:disabled)', 'summary', '[tabindex]:not([tabindex="-1"])',
].join(',')

type Modal = { dialog: HTMLElement; layer: HTMLElement; previousZIndex: string }
const modalStack: Modal[] = []
let modalSequence = 0

function focusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
    if (element.tabIndex < 0 || element.closest('[inert], [hidden]')) return false
    if (element instanceof HTMLInputElement && element.type === 'radio' && element.name) {
      const group = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
        .filter((radio) => radio.name === element.name && radio.form === element.form && !radio.disabled)
      const selected = group.find((radio) => radio.checked) ?? group[0]
      if (selected !== element) return false
    }
    for (let ancestor: HTMLElement | null = element; ancestor && ancestor !== dialog; ancestor = ancestor.parentElement) {
      const style = window.getComputedStyle(ancestor)
      if (style.display === 'none' || style.visibility === 'hidden') return false
    }
    return true
  })
}

function focusIfAvailable(element: HTMLElement | null) {
  if (!element?.isConnected || element === document.body || element === document.documentElement ||
      element.closest('[inert], [hidden]')) return false
  element.focus()
  return document.activeElement === element
}

export function useModalFocus<T extends HTMLElement>(
  onClose: () => void,
  options?: { initialFocus?: string; restoreFocus?: HTMLElement | null },
) {
  const dialogRef = useRef<T>(null)
  const closeRef = useRef(onClose)
  const optionsRef = useRef(options)
  const previousRef = useRef<HTMLElement | null | undefined>(undefined)

  useLayoutEffect(() => {
    closeRef.current = onClose
  })

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (previousRef.current === undefined) {
      previousRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    const previous = previousRef.current
    const restore = optionsRef.current?.restoreFocus
    const underlying = modalStack.at(-1)
    if (underlying) underlying.layer.inert = true
    const parent = dialog.parentElement
    const layer = parent && parent !== document.body && parent.parentElement === document.body ? parent : dialog
    const modal = { dialog, layer, previousZIndex: layer.style.zIndex }
    if (!modalStack.length) modalSequence = 0
    layer.style.zIndex = String(5000 + modalSequence++ * 2)
    modalStack.push(modal)
    const initial = optionsRef.current?.initialFocus
      ? dialog.querySelector<HTMLElement>(optionsRef.current.initialFocus)
      : null
    if (!focusIfAvailable(initial)) dialog.focus()

    return () => {
      const index = modalStack.indexOf(modal)
      if (index < 0) return
      const wasTop = index === modalStack.length - 1
      modalStack.splice(index, 1)
      layer.style.zIndex = modal.previousZIndex
      const next = modalStack.at(-1)
      if (wasTop && next) next.layer.inert = false
      if (!wasTop) return
      window.setTimeout(() => {
        const top = modalStack.at(-1)
        if (top && top !== next) return
        const active = document.activeElement
        if (active instanceof HTMLElement && active.isConnected &&
            active !== document.body && active !== document.documentElement &&
            !dialog.contains(active) && (!top || top.dialog.contains(active))) return
        if (top) {
          if (previous && top.dialog.contains(previous) && focusIfAvailable(previous)) return
          if (restore && top.dialog.contains(restore) && focusIfAvailable(restore)) return
          focusIfAvailable(top.dialog)
        } else if (!focusIfAvailable(restore ?? previous) && !focusIfAvailable(previous)) {
          focusIfAvailable(document.querySelector<HTMLElement>('[aria-label="Hauptmenü"]'))
        }
      }, 0)
    }
  }, [])

  function onKeyDown(event: KeyboardEvent<T>) {
    const dialog = dialogRef.current
    if (!dialog || modalStack.at(-1)?.dialog !== dialog || event.defaultPrevented) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeRef.current()
      return
    }
    if (event.key !== 'Tab') return
    const controls = focusableElements(dialog)
    if (!controls.length) {
      event.preventDefault()
      dialog.focus()
      return
    }
    const first = controls[0]
    const last = controls[controls.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  return { dialogRef, onKeyDown }
}
