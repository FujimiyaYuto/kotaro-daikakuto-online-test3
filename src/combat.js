/*
 * combat.js — 攻撃判定の解決・蓄積ダメージ・吹っ飛び量の計算
 *
 * 毎ステップ、キャラ更新の後に呼ばれます。
 *   攻撃側: getActiveHitboxes() と hitVictims（同じ技で同じ相手に2回当てないための記録）を持つもの
 *           キャラ（Fighter）は技の action から、飛び道具（Projectile）は attackContext() から取り出す
 *           飛び道具は owner（発射者）には当たらない
 *   受け側: getHurtboxes() / receiveHit(hit) / status（KG.CombatStatus）を持つもの
 * Hitbox と Hurtbox が重なったら、ダメージを加算し、吹っ飛び量を計算した hit を受け側へ渡します。
 * プレイヤーでも CPU でも同じ処理です（攻撃側・受け側の区別なし）。
 *
 * ガード：受け側が canGuardAgainst(攻撃してきたもの) で「正面から来た」と判断したら、
 *   通常ヒットの代わりにガード成立（ダメージ0・吹っ飛びなし・少し押されて短い硬直）。
 *   正面かどうかは、攻撃してきたキャラ / 飛び道具の実際の位置と受け側の位置で決まる（技の種類は問わない）。
 */
(function (KG) {
  'use strict';
  const U = KG.util;

  /*
   * 吹っ飛び量（このゲーム独自のシンプルな線形式）
   *
   *   倍率 = 1 + 攻撃を受ける前の蓄積ダメージ(%) × growth   （上限 maxKnockbackScale）
   *   吹っ飛び速度 = 技の基本ノックバック × 倍率
   *
   * 角度（前方＋少し上）は変わらず、速さだけが伸びます。
   * 受ける前のダメージを使うので、0% の相手への1発目は Phase 2 と同じ吹っ飛びになります。
   */
  KG.Knockback = {
    scale(damageBefore, hitboxData) {
      const c = KG.CONFIG.combat;
      const growth = hitboxData.knockbackGrowth != null ? hitboxData.knockbackGrowth : c.knockbackGrowth;
      return Math.min(1 + Math.max(0, damageBefore) * growth, c.maxKnockbackScale);
    },
    compute(damageBefore, hitboxData) {
      const s = this.scale(damageBefore, hitboxData);
      const x = hitboxData.knockback.x * s;
      const y = hitboxData.knockback.y * s;
      return { x, y, scale: s, speed: Math.hypot(x, y) };
    },
  };

  // 操作不能フレーム数（吹っ飛びが強いほど少し長い）
  KG.Knockback.hitstunFrames = function (knockback) {
    const c = KG.CONFIG.combat;
    return Math.round(Math.min(c.hitstunMaxFrames, c.hitstunBaseFrames + knockback.speed * c.hitstunPerSpeed));
  };

  function isActive(e) { return !e.status || e.status.isAlive; }

  // 攻撃側の「今の攻撃」: { hitVictims, move }。キャラは技の action、飛び道具は自分自身
  function attackContext(a) {
    return a.attackContext ? a.attackContext() : { hitVictims: a.action.hitVictims, move: a.action.move };
  }

  KG.Combat = {
    /*
     * 2段階で処理します。
     *   1) 全員の Hitbox × 全員の Hurtbox を「この瞬間の状態」で調べ、当たりを全部集める
     *   2) 集めた当たりをまとめて適用する
     * 先に処理した側の被弾で後の側の攻撃が消えることが無いので、
     * 同じフレームに互いの攻撃が当たれば両方ヒットします（相打ち）。
     */
    resolve(attackers, targets, effects, onHitboxes) {
      const hits = [];
      for (const a of attackers) {
        if (!isActive(a)) continue;
        const hitboxes = a.getActiveHitboxes ? a.getActiveHitboxes() : [];
        if (hitboxes.length === 0) continue;
        if (onHitboxes) onHitboxes(a, hitboxes); // デバッグ表示用
        for (const t of targets) {
          const ac = attackContext(a);
          if (t === a || t === a.owner || !t.receiveHit || ac.hitVictims.has(t)) continue;
          if (t.status && !t.status.canBeHit) continue; // 場外中・無敵中は受けない
          const hurt = t.getHurtboxes();
          let landed = null;
          for (const hb of hitboxes) {
            for (const hu of hurt) {
              if (U.rectsOverlap(hb.rect, hu)) { landed = { hb, hu }; break; }
            }
            if (landed) break;
          }
          if (!landed) continue;
          // 吹っ飛ぶ向き：技データで 'away' なら攻撃側から相手へ向かう方向（周囲攻撃用）、それ以外は攻撃側の向き
          const d = landed.hb.data;
          const direction = d.knockbackDirection === 'away' ? (U.sign(t.x - a.x) || a.facing) : a.facing;
          hits.push({ a, t, landed, ctx: ac, move: ac.move, direction });
        }
      }

      for (const h of hits) {
        const { a, t, landed } = h;
        const d = landed.hb.data;
        const st = t.status;
        const point = overlapCenter(landed.hb.rect, landed.hu);

        // ---- ガード成立 ----
        if (t.canGuardAgainst && t.canGuardAgainst(a)) {
          const gc = KG.CONFIG.guard;
          const g = {
            attacker: a.owner || a,
            source: a,
            target: t,
            move: h.move,
            guarded: true,
            pushDir: U.sign(t.x - a.x) || -t.guardFacing, // 攻撃してきたものから離れる向き
            pushback: d.guardPushback != null ? d.guardPushback : gc.pushback,
            guardstun: d.guardstun != null ? d.guardstun : gc.stunFrames,
            hitstop: gc.hitstop,
            point,
          };
          h.ctx.hitVictims.add(t);   // 同じ攻撃で2回ガード判定しない
          t.receiveGuard(g);
          a.onHitConfirm(g);         // 攻撃側も短く止まる（飛び道具はここで弾けて消える）
          if (st) st.lastHitResult = 'GUARD';
          if (effects) effects.spawnGuard(point.x, point.y, t.guardFacing);
          continue;
        }
        if (st) st.lastHitResult = 'HIT';
        const damageBefore = st ? st.damage : 0;
        const knockback = KG.Knockback.compute(damageBefore, d);
        if (st) {
          st.damage = Math.min(KG.CONFIG.combat.maxDamage, st.damage + (d.damage || 0));
          st.lastKnockback = knockback;
        }
        const hit = {
          attacker: a.owner || a,  // 飛び道具なら発射者
          source: a,               // 実際に当たったもの（キャラ or 飛び道具）
          target: t,
          move: h.move,
          direction: h.direction,
          damage: d.damage || 0,
          knockback,          // { x, y, scale, speed }。受け側が x × direction, y を速度として使う
          hitstop: d.hitstop,
          point,
        };
        h.ctx.hitVictims.add(t);
        t.receiveHit(hit);
        a.onHitConfirm(hit);
        if (effects) effects.spawnHit(hit.point.x, hit.point.y, hit.direction, d.hitEffect);
      }
      return hits.length;
    },
  };

  function overlapCenter(a, b) {
    const l = Math.max(a.x, b.x), r = Math.min(a.x + a.w, b.x + b.w);
    const t = Math.max(a.y, b.y), bt = Math.min(a.y + a.h, b.y + b.h);
    return { x: (l + r) / 2, y: (t + bt) / 2 };
  }
})(window.KG = window.KG || {});
