#version 300 es
precision highp float;

uniform sampler2D uA;
uniform sampler2D uB;
uniform int uN;
out float outColor;

void main() {
  int row = int(gl_FragCoord.y - 0.5);
  int col = int(gl_FragCoord.x - 0.5);
  float sum = 0.0;
  for (int k = 0; k < __N__; k++) {
    float a = texelFetch(uA, ivec2(k, row), 0).r;
    float b = texelFetch(uB, ivec2(col, k), 0).r;
    sum += a * b;
  }
  outColor = sum;
}
