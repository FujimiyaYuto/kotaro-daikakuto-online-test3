/*
 * audio.js — BGM と効果音（Phase 13）
 *
 * ・効果音はすべて Web Audio API で合成する短い音（外部の音源ファイルは使わない）
 * ・BGM は KG.CONFIG.audio.bgmFiles にファイルを指定すればそれを流す。未指定・読み込み失敗の時は、
 *   ゲーム内で合成するオリジナルの仮BGM（synthFallback）を流す（false なら無音）。ゲームは止まらない
 * ・ブラウザの自動再生制限に合わせ、最初のタップ／クリック／キー入力で音を有効にする（それまでは何も鳴らさない）
 * ・ページが見えなくなったら音を止め、戻ったら今の画面に合った BGM に戻す
 *
 * 戦闘の処理には手を入れない。既存の関数（技の開始・被弾・ガード・飛び道具の発射/消滅・場外）を外から包んで、
 * その時に音を鳴らすだけ（元の処理はそのまま呼ぶ）。乱数も Math.random は使わない（戦闘の乱数に影響しない）。
 */
(function (KG) {
  'use strict';

  // 音専用の乱数（Math.random を消費しない）
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const N = (name) => 440 * Math.pow(2, (NOTE_INDEX[name.replace(/\d/, '')] + (parseInt(name.match(/\d/)[0], 10) - 4) * 12 - 9) / 12);
  const NOTE_INDEX = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

  // 同じ効果音の最短間隔（秒）：短時間に大量に重なって大きな音にならないように
  const MIN_INTERVAL = { hit: 0.05, hitLight: 0.05, hitZap: 0.05, guard: 0.06, bubblePop: 0.04, orbVanish: 0.05, bubbleFire: 0.04, orbFire: 0.05, select: 0.03 };
  const PRIORITY = { ko: 1, jingleWin: 1, jingleLose: 1, confirm: 1, back: 1, select: 1, count: 1, start: 1 };

  // ---------------------------------------------------------------------------
  // 効果音の定義（t = 鳴らし始める時刻）。どれも 0.05〜0.5 秒の短い音
  // ---------------------------------------------------------------------------
  const SFX = {
    // UI
    select(a, t) { a.tone('sine', 700, 1050, t, 0.07, 0.22); a.tone('sine', 1400, 1500, t + 0.02, 0.04, 0.05); },                       // 小さな泡のような「ぷつ」
    confirm(a, t) { a.tone('triangle', 660, 680, t, 0.09, 0.26); a.tone('triangle', 990, 1000, t + 0.07, 0.16, 0.26); a.tone('sine', 1980, 2000, t + 0.08, 0.12, 0.05); },
    back(a, t) { a.tone('triangle', 760, 520, t, 0.09, 0.24); a.tone('triangle', 520, 380, t + 0.07, 0.1, 0.18); },                       // 短く下がる
    // カウントダウン
    count(a, t) { a.tone('sine', 600, 640, t, 0.13, 0.32); a.tone('sine', 1200, 1600, t, 0.035, 0.07); },
    start(a, t) {
      a.tone('triangle', N('G5'), N('G5'), t, 0.14, 0.2);
      a.tone('triangle', N('B5'), N('B5'), t + 0.05, 0.16, 0.2);
      a.tone('triangle', N('E6'), N('E6'), t + 0.1, 0.32, 0.22);
      a.tone('sine', N('E6') * 2, N('E6') * 2.1, t + 0.1, 0.2, 0.04);
    },
    // コタロ：ぽよんアタック（柔らかいスイング「ぽよっ」）
    poyonSwing(a, t) { a.noise(t, 0.12, 0.3, 'bandpass', 900, 500, 0.8); a.tone('sine', 260, 430, t, 0.09, 0.26); },
    // コタロ：クラゲ電撃（短いチャージ → 判定の瞬間に「バチッ」）
    shockCharge(a, t) { a.tone('sawtooth', 180, 700, t, 0.15, 0.16, { lowpass: 1600 }); a.tone('square', 2200, 2600, t + 0.05, 0.08, 0.02); },
    shockZap(a, t) { a.noise(t, 0.06, 0.28, 'highpass', 2500, 2500, 0.7); a.tone('square', 90, 60, t, 0.05, 0.1); a.tone('square', 1800, 900, t + 0.005, 0.045, 0.04); },
    // コタロ：バブルショット
    bubbleFire(a, t) { a.tone('sine', 280, 720, t, 0.07, 0.28); a.tone('sine', 900, 1300, t + 0.03, 0.04, 0.05); },                       // 「ぷくっ」
    bubblePop(a, t) { a.tone('sine', 1300, 700, t, 0.045, 0.16); a.noise(t, 0.02, 0.06, 'highpass', 3000, 3000, 0.7); },                 // 小さく弾ける
    // ガード成功：柔らかく透明感のある防御音（鈴のような短い響き）
    guard(a, t) {
      a.tone('sine', 1046, 1046, t, 0.24, 0.17, { decay: true });
      a.tone('sine', 1568, 1568, t + 0.01, 0.17, 0.08, { decay: true });
      a.tone('triangle', 523, 523, t, 0.1, 0.1, { decay: true });
      a.noise(t, 0.03, 0.04, 'bandpass', 4000, 4000, 1.2);
    },
    // ルミポ：通常攻撃（体当たり：空気／水を切る音＋軽い打撃）
    jabSwing(a, t) { a.noise(t, 0.08, 0.32, 'bandpass', 1600, 2400, 1.5); a.tone('sine', 330, 250, t, 0.06, 0.14); },
    // ルミポ：突進（予兆のチャージ → 「シュッ」）
    dashCharge(a, t) { a.tone('triangle', 300, 620, t, 0.26, 0.24); a.tone('sine', 600, 1240, t, 0.26, 0.07); },
    dashGo(a, t) { a.noise(t, 0.16, 0.5, 'bandpass', 1000, 3400, 1.0); a.tone('sine', 240, 160, t, 0.08, 0.1); },
    // ルミポ：光弾（暖かく上がる溜め → 軽い発射 → 短く光って消える）
    orbCharge(a, t) { a.tone('sine', 420, 980, t, 0.34, 0.2); a.tone('triangle', 210, 490, t, 0.34, 0.1); },
    orbFire(a, t) { a.tone('triangle', 950, 520, t, 0.08, 0.18); a.tone('sine', 1900, 1300, t, 0.05, 0.04); },
    orbVanish(a, t) { a.tone('sine', 900, 1500, t, 0.06, 0.17); a.noise(t, 0.03, 0.07, 'bandpass', 3500, 3500, 1); },
    // ルミポ：対空（ごく短い溜め → 上へ弾ける。高音は低域通過で丸める）
    aaCharge(a, t) { a.tone('triangle', 520, 820, t, 0.08, 0.22); },
    aaBurst(a, t) { a.tone('triangle', 600, 1500, t, 0.12, 0.18, { lowpass: 3200 }); a.noise(t, 0.08, 0.1, 'bandpass', 2500, 4000, 1); },
    // 共通のヒット音。s = 技の強さ 0..1、heavy = 大きく吹っ飛ぶほど 0..1（少し低く強く）
    hit(a, t, o) {
      const s = clamp(o.s != null ? o.s : 0.6, 0, 1), h = clamp(o.heavy || 0, 0, 1);
      a.tone('sine', 160 - 45 * h, 70 - 25 * h, t, 0.1 + 0.07 * h, 0.4 + 0.18 * s + 0.12 * h);
      a.noise(t, 0.05 + 0.03 * h, 0.2 + 0.14 * s, 'bandpass', 1800 - 600 * h, 900 - 300 * h, 0.9);
      a.tone('triangle', 900, 300, t, 0.03, 0.08);
    },
    hitLight(a, t) { a.tone('sine', 420, 220, t, 0.06, 0.2); a.noise(t, 0.03, 0.08, 'bandpass', 2500, 2000, 1); },           // 泡の命中（軽い）
    hitZap(a, t) { a.noise(t, 0.07, 0.13, 'highpass', 3000, 3000, 0.7); a.tone('square', 2200, 1100, t, 0.05, 0.035); },      // 電撃の命中に重ねる
    // 場外KO：低い「ドゥン」＋流れる音＋小さな泡のきらめき（ストックを失ったと分かる）
    ko(a, t) {
      a.tone('sine', 220, 50, t, 0.55, 0.5);
      a.noise(t, 0.5, 0.3, 'lowpass', 2200, 300, 0.7);
      a.tone('triangle', 880, 200, t, 0.38, 0.13);
      for (let i = 0; i < 3; i++) a.tone('sine', 1200 + i * 260, 1700 + i * 260, t + 0.18 + i * 0.07, 0.05, 0.05);
    },
    // 勝敗ジングル（短く明るい。コタロの勝ちとルミポの勝ちで和音を変える）
    jingleWin(a, t) { jingle(a, t, ['D5', 'F#5', 'A5', 'D6'], ['A5', 'F#5']); },
    jingleLose(a, t) { jingle(a, t, ['A4', 'C#5', 'E5', 'A5'], ['E5', 'C#5']); },
  };
  function jingle(a, t, notes, tail) {
    notes.forEach((n, i) => {
      a.tone('triangle', N(n), N(n), t + i * 0.11, i === notes.length - 1 ? 0.6 : 0.16, 0.2, { decay: true });
      a.tone('sine', N(n) * 2, N(n) * 2, t + i * 0.11, 0.12, 0.04, { decay: true });
    });
    tail.forEach((n) => a.tone('sine', N(n), N(n), t + notes.length * 0.11 - 0.11, 0.6, 0.08, { decay: true }));
  }

  // 技ごとの音（start = 技を出した瞬間、frames = その技のフレーム番号で鳴らす音）
  const MOVE_SOUNDS = {
    poyonAttack: { start: 'poyonSwing' },
    jellyShock: { start: 'shockCharge', frames: { 10: 'shockZap' } },
    cpuJab: { frames: { 7: 'jabSwing' } },
    lumipoDashAttack: { start: 'dashCharge', frames: { 17: 'dashGo' } },
    lumipoLightShot: { start: 'orbCharge' },
    lumipoAntiAir: { start: 'aaCharge', frames: { 10: 'aaBurst' } },
  };
  // 命中した技の強さ（共通ヒット音の強さ）
  const HIT_STRENGTH = { poyonAttack: 0.7, jellyShock: 0.8, cpuJab: 0.6, lumipoDashAttack: 1.0, lumipoAntiAir: 0.85, lumipoOrb: 0.5 };

  // ---------------------------------------------------------------------------
  // 仮BGM（ゲーム内で合成するオリジナルの短いループ）。正式なBGMファイルを置けば自動で使われなくなる
  // ---------------------------------------------------------------------------
  // 1小節 = 8ステップ（8分音符）。chords は小節ごとの和音、lead は 8分音符ごとの音（'-' 休み、'~' 伸ばす）
  const SONGS = {
    // タイトル：海中・透明感・少し幻想的で落ち着いた曲（ゆっくり、パッド＋鈴のアルペジオ）
    title: {
      bpm: 76,
      chords: [
        ['D3', 'F#4', 'A4', 'C#5'], ['B2', 'D4', 'F#4', 'A4'], ['G2', 'B3', 'D4', 'F#4'], ['A2', 'C#4', 'E4', 'A4'],
        ['E3', 'G4', 'B4', 'D5'], ['F#2', 'A3', 'C#4', 'E4'], ['G2', 'B3', 'D4', 'F#4'], ['A2', 'D4', 'E4', 'A4'],
      ],
      arp: [1, 2, 3, 2, 1, 3, 2, -1],   // 和音の何番目の音を鳴らすか（-1 = 休み）。1オクターブ上で鳴らす
    },
    // 対戦：明るく軽快・少しコミカル（ベース＋はじく音のメロディ＋軽い打楽器）
    battle: {
      bpm: 138,
      chords: [
        ['F2', 'A3', 'C4', 'F4'], ['D2', 'F3', 'A3', 'D4'], ['A#1', 'D3', 'F3', 'A#3'], ['C2', 'E3', 'G3', 'C4'],
        ['F2', 'A3', 'C4', 'F4'], ['A1', 'C3', 'E3', 'A3'], ['A#1', 'D3', 'F3', 'A#3'], ['C2', 'E3', 'A#3', 'C4'],
      ],
      lead: [
        'A4 C5 - A4 F4 - G4 A4', 'F4 - D4 - F4 A4 G4 F4', 'D5 - C5 A#4 - A4 A#4 -', 'C5 ~ ~ - E4 F4 G4 -',
        'A4 C5 - A4 F4 - C5 D5', 'E5 - C5 - A4 - C5 -', 'D5 C5 A#4 A4 G4 - F4 G4', 'E4 ~ G4 ~ A#4 ~ C5 -',
      ].map((bar) => bar.split(' ')),
    },
  };

  class SynthSong {
    constructor(audio, def, out) {
      this.a = audio; this.def = def; this.out = out;
      this.step = 0; this.next = 0; this.timer = null;
    }
    start() {
      const ctx = this.a.ctx;
      this.next = ctx.currentTime + 0.08;
      this.step = 0;
      this.timer = setInterval(() => this.pump(), 30);
      this.pump();
    }
    stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
    pump() {
      const ctx = this.a.ctx;
      if (!ctx || ctx.state !== 'running') return;          // 一時停止中は予約しない
      const stepDur = 60 / this.def.bpm / 2;
      if (this.next < ctx.currentTime - 0.5) this.next = ctx.currentTime + 0.05; // 長く止まっていたら追いつかせない
      while (this.next < ctx.currentTime + 0.2) { this.play(this.step, this.next, stepDur); this.next += stepDur; this.step++; }
    }
    play(step, t, sd) {
      const d = this.def, a = this.a, o = this.out;
      const bars = d.chords.length;
      const bar = Math.floor(step / 8) % bars, s = step % 8;
      const ch = d.chords[bar];
      if (d === SONGS.title) {
        if (s === 0) {
          for (let i = 1; i < ch.length; i++) a.pad(N(ch[i]), t, sd * 8, 0.035, o);       // やわらかいパッド
          a.tone('sine', N(ch[0]), N(ch[0]), t, sd * 8, 0.09, { out: o, attack: 0.4 });  // 低い音
        }
        const k = d.arp[s];
        if (k >= 0) a.bell(N(ch[k]) * 2, t, 0.9, 0.045, o);                               // 鈴のようなアルペジオ
        if (s === 5 && bar % 2 === 1) a.bell(N(ch[3]) * 4, t + sd * 0.5, 0.4, 0.015, o);   // ときどき小さなきらめき
      } else {
        // ベース（ルートとオクターブを跳ねる）
        const root = N(ch[0]);
        a.tone('triangle', s % 2 ? root * 2 : root, s % 2 ? root * 2 : root, t, sd * 0.8, 0.13, { out: o, decay: true });
        // 打楽器（やわらかいキック・裏拍のハイハット・2拍4拍の「ぽこ」）
        if (s === 0 || s === 4) a.kick(t, 0.22, o);
        if (s % 2 === 1) a.noise(t, 0.03, 0.035, 'highpass', 7000, 7000, 0.7, o);
        if (s === 2 || s === 6) { a.noise(t, 0.06, 0.06, 'bandpass', 1800, 1400, 1.4, o); a.tone('sine', 520, 380, t, 0.05, 0.05, { out: o }); }
        // メロディ（はじく音）
        const n = d.lead[bar][s];
        if (n && n !== '-' && n !== '~') {
          let len = 1;
          while (s + len < 8 && d.lead[bar][s + len] === '~') len++;
          a.pluck(N(n), t, sd * len * 0.95, 0.075, o);
        }
        // 和音を軽く刻む（裏拍）
        if (s === 3 || s === 7) for (let i = 1; i < ch.length; i++) a.tone('square', N(ch[i]) * 2, N(ch[i]) * 2, t, sd * 0.4, 0.012, { out: o, lowpass: 2200, decay: true });
      }
    }
  }

  // ---------------------------------------------------------------------------
  class SoundSystem {
    constructor() {
      this.cfg = KG.CONFIG.audio || { enabled: false };
      this.ctx = null;
      this.last = {};
      this.voicesEnd = [];
      this.want = null;        // 今の画面に合う BGM（'title' | 'battle'）
      this.duck = 1;           // 勝敗表示などでの BGM の音量倍率
      this.cur = null;         // 再生中 { name, gain, song, el }
      this.fileState = {};     // BGM ファイルの状態 'ok' | 'failed'
      this.prevCount = null; this.prevPhase = null; this.hidden = false;
    }

    // 最初のユーザー操作で音を有効にする（それまでは何も鳴らさない）
    unlock() {
      if (!this.cfg.enabled) return;
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          const ctx = new AC();
          this.ctx = ctx;
          this.master = ctx.createGain(); this.master.gain.value = this.cfg.master;
          const comp = ctx.createDynamicsCompressor();             // 音が重なった時に割れないように
          comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
          this.master.connect(comp); comp.connect(ctx.destination);
          this.seBus = ctx.createGain(); this.seBus.gain.value = this.cfg.se; this.seBus.connect(this.master);
          this.bgmBus = ctx.createGain(); this.bgmBus.gain.value = this.cfg.bgm; this.bgmBus.connect(this.master);
          // 白色雑音（効果音用。音専用の乱数で作る）
          const len = Math.floor(ctx.sampleRate * 1);
          this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
          const ch = this.noiseBuf.getChannelData(0);
          for (let i = 0; i < len; i++) ch[i] = rnd() * 2 - 1;
          // iOS：無音を1回鳴らして有効化
          const src = ctx.createBufferSource(); src.buffer = ctx.createBuffer(1, 1, 22050); src.connect(ctx.destination); src.start(0);
        }
        if (this.ctx.state === 'suspended' && !this.hidden) this.ctx.resume().catch(() => {});
        if (this.want && !this.cur) this.switchBgm(this.want);
      } catch (_) { /* 音が使えない環境でもゲームは続ける */ }
    }

    get ready() { return !!this.ctx && this.ctx.state === 'running' && !this.hidden; }

    // ---- 音の部品 ----
    tone(type, f0, f1, t, dur, vol, opt) {
      opt = opt || {};
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(Math.max(20, f0), t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const g = ctx.createGain();
      const atk = opt.attack != null ? opt.attack : 0.005;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, atk + 0.02));
      let node = o;
      if (opt.lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opt.lowpass; o.connect(f); node = f; }
      node.connect(g); g.connect(opt.out || this.seBus);
      o.start(t); o.stop(t + Math.max(dur, atk + 0.02) + 0.03);
      this.track(t + dur);
    }
    noise(t, dur, vol, type, f0, f1, q, out) {
      const ctx = this.ctx;
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q || 1;
      f.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(out || this.seBus);
      s.start(t, rnd() * 0.5); s.stop(t + dur + 0.02);
      this.track(t + dur);
    }
    pad(f, t, dur, vol, out) {
      const ctx = this.ctx;
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur);
        o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
      }
    }
    bell(f, t, dur, vol, out) {
      this.tone('sine', f, f, t, dur, vol, { out, decay: true });
      this.tone('sine', f * 3, f * 3, t, dur * 0.35, vol * 0.18, { out, decay: true });
    }
    pluck(f, t, dur, vol, out) {
      this.tone('square', f, f, t, Math.max(0.08, dur), vol * 0.55, { out, lowpass: 2400 });
      this.tone('triangle', f, f, t, Math.max(0.1, dur), vol, { out });
    }
    kick(t, vol, out) { this.tone('sine', 140, 45, t, 0.16, vol, { out }); }
    track(end) { this.voicesEnd.push(end); }

    // ---- 効果音を鳴らす（同じ音の最短間隔・同時発音数の上限あり）----
    play(name, opts) {
      if (!this.ready || !SFX[name]) return;
      const now = this.ctx.currentTime;
      const minI = MIN_INTERVAL[name] || 0.02;
      if (this.last[name] != null && now - this.last[name] < minI) return;
      this.voicesEnd = this.voicesEnd.filter((e) => e > now);
      if (!PRIORITY[name] && this.voicesEnd.length >= this.cfg.maxVoices) return;
      this.last[name] = now;
      try { SFX[name](this, now + 0.005, opts || {}); } catch (_) { /* 音の失敗はゲームに影響させない */ }
    }

    // ---- BGM ----
    setWant(name, duck) {
      this.want = name;
      if (duck !== this.duck) {
        this.duck = duck;
        if (this.cur && this.ctx) this.ramp(this.cur.gain, duck, this.cfg.bgmFade * 0.6);
      }
      if (this.ready && (!this.cur || this.cur.name !== name)) this.switchBgm(name);
    }
    ramp(g, v, sec) {
      const t = this.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(Math.max(0.0001, v), t + sec);
    }
    switchBgm(name) {
      if (!this.ctx) return;
      const fade = this.cfg.bgmFade;
      if (this.cur) { // 今の曲をフェードアウトして止める
        const old = this.cur;
        this.ramp(old.gain, 0.0001, fade);
        setTimeout(() => { if (old.song) old.song.stop(); if (old.el) { try { old.el.pause(); } catch (_) { /* noop */ } } try { old.gain.disconnect(); } catch (_) { /* noop */ } }, fade * 1000 + 100);
        this.cur = null;
      }
      if (!name) return;
      const gain = this.ctx.createGain(); gain.gain.value = 0.0001; gain.connect(this.bgmBus);
      const entry = { name, gain, song: null, el: null };
      const file = this.cfg.bgmFiles && this.cfg.bgmFiles[name];
      if (file && this.fileState[file] !== 'failed') {
        try {
          const el = new Audio();
          el.loop = true; el.preload = 'auto'; el.src = file;
          el.addEventListener('error', () => { // 読み込めない → 仮BGM（または無音）へ。エラーは1回だけ
            this.fileState[file] = 'failed';
            if (this.cur === entry) { entry.el = null; this.startSynth(entry); }
          }, { once: true });
          this.ctx.createMediaElementSource(el).connect(gain);
          entry.el = el;
          const p = el.play(); if (p && p.catch) p.catch(() => {});
        } catch (_) { this.fileState[file] = 'failed'; this.startSynth(entry); }
      } else {
        this.startSynth(entry);
      }
      this.cur = entry;
      this.ramp(gain, this.duck, fade);
    }
    startSynth(entry) {
      if (!this.cfg.synthFallback || !SONGS[entry.name]) return;
      entry.song = new SynthSong(this, SONGS[entry.name], entry.gain);
      entry.song.start();
    }

    // ページが見えない間は止める／戻ったら再開
    setHidden(h) {
      this.hidden = h;
      if (!this.ctx) return;
      try {
        if (h) { this.ctx.suspend().catch(() => {}); if (this.cur && this.cur.el) this.cur.el.pause(); }
        else {
          this.ctx.resume().catch(() => {});
          if (this.cur && this.cur.el) { const p = this.cur.el.play(); if (p && p.catch) p.catch(() => {}); }
          if (this.cur && this.cur.song) this.cur.song.next = this.ctx.currentTime + 0.1;
        }
      } catch (_) { /* noop */ }
    }

    // 毎フレーム：画面状態に合わせて BGM・カウントダウン・勝敗ジングル
    update(game) {
      const ph = game.phase;
      const music = (ph === 'title' || ph === 'difficulty') ? 'title' : 'battle';
      const duck = ph === 'result' ? this.cfg.resultDuck : ph === 'ending' ? this.cfg.endingDuck : 1;
      this.setWant(music, duck);
      const cd = game.countdownLabel();
      const key = cd ? cd.key : null;
      if (key !== this.prevCount) {
        if (key === 'start') this.play('start');
        else if (key) this.play('count');
        this.prevCount = key;
      }
      if (ph !== this.prevPhase) {
        if (ph === 'result') this.play(game.winner === game.player ? 'jingleWin' : 'jingleLose');
        this.prevPhase = ph;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 既存の処理を外から包んで音を鳴らす（元の処理はそのまま。戦闘の結果は変わらない）
  // ---------------------------------------------------------------------------
  KG.installSound = function (game, sound) {
    const safe = (fn) => { try { fn(); } catch (_) { /* 音の失敗はゲームに影響させない */ } };
    const F = KG.Fighter.prototype;
    const startMove0 = F.startMove;
    F.startMove = function (move) {
      startMove0.call(this, move);
      const ms = MOVE_SOUNDS[move.id];
      if (ms && ms.start) safe(() => sound.play(ms.start));
    };
    const update0 = F.update;
    F.update = function (dt, cmd, stage) {
      const r = update0.call(this, dt, cmd, stage);
      const a = this.action;
      if (a && a._sndFrame !== a.frame) {
        a._sndFrame = a.frame;
        const ms = MOVE_SOUNDS[a.move.id];
        if (ms && ms.frames && ms.frames[a.frame]) safe(() => sound.play(ms.frames[a.frame]));
      }
      return r;
    };
    const receiveHit0 = F.receiveHit;
    F.receiveHit = function (hit) {
      receiveHit0.call(this, hit);
      safe(() => {
        const src = hit.source;
        const id = src && src.owner ? src.def.id : (hit.move && hit.move.id);
        const heavy = clamp(((hit.knockback && hit.knockback.scale) || 1) - 1.5, 0, 1.2) / 1.2;
        if (id === 'bubble') sound.play('hitLight');
        else {
          sound.play('hit', { s: HIT_STRENGTH[id] != null ? HIT_STRENGTH[id] : 0.6, heavy });
          if (id === 'jellyShock') sound.play('hitZap');
        }
      });
    };
    const receiveGuard0 = F.receiveGuard;
    F.receiveGuard = function (g) { receiveGuard0.call(this, g); safe(() => sound.play('guard')); };
    const PS = KG.ProjectileSystem.prototype;
    const spawnFrom0 = PS.spawnFrom;
    PS.spawnFrom = function (owner, spawn) {
      const p = spawnFrom0.call(this, owner, spawn);
      if (p) safe(() => sound.play(p.def.id === 'bubble' ? 'bubbleFire' : 'orbFire'));
      return p;
    };
    const removeDead0 = PS.removeDead;
    PS.removeDead = function () {
      for (const p of this.list) {
        if (p.dead && !p._sndDone && (p.deathReason === 'hit' || p.deathReason === 'terrain' || p.deathReason === 'lifetime')) {
          p._sndDone = true;
          safe(() => sound.play(p.def.id === 'bubble' ? 'bubblePop' : 'orbVanish'));
        }
      }
      return removeDead0.call(this);
    };
    const onKO0 = game.onKnockOut.bind(game);
    game.onKnockOut = (e, point) => { onKO0(e, point); safe(() => sound.play('ko')); };
  };

  KG.SoundSystem = SoundSystem;
  // 確認用（オフラインで音を書き出す時などに使う。ゲームの動きには関係しない）
  KG.AUDIO_DEFS = { SFX, SONGS, SynthSong };
  KG.SOUND_LIST = Object.keys(SFX);
})(window.KG = window.KG || {});
