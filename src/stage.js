/*
 * stage.js — ステージ定義と描画
 * ステージはデータ（足場の矩形・出現位置・カメラ範囲・場外ライン）として定義し、
 * Stage クラスが読み込んで衝突用リストと描画を担当します。複数ステージはデータを足すだけで追加可能。
 */
(function (KG) {
  'use strict';

  KG.STAGES = {
    // Phase 1 用の仮ステージ（最終デザインではありません）
    testReef: {
      name: '仮ステージ：テストリーフ',
      platforms: [
        // メインの岩場（左端・右端から落下できる）
        { x: -760, y: 0, w: 1520, h: 380, type: 'solid' },
        // 右の小島（助走ジャンプで渡れる隙間 220）
        { x: 980, y: 40, w: 420, h: 340, type: 'solid' },
        // すり抜け足場
        { x: -480, y: -190, w: 270, h: 22, type: 'oneway' },
        { x: 210, y: -190, w: 270, h: 22, type: 'oneway' },
        { x: -135, y: -370, w: 270, h: 22, type: 'oneway' },
        { x: 1060, y: -150, w: 260, h: 22, type: 'oneway' },
      ],
      spawnPoints: [
        { x: 0, y: 0, facing: 1 },
        { x: 380, y: 0, facing: -1 },  // 2人目（CPU）
        { x: -350, y: 0, facing: 1 },  // 将来の3人目以降用
      ],
      // カメラが映してよい範囲
      cameraBounds: { left: -1500, right: 1950, top: -1050, bottom: 620 },
      // 場外ライン：この範囲の外に出たら場外（ストック -1）。カメラ範囲より外側に余白を取っている
      blastZone: { left: -1800, right: 2250, top: -1350, bottom: 950 },
      // 場外後のリスポーン位置（ステージ中央の少し上。ここから落ちて着地する）
      // [0] = 1人目（コタロ）, [1] = 2人目（CPU）
      respawnPoints: [
        { x: 0, y: -320, facing: 1 },
        { x: 170, y: -300, facing: -1 },
      ],
    },
  };

  class Stage {
    constructor(def) {
      this.def = def;
      this.name = def.name;
      this.solids = def.platforms.filter((p) => p.type === 'solid');
      this.oneways = def.platforms.filter((p) => p.type === 'oneway');
      this.spawnPoints = def.spawnPoints;
      this.cameraBounds = def.cameraBounds;
      this.blastZone = def.blastZone;
      this.respawnPoints = def.respawnPoints || def.spawnPoints;

      // 岩場の上の小さな装飾（貝・サンゴの粒）を決まった配置で生成
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      this.decor = [];
      for (const p of this.solids) {
        const n = Math.floor(p.w / 70);
        for (let i = 0; i < n; i++) {
          this.decor.push({
            x: p.x + 20 + rand() * (p.w - 40),
            y: p.y + 20 + rand() * (p.h - 60),
            r: 3 + rand() * 7,
            a: 0.08 + rand() * 0.12,
          });
        }
      }
    }

    // x の真下で、fromY 以下（下方向）maxDepth 以内にある一番近い足場の上面 y。無ければ null（CPU の穴判定用）
    surfaceBelow(x, fromY, maxDepth) {
      let best = null;
      for (const p of this.def.platforms) {
        if (x < p.x || x > p.x + p.w) continue;
        if (p.y < fromY || p.y > fromY + maxDepth) continue;
        if (best === null || p.y < best) best = p.y;
      }
      return best;
    }

    isOutOfBounds(body) {
      const b = this.blastZone;
      return body.y - body.h > b.bottom || body.y < b.top || body.x < b.left || body.x > b.right;
    }

    /*
     * 描画（Phase 9 正式化）：当たり判定の矩形はそのまま、見た目だけ海中の幻想的な足場にする
     *   地面（solid）… 深い藍色の岩の塊。上面に淡い青紫の発光する縁と、ぼんやり光る粒
     *   すり抜け足場（oneway）… 半透明のクラゲ膜。上面の明るい縁・柔らかな光・下にゆらぐ触手
     * 上面の線は当たり判定の上端（p.y）に合わせて描いている
     */
    draw(ctx, time) {
      for (const p of this.solids) this.drawSolid(ctx, p, time);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const d of this.decor) {
        const tw = 0.6 + 0.4 * Math.sin(time * 1.3 + d.x * 0.05);
        ctx.fillStyle = `rgba(160, 190, 255, ${d.a * tw})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      for (const p of this.oneways) this.drawOneway(ctx, p, time);
    }

    drawSolid(ctx, p, time) {
      const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
      g.addColorStop(0, '#2b3a86');
      g.addColorStop(0.12, '#1c2462');
      g.addColorStop(0.5, '#111748');
      g.addColorStop(1, '#070a26');
      ctx.fillStyle = g;
      roundRect(ctx, p.x, p.y, p.w, p.h, 20);
      ctx.fill();
      // 上面の柔らかな光の帯（足場の上端がはっきり分かるように）
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createLinearGradient(0, p.y - 18, 0, p.y + 14);
      glow.addColorStop(0, 'rgba(150, 170, 255, 0)');
      glow.addColorStop(0.55, 'rgba(160, 180, 255, 0.28)');
      glow.addColorStop(1, 'rgba(160, 180, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(p.x + 6, p.y - 18, p.w - 12, 32);
      ctx.restore();
      // 発光する縁（上端＝当たり判定の上面）
      const rim = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
      rim.addColorStop(0, 'rgba(170, 150, 255, 0.9)');
      rim.addColorStop(0.5, 'rgba(160, 230, 255, 0.95)');
      rim.addColorStop(1, 'rgba(190, 150, 255, 0.9)');
      ctx.strokeStyle = rim;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x + 12, p.y + 2);
      ctx.lineTo(p.x + p.w - 12, p.y + 2);
      ctx.stroke();
      // 側面の薄い縁
      ctx.strokeStyle = 'rgba(140, 150, 240, 0.25)';
      ctx.lineWidth = 2;
      roundRect(ctx, p.x + 1, p.y + 1, p.w - 2, p.h - 2, 20);
      ctx.stroke();
    }

    drawOneway(ctx, p, time) {
      const breathe = 0.5 + 0.5 * Math.sin(time * 1.4 + p.x * 0.01);
      ctx.save();
      // 柔らかな光
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createLinearGradient(0, p.y - 16, 0, p.y + p.h + 16);
      halo.addColorStop(0, 'rgba(170, 160, 255, 0)');
      halo.addColorStop(0.4, `rgba(170, 170, 255, ${0.14 + 0.06 * breathe})`);
      halo.addColorStop(1, 'rgba(170, 160, 255, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(p.x - 6, p.y - 16, p.w + 12, p.h + 32);
      ctx.restore();
      // 半透明の膜
      const body = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
      body.addColorStop(0, 'rgba(190, 175, 255, 0.42)');
      body.addColorStop(1, 'rgba(120, 190, 255, 0.16)');
      ctx.fillStyle = body;
      roundRect(ctx, p.x, p.y, p.w, p.h, 11);
      ctx.fill();
      // 上面の明るい縁（当たり判定の上面）
      ctx.strokeStyle = 'rgba(235, 240, 255, 0.95)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x + 8, p.y + 1.5);
      ctx.lineTo(p.x + p.w - 8, p.y + 1.5);
      ctx.stroke();
      // 下にゆらめく触手
      ctx.strokeStyle = 'rgba(185, 175, 255, 0.4)';
      ctx.lineWidth = 2;
      const count = Math.max(3, Math.floor(p.w / 45));
      for (let i = 0; i < count; i++) {
        const x0 = p.x + (p.w * (i + 0.5)) / count;
        const sway = Math.sin(time * 1.6 + i * 1.3) * 6;
        ctx.beginPath();
        ctx.moveTo(x0, p.y + p.h);
        ctx.quadraticCurveTo(x0 + sway, p.y + p.h + 16, x0 - sway * 0.5, p.y + p.h + 30);
        ctx.stroke();
      }
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  KG.Stage = Stage;
})(window.KG = window.KG || {});
