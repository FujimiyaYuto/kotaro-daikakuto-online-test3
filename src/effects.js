/*
 * effects.js — 簡易エフェクト（Canvas 描画のみ。キャラクター画像は使わない）
 * ヒットストップ中も進むよう、ゲームの通常時間で更新します。
 */
(function (KG) {
  'use strict';

  class Effects {
    constructor() { this.list = []; }

    // ヒット時の衝撃：白い閃光 + 広がる輪 + 放射状の線 + 小さな泡
    spawnHit(x, y, dir, style) {
      if (style === 'shock') { this.list.push({ type: 'shockHit', x, y, dir, t: 0, life: 0.3, seed: 0, bolts: null }); return; }
      if (style === 'bubble') return; // 泡のヒットは泡自身が弾ける演出（spawnBubblePop）で表す
      if (style === 'warm') { this.spawnWarmSpark(x, y, 1); return; } // ルミポの技（Phase 11）
      const sparks = [];
      for (let i = 0; i < 8; i++) {
        const base = (i / 8) * Math.PI * 2;
        sparks.push({ a: base + (Math.random() - 0.5) * 0.35, len: 34 + Math.random() * 26 });
      }
      const bubbles = [];
      for (let i = 0; i < 6; i++) {
        const a = (dir > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 1.8;
        const sp = 140 + Math.random() * 200;
        bubbles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, r: 3 + Math.random() * 5 });
      }
      this.list.push({ type: 'hit', x, y, dir, t: 0, life: 0.28, sparks, bubbles });
    }

    /*
     * 技データの fx から呼ばれる演出（Fighter が指定フレームにイベントを出し、Game がここへ渡す）
     *   shockCharge … クラゲ電撃の溜め：小さな電気粒子が体へ集まり、弱い電気線がちらつく
     *   shockBurst  … クラゲ電撃の放電：周囲に稲妻・光・粒子。判定が出る瞬間が最も強い
     * どちらもキャラの位置に追従します。技が被弾などで中断されたら溜めはすぐ消えます。
     */
    spawnMoveFx(ev) {
      const fx = ev.fx;
      const base = { type: fx.type, owner: ev.owner, action: ev.action, fx, t: 0, seed: 0, bolts: null };
      if (fx.type === 'shockCharge') {
        const parts = [];
        for (let i = 0; i < 14; i++) parts.push({ a: Math.random() * Math.PI * 2, r: fx.radius * (0.7 + Math.random() * 0.5), s: 1.5 + Math.random() * 2 });
        this.list.push(Object.assign(base, { life: fx.duration + 0.03, parts }));
      } else if (fx.type === 'shockBurst') {
        const sparks = [];
        for (let i = 0; i < 16; i++) {
          const a = Math.PI + Math.random() * Math.PI; // 左 → 上 → 右
          const sp = 260 + Math.random() * 320;
          sparks.push({ x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: 1.5 + Math.random() * 2 });
        }
        this.list.push(Object.assign(base, { life: fx.active + 0.2, sparks }));
      } else if (fx.type === 'warmCharge') {
        // ルミポの溜め：指定位置（体の前・頭の玉など）へ暖色の光の粒が集まる
        const parts = [];
        for (let i = 0; i < (fx.count || 10); i++) parts.push({ a: Math.random() * Math.PI * 2, r: fx.radius * (0.7 + Math.random() * 0.5), s: 1.6 + Math.random() * 1.8 });
        this.list.push(Object.assign(base, { life: fx.duration + 0.03, parts }));
      } else if (fx.type === 'warmBurst') {
        // ルミポの対空：頭の上へ短く光が弾ける（上方向の光の線と粒）
        const sparks = [];
        for (let i = 0; i < 12; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.1; // 上向き中心
          const sp = 240 + Math.random() * 260;
          sparks.push({ x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: 1.6 + Math.random() * 1.8 });
        }
        this.list.push(Object.assign(base, { life: fx.active + 0.18, sparks, dir: ev.owner.facing }));
      }
    }

    // 暖色の小さな発光（ルミポの技のヒット・光弾の発射と消滅）。k = 大きさ 0..1
    spawnWarmSpark(x, y, k) {
      const parts = [];
      const n = Math.round(5 + 5 * k);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
        const sp = (90 + Math.random() * 150) * (0.6 + 0.6 * k);
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: 1.4 + Math.random() * 1.8 });
      }
      this.list.push({ type: 'warmSpark', x, y, k, t: 0, life: 0.22 + 0.1 * k, parts });
    }

    // ガード成功：正面に水色の防御リングが一瞬光り、白い小粒が弾かれる（ヒットの黄色い火花とは別の見た目）
    spawnGuard(x, y, facing) {
      const parts = [];
      for (let i = 0; i < 7; i++) {
        const a = (facing > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 2.2;
        const sp = 120 + Math.random() * 160;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: 1.5 + Math.random() * 1.8 });
      }
      this.list.push({ type: 'guard', x, y, facing, t: 0, life: 0.26, parts });
    }

    // 泡の発射：口元から小さな泡粒がこぼれる
    spawnBubblePuff(x, y, dir) {
      const drops = [];
      for (let i = 0; i < 5; i++) {
        const a = (dir > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 1.6;
        const sp = 60 + Math.random() * 120;
        drops.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, r: 2 + Math.random() * 3 });
      }
      this.list.push({ type: 'bubbleDrops', t: 0, life: 0.35, drops });
    }

    // 泡が弾ける：輪が広がって消え、しぶきの泡粒が散る（strong = 相手に当たった時は少し大きく）
    spawnBubblePop(x, y, r, strong) {
      const drops = [];
      const n = strong ? 9 : 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const sp = (strong ? 160 : 110) + Math.random() * 90;
        drops.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, r: 2 + Math.random() * 3 });
      }
      this.list.push({ type: 'bubblePop', x, y, r, strong, t: 0, life: strong ? 0.3 : 0.24 });
      this.list.push({ type: 'bubbleDrops', t: 0, life: 0.4, drops });
    }

    // 場外になった時の合図：画面端（場外になった方向）に出る大きな輪と光の線
    spawnOut(x, y, nx, ny) {
      this.list.push({ type: 'out', x, y, nx, ny, t: 0, life: 0.6 });
    }

    update(dt) {
      for (const e of this.list) {
        // 技の演出は、技を出したキャラのヒットストップ中は止める（判定と見た目のタイミングを揃える）
        if (e.owner && e.owner.hitstop > 0 && e.type === 'shockBurst') continue;
        e.t += dt;
        // 溜め中に技が中断された（被弾・リセットなど）→ すぐ消す
        if ((e.type === 'shockCharge' || e.type === 'warmCharge') && e.owner.action !== e.action) e.life = Math.min(e.life, e.t);
        if (e.owner && e.owner.hitstop > 0 && e.type === 'warmBurst') { e.t -= dt; continue; }
        if (e.sparks && e.type === 'shockBurst') {
          for (const s of e.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 1 - 4 * dt; s.vy *= 1 - 4 * dt; }
        }
        if (e.sparks && e.type === 'warmBurst') {
          for (const q of e.sparks) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 5 * dt; q.vy *= 1 - 5 * dt; }
        }
        if (e.parts && e.type === 'warmSpark') {
          for (const q of e.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 6 * dt; q.vy *= 1 - 6 * dt; }
        }
        if (e.parts && e.type === 'guard') {
          for (const q of e.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 6 * dt; q.vy *= 1 - 6 * dt; }
        }
        if (e.drops) {
          for (const b of e.drops) { b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 1 - 4 * dt; b.vy = b.vy * (1 - 4 * dt) - 60 * dt; }
        }
        if (e.bubbles) {
          for (const b of e.bubbles) {
            b.x += b.vx * dt; b.y += b.vy * dt;
            b.vx *= 1 - 5 * dt; b.vy = b.vy * (1 - 5 * dt) - 40 * dt;
          }
        }
      }
      this.list = this.list.filter((e) => e.t < e.life);
    }

    draw(ctx) {
      for (const e of this.list) {
        if (e.type === 'out') { this.drawOut(ctx, e); continue; }
        if (e.type === 'shockCharge') { drawShockCharge(ctx, e); continue; }
        if (e.type === 'shockBurst') { drawShockBurst(ctx, e); continue; }
        if (e.type === 'shockHit') { drawShockHit(ctx, e); continue; }
        if (e.type === 'bubblePop') { drawBubblePop(ctx, e); continue; }
        if (e.type === 'guard') { drawGuard(ctx, e); continue; }
        if (e.type === 'bubbleDrops') { drawBubbleDrops(ctx, e); continue; }
        if (e.type === 'warmCharge') { drawWarmCharge(ctx, e); continue; }
        if (e.type === 'warmBurst') { drawWarmBurst(ctx, e); continue; }
        if (e.type === 'warmSpark') { drawWarmSpark(ctx, e); continue; }
        const p = e.t / e.life;           // 0 → 1
        const ease = 1 - Math.pow(1 - p, 3);
        ctx.save();
        ctx.globalAlpha = 1 - p;
        // 閃光
        if (e.t < 0.07) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
          ctx.beginPath(); ctx.arc(e.x, e.y, 26 + 60 * e.t, 0, Math.PI * 2); ctx.fill();
        }
        // 広がる輪
        ctx.strokeStyle = '#eafcff';
        ctx.lineWidth = 7 * (1 - p) + 1;
        ctx.beginPath(); ctx.arc(e.x, e.y, 18 + 58 * ease, 0, Math.PI * 2); ctx.stroke();
        // 放射状の線
        ctx.strokeStyle = '#ffe98a';
        ctx.lineWidth = 4 * (1 - p) + 1;
        ctx.lineCap = 'round';
        for (const s of e.sparks) {
          const r0 = 22 + 40 * ease, r1 = r0 + s.len * (1 - p * 0.6);
          ctx.beginPath();
          ctx.moveTo(e.x + Math.cos(s.a) * r0, e.y + Math.sin(s.a) * r0);
          ctx.lineTo(e.x + Math.cos(s.a) * r1, e.y + Math.sin(s.a) * r1);
          ctx.stroke();
        }
        // 泡
        ctx.strokeStyle = 'rgba(143, 227, 255, 0.9)';
        ctx.lineWidth = 2;
        for (const b of e.bubbles) {
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  Effects.prototype.drawOut = function (ctx, e) {
    const p = e.t / e.life;
    const ease = 1 - Math.pow(1 - p, 3);
    const inward = Math.atan2(-e.ny, -e.nx); // 画面内側へ向かう方向
    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = '#ff9f8a';
    ctx.lineWidth = 12 * (1 - p) + 2;
    ctx.beginPath(); ctx.arc(e.x, e.y, 40 + 200 * ease, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#fff4c2';
    ctx.lineCap = 'round';
    for (let i = -3; i <= 3; i++) {
      const a = inward + i * 0.22;
      const r0 = 30 + 60 * ease, r1 = r0 + 260 * (1 - p * 0.5);
      ctx.lineWidth = (i === 0 ? 14 : 7) * (1 - p) + 1;
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0);
      ctx.lineTo(e.x + Math.cos(a) * r1, e.y + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  };

  // ---------------- 電撃の描画（Canvas の線・円・粒子のみ） ----------------
  const SHOCK = {
    glow: 'rgba(110, 140, 255, 0.35)',  // 太い外側の光（青紫）
    mid: 'rgba(150, 200, 255, 0.85)',   // 中間
    core: '#f2f8ff',                    // 芯（白に近い水色）
  };

  // ギザギザの稲妻（p0 → p1）。jag = 横ぶれの大きさ
  function boltPath(x0, y0, x1, y1, segs, jag) {
    const pts = [[x0, y0]];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const off = (Math.random() - 0.5) * 2 * jag * (1 - Math.abs(t - 0.5));
      pts.push([x0 + dx * t + nx * off, y0 + dy * t + ny * off]);
    }
    pts.push([x1, y1]);
    return pts;
  }

  function strokeBolt(ctx, pts, width, alpha) {
    const pass = (style, w) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    };
    ctx.globalAlpha = alpha;
    pass(SHOCK.glow, width * 3.2);
    pass(SHOCK.mid, width * 1.6);
    pass(SHOCK.core, width * 0.7);
  }

  // 30Hz で稲妻の形を作り直す（ちらつき）
  function refresh(e, makeBolts) {
    const tick = Math.floor(e.t * 30);
    if (!e.bolts || e.seed !== tick) { e.seed = tick; e.bolts = makeBolts(); }
    return e.bolts;
  }

  function center(e) {
    const o = e.owner;
    return { x: o.x, y: o.y - e.fx.cy };
  }

  function drawShockCharge(ctx, e) {
    const p = Math.min(1, e.t / e.fx.duration);
    const c = center(e);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 集まってくる電気粒子
    for (const q of e.parts) {
      const r = q.r * (1 - p * 0.75);
      const a = q.a + p * 2.2;
      ctx.globalAlpha = 0.35 + 0.6 * p;
      ctx.fillStyle = SHOCK.mid;
      ctx.beginPath(); ctx.arc(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * 0.85, q.s, 0, Math.PI * 2); ctx.fill();
    }
    // 体のまわりの小さな電気線（溜めが進むほど増える）
    const bolts = refresh(e, () => {
      const n = 1 + Math.floor(p * 4);
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r0 = 30 + Math.random() * 20, r1 = r0 + 18 + Math.random() * 22;
        out.push(boltPath(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a + 0.5) * r1, Math.sin(a + 0.5) * r1, 4, 7));
      }
      return out;
    });
    ctx.translate(c.x, c.y); // 稲妻はキャラ中心からの相対座標で持っている
    for (const b of bolts) strokeBolt(ctx, b, 1.6, 0.4 + 0.5 * p);
    ctx.restore();
  }

  function drawShockBurst(ctx, e) {
    const act = e.fx.active;
    // 判定が出ている間はほぼ最大、その後すぐ消える
    const I = e.t < act ? 1 - 0.25 * (e.t / act) : Math.max(0, 0.75 * (1 - (e.t - act) / (e.life - act)));
    if (I <= 0) return;
    const c = center(e);
    const rx = e.fx.rx, ry = e.fx.ry;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 一瞬の発光（楕円）
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rx);
    g.addColorStop(0, `rgba(200, 225, 255, ${0.45 * I})`);
    g.addColorStop(0.55, `rgba(120, 150, 255, ${0.22 * I})`);
    g.addColorStop(1, 'rgba(120, 150, 255, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    // 攻撃範囲のふち（薄い輪）
    ctx.globalAlpha = 0.5 * I;
    ctx.strokeStyle = SHOCK.mid;
    ctx.lineWidth = 2;
    const grow = 0.9 + 0.12 * Math.min(1, e.t / act);
    ctx.beginPath(); ctx.ellipse(c.x, c.y, rx * grow, ry * grow, 0, 0, Math.PI * 2); ctx.stroke();
    // 周囲へ走る稲妻（左右と上が中心。真下にはほとんど出ない）
    const bolts = refresh(e, () => {
      const out = [];
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + (i / 8) * Math.PI + (Math.random() - 0.5) * 0.3; // 左 → 上 → 右
        const r1 = 0.75 + Math.random() * 0.3;
        out.push(boltPath(Math.cos(a) * 22, Math.sin(a) * 22, Math.cos(a) * rx * r1, Math.sin(a) * ry * r1, 6, 16));
      }
      return out;
    });
    ctx.save();
    ctx.translate(c.x, c.y);
    for (const b of bolts) strokeBolt(ctx, b, 2.2, I);
    ctx.restore();
    // 飛び散る電気粒子
    ctx.globalAlpha = I;
    ctx.fillStyle = SHOCK.core;
    for (const s of e.sparks) {
      ctx.beginPath(); ctx.arc(c.x + s.x, c.y + s.y, s.s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // 電撃がヒットした所の小さな放電
  function drawShockHit(ctx, e) {
    const p = e.t / e.life;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (e.t < 0.07) {
      ctx.fillStyle = 'rgba(220, 235, 255, 0.9)';
      ctx.beginPath(); ctx.arc(e.x, e.y, 24 + 80 * e.t, 0, Math.PI * 2); ctx.fill();
    }
    const bolts = refresh(e, () => {
      const out = [];
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 40 + Math.random() * 40;
        out.push(boltPath(e.x, e.y, e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, 5, 10));
      }
      return out;
    });
    for (const b of bolts) strokeBolt(ctx, b, 1.8, 1 - p);
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = SHOCK.mid;
    ctx.lineWidth = 5 * (1 - p) + 1;
    ctx.beginPath(); ctx.arc(e.x, e.y, 20 + 60 * (1 - Math.pow(1 - p, 3)), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // ---------------- ガードの演出 ----------------
  function drawGuard(ctx, e) {
    const p = e.t / e.life;
    const ease = 1 - Math.pow(1 - p, 2);
    const base = e.facing > 0 ? 0 : Math.PI;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1 - p;
    // 小さな円形の衝撃（白い光）
    if (e.t < 0.06) {
      ctx.fillStyle = 'rgba(210, 245, 255, 0.8)';
      ctx.beginPath(); ctx.arc(e.x, e.y, 16, 0, Math.PI * 2); ctx.fill();
    }
    // 防御リング（二重の弧）
    ctx.strokeStyle = 'rgba(140, 230, 255, 0.95)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 5 * (1 - p) + 1.5;
    const r = 22 + 26 * ease;
    ctx.beginPath(); ctx.arc(e.x, e.y, r, base - 1.2, base + 1.2); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(235, 252, 255, 0.9)';
    ctx.beginPath(); ctx.arc(e.x, e.y, r * 0.7, base - 0.9, base + 0.9); ctx.stroke();
    // 弾かれた粒
    ctx.fillStyle = '#eafcff';
    for (const q of e.parts) { ctx.beginPath(); ctx.arc(q.x, q.y, q.s, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  // ---------------- 泡の演出 ----------------
  function drawBubblePop(ctx, e) {
    const p = e.t / e.life;
    const ease = 1 - Math.pow(1 - p, 2);
    ctx.save();
    ctx.globalAlpha = 1 - p;
    if (e.strong && e.t < 0.06) {
      ctx.fillStyle = 'rgba(230, 250, 255, 0.7)';
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 1.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(225, 250, 255, 0.9)';
    ctx.lineWidth = 3 * (1 - p) + 0.8;
    ctx.setLineDash([7, 6]); // 破れた泡の輪
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 + ease * (e.strong ? 1.3 : 0.9)), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawBubbleDrops(ctx, e) {
    const p = e.t / e.life;
    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = 'rgba(210, 245, 255, 0.85)';
    ctx.lineWidth = 1.3;
    for (const b of e.drops) {
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------- ルミポの技の演出（Phase 11。暖色の光・円・線・粒のみ） ----------------
  const WARM = { core: '#fff2d8', mid: 'rgba(255, 190, 130, 0.9)', glow: 'rgba(255, 150, 110, 0.35)' };
  function warmCenter(e) {
    const o = e.owner;
    return { x: o.x + o.facing * (e.fx.front || 0), y: o.y - e.fx.cy };
  }

  function drawWarmCharge(ctx, e) {
    const p = Math.min(1, e.t / e.fx.duration);
    const c = warmCenter(e);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 集まってくる光の粒
    ctx.fillStyle = WARM.mid;
    for (const q of e.parts) {
      const r = q.r * (1 - p * 0.85);
      const a = q.a + p * 1.6;
      ctx.globalAlpha = 0.3 + 0.65 * p;
      ctx.beginPath(); ctx.arc(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, q.s, 0, Math.PI * 2); ctx.fill();
    }
    // 中心の光（溜めが進むほど強い）
    const R = 8 + 14 * p;
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R * 2);
    g.addColorStop(0, `rgba(255, 235, 200, ${0.25 + 0.55 * p})`);
    g.addColorStop(1, 'rgba(255, 160, 110, 0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(c.x, c.y, R * 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawWarmBurst(ctx, e) {
    const act = e.fx.active;
    const I = e.t < act ? 1 : Math.max(0, 1 - (e.t - act) / (e.life - act));
    if (I <= 0) return;
    const o = e.owner;
    const bx = o.x + e.dir * e.fx.front, by = o.y - e.fx.cy;
    const H = e.fx.height, W = e.fx.width;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // 上へ伸びる光の柱（縦長の楕円の光）
    const g = ctx.createRadialGradient(bx, by - H * 0.35, 0, bx, by - H * 0.35, H * 0.8);
    g.addColorStop(0, `rgba(255, 230, 190, ${0.5 * I})`);
    g.addColorStop(0.5, `rgba(255, 170, 120, ${0.22 * I})`);
    g.addColorStop(1, 'rgba(255, 150, 110, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(bx, by - H * 0.35, W * 0.6, H * 0.75, 0, 0, Math.PI * 2); ctx.fill();
    // 上向きの光の線
    ctx.lineCap = 'round';
    const grow = Math.min(1, e.t / act);
    for (let i = -2; i <= 2; i++) {
      const a = -Math.PI / 2 + i * 0.2;
      const r0 = 18, r1 = r0 + H * (0.55 + 0.45 * grow) * (i === 0 ? 1 : 0.75);
      ctx.globalAlpha = I;
      ctx.strokeStyle = WARM.glow; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(bx + Math.cos(a) * r0, by + Math.sin(a) * r0); ctx.lineTo(bx + Math.cos(a) * r1, by + Math.sin(a) * r1); ctx.stroke();
      ctx.strokeStyle = WARM.core; ctx.lineWidth = i === 0 ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(bx + Math.cos(a) * r0, by + Math.sin(a) * r0); ctx.lineTo(bx + Math.cos(a) * r1, by + Math.sin(a) * r1); ctx.stroke();
    }
    // 飛び散る粒
    ctx.fillStyle = WARM.core;
    for (const q of e.sparks) { ctx.beginPath(); ctx.arc(bx + q.x, by + q.y, q.s, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  function drawWarmSpark(ctx, e) {
    const p = e.t / e.life;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1 - p;
    if (e.t < 0.06) {
      ctx.fillStyle = 'rgba(255, 240, 210, 0.85)';
      ctx.beginPath(); ctx.arc(e.x, e.y, 10 + 18 * e.k, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = WARM.mid;
    ctx.lineWidth = 4 * (1 - p) + 1;
    ctx.beginPath(); ctx.arc(e.x, e.y, 10 + (22 + 30 * e.k) * (1 - Math.pow(1 - p, 3)), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = WARM.core;
    for (const q of e.parts) { ctx.beginPath(); ctx.arc(q.x, q.y, q.s, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  KG.Effects = Effects;
})(window.KG = window.KG || {});
