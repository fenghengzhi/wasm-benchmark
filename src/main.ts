import init from 'bench-wasm'
import { initMandelbrot } from './bench-mandelbrot'
import { initSha256 } from './bench-sha256'
import { initMatmul } from './bench-matmul'
import { $ } from './utils'

async function main() {
  try {
    await init()
    initMandelbrot()
    initSha256()
    initMatmul()
    $('status').textContent = 'WASM 就绪，点击渲染开始测试'
  } catch (e) {
    $('status').textContent = `WASM 加载失败: ${e}`
  }
}

main()
