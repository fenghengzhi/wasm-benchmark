import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import glsl from 'vite-plugin-glsl'

export default defineConfig({
  plugins: [wasm(), glsl({ minify: true })],
})
