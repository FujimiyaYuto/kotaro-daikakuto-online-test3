/* util.js — 汎用の小さな数学ヘルパー */
(function (KG) {
  'use strict';

  KG.util = {
    clamp(v, min, max) { return v < min ? min : v > max ? max : v; },
    lerp(a, b, t) { return a + (b - a) * t; },
    // current を target に向けて最大 delta だけ近づける
    approach(current, target, delta) {
      if (current < target) return Math.min(current + delta, target);
      if (current > target) return Math.max(current - delta, target);
      return target;
    },
    // フレームレートに依存しない指数的な追従係数
    damp(sharpness, dt) { return 1 - Math.exp(-sharpness * dt); },
    sign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; },
    mod(a, n) { return ((a % n) + n) % n; },
    // 右向き基準の相対矩形（x: 中心から前方向, y: 足元から）を、向きを反映したワールド矩形に変換
    orientBox(ox, oy, facing, b) {
      const x = facing >= 0 ? ox + b.x : ox - b.x - b.w;
      return { x, y: oy + b.y, w: b.w, h: b.h };
    },
    rectsOverlap(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    },
  };
})(window.KG = window.KG || {});
