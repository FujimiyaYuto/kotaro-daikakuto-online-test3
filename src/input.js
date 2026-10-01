/*
 * input.js — 入力の抽象化
 *
 * キーボード・タッチなどの「入力元」は InputManager に
 *   - 移動軸 (setAxis)
 *   - アクションボタンの押下状態 (setHeld)
 * を書き込むだけ。キャラクターは入力元を知らず、毎ステップ poll() で得る
 * 「コマンド」{ moveX, moveY, held, pressed } だけを見て動きます。
 * 将来の CPU は同じ形のコマンドを返す poll() を持つオブジェクトを作れば差し替え可能です。
 */
(function (KG) {
  'use strict';

  // ボタンで入力するアクション一覧。将来の必殺技などはここに追加する（例: 'special'）
  KG.ACTIONS = ['jump', 'attack', 'special', 'shoot', 'guard'];

  KG.createEmptyCommand = function () {
    const held = {};
    const pressed = {};
    for (const a of KG.ACTIONS) { held[a] = false; pressed[a] = false; }
    return { moveX: 0, moveY: 0, held, pressed };
  };

  class InputManager {
    constructor() {
      this.axes = new Map();        // 入力元ID -> { x, y }
      this.holders = new Map();     // アクション -> Set(押している入力元キー)
      this.pressLatch = {};         // 次の poll まで「押された」を保持（短いタップの取りこぼし防止）
      for (const a of KG.ACTIONS) {
        this.holders.set(a, new Set());
        this.pressLatch[a] = false;
      }
    }

    setAxis(sourceId, x, y) {
      this.axes.set(sourceId, { x: x || 0, y: y || 0 });
    }

    setHeld(action, sourceKey, down) {
      const set = this.holders.get(action);
      if (!set) return;
      if (down) {
        if (!set.has(sourceKey)) {
          set.add(sourceKey);
          this.pressLatch[action] = true;
        }
      } else {
        set.delete(sourceKey);
      }
    }

    releaseAll() {
      this.axes.clear();
      for (const set of this.holders.values()) set.clear();
    }

    // 1固定ステップにつき1回呼ぶ
    poll() {
      const cmd = KG.createEmptyCommand();
      let x = 0, y = 0;
      for (const a of this.axes.values()) { x += a.x; y += a.y; }
      cmd.moveX = KG.util.clamp(x, -1, 1);
      cmd.moveY = KG.util.clamp(y, -1, 1);
      for (const a of KG.ACTIONS) {
        cmd.held[a] = this.holders.get(a).size > 0;
        cmd.pressed[a] = this.pressLatch[a];
        this.pressLatch[a] = false;
      }
      return cmd;
    }
  }

  // ---- キーボード ----
  KG.DEFAULT_KEY_BINDINGS = {
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    actions: {
      jump: ['Space', 'KeyW', 'ArrowUp'],
      attack: ['KeyJ'],
      special: ['KeyK'],
      shoot: ['KeyL'],
      guard: ['KeyI'],
    },
  };

  class KeyboardSource {
    constructor(input, bindings) {
      this.input = input;
      this.b = bindings || KG.DEFAULT_KEY_BINDINGS;
      this.dirStack = []; // 押している方向キーの順番（左右同時押しは後から押した方を優先）
      this.codeToAction = new Map();
      for (const [action, codes] of Object.entries(this.b.actions)) {
        for (const c of codes) this.codeToAction.set(c, action);
      }
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onKeyUp = this.onKeyUp.bind(this);
      this.reset = this.reset.bind(this);
    }

    attach(target) {
      target = target || window;
      target.addEventListener('keydown', this.onKeyDown);
      target.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('blur', this.reset);
    }

    dirOf(code) {
      if (this.b.left.includes(code)) return -1;
      if (this.b.right.includes(code)) return 1;
      return 0;
    }

    onKeyDown(e) {
      const dir = this.dirOf(e.code);
      const action = this.codeToAction.get(e.code);
      if (!dir && !action) return;
      e.preventDefault(); // Space / 矢印キーによるページスクロールを防ぐ
      if (e.repeat) return;
      if (dir) {
        this.dirStack = this.dirStack.filter((c) => c !== e.code);
        this.dirStack.push(e.code);
        this.updateAxis();
      }
      if (action) this.input.setHeld(action, 'key:' + e.code, true);
    }

    onKeyUp(e) {
      const dir = this.dirOf(e.code);
      const action = this.codeToAction.get(e.code);
      if (dir) {
        this.dirStack = this.dirStack.filter((c) => c !== e.code);
        this.updateAxis();
      }
      if (action) this.input.setHeld(action, 'key:' + e.code, false);
    }

    updateAxis() {
      const last = this.dirStack[this.dirStack.length - 1];
      this.input.setAxis('keyboard', last ? this.dirOf(last) : 0, 0);
    }

    reset() {
      this.dirStack = [];
      this.input.setAxis('keyboard', 0, 0);
      for (const [code, action] of this.codeToAction) this.input.setHeld(action, 'key:' + code, false);
    }
  }

  KG.InputManager = InputManager;
  KG.KeyboardSource = KeyboardSource;
})(window.KG = window.KG || {});
