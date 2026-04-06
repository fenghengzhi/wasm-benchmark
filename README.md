# WASM Benchmark Suite

浏览器端 JavaScript vs WebAssembly vs GPU 性能对比测试套件。

## Benchmarks

### 1. Mandelbrot Rendering
- **测试重点**：浮点密集计算 (f64 乘加、分支迭代)
- **对比**：JS vs WASM
- 相同算法渲染 Mandelbrot 分形，逐像素迭代计算

### 2. SHA-256 Hashing
- **测试重点**：int32 位运算 (位移、异或、旋转)
- **对比**：JS vs WASM vs Crypto API
- 相同的 SHA-256 实现，JS 和 Rust 代码逻辑完全一致

### 3. Int32 Matrix Multiplication
- **测试重点**：SIMD 向量化 + GPU 并行计算 (int32 乘加)
- **对比**：JS vs WASM SIMD vs WebGPU vs WebGL
- JS 版针对 V8 自动向量化优化，WASM 版使用手写 i32x4 SIMD intrinsics

## Tech Stack

| 层 | 技术 |
|---|---|
| 前端 | TypeScript + Vite |
| WASM | Rust + wasm-bindgen + wasm-pack |
| GPU | WebGPU (WGSL compute shader) + WebGL2 (GLSL fragment shader) |

## 项目结构

```
├── src/
│   ├── main.ts              # 入口：初始化 WASM，调用各模块
│   ├── bench-mandelbrot.ts   # Mandelbrot 渲染对比
│   ├── bench-sha256.ts       # SHA-256 三方对比
│   ├── bench-matmul.ts       # 矩阵乘法四方对比
│   └── utils.ts              # 共享工具函数
├── wasm-lib/
│   ├── src/lib.rs            # Rust 实现 (Mandelbrot + SHA-256 + SIMD matmul)
│   ├── Cargo.toml
│   └── .cargo/config.toml    # 启用 SIMD128
├── index.html
├── vite.config.ts
└── package.json
```

## 开发

```bash
# 安装依赖
npm install

# 编译 WASM
npm run build:wasm

# 启动开发服务器
npm run dev
```

### 前置要求

- Node.js
- Rust + wasm-pack (`cargo install wasm-pack`)
- wasm-opt (可选，用于优化 WASM 体积)
