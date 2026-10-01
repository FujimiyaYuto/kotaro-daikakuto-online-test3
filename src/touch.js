/*
 * touch.js — スマートフォン用タッチ操作
 *
 * 左側: フローティングスティック（左エリアのどこに親指を置いても、そこが中心になる）
 * 右側: アクションボタン群（data-action 属性を持つ要素を自動でボタン化）
 *
 * Pointer Events を pointerId ごとに追跡するので、
 * 「左で移動しながら右でジャンプ」などのマルチタッチが独立して動作します。
 * 右側に攻撃ボタンなどを追加する時は、HTML に data-action="attack" の要素を足し、
 * KG.ACTIONS に 'attack' を追加するだけで入力として届きます。
 */
(function (KG) {
  'use strict';

  class TouchControls {
    constructor(root, input) {
      this.root = root;
      this.input = input;

      // --- スティック ---
      this.zone = root.querySelector('#stick-zone');
      this.base = root.querySelector('.stick-base');
      this.knob = root.querySelector('.stick-knob');
      this.stickId = null;
      this.origin = { x: 0, y: 0 };
      this.radius = 50;
      this.deadzone = 0.2;   // 中心付近の遊び（半径比）
      this.fullAt = 0.6;     // 半径のこの割合まで倒すと最高速

      this.zone.addEventListener('pointerdown', (e) => this.onStickDown(e));
      this.zone.addEventListener('pointermove', (e) => this.onStickMove(e));
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        this.zone.addEventListener(t, (e) => this.onStickUp(e));
      }

      // --- ボタン ---
      this.buttons = [];
      for (const el of root.querySelectorAll('[data-action]')) this.bindButton(el);
    }

    setVisible(visible) {
      this.root.hidden = !visible;
      if (!visible) this.reset();
    }

    get visible() { return !this.root.hidden; }

    // ---------- スティック ----------
    onStickDown(e) {
      e.preventDefault();
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      try { this.zone.setPointerCapture(e.pointerId); } catch (_) { /* 未対応でも動作する */ }
      this.radius = Math.max(30, this.base.offsetWidth * 0.42);
      this.origin.x = e.clientX;
      this.origin.y = e.clientY;
      this.base.classList.add('active');
      this.updateStick(e.clientX, e.clientY);
    }

    onStickMove(e) {
      if (e.pointerId !== this.stickId) return;
      e.preventDefault();
      this.updateStick(e.clientX, e.clientY);
    }

    onStickUp(e) {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.base.classList.remove('active');
      this.base.style.left = '';
      this.base.style.top = '';
      this.knob.style.transform = '';
      this.input.setAxis('touch', 0, 0);
    }

    updateStick(px, py) {
      let dx = px - this.origin.x;
      let dy = py - this.origin.y;
      const dist = Math.hypot(dx, dy);
      const R = this.radius;
      // 指が半径より外へ出たら、中心を指の方へ引き寄せる（逆方向への切り返しが速くなる）
      if (dist > R) {
        const k = (dist - R) / dist;
        this.origin.x += dx * k;
        this.origin.y += dy * k;
        dx = px - this.origin.x;
        dy = py - this.origin.y;
      }
      const zr = this.zone.getBoundingClientRect();
      this.base.style.left = (this.origin.x - zr.left) + 'px';
      this.base.style.top = (this.origin.y - zr.top) + 'px';
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;

      // 横方向のみ使用（縦は将来の下入力などのために moveY として渡しておく）
      const nx = dx / R;
      const ny = dy / R;
      this.input.setAxis('touch', this.shape(nx), this.shape(ny));
    }

    shape(v) {
      const a = Math.abs(v);
      if (a < this.deadzone) return 0;
      const t = KG.util.clamp((a - this.deadzone) / (this.fullAt - this.deadzone), 0, 1);
      return Math.sign(v) * t;
    }

    // ---------- ボタン ----------
    bindButton(el) {
      const action = el.dataset.action;
      const pointers = new Set();
      const release = (e) => {
        if (!pointers.delete(e.pointerId)) return;
        this.input.setHeld(action, 'touch:' + e.pointerId, false);
        if (pointers.size === 0) el.classList.remove('pressed');
      };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pointers.add(e.pointerId);
        try { el.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
        this.input.setHeld(action, 'touch:' + e.pointerId, true);
        el.classList.add('pressed');
      });
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
      this.buttons.push({ el, action, pointers });
    }

    // 使えない間のボタン表示（必殺・泡）：暗く＋再使用待ちの残りを扇形で。泡の同時数が上限なら「blocked」
    updateCooldowns(fighter) {
      if (this.root.hidden) return;
      for (const b of this.buttons) {
        const kind = COOLDOWN_KINDS[b.action];
        if (!kind) continue;
        const av = fighter.availability(kind);
        const ratio = av ? av.ratio : 0;
        const blocked = !!(av && av.blocked);
        const key = ratio.toFixed(2) + (blocked ? 'b' : '');
        if (b.cdKey === key) continue;
        b.cdKey = key;
        b.el.classList.toggle('cooling', ratio > 0 || blocked);
        b.el.classList.toggle('blocked', blocked);
        const ring = b.el.querySelector('.cd-ring');
        if (ring) ring.style.setProperty('--cd', blocked ? '1' : key);
      }
    }

    reset() {
      if (this.stickId !== null) this.onStickUp({ pointerId: this.stickId });
      for (const b of this.buttons) {
        for (const id of b.pointers) this.input.setHeld(b.action, 'touch:' + id, false);
        b.pointers.clear();
        b.el.classList.remove('pressed');
      }
    }
  }

  // ボタンのアクション → 技の種類（使用可否の表示に使う）
  const COOLDOWN_KINDS = { special: 'Special', shoot: 'Shoot' };

  KG.TouchControls = TouchControls;
})(window.KG = window.KG || {});
