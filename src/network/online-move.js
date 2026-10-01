/*
 * online-move.js — Online Phase 2：遠隔プレイヤーによるキャラクター操作実験
 *                  Online Phase 3：GUEST 側 Client-side Prediction（ルミポの移動だけ）
 *
 *   HOST  … コタロ = HOST 本人の通常操作 / ルミポ = GUEST から届いた「入力」で、既存の Fighter 物理をそのまま使って動かす
 *   GUEST … 自分ではゲームを進めない。HOST から届いた状態（位置・向きなど）を少し遅らせて補間表示するだけ（予測なし）
 *
 * HOST authoritative：正しいゲーム状態は HOST だけが決める。GUEST から受け取るのは左・右・ジャンプの入力だけ。
 *
 * ゲーム本体のファイルは変更しない。操作実験の間だけ、外から次のように差し替え、終了時に元へ戻す：
 *   - ルミポの controller（CpuController）→ RemoteInputController（GUEST の入力）       ※ CPU 対戦の AI には触れない
 *   - コタロの controller（InputManager）→ 移動・ジャンプだけを通すフィルター（攻撃・必殺・泡・ガードは無効）
 *   - ストックを Infinity（場外に落ちても既存ルールで復帰するだけ。勝敗は発生しない）
 *   - game.step（このインスタンスだけ）：HOST は「元の step → 状態送信」、GUEST は「入力送信 → 予測 → 表示 → カメラ」
 *
 * Phase 3（予測）の考え方：
 *   - GUEST は固定ステップ（60 回/秒）ごとに 1 件の入力（番号つき）を HOST へ送る。
 *   - HOST は届いた入力を順番に 1 ステップ 1 件ずつ、既存の Fighter.update() でルミポに適用する（HOST が正解）。
 *     HOST 状態には「どの入力番号まで適用したか（a）」と、ルミポの移動に関わる全ての値（p）を載せる。
 *   - GUEST は同じ入力を、自分の画面用の別の Fighter（同じクラス・同じ移動値・同じステージ）に即座に適用して表示する（予測）。
 *   - HOST 状態が届いたら、予測用 Fighter を HOST の値に置き換え、まだ HOST が適用していない入力（番号 > a）を
 *     もう一度順番に適用し直して「今の予測」を作り直す（reconciliation）。
 *   - 作り直す前と後の差（予測誤差）は、画面の表示位置だけに足して数フレームで消す。大きすぎる時は HOST 状態へ即座に合わせる。
 *   - GUEST から HOST へ送るのは今までどおり入力だけ。予測した位置を HOST が使うことはない。
 */
(function (KG) {
  'use strict';

  const CFG = {
    stateEverySteps: 2,       // HOST → GUEST 状態送信：ゲームの固定ステップ（60/秒）の 2 回に 1 回 = 30Hz
    inputTimeoutMs: 500,      // HOST：これ以上新しい入力が届かなければルミポの入力をニュートラルへ
    maxInputsPerSec: 150,     // HOST：1 秒あたりこれを超える入力メッセージは無視（通常は 60。タブ復帰時のまとめ送りに余裕）
    // ---- Phase 3：HOST の入力キュー ----
    hostQueueTarget: 3,       // HOST：未適用の入力がこれより多い時は 1 ステップで 2 件適用して追いつく（HOST 側の遅れを 約 50ms までに）
    hostQueueMax: 30,         // HOST：未適用の入力の上限（あふれた分は古い順に捨てる）
    // ---- Phase 3：GUEST の予測と補正（単位はゲーム内の座標。ルミポの幅 70、地上の最高速度 340/秒 = 1 ステップ 約 5.7）----
    maxPending: 180,          // GUEST：未確認入力の上限（3 秒分）。超えたら古い順に捨てる
    errIgnore: 0.5,           // これ未満の誤差は「補正」として数えない（表示上は見えない大きさ。同じ方法で静かに吸収）
    errSmall: 24,             // 〜これ：小さい誤差（約 4 ステップ分の移動）→ ゆっくり（時定数 80ms）吸収
    errSnap: 120,             // 〜これ：大きい誤差 → 速め（時定数 40ms）に吸収 / これ以上：HOST 状態へ即座に合わせる（snap）
    tauSmallMs: 80,
    tauLargeMs: 40,
    interpDelayMs: 70,        // GUEST：表示補間の遅れ（30Hz の状態 約 2 回分）
    maxExtrapolateMs: 100,    // GUEST：新しい状態が遅れた時に速度で先へ伸ばす上限
    snapDistance: 400,        // GUEST：これ以上離れた 2 つの状態の間は補間せず切り替える（リスポーンなど）
    startAckTimeoutMs: 4000,  // HOST：開始の合図に GUEST が応えるまでの上限
    stateStallMs: 1000,       // GUEST：HOST の状態がこれ以上届かなければ警告表示
    stickThreshold: 0.3,      // GUEST：スティック／キーの倒し量をオン・オフに変える境目
  };
  const STATES = ['idle', 'run', 'jump', 'fall', 'attack', 'hurt'];
  const BLOCKED_ACTIONS = ['attack', 'special', 'shoot', 'guard'];
  const now = () => performance.now();
  const r1 = (v) => Math.round(v * 10) / 10;
  const lerp = (a, b, k) => a + (b - a) * k;

  // 直近 1 秒間の回数から Hz を出す
  class RateMeter {
    constructor() { this.n = 0; this.t0 = now(); this.hz = 0; }
    hit() { this.n++; this.roll(); }
    roll() {
      const t = now(), d = t - this.t0;
      if (d >= 1000) { this.hz = (this.n * 1000) / d; this.n = 0; this.t0 = t; }
    }
    get value() { this.roll(); return this.hz; }
  }
  // 平均（指数移動平均）と最大
  class Stat {
    constructor() { this.avg = null; this.last = null; this.max = null; this.n = 0; }
    add(v) { this.last = v; this.n++; this.avg = this.avg == null ? v : this.avg + (v - this.avg) * 0.1; this.max = this.max == null ? v : Math.max(this.max, v); }
  }

  // ---------------- HOST：ルミポを GUEST の入力で動かす controller ----------------
  // 既存の CpuController と同じ「1 ステップに 1 回 poll() でコマンドを返す」形。Fighter 側は入力元を区別しない。
  // Phase 3：届いた入力（GUEST の 1 ステップ分ずつ）を順番に並べ、HOST の 1 ステップに 1 件ずつ適用する。
  //   GUEST が予測で行う計算と同じ順番・同じ入力になるので、通常は予測とぴったり一致する。
  class RemoteInputController {
    constructor(fighter, stage) { this.isAI = false; this.fighter = fighter; this.stage = stage; this.resetAll(); }
    resetAll() {
      this.queue = [];                 // 届いたがまだ適用していない入力
      this.lastSeq = 0;                // 受信済みの最新番号
      this.lastJp = 0;
      this.lastApplied = 0;            // 適用済みの最新番号（HOST 状態に「a」として載せる）
      this.last = { mx: 0, hj: 0 };    // 最後に適用した入力（次が届くまではこれを続ける）
      this.lastAt = 0; this.neutral = true;
      this.dupTicks = 0; this.catchUps = 0; this.overflow = 0;
    }
    reset() { /* game.resetTest() から呼ばれる。受信状態は保持（開始時に resetAll 済み） */ }
    // 検証済みの入力メッセージを受け付ける。古い・重複・逆順の番号は捨てる（操作状態が巻き戻らない）
    accept(msg, t) {
      if (msg.s <= this.lastSeq) return 'stale';
      if (msg.jp < this.lastJp) return 'bad';            // ジャンプ回数は減らない
      const pj = msg.jp > this.lastJp ? 1 : 0;           // 押した瞬間（GUEST の 1 ステップで押せるのは 1 回）
      this.lastSeq = msg.s; this.lastJp = msg.jp; this.lastAt = t; this.neutral = false;
      this.queue.push({ s: msg.s, mx: (msg.r ? 1 : 0) - (msg.l ? 1 : 0), hj: msg.j, pj });
      if (this.queue.length > CFG.hostQueueMax) {        // あふれたら古い入力を捨てる（押した瞬間は次へ持ち越す）
        const d = this.queue.shift();
        this.overflow++;
        this.lastApplied = d.s;
        if (d.pj) this.queue[0].pj = 1;
      }
      return 'ok';
    }
    setNeutral() { this.queue.length = 0; this.last = { mx: 0, hj: 0 }; this.neutral = true; }
    toCmd(c) {
      const cmd = KG.createEmptyCommand();
      cmd.moveX = c.mx;                 // 左右同時は GUEST 側で片方に決まっている（-1 / 0 / 1）
      cmd.held.jump = !!c.hj;
      cmd.pressed.jump = !!c.pj;        // 押した瞬間 = その 1 ステップだけ
      return cmd;
    }
    poll() {
      const q = this.queue;
      if (!q.length) {
        // 次の入力がまだ届いていない：直前の入力（押しっぱなしの状態）を続ける。押した瞬間は繰り返さない
        if (!this.neutral) this.dupTicks++;
        return this.toCmd({ mx: this.last.mx, hj: this.last.hj, pj: 0 });
      }
      // 未適用がたまっている（通信が一時的に詰まって、まとめて届いた）：このステップで 1 件余分に適用して追いつく
      const f = this.fighter;
      if (q.length > CFG.hostQueueTarget && f.status && f.status.isAlive) {
        const extra = q.shift();
        f.update(KG.CONFIG.fixedStep, this.toCmd(extra), this.stage);   // 既存の物理をそのまま 1 回分
        f.fxEvents.length = 0; f.spawnEvents.length = 0;
        this.lastApplied = extra.s; this.last = extra; this.catchUps++;
      }
      const c = q.shift();
      this.lastApplied = c.s; this.last = c;
      return this.toCmd(c);
    }
  }

  // ルミポの移動に関わる値（予測の作り直しに必要なものすべて）。HOST はそのまま（丸めずに）送る
  function getLogic(f) {
    return [f.x, f.y, f.vx, f.vy, f.facing < 0 ? -1 : 1, f.grounded ? 1 : 0, f.airJumpsLeft,
      f.coyoteTimer, f.jumpBufferTimer, f.jumpQueuedDuringAction ? 1 : 0, f.canCutJump ? 1 : 0, f.launched ? 1 : 0];
  }
  function setLogic(f, p) {
    f.x = p[0]; f.y = p[1]; f.vx = p[2]; f.vy = p[3]; f.facing = p[4]; f.grounded = !!p[5];
    f.airJumpsLeft = p[6]; f.coyoteTimer = p[7]; f.jumpBufferTimer = p[8];
    f.jumpQueuedDuringAction = !!p[9]; f.canCutJump = !!p[10]; f.launched = !!p[11];
    f.ground = null; f.action = null; f.hitstop = 0; f.hitstun = 0; f.guardState = 'none';
  }

  // ---------------- HOST：コタロ（本人の操作）から攻撃系の入力だけを外すフィルター ----------------
  class MoveOnlyController {
    constructor(input) { this.input = input; this.isAI = false; }
    reset() {}
    poll() {
      const cmd = this.input.poll();
      for (const a of BLOCKED_ACTIONS) { cmd.held[a] = false; cmd.pressed[a] = false; }
      return cmd;
    }
  }
  const idleController = { isAI: false, reset() {}, poll() { return KG.createEmptyCommand(); } };

  class OnlineMoveTest {
    constructor(session, hooks) {
      this.session = session;
      this.hooks = hooks || {};
      this.active = false;
      this.starting = null;
      this.role = null;
      this.testId = 0;
      this.timers = [];
      // Phase 3：GUEST の予測 ON / OFF（A/B 比較用）。URL に ?pred=off で最初から OFF
      this.predEnabled = new URLSearchParams(location.search).get('pred') !== 'off';
      this.buildDom();
      // P キー：予測 ON / OFF（GUEST・実験中のみ）
      window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyP' && !e.repeat && this.active && this.role === 'GUEST') { e.preventDefault(); this.setPrediction(!this.predEnabled); }
      });
      session.on('game', (m) => this.onMsg(m));
      session.on('state', (st) => { if (st !== 'connected' && (this.active || this.starting)) this.stop('disconnect'); });
    }

    log(t, lv) { this.session.log('[MOVE] ' + t, lv); }

    // ---------------- 開始・終了 ----------------
    // HOST が「操作実験を開始」を押した：GUEST へ開始を伝え、準備完了の返事を待ってから両方で開始
    requestStart() {
      const s = this.session;
      if (s.role !== 'HOST' || s.state !== 'connected' || this.active || this.starting) return false;
      const rnd = new Uint32Array(1);
      crypto.getRandomValues(rnd);                    // Math.random は使わない（CPU 対戦の乱数に一切影響させない）
      const id = (rnd[0] % 999999) + 1;
      this.starting = { id, t: now() };
      s.sendGame({ t: 'ms', id });
      this.log('start requested (id ' + id + ') → waiting for GUEST');
      const st = this.starting;
      this.timers.push(setTimeout(() => {
        if (this.starting !== st) return;
        this.starting = null;
        s.sendGame({ t: 'me', id, r: 'timeout' });
        this.log('GUEST did not answer the start request', 'warn');
        if (this.hooks.onStartFailed) this.hooks.onStartFailed('timeout');
      }, CFG.startAckTimeoutMs));
      if (this.hooks.onStarting) this.hooks.onStarting();
      return true;
    }

    // 自分から終了（「操作実験を終了」ボタン）
    end() {
      if (!this.active && !this.starting) return;
      const id = this.active ? this.testId : this.starting.id;
      this.session.sendGame({ t: 'me', id, r: 'user' });
      this.stop('user');
    }

    begin(role, id) {
      const g = KG.game;
      if (!g || this.active) return false;
      this.active = true;
      this.role = role;
      this.testId = id;
      this.resetStats();
      this.saved = {
        pCtl: g.player.controller, cCtl: g.cpu.controller,
        pStocks: g.player.status.initialStocks, cStocks: g.cpu.status.initialStocks,
      };
      // 勝敗・ストックは扱わない：落ちても既存ルールで復帰するだけ
      g.player.status.initialStocks = Infinity;
      g.cpu.status.initialStocks = Infinity;
      if (role === 'HOST') {
        this.remote = new RemoteInputController(g.cpu, g.stage);
        g.cpu.controller = this.remote;                       // ルミポ：CPU AI を止め、GUEST の入力で動かす
        g.player.controller = new MoveOnlyController(g.input); // コタロ：本人の操作（攻撃系は無効）
      } else {
        this.remote = null;
        g.player.controller = idleController;                 // GUEST は自分でゲームを進めない
        g.cpu.controller = idleController;
      }
      g.startMatch();
      if (role === 'GUEST') {
        // 予測用のルミポ（画面には出さない「計算用」）。同じ Fighter クラス・同じキャラ定義（移動値）・同じステージで動かす
        this.pred = new KG.Fighter(g.cpu.def, { id: 'prediction', status: new KG.CombatStatus({ stocks: Infinity }) });
        setLogic(this.pred, getLogic(g.cpu));               // 開始位置は HOST と同じ（startMatch で同じ出現位置）
        this.pred.state = g.cpu.state;
      }
      // カウントダウンは使わない（正式な試合ではない）。すぐに移動できる状態にする
      g.phase = 'fight';
      g.phaseTime = KG.CONFIG.match.startShow + 0.05;
      this.clearInput();
      const step0 = KG.Game.prototype.step;
      g.step = role === 'HOST'
        ? (dt) => { step0.call(g, dt); this.afterHostStep(dt); }
        : (dt) => this.guestStep(dt);
      document.body.dataset.onlineTest = role.toLowerCase();
      this.hud.hidden = false;
      this.$.role.textContent = role === 'HOST' ? 'HOST：コタロを操作中（ルミポ = GUEST）' : 'GUEST：ルミポを操作中';
      this.hud.dataset.role = role.toLowerCase();
      this.renderPredBtn();
      this.diagTimer = setInterval(() => this.renderDiag(), 250);
      this.renderDiag();
      this.log('move test started as ' + role + ' (id ' + id + ')');
      if (this.hooks.onStart) this.hooks.onStart(role);
      return true;
    }

    // 終了・切断：ゲームを止め、差し替えたものをすべて元に戻してタイトル状態へ
    stop(reason) {
      if (!this.active && !this.starting) return;
      const wasActive = this.active;
      this.starting = null;
      this.active = false;
      for (const t of this.timers) clearTimeout(t);
      this.timers = [];
      clearInterval(this.diagTimer);
      const g = KG.game;
      if (wasActive && g) {
        if (this.remote) this.remote.setNeutral();        // 入力をニュートラルへ
        delete g.step;                                    // 元の Game.prototype.step に戻す
        g.player.controller = this.saved.pCtl;
        g.cpu.controller = this.saved.cCtl;               // CPU AI を元のまま戻す
        g.player.status.initialStocks = this.saved.pStocks;
        g.cpu.status.initialStocks = this.saved.cStocks;
        g.goToTitle();                                    // 位置・ストック・AI などをすべて初期化
        this.padReset();
        this.clearInput();
        delete document.body.dataset.onlineTest;
        this.hud.hidden = true;
        this.log('move test stopped (' + reason + ')');
      }
      this.remote = null;
      this.pred = null;                                   // 予測も止める（切断後にルミポを動かし続けない）
      if (this.hooks.onStop) this.hooks.onStop(reason, wasActive);
    }

    clearInput() {
      const g = KG.game;
      try { g.keyboard.reset(); g.input.releaseAll(); g.input.poll(); } catch (_) { /* noop */ }
      if (this.hooks.clearTouch) this.hooks.clearTouch();
    }

    resetStats() {
      this.st = {
        stepCount: 0, stateSeq: 0, inputSeq: 0, jp: 0,
        cur: { l: 0, r: 0, j: 0, jp: 0 }, lastInputSentAt: 0, sentTimes: new Map(),
        inputRate: new RateMeter(), stateRate: new RateMeter(), inRateWindow: 0, inRateCount: 0,
        staleInputs: 0, badInputs: 0, floodDropped: 0, neutralCount: 0, staleStates: 0,
        lastInputSeqRecv: 0, lastStateSeqRecv: 0, lastStateAt: 0, lastAcked: 0,
        inputDelay: new Stat(), stateDelay: new Stat(), reflect: new Stat(),
        snaps: [], tOff: null, extrapolating: false, extrapCount: 0, waitingFirstState: true,
        // Phase 3：予測
        pending: [], predErr: new Stat(), lastErrX: 0, lastErrY: 0, corrections: 0, snapCount: 0, reconciles: 0, nonZeroErr: 0,
        vis: { x: 0, y: 0 }, blend: false, predHidden: false, hostAlive: true, lastInv: 0, pendingDropped: 0, wasStalled: false, stallCount: 0,
      };
    }

    // ---------------- 受信 ----------------
    onMsg(m) {
      switch (m.t) {
        case 'ms':   // GUEST：HOST から開始の合図
          if (this.session.role !== 'GUEST') return;
          if (this.active) { if (m.id === this.testId) this.session.sendGame({ t: 'mr', id: m.id }); return; }
          if (this.begin('GUEST', m.id)) this.session.sendGame({ t: 'mr', id: m.id });
          return;
        case 'mr':   // HOST：GUEST の準備完了 → 開始
          if (this.session.role !== 'HOST' || !this.starting || m.id !== this.starting.id) return;
          this.starting = null;
          this.begin('HOST', m.id);
          return;
        case 'me':
          if ((this.active && m.id === this.testId) || (this.starting && m.id === this.starting.id)) this.stop('remote-' + m.r);
          return;
        case 'mi': return this.onInput(m);
        case 'st': return this.onState(m);
      }
    }

    // ---------------- HOST ----------------
    onInput(m) {
      if (!this.active || this.role !== 'HOST') { this.session.stats.dropped++; return; }
      const st = this.st;
      const t = now();
      // 異常な高頻度：1 秒あたり maxInputsPerSec を超えた分は無視（ゲーム処理は 1 ステップ 1 回の poll なので壊れない）
      if (t - st.inRateWindow > 1000) { st.inRateWindow = t; st.inRateCount = 0; }
      if (++st.inRateCount > CFG.maxInputsPerSec) { st.floodDropped++; return; }
      const res = this.remote.accept(m, t);
      if (res === 'stale') { st.staleInputs++; return; }
      if (res === 'bad') { st.badInputs++; return; }
      st.inputRate.hit();
      st.lastInputSeqRecv = m.s;
      // GUEST の送信時刻を自分の時計に直して、届くまでの時間を推定（Ping から推定した時計のずれを使う）
      const off = this.session.clockOffset;
      if (off != null) st.inputDelay.add(Math.max(0, t - (m.ts - off)));
    }

    afterHostStep() {
      const st = this.st;
      if (!this.active) return;
      st.stepCount++;
      const r = this.remote;
      if (!r.neutral && now() - r.lastAt > CFG.inputTimeoutMs) {
        r.setNeutral();
        st.neutralCount++;
        this.log('GUEST input timed out (' + CFG.inputTimeoutMs + 'ms) → neutral', 'warn');
      }
      if (st.stepCount % CFG.stateEverySteps === 0) this.sendState();
    }

    sendState() {
      const g = KG.game;
      const st = this.st;
      const f = g.fighters.slice(0, 2).map((fi) => {
        const s = fi.status;
        const code = Math.max(0, STATES.indexOf(fi.state));
        const flags = (s.isAlive ? 1 : 0) | (fi.grounded ? 2 : 0) | (code << 2);
        return [r1(fi.x), r1(fi.y), r1(fi.vx), r1(fi.vy), fi.facing < 0 ? -1 : 1, flags, Math.min(60, Math.round(s.invincibleTimer * 100) / 100)];
      });
      // a = 適用済みの最新入力番号 / p = ルミポの移動に関わる値（予測の作り直し用。丸めない）
      const ok = this.session.sendGame({ t: 'st', s: ++st.stateSeq, h: r1(g.time * 1000), w: r1(now()), a: this.remote.lastApplied, f, p: getLogic(g.cpu) });
      if (ok) st.stateRate.hit();
    }

    // ---------------- GUEST ----------------
    guestStep(dt) {
      const g = KG.game;
      if (!this.active) return;
      g.time += dt;
      g.phaseTime += dt;
      this.sampleInput(dt);
      this.applyView(dt);
      g.effects.update(dt);
      g.camera.setTargets(g.activeEntities());
      g.camera.update(dt);
      g.background.update(dt);
    }

    // 自分の入力（キーボード・タッチ。既存の InputManager に集まる）を読み、1 ステップ 1 件として送る（60 回/秒）。
    // 同じ入力を予測用ルミポにもすぐ適用する（HOST の返事を待たない）
    sampleInput(dt) {
      const st = this.st;
      const cmd = KG.game.input.poll();
      const l = cmd.moveX < -CFG.stickThreshold ? 1 : 0;
      const r = cmd.moveX > CFG.stickThreshold ? 1 : 0;
      const j = cmd.held.jump ? 1 : 0;
      const pj = cmd.pressed.jump ? 1 : 0;
      if (pj) st.jp++;                                  // 押した瞬間を回数で数える（押しっぱなしでは増えない）
      const t = now();
      const s = ++st.inputSeq;
      if (!this.session.sendGame({ t: 'mi', s, l, r, j, jp: st.jp, ts: r1(t) })) return; // 切断中は予測もしない
      st.cur = { l, r, j, jp: st.jp };
      st.lastInputSentAt = t;
      st.inputRate.hit();
      st.sentTimes.set(s, t);
      if (st.sentTimes.size > 240) st.sentTimes.delete(st.sentTimes.keys().next().value);
      // 未確認入力として覚えておく（HOST の a で確認済みになったら捨てる）
      const c = { s, mx: r - l, hj: j, pj, t };
      st.pending.push(c);
      if (st.pending.length > CFG.maxPending) { st.pending.shift(); st.pendingDropped++; }
      this.predictStep(c, dt);
    }

    // 予測：既存の Fighter.update() をそのまま 1 回呼ぶ（HOST の RemoteInputController と同じコマンドの作り方）
    predictStep(c, dt) {
      const f = this.pred, st = this.st;
      if (!f || st.predHidden) return;
      if (this.ackStalled()) return;   // HOST が入力を確認していない：先へ進めない（HOST の状態に従う）
      f.update(dt, RemoteInputController.prototype.toCmd(c), KG.game.stage);
      f.fxEvents.length = 0; f.spawnEvents.length = 0;
      if (KG.game.stage.isOutOfBounds(f)) st.predHidden = true;   // 場外へ出た：HOST の判定（復帰）を待つ
    }

    // 予測の作り直し（reconciliation）：HOST の確定状態 + まだ確認されていない入力 → 今の予測
    reconcile(m) {
      const st = this.st, f = this.pred;
      if (!f || !m.p) return;
      while (st.pending.length && st.pending[0].s <= m.a) st.pending.shift();  // HOST が適用済みの入力は捨てる
      const alive = !!(m.f[1][5] & 1);
      st.lastInv = m.f[1][6];
      if (!alive) { st.hostAlive = false; st.predHidden = true; return; }   // 場外・復帰待ち：HOST の判定に従う
      const wasHidden = st.predHidden || !st.hostAlive;
      st.hostAlive = true;
      const bx = f.x, by = f.y;
      setLogic(f, m.p);
      st.predHidden = false;
      const dt = KG.CONFIG.fixedStep;
      // HOST が 500ms 以上入力を確認していない（通信が詰まっている・HOST がニュートラルにした）間は、
      // 未確認入力を重ねず HOST の状態をそのまま使う（通信が止まった時に、自分の画面だけ動き続けないように）
      const stalled = this.ackStalled();
      if (stalled !== st.wasStalled) { st.wasStalled = stalled; if (stalled) { st.stallCount++; this.log('inputs not acknowledged for ' + CFG.inputTimeoutMs + 'ms → prediction paused', 'warn'); } }
      if (!stalled) for (const c of st.pending) {
        f.update(dt, RemoteInputController.prototype.toCmd(c), KG.game.stage);
        f.fxEvents.length = 0; f.spawnEvents.length = 0;
      }
      if (KG.game.stage.isOutOfBounds(f)) st.predHidden = true;
      st.reconciles++;
      if (wasHidden) { st.vis.x = 0; st.vis.y = 0; st.respawnSnap = true; return; }   // 復帰した瞬間は HOST の位置から
      // 予測誤差 = 作り直す前の予測位置 − 作り直した後の予測位置（同じ時点の比較）
      const ex = bx - f.x, ey = by - f.y, e = Math.hypot(ex, ey);
      st.lastErrX = ex; st.lastErrY = ey;
      st.predErr.add(e);
      if (e > 0) st.nonZeroErr++;
      if (!this.predEnabled) return;
      if (e >= CFG.errSnap) {                         // 致命的な誤差：HOST 状態へ即座に合わせる
        st.vis.x = 0; st.vis.y = 0; st.snapCount++;
        this.log('prediction snap: error ' + e.toFixed(1), 'warn');
      } else {
        // 画面の位置が急に飛ばないよう、差を表示位置のずれとして残し、数フレームで消す（物理の値は変えない）
        st.vis.x += ex; st.vis.y += ey;
        if (e >= CFG.errIgnore) st.corrections++;
      }
    }

    // 一番古い未確認入力が inputTimeoutMs（HOST がニュートラルにする時間）より古いか
    ackStalled() {
      const p = this.st.pending;
      return p.length > 0 && now() - p[0].t > CFG.inputTimeoutMs;
    }

    // 予測 ON / OFF（GUEST だけ。実験中いつでも切り替えられる。表示位置は急に飛ばずに滑らかにつながる）
    setPrediction(on) {
      this.predEnabled = !!on;
      if (this.st) { this.st.blend = true; this.st.blendUntil = now() + 400; }
      this.renderPredBtn();
      this.renderDiag();
      if (this.active) this.log('prediction ' + (on ? 'ON' : 'OFF'));
    }
    renderPredBtn() {
      const b = this.$ && this.$.predBtn;
      if (!b) return;
      b.textContent = this.predEnabled ? '予測 ON' : '予測 OFF';
      b.classList.toggle('is-on', this.predEnabled);
    }

    onState(m) {
      if (!this.active || this.role !== 'GUEST') { this.session.stats.dropped++; return; }
      const st = this.st;
      if (m.s <= st.lastStateSeqRecv) { st.staleStates++; return; }  // 古い・重複・逆順の状態は捨てる
      const t = now();
      st.lastStateSeqRecv = m.s;
      st.lastStateAt = t;
      st.stateRate.hit();
      st.waitingFirstState = false;
      // HOST のゲーム内時刻 → 自分の時計への対応。届くのが早かった（遅延が小さかった）値に素早く寄せ、遅い値にはゆっくり寄せる
      const sample = m.h - t;
      if (st.tOff == null) st.tOff = sample;
      else st.tOff += (sample - st.tOff) * (sample > st.tOff ? 0.25 : 0.02);
      st.snaps.push({ h: m.h, f: m.f });
      if (st.snaps.length > 60) st.snaps.shift();
      // 入力 → HOST で反映 → その結果の状態が届く、までの往復時間（入力番号 a で対応付け）
      if (m.a > st.lastAcked) {
        const sentAt = st.sentTimes.get(m.a);
        if (sentAt != null) st.reflect.add(t - sentAt);
        st.lastAcked = m.a;
      }
      const off = this.session.clockOffset;
      if (off != null) st.stateDelay.add(Math.max(0, t - (m.w - off)));
      this.reconcile(m);
    }

    // HOST の状態を interpDelayMs だけ遅らせた時刻で、前後 2 つの状態から補間して表示（予測はしない）
    applyView(dt) {
      const st = this.st;
      const snaps = st.snaps;
      if (snaps.length && st.tOff != null) this.applyInterpolated();
      this.applyRuimpo(dt);
    }

    // GUEST のルミポ：予測 ON なら予測用 Fighter の位置 + 表示のずれ、OFF なら Phase 2 と同じ補間の位置
    applyRuimpo(dt) {
      const st = this.st, g = KG.game, fi = g.cpu, f = this.pred;
      const interp = st.interpCpu;                      // applyInterpolated() が計算したルミポの補間結果
      let base, alive;
      if (this.predEnabled && f) {
        base = { x: f.x, y: f.y, vx: f.vx, vy: f.vy, facing: f.facing, grounded: f.grounded, state: f.state };
        alive = st.hostAlive && !st.predHidden;
      } else if (interp) {
        base = interp; alive = interp.alive;
      } else return;
      const prevX = fi.x, prevY = fi.y;
      if (st.blend) {                                   // ON / OFF を切り替えた瞬間：今の表示位置からつなぐ
        st.vis.x = fi.x - base.x; st.vis.y = fi.y - base.y; st.blend = false;
        if (Math.hypot(st.vis.x, st.vis.y) > CFG.errSnap * 3) { st.vis.x = 0; st.vis.y = 0; }
      }
      // 表示のずれを時間で消す（大きいほど速く）。物理の値には触らない
      const mag = Math.hypot(st.vis.x, st.vis.y);
      if (mag > 0) {
        // ON / OFF 切替直後は、つなぎ目が目立たないようゆっくり（120ms）
        const tau = st.blendUntil > now() ? 120 : mag > CFG.errSmall ? CFG.tauLargeMs : CFG.tauSmallMs;
        const k = Math.exp(-(dt * 1000) / tau);
        st.vis.x *= k; st.vis.y *= k;
        if (Math.hypot(st.vis.x, st.vis.y) < 0.05) { st.vis.x = 0; st.vis.y = 0; }
      }
      const wasAlive = fi.status.isAlive;
      fi.x = base.x + st.vis.x; fi.y = base.y + st.vis.y;
      fi.prevX = prevX; fi.prevY = prevY;
      if ((alive && !wasAlive) || st.respawnSnap) { fi.prevX = fi.x; fi.prevY = fi.y; st.respawnSnap = false; }
      fi.vx = base.vx; fi.vy = base.vy; fi.facing = base.facing; fi.grounded = base.grounded; fi.state = base.state;
      fi.status.lifeState = alive ? 'alive' : 'respawning';
      fi.status.invincibleTimer = this.predEnabled ? st.lastInv : base.inv;
    }

    // HOST の状態の補間（コタロは常にこれ。ルミポは予測 OFF の時だけ使う）
    applyInterpolated() {
      const st = this.st;
      const snaps = st.snaps;
      const renderH = now() + st.tOff - CFG.interpDelayMs;
      while (snaps.length > 2 && snaps[1].h <= renderH - 500) snaps.shift();   // 古すぎる状態は捨てる
      let A = null, B = null;
      for (let i = snaps.length - 1; i >= 0; i--) {
        if (snaps[i].h <= renderH) { A = snaps[i]; B = snaps[i + 1] || null; break; }
      }
      const g = KG.game;
      st.extrapolating = false;
      g.fighters.slice(0, 2).forEach((fi, idx) => {
        let x, y, src;
        if (!A) { src = snaps[0].f[idx]; x = src[0]; y = src[1]; }          // まだ最初の状態より前
        else if (!B) {
          // 新しい状態がまだ無い：速度で少しだけ先へ（最大 maxExtrapolateMs）。それ以上は止めて待つ
          src = A.f[idx];
          const e = Math.min(CFG.maxExtrapolateMs, Math.max(0, renderH - A.h)) / 1000;
          x = src[0] + src[2] * e;
          y = src[1] + (src[5] & 2 ? 0 : src[3] * e);
          if (renderH - A.h > 1) st.extrapolating = true;
        } else {
          const a = A.f[idx], b = B.f[idx];
          const k = Math.min(1, Math.max(0, (renderH - A.h) / Math.max(1, B.h - A.h)));
          src = k < 0.5 ? a : b;
          if (Math.hypot(b[0] - a[0], b[1] - a[1]) > CFG.snapDistance || !(a[5] & 1) !== !(b[5] & 1)) { x = src[0]; y = src[1]; }
          else { x = lerp(a[0], b[0], k); y = lerp(a[1], b[1], k); }
        }
        const alive = !!(src[5] & 1);
        if (idx === 1) {   // ルミポは applyRuimpo() で表示する
          st.interpCpu = { x, y, vx: src[2], vy: src[3], facing: src[4], grounded: !!(src[5] & 2), state: STATES[(src[5] >> 2) & 7] || 'idle', alive, inv: src[6] };
          return;
        }
        const wasAlive = fi.status.isAlive;
        fi.prevX = fi.x; fi.prevY = fi.y;
        fi.x = x; fi.y = y;
        if (alive && !wasAlive) { fi.prevX = x; fi.prevY = y; }  // 復帰した瞬間は前の位置から滑らせない
        fi.vx = src[2]; fi.vy = src[3];
        fi.facing = src[4];
        fi.grounded = !!(src[5] & 2);
        fi.state = STATES[(src[5] >> 2) & 7] || 'idle';
        fi.status.lifeState = alive ? 'alive' : 'respawning';
        fi.status.invincibleTimer = src[6];
      });
      if (st.extrapolating) st.extrapCount++;
    }

    // ---------------- 画面（操作実験中だけの小さな表示・GUEST のタッチ操作） ----------------
    buildDom() {
      const root = document.getElementById('game-root') || document.body;
      const hud = this.hud = document.createElement('div');
      hud.id = 'ol-move-hud';
      hud.hidden = true;
      hud.innerHTML =
        '<div class="olm-top">' +
          '<span class="olm-badge">ONLINE MOVE TEST</span>' +
          '<span class="olm-role"></span>' +
          '<button type="button" class="olm-btn olm-pred" data-olm="pred">予測 ON</button>' +
          '<button type="button" class="olm-btn" data-olm="diag">診断</button>' +
          '<button type="button" class="olm-btn olm-end" data-olm="end">実験を終了</button>' +
        '</div>' +
        '<pre class="olm-diag"></pre>' +
        '<p class="olm-hint">移動：<kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd>　ジャンプ：<kbd>Space</kbd> <kbd>W</kbd> <kbd>↑</kbd>　（攻撃・必殺・泡・ガードはこの実験では無効）</p>';
      root.appendChild(hud);
      this.$ = { role: hud.querySelector('.olm-role'), diag: hud.querySelector('.olm-diag'), predBtn: hud.querySelector('[data-olm="pred"]') };
      const bindBtn = (el, fn) => {
        el.addEventListener('pointerdown', (e) => { e.stopPropagation(); el._armed = e.pointerId; });
        el.addEventListener('pointerup', (e) => { e.stopPropagation(); if (el._armed === e.pointerId) fn(); el._armed = null; });
        el.addEventListener('click', (e) => { if (e.detail === 0) fn(); });
      };
      bindBtn(hud.querySelector('[data-olm="end"]'), () => { if (KG.sound) KG.sound.play('back'); this.end(); });
      bindBtn(hud.querySelector('[data-olm="diag"]'), () => hud.classList.toggle('diag-off'));
      bindBtn(this.$.predBtn, () => { if (KG.sound) KG.sound.play('select'); this.setPrediction(!this.predEnabled); });
      if (window.matchMedia && matchMedia('(pointer: coarse)').matches) hud.classList.add('diag-off'); // スマホは最初は畳む

      // GUEST 用のタッチ操作：左に LEFT / RIGHT（指を滑らせて切り替え可）、右に JUMP。マルチタッチ対応
      const pad = this.pad = document.createElement('div');
      pad.id = 'ol-pad';
      pad.innerHTML =
        '<div class="olp-dir" aria-label="左右移動"><span class="olp-key" data-dir="-1">◀<small>LEFT</small></span><span class="olp-key" data-dir="1">▶<small>RIGHT</small></span></div>' +
        '<div class="olp-jump" aria-label="ジャンプ"><span>▲<small>JUMP</small></span></div>';
      root.appendChild(pad);
      const dir = pad.querySelector('.olp-dir');
      const keys = dir.querySelectorAll('.olp-key');
      this.padState = { dirId: null, dir: 0, jumpIds: new Set() };
      const setDir = (d) => {
        this.padState.dir = d;
        keys.forEach((k) => k.classList.toggle('pressed', Number(k.dataset.dir) === d));
        try { KG.game.input.setAxis('olpad', d, 0); } catch (_) { /* noop */ }
      };
      const dirFrom = (e) => {
        const r = dir.getBoundingClientRect();
        return e.clientX < r.left + r.width / 2 ? -1 : 1;
      };
      dir.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.padState.dirId !== null) return;
        this.padState.dirId = e.pointerId;
        try { dir.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
        setDir(dirFrom(e));
      });
      dir.addEventListener('pointermove', (e) => { if (e.pointerId === this.padState.dirId) setDir(dirFrom(e)); });
      const dirUp = (e) => { if (e.pointerId !== this.padState.dirId) return; this.padState.dirId = null; setDir(0); };
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) dir.addEventListener(t, dirUp);
      const jump = pad.querySelector('.olp-jump');
      jump.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.padState.jumpIds.add(e.pointerId);
        try { jump.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
        try { KG.game.input.setHeld('jump', 'olpad:' + e.pointerId, true); } catch (_) { /* noop */ }
        jump.classList.add('pressed');
      });
      const jumpUp = (e) => {
        if (!this.padState.jumpIds.delete(e.pointerId)) return;
        try { KG.game.input.setHeld('jump', 'olpad:' + e.pointerId, false); } catch (_) { /* noop */ }
        if (!this.padState.jumpIds.size) jump.classList.remove('pressed');
      };
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) jump.addEventListener(t, jumpUp);
      this.padReset = () => {
        if (this.padState.dirId !== null) { this.padState.dirId = null; }
        setDir(0);
        for (const id of this.padState.jumpIds) { try { KG.game.input.setHeld('jump', 'olpad:' + id, false); } catch (_) { /* noop */ } }
        this.padState.jumpIds.clear();
        jump.classList.remove('pressed');
      };
    }

    renderDiag() {
      if (!this.active) return;
      const s = this.session, st = this.st, p = s.ping;
      const ms = (v) => v == null ? '-' : Math.round(v) + 'ms';
      const hz = (v) => v.toFixed(0) + 'Hz';
      const lines = ['PING ' + ms(p.last) + '  avg ' + ms(s.pingAvg) + '  (min ' + ms(p.min) + ' / max ' + ms(p.max) + ')'];
      if (this.role === 'HOST') {
        const r = this.remote;
        const L = r.last;
        lines.push(
          'GUEST入力 受信 ' + hz(st.inputRate.value) + '  最後の input seq ' + st.lastInputSeqRecv + '（適用済み ' + r.lastApplied + '）  古い/重複 ' + st.staleInputs + (st.floodDropped ? '  過多で無視 ' + st.floodDropped : ''),
          '入力が届くまで（推定） ' + ms(st.inputDelay.avg) + '  最大 ' + ms(st.inputDelay.max),
          '未適用の入力 ' + r.queue.length + '件  届く前に続けた回数 ' + r.dupTicks + '  追いつき ' + r.catchUps + (r.overflow ? '  あふれ ' + r.overflow : ''),
          'HOST状態 送信 ' + hz(st.stateRate.value) + '  最後の state seq ' + st.stateSeq,
          'ルミポ入力 ' + (r.neutral ? 'ニュートラル（入力なし）' : [L.mx < 0 ? 'LEFT' : '', L.mx > 0 ? 'RIGHT' : '', L.hj ? 'JUMP' : ''].filter(Boolean).join('+') || '-') +
            '  無通信でニュートラル化 ' + st.neutralCount + '回',
        );
      } else {
        const stall = st.lastStateAt ? now() - st.lastStateAt : null;
        const e = st.predErr;
        const on = this.predEnabled;
        lines.push(
          '予測 ' + (on ? 'ON（ルミポ＝すぐ反応 / コタロ＝補間）' : 'OFF（Phase 2 と同じ：HOST の結果を補間表示）') + '　［P キーで切替］',
          '入力 送信 ' + hz(st.inputRate.value) + '  最後の input seq ' + st.inputSeq + '  HOST ack ' + st.lastAcked + '  未確認 ' + st.pending.length + '件',
          'HOST状態 受信 ' + hz(st.stateRate.value) + '  最後の state seq ' + st.lastStateSeqRecv + (st.staleStates ? '  古い ' + st.staleStates : ''),
          '予測誤差 X ' + st.lastErrX.toFixed(1) + '  Y ' + st.lastErrY.toFixed(1) + '  平均 ' + (e.avg == null ? '-' : e.avg.toFixed(2)) + '  最大 ' + (e.max == null ? '-' : e.max.toFixed(1)) +
            '  （0でない ' + st.nonZeroErr + ' / ' + st.reconciles + '回）',
          '補正 ' + st.corrections + '回  snap ' + st.snapCount + '回  表示のずれ ' + Math.hypot(st.vis.x, st.vis.y).toFixed(1) +
            (this.ackStalled() ? '  ⚠ HOSTが入力を確認していないため予測を停止中' : st.stallCount ? '  予測停止 ' + st.stallCount + '回' : ''),
          '入力→HOSTで反映→受信 ' + ms(st.reflect.avg) + '  最大 ' + ms(st.reflect.max),
          (on
            ? '体感の目安（入力→画面） ルミポ 次のフレーム（約 0〜17ms）／ コタロ 約 ' + (st.stateDelay.avg == null ? '-' : Math.round(st.stateDelay.avg + CFG.interpDelayMs + 8)) + 'ms 遅れて表示'
            : '体感の目安（入力→画面） 約 ' + (st.reflect.avg == null ? '-' : Math.round(st.reflect.avg + CFG.interpDelayMs + 8) + 'ms') + '　予測なし'),
          'HOST状態が届くまで（推定） ' + ms(st.stateDelay.avg) + '  補間 ' + CFG.interpDelayMs + 'ms  外挿 ' + st.extrapCount + 'F' +
            (st.waitingFirstState ? '  HOSTの状態を待っています…' : stall > CFG.stateStallMs ? '  ⚠ HOSTの状態が ' + (stall / 1000).toFixed(1) + '秒 届いていません' : ''),
        );
      }
      const text = lines.join('\n');
      if (this.$.diag.textContent !== text) this.$.diag.textContent = text;
    }

    // テスト・確認用
    get stats() { return this.st; }
  }

  OnlineMoveTest.CONFIG = CFG;
  OnlineMoveTest.RemoteInputController = RemoteInputController;
  KG.OnlineMoveTest = OnlineMoveTest;
})(window.KG = window.KG || {});
