/*
 * background.js — 海中ステージの背景（Phase 9 正式化）
 *
 * 深い海のグラデーション（CSS）・上から差し込む淡い光・遠景の岩影・遠くを漂う抽象的なクラゲ・
 * 海中の細かな粒子（マリンスノー）・ゆっくり昇る泡・画面の縁の暗がり、を画面座標で描きます。
 * 画像素材は使わず、すべて Canvas の図形です。当たり判定はありません。
 *
 * 軽量化：
 *   ・粒子・泡・クラゲの数は固定（生成は最初の1回だけ。毎フレーム new しない）
 *   ・位置は 0..1 の正規化座標で持ち、画面サイズが変わっても作り直さない
 *   ・画面外のものは描かない
 *   ・画面いっぱいのグラデーション（海の色・縁の暗がり）は CSS の背景に任せ、キャンバスでは塗らない
 */
(function (KG) {
  'use strict';
  const U = KG.util;
  const TAU = Math.PI * 2;

  const COUNTS = { bubbles: 26, motes: 44, jellies: 6 };

  class Background {
    constructor() {
      let seed = 42;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

      this.bubbles = [];
      for (let i = 0; i < COUNTS.bubbles; i++) {
        this.bubbles.push({ x: rand(), y: rand(), r: 1.5 + rand() * 4, speed: 0.02 + rand() * 0.05, wobble: rand() * TAU, depth: 0.2 + rand() * 0.5 });
      }
      // マリンスノー：小さな光の粒が少しずつ沈む
      this.motes = [];
      for (let i = 0; i < COUNTS.motes; i++) {
        this.motes.push({ x: rand(), y: rand(), r: 0.6 + rand() * 1.4, speed: 0.004 + rand() * 0.01, drift: rand() * TAU, a: 0.2 + rand() * 0.35, depth: 0.05 + rand() * 0.25 });
      }
      // 遠景のクラゲ（抽象的な一般のクラゲ。キャラクターではない）
      const hues = ['190, 170, 255', '150, 210, 255', '230, 170, 255', '170, 235, 255'];
      this.jellies = [];
      for (let i = 0; i < COUNTS.jellies; i++) {
        this.jellies.push({
          x: (i + rand() * 0.6) / COUNTS.jellies, // 横にばらけさせる
          y: 0.18 + rand() * 0.5,
          size: 16 + rand() * 30,
          depth: 0.06 + rand() * 0.16,           // 視差（小さいほど遠い）
          phase: rand() * TAU,
          speed: 0.25 + rand() * 0.35,
          color: hues[i % hues.length],
          tent: 4 + Math.floor(rand() * 3),
        });
      }
      this.rays = [0.1, 0.3, 0.5, 0.68, 0.86].map((x, i) => ({ x, w: 0.05 + (i % 3) * 0.022, phase: i * 1.7 }));
      this.time = 0;
    }

    update(dt) {
      this.time += dt;
      for (const b of this.bubbles) {
        b.y -= b.speed * dt;
        if (b.y < -0.05) b.y += 1.1;
      }
      for (const m of this.motes) {
        m.y += m.speed * dt;
        if (m.y > 1.05) m.y -= 1.1;
      }
    }

    // 海の色のグラデーションと画面の縁の暗がりは、画面いっぱいの塗りで重いので CSS（#game-canvas の背景）で描く。
    // キャンバスは毎フレーム透明に消してから、その上に動くものだけを描く（スマホの FPS 対策）
    draw(ctx, W, H, view) {
      ctx.clearRect(0, 0, W, H);
      this.drawSoft(ctx, W, H, view);
      this.drawSharp(ctx, W, H, view);
    }

    drawSoft(ctx, W, H, view) {
      const t = this.time;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // 上から差し込む淡い光
      const rayShift = -view.cx * 0.05 * view.scale;
      for (const r of this.rays) {
        const cx = U.mod(r.x * W + rayShift, W * 1.2) - W * 0.1;
        const a = 0.06 + Math.sin(t * 0.45 + r.phase) * 0.025;
        const topW = r.w * W * 0.45, botW = r.w * W * 1.5;
        const lg = ctx.createLinearGradient(0, 0, 0, H * 0.8);
        lg.addColorStop(0, `rgba(200, 225, 255, ${a})`);
        lg.addColorStop(1, 'rgba(200, 225, 255, 0)');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(cx - topW, 0);
        ctx.lineTo(cx + topW, 0);
        ctx.lineTo(cx + botW + W * 0.07, H * 0.8);
        ctx.lineTo(cx - botW + W * 0.07, H * 0.8);
        ctx.closePath();
        ctx.fill();
      }

      // 遠景のクラゲ（ゆっくり上下しながら漂う）
      for (const j of this.jellies) this.drawJelly(ctx, j, W, H, view, t);
      ctx.restore();

      // 遠景の岩影
      this.drawRidge(ctx, W, H, view, 0.12, 0.74, 'rgba(18, 26, 78, 0.55)', 0.0021, 40);
      this.drawRidge(ctx, W, H, view, 0.22, 0.84, 'rgba(9, 12, 44, 0.72)', 0.0034, 28);
    }

    // 細かい粒（マリンスノー・泡）は画面の解像度のまま描く（数が固定で軽い）
    drawSharp(ctx, W, H, view) {
      const t = this.time;
      ctx.save();
      ctx.fillStyle = '#dfe8ff';
      for (const m of this.motes) {
        const sx = U.mod(m.x * (W + 40) - view.cx * m.depth * view.scale + Math.sin(t * 0.6 + m.drift) * 6, W + 40) - 20;
        const sy = m.y * H;
        ctx.globalAlpha = m.a;
        ctx.fillRect(sx, sy, m.r, m.r);
      }
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(225, 240, 255, 0.32)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (const b of this.bubbles) {
        const sx = U.mod(b.x * (W + 80) - view.cx * b.depth * view.scale * 0.5, W + 80) - 40;
        const sy = b.y * H;
        const wob = Math.sin(t * 1.6 + b.wobble) * 4;
        ctx.moveTo(sx + wob + b.r, sy);
        ctx.arc(sx + wob, sy, b.r, 0, TAU);
      }
      ctx.stroke(); // 泡はまとめて1回で描く
      ctx.restore();
    }

    drawJelly(ctx, j, W, H, view, t) {
      const s = j.size * Math.min(1.4, Math.max(0.6, view.scale));
      const x = U.mod(j.x * (W + 200) - view.cx * j.depth * view.scale + Math.sin(t * 0.12 * j.speed + j.phase) * 30, W + 200) - 100;
      const y = j.y * H + Math.sin(t * j.speed + j.phase) * 14 - view.cy * j.depth * view.scale * 0.3;
      if (x < -s * 3 || x > W + s * 3 || y < -s * 4 || y > H + s * 2) return; // 画面外は描かない
      const pulse = 1 + Math.sin(t * j.speed * 2.2 + j.phase) * 0.06;
      // 淡い発光
      const glow = ctx.createRadialGradient(x, y, 0, x, y, s * 2.2);
      glow.addColorStop(0, `rgba(${j.color}, 0.10)`);
      glow.addColorStop(1, `rgba(${j.color}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, s * 2.2, 0, TAU); ctx.fill();
      // 傘（半楕円）
      ctx.fillStyle = `rgba(${j.color}, 0.14)`;
      ctx.strokeStyle = `rgba(${j.color}, 0.28)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(x, y, s * pulse, s * 0.72 / pulse, 0, Math.PI, TAU);
      ctx.quadraticCurveTo(x, y + s * 0.16, x - s * pulse, y);
      ctx.fill();
      ctx.stroke();
      // 触手（細い曲線がゆらぐ）
      ctx.strokeStyle = `rgba(${j.color}, 0.2)`;
      ctx.lineWidth = 1;
      for (let i = 0; i < j.tent; i++) {
        const tx = x + (i / (j.tent - 1) - 0.5) * s * 1.4;
        const sway = Math.sin(t * 1.3 + i + j.phase) * s * 0.25;
        ctx.beginPath();
        ctx.moveTo(tx, y + 2);
        ctx.bezierCurveTo(tx + sway, y + s * 0.8, tx - sway, y + s * 1.4, tx + sway * 0.5, y + s * 2);
        ctx.stroke();
      }
    }

    drawRidge(ctx, W, H, view, parallax, baseFrac, color, freq, amp) {
      const offX = view.cx * parallax * view.scale;
      const baseY = H * baseFrac - view.cy * parallax * view.scale * 0.6;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let sx = 0; sx <= W + 20; sx += 20) {
        const wx = (sx + offX) / Math.max(0.3, view.scale);
        const y = baseY
          - Math.sin(wx * freq) * amp * view.scale * 1.4
          - Math.sin(wx * freq * 2.7 + 1.3) * amp * 0.5 * view.scale;
        ctx.lineTo(sx, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    }
  }

  KG.Background = Background;
})(window.KG = window.KG || {});
