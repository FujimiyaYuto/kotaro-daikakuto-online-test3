/*
 * status.js — 対戦ルール上の状態（どのキャラ・ダミーにも共通で付ける部品）
 *
 *   damage          … 蓄積ダメージ（%）
 *   stocks          … 残りストック（Infinity = 減らない）
 *   lifeState       … 'alive'（場にいる）| 'respawning'（場外後の待ち）| 'ko'（ストック切れ）
 *   invincibleTimer … 無敵の残り秒数
 *   lastKnockback   … 直近に受けた吹っ飛び（デバッグ表示用）
 *
 * ダメージの加算は Combat、場外・ストック・リスポーン・無敵は StockRules が操作します。
 * エンティティ側は `status` を持ち、spawn(point) と receiveHit(hit) を実装すればルールに参加できます。
 */
(function (KG) {
  'use strict';

  class CombatStatus {
    constructor(opts) {
      opts = opts || {};
      this.initialStocks = opts.stocks != null ? opts.stocks : KG.CONFIG.rules.stocks;
      this.reset();
    }

    reset() {
      this.damage = 0;
      this.stocks = this.initialStocks;
      this.lifeState = 'alive';
      this.respawnTimer = 0;
      this.invincibleTimer = 0;
      this.lastKnockback = null;
      this.lastHitResult = null; // 直前に受けた攻撃が 'HIT' か 'GUARD' か（デバッグ表示用）
    }

    get isAlive() { return this.lifeState === 'alive'; }
    get isInvincible() { return this.invincibleTimer > 0; }
    // 攻撃を受けられる状態か
    get canBeHit() { return this.isAlive && !this.isInvincible; }
  }

  KG.CombatStatus = CombatStatus;

  // 無敵中の点滅：描画時の不透明度（ゲーム側の表示処理のみ。画像は加工しない）
  KG.invincibleAlpha = function (status) {
    if (!status || !status.isInvincible) return 1;
    return Math.floor(status.invincibleTimer * 12) % 2 === 0 ? 0.35 : 0.9;
  };
})(window.KG = window.KG || {});
