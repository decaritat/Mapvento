export function formatNumber(value: number, minimumFractionDigits = 0, maximumFractionDigits = minimumFractionDigits) {
  return value.toLocaleString('de-DE', { minimumFractionDigits, maximumFractionDigits })
}

export function formatNumberInput(value: number) {
  return String(value).replace('.', ',')
}

export function parseNumberInput(value: string): number | null {
  const text = value.trim()
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null
  const number = Number(text.replace(',', '.'))
  return Number.isFinite(number) ? number : null
}
