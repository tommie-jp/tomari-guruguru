import { describe, it, expect } from 'vitest';
import { yawTiltBiasDeg } from './yaw-roll-trim';

const DEG = Math.PI / 180;

describe('yawTiltBiasDeg（左右のかしげ差 b の実行時差し引き量）', () => {
  it('正面(yawRel=0)では 0（b の影響なし＝roll-a のみ）', () => {
    expect(yawTiltBiasDeg(0, 8)).toBe(0);
  });

  it('右を向く(yawRel>knee)と満額 +b、左(yawRel<-knee)と満額 -b', () => {
    // knee=5°。10°右 → +8、10°左 → -8。
    expect(yawTiltBiasDeg(10 * DEG, 8)).toBeCloseTo(8, 6);
    expect(yawTiltBiasDeg(-10 * DEG, 8)).toBeCloseTo(-8, 6);
  });

  it('押下姿勢(5°以上)で満額 b ＝ 校正姿勢がちょうど垂直になる根拠', () => {
    // 方向校正は最小振り角 5° でしか効かない。5° ちょうどでも満額 b。
    expect(yawTiltBiasDeg(5 * DEG, 8)).toBeCloseTo(8, 6);
    expect(yawTiltBiasDeg(30 * DEG, 8)).toBeCloseTo(8, 6); // 振り切っても満額据え置き
  });

  it('正面付近(±knee)は線形ランプ（段差ジッター防止）', () => {
    // 2.5°（knee の半分）→ b の半分。
    expect(yawTiltBiasDeg(2.5 * DEG, 8)).toBeCloseTo(4, 6);
  });

  it('b=0／非有限な yawRel は 0（後方互換・落ちない）', () => {
    expect(yawTiltBiasDeg(10 * DEG, 0)).toBe(0);
    expect(yawTiltBiasDeg(Number.NaN, 8)).toBe(0);
    expect(yawTiltBiasDeg(10 * DEG, Number.NaN)).toBe(0);
  });

  it('符号: 右で記録した b は左向きで逆符号に効く（roll-a-b ↔ roll-a+b）', () => {
    const b = 6;
    expect(yawTiltBiasDeg(20 * DEG, b)).toBeCloseTo(b, 6); // 右: -b される（呼び出し側が減算）
    expect(yawTiltBiasDeg(-20 * DEG, b)).toBeCloseTo(-b, 6); // 左: -(-b)=+b される
  });
});
