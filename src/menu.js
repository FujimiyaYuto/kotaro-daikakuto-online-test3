/*
 * menu.js — タイトル・難易度選択・勝敗後のボタン（Phase 10）
 *
 * 画面の状態そのものは Game.phase（'title' | 'difficulty' | 'countdown' | 'fight' | 'ending' | 'result'）の1つだけで持ち、
 * このクラスは「その状態に合わせて DOM を出し分ける」「ボタン・キーで状態を進める」だけを担当します。
 * 画面が切り替わる時は必ず hooks.clearInput() を呼び、メニュー操作の入力が対戦へ残らないようにします。
 *
 * ボタンは pointerup で反応します（スマホでは touchstart を止めているため click が来ないことがある）。
 * 同じボタンの上で押し始めた時だけ反応させ、別の場所から指を滑らせて離した時の誤作動を防ぎます。
 */
(function (KG) {
  'use strict';

  class MenuUI {
    constructor(game, hooks) {
      this.game = game;
      this.hooks = hooks;
      this.el = {
        title: document.getElementById('title-screen'),
        diff: document.getElementById('difficulty-screen'),
        list: document.getElementById('diff-list'),
      };
      this.selected = KG.CPU_DIFFICULTY[game.cpuDifficulty] ? game.cpuDifficulty : 'normal';
      this.shownState = null;

      // 難易度カードは Phase 9 の難易度データから作る（ラベルと短い説明だけを表示。内部の数値は出さない）
      this.cards = {};
      for (const [key, d] of Object.entries(KG.CPU_DIFFICULTY)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'diff-card diff-' + key;
        b.setAttribute('role', 'radio');
        b.dataset.diff = key;
        b.innerHTML = '<span class="diff-name"></span><span class="diff-desc"></span>';
        b.querySelector('.diff-name').textContent = d.label;
        b.querySelector('.diff-desc').textContent = d.desc || '';
        // 挑戦枠（CHALLENGE）は小さな印と少し特別な枠（Phase 12）
        if (d.special) {
          b.classList.add('is-special');
          const mark = document.createElement('span');
          mark.className = 'diff-mark';
          mark.textContent = '挑戦';
          mark.setAttribute('aria-hidden', 'true');
          b.appendChild(mark);
        }
        this.el.list.appendChild(b);
        this.cards[key] = b;
        this.bind(b, () => { if (this.selected !== key) this.sfx('select'); this.select(key); });
      }
      this.select(this.selected);

      this.bind(document.getElementById('btn-cpu'), () => this.openDifficulty());
      this.bind(document.getElementById('btn-back'), () => this.backToTitle());
      this.bind(document.getElementById('btn-start'), () => this.start());
      this.bind(document.getElementById('ko-reset'), () => this.rematch());
      this.bind(document.getElementById('ko-title'), () => this.toTitle());
    }

    bind(el, fn) {
      el.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        el._armed = e.pointerId;
        el.classList.add('is-down');
      });
      const disarm = () => { el._armed = null; el.classList.remove('is-down'); };
      el.addEventListener('pointerup', (e) => {
        const ok = el._armed === e.pointerId;
        disarm();
        if (ok) fn();
      });
      el.addEventListener('pointercancel', disarm);
      el.addEventListener('pointerleave', disarm);
    }

    select(key) {
      if (!this.cards[key]) return;
      this.selected = key;
      for (const [k, b] of Object.entries(this.cards)) {
        const on = k === key;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    }

    // ---- 画面遷移（すべてここを通す） ----
    go(fn) {
      this.hooks.clearInput();
      fn();
      this.hooks.clearInput();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      this.update();
    }
    // 効果音（Phase 13。音が使えない時は何もしない）
    sfx(name) { if (KG.sound) KG.sound.play(name); }
    openDifficulty() { if (this.game.phase === 'title') { this.sfx('confirm'); this.go(() => { this.select(this.game.cpuDifficulty); this.game.goToDifficulty(); }); } }
    backToTitle() { if (this.game.phase === 'difficulty') { this.sfx('back'); this.go(() => this.game.goToTitle()); } }
    start() { if (this.game.phase === 'difficulty') { this.sfx('confirm'); this.go(() => this.game.startMatch(this.selected)); } }
    rematch() { if (this.game.phase === 'result') { this.sfx('confirm'); this.go(() => this.game.startMatch()); } }        // 同じ難易度のまま
    toTitle() { if (this.game.phase === 'result') { this.sfx('back'); this.go(() => this.game.goToTitle()); } }
    restartDev() { if (this.game.inMatch) this.go(() => this.game.startMatch()); }                 // R キー（開発用）

    // メニュー用のキー操作（処理したら true）。対戦中のキーには触らない
    handleKey(e) {
      const p = this.game.phase;
      const code = e.code;
      const ok = code === 'Enter' || code === 'NumpadEnter' || code === 'Space';
      if (p === 'title') {
        if (ok) { this.openDifficulty(); return true; }
      } else if (p === 'difficulty') {
        const keys = Object.keys(this.cards);
        const i = keys.indexOf(this.selected);
        const pick = (k) => { if (k !== this.selected) this.sfx('select'); this.select(k); };
        if (code === 'ArrowLeft' || code === 'ArrowUp' || code === 'KeyA' || code === 'KeyW') { pick(keys[Math.max(0, i - 1)]); return true; }
        if (code === 'ArrowRight' || code === 'ArrowDown' || code === 'KeyD' || code === 'KeyS') { pick(keys[Math.min(keys.length - 1, i + 1)]); return true; }
        if (ok) { this.start(); return true; }
        if (code === 'Escape' || code === 'Backspace') { this.backToTitle(); return true; }
      } else if (p === 'result') {
        // 勝敗表示ではジャンプ（Space）の連打で誤って進まないよう Enter / Esc だけ
        if (code === 'Enter' || code === 'NumpadEnter') { this.rematch(); return true; }
        if (code === 'Escape') { this.toTitle(); return true; }
      }
      return false;
    }

    // 画面状態が変わった時だけ DOM を切り替える
    update() {
      const state = this.game.screenState;
      if (state === this.shownState) return;
      this.shownState = state;
      document.body.dataset.screen = state;
      this.el.title.hidden = state !== 'TITLE';
      this.el.diff.hidden = state !== 'DIFFICULTY_SELECT';
      // 対戦用のタッチ操作はカウントダウン・対戦中だけ（CSS で隠す）。隠す時は押しっぱなしを解除
      if (state !== 'MATCH_COUNTDOWN' && state !== 'MATCH_PLAYING') this.hooks.clearInput();
    }
  }

  KG.MenuUI = MenuUI;
})(window.KG = window.KG || {});
