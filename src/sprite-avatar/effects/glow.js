// 外周グロー（発光ハロー）エフェクト。PixiJS v8 の単一パス・カスタム Filter。
//
// pixi-filters の GlowFilter は v8 のこの構成で描画されなかったため、dissolve と同じ
// 「自作単一パス GLSL」方式で実装する（実証済みで確実に描画される）。
//
// 各フラグメントで周囲のアルファを環状サンプリングし、近傍のキャラ密度（=エッジへの
// 近さ）を重み付き平均で求めて発光量にする。premultiplied の src-over 合成なので、
// 不透明なキャラ本体には乗らず、透明な周囲だけにハローが出る（＝アウターグロー）。
import { Filter, GlProgram } from 'pixi.js';

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform highp vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void ) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void ) {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;    // (w, h, 1/w, 1/h) — Pixi が供給
uniform highp vec4 uInputClamp;   // (minU, minV, maxU, maxV) — 入力領域外サンプルを防ぐ
uniform float uDistance;    // グロー半径(px)
uniform float uStrength;    // 強さ
uniform vec3 uColor;        // グロー色(0..1)

const int DIRS = 16;
const int RINGS = 4;
const float TAU = 6.2831853;

void main(void) {
    vec4 src = texture(uTexture, vTextureCoord);

    // 周囲のアルファを環状に重み付き平均（外側ほど軽く）してハロー量を作る。
    float acc = 0.0;
    float total = 0.0;
    for (int r = 1; r <= RINGS; r++) {
        float radius = uDistance * float(r) / float(RINGS);
        float w = 1.0 - (float(r) - 1.0) / float(RINGS);
        for (int d = 0; d < DIRS; d++) {
            float ang = (float(d) / float(DIRS)) * TAU;
            vec2 off = vec2(cos(ang), sin(ang)) * radius * uInputSize.zw;
            vec2 sc = clamp(vTextureCoord + off, uInputClamp.xy, uInputClamp.zw);
            acc += texture(uTexture, sc).a * w;
            total += w;
        }
    }
    float glow = clamp((acc / total) * uStrength, 0.0, 1.0);

    // glow を下、src を上に premultiplied で合成（不透明部にはハローが乗らない）。
    vec3 glowRgb = uColor * glow;
    vec3 outRgb = src.rgb + glowRgb * (1.0 - src.a);
    float outA = src.a + glow * (1.0 - src.a);
    finalColor = vec4(outRgb, outA);
}
`;

/**
 * 外周グロー Filter を生成。uniforms は filter.resources.glowUniforms.uniforms。
 * @returns {Filter}
 */
export function createGlowFilter() {
  const distance = 18;
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex, fragment }),
    resources: {
      glowUniforms: {
        uDistance: { value: distance, type: 'f32' },
        uStrength: { value: 3.0, type: 'f32' },
        uColor: { value: [0.62, 0.85, 1.0], type: 'vec3<f32>' },
      },
    },
  });
  // 透明な周囲へハローが滲み出る余白を確保（sprite 外側まで描けるように）。
  filter.padding = Math.ceil(distance) + 2;
  return filter;
}
