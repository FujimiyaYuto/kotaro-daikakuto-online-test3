/*
 * ai.js — テスト用の基本 CPU（意図的に単純）
 *
 * CpuController は「プレイヤーの InputManager と同じ形のコマンド」を毎ステップ作って返すだけです。
 * キャラクターの動き・攻撃・被弾・ルールは、プレイヤーと同じ Fighter / Combat / StockRules が処理します。
 *
 * 行動（state、デバッグ表示に出る）:
 *   RESPAWN … 場外で待機中（入力なし）
 *   WAIT    … リスポーン直後・相手がいない・近いが攻撃できない・穴の手前で止まる
 *   HURT    … 被弾して操作不能中（入力なし）
 *   CHASE   … 相手の方へ歩く
 *   JUMP    … 相手が上にいる／穴を飛び越える／段差で止まった時にジャンプ
 *   ATTACK  … 攻撃範囲で攻撃（技の最中もこの表示）
 *   RECOVER … 足場の無い所を落ちている時、ステージ中央へ戻ろうとする（空中ジャンプを使う）
 *   GUARD   … 危険に反応してガード中（Phase 8。ガードそのものはプレイヤーと同じ Fighter の仕組み）
 *   READY   … 技を出すと決めて、反応時間だけ足を止めて構えている（突進・光弾・対空）
 *   SPACE   … 通常攻撃を続けた後、少し下がって間合いを作る（その後は中距離の技も候補になる）
 *
 * 戦術（Phase 12・CHALLENGE だけ。cfg.tactics がある時だけ動く。無い難易度は Phase 11 と同じ）:
 *   画面で見える情報（位置・速度・地上/空中・技の状態・ガード・被弾・足場・飛び道具）だけから
 *   「今の目的」を少しの間（0.25〜0.55 秒）決めて動く。入力は読まない。技の性能・予兆は他の難易度と同じ。
 *     chase             … 近づく（従来の追い方）
 *     hold              … 中距離で少し待って様子を見る
 *     space             … 相手がガードを固めている／通常攻撃が続いた → 下がって間合いを作る
 *     projectile-follow … 光弾を撃った後、弾の後ろから距離を詰める（毎回ではない）
 *     anti-air          … 跳んでいる相手の下へ回る（跳んで追わない）。範囲に入ったら対空は技の判断で出す
 *     landing-pressure  … 跳んだ相手の着地点を「位置＋速度×短い時間」で粗く予測し、その手前に立つ
 *     pressure          … 相手が足場の端の近く → 中央側に回って逃がさない距離を取る
 *     punish            … 相手の技の後隙（Fighter の状態 recovery）を見て、届く距離なら詰めて通常攻撃
 *     edge-wait         … 自分が足場の端の近くで相手が足場の外 → 追わずに待つ（自滅しない）
 *   ガード硬直が解けた直後に相手が近ければ通常攻撃を有力候補にする（硬直中は攻撃しない）。
 *
 * 復帰（Phase 12.1・CHALLENGE だけ。cfg.recovery がある時だけ。無い難易度は従来の RECOVER）:
 *   足場の真上から外れて空中にいる → 着地するまで「復帰中」を続ける（途中で通常の行動に戻らない）。
 *   自分の普通の動きの性能だけを使って、左右どちらへ動き続け、いつ空中ジャンプするかを短く試算し、足場に乗れる方法を選ぶ。
 *   ジャンプしなくても乗れる → 温存（SAVE_JUMP）。待つと乗れなくなる直前に跳ぶ（LOW / FALLING_FAST / FAR_FROM_STAGE / BLAST_DANGER）。
 *   被弾の操作不能中は何もしない（操作できるようになってから判断）。ジャンプ回数・力・重力・空中速度はプレイヤーと同じ。
 *
 * 立て直し（Phase 12.2・CHALLENGE だけ。cfg.stabilize がある時だけ）:
 *   被弾の操作不能が解けた時・復帰して着地した時に、相手が近い／詰めて来ている（位置と速度で判断）／崖際／高ダメージなら
 *   短い間（最長 0.9 秒）「立て直し」をする。無敵や性能の追加は無い。
 *     空中 … 自分の着地点を自分の動きで試算し、相手から遠く足場の端でもない所へ降りる（相手へ跳んで戻らない）。
 *             乗れる所が無ければ復帰（RECOVER）に任せる。着地直前に相手の方を向く（正面でガードできるように）。
 *     地上 … 正面から近づく相手には確率でガード、まだ間合いがあれば落ちない方向へ少し下がる。
 *   終了：離れた・相手が詰めて来なくなった・ガードできた（→ ガード後反撃）・相手の後隙（→ 後隙狙い）・時間切れ。
 *   優先順位：被弾・操作不能 → 場外なら RECOVER → 場内で危険なら立て直し → 通常の CHALLENGE 戦術。
 *
 * 技の使い分け（Phase 11。ルミポの4つの攻撃）:
 *   near    … 至近距離 → 通常攻撃 cpuJab（Phase 4〜10 と同じ判断）
 *   mid     … 通常攻撃が届かない中距離・ほぼ同じ高さ → 突進（必殺ボタン）
 *   far     … 離れている・ほぼ同じ高さ → 光弾（飛び道具ボタン）
 *   antiAir … 近くの明らかに上 → 対空（上＋通常攻撃）
 *   状況が合った時に1回だけ抽選 → 当たれば「計画」として決め、反応時間（decideDelay）後に技を出す。
 *   計画中は足を止めて構え、技を切り替えない（状況が大きく変わった時だけ取りやめる）。技を出した後は Fighter のルールどおり最後まで出し切る。
 *   同じ技の連打は、技ごとの再使用間隔（cooldown）と、直前と同じ技の確率を下げる repeatPenalty で防ぐ。
 *   地上の時だけ・ガード中や復帰中は考えない（ガード・RECOVER が先）。見えている危険への反応中も新しい技は始めない。相手の入力は見ない。
 *
 * ガード判断（Phase 8）:
 *   相手の「入力」は一切見ない。見るのはゲーム画面で分かること：
 *     ・相手が近くで攻撃動作をしている（相手キャラの技の状態）
 *     ・相手の飛び道具が場にあり、自分へ向かって近づいている
 *     ・相手が地上を走ってこちらへ近づいて来ている（「攻めて来そう」。確率は少し低め）
 *   危険に気づく → 反応時間（0.15〜0.28秒）待つ → その危険について1回だけ抽選 → 当たればガード入力を出す
 *   ガードは地上・技中でない時だけ。正面から来るものだけ（振り向いて防ぐことはしない）。
 *   最低 minHold 秒は続け、危険が消えたら解除。解除後 rejudgeWait 秒は次の判断をしない。
 */
(function (KG) {
  'use strict';
  const U = KG.util;

  class CpuController {
    constructor(self, opts) {
      this.self = self;                     // 自分の Fighter
      this.getTarget = opts.getTarget;      // () => 相手の Fighter
      this.stage = opts.stage;
      this.isMatchOver = opts.isMatchOver || (() => false);
      this.cfg = opts.params || KG.cpuProfile(KG.CONFIG.cpuDifficulty); // 難易度ごとの設定（KG.cpuProfile）
      this.isAI = true;
      this.getProjectiles = opts.getProjectiles || null; // 場の飛び道具（画面に見えているもの）
      // 技の使用回数（テスト・デバッグ用。リセットしない）
      this.stats = { jab: 0, dash: 0, shot: 0, antiAir: 0, skip: 0, space: 0, follow: 0, punish: 0, punishSeen: 0, afterGuardJab: 0, landing: 0, pressure: 0, hold: 0, edgeWait: 0 };
      this.reset();
    }

    reset() {
      this.state = 'WAIT';
      this.cooldown = 0;
      this.inRangeTimer = 0;
      this.jumpHold = 0;
      this.stuckTimer = 0;
      this.sinceRespawn = 0;
      this.gapJump = null; // 穴を飛び越えている最中 { dir, takeoffY, timer }
      this.dropDir = 0;    // すり抜け足場から降りる方向（降りきるまで維持）
      // ガード判断
      this.g = {
        judged: new WeakSet(), // 判断済みの危険（同じ危険は1回だけ抽選）
        pending: null,         // 反応待ちの危険 { threat, timer }
        lastThreat: null,      // デバッグ表示用：直近に気づいた危険の種類
        lastDecision: null,    // 'GUARD' | 'NO'（抽選で見送り）| 'LATE'（もう危険でない・ガードできない）| 'BACK'（背後）
        guarding: false,
        holdTime: 0,
        rejudge: 0,
        approachKey: null,     // 「走って近づいて来る」1回分を1つの危険として扱うための目印
      };
      // 技の使い分け（Phase 11）
      this.upHold = 0;         // 対空：上入力を少しの間押し続ける（技が出るまで）
      this.backstep = 0;       // 至近距離で下がって間合いを作っている残り時間
      this.jabStreak = 0;      // 続けて通常攻撃した回数
      // 被弾後の立て直し（CHALLENGE のみ）
      this.stb = { active: false, phase: null, reason: null, endReason: this.stb ? this.stb.endReason : null, timer: 0, mode: null, modeT: 0,
        chasing: false, landX: null, safeDir: 0, evalIn: 0, airDir: 0, guardRolled: false, stunned: false, prevHitstun: 0, prevRec: false };
      // 賢い復帰（CHALLENGE のみ）
      this.rec = { active: false, reason: null, target: null, dir: 0, evalIn: 0, plan: null, blastMargin: 0, jumpReason: null };
      // 戦術（CHALLENGE のみ使う短期の状態。長い履歴は持たない）
      this.tc = {
        goal: 'chase', why: '-', timer: 0,
        holdT: 0,
        follow: 0,             // 光弾の後を追う残り時間
        landing: null,         // 粗い着地予測 { x, standX, t }
        landingRolled: false,  // 相手が跳ぶたびに 1 回だけ抽選
        airSeen: 0,            // 相手が空中にいるのを見ている時間（反応時間の代わり）
        recSeen: 0,            // 相手の後隙を見ている時間
        recLeft: 0, air: false,
        stunned: false,        // ガード硬直を受けた（解けた直後の判断用）
        afterGuard: 0,         // ガード硬直が解けてからの判断の猶予
        afterGuardWait: 0,     // 硬直が解けてから動き出すまでの小さな間
        mem: [],               // 直近の自分の行動（最大 4 件）
      };
      this.mv = {
        plan: null,            // 出すと決めた技 { key, reason, wait }
        cd: { dash: 0, shot: 0, antiAir: 0 },       // 技ごとの「次に候補にするまで」
        rethink: { dash: 0, shot: 0, antiAir: 0 },  // 見送った後、同じ状況で抽選し直すまで
        last: null,            // 直前に使った技
        lastReason: null,      // 直前に考えた状況（near / mid / far / anti-air）
        lastResult: null,      // 'plan' | 'skip' | 'lost'（状況が変わって取りやめ）| 'fire'
        current: null,         // 今出している技（デバッグ表示）
      };
    }

    // ---------------- 技の使い分け（Phase 11） ----------------
    // その技を使う状況か（loose = 計画中の継続チェック。少しゆるめ）
    moveSituation(key, me, t, dx, dy, dir, loose) {
      const M = this.cfg.moves[key];
      const moveId = key === 'dash' ? me.def.moveset.groundSpecial : key === 'shot' ? me.def.moveset.groundShoot : me.def.moveset.groundUpNeutral;
      const move = KG.MOVES[moveId];
      if (!move || !me.grounded || !me.canStartMove(move) || !t.status.canBeHit) return false;
      const dist = Math.abs(dx);
      const s = loose ? 1 : 0;
      if (key === 'antiAir') {
        const above = -dy;
        return dist <= M.rangeX + 40 * s && above >= M.minAbove - 30 * s && above <= M.maxAbove + 40 * s;
      }
      if (key === 'dash') {
        if (dist < M.minDist - 40 * s || dist > M.maxDist + 40 * s || Math.abs(dy) > M.maxDy + 20 * s) return false;
        // 突進で滑る先に同じ高さの足場が続いているか（ステージの端から飛び出して自滅しない）
        for (const d of [80, 170, 260, 350]) {
          if (this.stage.surfaceBelow(me.x + dir * d, me.y - 5, 30) === null) return false;
        }
        return true;
      }
      // shot
      return dist >= M.minDist - 60 * s && dist <= M.maxDist + 60 * s && Math.abs(dy) <= M.maxDy + 30 * s;
    }

    // 相手の飛び道具が自分へ向かって来ている（画面に見えているものだけで判断）
    projectileIncoming(me) {
      const projs = this.getProjectiles ? this.getProjectiles() : [];
      const c = this.cfg.guard;
      const cy = me.y - me.h / 2;
      for (const p of projs) {
        if (p.dead || p.owner === me) continue;
        const toMe = U.sign(me.x - p.x);
        if (toMe === 0 || U.sign(p.vx) !== toMe) continue;
        if (Math.abs(me.x - p.x) > c.projectileRange * 2) continue;
        if (Math.abs(p.y - cy) > c.projectileRangeY) continue;
        return true;
      }
      return false;
    }

    // 戻り値 true = このステップの行動は決まった（技を出した / 構えている）
    updateMoveChoice(cmd, me, t, dx, dy, dir) {
      const mv = this.mv;
      const M = this.cfg.moves;
      const dt = KG.CONFIG.fixedStep;
      const REASON = { antiAir: 'anti-air', dash: 'mid', shot: 'far' };
      if (!me.grounded) { if (mv.plan) { mv.plan = null; mv.lastResult = 'lost'; } return false; }
      // 見えている危険に反応している最中（ガードするか判断中）は、新しい技を始めない（ガード判断を優先。Phase 8〜10 と同じ守り方を保つ）
      // 相手の飛び道具がこちらへ向かって来ているのが見えている間も同じ（撃ち合いの最中に技を出して無防備にならない）
      const reacting = !!this.g.pending || this.projectileIncoming(me);

      // 決めた技を、反応時間の後に出す（途中で別の技に切り替えない）
      if (mv.plan) {
        const p = mv.plan;
        if (!this.moveSituation(p.key, me, t, dx, dy, dir, true)) {
          mv.plan = null;
          mv.lastResult = 'lost';
        } else {
          if (!reacting) p.wait -= dt;
          if (p.wait <= 0) {
            mv.plan = null;
            cmd.moveX = dir;                            // 相手の方を向いて出す
            if (p.key === 'dash') this.press(cmd, 'special');
            else if (p.key === 'shot') this.press(cmd, 'shoot');
            else { cmd.moveY = -1; this.upHold = 0.12; this.press(cmd, 'attack'); }
            mv.cd[p.key] = M[p.key].cooldown;
            mv.last = p.key;
            mv.lastResult = 'fire';
            mv.current = p.key;
            this.stats[p.key]++;
            if (this.cfg.tactics) this.remember(p.key, p.key === 'shot');
            this.cooldown = this.cfg.attackCooldown;
            this.inRangeTimer = 0;
            this.state = 'ATTACK';
            return true;
          }
          this.state = 'READY';                          // 出すと決めたら足を止めて構える（近づきすぎて取りやめにならない。見た目の合図にもなる）
          return true;
        }
      }

      // 新しい状況に気づいたら1回だけ抽選（優先：対空 → 突進 → 光弾。1ステップに1つだけ）
      if (this.cooldown > 0 || reacting) return false;
      for (const key of ['antiAir', 'dash', 'shot']) {
        if (mv.cd[key] > 0 || mv.rethink[key] > 0) continue;
        if (!this.moveSituation(key, me, t, dx, dy, dir, false)) continue;
        mv.lastReason = REASON[key];
        let chance = M[key].chance;
        if (mv.last === key) chance *= M.repeatPenalty; // 直前と同じ技は少し選びにくい
        if (Math.random() < chance) {
          mv.plan = { key, reason: REASON[key], wait: M[key].decideDelay + Math.random() * 0.08 };
          mv.lastResult = 'plan';
          this.state = 'READY';
          return true;
        } else {
          mv.rethink[key] = M[key].rethink * (0.8 + Math.random() * 0.4);
          mv.lastResult = 'skip';
          this.stats.skip++;
        }
        break;
      }
      return false;
    }

    // ---- ガード判断：画面で見える危険を探す（相手の入力は見ない）----
    findThreats(me, t) {
      const c = this.cfg.guard;
      const out = [];
      // ignoreRecovery（CHALLENGE のみ）：相手の技が後隙（recovery）に入ったら、もう危険ではないと見る（画面で見える技の状態）
      if (t && t.status.isAlive && t.action && t.action.move.hitboxes.length > 0 && !(c.ignoreRecovery && t.actionPhase() === 'recovery')) {
        if (Math.abs(t.x - me.x) <= c.meleeRangeX && Math.abs(t.y - me.y) <= c.meleeRangeY) {
          out.push({ key: t.action, kind: t.action.move.id, source: t });
        }
      }
      // 相手が地上を走ってこちらへ近づいて来る（1回の接近＝1つの危険）
      const approaching = t && t.status.isAlive && t.grounded && !t.action &&
        Math.abs(t.x - me.x) <= c.approachRange && Math.abs(t.y - me.y) <= c.meleeRangeY &&
        t.vx * U.sign(me.x - t.x) >= c.approachSpeed;
      if (approaching) {
        if (!this.g.approachKey) this.g.approachKey = { approach: true };
        out.push({ key: this.g.approachKey, kind: 'approach', source: t, chance: c.approachChance });
      } else {
        this.g.approachKey = null;
      }
      const projs = this.getProjectiles ? this.getProjectiles() : [];
      const cy = me.y - me.h / 2;
      for (const p of projs) {
        if (p.dead || p.owner === me) continue;
        const toMe = U.sign(me.x - p.x);
        if (toMe === 0 || U.sign(p.vx) !== toMe) continue;      // 離れていく飛び道具は無視
        if (Math.abs(me.x - p.x) > c.projectileRange) continue;  // まだ遠い
        if (Math.abs(p.y - cy) > c.projectileRangeY) continue;
        out.push({ key: p, kind: 'projectile:' + p.def.id, source: p });
      }
      return out;
    }

    stillDangerous(threat, me) {
      const c = this.cfg.guard;
      const s = threat.source;
      if (threat.key === s) { // 飛び道具
        return !s.dead && U.sign(s.vx) === U.sign(me.x - s.x) && Math.abs(me.x - s.x) <= c.projectileRange + 60;
      }
      if (threat.kind === 'approach') { // 近づいて来た相手がまだ近く（攻撃して来てもよい）
        return s.status.isAlive && Math.abs(s.x - me.x) <= c.approachRange + 40;
      }
      return s.action === threat.key && Math.abs(s.x - me.x) <= c.meleeRangeX + 40;
    }

    // 戻り値 true = ガード中（このステップは他の行動をしない）
    updateGuardAI(cmd, me, t) {
      const c = this.cfg.guard;
      const g = this.g;
      const dt = KG.CONFIG.fixedStep;
      g.rejudge = Math.max(0, g.rejudge - dt);
      const threats = this.findThreats(me, t);

      // ガード継続中
      if (g.guarding) {
        g.holdTime += dt;
        const danger = threats.length > 0;
        const canHold = me.grounded && me.hitstun === 0;
        if (me.guardState === 'stun') g.stunned = true;
        // releaseAfterStun（CHALLENGE のみ）：受けた攻撃が終わってガード硬直が解けたら、最低維持時間を待たずに解除して次の行動へ
        const doneAfterStun = c.releaseAfterStun && g.stunned && me.guardState !== 'stun' && !danger;
        if (!canHold || (g.holdTime >= c.minHold && !danger) || g.holdTime >= c.maxHold || doneAfterStun) {
          if (canHold && me.guardState === 'stun') { cmd.held.guard = true; this.state = 'GUARD'; return true; } // 硬直が解けるまで待つ
          g.guarding = false;
          g.rejudge = c.rejudgeWait;
          if (g.stunned && this.cfg.tactics) { // 直前にガード成功（短期記憶）
            const dl = this.cfg.tactics.afterGuardDelay;
            this.tc.afterGuard = 0.45;
            this.tc.afterGuardWait = dl[0] + Math.random() * (dl[1] - dl[0]);
          }
          g.stunned = false;
          return false;
        }
        cmd.held.guard = true;
        this.state = 'GUARD';
        return true;
      }

      // 新しい危険に気づく（再判断待ち中は気づかないふり）
      if (!g.pending && g.rejudge === 0) {
        const nt = threats.find((th) => !g.judged.has(th.key));
        if (nt) {
          g.judged.add(nt.key);
          // 気づいた時点で背後からの危険なら、ガードしない（反応中に振り向いても防がない＝背後を取る意味を残す）
          const frontAtSee = U.sign(nt.source.x - me.x) === me.facing || nt.source.x === me.x;
          g.pending = { threat: nt, frontAtSee, timer: c.reactionMin + Math.random() * (c.reactionMax - c.reactionMin) };
          g.lastThreat = nt.kind;
        }
      }

      // 反応時間が経ったら1回だけ判断
      if (g.pending) {
        g.pending.timer -= dt;
        if (g.pending.timer <= 0) {
          const th = g.pending.threat;
          g.lastPendingFront = g.pending.frontAtSee;
          g.pending = null;
          const front = U.sign(th.source.x - me.x) === me.facing || th.source.x === me.x;
          if (!front || !g.lastPendingFront) {
            g.lastDecision = 'BACK';
          } else if (!this.stillDangerous(th, me)) {
            g.lastDecision = 'LATE';
          } else if (Math.random() >= (th.chance != null ? th.chance : c.chance)) {
            g.lastDecision = 'NO';
          } else if (!me.canStartGuard()) {
            g.lastDecision = 'LATE'; // 空中・自分の技中など（ガードで後隙は消せない）
          } else {
            g.lastDecision = 'GUARD';
            g.guarding = true;
            g.stunned = false;
            g.holdTime = 0;
            cmd.held.guard = true;
            this.state = 'GUARD';
            return true;
          }
        }
      }
      return false;
    }

    // ---------------- 被弾後の立て直し（Phase 12.2・CHALLENGE のみ） ----------------
    // 操作不能が解けた瞬間・復帰して着地した瞬間に、立て直すかを1回だけ決める
    watchStabilizeTriggers(me) {
      const stb = this.stb;
      const recNow = !!(this.rec && this.rec.active);
      let trigger = null;
      if (stb.prevHitstun > 0 && me.hitstun === 0) trigger = 'after-hit';
      else if (stb.prevRec && !recNow && me.grounded) trigger = 'after-recover';
      stb.prevHitstun = me.hitstun;
      stb.prevRec = recNow;
      if (me.hitstun > 0 && stb.active) this.endStabilize('hit-again');
      const S = this.cfg.stabilize;
      stb.window = Math.max(0, (stb.window || 0) - KG.CONFIG.fixedStep);
      if (trigger === 'after-hit') { stb.window = S.rushWindow; stb.retriggers = 0; }
      const t = this.getTarget();
      if (!t || !t.status.isAlive) return;
      // 被弾後しばらくの間に、相手がまた詰めて来た → もう一度だけ立て直しを考える
      if (!trigger && !stb.active && stb.window > 0 && (stb.retriggers || 0) < S.maxRetrigger && me.grounded && me.hitstun === 0) {
        const d = Math.abs(t.x - me.x), cl = t.vx * (U.sign(me.x - t.x) || 1);
        if (cl > S.chaseSpeed && d < S.triggerRange && !(t.action && t.actionPhase() === 'recovery')) { trigger = 'rush'; stb.retriggers = (stb.retriggers || 0) + 1; }
      }
      if (!trigger) return;
      const dist = Math.abs(t.x - me.x);
      const closing = t.vx * (U.sign(me.x - t.x) || 1);           // 相手がこちらへ向かう速さ（位置と速度だけで判断）
      const chasing = closing > S.chaseSpeed && dist < S.watchRange + 150;
      const tRec = t.action && t.actionPhase() === 'recovery';
      if (tRec && dist <= this.cfg.tactics.punishRange) return;   // 相手の後隙 → 立て直さず後隙狙いへ
      const near = dist < S.triggerRange;
      const edge = me.grounded ? Math.min(this.edgeDistance(me, -1), this.edgeDistance(me, 1)) < S.edgeKeep : false;
      const highDmg = me.status.damage >= S.highDamage && dist < S.watchRange;
      if (!near && !chasing && !(edge && dist < S.watchRange) && !highDmg) return;
      const chance = (near || chasing) ? S.chanceDanger : S.chanceMild;
      if (Math.random() >= chance) { stb.endReason = 'skipped'; return; }
      const why = [];
      if (trigger === 'after-recover') why.push('post-recover');
      if (trigger === 'rush') why.push('rush-again');
      if (chasing) why.push('chased'); else if (near) why.push('near');
      if (edge) why.push('edge');
      if (highDmg) why.push('high-dmg');
      Object.assign(stb, { active: true, phase: me.grounded ? 'ground' : 'air', reason: why.join('+'), endReason: null, timer: 0,
        mode: null, modeT: 0, chasing, landX: null, safeDir: 0, evalIn: 0, airDir: 0, guardRolled: false, stunned: false });
      this.stats.stabilize = (this.stats.stabilize || 0) + 1;
    }

    endStabilize(why) {
      const stb = this.stb;
      if (!stb.active) return;
      stb.active = false; stb.endReason = why; stb.mode = null; stb.landX = null;
    }

    // 戻り値 true = 立て直し中（このステップはこの動きだけ）
    updateStabilize(cmd, me, t, dx, dy, dir) {
      const S = this.cfg.stabilize, stb = this.stb, dt = KG.CONFIG.fixedStep;
      stb.timer += dt;
      const dist = Math.abs(dx);
      const closing = t.vx * (U.sign(me.x - t.x) || 1);
      stb.chasing = closing > S.chaseSpeed;
      const tRec = t.action && t.actionPhase() === 'recovery';
      if (stb.timer > S.maxTime) { this.endStabilize('timeout'); return false; }
      // 相手の後隙：通常攻撃が間に合うだけ残っている時だけ反撃へ
      if (tRec && dist <= this.cfg.tactics.punishRange && me.grounded && this.tc.recLeft >= S.punishMinLeft) { this.endStabilize('punish'); return false; }
      // 相手が新しい攻撃を始めた → ガードするかをあらためて決める（1つの攻撃につき1回）
      if (t.action && t.action !== stb.lastSeenAction) { stb.lastSeenAction = t.action; if (t.actionPhase() !== 'recovery') stb.guardRolled = false; }

      // ---- 空中：自分の着地点を試算して、相手から遠い安全な足場へ ----
      if (!me.grounded) {
        stb.phase = 'air';
        stb.evalIn--;
        if (stb.evalIn <= 0) {
          stb.evalIn = S.airEvalEvery;
          let best = null;
          for (const d of [-1, 0, 1]) {
            const land = this.simRecovery(me, d, -1);
            if (!land) continue;
            const plat = this.stage.def.platforms.find((p) => land.x >= p.x && land.x <= p.x + p.w && Math.abs(p.y - land.y) < 2);
            const edgeD = plat ? Math.min(land.x - plat.x, plat.x + plat.w - land.x) : 0;
            const score = Math.abs(land.x - t.x) - (edgeD < S.edgeAvoid ? 400 : 0);
            if (!best || score > best.score) best = { d, land, score };
          }
          if (!best) { this.rec.active = true; this.rec.evalIn = 0; this.rec.plan = null; this.endStabilize('needs-recover'); return false; } // 乗れる所が無い → 復帰へ
          stb.airDir = best.d; stb.landX = Math.round(best.land.x); stb.landFrames = best.land.frames;
        } else if (stb.landFrames != null) stb.landFrames--;
        cmd.moveX = stb.airDir;
        // 着地の直前は相手の方を向く（着地してすぐ正面でガードできるように）
        if (stb.landFrames != null && stb.landFrames <= S.turnFrames && dist < S.guardRange + 120) cmd.moveX = dir;
        this.state = 'STABILIZE';
        return true;
      }

      // ---- 地上 ----
      stb.phase = 'ground';
      // ガードで防げた → 硬直が解けたら終了し、既存のガード後反撃へ
      if (me.guardState === 'stun') stb.stunned = true;
      if (stb.stunned && me.guardState !== 'stun') {
        const dl = S.afterGuardDelay;
        this.tc.afterGuard = 0.45; this.tc.afterGuardWait = dl[0] + Math.random() * (dl[1] - dl[0]);
        this.stats.stabGuard = (this.stats.stabGuard || 0) + 1;
        this.endStabilize('guarded'); return false;
      }
      if (dist > S.safeDist && !stb.chasing) { this.endStabilize('safe'); return false; }

      const front = U.sign(t.x - me.x) === me.facing;
      const tAttacking = !!(t.action && t.actionPhase() !== 'recovery');
      // ガード中
      if (stb.mode === 'guard') {
        stb.modeT -= dt;
        if (stb.modeT > 0 || me.guardState === 'stun') { cmd.held.guard = true; this.state = 'STABILIZE'; return true; }
        if (dist > S.nearRange + 40 && !stb.chasing) { this.endStabilize('safe'); return false; }
        stb.mode = null;
      }
      const threat = dist < S.guardRange && (stb.chasing || dist < S.nearRange || tAttacking);
      if (threat && !stb.guardRolled) {
        if (!front) {
          // 相手が背後：攻撃が始まる前なら相手の方を向く（攻撃が始まってからは振り向いて防がない）
          if (!tAttacking) { cmd.moveX = dir; this.state = 'STABILIZE'; return true; }
        } else {
          stb.guardRolled = true;
          if (Math.random() < S.guardChance && me.canStartGuard()) {
            stb.mode = 'guard'; stb.modeT = S.guardHold[0] + Math.random() * (S.guardHold[1] - S.guardHold[0]);
            cmd.held.guard = true; this.state = 'STABILIZE'; return true;
          }
        }
      }
      // まだ間合いがある／ガードしない時：落ちない方向へ少し下がる（ステージ中央側を優先）
      if (stb.mode === 'move' || (stb.chasing && dist < S.triggerRange && stb.mode !== 'hold')) {
        if (stb.mode !== 'move') {
          const away = -dir;
          const g = me.ground;
          const centerDir = g ? (U.sign(g.x + g.w / 2 - me.x) || away) : away;
          stb.safeDir = this.edgeDistance(me, away) > S.edgeKeep ? away : 0;   // 下がる先に足場が十分ある時だけ
          if (!stb.safeDir && centerDir === away) stb.safeDir = 0;
          stb.mode = stb.safeDir ? 'move' : 'hold'; stb.modeT = S.disengageTime;
        }
        if (stb.mode === 'move') {
          stb.modeT -= dt;
          if (stb.modeT <= 0) {
            if (stb.chasing && dist < S.guardRange + 60) { stb.mode = 'hold'; stb.guardRolled = false; } // まだ詰めて来る → その場で構えてガードを考える
            else { this.endStabilize('spaced'); return false; }
          }
          if (stb.mode === 'move') { cmd.moveX = stb.safeDir; this.state = 'STABILIZE'; return true; }
        }
      }
      if (stb.mode === 'hold' && !stb.chasing && dist >= S.nearRange + 60) { this.endStabilize('calm'); return false; }
      if (stb.mode === 'hold') { cmd.moveX = 0; this.state = 'STABILIZE'; return true; } // 下がれない（崖際）→ その場で構える
      // 相手が詰めて来ていない・離れている → 通常へ
      if (!stb.chasing && dist >= S.nearRange) { this.endStabilize('calm'); return false; }
      cmd.moveX = 0; this.state = 'STABILIZE'; return true;
    }

    // ---------------- 賢い復帰（Phase 12.1・CHALLENGE のみ） ----------------
    // 自分の今の状態を写した「試算用の体」で、dir へ動き続け、jumpAt フレーム目に空中ジャンプした場合に足場へ乗れるか
    simRecovery(me, dir, jumpAt) {
      const R = this.cfg.recovery;
      if (!this.simBody) this.simBody = new KG.Fighter(me.def, {});
      const b = this.simBody;
      for (const k of ['x', 'y', 'vx', 'vy', 'facing', 'airJumpsLeft', 'launched', 'canCutJump']) b[k] = me[k];
      b.prevX = b.x; b.prevY = b.y; b.grounded = false; b.ground = null; b.coyoteTimer = 0; b.jumpBufferTimer = 0;
      b.jumpQueuedDuringAction = false; b.attackBufferTimer = b.specialBufferTimer = b.shootBufferTimer = 0;
      b.action = null; b.hitstop = 0; b.hitstun = 0; b.cooldowns = {}; b.resetGuard();
      const holdF = Math.round(this.cfg.jumpHoldTime / KG.CONFIG.fixedStep);
      const lowest = this.lowestTop;
      for (let f = 0; f < R.simFrames; f++) {
        const c = KG.createEmptyCommand();
        c.moveX = dir;
        if (jumpAt >= 0 && f === jumpAt) c.pressed.jump = true;
        if (jumpAt >= 0 && f >= jumpAt && f < jumpAt + holdF) c.held.jump = true;
        b.update(KG.CONFIG.fixedStep, c, this.stage);
        if (b.grounded) return { x: b.x, y: b.y, frames: f };
        if (this.stage.isOutOfBounds(b)) return null;
        // どの足場よりも下まで落ち、もう上がる手段が無い → 失敗
        if (b.y > lowest + 10 && b.vy >= 0 && (b.airJumpsLeft === 0 || (jumpAt >= 0 && f > jumpAt) || jumpAt < 0)) return null;
      }
      return null;
    }

    // 戻り値 true = 復帰中（このステップは復帰の操作だけ）
    smartRecover(cmd, me) {
      const R = this.cfg.recovery, rec = this.rec, stage = this.stage;
      if (this.lowestTop == null) this.lowestTop = Math.max(...stage.def.platforms.map((p) => p.y));
      // 復帰を始める：足場の真上から外れた（以後は着地まで続ける＝途中で通常の行動に戻らない）
      if (!rec.active) {
        if (stage.surfaceBelow(me.x, me.y, this.cfg.safeDropDepth) !== null) return false;
        rec.active = true; rec.evalIn = 0; rec.plan = null;
      }
      this.state = 'RECOVER';
      rec.blastMargin = stage.blastZone.bottom - me.y;
      rec.evalIn--;
      if (rec.evalIn <= 0) {
        rec.evalIn = R.evalEvery;
        // 左右それぞれ：ジャンプなしで乗れるか、何フレーム後のジャンプまでなら乗れるか
        // 跳ぶ直前（猶予が少ない）の確認は、決めた方向・近いタイミングだけを毎フレーム調べる（計算を軽く）
        const prev = rec.plan;
        const tight = prev && prev.kind === 'jump' && prev.latest <= R.latestMargin;
        const dirs = tight ? [prev.dir] : [-1, 1];
        this.setRecoveryPlan(this.pickPlan(dirs.map((d) => this.evalRecoveryDir(me, d, tight))));
      } else if (rec.plan && rec.plan.kind === 'jump') {
        rec.plan.latest -= 1; rec.plan.earliest -= 1; // 考え直すまでの間も猶予は減っていく
      }
      const plan = rec.plan;
      if (!plan) {
        // 乗れる方法が見つからない：一番近い足場の方へ動き、落ち始めたら空中ジャンプ（従来と同じ最後の手段）
        cmd.moveX = U.sign(this.nearestLedgeX(me) - me.x) || 1;
        rec.reason = 'NO_ROUTE';
        if (me.vy > 0 && me.airJumpsLeft > 0) { this.jump(cmd, 'RECOVER'); rec.jumpReason = 'NO_ROUTE'; }
        return true;
      }
      cmd.moveX = plan.dir;
      if (plan.kind === 'save') { rec.reason = 'SAVE_JUMP'; return true; }
      // 跳べる窓がまだ先 → その窓の始まりで確かめ直す（今跳ぶと乗れない時は跳ばない）
      if (plan.earliest > 0) { rec.evalIn = Math.min(rec.evalIn, plan.earliest); rec.reason = 'SAVE_JUMP'; return true; }
      if (plan.latest <= R.latestMargin && rec.evalIn < R.evalEvery) { rec.evalIn = 1; } // 猶予が少ない間は毎フレーム確かめる
      // 待つと間に合わなくなる直前に空中ジャンプ（今跳んで乗れることを確かめた時だけ）
      if (plan.latest <= R.latestMargin && plan.nowOK && plan.earliest === 0) {
        const ledge = this.nearestLedgeX(me);
        let why = 'LOW';
        if (rec.blastMargin < R.blastDanger) why = 'BLAST_DANGER';
        else if (me.vy > R.fallingFast) why = 'FALLING_FAST';
        else if (Math.abs(ledge - me.x) > R.farFromStage) why = 'FAR_FROM_STAGE';
        else if (me.y <= (plan.land ? plan.land.y : 0)) why = 'LOW';
        this.jump(cmd, 'RECOVER');
        rec.reason = why; rec.jumpReason = why;
        rec.plan = null; rec.evalIn = 0; // 跳んだ後はあらためて考え直す
        return true;
      }
      rec.reason = 'SAVE_JUMP'; // まだ待てる（ジャンプは温存）
      return true;
    }

    // 1方向ぶんの試算：ジャンプなしで乗れる（save）／乗れるジャンプのタイミングの窓（jump）／無理（null）
    evalRecoveryDir(me, dir, tight) {
      const R = this.cfg.recovery;
      const noJump = this.simRecovery(me, dir, -1);
      if (noJump) return { kind: 'save', dir, land: noJump };
      if (me.airJumpsLeft <= 0) return null;
      // ジャンプのタイミング候補：近い所は細かく（狭い窓も逃さない）、遠い所は jumpStep ごと
      let earliest = -1, latest = -1, land = null, nowOK = false;
      const kMax = tight ? R.latestMargin : R.jumpMax;
      for (let k = 0; k <= kMax; k += (tight ? 1 : (k < R.latestMargin ? 2 : R.jumpStep))) {
        const r = this.simRecovery(me, dir, k);
        if (r) { if (earliest < 0) { earliest = k; land = r; } latest = k; if (k === 0) nowOK = true; }
        else if (earliest >= 0) break; // 跳べる窓が閉じた（それより遅いジャンプは調べなくてよい）
      }
      return latest >= 0 ? { kind: 'jump', dir, earliest, latest, land, nowOK } : null;
    }

    // 候補から選ぶ：ジャンプなしで乗れる方（早く乗れる方）→ 今跳んで乗れる方 → 猶予が長い方
    pickPlan(cands) {
      let best = null;
      for (const c of cands) {
        if (!c) continue;
        if (!best) { best = c; continue; }
        if (c.kind === 'save') { if (best.kind !== 'save' || c.land.frames < best.land.frames) best = c; continue; }
        if (best.kind === 'jump' && ((c.nowOK && !best.nowOK) || (c.nowOK === best.nowOK && c.latest > best.latest))) best = c;
      }
      return best;
    }

    setRecoveryPlan(best) {
      this.rec.plan = best;
      this.rec.target = best ? { x: Math.round(best.land.x), y: Math.round(best.land.y) } : null;
    }

    // いちばん近い足場の端（または上）の x
    nearestLedgeX(me) {
      let best = 0, bd = Infinity;
      for (const p of this.stage.def.platforms) {
        const x = Math.max(p.x + 10, Math.min(p.x + p.w - 10, me.x));
        const d = Math.abs(x - me.x) + Math.max(0, me.y - p.y) * 0.5;
        if (d < bd) { bd = d; best = x; }
      }
      return best;
    }

    // ---------------- 戦術（Phase 12・CHALLENGE のみ） ----------------
    remember(what, isShot) {
      const tc = this.tc;
      tc.mem.push(what);
      if (tc.mem.length > 4) tc.mem.shift();
      if (isShot && Math.random() < this.cfg.tactics.followShotChance) { tc.follow = this.cfg.tactics.followMaxTime; this.stats.follow++; }
    }

    // 自分が撃った光弾で、相手の方へ飛んでいるもの
    ownOrbToward(me, t) {
      const projs = this.getProjectiles ? this.getProjectiles() : [];
      for (const p of projs) {
        if (p.dead || p.owner !== me) continue;
        if (U.sign(p.vx) === U.sign(t.x - p.x)) return p;
      }
      return null;
    }

    // 足場の端までの距離（dir 方向）。足場が分からなければ Infinity
    edgeDistance(f, dir) {
      const g = f.ground;
      if (!f.grounded || !g) return Infinity;
      return dir > 0 ? g.x + g.w - f.x : f.x - g.x;
    }

    // 画面で見える相手の状態を毎ステップ見ておく（ガード中なども。見ている時間が反応時間の代わり）
    observe(t) {
      const tc = this.tc, dt = KG.CONFIG.fixedStep;
      const tAct = t && t.status.isAlive ? t.action : null;
      tc.recLeft = tAct && t.actionPhase() === 'recovery' ? tAct.move.totalFrames - tAct.frame : 0; // 相手の後隙の残り
      tc.recSeen = tc.recLeft > 0 ? tc.recSeen + dt : 0;
      tc.air = !!t && t.status.isAlive && !t.grounded && t.hitstun === 0;                           // 相手が空中
      tc.airSeen = tc.air ? tc.airSeen + dt : 0;
      if (!tc.air) { tc.landingRolled = false; tc.landing = null; }
    }

    // 目的を決める（一定時間ごと。ただし後隙・空中など見えた出来事は毎ステップ確認する）
    updateTactics(me, t, dx, dy, dir) {
      const tac = this.cfg.tactics, tc = this.tc, c = this.cfg;
      const dt = KG.CONFIG.fixedStep;
      const dist = Math.abs(dx);
      const setGoal = (goal, why) => {
        if (tc.goal !== goal) { if (goal === 'punish') this.stats.punishSeen++; if (goal === 'landing-pressure') this.stats.landing++; if (goal === 'pressure') this.stats.pressure++; if (goal === 'hold') this.stats.hold++; if (goal === 'edge-wait') this.stats.edgeWait++; }
        tc.goal = goal; tc.why = why;
        tc.timer = tac.reconsider[0] + Math.random() * (tac.reconsider[1] - tac.reconsider[0]);
      };

      const recLeft = tc.recLeft;
      const air = tc.air;

      // ---- 出来事で決まる目的（毎ステップ確認）----
      if (recLeft >= tac.punishMinFrames && dist <= tac.punishRange && Math.abs(dy) <= c.attackRangeY && me.grounded) {
        if (tc.goal !== 'punish') setGoal('punish', 'recovery');
        return;
      }
      if (tc.goal === 'punish') tc.timer = 0;
      const orb = this.ownOrbToward(me, t);
      if (tc.follow > 0 && orb && !air) {
        if (tc.goal !== 'projectile-follow') setGoal('projectile-follow', 'orb');
        return;
      }
      if (tc.goal === 'projectile-follow' && !orb) tc.timer = 0;
      if (air && tc.airSeen >= c.reactionTime && me.grounded) {
        const above = -dy;
        if (dist <= 220 && above >= 40) { if (tc.goal !== 'anti-air') setGoal('anti-air', 'air-near'); return; }
        if (!tc.landingRolled) {
          tc.landingRolled = true;
          if (Math.random() < tac.landingChance) {
            const L = this.predictLanding(me, t);
            if (L) { tc.landing = L; setGoal('landing-pressure', 'air-far'); return; }
          }
        }
        if (tc.goal === 'landing-pressure' && tc.landing) return;
      }
      if ((tc.goal === 'anti-air' || tc.goal === 'landing-pressure') && !air) tc.timer = 0;

      // ---- 一定時間ごとに考え直す目的 ----
      if (tc.timer > 0) return;
      // 近くで相手がガードを固めている → 下がる
      if (dist < 150 && t.guardState !== 'none' && Math.random() < tac.spaceOnGuardChance) {
        this.backstep = c.moves.backstepTime; this.stats.space++; setGoal('space', 'guarding'); return;
      }
      // 相手が足場の端の近く（同じ足場、自分は中央側）→ 逃がさない位置へ
      if (t.grounded && me.grounded && t.ground && t.ground === me.ground) {
        const g = t.ground;
        const left = t.x - g.x, right = g.x + g.w - t.x;
        const edgeDir = left < right ? -1 : 1;
        if (Math.min(left, right) < tac.edgePressureRange && U.sign(me.x - t.x) === -edgeDir && Math.random() < tac.edgePressureChance) {
          setGoal('pressure', 'edge'); tc.pressureDir = edgeDir; return;
        }
      }
      // 中距離で技が使えない → 少し待って様子を見る（いつもではない）
      const mv = this.mv;
      if (dist > 150 && dist < 330 && Math.abs(dy) < 60 && mv.cd.dash > 0 && Math.random() < tac.holdChance) {
        tc.holdT = tac.holdTime[0] + Math.random() * (tac.holdTime[1] - tac.holdTime[0]);
        setGoal('hold', 'mid-wait'); return;
      }
      setGoal('chase', dist > 330 ? 'far' : dist > 150 ? 'mid' : 'near');
    }

    // 粗い着地予測：現在位置 + 現在速度 × 短い時間（上限あり）。完全な未来予測はしない
    predictLanding(me, t) {
      const tac = this.cfg.tactics;
      const h = Math.max(0, me.y - t.y);                       // 自分の足元の高さまで
      const g = t.m.gravity;
      const tFall = (t.vy + Math.sqrt(t.vy * t.vy + 2 * g * h)) / g; // 目安の時間（これも上限で切る）
      const tp = Math.min(tac.landingPredictMax, Math.max(0, tFall));
      const x = t.x + t.vx * tp;
      if (Math.abs(x - me.x) > tac.landingRange) return null;
      const side = U.sign(me.x - x) || 1;                        // 自分がいる側に立つ
      const standX = x + side * tac.landingStandoff;
      if (this.stage.surfaceBelow(standX, me.y - 5, 30) === null) return null; // 同じ高さの足場が無い所へは行かない
      return { x, standX, t: tp };
    }

    // 目的に沿った移動。true = このステップの動きを決めた（false なら従来の追い方）
    tacticMove(cmd, me, t, dx, dy, dir) {
      const tac = this.cfg.tactics, tc = this.tc;
      const moveTo = (x, label) => {
        const d = x - me.x;
        if (Math.abs(d) < 14) { cmd.moveX = 0; this.state = 'WAIT'; return true; }
        const md = U.sign(d);
        // 移動先の少し先に同じ高さの足場があるか（端から落ちない）
        if (this.stage.surfaceBelow(me.x + md * (me.w / 2 + 30), me.y - 5, 30) === null) { cmd.moveX = 0; this.state = 'WAIT'; return true; }
        cmd.moveX = md; this.state = label; return true;
      };
      if (!me.grounded) return false;
      // 自分が足場の端の近くで、相手が足場の外（空中で下に地面が無い）→ 追わずに待つ
      const tOffstage = this.stage.surfaceBelow(t.x, t.y, this.cfg.safeDropDepth) === null;
      if (tOffstage && this.edgeDistance(me, dir) < tac.edgeCaution) {
        if (tc.goal !== 'edge-wait') { tc.goal = 'edge-wait'; tc.why = 'ledge'; tc.timer = 0.3; this.stats.edgeWait++; }
        cmd.moveX = 0; this.state = 'WAIT'; return true;
      }
      switch (tc.goal) {
        case 'hold':
          if (tc.holdT > 0) { cmd.moveX = 0; this.state = 'WAIT'; return true; }
          tc.timer = 0; return false;
        case 'anti-air': {
          // 相手の下（少し手前）へ。跳んで追わない（範囲に入れば対空は技の判断で出る）
          if (Math.abs(dx) < 50) { cmd.moveX = 0; this.state = 'WAIT'; return true; }
          return moveTo(t.x - U.sign(dx) * 40, 'CHASE');
        }
        case 'landing-pressure':
          if (!tc.landing) return false;
          return moveTo(tc.landing.standX, 'CHASE');
        case 'pressure': {
          const standX = t.x - tc.pressureDir * tac.edgePressureGap;
          return moveTo(standX, 'CHASE');
        }
        default:
          return false; // chase / punish / projectile-follow / space は従来の追い方（space は上の backstep が動かす）
      }
    }

    press(cmd, action) {
      cmd.pressed[action] = true;
      cmd.held[action] = true;
    }

    jump(cmd, state) {
      this.press(cmd, 'jump');
      this.jumpHold = this.cfg.jumpHoldTime;
      this.state = state || 'JUMP';
    }

    // 1固定ステップにつき1回呼ばれる（InputManager.poll と同じ役割）
    poll() {
      const cmd = KG.createEmptyCommand();
      const me = this.self;
      const c = this.cfg;
      const dt = KG.CONFIG.fixedStep;
      const stage = this.stage;

      this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.jumpHold > 0) { this.jumpHold -= dt; cmd.held.jump = true; }
      if (this.upHold > 0) { this.upHold -= dt; cmd.moveY = -1; }
      for (const k in this.mv.cd) {
        this.mv.cd[k] = Math.max(0, this.mv.cd[k] - dt);
        this.mv.rethink[k] = Math.max(0, this.mv.rethink[k] - dt);
      }
      if (!me.action) this.mv.current = null;
      const tac = c.tactics;
      if (tac) {
        const tc = this.tc;
        tc.timer -= dt; tc.holdT = Math.max(0, tc.holdT - dt);
        tc.follow = Math.max(0, tc.follow - dt); tc.afterGuard = Math.max(0, tc.afterGuard - dt); tc.afterGuardWait = Math.max(0, tc.afterGuardWait - dt);
        this.observe(this.getTarget());
      }

      // ---- 動かない条件 ----
      if (!me.status.isAlive) { this.reset(); this.state = 'RESPAWN'; return cmd; }
      this.sinceRespawn += dt;
      if (this.isMatchOver()) { this.state = 'WAIT'; return cmd; }
      if (c.stabilize) {
        if (me.hitstun > 0) this.gapJump = null;        // 被弾したら、穴越えの続き（相手の方へ飛び続ける）をやめる（CHALLENGE のみ）
        this.watchStabilizeTriggers(me);                 // 被弾が解けた／復帰して着地した瞬間を見る（CHALLENGE のみ）
      }
      if (me.hitstun > 0) { this.state = 'HURT'; this.inRangeTimer = 0; this.g.pending = null; this.g.guarding = false; this.mv.plan = null; return cmd; }
      if (this.sinceRespawn < c.respawnWait) { this.state = 'WAIT'; return cmd; }

      // ---- ガード判断（地上のみ。空中・復帰中は下の既存の行動を優先）----
      if (me.grounded && this.updateGuardAI(cmd, me, this.getTarget())) { this.mv.plan = null; return cmd; } // ガード中は技を考えない
      if (!me.grounded) { this.g.guarding = false; this.g.pending = null; }

      if (me.action) { this.state = 'ATTACK'; return cmd; }

      // ---- 穴を飛び越えている最中：向こう岸へ進み続ける（届かなければ空中ジャンプ）----
      if (this.gapJump) {
        const gj = this.gapJump;
        gj.timer -= dt;
        if (me.grounded && gj.timer < gj.total - 0.1) this.gapJump = null;
        else if (gj.timer <= 0) this.gapJump = null;
        else {
          this.state = 'JUMP';
          cmd.moveX = gj.dir;
          const overGround = stage.surfaceBelow(me.x, me.y, c.safeDropDepth) !== null;
          if (!overGround && me.vy > 0 && me.y > gj.takeoffY - 20 && me.airJumpsLeft > 0) this.jump(cmd);
          return cmd;
        }
      }

      // ---- 復帰（CHALLENGE：賢い復帰。着地するまで最優先）----
      if (c.recovery) {
        if (me.grounded) this.rec.active = false;
        else if (this.smartRecover(cmd, me)) return cmd;
      }

      // ---- 足場の無い所を落ちている → ステージへ戻る ----
      if (!me.grounded && !c.recovery) {
        const landX = me.x + me.vx * 0.4; // 少し先の着地点も見る（穴を飛び越えている最中を誤判定しない）
        const below = stage.surfaceBelow(me.x, me.y, c.safeDropDepth) !== null ||
                      stage.surfaceBelow(landX, me.y, c.safeDropDepth) !== null;
        if (!below) {
          this.state = 'RECOVER';
          cmd.moveX = U.sign(0 - me.x) || 1;
          if (me.vy > 0 && me.airJumpsLeft > 0) this.jump(cmd, 'RECOVER');
          return cmd;
        }
      }

      const t = this.getTarget();
      if (!t || !t.status.isAlive) { if (this.stb && this.stb.active) this.endStabilize('no-target'); this.state = 'WAIT'; this.inRangeTimer = 0; return cmd; }

      const dx = t.x - me.x;
      const dy = t.y - me.y;           // 足元の高さの差（負 = 相手が上）
      const dir = U.sign(dx) || me.facing;

      // ---- 立て直し（CHALLENGE：場内で危険な時だけ。場外なら上の RECOVER が先）----
      if (c.stabilize && this.stb.active && this.updateStabilize(cmd, me, t, dx, dy, dir)) return cmd;

      // ---- 技の使い分け（突進・光弾・対空）。通常攻撃（至近距離）は下の従来の判断 ----
      if (this.updateMoveChoice(cmd, me, t, dx, dy, dir)) return cmd;

      // ---- 下がって間合いを作る（至近距離で通常攻撃を続けた後にときどき）----
      if (this.backstep > 0) {
        this.backstep -= dt;
        const back = -dir;
        const behindX = me.x + back * (me.w / 2 + c.ledgeProbe + 20);
        if (me.grounded && stage.surfaceBelow(behindX, me.y - 5, 30) !== null) { // 後ろに足場がある時だけ
          cmd.moveX = back;
          this.state = 'SPACE';
          return cmd;
        }
        this.backstep = 0;
      }

      // ---- 戦術（CHALLENGE のみ）：今の目的を更新（動き方は下の tacticMove）----
      if (tac) this.updateTactics(me, t, dx, dy, dir);
      // 相手の後隙を見ている（反応時間以上見ていて、届く距離）／ガード硬直が解けた直後で相手が近い
      const punishNow = !!tac && this.tc.goal === 'punish' && this.tc.recSeen >= c.reactionTime;
      const quickAfterGuard = !!tac && this.tc.afterGuard > 0 && this.tc.afterGuardWait === 0 && Math.abs(dx) <= tac.afterGuardJabRange;

      // ---- 攻撃 ----
      const inRange = Math.abs(dx) <= c.attackRangeX && Math.abs(dy) <= c.attackRangeY && t.status.canBeHit;
      this.inRangeTimer = inRange ? this.inRangeTimer + dt : 0;
      // ガード硬直明けは、ガードした時点で相手を見ている（反応済み）ので間合い待ちを省く。後隙を狙う時は間隔待ちを省く
      // 後隙は見てから反応時間が過ぎている（recSeen）ので、間合いに入った瞬間に出してよい
      const ready = this.inRangeTimer >= c.reactionTime || (quickAfterGuard && inRange) || (punishNow && inRange);
      if (inRange && (this.cooldown === 0 || punishNow || quickAfterGuard) && ready) {
        if (Math.random() >= c.attackChance) { // 難易度による見送り（EASY）。NORMAL / HARD は必ず攻撃
          this.cooldown = c.hesitateTime;
          this.inRangeTimer = 0;
          this.state = 'WAIT';
          return cmd;
        }
        // 同じ攻撃を続けたら、ときどき下がって間合いを作る（CHALLENGE は続くほど下がりやすい。後隙・ガード明けは攻める）
        const bsChance = tac ? (this.jabStreak >= tac.jabStreakHard ? tac.backstepAtHard : c.moves.backstepChance) : c.moves.backstepChance;
        const bsFrom = tac ? tac.jabStreakSoft : 2;
        if (!punishNow && !quickAfterGuard && this.jabStreak >= bsFrom && Math.random() < bsChance) {
          this.jabStreak = 0;
          this.backstep = c.moves.backstepTime;
          this.mv.rethink.dash = 0;          // 下がった後は中距離の技をあらためて考える
          this.stats.space++;
          this.inRangeTimer = 0;
          this.mv.lastReason = 'near';
          this.mv.lastResult = 'space';
          this.state = 'SPACE';
          cmd.moveX = -dir;
          return cmd;
        }
        cmd.moveX = dir;               // 相手の方を向いて攻撃（地上の技中は移動しない）
        this.press(cmd, 'attack');
        this.mv.plan = null;
        this.mv.lastReason = 'near';
        this.mv.current = 'jab';
        this.jabStreak = this.mv.last === 'jab' ? this.jabStreak + 1 : 1;
        if (tac) {
          this.remember('jab', false);
          if (punishNow) this.stats.punish++;
          if (quickAfterGuard) this.stats.afterGuardJab++;
          this.tc.afterGuard = 0;
        }
        this.mv.last = 'jab';
        this.stats.jab++;
        this.cooldown = c.attackCooldown;
        this.state = 'ATTACK';
        return cmd;
      }

      // ---- 戦術に沿った動き（CHALLENGE のみ。扱わない目的は下の従来の追い方）----
      if (tac && this.tacticMove(cmd, me, t, dx, dy, dir)) return cmd;

      // ---- 近づく ----
      this.state = Math.abs(dx) > c.stopDistance ? 'CHASE' : 'WAIT';
      if (this.state === 'CHASE') cmd.moveX = dir;
      // 相手が下にいて、自分はすり抜け足場の上 → 近い方の端から降りる（降りきるまで方向を変えない）
      const onOneway = me.grounded && me.ground && me.ground.type === 'oneway';
      if (!onOneway || dy <= c.attackRangeY) this.dropDir = 0;
      if (onOneway && dy > c.attackRangeY && (this.dropDir || Math.abs(dx) <= c.stopDistance * 2)) {
        const g = me.ground;
        if (!this.dropDir) this.dropDir = (me.x - g.x) < (g.x + g.w - me.x) ? -1 : 1;
        cmd.moveX = this.dropDir;
        this.state = 'CHASE';
      }

      if (me.grounded) {
        // 相手が上の足場にいる → ジャンプ
        if (dy < -c.targetAboveHeight && Math.abs(dx) < c.targetAboveRangeX) {
          this.jump(cmd);
          return cmd;
        }
        if (cmd.moveX !== 0) {
          // 進行方向の先に足場が無い（穴）→ 先に足場があれば飛び越え、無ければ止まる
          const aheadX = me.x + dir * (me.w / 2 + c.ledgeProbe);
          if (stage.surfaceBelow(aheadX, me.y - 5, c.safeDropDepth) === null) {
            const farX = me.x + dir * c.gapJumpReach;
            // 向こう岸は少し低くてもよい（Phase 11 修正：島の上のすり抜け足場から本島へ戻れず止まり続けていた）
            // CHALLENGE：飛び越えた先の着地点で相手が待ち構えている → 少しの間（最長 gapWaitMax 秒）跳ばずに様子を見る
            const S = c.stabilize;
            // （相手が技を出している間は待ち構えていないとみなして、その隙に跳ぶ）
            const camped = S && t.grounded && Math.abs(t.x - farX) < S.gapCampRange && !t.action;
            if (camped) this.gapWait = (this.gapWait || 0) + dt; else this.gapWait = 0;
            if (camped && this.gapWait < S.gapWaitMax) {
              // 足場の奥へ下がって光弾が届く距離を取る（光弾は上の技の判断で出る）。下がれなければその場で待つ
              const back = -dir;
              if (Math.abs(dx) < S.gapBackoffDist && this.edgeDistance(me, back) > 60) { cmd.moveX = back; this.state = 'SPACE'; }
              else { cmd.moveX = 0; this.state = 'WAIT'; }
              return cmd;
            }
            if (stage.surfaceBelow(farX, me.y - 80, 320) !== null) {
              this.gapWait = 0;
              this.jump(cmd);
              this.gapJump = { dir, takeoffY: me.y, timer: 1.2, total: 1.2 };
            } else {
              cmd.moveX = 0;
              this.state = 'WAIT';
            }
            return cmd;
          }
          // 歩こうとしているのに進めない（段差・壁）→ ジャンプ
          this.stuckTimer = Math.abs(me.vx) < 20 ? this.stuckTimer + dt : 0;
          if (this.stuckTimer > c.stuckTime) {
            this.stuckTimer = 0;
            this.jump(cmd);
          }
        } else {
          this.stuckTimer = 0;
        }
      } else if (dy < -40 && me.vy > 0 && me.airJumpsLeft > 0 && Math.abs(dx) < 250) {
        // 空中で相手より低いまま落ち始めた → 空中ジャンプ
        this.jump(cmd);
      }
      return cmd;
    }
  }

  KG.CpuController = CpuController;
})(window.KG = window.KG || {});
