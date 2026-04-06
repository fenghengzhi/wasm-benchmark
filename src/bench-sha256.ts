import { sha256 as sha256Wasm } from 'bench-wasm'
import { fmt, $ } from './utils'

// ── SHA-256 JS 实现（与 Rust 完全一致） ─────────────────────────────

const K_SHA = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0
}

function sha256Js(data: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667 >>> 0
  let h1 = 0xbb67ae85 >>> 0
  let h2 = 0x3c6ef372 >>> 0
  let h3 = 0xa54ff53a >>> 0
  let h4 = 0x510e527f >>> 0
  let h5 = 0x9b05688c >>> 0
  let h6 = 0x1f83d9ab >>> 0
  let h7 = 0x5be0cd19 >>> 0

  const bitLen = data.length * 8
  const msgLen = data.length + 1 + ((55 - data.length % 64 + 64) % 64) + 8
  const msg = new Uint8Array(msgLen)
  msg.set(data)
  msg[data.length] = 0x80
  const dv = new DataView(msg.buffer)
  dv.setUint32(msgLen - 8, (bitLen / 0x100000000) >>> 0, false)
  dv.setUint32(msgLen - 4, bitLen >>> 0, false)

  const w = new Uint32Array(64)
  for (let off = 0; off < msgLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (msg[off + i * 4] << 24)
           | (msg[off + i * 4 + 1] << 16)
           | (msg[off + i * 4 + 2] << 8)
           | msg[off + i * 4 + 3]
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }

    let a = h0, b = h1, c = h2, d = h3
    let e = h4, f = h5, g = h6, h = h7

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ ((~e >>> 0) & g)
      const temp1 = (h + s1 + ch + K_SHA[i] + w[i]) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) >>> 0

      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }

  const result = new Uint8Array(32)
  const rv = new DataView(result.buffer)
  rv.setUint32(0, h0, false)
  rv.setUint32(4, h1, false)
  rv.setUint32(8, h2, false)
  rv.setUint32(12, h3, false)
  rv.setUint32(16, h4, false)
  rv.setUint32(20, h5, false)
  rv.setUint32(24, h6, false)
  rv.setUint32(28, h7, false)
  return result
}

function hexDigest(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function initSha256() {
  const shaSize       = $('shaSize') as HTMLSelectElement
  const btnSha        = $('btnSha') as HTMLButtonElement
  const shaTimeJs     = $('shaTimeJs')
  const shaTimeWasm   = $('shaTimeWasm')
  const shaTimeCrypto = $('shaTimeCrypto')
  const shaStatus     = $('shaStatus')
  const shaHashJs     = $('shaHashJs')
  const shaHashWasm   = $('shaHashWasm')
  const shaHashCrypto = $('shaHashCrypto')

  btnSha.addEventListener('click', async () => {
    const sizeMB = parseInt(shaSize.value)
    btnSha.disabled = true
    shaStatus.textContent = `生成 ${sizeMB} MB 测试数据...`
    shaStatus.className = 'running'
    shaTimeJs.textContent = shaTimeWasm.textContent = shaTimeCrypto.textContent = '...'
    shaHashJs.textContent = shaHashWasm.textContent = shaHashCrypto.textContent = ''

    await new Promise(r => setTimeout(r, 16))

    const data = new Uint8Array(sizeMB * 1024 * 1024)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 256) | 0

    // Warmup
    shaStatus.textContent = 'JS JIT 预热中...'
    await new Promise(r => setTimeout(r, 16))
    const warmup = new Uint8Array(16 * 1024)
    for (let i = 0; i < warmup.length; i++) warmup[i] = i & 0xff
    for (let i = 0; i < 100; i++) sha256Js(warmup)

    const RUNS = 5

    // JS
    shaStatus.textContent = 'JS SHA-256 计算中 (5 轮)...'
    await new Promise(r => setTimeout(r, 16))
    let jsHash!: Uint8Array
    const t0 = performance.now()
    for (let r = 0; r < RUNS; r++) jsHash = sha256Js(data)
    const jsTime = (performance.now() - t0) / RUNS
    shaTimeJs.textContent = fmt(jsTime)
    shaHashJs.textContent = hexDigest(jsHash).slice(0, 16) + '…'

    // WASM
    shaStatus.textContent = 'WASM SHA-256 计算中 (5 轮)...'
    await new Promise(r => setTimeout(r, 16))
    let wasmHash!: Uint8Array
    const t1 = performance.now()
    for (let r = 0; r < RUNS; r++) wasmHash = sha256Wasm(data)
    const wasmTime = (performance.now() - t1) / RUNS
    shaTimeWasm.textContent = fmt(wasmTime)
    shaHashWasm.textContent = hexDigest(new Uint8Array(wasmHash)).slice(0, 16) + '…'

    // Crypto API
    shaStatus.textContent = 'Crypto API SHA-256 计算中 (5 轮)...'
    await new Promise(r => setTimeout(r, 16))
    let cryptoHash!: Uint8Array
    const t2 = performance.now()
    for (let r = 0; r < RUNS; r++) cryptoHash = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
    const cryptoTime = (performance.now() - t2) / RUNS
    shaTimeCrypto.textContent = fmt(cryptoTime)
    shaHashCrypto.textContent = hexDigest(cryptoHash).slice(0, 16) + '…'

    const jHex = hexDigest(jsHash)
    const wHex = hexDigest(new Uint8Array(wasmHash))
    const cHex = hexDigest(cryptoHash)
    const match = jHex === wHex && wHex === cHex

    const times = [
      { name: 'JS', time: jsTime },
      { name: 'WASM', time: wasmTime },
      { name: 'Crypto API', time: cryptoTime },
    ].sort((a, b) => a.time - b.time)

    const fastest = times[0]
    const slowest = times[2]
    const ratio = (slowest.time / fastest.time).toFixed(2)

    shaStatus.textContent = match
      ? `✓ 哈希一致 | ${fastest.name} 最快，比 ${slowest.name} 快 ${ratio}×`
      : `✗ 哈希不一致！JS: ${jHex.slice(0, 8)}… WASM: ${wHex.slice(0, 8)}… Crypto: ${cHex.slice(0, 8)}…`
    shaStatus.className = ''
    btnSha.disabled = false
  })

  btnSha.disabled = false
}
