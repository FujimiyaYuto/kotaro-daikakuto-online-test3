/*
 * projectile.js — 飛び道具（Projectile）の共通の仕組み
 *
 * 飛び道具は「キャラとは独立したゲームオブジェクト」です。
 *   ・種類ごとの性能は KG.PROJECTILES にデータとして登録する（速度・寿命・大きさ・攻撃判定・地形の扱い・同時数）
 *   ・技データの spawns[] に { frame, projectile: 種類ID, x, y } を書くと、そのフレームに発射される
 *   ・攻撃判定は通常技と同じ Combat（combat.js）が処理する。ダメージ・吹っ飛び・ヒットストップも共通
 *
 * Projectile が持つもの:
 *   owner（発射者。自分には当たらない）/ x, y（中心）/ vx, vy / life（残り秒）/ hitbox / hitVictims（ヒット済みの相手）
 */
(function (KG) {
  'use strict';
  const U = KG.util;

  /*
   * 飛び道具の性能データ
   *   speed       … 横方向の速さ（向いている方向へ）
   *   lifetime    … 寿命（秒）。速さ × 寿命 がおおよその射程
   *   size        … 攻撃判定の一辺（中心からの正方形）
   *   maxPerOwner … 1人が同時に出せる最大数（達していると新しく撃てない）
   *   terrain     … 'solid' = 普通の地面に当たると消える（すり抜け足場は通過）
   *   wobble      … 上下のゆらぎ { amp: 幅, freq: 角速度(rad/s) }。実際の位置（判定）ごと揺れるので見た目とずれない
   *   hitbox      … 通常技の hitbox と同じ項目（damage / knockback / hitstop / hitEffect）
   *   render      … 描き方の種類（effects.js ではなくここの RENDERERS）
   */
  KG.PROJECTILES = {
    bubble: {
      id: 'bubble',
      name: 'バブルショット',
      speed: 540,           // コタロの走り(440)より少し速い
      lifetime: 1.5,        // 射程 約810
      size: 40,
      maxPerOwner: 2,
      terrain: 'solid',
      wobble: { amp: 5, freq: 5.5 },
      hitbox: {
        damage: 5,
        knockback: { x: 380, y: -220 },   // 押し返す程度（上へは小さく）
        hitstop: 4,
        hitEffect: 'bubble',
      },
      render: 'bubble',
      radius: 22,           // 見た目の半径（判定 size とほぼ同じ）
    },

    // ルミポの光弾（Phase 11）。泡より遅く・小さく・同時に1発だけ。ジャンプで跳び越えられる高さへ下りてから進む
    lumipoOrb: {
      id: 'lumipoOrb',
      name: 'ルミポ光弾',
      speed: 380,           // 泡(540)・コタロの走り(440)より遅い（見てから跳べる／走って逃げられる）
      lifetime: 2.0,        // 射程 約760
      size: 26,
      maxPerOwner: 1,       // 連射できない
      terrain: 'solid',
      // 頭の玉（足元から -124）で生まれ、0.2 秒かけて体の中ほど（-70）へ下りてから真っすぐ飛ぶ
      settle: { toY: -70, time: 0.2 },
      wobble: { amp: 3, freq: 7 },
      hitbox: {
        damage: 6,
        knockback: { x: 420, y: -260 },
        hitstop: 4,
        hitEffect: 'warm',
      },
      render: 'lumipoOrb',
      radius: 11,
      spawnEffect: 'warm',  // 発射時・消滅時の演出の種類（無ければ泡の演出）
    },
  };

  let nextId = 1;

  class Projectile {
    constructor(def, owner, x, y, dir) {
      this.id = nextId++;
      this.def = def;
      this.owner = owner;
      this.facing = dir;             // Combat が吹っ飛ぶ向きに使う
      this.x = this.prevX = x;
      this.baseY = y;
      this.y = this.prevY = y;
      this.vx = def.speed * dir;
      this.vy = 0;
      this.age = 0;
      this.life = def.lifetime;
      this.dead = false;
      this.deathReason = null;
      this.hitVictims = new Set();   // 同じ相手に2回当てない
      this.phase = Math.random() * Math.PI * 2;
      // settle（任意）：発射位置から指定の高さへ少しずつ下りる（発射者の足元基準の高さを発射時に決める）
      this.settleFrom = y;
      this.settleTo = def.settle && owner ? owner.y + def.settle.toY : y;
    }

    update(dt) {
      this.prevX = this.x;
      this.prevY = this.y;
      this.age += dt;
      this.life -= dt;
      this.x += this.vx * dt;
      const w = this.def.wobble;
      const st = this.def.settle;
      if (st) {
        const k = Math.min(1, this.age / st.time);
        this.baseY = this.settleFrom + (this.settleTo - this.settleFrom) * (k * (2 - k)); // ease-out で下りる
      }
      const newY = this.baseY + (w ? Math.sin(this.age * w.freq) * w.amp : 0); // 発射位置から始まって上下にゆらぐ
      this.vy = (newY - this.y) / dt;
      this.y = newY;
      if (this.life <= 0) this.kill('lifetime');
    }

    kill(reason) {
      if (this.dead) return;
      this.dead = true;
      this.deathReason = reason;
    }

    rect() {
      const s = this.def.size;
      return { x: this.x - s / 2, y: this.y - s / 2, w: s, h: s };
    }

    // ---- Combat から見た「攻撃側」としてのインターフェース ----
    getActiveHitboxes() {
      if (this.dead) return [];
      return [{ rect: this.rect(), data: this.def.hitbox }];
    }
    attackContext() { return { hitVictims: this.hitVictims, move: this.def }; }
    onHitConfirm() { this.kill('hit'); } // 単発：当たったら弾ける（発射者にはヒットストップをかけない）
  }

  /*
   * ProjectileSystem — 場にある飛び道具の一覧と、発射・更新・消滅・描画
   */
  class ProjectileSystem {
    constructor(stage, effects) {
      this.stage = stage;
      this.effects = effects;
      this.list = [];
    }

    count(owner, defId) {
      let n = 0;
      for (const p of this.list) if (!p.dead && p.owner === owner && (!defId || p.def.id === defId)) n++;
      return n;
    }

    // 同時数の上限に達していないか
    canSpawn(owner, defId) {
      const def = KG.PROJECTILES[defId];
      return !!def && this.count(owner, defId) < def.maxPerOwner;
    }

    // 技データの spawns[] から呼ばれる。offset は右向き基準・足元から
    spawnFrom(owner, spawn) {
      const def = KG.PROJECTILES[spawn.projectile];
      if (!def || !this.canSpawn(owner, def.id)) return null;
      const x = owner.x + owner.facing * spawn.x;
      const y = owner.y + spawn.y;
      const p = new Projectile(def, owner, x, y, owner.facing);
      this.list.push(p);
      if (this.effects) {
        if (def.spawnEffect === 'warm') this.effects.spawnWarmSpark(x, y, 0.6);
        else this.effects.spawnBubblePuff(x, y, owner.facing);
      }
      return p;
    }

    update(dt) {
      const b = this.stage.blastZone;
      for (const p of this.list) {
        if (p.dead) continue;
        p.update(dt);
        if (p.dead) continue;
        // 地形：普通の地面に当たったら消える（すり抜け足場は通過）
        if (p.def.terrain === 'solid') {
          const r = p.rect();
          for (const s of this.stage.solids) {
            if (U.rectsOverlap(r, s)) { p.kill('terrain'); break; }
          }
        }
        // 場外ラインの外へ出たら消える
        if (p.x < b.left || p.x > b.right || p.y < b.top || p.y > b.bottom) p.kill('out');
      }
      this.removeDead();
    }

    // 消えた飛び道具を取り除き、弾ける演出を出す（場外・リセットは演出なし）
    removeDead() {
      if (!this.list.some((p) => p.dead)) return;
      for (const p of this.list) {
        if (p.dead && this.effects && (p.deathReason === 'hit' || p.deathReason === 'terrain' || p.deathReason === 'lifetime')) {
          if (p.def.spawnEffect === 'warm') this.effects.spawnWarmSpark(p.x, p.y, p.deathReason === 'hit' ? 1 : 0.7);
          else this.effects.spawnBubblePop(p.x, p.y, p.def.radius, p.deathReason === 'hit');
        }
      }
      this.list = this.list.filter((p) => !p.dead);
    }

    // 発射者のものを消す（完全KOなど）
    removeOwnedBy(owner) {
      for (const p of this.list) if (p.owner === owner) p.kill('owner');
      this.list = this.list.filter((p) => !p.dead);
    }

    clear() { this.list.length = 0; }

    draw(ctx, alpha) {
      for (const p of this.list) {
        const r = RENDERERS[p.def.render];
        if (r) r(ctx, p, U.lerp(p.prevX, p.x, alpha), U.lerp(p.prevY, p.y, alpha));
      }
    }

    drawDebug(ctx, colorOf) {
      ctx.save();
      ctx.lineWidth = 2;
      ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      for (const p of this.list) {
        const r = p.rect();
        const c = colorOf(p.owner);
        ctx.fillStyle = c.hitFill;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = c.hit;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = c.hit;
        ctx.fillText(`${p.owner.hudLabel} v${Math.round(p.vx)} ${p.life.toFixed(2)}s`, p.x, r.y - 6);
      }
      ctx.restore();
    }
  }

  // ---------------- 飛び道具の描き方（Canvas の円・輪・光のみ） ----------------
  const RENDERERS = {
    bubble(ctx, p, x, y) {
      const R = p.def.radius;
      const pulse = 1 + Math.sin(p.age * 9 + p.phase) * 0.04; // ぷるぷる
      const rx = R * pulse, ry = R / pulse;
      const fade = Math.min(1, p.life / 0.2);                 // 消える直前に少し薄く
      ctx.save();
      ctx.globalAlpha = fade;
      // 淡い光
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(x, y, R * 0.4, x, y, R * 1.7);
      glow.addColorStop(0, 'rgba(140, 220, 255, 0.16)');
      glow.addColorStop(1, 'rgba(140, 220, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, R * 1.7, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      // 半透明の本体（ふちが少し濃い）
      const body = ctx.createRadialGradient(x - R * 0.2, y - R * 0.25, R * 0.1, x, y, R);
      body.addColorStop(0, 'rgba(210, 245, 255, 0.10)');
      body.addColorStop(0.75, 'rgba(150, 215, 255, 0.18)');
      body.addColorStop(1, 'rgba(190, 170, 255, 0.35)');
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      // 外周の薄い輪
      ctx.strokeStyle = 'rgba(230, 250, 255, 0.75)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      // ハイライト
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y, R * 0.68, Math.PI * 1.1, Math.PI * 1.45); ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath(); ctx.arc(x + R * 0.38, y + R * 0.34, R * 0.09, 0, Math.PI * 2); ctx.fill();
      // 後ろに続く小さな泡粒
      ctx.strokeStyle = 'rgba(200, 240, 255, 0.55)';
      ctx.lineWidth = 1.2;
      const back = -Math.sign(p.vx) || -1;
      for (let i = 1; i <= 3; i++) {
        const tx = x + back * (R + i * 11);
        const ty = y + Math.sin(p.age * 7 + i * 1.7) * 5;
        ctx.beginPath(); ctx.arc(tx, ty, 4.5 - i, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    },
  };

  // ルミポの光弾：暖色の小さな光・淡い輪・短い光の尾（泡の水色と一目で区別できる色）
  RENDERERS.lumipoOrb = function (ctx, p, x, y) {
    const R = p.def.radius;
    const fade = Math.min(1, p.life / 0.2);
    const pulse = 1 + Math.sin(p.age * 14 + p.phase) * 0.12;
    const back = -Math.sign(p.vx) || -1;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.globalCompositeOperation = 'lighter';
    // 短い光の尾
    const tail = ctx.createLinearGradient(x, y, x + back * R * 4.2, y);
    tail.addColorStop(0, 'rgba(255, 190, 120, 0.55)');
    tail.addColorStop(1, 'rgba(255, 150, 110, 0)');
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.moveTo(x, y - R * 0.7);
    ctx.lineTo(x + back * R * 4.2, y);
    ctx.lineTo(x, y + R * 0.7);
    ctx.closePath();
    ctx.fill();
    // 外側の光
    const glow = ctx.createRadialGradient(x, y, 0, x, y, R * 2.6);
    glow.addColorStop(0, 'rgba(255, 220, 160, 0.55)');
    glow.addColorStop(0.45, 'rgba(255, 150, 110, 0.22)');
    glow.addColorStop(1, 'rgba(255, 140, 110, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, R * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // 芯
    ctx.fillStyle = '#fff4dc';
    ctx.beginPath(); ctx.arc(x, y, R * 0.62 * pulse, 0, Math.PI * 2); ctx.fill();
    // 淡い輪
    ctx.strokeStyle = 'rgba(255, 196, 150, 0.8)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, R * 1.25 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  };

  KG.Projectile = Projectile;
  KG.ProjectileSystem = ProjectileSystem;
})(window.KG = window.KG || {});
