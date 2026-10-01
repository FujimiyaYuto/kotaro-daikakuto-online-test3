/*
 * camera.js — 複数ターゲット対応カメラ
 *
 * 「追従対象のリスト」全員を囲む範囲を計算し、その中心へ追従・必要ならズームアウトします。
 * Phase 1 は対象が1人なので普通の追従カメラとして動きますが、
 * 対戦時は setTargets() に全キャラを渡すだけで全員を画面に収める動きになります。
 */
(function (KG) {
  'use strict';
  const U = KG.util;

  class Camera {
    constructor(opts) {
      this.opts = opts.camera;
      this.minView = opts.view;
      this.bounds = opts.bounds;
      this.targets = [];
      this.x = 0; this.y = 0; this.zoom = 1;
      this.prev = { x: 0, y: 0, zoom: 1 };
      this.screenW = 1; this.screenH = 1;
    }

    setScreenSize(w, h) {
      this.screenW = Math.max(1, w);
      this.screenH = Math.max(1, h);
    }

    setTargets(targets) { this.targets = targets; }

    // zoom=1 の時に見えるワールド範囲（画面比率に応じて最低範囲より広がる）
    baseViewSize() {
      const aspect = this.screenW / this.screenH;
      const h = Math.max(this.minView.minHeight, this.minView.minWidth / aspect);
      return { w: h * aspect, h };
    }

    computeGoal() {
      if (this.targets.length === 0) return { x: this.x, y: this.y, zoom: this.zoom };
      let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
      for (const f of this.targets) {
        const bb = f.getBounds();
        l = Math.min(l, bb.left); r = Math.max(r, bb.right);
        t = Math.min(t, bb.top); b = Math.max(b, bb.bottom);
      }
      const pad = this.opts.padding;
      l -= pad.x; r += pad.x; t -= pad.y; b += pad.y;
      const base = this.baseViewSize();
      const zoom = U.clamp(Math.max((r - l) / base.w, (b - t) / base.h), 1, this.opts.maxZoomOut);
      return { x: (l + r) / 2, y: (t + b) / 2 + this.opts.focusOffsetY, zoom };
    }

    clampToBounds() {
      const base = this.baseViewSize();
      const halfW = (base.w * this.zoom) / 2;
      const halfH = (base.h * this.zoom) / 2;
      const B = this.bounds;
      this.x = (B.right - B.left) < halfW * 2 ? (B.left + B.right) / 2 : U.clamp(this.x, B.left + halfW, B.right - halfW);
      this.y = (B.bottom - B.top) < halfH * 2 ? (B.top + B.bottom) / 2 : U.clamp(this.y, B.top + halfH, B.bottom - halfH);
    }

    snap() {
      const g = this.computeGoal();
      this.x = g.x; this.y = g.y; this.zoom = g.zoom;
      this.clampToBounds();
      this.prev = { x: this.x, y: this.y, zoom: this.zoom };
    }

    update(dt) {
      this.prev.x = this.x; this.prev.y = this.y; this.prev.zoom = this.zoom;
      const g = this.computeGoal();
      const k = U.damp(this.opts.followSharpness, dt);
      this.x += (g.x - this.x) * k;
      this.y += (g.y - this.y) * k;
      this.zoom += (g.zoom - this.zoom) * U.damp(this.opts.zoomSharpness, dt);
      this.clampToBounds();
    }

    // 描画用: 補間済みの中心と倍率（画面px / ワールド単位）
    getView(alpha) {
      const zoom = U.lerp(this.prev.zoom, this.zoom, alpha);
      const base = this.baseViewSize();
      const viewH = base.h * zoom;
      return {
        cx: U.lerp(this.prev.x, this.x, alpha),
        cy: U.lerp(this.prev.y, this.y, alpha),
        scale: this.screenH / viewH,
        w: base.w * zoom,
        h: viewH,
      };
    }
  }

  KG.Camera = Camera;
})(window.KG = window.KG || {});
