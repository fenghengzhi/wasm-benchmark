const N: u32 = __N__u;

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
