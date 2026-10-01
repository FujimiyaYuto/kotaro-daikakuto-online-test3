/*
 * main.js — 起動処理・ゲームループ・画面サイズ・ブラウザ操作の抑止
 */
(function (KG) {
  'use strict';

  const params = new URLSearchParams(location.search);
  const hash = location.hash.replace('#', '');
  // 開発用表示は DEBUG_ENABLED が true の時だけ（公開版は false）
  if (KG.CONFIG.DEBUG_ENABLED && (params.has('debug') || hash === 'debug')) KG.CONFIG.debug = true;
  // 開発用の互換機能：URL の #easy / #normal / #hard または ?cpu=hard で、難易度選択画面の初期選択を変える
  const diff = (params.get('cpu') || hash || '').toLowerCase();
  if (KG.CPU_DIFFICULTY && KG.CPU_DIFFICULTY[diff]) KG.CONFIG.cpuDifficulty = diff;

  // ---- ズーム・スクロール・選択などの誤作動を防ぐ ----
  function lockBrowserGestures() {
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp) vp.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
    const stop = (e) => { if (e.cancelable) e.preventDefault(); };
    document.addEventListener('touchstart', stop, { passive: false });
    document.addEventListener('touchmove', stop, { passive: false });
    document.addEventListener('gesturestart', stop, { passive: false }); // iOS のピンチ
    document.addEventListener('dblclick', stop, { passive: false });
    document.addEventListener('contextmenu', stop);                    // 長押しメニュー
    document.addEventListener('selectstart', stop);
    document.addEventListener('wheel', (e) => { if (e.ctrlKey) stop(e); }, { passive: false });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('画像を読み込めませんでした: ' + src));
      img.src = src;
    });
  }

  function isTouchDevice() {
    return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
  }

  async function boot() {
    lockBrowserGestures();
    const root = document.getElementById('game-root');
    const canvas = document.getElementById('game-canvas');
    const status = document.getElementById('status');

    let images;
    try {
      const entries = await Promise.all(
        Object.values(KG.CHARACTERS).filter((c) => c.sprite).map(async (c) => [c.id, await loadImage(c.sprite.src)])
      );
      images = Object.fromEntries(entries);
    } catch (err) {
      status.textContent = err.message;
      status.hidden = false;
      return;
    }

    const game = new KG.Game(canvas, images);
    const touch = new KG.TouchControls(document.getElementById('touch-ui'), game.input);
    const rulesHud = new KG.RulesHud(document.getElementById('rules-hud'), document.getElementById('ko-overlay'), document.getElementById('countdown'));
    document.body.classList.toggle('debug', KG.CONFIG.debug);
    touch.setVisible(isTouchDevice() || params.has('touch') || hash === 'touch');
    document.body.classList.toggle('is-touch', touch.visible);

    // PC の外部キーボード操作とタッチを行き来しても UI が出るように
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && !touch.visible) {
        touch.setVisible(true);
        document.body.classList.add('is-touch');
      }
    });

    const hudEl = document.getElementById('hud');

    // ---- 画面サイズ ----
    function resize() {
      const r = root.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, KG.CONFIG.maxDevicePixelRatio);
      game.resize(Math.max(1, r.width), Math.max(1, r.height), dpr);
    }
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 150));
    if (window.visualViewport) visualViewport.addEventListener('resize', resize);

    // ---- タブ切替・フォーカス喪失時・画面切替時は押しっぱなしを解除 ----
    const releaseAll = () => { game.keyboard.reset(); touch.reset(); game.input.releaseAll(); game.input.poll(); };

    // タイトル・難易度選択・勝敗後のボタン（Phase 10）。画面状態は game.phase の1つだけ
    const menu = new KG.MenuUI(game, { clearInput: releaseAll });
    menu.update();
    window.addEventListener('blur', releaseAll);

    // ---- サウンド（Phase 13）：最初のタップ／クリック／キー入力で有効にする。ページが見えない間は止める ----
    const sound = new KG.SoundSystem();
    KG.sound = sound;
    try { KG.installSound(game, sound); } catch (_) { /* 音が無くてもゲームは動く */ }
    const unlock = () => sound.unlock();
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) window.addEventListener(ev, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAll();
      sound.setHidden(document.hidden);
    });
    window.addEventListener('pagehide', () => sound.setHidden(true));
    window.addEventListener('pageshow', () => sound.setHidden(document.hidden));

    // ---- デバッグ用キー ----
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (menu.handleKey(e)) { e.preventDefault(); return; }             // タイトル・難易度選択・勝敗表示のキー操作
      if (e.code === 'KeyH' && KG.CONFIG.DEBUG_ENABLED) {               // 開発用：当たり判定などの表示（DEBUG_ENABLED の時だけ）
        KG.CONFIG.debug = !KG.CONFIG.debug;
        document.body.classList.toggle('debug', KG.CONFIG.debug);
      }
      if (e.code === 'KeyR') menu.restartDev();                         // 開発用リセット（対戦中のみ。3→2→1→START! から）
      if (e.code === 'KeyT' && KG.CONFIG.DEBUG_ENABLED) {               // 開発用：PCでタッチUIの配置確認
        touch.setVisible(!touch.visible);
        document.body.classList.toggle('is-touch', touch.visible);
      }
    });

    // ---- 全画面ボタン（対応ブラウザのみ表示） ----
    const fsBtn = document.getElementById('fs-btn');
    const fsEnabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    if (fsEnabled && fsBtn) {
      fsBtn.hidden = false;
      fsBtn.addEventListener('pointerup', async () => {
        try {
          if (document.fullscreenElement || document.webkitFullscreenElement) {
            await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
          } else {
            const el = document.documentElement;
            await (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
            if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
          }
        } catch (_) { /* 全画面に対応しない環境ではそのまま遊べる */ }
        setTimeout(resize, 200);
      });
    }

    // ---- ゲームループ（固定タイムステップ + 描画補間） ----
    const STEP = KG.CONFIG.fixedStep;
    let last = performance.now();
    let acc = 0;
    let fpsTimer = 0, fpsFrames = 0;
    function frame(now) {
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.25) dt = 0.25;
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < KG.CONFIG.maxStepsPerFrame) {
        game.step(STEP);
        acc -= STEP;
        steps++;
      }
      if (steps >= KG.CONFIG.maxStepsPerFrame) acc = 0;
      if (KG.CONFIG.debug) game.debugTop = Math.max(48, Math.round(hudEl.getBoundingClientRect().bottom + 10));
      game.render(acc / STEP);
      menu.update();
      rulesHud.update(game);
      sound.update(game);
      touch.updateCooldowns(game.player);

      fpsFrames++; fpsTimer += dt;
      if (fpsTimer >= 0.5) { game.fps = fpsFrames / fpsTimer; fpsFrames = 0; fpsTimer = 0; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // 動作確認用（ブラウザのコンソールから参照できる）
    KG.game = game;
    KG.menu = menu;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.KG = window.KG || {});
