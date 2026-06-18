// ディゾルブ（溶けるように消す/現す）エフェクト。PixiJS v8 のカスタム Filter。
//
// ノイズ値がしきい値 uAmount 未満のピクセルを透明にして「バラバラに欠けていく」見た目を作り、
// しきい値境界の帯に発光色を足して“燃えるような縁”を出す。uAmount=0 で無傷、1 で全消失。
//
// Pixi のフィルタは premultiplied-alpha 空間で動くので、texture() の rgb は a 済み。
// 縁の発光も a を掛けて加算し、整合を保つ。
import { Filter, GlProgram } from 'pixi.js';

// 既定の filter 頂点シェーダ（v8 規約。aPosition→クリップ座標＋vTextureCoord）。
const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
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
uniform float uAmount;        // 0=無傷, 1=全消失
uniform vec3 uEdgeColor;      // 縁の発光色（0..1）
uniform float uEdgeIntensity; // 縁の発光の強さ
uniform float uEdgeWidth;     // 縁の帯の幅
uniform float uScale;         // ノイズの粗さ（大きいほど細かい）

// 値ノイズ（ハッシュ→bilinear 補間）。外部テクスチャ不要で軽い。
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main(void) {
    vec4 color = texture(uTexture, vTextureCoord);
    float n = noise(vTextureCoord * uScale);
    if (n < uAmount) {
        finalColor = vec4(0.0);   // しきい値以下は消す（透明）
        return;
    }
    // しきい値直上の帯に発光色を加算（premultiplied なので a を掛ける）。
    float band = 1.0 - smoothstep(uAmount, uAmount + uEdgeWidth, n);
    vec3 rgb = color.rgb + uEdgeColor * color.a * band * uEdgeIntensity;
    finalColor = vec4(rgb, color.a);
}
`;

/**
 * ディゾルブ Filter を生成。uniforms は filter.resources.dissolveUniforms.uniforms で読み書きする。
 * @returns {Filter}
 */
export function createDissolveFilter() {
  return new Filter({
    glProgram: GlProgram.from({ vertex, fragment }),
    resources: {
      dissolveUniforms: {
        uAmount: { value: 0.0, type: 'f32' },
        uEdgeColor: { value: [0.5, 0.85, 1.0], type: 'vec3<f32>' },
        uEdgeIntensity: { value: 1.6, type: 'f32' },
        uEdgeWidth: { value: 0.08, type: 'f32' },
        uScale: { value: 7.0, type: 'f32' },
      },
    },
  });
}
