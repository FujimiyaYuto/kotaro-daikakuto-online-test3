/*
 * moves.js — 技データ
 *
 * 技は「データ」として定義し、Fighter が汎用的に再生します。新しい技はここに1件足し、
 * キャラクター定義の moveset から参照するだけで追加できます。
 *
 * フレームは 60fps 固定ステップ基準（1フレーム ≒ 16.7ms）。frame は技開始から 1, 2, 3 … と数えます。
 *
 *  totalFrames     … 技の全体フレーム。これを過ぎると通常状態へ戻る
 *  jumpCancelFrom  … このフレーム以降はジャンプで技を中断できる（後隙の一部をジャンプで抜けられる）
 *  hitboxes[]      … 攻撃判定。facing 右向き基準で、x は体の中心から前方向、y は足元から（上が負）
 *      start / end … 判定が出ているフレーム（両端を含む）
 *      damage      … 与える蓄積ダメージ（%）
 *      knockback   … 基本ノックバック速度 { x: 前方向, y: 上方向は負 }。相手の蓄積ダメージに応じて増える（combat.js）
 *      hitstop     … ヒット時に攻撃側・受け側が止まるフレーム数
 *      knockbackDirection … 'facing'（省略時。攻撃側の向き）| 'away'（攻撃側から相手へ向かう方向＝離れる方向）
 *      hitEffect   … ヒット時のエフェクトの種類（省略時は通常。'shock' = 電撃）
 *  motion          … 技中の移動（impulseFrame を省略すると前進しない）
 *  visual          … Sprite 全体の変形キー（sx/sy 拡縮, ox 前方向オフセット, rot 前傾ラジアン）。画像自体は加工しない
 *  cooldown        … 技が終わってから再び使えるまでの秒数（省略時は無し）
 *  glow            … キャラの後ろに描く発光 { color, radius, keys: [{ f, a }] }（ゲーム側の描画。画像は加工しない）
 *  fx[]            … 指定フレームに出す演出 { frame, type, ... }（effects.js の spawnMoveFx が描く）
 *  spawns[]        … 指定フレームに飛び道具を出す { frame, projectile: 種類ID, x: 前方向, y: 足元から }（projectile.js）
 *  stopOnContact   … ヒット / ガードされた瞬間に横の速度をこの割合に落とす（突進技がすり抜けないように）
 *  critterCue      … 図形で描くキャラの予兆表現の種類（fighter.js の drawCritter）
 */
(function (KG) {
  'use strict';

  KG.MOVES = {
    poyonAttack: {
      id: 'poyonAttack',
      name: 'ぽよんアタック',
      totalFrames: 18,        // 約0.30秒で次の行動へ
      jumpCancelFrom: 11,     // 判定終了後、少し経てばジャンプで抜けられる
      hitboxes: [
        {
          start: 4, end: 7,   // 出始め 4F 目〜7F 目（約67ms）の間だけ有効
          x: 14, y: -104, w: 84, h: 80,
          damage: 10,         // 与える蓄積ダメージ（%）
          knockback: { x: 720, y: -700 }, // 基本ノックバック（相手のダメージ0%時の速度）
          // knockbackGrowth: 0.012,   // 省略時は KG.CONFIG.combat.knockbackGrowth
          hitstop: 5,         // 約83ms
        },
      ],
      motion: {
        impulseFrame: 3,      // このフレームで前方へ勢いをつける
        groundImpulse: 260,   // 地上：前方向へ加える速度
        groundMaxSpeed: 560,  // 地上：勢いを足した後の上限
        groundFriction: 1900, // 地上：技中は入力を受けず、この減速で滑る
        airImpulse: 140,      // 空中：前方向へ加える速度
        airMaxSpeed: 460,
        airControl: 1.0,      // 空中：通常の左右操作をどれだけ残すか（1 = そのまま）
      },
      visual: [
        { f: 0,  sx: 1.00, sy: 1.00, ox: 0,  rot: 0 },
        { f: 3,  sx: 0.93, sy: 1.07, ox: -6, rot: -0.03 }, // きゅっと縮む（溜め）
        { f: 5,  sx: 1.12, sy: 0.91, ox: 22, rot: 0.07 },  // ぽよんと前へ弾む
        { f: 9,  sx: 0.95, sy: 1.05, ox: 14, rot: 0.02 },  // 反動でぷるん
        { f: 13, sx: 1.03, sy: 0.98, ox: 5,  rot: 0 },
        { f: 18, sx: 1.00, sy: 1.00, ox: 0,  rot: 0 },
      ],
    },
  };

  // テスト用 CPU の仮攻撃（正式な技ではない）。ぽよんアタックより出が遅く、少し弱い
  KG.MOVES.cpuJab = {
    id: 'cpuJab',
    name: 'CPU仮攻撃',
    totalFrames: 28,        // 約0.47秒
    jumpCancelFrom: 20,
    hitboxes: [
      {
        start: 8, end: 11,    // 予備動作 7F（約117ms）の後、4F だけ判定
        x: 18, y: -100, w: 70, h: 70,
        damage: 8,
        knockback: { x: 620, y: -600 },
        hitstop: 5,
      },
    ],
    motion: {
      impulseFrame: 7,
      groundImpulse: 220,
      groundMaxSpeed: 420,
      groundFriction: 1900,
      airImpulse: 100,
      airMaxSpeed: 380,
      airControl: 1.0,
    },
    visual: [
      { f: 0,  sx: 1.00, sy: 1.00, ox: 0,  rot: 0 },
      { f: 7,  sx: 0.95, sy: 1.04, ox: -8, rot: -0.06 }, // 少し引いて溜める
      { f: 9,  sx: 1.06, sy: 0.96, ox: 18, rot: 0.08 },  // 前へ突き出す
      { f: 16, sx: 1.00, sy: 1.00, ox: 8,  rot: 0.02 },
      { f: 28, sx: 1.00, sy: 1.00, ox: 0,  rot: 0 },
    ],
  };

  /*
   * クラゲ電撃（コタロ専用の必殺技①）
   * ぽよんアタックより出は遅いが、その場で周囲（左右と上）に電撃を出す。
   * 攻撃判定は2つの矩形を重ねた楕円に近い形。1回の使用で同じ相手には1回だけヒット（hitVictims）。
   */
  KG.MOVES.jellyShock = {
    id: 'jellyShock',
    name: 'クラゲ電撃',
    totalFrames: 34,        // 約0.57秒（startup 9F / active 5F / recovery 20F）
    jumpCancelFrom: 24,
    cooldown: 0.7,          // 技が終わってから 0.7 秒は再使用できない
    hitboxes: [
      // 横に広い帯（左右）
      {
        start: 10, end: 14,
        x: -125, y: -122, w: 250, h: 92,
        damage: 13,
        knockback: { x: 560, y: -820 },   // ぽよんより横は弱く、上へ高く飛ぶ
        knockbackDirection: 'away',       // コタロから離れる方向へ
        hitstop: 7,
        hitEffect: 'shock',
      },
      // 縦に高い帯（上）
      {
        start: 10, end: 14,
        x: -88, y: -182, w: 176, h: 170,
        damage: 13,
        knockback: { x: 560, y: -820 },
        knockbackDirection: 'away',
        hitstop: 7,
        hitEffect: 'shock',
      },
    ],
    motion: {
      // 前進しない（impulseFrame 無し）。地上ではその場で止まり、空中では慣性と重力を残す
      groundFriction: 2600,
      airControl: 0.5,
    },
    visual: [
      { f: 0,  sx: 1.00, sy: 1.00, ox: 0, rot: 0 },
      { f: 8,  sx: 1.06, sy: 0.94, ox: 0, rot: 0 },    // きゅっと縮んで溜める
      { f: 10, sx: 0.95, sy: 1.07, ox: 0, rot: 0 },    // 放電の瞬間にふわっと伸びる
      { f: 16, sx: 1.03, sy: 0.98, ox: 0, rot: 0 },
      { f: 34, sx: 1.00, sy: 1.00, ox: 0, rot: 0 },
    ],
    glow: {
      color: '120, 170, 255',
      radius: 150,
      cy: 0.55,                               // 体の高さに対する中心位置（下から）
      keys: [{ f: 0, a: 0 }, { f: 9, a: 0.35 }, { f: 10, a: 0.85 }, { f: 15, a: 0.5 }, { f: 26, a: 0 }],
    },
    fx: [
      { frame: 1, type: 'shockCharge', duration: 9 / 60, cy: 70, radius: 110 },       // 溜め：電気粒子が集まる
      { frame: 10, type: 'shockBurst', active: 5 / 60, cy: 72, rx: 130, ry: 118 },   // 判定が出る瞬間に最大
    ],
  };

  /*
   * バブルショット（コタロの遠距離牽制）
   * 短い溜めの後、前方へ泡（Projectile 'bubble'）を1つ撃つ。泡の性能は projectile.js の KG.PROJECTILES.bubble。
   * 自分の泡が場に2つある間は撃てない（maxPerOwner）。技の後に短い再使用待ちあり。
   */
  KG.MOVES.bubbleShot = {
    id: 'bubbleShot',
    name: 'バブルショット',
    totalFrames: 22,        // 約0.37秒（startup 7F / 発射 8F目 / recovery 14F）
    jumpCancelFrom: 14,
    cooldown: 0.3,          // 技が終わってから 0.3 秒は撃てない
    hitboxes: [],           // 体の攻撃判定は無し（泡そのものが攻撃判定を持つ）
    spawns: [
      { frame: 8, projectile: 'bubble', x: 62, y: -72 },
    ],
    motion: {
      groundFriction: 2600, // 地上ではその場で撃つ
      airControl: 0.7,      // 空中では慣性と重力を残す
    },
    visual: [
      { f: 0,  sx: 1.00, sy: 1.00, ox: 0,  rot: 0 },
      { f: 6,  sx: 0.96, sy: 1.04, ox: -4, rot: -0.03 }, // ふっと息を吸う
      { f: 8,  sx: 1.05, sy: 0.96, ox: 6,  rot: 0.03 },  // ぷっと吐き出す
      { f: 14, sx: 1.00, sy: 1.00, ox: 2,  rot: 0 },
      { f: 22, sx: 1.00, sy: 1.00, ox: 0,  rot: 0 },
    ],
  };

  /*
   * ===== ルミポの技（Phase 11）=====
   * cpuJab（至近距離の基本攻撃）に加えて、距離と高さで役割の違う3つの技。
   * どれも「見てから対応できる予兆（溜め）」を持ち、出し切るまでキャンセルできない（jumpCancelFrom = totalFrames）。
   * 予兆は Canvas の描画だけ（体の伸縮・頭の光・粒子）。難易度で技の性能・予兆は変わらない。
   */

  // 突進（中距離）：溜め 16F → 前方へ滑るように突進（判定 17〜30F）→ 後隙。ガード可能。
  // 当たった / ガードされた瞬間に勢いが落ちる（stopOnContact）ので、相手をすり抜けず、ガード後は反撃を受けやすい
  KG.MOVES.lumipoDashAttack = {
    id: 'lumipoDashAttack',
    name: 'ルミポ突進',
    totalFrames: 54,        // 約0.9秒（startup 16F / active 14F / recovery 24F）
    jumpCancelFrom: 54,     // 後隙はジャンプで消せない
    stopOnContact: 0.25,    // ヒット・ガード時に横の速度をこの割合に落とす
    hitboxes: [
      {
        start: 17, end: 30,
        x: 8, y: -100, w: 74, h: 84,
        damage: 11,
        knockback: { x: 760, y: -560 },
        hitstop: 6,
        hitEffect: 'warm',
      },
    ],
    motion: {
      impulseFrame: 17,
      groundImpulse: 900,   // 突進の初速（地上）。滑って止まるまで約 330
      groundMaxSpeed: 900,
      groundFriction: 1200,
      airImpulse: 0,
      airMaxSpeed: 0,
      airControl: 0.3,
    },
    visual: [
      { f: 0,  sx: 1.00, sy: 1.00, ox: 0,   rot: 0 },
      { f: 12, sx: 1.14, sy: 0.86, ox: -12, rot: -0.08 }, // ぎゅっと縮んで後ろへ引く（予兆）
      { f: 16, sx: 1.16, sy: 0.84, ox: -14, rot: -0.1 },
      { f: 18, sx: 0.88, sy: 1.08, ox: 16,  rot: 0.18 },  // 前へ伸びて突っ込む
      { f: 30, sx: 0.92, sy: 1.05, ox: 10,  rot: 0.12 },
      { f: 40, sx: 1.05, sy: 0.96, ox: 2,   rot: -0.03 }, // ブレーキ
      { f: 54, sx: 1.00, sy: 1.00, ox: 0,   rot: 0 },
    ],
    glow: {
      color: '255, 170, 120',
      radius: 120,
      cy: 0.5,
      keys: [{ f: 0, a: 0 }, { f: 14, a: 0.55 }, { f: 17, a: 0.8 }, { f: 30, a: 0.4 }, { f: 40, a: 0 }],
    },
    fx: [
      { frame: 1, type: 'warmCharge', duration: 16 / 60, front: 70, cy: 55, radius: 70, count: 12 }, // 進行方向の前に光が集まる
    ],
    critterCue: 'dash',
  };

  // 光弾（遠距離）：頭の光る玉が 20F かけて明るくなってから、小さな光弾（Projectile 'lumipoOrb'）を1発。
  // 同時に1発まで・技の後に再使用待ち（連射できない）
  KG.MOVES.lumipoLightShot = {
    id: 'lumipoLightShot',
    name: 'ルミポ光弾',
    totalFrames: 44,        // 約0.73秒（startup 20F / 発射 21F目 / recovery 23F）
    jumpCancelFrom: 44,
    cooldown: 1.2,          // 技としての最低限の再使用待ち（AI 側の間隔は別に難易度で決める）
    hitboxes: [],
    spawns: [
      { frame: 21, projectile: 'lumipoOrb', x: 16, y: -124 }, // 頭の光る玉の位置から
    ],
    motion: {
      groundFriction: 2600,
      airControl: 0.6,
    },
    visual: [
      { f: 0,  sx: 1.00, sy: 1.00, ox: 0,  rot: 0 },
      { f: 18, sx: 0.95, sy: 1.06, ox: -4, rot: -0.05 }, // 伸び上がって玉を掲げる
      { f: 21, sx: 1.06, sy: 0.95, ox: 6,  rot: 0.06 },  // 放つ
      { f: 30, sx: 1.00, sy: 1.00, ox: 2,  rot: 0 },
      { f: 44, sx: 1.00, sy: 1.00, ox: 0,  rot: 0 },
    ],
    fx: [
      { frame: 1, type: 'warmCharge', duration: 20 / 60, front: 16, cy: 124, radius: 46, count: 10 }, // 玉のまわりに光が集まる
    ],
    critterCue: 'shot',
  };

  // 対空（上＋少し前）：溜め 9F → 頭の上へ短く光が弾ける（判定 10〜15F）→ 後隙。
  // 判定は上方向だけ（地上に立っている相手・背後・遠くには当たらない）
  KG.MOVES.lumipoAntiAir = {
    id: 'lumipoAntiAir',
    name: 'ルミポ対空',
    totalFrames: 36,        // 約0.6秒（startup 9F / active 6F / recovery 21F）
    jumpCancelFrom: 36,
    hitboxes: [
      {
        start: 10, end: 15,
        x: -10, y: -250, w: 84, h: 125,  // 体の中心の少し後ろ(10)〜前方 74、高さ 125〜250（頭より上だけ。背後・地上の相手には届かない）
        damage: 10,
        knockback: { x: 260, y: -900 },  // 上へ打ち上げる
        hitstop: 6,
        hitEffect: 'warm',
      },
    ],
    motion: {
      groundFriction: 2600,
      airControl: 0.5,
    },
    visual: [
      { f: 0,  sx: 1.00, sy: 1.00, ox: 0,  rot: 0 },
      { f: 8,  sx: 1.12, sy: 0.88, ox: -2, rot: -0.04 }, // しゃがんで溜める
      { f: 10, sx: 0.88, sy: 1.14, ox: 4,  rot: 0.05 },  // 上へ伸び上がる
      { f: 18, sx: 0.96, sy: 1.04, ox: 2,  rot: 0.02 },
      { f: 36, sx: 1.00, sy: 1.00, ox: 0,  rot: 0 },
    ],
    glow: {
      color: '255, 200, 140',
      radius: 110,
      cy: 0.95,
      keys: [{ f: 0, a: 0 }, { f: 8, a: 0.45 }, { f: 10, a: 0.9 }, { f: 16, a: 0.4 }, { f: 24, a: 0 }],
    },
    fx: [
      { frame: 1, type: 'warmCharge', duration: 9 / 60, front: 8, cy: 150, radius: 50, count: 8 },
      { frame: 10, type: 'warmBurst', active: 6 / 60, front: 24, cy: 130, height: 130, width: 90 },
    ],
    critterCue: 'antiAir',
  };

  // 技の glow キーを補間して、足元原点の座標系に円形の光を描く
  KG.drawMoveGlow = function (ctx, move, frame, bodyH) {
    const g = move.glow;
    const keys = g.keys;
    let a = 0;
    if (frame <= keys[0].f) a = keys[0].a;
    else if (frame >= keys[keys.length - 1].f) a = keys[keys.length - 1].a;
    else {
      for (let i = 1; i < keys.length; i++) {
        if (frame <= keys[i].f) {
          const k0 = keys[i - 1], k1 = keys[i];
          a = k0.a + (k1.a - k0.a) * ((frame - k0.f) / (k1.f - k0.f));
          break;
        }
      }
    }
    if (a <= 0.01) return;
    const cy = -bodyH * g.cy;
    const r = g.radius * (0.8 + 0.2 * a);
    const grad = ctx.createRadialGradient(0, cy, 0, 0, cy, r);
    grad.addColorStop(0, `rgba(${g.color}, ${0.55 * a})`);
    grad.addColorStop(0.5, `rgba(${g.color}, ${0.22 * a})`);
    grad.addColorStop(1, `rgba(${g.color}, 0)`);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };

  // 技の visual キーを frame（小数可）で補間
  KG.sampleMoveVisual = function (move, frame) {
    const keys = move.visual;
    if (!keys || keys.length === 0) return null;
    if (frame <= keys[0].f) return keys[0];
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1], b = keys[i];
      if (frame <= b.f) {
        const t = (frame - a.f) / (b.f - a.f);
        const e = t * t * (3 - 2 * t); // smoothstep
        return {
          sx: a.sx + (b.sx - a.sx) * e,
          sy: a.sy + (b.sy - a.sy) * e,
          ox: a.ox + (b.ox - a.ox) * e,
          rot: a.rot + (b.rot - a.rot) * e,
        };
      }
    }
    return keys[keys.length - 1];
  };
})(window.KG = window.KG || {});
