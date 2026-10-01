/*
 * game.js — ゲーム本体（ワールドの更新と描画）
 *
 * step(dt)   … 固定タイムステップで1回分ゲームを進める
 * render(a)  … 画面を描く（a は補間率）
 *
 * 1ステップの流れ:
 *   1) 入力 → キャラ更新（プレイヤーは InputManager、CPU は CpuController がコマンドを作る）
 *   2) 飛び道具（移動・地形・寿命 → 技データ spawns からの新規発射）
 *   3) 戦闘判定（キャラと飛び道具の Hitbox × 全員の Hurtbox → ダメージ・吹っ飛び・ヒットストップ・エフェクト）
 *   3) ルール（場外・ストック・リスポーン・無敵: StockRules）
 *   4) エフェクト・カメラ・背景
 *
 * プレイヤーと CPU は同じ Fighter クラスで、違うのは controller（入力元）とキャラクター定義だけです。
 * キャラを増やす時は addFighter(キャラ定義, controller, 表示名) を呼ぶだけで、戦闘とルールに自動で参加します。
 */
(function (KG) {
  'use strict';

  // デバッグ表示の色分け
  const DEBUG_COLORS = {
    bodyGrounded: '#7dff9a',          // 地形用 body（接地中）
    bodyAir: '#ffd166',               // 地形用 body（空中）
    hurt: '#4da3ff',
    hurtFill: 'rgba(77, 163, 255, 0.18)',
    blast: '#ff9f43',                 // 場外ライン
  };
  // キャラごとの Hurtbox / Hitbox の色（1人目 = PLAYER, 2人目 = CPU）
  const FIGHTER_DEBUG_COLORS = [
    { hurt: '#4da3ff', hurtFill: 'rgba(77, 163, 255, 0.18)', hit: '#ff3b5c', hitFill: 'rgba(255, 59, 92, 0.38)' },
    { hurt: '#c77dff', hurtFill: 'rgba(199, 125, 255, 0.2)', hit: '#ffb020', hitFill: 'rgba(255, 176, 32, 0.4)' },
  ];

  // 内部の段階 → 画面状態の名前
  const SCREEN_STATE = {
    title: 'TITLE',
    difficulty: 'DIFFICULTY_SELECT',
    countdown: 'MATCH_COUNTDOWN',
    fight: 'MATCH_PLAYING',
    ending: 'MATCH_END',
    result: 'MATCH_END',
  };
  const MATCH_PHASES = new Set(['countdown', 'fight', 'ending', 'result']);
  KG.SCREEN_STATE = SCREEN_STATE;

  class Game {
    constructor(canvas, assets) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.assets = assets;
      this.screen = { w: 1, h: 1, dpr: 1 };
      this.time = 0;

      this.stage = new KG.Stage(KG.STAGES.testReef);
      this.background = new KG.Background();
      this.effects = new KG.Effects();
      // 飛び道具（泡など）。キャラとは独立したオブジェクトとして管理
      this.projectiles = new KG.ProjectileSystem(this.stage, this.effects);

      this.input = new KG.InputManager();
      this.keyboard = new KG.KeyboardSource(this.input);
      this.keyboard.attach(window);

      // 勝敗（どちらかのストックが0になったら「勝った側の名前 WIN」）と勝者
      this.result = null;
      this.winner = null;
      // ゲーム全体の画面状態（Phase 10 で Phase 9 の試合の段階を拡張）。この1つの値だけで「今どの画面か」を決める
      //   'title'（タイトル）| 'difficulty'（難易度選択）
      //   'countdown'（3→2→1→START!）| 'fight' | 'ending'（最後のKO直後の間）| 'result'（勝敗表示）
      // 外向きの名前は screenState（TITLE / DIFFICULTY_SELECT / MATCH_COUNTDOWN / MATCH_PLAYING / MATCH_END）
      this.phase = 'title';
      this.phaseTime = 0;

      this.fighters = [];
      // 1人目：プレイヤー（人間の入力）
      this.player = this.addFighter(KG.CHARACTERS.kotaro, this.input, 'PLAYER');
      // 2人目：CPU（AI が作る入力）。難易度は KG.CONFIG.cpuDifficulty（easy / normal / hard）
      this.cpu = this.addFighter(KG.CHARACTERS.testBot, null, 'CPU');
      this.cpuDifficulty = KG.CONFIG.cpuDifficulty;
      this.cpu.controller = new KG.CpuController(this.cpu, {
        getTarget: () => this.player,
        stage: this.stage,
        isMatchOver: () => this.phase !== 'fight', // カウントダウン中・試合終了後は行動しない
        getProjectiles: () => this.projectiles.list,
        params: KG.cpuProfile(this.cpuDifficulty),
      });

      // 対戦ルール（場外・ストック・リスポーン）。status を持つ全員に同じルールを適用
      this.rules = new KG.StockRules(this.stage, {
        onOut: (e, point) => this.onKnockOut(e, point),
        onKO: (e) => this.onFighterKO(e),
      });

      this.camera = new KG.Camera({ camera: KG.CONFIG.camera, view: KG.CONFIG.view, bounds: this.stage.cameraBounds });
      this.camera.setTargets(this.activeEntities());
      this.camera.snap();

      this.fps = 60;
      this.debugHitboxGhosts = []; // デバッグ用：直近の Hitbox を少しの間残す

      this.goToTitle();
    }

    // ---------------- 画面の流れ（Phase 10） ----------------
    get screenState() { return SCREEN_STATE[this.phase]; }
    get inMatch() { return MATCH_PHASES.has(this.phase); }

    // タイトルへ：戦闘状態をすべて初期化してから（泡・エフェクト・AI・ガード・入力・勝敗・カウントダウン）
    goToTitle() {
      this.resetTest();
      this.phase = 'title';
      this.phaseTime = 0;
      this.input.releaseAll();
      this.input.poll();
    }

    // 難易度選択画面へ（戦闘には触れない）
    goToDifficulty() {
      this.phase = 'difficulty';
      this.phaseTime = 0;
      this.input.poll();
    }

    // CPU 難易度の適用：Phase 9 の難易度データ（KG.cpuProfile）を CPU の設定に差し替えるだけ。AI は共通
    setDifficulty(name) {
      if (!KG.CPU_DIFFICULTY[name]) return;
      this.cpuDifficulty = name;
      this.cpu.controller.cfg = KG.cpuProfile(name);
      this.cpu.controller.reset();
    }

    // ---------------- 試合の流れ ----------------
    // 試合開始（難易度選択から・「もう一度」・R キー）：全員を初期状態に戻してカウントダウンから
    // difficulty を渡した時だけ難易度を変える（「もう一度」「R」は今の難易度のまま）
    startMatch(difficulty) {
      if (difficulty) this.setDifficulty(difficulty);
      this.resetTest();
      this.phase = 'countdown';
      this.phaseTime = 0;
      this.input.poll(); // それまでに押されたボタンを捨てる
      this.camera.setTargets(this.activeEntities());
      this.camera.snap();
    }

    // 画面中央に出すカウントダウンの文字（無ければ null）。key は表示が切り替わった時の目印
    countdownLabel() {
      const m = KG.CONFIG.match;
      if (this.phase === 'countdown') {
        const i = Math.min(2, Math.floor(this.phaseTime / m.countdownStep));
        return { text: String(3 - i), key: 'c' + i };
      }
      if (this.phase === 'fight' && this.phaseTime < m.startShow) return { text: 'START!', key: 'start' };
      return null;
    }

    updatePhase(dt) {
      const m = KG.CONFIG.match;
      this.phaseTime += dt;
      if (this.phase === 'countdown' && this.phaseTime >= m.countdownStep * 3) {
        this.phase = 'fight';
        this.phaseTime = 0;
        this.input.poll(); // カウント中に押したボタンが開始直後に出ないように捨てる
      } else if (this.phase === 'ending' && this.phaseTime >= m.endDelay) {
        this.phase = 'result';
        this.phaseTime = 0;
      }
    }

    addFighter(def, controller, hudLabel) {
      const index = this.fighters.length;
      const f = new KG.Fighter(def, {
        id: def.id + '-' + (index + 1),
        controller,
        image: this.assets[def.id],
        status: new KG.CombatStatus({ stocks: KG.CONFIG.rules.stocks }),
        hudLabel,
        debugColor: FIGHTER_DEBUG_COLORS[index % FIGHTER_DEBUG_COLORS.length],
      });
      f.projectileGate = (owner, defId) => this.projectiles.canSpawn(owner, defId);
      f.spawnIndex = index;
      f.spawnSlot = index;
      f.spawn(this.startPoint(f));
      this.fighters.push(f);
      return f;
    }

    startPoint(f) {
      return this.stage.spawnPoints[f.spawnIndex % this.stage.spawnPoints.length];
    }

    resize(cssW, cssH, dpr) {
      this.screen = { w: cssW, h: cssH, dpr };
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
      this.camera.setScreenSize(cssW, cssH);
      this.camera.clampToBounds();
    }

    // ルールに参加している全員
    get entities() { return this.fighters; }
    activeEntities() { return this.fighters.filter((e) => !e.status || e.status.isAlive); }

    step(dt) {
      this.time += dt;
      if (!this.inMatch) { this.stepMenu(dt); return; }
      this.updatePhase(dt);
      const fighting = this.phase === 'fight';

      // 1) 入力 → キャラ更新（場外で待機中は入力を読み捨てる）
      //    試合中以外（カウントダウン・終了後）は、人の入力は読み捨て、CPU の AI は動かさない。重力などの物理だけ進む
      for (const f of this.fighters) {
        let cmd;
        if (fighting) cmd = f.controller ? f.controller.poll() : KG.createEmptyCommand();
        else {
          if (f.controller && !f.controller.isAI) f.controller.poll();
          cmd = KG.createEmptyCommand();
        }
        if (!f.status || f.status.isAlive) f.update(dt, cmd, this.stage);
        // 技データの fx（溜め・放電などの演出）を Effects へ
        for (const ev of f.fxEvents) this.effects.spawnMoveFx(ev);
        f.fxEvents.length = 0;
      }

      // 2) 飛び道具：今ある分を動かしてから、このステップに撃たれた分を出す（出た瞬間から判定あり）
      this.projectiles.update(dt);
      for (const f of this.fighters) {
        for (const ev of f.spawnEvents) if (fighting) this.projectiles.spawnFrom(ev.owner, ev.spawn);
        f.spawnEvents.length = 0;
      }

      // 3) 戦闘判定（キャラも飛び道具も攻撃側。試合が終わったら飛び道具は判定しない）
      const attackers = fighting ? [...this.fighters, ...this.projectiles.list] : this.fighters;
      if (this.phase === 'fight' || this.phase === 'countdown') KG.Combat.resolve(attackers, this.fighters, this.effects, (a, hbs) => {
        if (a.owner) return; // 飛び道具の判定は常時表示するので残像は不要
        for (const hb of hbs) this.debugHitboxGhosts.push({ rect: hb.rect, t: 0.35, color: a.debugColor.hit });
      });
      this.projectiles.removeDead(); // 当たって弾けた泡を消す

      // 4) ルール
      this.rules.update(dt, this.fighters);
      if (this.phase === 'ending' || this.phase === 'result') this.projectiles.clear(); // 試合終了後は飛び道具を残さない

      // 5) エフェクト・カメラ・背景（カメラは場にいる全員を収める）
      this.effects.update(dt);
      this.camera.setTargets(this.activeEntities());
      this.camera.update(dt);
      this.background.update(dt);
      for (const g of this.debugHitboxGhosts) g.t -= dt;
      this.debugHitboxGhosts = this.debugHitboxGhosts.filter((g) => g.t > 0);
    }

    // タイトル・難易度選択中：戦闘は一切進めず、背景だけ動かす（押されたキーは読み捨てる）
    stepMenu(dt) {
      this.phaseTime += dt;
      this.input.poll();
      this.background.update(dt);
    }

    // メニュー画面の背景用の視点（ゆっくり横に漂う）
    menuView() {
      const t = this.time;
      return { cx: Math.sin(t * 0.05) * 400, cy: -120 + Math.sin(t * 0.07) * 40, scale: 1, w: this.screen.w, h: this.screen.h };
    }

    // 場外になった瞬間：場外になった方向の画面端に合図のエフェクト
    onKnockOut(e, point) {
      const b = this.stage.blastZone;
      const nx = point.x <= b.left ? -1 : point.x >= b.right ? 1 : 0;
      const ny = nx !== 0 ? 0 : (point.y >= b.bottom ? 1 : -1);
      const v = this.camera.getView(1);
      const m = 30;
      const x = KG.util.clamp(point.x, v.cx - v.w / 2 + m, v.cx + v.w / 2 - m);
      const y = KG.util.clamp(point.y, v.cy - v.h / 2 + m, v.cy + v.h / 2 - m);
      this.effects.spawnOut(x, y, nx, ny);
    }

    // ストック0：残っている側の勝ち → 少し間を置いて勝敗表示（'ending' → 'result'）
    onFighterKO(e) {
      this.projectiles.removeOwnedBy(e); // 完全KOした発射者の飛び道具は消す
      if (this.result) return;
      this.winner = e === this.player ? this.cpu : this.player;
      this.result = `${this.winner.displayName} WIN`;
      this.phase = 'ending';
      this.phaseTime = 0;
    }

    // テスト用リセット（R キー）：双方の位置・速度・ダメージ・ストック・KO・無敵・CPU AI を初期状態へ
    resetTest() {
      for (const f of this.fighters) {
        this.rules.resetEntity(f, this.startPoint(f));
        if (f.controller && f.controller.reset) f.controller.reset();
      }
      this.result = null;
      this.winner = null;
      this.projectiles.clear();
      this.effects.list.length = 0;
      this.debugHitboxGhosts.length = 0;
    }

    get isMatchOver() { return this.result !== null; }

    render(alpha) {
      const ctx = this.ctx;
      const { w, h, dpr } = this.screen;
      // タイトル・難易度選択中は背景だけ（Phase 9 の海中背景をそのまま使う）
      if (!this.inMatch) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.background.draw(ctx, w, h, this.menuView());
        return;
      }
      const view = this.camera.getView(alpha);

      // 背景（画面座標）
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.background.draw(ctx, w, h, view);

      // ワールド（カメラ変換）
      const s = view.scale * dpr;
      ctx.setTransform(s, 0, 0, s, dpr * (w / 2 - view.cx * view.scale), dpr * (h / 2 - view.cy * view.scale));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      this.stage.draw(ctx, this.time);
      // 後ろに登録したキャラから描く（プレイヤーが一番手前）
      for (let i = this.fighters.length - 1; i >= 0; i--) {
        const f = this.fighters[i];
        if (f.status.isAlive) { f.draw(ctx, alpha); f.drawGuard(ctx, alpha); }
      }
      this.projectiles.draw(ctx, alpha);
      this.effects.draw(ctx);

      if (KG.CONFIG.debug) this.renderDebug(ctx, alpha, view);
    }

    renderDebug(ctx, alpha, view) {
      const C = DEBUG_COLORS;
      ctx.save();
      ctx.lineWidth = 2 / view.scale;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      for (const p of this.stage.solids) ctx.strokeRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = 'rgba(125, 255, 154, 0.7)';
      for (const p of this.stage.oneways) ctx.strokeRect(p.x, p.y, p.w, p.h);
      ctx.restore();

      for (const f of this.fighters) if (f.status.isAlive) f.drawDebug(ctx, alpha, C);

      // Hitbox：有効な瞬間は塗りつぶし、直後は薄い枠で少し残す（一瞬で見えないため）
      ctx.save();
      ctx.lineWidth = 2;
      for (const f of this.fighters) {
        for (const hb of f.getActiveHitboxes()) {
          ctx.fillStyle = f.debugColor.hitFill;
          ctx.fillRect(hb.rect.x, hb.rect.y, hb.rect.w, hb.rect.h);
          ctx.strokeStyle = f.debugColor.hit;
          ctx.strokeRect(hb.rect.x, hb.rect.y, hb.rect.w, hb.rect.h);
        }
      }
      for (const g of this.debugHitboxGhosts) {
        ctx.globalAlpha = Math.min(1, g.t / 0.35) * 0.6;
        ctx.strokeStyle = g.color;
        ctx.strokeRect(g.rect.x, g.rect.y, g.rect.w, g.rect.h);
      }
      ctx.restore();

      // 飛び道具の Hitbox・発射者・速度・残り寿命
      this.projectiles.drawDebug(ctx, (o) => o.debugColor);

      // 正面（ガードできる側）の目印：体の前に小さな三角
      for (const f of this.fighters) {
        if (!f.status.isAlive) continue;
        const dir = f.guardState !== 'none' ? f.guardFacing : f.facing;
        const gx = f.x + dir * (f.w / 2 + 14), gy = f.y - f.h * 0.55;
        ctx.save();
        ctx.fillStyle = f.guardState === 'none' ? 'rgba(140, 230, 255, 0.45)' : '#8ce6ff';
        ctx.beginPath(); ctx.moveTo(gx + dir * 10, gy); ctx.lineTo(gx, gy - 8); ctx.lineTo(gx, gy + 8); ctx.closePath(); ctx.fill();
        ctx.restore();
      }

      // CPU の現在の行動（頭上）
      for (const f of this.fighters) {
        if (!f.controller || !f.controller.state || !f.status.isAlive) continue;
        ctx.save();
        ctx.font = `700 ${Math.round(14 / Math.max(0.5, view.scale))}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = f.debugColor.hit;
        ctx.fillText(f.controller.state, f.x, f.y - f.h - 14);
        ctx.restore();
      }

      // CHALLENGE の粗い着地予測（予測した着地点 × と、立とうとしている位置 ▲）
      for (const f of this.fighters) {
        const tc = f.controller && f.controller.cfg && f.controller.cfg.tactics ? f.controller.tc : null;
        if (!tc || !tc.landing) continue;
        ctx.save();
        ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3 / view.scale;
        const L = tc.landing, gy = f.y;
        ctx.beginPath(); ctx.moveTo(L.x - 12, gy - 12); ctx.lineTo(L.x + 12, gy + 12); ctx.moveTo(L.x + 12, gy - 12); ctx.lineTo(L.x - 12, gy + 12); ctx.stroke();
        ctx.fillStyle = 'rgba(255, 209, 102, 0.8)';
        ctx.beginPath(); ctx.moveTo(L.standX, gy - 4); ctx.lineTo(L.standX - 9, gy + 10); ctx.lineTo(L.standX + 9, gy + 10); ctx.closePath(); ctx.fill();
        ctx.restore();
      }

      // 場外ライン（ワールド上。カメラ範囲の外側にあるので通常は画面外。右上のミニマップで全体を確認）
      const b = this.stage.blastZone;
      ctx.save();
      ctx.setLineDash([18, 10]);
      ctx.lineWidth = 3 / view.scale;
      ctx.strokeStyle = C.blast;
      ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
      ctx.restore();

      // 数値パネルと凡例（画面座標）
      const { dpr } = this.screen;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const lines = [`phase ${this.phase} ${this.phaseTime.toFixed(1)}s  CPU ${this.cpuDifficulty.toUpperCase()}  fps ${this.fps.toFixed(0)}  view ${view.h.toFixed(0)}u  scale ${view.scale.toFixed(2)}` + `  projectiles ${this.projectiles.list.length}` + (this.result ? `  ${this.result}` : '')];
      for (const f of this.fighters) {
        const st = f.status;
        const act = f.action;
        const kb = st.lastKnockback;
        const ai = f.controller && f.controller.state ? `  AI ${f.controller.state}` : '';
        lines.push(
          `${f.hudLabel} ${f.state}${ai}  ${act ? `${act.move.id} ${f.actionPhase()} ${act.frame}/${act.move.totalFrames}` : ''}` +
            (f.hitstop ? `  stop ${f.hitstop}` : '') + (f.hitstun ? `  stun ${f.hitstun}` : ''),
          `  ${st.damage}%  stock ${st.stocks}  ${st.lifeState}` +
            (st.lifeState === 'respawning' ? ` ${st.respawnTimer.toFixed(1)}s` : '') +
            (st.isInvincible ? `  無敵 ${st.invincibleTimer.toFixed(1)}s` : '') +
            (kb ? `  last kb x${kb.scale.toFixed(2)}` : ''),
          ...(f.controller && f.controller.g ? [(() => {
            const g = f.controller.g;
            return `  AI guard: ${g.guarding ? `ON ${g.holdTime.toFixed(2)}s` : 'off'}` +
              (g.pending ? `  react ${g.pending.timer.toFixed(2)}s (${g.pending.threat.kind})` : '') +
              `  saw ${g.lastThreat || '-'}  decide ${g.lastDecision || '-'}` +
              (g.rejudge > 0 ? `  wait ${g.rejudge.toFixed(2)}s` : '');
          })()] : []),
          // 技の使い分け（Phase 11）：選んでいる技・理由・技ごとの再使用間隔・今の攻撃状態
          ...(f.controller && f.controller.mv ? [(() => {
            const m = f.controller.mv;
            return `  AI move: ${m.plan ? `plan ${m.plan.key}(${m.plan.reason}) ${Math.max(0, m.plan.wait).toFixed(2)}s` : 'plan -'}` +
              `  why ${m.lastReason || '-'}  ${m.lastResult || '-'}  now ${m.current || '-'}${act ? ' ' + f.actionPhase() : ''}  last ${m.last || '-'}`;
          })(), (() => {
            const m = f.controller.mv;
            const cd = (k) => `${k} ${Math.max(m.cd[k], m.rethink[k]).toFixed(1)}s${m.rethink[k] > m.cd[k] ? '(見送り)' : ''}`;
            return `  AI move CD: ${cd('dash')}  ${cd('shot')}  ${cd('antiAir')}`;
          })()] : []),
          // 復帰（Phase 12.1・CHALLENGE のみ。復帰中だけ表示）：復帰先・空中ジャンプの残り・判断の理由・下の場外ラインまでの余裕
          ...(f.controller && f.controller.rec && f.controller.rec.active ? [(() => {
            const r = f.controller.rec;
            return `  RECOVER: target ${r.target ? r.target.x + ',' + r.target.y : 'none'}  air jumps ${f.airJumpsLeft}  ${r.reason || '-'}` +
              (r.plan && r.plan.kind === 'jump' ? ` (jump within ${Math.max(0, r.plan.latest)}F)` : '') + `  last jump ${r.jumpReason || '-'}  blast ${Math.round(r.blastMargin)}`;
          })()] : []),
          // 立て直し（Phase 12.2・CHALLENGE のみ）：立て直し中か・理由・相手の追撃接近・自分の着地予測・安全方向・終了理由
          ...(f.controller && f.controller.cfg && f.controller.cfg.stabilize ? [(() => {
            const b = f.controller.stb;
            const dirTxt = (d) => (d > 0 ? 'R' : d < 0 ? 'L' : '-');
            return `  STABILIZE: ${b.active ? `ON ${b.phase} ${b.timer.toFixed(2)}s (${b.reason})  mode ${b.mode || '-'}` : 'off'}` +
              `  chased ${b.chasing ? 'YES' : 'no'}  my landing ${b.landX != null ? 'x' + b.landX : '-'}` +
              `  safe dir ${b.phase === 'air' ? dirTxt(b.airDir) : dirTxt(b.safeDir)}  last end ${b.endReason || '-'}`;
          })()] : []),
          // 戦術（Phase 12・CHALLENGE のみ）：目的・理由・通常攻撃の連続・光弾追従・着地予測・直近の行動
          ...(f.controller && f.controller.cfg && f.controller.cfg.tactics ? [(() => {
            const a = f.controller, tc = a.tc;
            return `  AI tactic: ${tc.goal} (${tc.why})  jab streak ${a.jabStreak}  follow ${tc.follow > 0 ? tc.follow.toFixed(1) + 's' : '-'}` +
              `  landing ${tc.landing ? `x${Math.round(tc.landing.x)}→stand ${Math.round(tc.landing.standX)}` : '-'}` +
              (tc.afterGuard > 0 ? '  after-guard' : '') + `  mem ${tc.mem.join('>') || '-'}`;
          })()] : []),
          `  guard ${f.guardState}` + (f.guardState === 'startup' || f.guardState === 'active' ? ` ${f.guardFrames}F` : '') +
            (f.guardStun ? ` stun ${f.guardStun}` : '') + `  face ${f.facing > 0 ? 'R' : 'L'}` +
            `  last ${st.lastHitResult || '-'}`,
          `  pos ${f.x.toFixed(0)},${f.y.toFixed(0)}  vel ${f.vx.toFixed(0)},${f.vy.toFixed(0)}` +
            Object.entries(f.cooldowns).map(([id, t]) => `  CD ${id} ${t.toFixed(2)}s`).join(''),
        );
      }
      const P = this.fighters[0].debugColor, Q = this.fighters[1] ? this.fighters[1].debugColor : P;
      const legend = [
        [P.hurt, 'PLAYER Hurtbox'], [Q.hurt, 'CPU Hurtbox'],
        [P.hit, 'PLAYER Hitbox'], [Q.hit, 'CPU Hitbox'],
        [C.bodyGrounded, '地形判定（黄=空中）'], [C.blast, '場外ライン'],
      ];
      const W = 650;
      const rows = Math.ceil(legend.length / 2);
      const panelH = 14 + lines.length * 15 + 8 + rows * 16;
      const y0 = this.debugTop || 84; // HUD の下（左下のスティックと重ならない位置）
      ctx.fillStyle = 'rgba(0, 20, 35, 0.68)';
      ctx.fillRect(8, y0, W, panelH);
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = '#eafcff';
      lines.forEach((l, i) => ctx.fillText(l, 16, y0 + 18 + i * 15));
      const ly = y0 + 18 + lines.length * 15 + 6;
      legend.forEach(([color, label], i) => {
        const lx = 16 + (i % 2) * 170;
        const yy = ly + Math.floor(i / 2) * 16;
        ctx.fillStyle = color;
        ctx.fillRect(lx, yy - 9, 12, 10);
        ctx.fillStyle = '#eafcff';
        ctx.fillText(label, lx + 18, yy);
      });

      this.renderMinimap(ctx, view);
    }

    // デバッグ用ミニマップ：場外ライン・カメラ範囲・今の画面・足場・キャラ位置
    renderMinimap(ctx, view) {
      const C = DEBUG_COLORS;
      const b = this.stage.blastZone;
      const W = 190;
      const k = W / (b.right - b.left);
      const H = (b.bottom - b.top) * k;
      const x0 = this.screen.w - W - 14;
      const y0 = 62;
      const mx = (x) => x0 + (x - b.left) * k;
      const my = (y) => y0 + (y - b.top) * k;
      ctx.save();
      ctx.fillStyle = 'rgba(0, 20, 35, 0.7)';
      ctx.fillRect(x0 - 4, y0 - 4, W + 8, H + 8);
      ctx.fillStyle = 'rgba(143, 227, 255, 0.55)';
      for (const p of this.stage.solids) ctx.fillRect(mx(p.x), my(p.y), p.w * k, Math.max(2, p.h * k));
      for (const p of this.stage.oneways) ctx.fillRect(mx(p.x), my(p.y), p.w * k, 2);
      ctx.lineWidth = 1;
      const cb = this.stage.cameraBounds;
      ctx.strokeStyle = 'rgba(234, 252, 255, 0.35)';
      ctx.strokeRect(mx(cb.left), my(cb.top), (cb.right - cb.left) * k, (cb.bottom - cb.top) * k);
      ctx.strokeStyle = 'rgba(234, 252, 255, 0.9)';
      ctx.strokeRect(mx(view.cx - view.w / 2), my(view.cy - view.h / 2), view.w * k, view.h * k);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = C.blast;
      ctx.strokeRect(x0, y0, W, H);
      ctx.setLineDash([]);
      for (let i = this.fighters.length - 1; i >= 0; i--) {
        const f = this.fighters[i];
        if (!f.status.isAlive) continue;
        ctx.fillStyle = f.debugColor.hurt;
        ctx.beginPath(); ctx.arc(mx(f.x), my(f.y - f.h / 2), 3.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  KG.Game = Game;
})(window.KG = window.KG || {});
