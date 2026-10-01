/*
 * net-protocol.js — オンライン実験（Online Phase 1）の通信メッセージ定義と検証
 *
 * ゲーム本体（Fighter / AI / 戦闘など）には一切触れません。DOM にも触れません。
 * 相手から届いたデータは必ず decode() を通し、
 *   - 文字列であること・大きさの上限
 *   - JSON として読めること・プレーンなオブジェクトであること
 *   - 既知の type（キー t）であること
 *   - 各値の型・範囲
 * を確認してから、必要な値だけをコピーした新しいオブジェクトを返します。想定外のものは null（破棄）。
 */
(function (KG) {
  'use strict';

  const APP_ID = 'kotaro-online-exp';   // 別アプリと誤接続していないかの確認用
  const PROTO_VERSION = 3;              // 通信の形式を変えたら上げる（違うと接続を断る）。2 = Online Phase 2（操作実験）/ 3 = Phase 3（予測）
  const MAX_MSG_CHARS = 1024;           // 1メッセージの上限（文字数）。最大の st（HOST 状態）でも 約 450 文字

  // ルームコード：表示用は「KOTA-3812」。PeerJS 上の ID はアプリ固有の長い接頭辞 + 4桁（他アプリと混ざらない）
  // 同じ4桁が使用中なら PeerJS サーバーが 'unavailable-id' を返すので、別の4桁で作り直す（ID の一意性はサーバーが保証）
  const CODE_LABEL = 'KOTA';
  const PEER_ID_PREFIX = 'kotaro-daikakuto-online-exp1-';
  const TEST_KEYS = ['LEFT', 'RIGHT', 'JUMP'];
  const REJECT_REASONS = ['full', 'version'];

  function randomCode() {
    const a = new Uint32Array(1);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return String(a[0] % 10000).padStart(4, '0');
  }
  const displayCode = (code) => CODE_LABEL + '-' + code;
  const peerIdFor = (code) => PEER_ID_PREFIX + code;

  // 入力欄の文字列 → 4桁のコード（読めなければ null）。全角数字・小文字・空白・ハイフン・「KOTA」の有無を許す
  function parseCode(text) {
    if (typeof text !== 'string' || text.length > 40) return null;
    let s = text.normalize ? text.normalize('NFKC') : text;
    s = s.toUpperCase().replace(/[\s\-_ー－‐]/g, '');
    if (s.startsWith(CODE_LABEL)) s = s.slice(CODE_LABEL.length);
    return /^\d{4}$/.test(s) ? s : null;
  }

  // ---- 値の検証 ----
  const isInt = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const BIG = 1e9;
  const TIME_MAX = 1e12; // performance.now() のミリ秒
  const POS_MAX = 1e5;   // 座標の範囲（ステージより十分広い）
  const VEL_MAX = 1e5;   // 速度の範囲
  const isBit = (v) => v === 0 || v === 1;
  const END_REASONS = ['user', 'timeout', 'error'];

  // type ごとの検証と「必要な値だけのコピー」
  const SCHEMA = {
    hello:   (m) => (m.app === APP_ID && isInt(m.v, 0, 1000)) ? { t: 'hello', app: m.app, v: m.v } : null,
    welcome: (m) => isInt(m.v, 0, 1000) ? { t: 'welcome', v: m.v } : null,
    reject:  (m) => REJECT_REASONS.includes(m.reason) ? { t: 'reject', reason: m.reason } : null,
    bye:     () => ({ t: 'bye' }),
    ping:    (m) => (isInt(m.i, 0, BIG) && isNum(m.ts, 0, TIME_MAX)) ? { t: 'ping', i: m.i, ts: m.ts } : null,
    // pong の ht（応答した側の時刻）は Phase 2 で追加。時計のずれの推定に使う（無くてもよい）
    pong:    (m) => (isInt(m.i, 0, BIG) && isNum(m.ts, 0, TIME_MAX) && (m.ht === undefined || isNum(m.ht, 0, TIME_MAX)))
      ? (m.ht === undefined ? { t: 'pong', i: m.i, ts: m.ts } : { t: 'pong', i: m.i, ts: m.ts, ht: m.ht }) : null,
    in:      (m) => TEST_KEYS.includes(m.k) ? { t: 'in', k: m.k } : null,
    // 連続通信テスト：bs=開始 / bp=パケット / ba=受信確認 / be=送信終了 / br=受信側の集計
    bs: (m) => (isInt(m.id, 1, BIG) && isInt(m.n, 1, 1000) && isInt(m.hz, 1, 120)) ? { t: 'bs', id: m.id, n: m.n, hz: m.hz } : null,
    bp: (m) => (isInt(m.id, 1, BIG) && isInt(m.s, 0, 999) && isNum(m.ts, 0, TIME_MAX) && isInt(m.b, 0, 255)) ? { t: 'bp', id: m.id, s: m.s, ts: m.ts, b: m.b } : null,
    ba: (m) => (isInt(m.id, 1, BIG) && isInt(m.s, 0, 999)) ? { t: 'ba', id: m.id, s: m.s } : null,
    be: (m) => (isInt(m.id, 1, BIG) && isInt(m.sent, 0, 1000)) ? { t: 'be', id: m.id, sent: m.sent } : null,
    br: (m) => (isInt(m.id, 1, BIG) && isInt(m.r, 0, 1000) && isInt(m.l, 0, 1000) && isInt(m.o, 0, 1000) && isInt(m.d, 0, 1000))
      ? { t: 'br', id: m.id, r: m.r, l: m.l, o: m.o, d: m.d } : null,

    // ---- Online Phase 2：操作実験 ----
    // ms = 開始（HOST→GUEST）/ mr = 準備完了（GUEST→HOST）/ me = 終了（どちらからでも）
    ms: (m) => isInt(m.id, 1, BIG) ? { t: 'ms', id: m.id } : null,
    mr: (m) => isInt(m.id, 1, BIG) ? { t: 'mr', id: m.id } : null,
    me: (m) => (isInt(m.id, 1, BIG) && END_REASONS.includes(m.r)) ? { t: 'me', id: m.id, r: m.r } : null,
    // mi = GUEST の入力状態：s=入力番号 / l・r・j=左・右・ジャンプを押しているか(0/1) / jp=ジャンプを押した回数の累計 / ts=送信時刻
    //      （座標や速度は受け付けない。入力だけ）
    mi: (m) => (isInt(m.s, 1, BIG) && isBit(m.l) && isBit(m.r) && isBit(m.j) && isInt(m.jp, 0, BIG) && isNum(m.ts, 0, TIME_MAX))
      ? { t: 'mi', s: m.s, l: m.l, r: m.r, j: m.j, jp: m.jp, ts: m.ts } : null,
    // st = HOST のゲーム状態：s=状態番号 / h=HOST のゲーム内時刻(ms) / w=送信時刻 / a=適用済みの最新入力番号
    //      f=[コタロ, ルミポ] それぞれ [x, y, vx, vy, 向き(±1), フラグ, 無敵の残り秒]
    st: (m) => {
      if (!(isInt(m.s, 1, BIG) && isNum(m.h, 0, TIME_MAX) && isNum(m.w, 0, TIME_MAX) && isInt(m.a, 0, BIG))) return null;
      if (!Array.isArray(m.f) || m.f.length !== 2) return null;
      const f = [];
      for (const e of m.f) {
        if (!Array.isArray(e) || e.length !== 7) return null;
        if (!(isNum(e[0], -POS_MAX, POS_MAX) && isNum(e[1], -POS_MAX, POS_MAX) && isNum(e[2], -VEL_MAX, VEL_MAX) && isNum(e[3], -VEL_MAX, VEL_MAX))) return null;
        if (!(e[4] === 1 || e[4] === -1) || !isInt(e[5], 0, 255) || !isNum(e[6], 0, 60)) return null;
        f.push([e[0], e[1], e[2], e[3], e[4], e[5], e[6]]);
      }
      // p（Phase 3）= ルミポの移動に関わる値 [x, y, vx, vy, 向き, 接地, 空中ジャンプ残り, コヨーテ残り, ジャンプ先行入力残り, 技中のジャンプ保留, 小ジャンプ可, 吹っ飛び中]
      const p = m.p;
      if (!Array.isArray(p) || p.length !== 12) return null;
      if (!(isNum(p[0], -POS_MAX, POS_MAX) && isNum(p[1], -POS_MAX, POS_MAX) && isNum(p[2], -VEL_MAX, VEL_MAX) && isNum(p[3], -VEL_MAX, VEL_MAX))) return null;
      if (!(p[4] === 1 || p[4] === -1) || !isBit(p[5]) || !isInt(p[6], 0, 10) || !isNum(p[7], 0, 10) || !isNum(p[8], 0, 10)) return null;
      if (!isBit(p[9]) || !isBit(p[10]) || !isBit(p[11])) return null;
      return { t: 'st', s: m.s, h: m.h, w: m.w, a: m.a, f, p: p.slice() };
    },
  };

  // 受信データ → 検証済みメッセージ。{ msg, reason } を返す（msg が null なら破棄。reason はログ用）
  function decode(raw) {
    if (typeof raw !== 'string') return { msg: null, reason: 'not-string' };
    if (raw.length > MAX_MSG_CHARS) return { msg: null, reason: 'too-large(' + raw.length + ')' };
    let m;
    try { m = JSON.parse(raw); } catch (_) { return { msg: null, reason: 'bad-json' }; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return { msg: null, reason: 'not-object' };
    if (Object.keys(m).length > 8) return { msg: null, reason: 'too-many-keys' };
    const t = m.t;
    if (typeof t !== 'string' || !Object.prototype.hasOwnProperty.call(SCHEMA, t)) return { msg: null, reason: 'unknown-type' };
    const out = SCHEMA[t](m);
    return out ? { msg: out, reason: null } : { msg: null, reason: 'bad-fields(' + t + ')' };
  }

  function encode(msg) { return JSON.stringify(msg); }

  // UTF-8 のバイト数（通信量の概算用）
  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const byteLength = (s) => enc ? enc.encode(s).length : s.length;

  KG.NetProtocol = {
    APP_ID, PROTO_VERSION, MAX_MSG_CHARS, CODE_LABEL, PEER_ID_PREFIX, TEST_KEYS,
    randomCode, displayCode, peerIdFor, parseCode, decode, encode, byteLength,
  };
})(window.KG = window.KG || {});
