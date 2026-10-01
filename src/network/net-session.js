/*
 * net-session.js — オンライン実験（Online Phase 1）：PeerJS（WebRTC DataChannel）で 2 ブラウザをつなぐ通信セッション
 *
 * ・ゲーム本体（Game / Fighter / AI / 入力 / 音）には一切触れません。DOM にも触れません（画面は online-ui.js）。
 * ・PeerJS は window.Peer（index.html で読み込み）を使います。別の場所に置く場合も Peer コンストラクタを渡せば動きます。
 * ・状態の変化や受信は on(イベント名, 関数) で受け取ります。
 *
 * 状態 state：
 *   'idle'       … 何もしていない
 *   'creating'   … HOST：接続サーバーにルーム（Peer ID）を登録中
 *   'waiting'    … HOST：ルームを作成済み。GUEST を待っている
 *   'connecting' … GUEST：ホストへ接続中 / HOST：GUEST の接続を確認中
 *   'connected'  … 双方が確認済み（hello / welcome を交換した後）
 *   'closed'     … 接続後に切れた・自分で切断した
 *   'failed'     … 接続できなかった
 * 終了理由 endReason（画面の文言は online-ui.js が決める）：
 *   user / remote-bye / remote-closed / timeout / ice-failed / peer-unavailable / server / browser /
 *   id-exhausted / reject-full / reject-version / handshake-timeout / connect-timeout / no-peerjs / unload / error
 */
(function (KG) {
  'use strict';

  const P = KG.NetProtocol;

  const CFG = {
    pingIntervalMs: 1000,      // Ping は 1 秒に 1 回
    pingHistory: 10,           // 平均 Ping に使う直近の回数
    staleMs: 3000,             // これ以上受信が無ければ「応答が遅れています」
    deadMs: 10000,             // これ以上受信が無ければ切断扱い（相手のブラウザが閉じた・回線が切れた等）
    handshakeMs: 8000,         // DataChannel が開いてから hello / welcome を交換するまでの上限
    joinTimeoutMs: 25000,      // GUEST：コード入力から接続完了までの上限
    pendingGuestMs: 20000,     // HOST：GUEST の接続要求から接続完了までの上限
    idRetries: 6,              // ルームコードが使用中だった時に作り直す回数
    burstHz: 30,               // 連続通信テスト：毎秒 30 回
    burstSeconds: 10,          //                  10 秒間
    burstFinishWaitMs: 5000,   //                  送信終了後、相手の集計を待つ上限
    maxRecvPerSec: 240,        // 受信の上限（これを超えた分は破棄）
    routeCheckMs: 5000,        // 経路情報（getStats）の更新間隔
  };

  const now = () => performance.now();

  class NetSession {
    constructor(opts) {
      opts = opts || {};
      this._PeerOpt = opts.Peer || null;   // 省略時は window.Peer（PeerJS は async で読み込むので使う時に探す）
      this.peerDebug = opts.peerDebug != null ? opts.peerDebug : 1;   // PeerJS の内部ログ（0〜3）。1 = エラーのみ
      this.iceMode = opts.iceMode === 'stun-only' ? 'stun-only' : 'default';
      this.listeners = {};
      this.logs = [];       // 画面表示用（直近 20 件）
      this.fullLog = [];    // ログのコピー用（直近 300 件）
      this.gen = 0;         // セッションの世代。古い Peer / 接続から遅れて届いたイベントを無視するため
      this.resetFields();
    }

    // ---------------- イベント ----------------
    on(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); return this; }
    emit(name, a, b) {
      for (const fn of this.listeners[name] || []) {
        try { fn(a, b); } catch (err) { console.error('[KotaroNet] listener error', err); }
      }
    }

    log(text, level) {
      const t = new Date();
      const stamp = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
      const entry = { stamp, text: String(text), level: level || 'info' };
      this.logs.push(entry);
      if (this.logs.length > 20) this.logs.shift();
      this.fullLog.push(entry);
      if (this.fullLog.length > 300) this.fullLog.shift();
      (level === 'error' ? console.warn : console.debug)('[KotaroNet]', text);
      this.emit('log', entry);
    }

    // ---------------- 状態 ----------------
    resetFields() {
      this.state = 'idle';
      this.role = null;            // 'HOST' | 'GUEST'
      this.code = null;            // 4 桁
      this.peer = null;
      this.conn = null;
      this.handshaken = false;
      this.endReason = null;
      this.endDetail = '';
      this.signal = '-';           // 接続サーバー（シグナリング）の状態
      this.iceState = '-';
      this.route = null;           // getStats から読んだ経路
      this.stats = { sent: 0, recv: 0, dropped: 0, sentBytes: 0, recvBytes: 0 };
      this.lastRecvAt = 0;
      this.connectedAt = 0;
      this.ping = { last: null, history: [], min: null, max: null, nextId: 1, pending: new Map(), count: 0, offs: [] };
      this.clockOffset = null;     // 相手の時計 − 自分の時計（ms）。Ping から推定
      this.rate = { windowStart: 0, count: 0, warned: false };
      this.out = null;             // 自分が送っている連続通信テスト
      this.inb = null;             // 相手から受けている連続通信テスト
      this.burstId = 0;
      this.timers = [];
      this.dropLogCount = 0;
      this._reconnectTried = false;
      this._iceFailed = false;
    }

    setState(s) {
      if (this.state === s) return;
      this.state = s;
      this.log('state → ' + s);
      this.emit('state', s);
    }

    get active() { return this.state === 'creating' || this.state === 'waiting' || this.state === 'connecting' || this.state === 'connected'; }
    get displayCode() { return this.code ? P.displayCode(this.code) : ''; }
    get dataChannelState() {
      try { return (this.conn && this.conn.dataChannel && this.conn.dataChannel.readyState) || '-'; } catch (_) { return '-'; }
    }
    get pingAvg() {
      const h = this.ping.history;
      return h.length ? h.reduce((a, b) => a + b, 0) / h.length : null;
    }
    get sinceLastRecv() { return this.lastRecvAt ? now() - this.lastRecvAt : null; }
    get isStale() { return this.state === 'connected' && this.sinceLastRecv != null && this.sinceLastRecv > CFG.staleMs; }

    peerOptions() {
      const o = { debug: this.peerDebug };
      // 既定（'default'）は PeerJS の標準設定（STUN と PeerJS 提供の TURN）をそのまま使う
      if (this.iceMode === 'stun-only') o.config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
      return o;
    }

    later(fn, ms, gen) {
      const id = setTimeout(() => { if (gen === this.gen) fn(); }, ms);
      this.timers.push({ type: 't', id });
      return id;
    }
    every(fn, ms, gen) {
      const id = setInterval(() => { if (gen === this.gen) fn(); }, ms);
      this.timers.push({ type: 'i', id });
      return id;
    }
    clearTimers() {
      for (const t of this.timers) (t.type === 'i' ? clearInterval : clearTimeout)(t.id);
      this.timers = [];
      if (this.out && this.out.timer) clearInterval(this.out.timer);
    }

    get PeerCtor() { return this._PeerOpt || window.Peer || null; }

    // PeerJS の読み込みを待つ（最大 10 秒）。読めなければ失敗表示
    whenLib(gen, fn) {
      const t0 = now();
      const check = () => {
        if (gen !== this.gen) return;
        if (this.PeerCtor) return fn();
        if (now() - t0 > 10000) return this.fail('no-peerjs', 'PeerJS library not loaded (window.Peer is undefined)');
        this.later(check, 200, gen);
      };
      check();
    }

    // ---------------- HOST ----------------
    host() {
      this.close('restart', true);
      this.resetFields();
      const gen = ++this.gen;
      this.role = 'HOST';
      this.setState('creating');
      this.log('HOST: creating room (ice=' + this.iceMode + ')');
      this.every(() => this.tick(), 250, gen);
      this.whenLib(gen, () => this.tryCreate(gen, 0));
    }

    tryCreate(gen, attempt) {
      if (gen !== this.gen) return;
      if (attempt >= CFG.idRetries) return this.fail('id-exhausted', 'all room codes tried were in use');
      const code = P.randomCode();
      let peer;
      try {
        peer = new this.PeerCtor(P.peerIdFor(code), this.peerOptions());
      } catch (err) {
        return this.fail('browser', 'new Peer failed: ' + (err && err.message));
      }
      this.peer = peer;
      this.signal = 'connecting';
      peer.on('open', (id) => {
        if (gen !== this.gen || peer !== this.peer) return;
        this.code = code;
        this.signal = 'open';
        this.log('HOST created: ' + P.displayCode(code) + ' (peer id ' + id + ')');
        this.setState('waiting');
        this.emit('update');
      });
      peer.on('connection', (conn) => { if (gen === this.gen && peer === this.peer) this.onIncoming(conn, gen); });
      peer.on('error', (err) => {
        if (gen !== this.gen || peer !== this.peer) return;
        const type = err && err.type;
        if (type === 'unavailable-id') {
          // 同じ 4 桁を誰かが使用中 → この Peer を破棄して別のコードで作り直す
          this.log('room code ' + code + ' in use → retry', 'warn');
          this.peer = null;
          try { peer.destroy(); } catch (_) { /* noop */ }
          this.later(() => this.tryCreate(gen, attempt + 1), 150, gen);
          return;
        }
        this.onPeerError(err);
      });
      peer.on('disconnected', () => this.onSignalLost(gen, peer));
      peer.on('close', () => { if (gen === this.gen && peer === this.peer) { this.signal = 'closed'; this.emit('update'); } });
    }

    onIncoming(conn, gen) {
      const who = String(conn.peer || '?').slice(0, 40);
      // 1 対 1 のみ。すでに相手がいる場合は「満員」と伝えて閉じる
      if (this.conn) {
        this.log('extra connection from ' + who + ' → rejected (room full)', 'warn');
        conn.on('open', () => {
          try { conn.send(P.encode({ t: 'reject', reason: 'full' })); } catch (_) { /* noop */ }
          setTimeout(() => { try { conn.close(); } catch (_) { /* noop */ } }, 400);
        });
        return;
      }
      if (conn.serialization !== 'raw') {
        this.log('connection with unexpected serialization "' + conn.serialization + '" → closed', 'warn');
        try { conn.close(); } catch (_) { /* noop */ }
        return;
      }
      this.log('GUEST connecting: ' + who);
      this.conn = conn;
      this.setState('connecting');
      this.attachConn(conn, gen);
      this.later(() => {
        if (this.conn === conn && !this.handshaken) this.dropPendingGuest('guest did not finish connecting in ' + CFG.pendingGuestMs / 1000 + 's (ICE ' + this.iceState + ')');
      }, CFG.pendingGuestMs, gen);
    }

    // HOST：接続途中の GUEST が失敗した時は、ルームを開いたまま待機に戻る
    dropPendingGuest(why) {
      const conn = this.conn;
      this.log('GUEST attempt dropped: ' + why, 'warn');
      this.diagnoseFailure(conn);
      this.conn = null;
      this.iceState = '-';
      this.route = null;
      try { conn && conn.close(); } catch (_) { /* noop */ }
      if (this.peer && !this.peer.destroyed) this.setState('waiting');
      this.emit('update');
    }

    // ---------------- GUEST ----------------
    join(code) {
      this.close('restart', true);
      this.resetFields();
      const gen = ++this.gen;
      this.role = 'GUEST';
      this.code = code;
      this.setState('connecting');
      this.log('GUEST: joining ' + P.displayCode(code) + ' (ice=' + this.iceMode + ')');
      this.every(() => this.tick(), 250, gen);
      this.whenLib(gen, () => this.startGuest(gen, code));
    }

    startGuest(gen, code) {
      let peer;
      try {
        peer = new this.PeerCtor(this.peerOptions());   // GUEST の ID はサーバーが決める
      } catch (err) {
        return this.fail('browser', 'new Peer failed: ' + (err && err.message));
      }
      this.peer = peer;
      this.signal = 'connecting';
      peer.on('open', (id) => {
        if (gen !== this.gen || peer !== this.peer) return;
        this.signal = 'open';
        this.log('signaling open (my id ' + id + ') → connecting to host');
        let conn;
        try {
          conn = peer.connect(P.peerIdFor(code), {
            reliable: true,          // 順序保証・再送あり（Phase 1 は確実に届く方式で測定）
            serialization: 'raw',    // 文字列をそのまま送る（受信側で自前の検証をしてから JSON.parse する）
          });
        } catch (err) {
          return this.fail('error', 'peer.connect failed: ' + (err && err.message));
        }
        if (!conn) return this.fail('error', 'peer.connect returned nothing');
        this.conn = conn;
        this.attachConn(conn, gen);
        this.emit('update');
      });
      peer.on('error', (err) => { if (gen === this.gen && peer === this.peer) this.onPeerError(err); });
      peer.on('disconnected', () => this.onSignalLost(gen, peer));
      peer.on('close', () => { if (gen === this.gen && peer === this.peer) { this.signal = 'closed'; this.emit('update'); } });
      this.later(() => {
        if (!this.handshaken && this.state === 'connecting') {
          this.diagnoseFailure(this.conn);
          this.fail(this.iceState === 'checking' || this.iceState === 'failed' ? 'ice-failed' : 'connect-timeout',
            'not connected within ' + CFG.joinTimeoutMs / 1000 + 's (signal ' + this.signal + ', ICE ' + this.iceState + ', DC ' + this.dataChannelState + ')');
        }
      }, CFG.joinTimeoutMs, gen);
    }

    // ---------------- 共通：Peer / DataConnection ----------------
    onPeerError(err) {
      const type = (err && err.type) || 'unknown';
      const msg = (err && err.message) || String(err);
      this.log('peer error [' + type + ']: ' + msg, 'error');
      switch (type) {
        case 'peer-unavailable':
          // HOST 側でこれが出ることは通常ないが、念のため GUEST の時だけ失敗にする
          if (this.role === 'GUEST' && !this.handshaken) this.fail('peer-unavailable', msg);
          break;
        case 'browser-incompatible':
          this.fail('browser', msg); break;
        case 'network': case 'server-error': case 'socket-error': case 'socket-closed': case 'ssl-unavailable': case 'invalid-key':
          // 接続後なら DataChannel は生きているので、シグナリングが切れただけとして扱う
          if (this.state === 'connected') { this.signal = 'error'; this.emit('update'); } else this.fail('server', msg);
          break;
        case 'disconnected':
          if (this.state !== 'connected') this.fail('server', msg);
          break;
        case 'webrtc':
          if (this.state === 'connected') this.end('remote-closed', msg); else this.fail('ice-failed', msg);
          break;
        default:
          if (this.state !== 'connected') this.fail('error', type + ': ' + msg);
      }
    }

    // 接続サーバー（シグナリング）との接続が切れた。DataChannel 接続済みなら影響なし
    onSignalLost(gen, peer) {
      if (gen !== this.gen || peer !== this.peer || peer.destroyed) return;
      this.signal = 'disconnected';
      this.log('signaling server disconnected' + (this.state === 'connected' ? ' (data channel unaffected)' : ''), this.state === 'connected' ? 'info' : 'warn');
      // HOST が待機中ならルームを維持するため 1 回だけ再接続を試す
      if (this.role === 'HOST' && this.state === 'waiting' && !this._reconnectTried) {
        this._reconnectTried = true;
        try { peer.reconnect(); this.log('signaling reconnect…'); } catch (_) { /* noop */ }
      }
      this.emit('update');
    }

    attachConn(conn, gen) {
      const mine = () => gen === this.gen && conn === this.conn;
      conn.on('open', () => {
        if (!mine()) return;
        this.log('data channel open (' + (conn.reliable ? 'reliable/ordered' : 'unordered') + ', ' + conn.serialization + ')');
        this.lastRecvAt = now();
        if (this.role === 'GUEST') this.sendMsg({ t: 'hello', app: P.APP_ID, v: P.PROTO_VERSION });
        this.later(() => {
          if (mine() && !this.handshaken) {
            if (this.role === 'HOST') this.dropPendingGuest('handshake timeout');
            else this.fail('handshake-timeout', 'no welcome from host');
          }
        }, CFG.handshakeMs, gen);
        this.emit('update');
      });
      conn.on('data', (raw) => { if (mine()) this.onData(raw); });
      conn.on('close', () => {
        if (!mine()) return;
        this.log('connection closed (DC ' + this.dataChannelState + ', ICE ' + this.iceState + ')', 'warn');
        if (this.handshaken) this.end(this._iceFailed ? 'ice-failed' : 'remote-closed', 'data connection closed');
        else if (this.role === 'HOST') this.dropPendingGuest('closed before handshake');
        else this.fail(this._iceFailed ? 'ice-failed' : 'remote-closed', 'closed before handshake');
      });
      conn.on('error', (err) => {
        if (!mine()) return;
        const type = (err && err.type) || 'unknown';
        this.log('connection error [' + type + ']: ' + ((err && err.message) || err), 'error');
        if (type === 'negotiation-failed') this._iceFailed = true;
      });
      conn.on('iceStateChanged', (s) => {
        if (!mine()) return;
        this.iceState = String(s);
        this.log('ICE ' + s, s === 'failed' || s === 'disconnected' ? 'warn' : 'info');
        if (s === 'failed') { this._iceFailed = true; this.diagnoseFailure(conn); }
        if ((s === 'connected' || s === 'completed') && this.state !== 'closed') this.later(() => this.readRoute(true), 300, gen);
        this.emit('update');
      });
    }

    sendMsg(obj) {
      const conn = this.conn;
      if (!conn || !conn.open) return false;
      const s = P.encode(obj);
      try {
        conn.send(s);
      } catch (err) {
        this.log('send failed: ' + (err && err.message), 'error');
        return false;
      }
      const bytes = P.byteLength(s);
      this.stats.sent++;
      this.stats.sentBytes += bytes;
      return bytes;               // 送ったバイト数（失敗時は false）
    }

    onData(raw) {
      // 受信の量を制限（1 秒あたり maxRecvPerSec 件まで。超えた分は破棄）
      const t = now();
      if (t - this.rate.windowStart > 1000) { this.rate.windowStart = t; this.rate.count = 0; }
      if (++this.rate.count > CFG.maxRecvPerSec) {
        this.stats.dropped++;
        if (!this.rate.warned) { this.rate.warned = true; this.log('too many messages per second → dropping', 'warn'); }
        return;
      }
      if (typeof raw === 'string') this.stats.recvBytes += raw.length;
      const { msg, reason } = P.decode(raw);
      if (!msg) {
        this.stats.dropped++;
        if (this.dropLogCount++ < 5 || this.dropLogCount % 50 === 0) this.log('DROP invalid message (' + reason + ')', 'warn');
        return;
      }
      this.stats.recv++;
      this.lastRecvAt = t;

      // 接続確認（hello / welcome）が済むまでは接続確認用のメッセージだけ受け付ける
      if (!this.handshaken) {
        if (msg.t === 'hello' && this.role === 'HOST') {
          if (msg.v !== P.PROTO_VERSION) {
            this.log('GUEST protocol v' + msg.v + ' ≠ v' + P.PROTO_VERSION + ' → rejected', 'warn');
            this.sendMsg({ t: 'reject', reason: 'version' });
            const c = this.conn;
            setTimeout(() => { if (this.conn === c) this.dropPendingGuest('version mismatch'); }, 400);
            return;
          }
          this.sendMsg({ t: 'welcome', v: P.PROTO_VERSION });
          return this.onHandshaken();
        }
        if (msg.t === 'welcome' && this.role === 'GUEST') {
          if (msg.v !== P.PROTO_VERSION) return this.fail('reject-version', 'host protocol v' + msg.v);
          return this.onHandshaken();
        }
        if (msg.t === 'reject' && this.role === 'GUEST') return this.fail('reject-' + msg.reason, 'host rejected: ' + msg.reason);
        if (msg.t === 'bye') return this.role === 'GUEST' ? this.fail('remote-bye', 'host left') : this.dropPendingGuest('guest left');
        this.stats.dropped++;
        return;
      }

      switch (msg.t) {
        case 'ping': this.sendMsg({ t: 'pong', i: msg.i, ts: msg.ts, ht: Math.round(now() * 10) / 10 }); break;
        case 'pong': this.onPong(msg); break;
        case 'in':
          this.log('RECV ' + msg.k);
          this.emit('test-recv', msg.k);
          break;
        case 'bye': this.end('remote-bye', 'peer said bye'); break;
        case 'bs': this.onBurstStart(msg); break;
        case 'bp': this.onBurstPacket(msg); break;
        case 'be': this.onBurstEnd(msg); break;
        case 'ba': this.onBurstAck(msg); break;
        case 'br': this.onBurstReport(msg); break;
        // Online Phase 2（操作実験）のメッセージは online-move.js へ渡す（検証済みのものだけ）
        case 'ms': case 'mr': case 'me': case 'mi': case 'st':
          if (this.listeners.game && this.listeners.game.length) this.emit('game', msg);
          else this.stats.dropped++;
          break;
        default: this.stats.dropped++;   // hello / welcome / reject の重複など
      }
    }

    onHandshaken() {
      const gen = this.gen;
      this.handshaken = true;
      this.connectedAt = now();
      this.log((this.role === 'HOST' ? 'GUEST connected' : 'connected to HOST') + ' ✓');
      this.setState('connected');
      this.every(() => this.sendPing(), CFG.pingIntervalMs, gen);
      this.every(() => this.readRoute(false), CFG.routeCheckMs, gen);
      this.sendPing();
      this.later(() => this.readRoute(true), 500, gen);
    }

    // ---------------- Ping ----------------
    sendPing() {
      if (this.state !== 'connected') return;
      const i = this.ping.nextId++;
      const ts = now();
      this.ping.pending.set(i, ts);
      // 古い未応答は捨てる（20 個まで）
      if (this.ping.pending.size > 20) this.ping.pending.delete(this.ping.pending.keys().next().value);
      this.sendMsg({ t: 'ping', i, ts: Math.round(ts * 1000) / 1000 });
    }
    onPong(msg) {
      const sentAt = this.ping.pending.get(msg.i);
      if (sentAt == null) return;               // 自分が送っていない ID は無視
      this.ping.pending.delete(msg.i);
      const rtt = now() - sentAt;
      const p = this.ping;
      p.last = rtt;
      p.count++;
      p.history.push(rtt);
      if (p.history.length > CFG.pingHistory) p.history.shift();
      p.min = p.min == null ? rtt : Math.min(p.min, rtt);
      p.max = p.max == null ? rtt : Math.max(p.max, rtt);
      // 時計のずれ（相手の performance.now − 自分の performance.now）を推定（Phase 2 の遅延表示用）
      // 往復時間が短かった時の値ほど正確なので、直近 10 回のうち最短 RTT の時の値を使う
      if (msg.ht !== undefined) {
        p.offs.push({ rtt, off: msg.ht - (sentAt + rtt / 2) });
        if (p.offs.length > 10) p.offs.shift();
        let best = p.offs[0];
        for (const o of p.offs) if (o.rtt < best.rtt) best = o;
        this.clockOffset = best.off;
      }
      if (p.count === 1 || p.count % 5 === 0) this.log('PING ' + Math.round(rtt) + 'ms (avg ' + Math.round(this.pingAvg) + ')');
      this.emit('ping', rtt);
    }

    // Online Phase 2：操作実験のメッセージを送る（接続中のみ）。送ったバイト数を返す
    sendGame(obj) {
      if (this.state !== 'connected') return false;
      return this.sendMsg(obj);
    }

    // ---------------- 入力送信テスト ----------------
    sendTest(key) {
      if (this.state !== 'connected' || !P.TEST_KEYS.includes(key)) return false;
      if (!this.sendMsg({ t: 'in', k: key })) return false;
      this.log('SEND ' + key);
      this.emit('test-sent', key);
      return true;
    }

    // ---------------- 連続通信テスト（送信側） ----------------
    startBurst() {
      if (this.state !== 'connected' || this.out) return false;
      const gen = this.gen;
      const hz = CFG.burstHz;
      const n = hz * CFG.burstSeconds;
      const o = this.out = {
        id: ++this.burstId, n, hz, sent: 0, t0: now(), sendTimes: new Float64Array(n), acked: new Uint8Array(n),
        rtts: [], payloadBytes: 0, ctrlBytes: 0, wireStart: null, endSent: false, endAt: 0, finished: false, hiddenDuring: false,
      };
      this.readRoute(false).then(() => { if (this.route && this.route.bytesSent != null) o.wireStart = this.route.bytesSent; });
      o.ctrlBytes += this.sendMsg({ t: 'bs', id: o.id, n, hz }) || 0;
      this.log('BURST start: ' + n + ' packets @' + hz + '/s');
      o.timer = setInterval(() => { if (gen === this.gen && this.out === o) this.burstTick(o); }, Math.max(4, Math.floor(1000 / hz / 2)));
      this.burstTick(o);
      this.emit('burst-progress', this.burstProgress());
      return true;
    }

    burstTick(o) {
      if (this.state !== 'connected') return;
      if (typeof document !== 'undefined' && document.hidden) o.hiddenDuring = true;
      const t = now();
      const due = Math.min(o.n, Math.floor((t - o.t0) / (1000 / o.hz)) + 1);
      while (o.sent < due) {
        const s = o.sent;
        // 小さな入力状態（LEFT / RIGHT / JUMP のビット）を模したダミー
        const b = ((s >> 3) & 3) | ((s % 17 === 0) ? 4 : 0);
        o.sendTimes[s] = now();
        const bytes = this.sendMsg({ t: 'bp', id: o.id, s, ts: Math.round(o.sendTimes[s] * 10) / 10, b });
        if (!bytes) break;
        o.payloadBytes += bytes;
        o.sent++;
      }
      if (o.sent >= o.n && !o.endSent) {
        o.endSent = true;
        o.endAt = now();
        clearInterval(o.timer);
        o.timer = null;
        o.ctrlBytes += this.sendMsg({ t: 'be', id: o.id, sent: o.sent }) || 0;
        this.later(() => this.finishBurst(o, 'no report from peer'), CFG.burstFinishWaitMs, this.gen);
      }
      this.emit('burst-progress', this.burstProgress());
    }

    burstProgress() {
      const o = this.out;
      return o ? { sent: o.sent, n: o.n, acks: o.rtts.length, waiting: o.endSent } : null;
    }

    onBurstAck(msg) {
      const o = this.out;
      if (!o || msg.id !== o.id || msg.s >= o.sent || o.acked[msg.s]) return;
      o.acked[msg.s] = 1;
      o.rtts.push(now() - o.sendTimes[msg.s]);
    }

    onBurstReport(msg) {
      const o = this.out;
      if (!o || msg.id !== o.id) return;
      o.report = msg;
      // 最後の受信確認（ba）が届くのを少しだけ待ってから集計
      this.later(() => this.finishBurst(o, null), 300, this.gen);
    }

    async finishBurst(o, note) {
      if (o.finished || this.out !== o) return;
      o.finished = true;
      this.out = null;
      await this.readRoute(false);
      const r = o.rtts;
      const avg = r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
      const max = r.length ? Math.max.apply(null, r) : null;
      const wireEnd = this.route && this.route.bytesSent;
      const res = {
        id: o.id,
        sent: o.sent, planned: o.n,
        recv: o.report ? o.report.r : null,
        lost: o.report ? o.report.l : null,
        reorder: o.report ? o.report.o : null,
        dup: o.report ? o.report.d : null,
        acks: r.length,
        rttAvg: avg, rttMax: max,
        oneWayAvg: avg != null ? avg / 2 : null, oneWayMax: max != null ? max / 2 : null,
        payloadBytes: o.payloadBytes,
        avgPacketBytes: o.sent ? o.payloadBytes / o.sent : 0,
        wireBytes: (o.wireStart != null && wireEnd != null) ? wireEnd - o.wireStart : null,
        durationMs: (o.endAt || now()) - o.t0,
        hiddenDuring: o.hiddenDuring,
        note,
      };
      this.log('BURST done: sent ' + res.sent + ', peer recv ' + (res.recv == null ? '?' : res.recv) +
        ', lost ' + (res.lost == null ? '?' : res.lost) + ', reorder ' + (res.reorder == null ? '?' : res.reorder) +
        ', RTT avg ' + (avg == null ? '-' : Math.round(avg)) + 'ms max ' + (max == null ? '-' : Math.round(max)) + 'ms' + (note ? ' (' + note + ')' : ''));
      this.emit('burst-result', res);
    }

    // ---------------- 連続通信テスト（受信側） ----------------
    onBurstStart(msg) {
      if (this.inb) this.finishIncoming(this.inb);
      const gen = this.gen;
      const ib = this.inb = { id: msg.id, n: msg.n, hz: msg.hz, recv: 0, seen: new Uint8Array(msg.n), maxS: -1, reorder: 0, dup: 0, t0: now(), endSent: null, done: false };
      this.log('BURST incoming: ' + msg.n + ' packets @' + msg.hz + '/s');
      // 「終了」が届かなくても、予定時間 + 余裕で締める
      this.later(() => this.finishIncoming(ib), (msg.n / msg.hz) * 1000 + 6000, gen);
      this.emit('burst-in', { recv: 0, n: ib.n, done: false });
    }
    onBurstPacket(msg) {
      const ib = this.inb;
      if (!ib || ib.done || msg.id !== ib.id || msg.s >= ib.n) { this.stats.dropped++; return; }
      if (ib.seen[msg.s]) ib.dup++;
      else {
        ib.seen[msg.s] = 1;
        ib.recv++;
        if (msg.s < ib.maxS) ib.reorder++; else ib.maxS = msg.s;
      }
      this.sendMsg({ t: 'ba', id: msg.id, s: msg.s });
      if (ib.recv % 15 === 0) this.emit('burst-in', { recv: ib.recv, n: ib.n, done: false });
    }
    onBurstEnd(msg) {
      const ib = this.inb;
      if (!ib || msg.id !== ib.id) return;
      ib.endSent = msg.sent;
      // 順序保証なしの設定でも遅れて届くパケットを数えられるよう、少し待ってから集計
      this.later(() => this.finishIncoming(ib), 1000, this.gen);
    }
    finishIncoming(ib) {
      if (ib.done) return;
      ib.done = true;
      if (this.inb === ib) this.inb = null;
      const expected = ib.endSent != null ? ib.endSent : ib.n;
      const lost = Math.max(0, expected - ib.recv);
      this.sendMsg({ t: 'br', id: ib.id, r: ib.recv, l: lost, o: ib.reorder, d: ib.dup });
      const res = { recv: ib.recv, n: ib.n, expected, lost, reorder: ib.reorder, dup: ib.dup, done: true, durationMs: now() - ib.t0 };
      this.log('BURST received: ' + ib.recv + '/' + expected + ', lost ' + lost + ', reorder ' + ib.reorder);
      this.emit('burst-in', res);
    }

    // ---------------- 経路・診断（getStats） ----------------
    async readRoute(logIt) {
      const conn = this.conn;
      const pc = conn && conn.peerConnection;
      if (!pc || typeof pc.getStats !== 'function') return;
      let stats;
      try { stats = await pc.getStats(); } catch (_) { return; }
      if (conn !== this.conn) return;
      let pair = null;
      stats.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId && stats.get(r.selectedCandidatePairId)) pair = stats.get(r.selectedCandidatePairId); });
      if (!pair) stats.forEach((r) => { if (!pair && r.type === 'candidate-pair' && (r.selected || r.nominated) && r.state === 'succeeded') pair = r; });
      if (!pair) return;
      const l = stats.get(pair.localCandidateId) || {};
      const rm = stats.get(pair.remoteCandidateId) || {};
      const prev = this.route;
      this.route = {
        local: l.candidateType || '?', remote: rm.candidateType || '?',
        protocol: l.protocol || '?', relayProtocol: l.relayProtocol || null,
        rtt: typeof pair.currentRoundTripTime === 'number' ? pair.currentRoundTripTime * 1000 : null,
        bytesSent: typeof pair.bytesSent === 'number' ? pair.bytesSent : null,
        bytesReceived: typeof pair.bytesReceived === 'number' ? pair.bytesReceived : null,
      };
      const changed = !prev || prev.local !== this.route.local || prev.remote !== this.route.remote || prev.protocol !== this.route.protocol;
      if (changed) this.log('route: ' + this.routeLabel() + ' (local ' + this.route.local + ' / remote ' + this.route.remote + ' / ' + this.route.protocol + ')');
      this.emit('update');
    }

    // 経路の種類（host = 同じネットワーク内で直接 / srflx・prflx = NAT 越しに直接 / relay = TURN 中継）
    routeKind() {
      const r = this.route;
      if (!r) return null;
      if (r.local === 'relay' || r.remote === 'relay') return 'relay';
      if (r.local === 'host' && r.remote === 'host') return 'host';
      return 'p2p';
    }
    routeLabel() {
      const k = this.routeKind();
      return k === 'relay' ? 'TURN relay' : k === 'host' ? 'direct (LAN)' : k === 'p2p' ? 'direct (NAT traversal)' : '-';
    }

    // つながらなかった時に、TURN が無いことによる NAT 越え失敗か、それ以外かを見分けるための情報をログに残す
    async diagnoseFailure(conn) {
      const pc = conn && conn.peerConnection;
      if (!pc || typeof pc.getStats !== 'function') { this.log('diag: no RTCPeerConnection (offer never reached ICE stage)', 'warn'); return; }
      try {
        const stats = await pc.getStats();
        const local = new Set(), remote = new Set();
        const pairs = {};
        stats.forEach((r) => {
          if (r.type === 'local-candidate') local.add(r.candidateType + '/' + r.protocol);
          if (r.type === 'remote-candidate') remote.add(r.candidateType + '/' + r.protocol);
          if (r.type === 'candidate-pair') pairs[r.state] = (pairs[r.state] || 0) + 1;
        });
        this.log('diag: ICE ' + pc.iceConnectionState + ', gathering ' + pc.iceGatheringState +
          ', local [' + Array.from(local).join(' ') + '], remote [' + Array.from(remote).join(' ') + '], pairs ' + JSON.stringify(pairs), 'warn');
        const hasRelay = Array.from(local).some((c) => c.startsWith('relay'));
        if (!remote.size) this.log('diag: no remote candidates → signaling/offer did not complete (not a NAT issue)', 'warn');
        else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'checking') {
          this.log('diag: candidates exchanged but no path worked → likely NAT/firewall needing TURN' + (hasRelay ? ' (relay candidate existed but failed)' : ' (no usable relay candidate)'), 'warn');
        }
      } catch (err) {
        this.log('diag failed: ' + (err && err.message), 'warn');
      }
    }

    // ---------------- 定期処理（250ms ごと） ----------------
    tick() {
      if (this.state === 'connected') {
        const since = this.sinceLastRecv;
        if (since != null && since > CFG.deadMs) {
          this.end('timeout', 'no data for ' + Math.round(since / 1000) + 's');
          return;
        }
      }
      this.emit('tick');
    }

    // ---------------- 終了 ----------------
    fail(reason, detail) {
      if (this.state === 'failed' || this.state === 'closed') return;
      this.log('FAILED [' + reason + ']: ' + (detail || ''), 'error');
      this.teardown(true);
      this.endReason = reason;
      this.endDetail = detail || '';
      this.setState('failed');
    }
    end(reason, detail) {
      if (this.state === 'failed' || this.state === 'closed') return;
      this.log('connection closed [' + reason + ']' + (detail ? ': ' + detail : ''), reason === 'user' ? 'info' : 'warn');
      this.teardown(reason === 'user' || reason === 'unload');
      this.endReason = reason;
      this.endDetail = detail || '';
      this.setState('closed');
    }

    // 自分から閉じる（切断ボタン・画面を離れる・ページを閉じる）。silent = 状態を変えずに片付けだけ
    close(reason, silent) {
      if (silent) { this.teardown(true); return; }
      if (!this.active) { this.teardown(false); return; }
      if (this.state === 'connected') this.end(reason || 'user');
      else this.fail(reason || 'user', 'cancelled');
    }

    // 通信リソースをすべて閉じる。sayBye = 相手に切断を知らせる
    teardown(sayBye) {
      const conn = this.conn, peer = this.peer;
      if (sayBye && conn && conn.open && this.handshaken) {
        try { conn.send(P.encode({ t: 'bye' })); } catch (_) { /* noop */ }
      }
      this.gen++;                 // これ以降に届く古いイベントは無視
      this.clearTimers();
      if (this.out) { this.out.finished = true; this.out = null; }
      this.inb = null;
      this.conn = null;
      this.peer = null;
      this.handshaken = false;
      this.signal = '-';
      // bye が先に届くよう、少しだけ遅らせて閉じる（ページを閉じる時は即座に）
      const shut = () => {
        try { if (conn) conn.close(); } catch (_) { /* noop */ }
        try { if (peer && !peer.destroyed) peer.destroy(); } catch (_) { /* noop */ }
      };
      if (sayBye && conn && typeof document !== 'undefined' && document.visibilityState !== 'hidden') setTimeout(shut, 120); else shut();
    }

    // ログのコピー用テキスト
    reportText() {
      const p = this.ping;
      const lines = [
        'コタロの大格闘 Online — 通信実験ログ',
        'time: ' + new Date().toISOString(),
        'ua: ' + navigator.userAgent,
        'role: ' + (this.role || '-') + '  code: ' + (this.displayCode || '-') + '  state: ' + this.state + (this.endReason ? ' (' + this.endReason + ')' : ''),
        'signal: ' + this.signal + '  ICE: ' + this.iceState + '  DC: ' + this.dataChannelState + '  route: ' + this.routeLabel() +
          (this.route ? ' [' + this.route.local + '/' + this.route.remote + '/' + this.route.protocol + ']' : ''),
        'ping last ' + fmt(p.last) + ' avg ' + fmt(this.pingAvg) + ' min ' + fmt(p.min) + ' max ' + fmt(p.max) + ' (n=' + p.count + ')',
        'packets sent ' + this.stats.sent + ' recv ' + this.stats.recv + ' dropped ' + this.stats.dropped,
        '--- log ---',
      ];
      for (const e of this.fullLog) lines.push(e.stamp + ' ' + e.text);
      return lines.join('\n');
    }
  }

  function fmt(v) { return v == null ? '-' : Math.round(v) + 'ms'; }

  KG.NetSession = NetSession;
  KG.NetSession.CONFIG = CFG;
})(window.KG = window.KG || {});
