export function fmt(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(1)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

export function $(id: string): HTMLElement {
  return document.getElementById(id)!
}
