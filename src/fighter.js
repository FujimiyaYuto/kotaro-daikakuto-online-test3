/*
 * fighter.js — 対戦キャラクター（プレイヤーも CPU も同じクラス）
 *
 * キャラクターは入力元を知らず、update() に渡される「コマンド」だけで動きます。
 *   プレイヤー … InputManager（キーボード / タッチ）が作るコマンド
 *   CPU        … CpuController（ai.js）が作るコマンド
 * 違いはこの入力元と、キャラクター定義（見た目・技・移動値）だけです。
 *
 * 技の流れ: 攻撃入力 → startMove() → 毎フレーム action.frame が進む
 *           → hitboxes の start〜end の間だけ getActiveHitboxes() が判定を返す
 *           → totalFrames を過ぎたら通常状態へ
 * 被弾の流れ: Combat → receiveHit() → ヒットストップ → 操作不能（hitstun）で吹っ飛ぶ
 *           → hitstun が切れたら操作に戻る（吹っ飛びの勢いは着地まで入力で急には消えない）
 * 当たり判定は3種類を分けています:
 *   body      … 地形との衝突（w / h）
 *   hurtboxes … 攻撃を受ける領域
 *   hitboxes  … 技の攻撃判定（技の有効フレーム中のみ）
 */
(function (KG) {
  'use strict';
  const U = KG.util;

  class Fighter {
    constructor(def, opts) {
      opts = opts || {};
      this.def = def;
      this.id = opts.id || def.id;
      this.controller = opts.controller || null; // poll() でコマンドを返すもの
      this.image = opts.image;
      this.m = Object.assign({}, KG.DEFAULT_MOVEMENT, def.movement);

      // 地形用の当たり判定（x = 中心, y = 足元）
      this.w = def.body.width;
      this.h = def.body.height;
      this.x = 0; this.y = 0;
      this.vx = 0; this.vy = 0;
      this.prevX = 0; this.prevY = 0; // 描画補間用

      this.facing = 1;
      this.grounded = false;
      this.ground = null;
      this.airJumpsLeft = this.m.maxAirJumps;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.jumpQueuedDuringAction = false;
      this.attackBufferTimer = 0;
      this.specialBufferTimer = 0;
      this.shootBufferTimer = 0;
      this.canCutJump = false;
      // 技ごとの再使用待ち（秒）: { 技ID: 残り秒 }。技データの cooldown で設定
      this.cooldowns = {};
      // 技データの fx に書かれた演出イベント（Game が毎ステップ回収して Effects へ渡す）
      this.fxEvents = [];
      // 技データの spawns に書かれた飛び道具の発射（Game が回収して ProjectileSystem へ渡す）
      this.spawnEvents = [];
      // 飛び道具の同時数チェック（Game が設定: (fighter, 種類ID) => 撃てるか）
      this.projectileGate = null;

      // 技の実行状態: null または { move, frame, hitVictims:Set }
      this.action = null;
      // ヒットストップ残りフレーム（この間は動きが止まる）
      this.hitstop = 0;
      // ガード: guardState = 'none' | 'startup'（有効になる前）| 'active'（防御中）| 'stun'（ガード硬直）
      this.guardState = 'none';
      this.guardFrames = 0;      // startup / active の経過フレーム
      this.guardStun = 0;        // ガード硬直の残りフレーム
      this.guardFacing = 1;      // ガード開始時の向き（ガード中は変わらない）
      // 被弾による操作不能の残りフレーム / 吹っ飛び中フラグ（着地まで）
      this.hitstun = 0;
      this.launched = false;
      // 見た目用（被弾時の回転・震え・白フラッシュ）
      this.angle = 0; this.prevAngle = 0;
      this.shake = 0;
      this.flash = 0;

      // 対戦ルール上の状態（蓄積ダメージ・ストック等）。KG.CombatStatus を外から付ける
      this.status = opts.status || null;
      this.spawnSlot = 0;
      this.hudLabel = opts.hudLabel || null;           // デバッグ表示用（PLAYER / CPU）
      this.displayName = def.displayName || this.hudLabel; // 画面表示用の名前
      this.debugColor = opts.debugColor || null; // デバッグ表示の色分け（{ hurt, hurtFill, hit, hitFill }）

      // 'idle' | 'run' | 'jump' | 'fall' | 'attack' | 'hurt'
      this.state = 'idle';
      this.justLanded = false;
    }

    spawn(point) {
      this.x = this.prevX = point.x;
      this.y = this.prevY = point.y;
      this.vx = this.vy = 0;
      this.facing = point.facing || 1;
      this.grounded = false;
      this.ground = null;
      this.airJumpsLeft = this.m.maxAirJumps;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.jumpQueuedDuringAction = false;
      this.attackBufferTimer = 0;
      this.specialBufferTimer = 0;
      this.shootBufferTimer = 0;
      this.canCutJump = false;
      this.cooldowns = {};
      this.fxEvents.length = 0;
      this.spawnEvents.length = 0;
      this.action = null;
      this.hitstop = 0;
      this.hitstun = 0;
      this.launched = false;
      this.angle = this.prevAngle = 0;
      this.shake = 0;
      this.flash = 0;
      this.resetGuard();
      this.state = 'fall';
    }

    // ---------------- ガード ----------------
    resetGuard() {
      this.guardState = 'none';
      this.guardFrames = 0;
      this.guardStun = 0;
    }

    // 今ガードを始められるか（地上・技中でない・被弾中でない）
    canStartGuard() {
      return this.grounded && !this.action && this.hitstun === 0;
    }

    // 防御が有効な状態か（startup 中は無効。ガード硬直中は防御したまま）
    isGuarding() {
      return this.guardState === 'active' || this.guardState === 'stun';
    }

    // source（攻撃してきたキャラ / 飛び道具）の位置が正面側なら防げる。背後からは防げない
    canGuardAgainst(source) {
      if (!this.isGuarding()) return false;
      const side = KG.util.sign(source.x - this.x);
      return side === 0 || side === this.guardFacing;
    }

    // Combat から呼ばれる：ガード成功（ダメージ・吹っ飛びなし。少し押されて短い硬直）
    receiveGuard(g) {
      const c = KG.CONFIG.guard;
      this.guardState = 'stun';
      this.guardStun = g.guardstun;
      this.vx = g.pushDir * g.pushback;
      this.hitstop = Math.max(this.hitstop, g.hitstop);
      this.jumpBufferTimer = this.attackBufferTimer = this.specialBufferTimer = this.shootBufferTimer = 0;
      this.state = 'guardstun';
    }

    // ガード中・ガード硬直中の1ステップ（入力で移動・ジャンプ・攻撃しない。向きも変えない）
    updateGuard(dt, cmd, stage) {
      const m = this.m;
      const c = KG.CONFIG.guard;
      if (this.guardState === 'stun') {
        this.guardStun--;
        // ガード硬直中に押した攻撃・ジャンプは先行入力として残す（硬直が解けた瞬間に反撃できる）
        const buf = m.attackBufferTime;
        if (cmd.pressed.jump) this.jumpBufferTimer = m.jumpBufferTime;
        if (cmd.pressed.attack) this.attackBufferTimer = buf;
        if (cmd.pressed.special) this.specialBufferTimer = buf;
        if (cmd.pressed.shoot) this.shootBufferTimer = buf;
        if (this.guardStun <= 0) this.guardState = cmd.held.guard ? 'active' : 'none';
      } else {
        this.guardFrames++;
        if (this.guardState === 'startup' && this.guardFrames >= c.startupFrames) this.guardState = 'active';
      }
      // ガードを押している間に押された攻撃・ジャンプは捨てる（解除後に勝手に出ない）
      if (this.guardState !== 'stun' && this.guardState !== 'none') {
        this.jumpBufferTimer = this.attackBufferTimer = this.specialBufferTimer = this.shootBufferTimer = 0;
      }
      this.facing = this.guardFacing;
      this.vx = KG.util.approach(this.vx, 0, c.pushbackFriction * dt);
      this.vy = Math.min(this.vy + m.gravity * dt, m.maxFallSpeed);
      const hit = KG.Physics.moveAndCollide(this, stage, dt);
      this.grounded = hit.landed;
      this.ground = hit.ground;
      if (!this.grounded) this.resetGuard(); // 足場から押し出されたらガード終了（空中ガードは無し）
      this.angle += (0 - this.angle) * KG.util.damp(14, dt);
      this.state = this.guardState === 'stun' ? 'guardstun' : 'guard';
    }

    getBounds() {
      return { left: this.x - this.w / 2, right: this.x + this.w / 2, top: this.y - this.h, bottom: this.y };
    }

    getHurtboxes() {
      return this.def.hurtboxes.map((b) => U.orientBox(this.x, this.y, this.facing, b));
    }

    // 今このフレームで有効な攻撃判定（ワールド座標）。攻撃していなければ空
    getActiveHitboxes() {
      const act = this.action;
      if (!act) return [];
      const out = [];
      for (const hb of act.move.hitboxes) {
        if (act.frame >= hb.start && act.frame <= hb.end) {
          out.push({ rect: U.orientBox(this.x, this.y, this.facing, hb), data: hb });
        }
      }
      return out;
    }

    // 状況から出す技を選ぶ。kind = 'Neutral'（通常攻撃）| 'Special'（必殺技）| 'Shoot'（飛び道具）
    // moveset のキーは 'groundNeutral' 'airNeutral' 'groundSpecial' 'airSpecial' など。
    // 上を入れながら（moveY < 0）なら 'groundUpNeutral' のような「上」版を先に探し、無ければ通常版（Phase 11。コタロは上版を持たないので変化なし）
    selectMove(kind, moveY) {
      const ms = this.def.moveset;
      if (!ms) return null;
      const base = (this.grounded ? 'ground' : 'air');
      const k = kind || 'Neutral';
      const id = (moveY < 0 && ms[base + 'Up' + k]) || ms[base + k];
      return id ? KG.MOVES[id] : null;
    }

    startMove(move) {
      this.action = { move, frame: 0, hitVictims: new Set() };
    }

    // 技を終える（最後まで出し切った / ジャンプで中断 / 被弾で中断）。再使用待ちはここから始まる
    clearAction() {
      const act = this.action;
      if (!act) return;
      if (act.move.cooldown) this.cooldowns[act.move.id] = act.move.cooldown;
      this.action = null;
    }

    // 必殺技などの再使用待ちの状態（HUD・ボタン表示用）。その種類の技を持っていなければ null
    cooldownState(kind) {
      const id = this.def.moveset && (this.def.moveset['ground' + kind] || this.def.moveset['air' + kind]);
      const move = id && KG.MOVES[id];
      if (!move || !move.cooldown) return null;
      const remaining = this.cooldowns[id] || 0;
      return { remaining, total: move.cooldown, ratio: remaining / move.cooldown, inUse: !!(this.action && this.action.move === move) };
    }

    // 技を今出せるか：再使用待ちでなく、飛び道具を出す技なら同時数の上限に達していない
    canStartMove(move) {
      if (!move || this.cooldowns[move.id]) return false;
      if (move.spawns && this.projectileGate) {
        for (const s of move.spawns) if (!this.projectileGate(this, s.projectile)) return false;
      }
      return true;
    }

    // ボタン表示用：その種類の技の { ratio: 再使用待ちの残り割合, blocked: 同時数などで撃てない, inUse }
    availability(kind) {
      const cs = this.cooldownState(kind);
      if (!cs) return null;
      const move = KG.MOVES[this.def.moveset['ground' + kind] || this.def.moveset['air' + kind]];
      let blocked = false;
      if (move.spawns && this.projectileGate) for (const s of move.spawns) if (!this.projectileGate(this, s.projectile)) blocked = true;
      return { ratio: cs.inUse ? 1 : cs.ratio, blocked, inUse: cs.inUse };
    }

    // 今の技の段階（デバッグ表示用）: 'startup' | 'active' | 'recovery'
    // 攻撃判定のフレームと飛び道具を出すフレームを「active」とみなす
    actionPhase() {
      const act = this.action;
      if (!act) return null;
      const wins = act.move.hitboxes.map((h) => [h.start, h.end]);
      if (act.move.spawns) for (const s of act.move.spawns) wins.push([s.frame, s.frame]);
      if (wins.some(([a, b]) => act.frame >= a && act.frame <= b)) return 'active';
      return act.frame < Math.min(...wins.map((w) => w[0])) ? 'startup' : 'recovery';
    }

    // 攻撃がヒットした時に Combat から呼ばれる
    onHitConfirm(hit) {
      this.hitstop = Math.max(this.hitstop, hit.hitstop);
      // 突進技：当たった / ガードされた瞬間に勢いを落とす（相手をすり抜けない）
      const act = this.action;
      if (act && act.move.stopOnContact != null) this.vx *= act.move.stopOnContact;
    }

    // 攻撃を受けた時に Combat から呼ばれる（ダメージ加算・吹っ飛び量の計算は Combat 側で済んでいる）
    receiveHit(hit) {
      const c = KG.CONFIG.combat;
      this.vx = hit.knockback.x * hit.direction;
      this.vy = hit.knockback.y;
      this.grounded = false;
      this.ground = null;
      this.clearAction();            // 攻撃中なら中断
      this.resetGuard();             // ガードは解ける（背後から当たった・startup 中など）
      this.canCutJump = false;
      this.jumpBufferTimer = 0;
      this.attackBufferTimer = 0;
      this.specialBufferTimer = 0;
      this.shootBufferTimer = 0;
      this.jumpQueuedDuringAction = false;
      this.hitstop = Math.max(this.hitstop, hit.hitstop);
      this.hitstun = KG.Knockback.hitstunFrames(hit.knockback);
      this.launched = true;
      if (c.restoreAirJumpOnHit) this.airJumpsLeft = this.m.maxAirJumps;
      this.shake = hit.hitstop;
      this.flash = 0.18;
      this.state = 'hurt';
    }

    // 技中で、まだジャンプで抜けられない間は true
    isActionLocked() {
      return !!this.action && this.action.frame < this.action.move.jumpCancelFrom;
    }

    update(dt, cmd, stage) {
      const m = this.m;
      this.prevX = this.x;
      this.prevY = this.y;
      this.prevAngle = this.angle;
      this.justLanded = false;
      this.flash = Math.max(0, this.flash - dt);
      for (const id in this.cooldowns) {
        this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
        if (this.cooldowns[id] === 0) delete this.cooldowns[id];
      }

      // ---- ヒットストップ中は停止（入力の先行受付だけ行う）----
      if (this.hitstop > 0) {
        this.hitstop--;
        if (this.hitstun === 0) {
          if (cmd.pressed.jump) { this.jumpBufferTimer = m.jumpBufferTime; this.jumpQueuedDuringAction = true; }
          if (cmd.pressed.attack) this.attackBufferTimer = m.attackBufferTime;
          if (cmd.pressed.special) this.specialBufferTimer = m.attackBufferTime;
          if (cmd.pressed.shoot) this.shootBufferTimer = m.attackBufferTime;
        }
        return;
      }
      this.shake = 0;

      // ---- 被弾による操作不能中 ----
      if (this.hitstun > 0) {
        this.resetGuard();
        this.updateHitstun(dt, stage);
        return;
      }

      // ---- ガード（押している間だけ。硬直中は離しても硬直が終わるまで続く）----
      if (this.guardState === 'stun') {
        this.updateGuard(dt, cmd, stage);
        return;
      }
      if (cmd.held.guard && (this.guardState !== 'none' || this.canStartGuard())) {
        if (this.guardState === 'none') {
          this.guardState = 'startup';
          this.guardFrames = 0;
          this.guardFacing = this.facing;
        }
        this.updateGuard(dt, cmd, stage);
        return;
      }
      if (this.guardState !== 'none') this.resetGuard(); // 離したらすぐ通常状態（解除の硬直なし）

      // ---- タイマー ----
      this.coyoteTimer = this.grounded ? m.coyoteTime : Math.max(0, this.coyoteTimer - dt);
      if (cmd.pressed.jump) this.jumpBufferTimer = m.jumpBufferTime;
      else this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
      if (this.jumpBufferTimer === 0) this.jumpQueuedDuringAction = false;
      if (cmd.pressed.attack) this.attackBufferTimer = m.attackBufferTime;
      else this.attackBufferTimer = Math.max(0, this.attackBufferTimer - dt);
      if (cmd.pressed.special) this.specialBufferTimer = m.attackBufferTime;
      else this.specialBufferTimer = Math.max(0, this.specialBufferTimer - dt);
      if (cmd.pressed.shoot) this.shootBufferTimer = m.attackBufferTime;
      else this.shootBufferTimer = Math.max(0, this.shootBufferTimer - dt);

      const input = cmd.moveX;

      // ---- 攻撃開始 ----
      // 必殺技 → 通常攻撃 の順に調べる。再使用待ち中の技は出ない（先行入力は短時間だけ残る）
      if (!this.action) {
        const tries = [['Special', 'specialBufferTimer'], ['Shoot', 'shootBufferTimer'], ['Neutral', 'attackBufferTimer']];
        for (const [kind, buf] of tries) {
          if (this[buf] <= 0) continue;
          const move = this.selectMove(kind, cmd.moveY);
          if (!this.canStartMove(move)) continue;
          if (input !== 0) this.facing = U.sign(input); // 押した方向へ攻撃
          this.startMove(move);
          this[buf] = 0;
          break;
        }
      }
      const act = this.action;
      const mo = act ? act.move.motion : null;

      // ---- 左右移動 ----
      if (act && this.grounded) {
        // 地上の技中は入力を受けず、勢いを残して滑る
        this.vx = U.approach(this.vx, 0, mo.groundFriction * dt);
      } else if (this.grounded) {
        const target = input * m.groundSpeed;
        let accel;
        if (input === 0) accel = m.groundDecel;
        else if (U.sign(this.vx) !== 0 && U.sign(this.vx) !== U.sign(input)) accel = m.turnAccel;
        else accel = m.groundAccel;
        this.vx = U.approach(this.vx, target, accel * dt);
      } else if (this.launched && Math.abs(this.vx) > m.airSpeed) {
        // 吹っ飛びの勢いが残っている間は、入力で急に止まらない（ゆっくり減速）
        this.vx = U.approach(this.vx, U.sign(this.vx) * m.airSpeed, KG.CONFIG.combat.launchAirFriction * dt);
      } else {
        this.launched = false;
        const control = act ? mo.airControl : 1;
        if (input !== 0) {
          this.vx = U.approach(this.vx, input * m.airSpeed, m.airAccel * control * dt);
        } else {
          this.vx = U.approach(this.vx, 0, m.airDecel * dt);
        }
      }
      if (input !== 0 && !act) this.facing = U.sign(input); // 技中は向きを固定

      // ---- 技の前進 ----
      if (act && mo.impulseFrame && act.frame + 1 === mo.impulseFrame) {
        if (this.grounded) {
          this.vx = this.facing * Math.min(Math.max(this.vx * this.facing, 0) + mo.groundImpulse, mo.groundMaxSpeed);
        } else {
          this.vx = this.facing * Math.min(Math.max(this.vx * this.facing, 0) + mo.airImpulse, Math.max(mo.airMaxSpeed, this.vx * this.facing));
        }
      }

      // ---- ジャンプ ----
      if (this.jumpBufferTimer > 0 && this.isActionLocked()) {
        this.jumpQueuedDuringAction = true; // 技が終わる（抜けられる）まで保留
      } else if (this.jumpBufferTimer > 0) {
        let jumped = false;
        if (this.grounded || this.coyoteTimer > 0) {
          this.vy = -m.jumpSpeed;
          this.grounded = false;
          this.ground = null;
          this.coyoteTimer = 0;
          jumped = true;
        } else if (this.airJumpsLeft > 0 && (cmd.pressed.jump || this.jumpQueuedDuringAction)) {
          // 空中ジャンプは「押した瞬間」のみ（先行入力は着地後の地上ジャンプに回す）
          this.vy = -m.airJumpSpeed;
          this.airJumpsLeft--;
          jumped = true;
        }
        if (jumped) {
          this.jumpBufferTimer = 0;
          this.jumpQueuedDuringAction = false;
          this.canCutJump = true;
          this.clearAction(); // 後隙をジャンプでキャンセル
        }
      }
      // 上昇中にボタンを離したら上昇を弱める（小ジャンプ）
      if (this.canCutJump && !cmd.held.jump && this.vy < 0) {
        this.vy *= m.jumpCutFactor;
        this.canCutJump = false;
      }
      if (this.vy >= 0) this.canCutJump = false;

      // ---- 重力 ----
      this.vy = Math.min(this.vy + m.gravity * dt, m.maxFallSpeed);

      // ---- 移動と衝突 ----
      const wasGrounded = this.grounded;
      const hit = KG.Physics.moveAndCollide(this, stage, dt);
      this.grounded = hit.landed;
      this.ground = hit.ground;
      if (this.grounded) {
        this.airJumpsLeft = m.maxAirJumps;
        this.launched = false;
        if (!wasGrounded) this.justLanded = true;
      }

      // ---- 技のフレームを進める ----
      if (this.action) {
        const a = this.action;
        a.frame++;
        // 技データの fx（演出）で、このフレームに出すものを Game へ渡す
        if (a.move.fx) for (const fx of a.move.fx) if (fx.frame === a.frame) this.fxEvents.push({ fx, action: a, owner: this });
        // 技データの spawns（飛び道具）で、このフレームに出すものを Game へ渡す
        if (a.move.spawns) for (const s of a.move.spawns) if (s.frame === a.frame) this.spawnEvents.push({ spawn: s, owner: this });
        if (a.frame > a.move.totalFrames) this.clearAction();
      }

      // 被弾後の傾きを戻す
      this.angle += (0 - this.angle) * U.damp(14, dt);

      // ---- 状態 ----
      if (this.action) this.state = 'attack';
      else if (this.grounded) this.state = Math.abs(this.vx) > 10 ? 'run' : 'idle';
      else this.state = this.vy < 0 ? 'jump' : 'fall';
    }

    // 操作不能中：入力を受けず、吹っ飛びの勢いと重力だけで動く
    updateHitstun(dt, stage) {
      const m = this.m;
      const c = KG.CONFIG.combat;
      this.hitstun--;
      this.vx = U.approach(this.vx, 0, (this.grounded ? c.hurtGroundFriction : c.launchAirFriction) * dt);
      this.vy = Math.min(this.vy + m.gravity * dt, m.maxFallSpeed);
      const hit = KG.Physics.moveAndCollide(this, stage, dt);
      if (hit.landed && !this.grounded) this.justLanded = true;
      this.grounded = hit.landed;
      this.ground = hit.ground;
      if (this.grounded) {
        this.airJumpsLeft = m.maxAirJumps;
        this.launched = false;
      }
      // 見た目：空中では勢いに応じて回転、着地したら起き上がる
      if (!this.grounded) this.angle += this.vx * c.tumbleSpin * dt;
      else this.angle += (0 - this.angle) * U.damp(14, dt);
      this.state = 'hurt';
    }

    // alpha: 前ステップと現ステップの間の補間率
    draw(ctx, alpha) {
      let x = U.lerp(this.prevX, this.x, alpha);
      const y = U.lerp(this.prevY, this.y, alpha);
      if (this.shake > 0 && this.hitstun > 0) x += (Math.random() - 0.5) * 8; // 被弾ヒットストップ中の震え
      const angle = U.lerp(this.prevAngle, this.angle, alpha);

      // 技中は全体の変形（拡縮・前方オフセット・前傾）。足元を基準に変形するので接地はずれない
      let v = null;
      if (this.action) {
        const f = this.hitstop > 0 ? this.action.frame : this.action.frame + alpha;
        v = KG.sampleMoveVisual(this.action.move, f);
      }

      // ガード中は少しだけ身をかがめる（画像全体の軽い変形のみ）
      if (!v && this.guardState !== 'none') v = { sx: 1.03, sy: 0.965, ox: -2, rot: 0 };

      ctx.save();
      ctx.globalAlpha = KG.invincibleAlpha(this.status); // リスポーン後の無敵中は点滅
      // 被弾の回転は体の中心まわり
      if (angle !== 0) {
        ctx.translate(x, y - this.h / 2);
        ctx.rotate(angle);
        ctx.translate(-x, -(y - this.h / 2));
      }
      ctx.translate(x + (v ? v.ox * this.facing : 0), y);
      if (v) {
        ctx.rotate(v.rot * this.facing);
        ctx.scale(v.sx, v.sy);
      }
      // 技の発光（画像の後ろに円形の光を描く。画像自体は加工しない）
      if (this.action && this.action.move.glow) {
        const f = this.hitstop > 0 ? this.action.frame : this.action.frame + alpha;
        KG.drawMoveGlow(ctx, this.action.move, f, this.h);
      }
      if (this.def.render === 'critter') this.drawCritter(ctx);
      else this.drawSprite(ctx);
      ctx.restore();
    }

    // ガード中の薄い防御表示：正面側の半円の膜（体を覆い隠さない）
    drawGuard(ctx, alpha) {
      if (this.guardState === 'none') return;
      const x = KG.util.lerp(this.prevX, this.x, alpha);
      const y = KG.util.lerp(this.prevY, this.y, alpha);
      const cy = y - this.h * 0.55;
      const R = this.h * 0.72;
      const f = this.guardFacing;
      const base = f > 0 ? 0 : Math.PI;
      const on = this.guardState === 'startup' ? Math.min(1, this.guardFrames / KG.CONFIG.guard.startupFrames) * 0.5 : 1;
      const flash = this.guardState === 'stun' ? 0.35 : 0;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, cy, R * 0.55, x, cy, R);
      g.addColorStop(0, 'rgba(150, 230, 255, 0)');
      g.addColorStop(1, `rgba(150, 230, 255, ${0.22 * on + flash * 0.4})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x, cy);
      ctx.arc(x, cy, R, base - 1.15, base + 1.15);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(220, 250, 255, ${0.55 * on + flash})`;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, cy, R, base - 1.05, base + 1.05); ctx.stroke();
      ctx.restore();
    }

    // 提供画像をそのまま描く（画像自体は加工しない。拡縮・反転・回転・透明度のみ）
    drawSprite(ctx) {
      const img = this.image;
      if (!img) return;
      const s = this.def.sprite;
      const scale = s.scale;
      // 元画像の向きと進行方向が違う時だけ左右反転
      if (this.facing !== s.nativeFacing) ctx.scale(-1, 1);
      ctx.drawImage(img, -s.anchorX * scale, -s.anchorY * scale, s.sourceWidth * scale, s.sourceHeight * scale);
    }

    // CPU「ルミポ」：丸い体・小さな目・左右のヒレ・頭の上の光る玉・足元の小さな足（Canvas の図形のみ）。足元原点で描く
    drawCritter(ctx) {
      const c = this.def.critter;
      const h = this.h;
      const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      const lit = this.flash > 0;
      const act = this.action;
      const phase = act ? this.actionPhase() : null;
      const windup = phase === 'startup';
      const cue = act ? act.move.critterCue : null;
      // 予兆の進み具合（0 → 1）。技の溜めが進むほど頭の玉が明るく大きくなる
      const firstActive = act ? Math.min(...act.move.hitboxes.map((h) => h.start), ...(act.move.spawns || []).map((q) => q.frame)) : 0;
      const charge = windup ? Math.min(1, act.frame / Math.max(1, firstActive - 1)) : 0;
      const cols = windup ? c.windup : c.body;
      const cy = -h * 0.47;           // 体の中心
      const rx = 37, ry = 50;         // 体の大きさ（当たり判定 70×120 に収まる）
      const bob = Math.sin(t * 3.2) * 1.5;

      // 突進中の残像（体の後ろに薄いたまご形を2つ）
      if (cue === 'dash' && phase === 'active') {
        for (let i = 1; i <= 2; i++) {
          ctx.fillStyle = `rgba(${c.glow}, ${0.22 / i})`;
          ctx.beginPath(); ctx.ellipse(-this.facing * i * 26, cy, rx * (1 - i * 0.08), ry * (1 - i * 0.08), 0, 0, Math.PI * 2); ctx.fill();
        }
      }

      // まわりの淡い光（背景の青から浮かび上がらせる）
      const aura = ctx.createRadialGradient(0, cy, 10, 0, cy, 82);
      aura.addColorStop(0, `rgba(${c.glow}, ${windup ? 0.42 : 0.26})`);
      aura.addColorStop(1, `rgba(${c.glow}, 0)`);
      ctx.fillStyle = aura;
      ctx.beginPath(); ctx.arc(0, cy, 82, 0, Math.PI * 2); ctx.fill();

      // 足（小さな丸）
      ctx.fillStyle = lit ? '#ffffff' : cols[2];
      ctx.beginPath(); ctx.ellipse(-14, -6, 11, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(14, -6, 11, 7, 0, 0, Math.PI * 2); ctx.fill();

      // ヒレ（パタパタ）
      const flap = Math.sin(t * 7) * 0.25;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * (rx - 4), cy + 6 + bob);
        ctx.rotate(side * (0.5 + flap));
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.quadraticCurveTo(side * 26, -4, side * 22, 12);
        ctx.quadraticCurveTo(side * 10, 8, 0, 9);
        ctx.closePath();
        ctx.fillStyle = lit ? '#ffffff' : 'rgba(255, 190, 170, 0.85)';
        ctx.fill();
        ctx.strokeStyle = c.line;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // 体（半透明感のあるたまご形）
      const body = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
      body.addColorStop(0, cols[0]);
      body.addColorStop(0.55, cols[1]);
      body.addColorStop(1, cols[2]);
      ctx.beginPath(); ctx.ellipse(0, cy + bob, rx, ry, 0, 0, Math.PI * 2);
      ctx.globalAlpha *= 0.96;
      ctx.fillStyle = lit ? '#ffffff' : body;
      ctx.fill();
      ctx.globalAlpha /= 0.96;
      ctx.strokeStyle = c.line;
      ctx.lineWidth = 3;
      ctx.stroke();
      if (!lit) {
        // お腹の明るい部分とツヤ
        ctx.fillStyle = 'rgba(255, 245, 235, 0.35)';
        ctx.beginPath(); ctx.ellipse(this.facing * 4, cy + 16 + bob, rx * 0.55, ry * 0.45, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.beginPath(); ctx.ellipse(-12, cy - 28 + bob, 8, 5, -0.5, 0, Math.PI * 2); ctx.fill();
      }

      // 頭の上の光る玉（細い茎の先）
      const tipX = this.facing * 10 + Math.sin(t * 2.3) * 3, tipY = cy - ry - 18 + bob;
      ctx.strokeStyle = c.line;
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(0, cy - ry + 3 + bob); ctx.quadraticCurveTo(this.facing * 2, tipY + 2, tipX, tipY); ctx.stroke();
      // 技の溜め中は玉が大きく・暖かい色に強く光る（光弾は特に大きく）。放った直後も少し残光
      const orbR = 13 + charge * (cue === 'shot' ? 14 : 8) + (phase === 'active' ? 6 : 0);
      const orb = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, orbR);
      orb.addColorStop(0, 'rgba(230, 255, 250, 0.95)');
      orb.addColorStop(0.35, charge > 0.05 || phase === 'active' ? c.chargeLure : c.lure);
      orb.addColorStop(1, 'rgba(169, 255, 240, 0)');
      ctx.fillStyle = orb;
      ctx.beginPath(); ctx.arc(tipX, tipY, orbR, 0, Math.PI * 2); ctx.fill();
      if (charge > 0.05) {
        // 溜めの輪（小さく縮んでいく輪＝もうすぐ出るの合図）
        ctx.strokeStyle = `rgba(255, 230, 190, ${0.35 + 0.5 * charge})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(tipX, tipY, orbR + 16 * (1 - charge) + 4, 0, Math.PI * 2); ctx.stroke();
      }

      if (lit) return;
      // 目（進行方向に寄せる）
      const ex = this.facing * 11, ey = cy - 10 + bob;
      for (const dx of [-9, 9]) {
        ctx.fillStyle = '#2a1030';
        ctx.beginPath(); ctx.ellipse(ex + dx, ey, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(ex + dx + 1.5, ey - 2.5, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      // 口（小さく）
      ctx.strokeStyle = c.line;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ex, ey + 12, 4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    }

    drawDebug(ctx, alpha, colors) {
      const x = U.lerp(this.prevX, this.x, alpha);
      const y = U.lerp(this.prevY, this.y, alpha);
      const dc = this.debugColor || { hurt: colors.hurt, hurtFill: colors.hurtFill };
      ctx.save();
      // 地形用 body
      ctx.strokeStyle = this.grounded ? colors.bodyGrounded : colors.bodyAir;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - this.w / 2, y - this.h, this.w, this.h);
      // Hurtbox
      for (const b of this.def.hurtboxes) {
        const r = U.orientBox(x, y, this.facing, b);
        ctx.fillStyle = dc.hurtFill;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = dc.hurt;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.setLineDash([]);
      }
      // 足元
      ctx.fillStyle = '#ff5c8a';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  KG.Fighter = Fighter;
})(window.KG = window.KG || {});
