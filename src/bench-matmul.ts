import { matmul_i32_simd } from 'bench-wasm'
import { fmt, $ } from './utils'

// JS 版本：转置 B + Int32Array 顺序访问，最大化 V8 自动向量化可能性
function matmulJs32(a: Int32Array, b: Int32Array, n: number): Int32Array {
  const bt = new Int32Array(n * n)
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      bt[j * n + i] = b[i * n + j]

  const c = new Int32Array(n * n)
  for (let i = 0; i < n; i++) {
    const ri = i * n
    for (let j = 0; j < n; j++) {
      const rj = j * n
      let sum = 0
      for (let k = 0; k < n; k++) {
        sum = (sum + a[ri + k] * bt[rj + k]) | 0
      }
      c[ri + j] = sum
    }
  }
  return c
}

// WebGPU 版本
async function benchWebGPU(a: Int32Array, b: Int32Array, n: number, runs: number): Promise<{ result: Int32Array, time: number }> {
  if (!navigator.gpu) throw new Error('WebGPU not supported')
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('No GPU adapter')
  const device = await adapter.requestDevice()

  const shader = device.createShaderModule({ code: `
    const N: u32 = ${n}u;
    @group(0) @binding(0) var<storage, read> a: array<i32>;
    @group(0) @binding(1) var<storage, read> b: array<i32>;
    @group(0) @binding(2) var<storage, read_write> c: array<i32>;

    @compute @workgroup_size(16, 16)
    fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
      let row = gid.y;
      let col = gid.x;
      if (row >= N || col >= N) { return; }
      var sum: i32 = 0;
      for (var k: u32 = 0u; k < N; k = k + 1u) {
        sum = sum + a[row * N + k] * b[k * N + col];
      }
      c[row * N + col] = sum;
    }
  `})

  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shader, entryPoint: 'main' }
  })

  const size = n * n * 4
  const bufA = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
  const bufB = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
  const bufC = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
  const bufRead = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })

  device.queue.writeBuffer(bufA, 0, a)
  device.queue.writeBuffer(bufB, 0, b)

  const bg = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: bufA } },
      { binding: 1, resource: { buffer: bufB } },
      { binding: 2, resource: { buffer: bufC } },
    ]
  })

  const wg = Math.ceil(n / 16)

  // 预热一轮
  {
    const enc = device.createCommandEncoder()
    const pass = enc.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bg)
    pass.dispatchWorkgroups(wg, wg)
    pass.end()
    device.queue.submit([enc.finish()])
    await device.queue.onSubmittedWorkDone()
  }

  // 正式计时
  const t0 = performance.now()
  for (let r = 0; r < runs; r++) {
    const enc = device.createCommandEncoder()
    const pass = enc.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bg)
    pass.dispatchWorkgroups(wg, wg)
    pass.end()
    if (r === runs - 1) enc.copyBufferToBuffer(bufC, 0, bufRead, 0, size)
    device.queue.submit([enc.finish()])
    await device.queue.onSubmittedWorkDone()
  }
  const time = (performance.now() - t0) / runs

  await bufRead.mapAsync(GPUMapMode.READ)
  const result = new Int32Array(new Int32Array(bufRead.getMappedRange()).slice(0))
  bufRead.unmap()

  bufA.destroy(); bufB.destroy(); bufC.destroy(); bufRead.destroy()
  device.destroy()
  return { result, time }
}

// WebGL 版本（GPGPU：用 fragment shader 做矩阵乘法，float32 精度）
function benchWebGL(a: Int32Array, b: Int32Array, n: number, runs: number): { result: Int32Array, time: number } {
  const canvas = document.createElement('canvas')
  canvas.width = n
  canvas.height = n
  const gl = canvas.getContext('webgl2')
  if (!gl) throw new Error('WebGL2 not supported')

  // 将 int32 矩阵编码为 float32 纹理（值 0-99，float32 精确表示）
  const aF = new Float32Array(a)
  const bF = new Float32Array(b)

  function createDataTexture(gl: WebGL2RenderingContext, data: Float32Array, w: number, h: number): WebGLTexture {
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  const texA = createDataTexture(gl, aF, n, n)
  const texB = createDataTexture(gl, bF, n, n)

  // Fullscreen quad
  const vsSource = `#version 300 es
    in vec2 pos;
    void main() { gl_Position = vec4(pos, 0.0, 1.0); }
  `
  const fsSource = `#version 300 es
    precision highp float;
    uniform sampler2D uA;
    uniform sampler2D uB;
    uniform int uN;
    out float outColor;
    void main() {
      int row = int(gl_FragCoord.y - 0.5);
      int col = int(gl_FragCoord.x - 0.5);
      float sum = 0.0;
      for (int k = 0; k < ${n}; k++) {
        float a = texelFetch(uA, ivec2(k, row), 0).r;
        float b = texelFetch(uB, ivec2(col, k), 0).r;
        sum += a * b;
      }
      outColor = sum;
    }
  `

  function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)!)
    return s
  }

  const prog = gl.createProgram()!
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vsSource))
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fsSource))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog)!)
  gl.useProgram(prog)

  // Fullscreen quad buffer
  const quadBuf = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW)
  const posLoc = gl.getAttribLocation(prog, 'pos')
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  // Uniforms
  gl.uniform1i(gl.getUniformLocation(prog, 'uA'), 0)
  gl.uniform1i(gl.getUniformLocation(prog, 'uB'), 1)
  gl.uniform1i(gl.getUniformLocation(prog, 'uN'), n)

  // 启用 float color buffer 扩展（R32F 作为 FBO attachment 必须）
  gl.getExtension('EXT_color_buffer_float')

  // FBO with R32F output（先创建 FBO，再绑定输入纹理，避免 active texture unit 冲突）
  const outTex = gl.createTexture()!
  gl.activeTexture(gl.TEXTURE2)
  gl.bindTexture(gl.TEXTURE_2D, outTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, n, n, 0, gl.RED, gl.FLOAT, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0)
  gl.viewport(0, 0, n, n)

  // 绑定输入纹理到 unit 0 和 1
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texA)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, texB)

  // 预热
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  gl.finish()

  // 正式计时（readPixels 强制 GPU 同步，确保计时准确）
  const outF = new Float32Array(n * n)
  const t0 = performance.now()
  for (let r = 0; r < runs; r++) {
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.readPixels(0, 0, n, n, gl.RED, gl.FLOAT, outF)
  }
  const time = (performance.now() - t0) / runs
  const result = new Int32Array(n * n)
  for (let i = 0; i < n * n; i++) result[i] = Math.round(outF[i])

  // 清理
  gl.deleteTexture(texA)
  gl.deleteTexture(texB)
  gl.deleteTexture(outTex)
  gl.deleteFramebuffer(fbo)
  gl.deleteBuffer(quadBuf)
  gl.deleteProgram(prog)
  const ext = gl.getExtension('WEBGL_lose_context')
  if (ext) ext.loseContext()

  return { result, time }
}

export function initMatmul() {
  const matSize       = $('matSize') as HTMLSelectElement
  const btnMat        = $('btnMat') as HTMLButtonElement
  const matTimeJs     = $('matTimeJs')
  const matTimeWasm   = $('matTimeWasm')
  const matTimeGpu    = $('matTimeGpu')
  const matTimeGl  = $('matTimeGl')
  const matInfoJs     = $('matInfoJs')
  const matInfoWasm   = $('matInfoWasm')
  const matInfoGpu    = $('matInfoGpu')
  const matInfoGl  = $('matInfoGl')
  const matStatus     = $('matStatus')

  btnMat.addEventListener('click', async () => {
    const n = parseInt(matSize.value)
    btnMat.disabled = true
    matStatus.textContent = `生成 ${n}×${n} 随机矩阵...`
    matStatus.className = 'running'
    matTimeJs.textContent = matTimeWasm.textContent = matTimeGpu.textContent = matTimeGl.textContent = '...'
    matInfoJs.textContent = matInfoWasm.textContent = matInfoGpu.textContent = matInfoGl.textContent = ''

    await new Promise(r => setTimeout(r, 16))

    const a = new Int32Array(n * n)
    const b = new Int32Array(n * n)
    for (let i = 0; i < n * n; i++) {
      a[i] = (Math.random() * 100) | 0
      b[i] = (Math.random() * 100) | 0
    }

    const RUNS = 5

    // JS 预热
    matStatus.textContent = 'JS JIT 预热中...'
    await new Promise(r => setTimeout(r, 16))
    const wn = Math.min(n, 128)
    const wa = new Int32Array(wn * wn)
    const wb = new Int32Array(wn * wn)
    for (let i = 0; i < wn * wn; i++) { wa[i] = (Math.random() * 100) | 0; wb[i] = (Math.random() * 100) | 0 }
    for (let i = 0; i < 50; i++) matmulJs32(wa, wb, wn)

    // JS
    matStatus.textContent = `JS 矩阵乘法 (${RUNS} 轮)...`
    await new Promise(r => setTimeout(r, 16))
    let jsResult!: Int32Array
    const t0 = performance.now()
    for (let r = 0; r < RUNS; r++) jsResult = matmulJs32(a, b, n)
    const jsTime = (performance.now() - t0) / RUNS
    matTimeJs.textContent = fmt(jsTime)
    matInfoJs.textContent = `C[0]=${jsResult[0]}`

    // WASM SIMD
    matStatus.textContent = `WASM SIMD 矩阵乘法 (${RUNS} 轮)...`
    await new Promise(r => setTimeout(r, 16))
    let wasmResult!: Int32Array
    const t1 = performance.now()
    for (let r = 0; r < RUNS; r++) wasmResult = new Int32Array(matmul_i32_simd(a, b, n))
    const wasmTime = (performance.now() - t1) / RUNS
    matTimeWasm.textContent = fmt(wasmTime)
    matInfoWasm.textContent = `C[0]=${wasmResult[0]}`

    // WebGPU
    let gpuTime = -1
    let gpuResult: Int32Array | null = null
    try {
      matStatus.textContent = `WebGPU 矩阵乘法 (${RUNS} 轮)...`
      await new Promise(r => setTimeout(r, 16))
      const res = await benchWebGPU(a, b, n, RUNS)
      gpuTime = res.time
      gpuResult = res.result
      matTimeGpu.textContent = fmt(gpuTime)
      matInfoGpu.textContent = `C[0]=${gpuResult[0]}`
    } catch (e) {
      matTimeGpu.textContent = '不支持'
      matInfoGpu.textContent = String(e)
      console.error('WebGPU error:', e)
    }

    // WebGL
    let glTime = -1
    let glResult: Int32Array | null = null
    try {
      matStatus.textContent = `WebGL 矩阵乘法 (${RUNS} 轮)...`
      await new Promise(r => setTimeout(r, 16))
      const res = benchWebGL(a, b, n, RUNS)
      glTime = res.time
      glResult = res.result
      matTimeGl.textContent = fmt(glTime)
      matInfoGl.textContent = `C[0]=${glResult[0]}`
    } catch (e) {
      matTimeGl.textContent = '不支持'
      matInfoGl.textContent = String(e)
      console.error('WebGL error:', e)
    }

    // 校验结果一致性
    const check = (name: string, result: Int32Array | null) => {
      if (!result) return '—'
      for (let i = 0; i < n * n; i++) {
        if (result[i] !== jsResult[i]) return `✗ ${name} 不一致`
      }
      return ''
    }
    const wasmCheck = check('WASM', wasmResult)
    const gpuCheck = check('WebGPU', gpuResult)
    const glCheck = check('WebGL', glResult)
    const errors = [wasmCheck, gpuCheck, glCheck].filter(Boolean)

    const times = [
      { name: 'JS', time: jsTime },
      { name: 'WASM SIMD', time: wasmTime },
      ...(gpuTime >= 0 ? [{ name: 'WebGPU', time: gpuTime }] : []),
      ...(glTime >= 0 ? [{ name: 'WebGL', time: glTime }] : []),
    ].sort((a, b) => a.time - b.time)

    const fastest = times[0]
    const slowest = times[times.length - 1]
    const ratio = (slowest.time / fastest.time).toFixed(2)

    const errMsg = errors.length > 0 ? ` | ${errors.join(', ')}` : ' | ✓ 结果一致'
    matStatus.textContent = `${fastest.name} 最快，比 ${slowest.name} 快 ${ratio}×${errMsg}`
    matStatus.className = ''
    btnMat.disabled = false
  })

  btnMat.disabled = false
}
