/*
 * characters.js — キャラクター定義
 * 画像ファイルは提供されたものをそのまま読み込み、表示時に拡縮・左右反転するだけです（ファイル自体は加工しない）。
 * anchorX / anchorY は元画像（600x600）内の「足元の中心」のピクセル位置。
 * 元画像の不透明部分を計測した値で、当たり判定の下端と足元を一致させるために使います。
 */
(function (KG) {
  'use strict';

  KG.CHARACTERS = {
    kotaro: {
      id: 'kotaro',
      displayName: 'コタロ',
      sprite: {
        src: 'assets/kotaro.png',
        sourceWidth: 600,
        sourceHeight: 600,
        anchorX: 308,     // 足元の中心 x（元画像ピクセル）
        anchorY: 557,     // 靴の下端 y（元画像ピクセル）
        scale: 0.3,       // 表示倍率（600px → 180 ワールド単位）
        nativeFacing: -1, // 元画像が向いている方向（-1 = 左）。右向き時に反転表示
      },
      // 地形との当たり判定（体の芯＝頭〜足。両手の大きな拳は含めない）
      body: { width: 64, height: 110 },
      // 攻撃を受ける領域（地形用の body とは別管理）。右向き基準・足元からの相対位置
      hurtboxes: [
        { x: -38, y: -118, w: 76, h: 118 },
      ],
      // 状況 → 技ID。将来は groundNeutral / airNeutral を別の技にしたり、
      // 'groundSide' 'airUp' などの枠を足して技を増やす
      moveset: {
        groundNeutral: 'poyonAttack',
        airNeutral: 'poyonAttack',
        groundSpecial: 'jellyShock',   // Phase 5: 必殺技①（地上・空中で同じ技。将来は別技にできる）
        airSpecial: 'jellyShock',
        groundShoot: 'bubbleShot',     // Phase 6: 飛び道具（地上・空中で同じ技）
        airShoot: 'bubbleShot',
      },
      // KG.DEFAULT_MOVEMENT の上書き（Phase 1 は既定値のまま）
      movement: {},
    },

    // CPU の対戦相手「ルミポ」（Phase 9 の仮キャラ）。画像は使わず Canvas の図形で描く、海中の不思議な生き物
    testBot: {
      id: 'testBot',
      displayName: 'ルミポ',
      render: 'critter',
      critter: {
        body: ['#ffd2bd', '#ff9a86', '#e2697a'],   // 上 → 中 → 下のグラデーション（暖色で背景の青と区別）
        windup: ['#fff1c9', '#ffc27a', '#f08a5c'], // 攻撃の出始め（予備動作）の色
        line: '#6b2440',
        glow: '255, 170, 140',                      // まわりの淡い光
        lure: '#a9fff0',                            // 頭の上の光る玉
        chargeLure: '#ffd9a0',                      // 技の溜め中の玉の色（Phase 11）
      },
      body: { width: 70, height: 120 },
      hurtboxes: [
        { x: -35, y: -120, w: 70, h: 120 },
      ],
      // Phase 11：4種類の攻撃（至近距離の通常攻撃・中距離の突進・遠距離の光弾・上への対空）。新しい技は地上のみ
      //   通常攻撃ボタン＝cpuJab、上＋通常攻撃＝対空、必殺ボタン＝突進、飛び道具ボタン＝光弾（入力の形はプレイヤーと同じ）
      moveset: {
        groundNeutral: 'cpuJab',
        airNeutral: 'cpuJab',
        groundUpNeutral: 'lumipoAntiAir',
        groundSpecial: 'lumipoDashAttack',
        groundShoot: 'lumipoLightShot',
      },
      // コタロより少し遅く（テストしやすく）
      movement: {
        groundSpeed: 340,
        airSpeed: 340,
      },
    },
  };
})(window.KG = window.KG || {});
