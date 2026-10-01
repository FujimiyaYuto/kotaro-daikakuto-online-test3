/*
 * rules.js — ストック制ルール（場外・ストック・リスポーン・無敵・KO）
 *
 * status（KG.CombatStatus）を持つエンティティなら何にでも同じルールを適用します。
 * エンティティに必要なもの: x / y / w / h, status, spawnSlot（リスポーン位置の番号）, spawn(point)
 *
 *   場にいる → 場外ラインの外へ → ストック -1
 *     ├ ストックが残っている → respawnDelay 秒待つ → ステージ中央の少し上に出現
 *     │                         （蓄積ダメージ 0、invincibleTime 秒の無敵）
 *     └ ストック 0            → 'ko'（もうリスポーンしない）
 */
(function (KG) {
  'use strict';
  const U = KG.util;

  class StockRules {
    constructor(stage, hooks) {
      this.stage = stage;
      this.cfg = KG.CONFIG.rules;
      this.hooks = hooks || {}; // { onOut(entity, point), onKO(entity), onRespawn(entity) }
    }

    update(dt, entities) {
      for (const e of entities) {
        const s = e.status;
        if (!s) continue;
        if (s.lifeState === 'alive') {
          if (s.invincibleTimer > 0) s.invincibleTimer = Math.max(0, s.invincibleTimer - dt);
          if (this.stage.isOutOfBounds(e)) this.knockOut(e);
        } else if (s.lifeState === 'respawning') {
          s.respawnTimer -= dt;
          if (s.respawnTimer <= 0) this.respawn(e);
        }
      }
    }

    knockOut(e) {
      const s = e.status;
      const b = this.stage.blastZone;
      const point = { x: U.clamp(e.x, b.left, b.right), y: U.clamp(e.y - e.h / 2, b.top, b.bottom) };
      s.stocks = Math.max(0, s.stocks - 1); // Infinity は減らない
      s.invincibleTimer = 0;
      if (s.stocks > 0) {
        s.lifeState = 'respawning';
        s.respawnTimer = this.cfg.respawnDelay;
      } else {
        s.lifeState = 'ko';
      }
      if (this.hooks.onOut) this.hooks.onOut(e, point);
      if (s.lifeState === 'ko' && this.hooks.onKO) this.hooks.onKO(e);
    }

    respawn(e) {
      const pts = this.stage.respawnPoints;
      const p = pts[(e.spawnSlot || 0) % pts.length];
      e.spawn(p);
      const s = e.status;
      s.damage = 0;
      s.lastKnockback = null;
      s.lifeState = 'alive';
      s.invincibleTimer = this.cfg.invincibleTime;
      if (this.hooks.onRespawn) this.hooks.onRespawn(e);
    }

    // テスト用の完全リセット（ダメージ0・ストック初期値・KO解除・初期位置）
    resetEntity(e, point) {
      e.status.reset();
      e.spawn(point);
    }
  }

  KG.StockRules = StockRules;
})(window.KG = window.KG || {});
