import { render_mandelbrot } from 'bench-wasm'
import { fmt, $ } from './utils'

// ── 与 Rust 完全相同的算法与着色逻辑 ────────────────────────────────
const X_MIN = -2.5, X_MAX = 1.0, Y_MIN = -1.2, Y_MAX = 1.2

function renderMandelbrotJs(width: number, height: number, maxIter: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const cx = X_MIN + px * (X_MAX - X_MIN) / width
      const cy = Y_MIN + py * (Y_MAX - Y_MIN) / height
      let zx = 0.0, zy = 0.0, iter = 0
      while (zx * zx + zy * zy <= 4.0 && iter < maxIter) {
        const tmp = zx * zx - zy * zy + cx
        zy = 2.0 * zx * zy + cy
        zx = tmp
        iter++
      }
      const idx = (py * width + px) * 4
      if (iter < maxIter) {
        const t = iter / maxIter
        pixels[idx]     = (9.0  * (1-t) * t*t*t * 255) | 0
        pixels[idx + 1] = (15.0 * (1-t)*(1-t) * t*t * 255) | 0
        pixels[idx + 2] = (8.5  * (1-t)*(1-t)*(1-t) * t * 255) | 0
      }
      pixels[idx + 3] = 255
    }
  }
  return pixels
}

function drawPixels(canvas: HTMLCanvasElement, pixels: Uint8ClampedArray, w: number, h: number) {
  canvas.width  = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(new ImageData(pixels as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
}

export function initMandelbrot() {
  const iterSlider = $('iterSlider') as HTMLInputElement
  const iterVal    = $('iterVal')
  const resSelect  = $('resSelect') as HTMLSelectElement
  const btnRender  = $('btnRender') as HTMLButtonElement
  const canvasJs   = $('canvasJs') as HTMLCanvasElement
  const canvasWasm = $('canvasWasm') as HTMLCanvasElement
  const timeJs     = $('timeJs')
  const timeWasm   = $('timeWasm')
  const status     = $('status')

  iterSlider.addEventListener('input', () => {
    iterVal.textContent = iterSlider.value
  })

  btnRender.addEventListener('click', () => {
    const maxIter = parseInt(iterSlider.value)
    const [w, h]  = resSelect.value.split('x').map(Number)

    btnRender.disabled = true
    status.textContent = '渲染中...'
    status.className = 'running'
    timeJs.textContent = timeWasm.textContent = '...'

    setTimeout(() => {
      const t0 = performance.now()
      const jsPixels = renderMandelbrotJs(w, h, maxIter)
      const jsTime = performance.now() - t0
      drawPixels(canvasJs, jsPixels, w, h)
      timeJs.textContent = fmt(jsTime)

      const t1 = performance.now()
      const wasmResult = render_mandelbrot(w, h, maxIter)
      const wasmTime = performance.now() - t1
      drawPixels(canvasWasm, new Uint8ClampedArray(wasmResult), w, h)
      timeWasm.textContent = fmt(wasmTime)

      const ratio = jsTime / wasmTime
      const msg = ratio >= 1
        ? `WASM 快 ${ratio.toFixed(2)}×`
        : `JS 快 ${(1 / ratio).toFixed(2)}×`
      status.textContent = msg
      status.className = ''
      btnRender.disabled = false
    }, 16)
  })

  btnRender.disabled = false
}
