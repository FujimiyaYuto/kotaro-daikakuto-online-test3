/*
 * online-ui.js — オンライン実験（Online Phase 1）の画面
 *
 * タイトル画面の「オンライン実験」ボタンから開く、ゲームとは独立したオーバーレイ画面です。
 *   メニュー（ルームを作る / ルームに参加 / 戻る）→ 接続画面（状態・診断・通信テスト・連続通信テスト・通信ログ）
 *
 * ゲーム本体には次のことしかしません：
 *   - 開けるのはタイトル画面（game.phase === 'title'）の時だけ
 *   - 開いている間はキー入力をゲームへ渡さない（window の capture 段階で止める）
 *   - 開く時に押しっぱなし入力を解除する
 * 相手から届いた文字列は表示しません（表示するのは検証済みの決まった値だけ。すべて textContent）。
 */
(function (KG) {
  'use strict';

  const P = KG.NetProtocol;

  // 画面に出す文言（内部の理由コード → 日本語）
  const REASON_TEXT = {
    'user': '切断しました。',
    'unload': 'ページを離れました。',
    'remote-bye': '相手が切断しました。',
    'remote-closed': '相手との通信が切れました。',
    'timeout': '相手からの応答がなくなりました（ページを閉じた・回線が切れた可能性があります）。',
    'ice-failed': '相手と直接つながれませんでした。回線やルーターの設定によっては接続できない場合があります。別の回線（Wi-Fi／モバイル回線）でもお試しください。',
    'peer-unavailable': 'ルームが見つかりません。コードが正しいか、ホストがルームを開いたままか確認してください。',
    'server': '接続サーバーにつながりませんでした。ネットワーク接続を確認して、少し待ってからお試しください。',
    'browser': 'このブラウザは通信機能（WebRTC）に対応していないようです。',
    'id-exhausted': 'ルームコードを作れませんでした。もう一度お試しください。',
    'reject-full': 'このルームにはすでに他の人が参加しています。',
    'reject-version': 'ゲームのバージョンが違うため接続できません。両方のページを再読み込みしてください。',
    'handshake-timeout': '相手から応答がありませんでした。',
    'connect-timeout': '時間内に接続できませんでした。コードを確認して、もう一度お試しください。',
    'no-peerjs': '通信ライブラリを読み込めませんでした。ネットワーク接続を確認して、ページを再読み込みしてください。',
    'error': '接続中にエラーが発生しました。',
  };
  const SIGNAL_TEXT = { '-': '-', connecting: '接続中…', open: '接続済み', disconnected: '切断（データ通信は継続）', closed: '終了', error: 'エラー' };
  const DC_TEXT = { '-': '-', connecting: '準備中', open: 'open', closing: '終了中', closed: 'closed' };
  const ROUTE_TEXT = { relay: 'TURN中継', host: '直接（同じネットワーク）', p2p: '直接（NAT越え）' };
  // 操作実験中にゲームへ渡さないキー（R = 開発用リセット / Enter / 攻撃・必殺・泡・ガード）
  const TEST_BLOCKED_KEYS = new Set(['KeyR', 'Enter', 'NumpadEnter', 'KeyJ', 'KeyK', 'KeyL', 'KeyI']);
  const MOVE_END_TEXT = {
    'user': '操作実験を終了しました。',
    'remote-user': '相手が操作実験を終了しました。',
    'remote-timeout': '開始できませんでした（相手の応答なし）。',
    'remote-error': '相手側でエラーが起きたため終了しました。',
  };
  const KEY_TO_TEST = { KeyA: 'LEFT', ArrowLeft: 'LEFT', KeyD: 'RIGHT', ArrowRight: 'RIGHT', Space: 'JUMP' };

  const ms = (v) => v == null ? '-' : Math.round(v) + ' ms';
  const bytesText = (b) => b == null ? '-' : b < 1024 ? b + ' B' : (b / 1024).toFixed(1) + ' KB';

  const TEMPLATE = `
  <div class="ol-panel">
    <header class="ol-head">
      <h2 class="ol-title">オンライン実験 <span class="ol-tag">TEST</span></h2>
      <p class="ol-sub">2つのブラウザをつなぐ通信テストです。対戦はまだできません。</p>
    </header>

    <div class="ol-view" data-view="menu">
      <div class="ol-menu">
        <button type="button" class="menu-btn primary" data-act="host">ルームを作る</button>
        <button type="button" class="menu-btn primary" data-act="join-view">ルームに参加</button>
        <button type="button" class="menu-btn ghost" data-act="exit">戻る</button>
      </div>
      <p class="ol-note">通信には PeerJS の公開サーバー（接続の仲介のみ）を使います。アカウント登録は不要です。</p>
    </div>

    <div class="ol-view" data-view="join" hidden>
      <form class="ol-join" novalidate>
        <label class="ol-label" for="ol-code">ルームコード（4桁の数字）</label>
        <div class="ol-code-input">
          <span class="ol-code-prefix" aria-hidden="true">KOTA-</span>
          <input id="ol-code" name="code" type="text" inputmode="numeric" maxlength="12" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="3812">
        </div>
        <p class="ol-error" aria-live="polite"></p>
        <div class="ol-row">
          <button type="button" class="menu-btn ghost" data-act="menu">戻る</button>
          <button type="submit" class="menu-btn primary" data-act="join">接続</button>
        </div>
      </form>
    </div>

    <div class="ol-view" data-view="session" hidden>
      <div class="ol-status" data-kind="busy" aria-live="polite">
        <span class="ol-dot" aria-hidden="true"></span>
        <span class="ol-status-text"></span>
        <span class="ol-role" hidden></span>
      </div>
      <p class="ol-status-detail"></p>

      <div class="ol-room" hidden>
        <span class="ol-room-label">ルームコード</span>
        <strong class="ol-room-code"></strong>
        <button type="button" class="ol-mini" data-act="copy-code">コピー</button>
      </div>

      <!-- Online Phase 2：遠隔プレイヤーによるキャラクター操作実験 -->
      <div class="ol-move" hidden>
        <div class="ol-move-text">
          <strong>操作実験（Online Phase 2）</strong>
          <span class="ol-move-sub"></span>
          <span class="ol-move-note" hidden></span>
        </div>
        <button type="button" class="menu-btn primary ol-move-btn" data-act="move-start">操作実験を開始</button>
      </div>

      <div class="ol-grid">
        <section class="ol-card ol-test" aria-label="通信テスト">
          <h3>通信テスト</h3>
          <p class="ol-hint">押すと相手へテスト信号を送ります（キャラクターは動きません）<span class="ol-pc-only"><br>PC：<kbd>A</kbd> LEFT　<kbd>D</kbd> RIGHT　<kbd>Space</kbd> JUMP</span></p>
          <div class="ol-test-btns">
            <button type="button" class="ol-tbtn" data-test="LEFT">LEFT</button>
            <button type="button" class="ol-tbtn" data-test="RIGHT">RIGHT</button>
            <button type="button" class="ol-tbtn" data-test="JUMP">JUMP</button>
          </div>
          <div class="ol-test-io">
            <p class="ol-recv">受信：<strong data-recv>-</strong></p>
            <p class="ol-sent">送信：<span data-sent>-</span></p>
          </div>
        </section>

        <section class="ol-card ol-burst" aria-label="連続通信テスト">
          <h3>連続通信テスト</h3>
          <p class="ol-hint">毎秒30回 × 10秒（300パケット）の小さなデータを相手へ送り、届き方を測ります。</p>
          <button type="button" class="menu-btn primary ol-burst-btn" data-act="burst">連続通信テスト開始</button>
          <div class="ol-progress" hidden><div class="ol-bar"><span></span></div><span class="ol-progress-text"></span></div>
          <dl class="ol-dl ol-burst-result" hidden></dl>
          <p class="ol-burst-in" hidden></p>
          <p class="ol-fine">※ この実験の通信は「順序保証・再送あり」の設定です。欠落・順序逆転は通常 0 になりますが、測定値として表示します。</p>
        </section>

        <section class="ol-card ol-diag" aria-label="診断情報">
          <h3>診断情報</h3>
          <dl class="ol-dl" data-diag></dl>
        </section>

        <section class="ol-card ol-logcard" aria-label="通信ログ">
          <div class="ol-card-head">
            <h3>通信ログ（直近20件）</h3>
            <button type="button" class="ol-mini" data-act="copy-log">ログをコピー</button>
          </div>
          <ol class="ol-log"></ol>
        </section>
      </div>

      <div class="ol-actions">
        <button type="button" class="menu-btn ghost" data-act="disconnect">切断</button>
        <button type="button" class="menu-btn primary" data-act="menu" hidden>メニューへ戻る</button>
      </div>
    </div>
  </div>`;

  class OnlineExperimentUI {
    constructor() {
      const params = new URLSearchParams(location.search);
      this.session = new KG.NetSession({
        iceMode: params.has('stunonly') ? 'stun-only' : 'default',   // 開発用：?stunonly で PeerJS の TURN を使わない
        peerDebug: params.has('netdebug') ? 3 : 1,                    // 開発用：?netdebug で PeerJS の詳細ログをコンソールへ
      });
      this.view = 'menu';
      this.isOpen = false;
      this.sentCount = 0;
      this.recvCount = 0;
      this.lastBurst = null;
      this.build();
      this.bindSession();
      this.bindKeys();
      this.mode = null;          // 'test' = 操作実験中（この画面は隠し、ゲーム画面を表示）
      this.moveNote = '';
      this.move = new KG.OnlineMoveTest(this.session, {
        onStarting: () => { this.moveNote = ''; this.render(); },
        onStartFailed: () => { this.moveNote = 'GUESTから応答がなかったため開始できませんでした。もう一度お試しください。'; this.render(); },
        onStart: () => this.enterTest(),
        onStop: (reason, wasActive) => this.exitTest(reason, wasActive),
      });
      window.addEventListener('pagehide', () => { if (this.session.active) this.session.close('unload'); });
    }

    // ---------------- DOM ----------------
    build() {
      const root = document.getElementById('game-root') || document.body;
      const el = this.el = document.createElement('section');
      el.id = 'online-screen';
      el.className = 'online-screen';
      el.hidden = true;
      el.setAttribute('aria-label', 'オンライン実験');
      el.innerHTML = TEMPLATE;   // 固定の文言のみ（相手からのデータは入れない）
      root.appendChild(el);

      const q = (s) => el.querySelector(s);
      this.$ = {
        views: el.querySelectorAll('.ol-view'),
        form: q('.ol-join'), input: q('#ol-code'), joinError: q('.ol-error'),
        status: q('.ol-status'), statusText: q('.ol-status-text'), role: q('.ol-role'), detail: q('.ol-status-detail'),
        room: q('.ol-room'), roomCode: q('.ol-room-code'),
        diag: q('[data-diag]'),
        testCard: q('.ol-test'), testBtns: el.querySelectorAll('.ol-tbtn'), recv: q('[data-recv]'), sent: q('[data-sent]'),
        burstCard: q('.ol-burst'), burstBtn: q('.ol-burst-btn'), progress: q('.ol-progress'), progressBar: q('.ol-bar span'),
        progressText: q('.ol-progress-text'), burstResult: q('.ol-burst-result'), burstIn: q('.ol-burst-in'),
        log: q('.ol-log'),
        disconnect: q('[data-act="disconnect"]'), backMenu: q('.ol-actions [data-act="menu"]'),
        move: q('.ol-move'), moveBtn: q('.ol-move-btn'), moveSub: q('.ol-move-sub'), moveNote: q('.ol-move-note'),
      };

      // 診断の行（値だけを後で書き換える）
      this.diagRows = {};
      for (const [key, label] of [
        ['role', '役割'], ['state', '状態'], ['signal', '接続サーバー'], ['dc', 'DataChannel'], ['ice', 'ICE'], ['route', '経路'],
        ['ping', 'PING'], ['avg', '平均PING（直近10回）'], ['minmax', '最小 / 最大'], ['last', '最終受信'],
        ['packets', '送信 / 受信パケット'], ['bytes', '送信 / 受信量'], ['dropped', '破棄したデータ'],
      ]) {
        const dt = document.createElement('dt'); dt.textContent = label;
        const dd = document.createElement('dd'); dd.textContent = '-';
        this.$.diag.append(dt, dd);
        this.diagRows[key] = dd;
      }
      if (this.session.iceMode === 'stun-only') {
        const dt = document.createElement('dt'); dt.textContent = 'ICE設定';
        const dd = document.createElement('dd'); dd.textContent = 'STUNのみ（TURNなし）';
        this.$.diag.append(dt, dd);
      }

      // スマホ：ゲーム側が document で touchstart / touchmove を止めているので、この画面の中では止めない
      // （入力欄にフォーカスできる・ログをスクロールできる・ボタンの click が届く）
      for (const ev of ['touchstart', 'touchmove', 'selectstart', 'gesturestart']) {
        el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
      }

      // ボタン
      el.querySelectorAll('[data-act]').forEach((b) => this.bindButton(b, () => this.onAction(b.dataset.act)));
      this.$.form.addEventListener('submit', (e) => { e.preventDefault(); this.onAction('join'); });
      // テストボタンは「押した瞬間」に送る
      this.$.testBtns.forEach((b) => {
        b.addEventListener('pointerdown', (e) => {
          if (e.button > 0) return;
          this.sendTest(b.dataset.test);
          b.classList.add('is-down');
        });
        const up = () => b.classList.remove('is-down');
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
        b.addEventListener('pointerleave', up);
        b.addEventListener('click', (e) => { if (e.detail === 0) this.sendTest(b.dataset.test); }); // キーボード（Tab → Enter）
      });
      this.$.input.addEventListener('input', () => { this.$.joinError.textContent = ''; });
    }

    // メニューと同じ方式：同じボタンの上で押して離した時だけ反応（スクロール開始時は pointercancel で取り消し）
    bindButton(el, fn) {
      if (el.type === 'submit') {
        el.addEventListener('click', (e) => { e.preventDefault(); fn(); });
        return;
      }
      el.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        el._armed = e.pointerId;
        el.classList.add('is-down');
      });
      const disarm = () => { el._armed = null; el.classList.remove('is-down'); };
      el.addEventListener('pointerup', (e) => {
        const ok = el._armed === e.pointerId;
        disarm();
        if (ok && !el.disabled) fn();
      });
      el.addEventListener('pointercancel', disarm);
      el.addEventListener('pointerleave', disarm);
      el.addEventListener('click', (e) => { if (e.detail === 0 && !el.disabled) fn(); }); // キーボード操作
    }

    sfx(name) { try { if (KG.sound) KG.sound.play(name); } catch (_) { /* noop */ } }

    // ---------------- 開く / 閉じる ----------------
    open() {
      const game = KG.game;
      if (this.isOpen || !game || game.phase !== 'title') return false;
      this.isOpen = true;
      this.releaseGameInput();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      document.body.dataset.online = 'open';
      this.el.hidden = false;
      this.showView('menu');
      return true;
    }

    // ---------------- 操作実験（Phase 2）の画面切り替え ----------------
    enterTest() {
      this.mode = 'test';
      this.el.hidden = true;                  // ゲーム画面を見せる（接続は維持）
      delete document.body.dataset.online;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }

    exitTest(reason, wasActive) {
      this.mode = null;
      if (wasActive || reason !== 'disconnect') this.moveNote = MOVE_END_TEXT[reason] || '';
      if (reason === 'disconnect') this.moveNote = '';
      if (this.isOpen) {
        this.el.hidden = false;
        document.body.dataset.online = 'open';
        this.showView('session');
        this.renderLog();
      }
    }

    exit() {
      this.session.close('user');      // 接続を残さない（Peer / DataConnection を閉じる）
      this.isOpen = false;
      this.el.hidden = true;
      delete document.body.dataset.online;
      this.releaseGameInput();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }

    releaseGameInput() {
      const g = KG.game;
      try { g.keyboard.reset(); g.input.releaseAll(); g.input.poll(); } catch (_) { /* noop */ }
    }

    showView(v) {
      this.view = v;
      this.$.views.forEach((x) => { x.hidden = x.dataset.view !== v; });
      if (v === 'join') {
        this.$.joinError.textContent = '';
        // スマホではキーボードが画面を覆うので自動フォーカスは PC だけ
        if (!(window.matchMedia && matchMedia('(pointer: coarse)').matches)) setTimeout(() => this.$.input.focus(), 30);
      }
      if (v === 'session') this.render();
      this.el.scrollTop = 0;
    }

    onAction(act) {
      const s = this.session;
      switch (act) {
        case 'host':
          this.sfx('confirm');
          this.resetSessionView();
          this.showView('session');
          s.host();
          break;
        case 'join-view':
          this.sfx('confirm');
          this.showView('join');
          break;
        case 'join': {
          const code = P.parseCode(this.$.input.value);
          if (!code) {
            this.sfx('back');
            this.$.joinError.textContent = '4桁の数字を入力してください（例：3812）';
            return;
          }
          this.sfx('confirm');
          this.$.input.blur();
          this.resetSessionView();
          this.showView('session');
          s.join(code);
          break;
        }
        case 'menu':
          this.sfx('back');
          s.close('user');
          this.showView('menu');
          break;
        case 'exit':
          this.sfx('back');
          this.exit();
          break;
        case 'disconnect':
          this.sfx('back');
          s.close('user');
          break;
        case 'burst':
          if (s.startBurst()) {
            this.sfx('select');
            this.lastBurst = null;
            this.$.burstResult.hidden = true;
          }
          this.render();
          break;
        case 'move-start':
          if (this.move.requestStart()) this.sfx('confirm');
          this.render();
          break;
        case 'copy-code':
          this.copyText(s.displayCode, '[data-act="copy-code"]');
          break;
        case 'copy-log':
          this.copyText(s.reportText(), '[data-act="copy-log"]');
          break;
      }
    }

    resetSessionView() {
      this.moveNote = '';
      this.sentCount = 0;
      this.recvCount = 0;
      this.lastBurst = null;
      this.$.recv.textContent = '-';
      this.$.sent.textContent = '-';
      this.$.burstResult.hidden = true;
      this.$.burstResult.textContent = '';
      this.$.burstIn.hidden = true;
      this.$.progress.hidden = true;
    }

    async copyText(text, btnSel) {
      const btn = this.el.querySelector(btnSel);
      let ok = false;
      try {
        if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; }
      } catch (_) { /* fallback below */ }
      if (!ok) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        this.el.appendChild(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
        ta.remove();
      }
      if (btn) {
        const orig = btn.dataset.label || (btn.dataset.label = btn.textContent);
        btn.textContent = ok ? 'コピーしました' : 'コピーできません';
        setTimeout(() => { btn.textContent = orig; }, 1400);
      }
    }

    sendTest(key) {
      if (this.session.sendTest(key)) {
        this.sentCount++;
        this.$.sent.textContent = key + '（' + this.sentCount + '回）';
      }
    }

    // ---------------- キー操作 ----------------
    bindKeys() {
      // capture 段階で受け、開いている間はゲーム側（KeyboardSource・メニュー・開発用キー）へ渡さない
      window.addEventListener('keydown', (e) => {
        if (!this.isOpen) return;
        if (this.mode === 'test') {
          // 操作実験中：移動・ジャンプのキーはゲームへそのまま渡す。リセット（R）・決定・攻撃系のキーだけ止める
          if (TEST_BLOCKED_KEYS.has(e.code)) { e.stopPropagation(); e.preventDefault(); }
          return;
        }
        e.stopPropagation();
        const inInput = e.target === this.$.input;
        if (e.code === 'Escape') {
          e.preventDefault();
          if (this.view === 'join') this.onAction('menu');
          else if (this.view === 'menu') this.onAction('exit');
          else if (!this.session.active) this.onAction('menu');
          return;
        }
        if (inInput) return;   // 入力欄の文字入力・Enter（送信）はそのまま
        const test = KEY_TO_TEST[e.code];
        if (test && this.view === 'session') {
          e.preventDefault();      // Space のスクロール・ボタン誤押下を防ぐ
          if (!e.repeat) this.sendTest(test);
        }
      }, true);
      window.addEventListener('keyup', (e) => { if (this.isOpen && this.mode !== 'test') e.stopPropagation(); }, true);
    }

    // ---------------- セッションの表示 ----------------
    bindSession() {
      const s = this.session;
      const r = () => { if (this.isOpen && this.view === 'session') this.render(); };
      s.on('state', (st) => {
        if (st === 'connected') this.sfx('confirm');
        // 待機中に取り消した時（戻る）はメニューへ。それ以外はこの画面で結果を表示
        r();
      });
      s.on('update', r);
      s.on('tick', r);
      s.on('ping', r);
      s.on('log', () => this.renderLog());
      s.on('test-recv', (key) => {
        this.recvCount++;
        this.$.recv.textContent = key;
        const box = this.$.recv;
        box.classList.remove('flash');
        void box.offsetWidth;  // アニメーションをやり直す
        box.classList.add('flash');
        this.$.recv.parentElement.dataset.count = String(this.recvCount);
      });
      s.on('burst-progress', (p) => this.renderBurstProgress(p));
      s.on('burst-result', (res) => { this.lastBurst = res; this.renderBurstResult(res); r(); });
      s.on('burst-in', (p) => this.renderBurstIn(p));
    }

    render() {
      const s = this.session;
      const $ = this.$;
      const st = s.state;
      let text = '', kind = 'busy', detail = '';
      switch (st) {
        case 'idle': text = '接続待機中'; break;
        case 'creating': text = 'ルームを作成しています…'; break;
        case 'waiting': text = '接続待機中'; kind = 'wait'; detail = '参加する人に下のルームコードを伝えてください。'; break;
        case 'connecting': text = '接続しています…'; detail = s.role === 'HOST' ? '参加者を確認しています。' : 'ルーム ' + s.displayCode + ' へ接続しています。'; break;
        case 'connected':
          text = '接続しました'; kind = s.isStale ? 'warn' : 'ok';
          detail = s.isStale ? '相手からの応答が遅れています…' : '接続成功。通信テストができます。';
          break;
        case 'closed': text = '接続が切れました'; kind = 'bad'; detail = REASON_TEXT[s.endReason] || ''; break;
        case 'failed':
          text = s.endReason === 'user' ? '接続を取り消しました' : '接続に失敗しました';
          kind = s.endReason === 'user' ? 'wait' : 'bad';
          detail = s.endReason === 'user' ? '' : (REASON_TEXT[s.endReason] || REASON_TEXT.error);
          break;
      }
      if (st === 'closed' || (st === 'failed' && s.endReason !== 'user')) detail += ' もう一度ルームを作る／参加するには「メニューへ戻る」を押してください。';
      setText($.statusText, text);
      $.status.dataset.kind = kind;
      setText($.detail, detail);
      $.role.hidden = !s.role || st !== 'connected';
      setText($.role, s.role || '');

      // ルームコード（HOST の待機中・接続中）
      const showRoom = s.role === 'HOST' && !!s.code && (st === 'waiting' || st === 'connecting' || st === 'connected');
      $.room.hidden = !showRoom;
      if (showRoom) setText($.roomCode, s.displayCode);

      // 診断
      const d = this.diagRows;
      const p = s.ping;
      setText(d.role, s.role || '-');
      setText(d.state, st);
      setText(d.signal, SIGNAL_TEXT[s.signal] || s.signal);
      setText(d.dc, DC_TEXT[s.dataChannelState] || s.dataChannelState);
      setText(d.ice, s.iceState);
      const rk = s.routeKind();
      setText(d.route, rk ? ROUTE_TEXT[rk] + '（' + s.route.local + ' / ' + s.route.remote + ' / ' + s.route.protocol + '）' : '-');
      setText(d.ping, p.last == null ? '-' : 'PING ' + Math.round(p.last) + ' ms');
      setText(d.avg, ms(s.pingAvg));
      setText(d.minmax, p.min == null ? '-' : ms(p.min) + ' / ' + ms(p.max));
      const since = s.sinceLastRecv;
      setText(d.last, since == null || !s.active ? '-' : (since / 1000).toFixed(1) + ' 秒前');
      d.last.classList.toggle('is-warn', !!s.isStale);
      setText(d.packets, s.stats.sent + ' / ' + s.stats.recv);
      setText(d.bytes, bytesText(s.stats.sentBytes) + ' / ' + bytesText(s.stats.recvBytes));
      setText(d.dropped, String(s.stats.dropped));

      // テスト類は接続中だけ使える
      const connected = st === 'connected';
      $.testCard.classList.toggle('is-disabled', !connected);
      $.burstCard.classList.toggle('is-disabled', !connected);
      $.testBtns.forEach((b) => { b.disabled = !connected; });
      const running = !!s.out;
      $.burstBtn.disabled = !connected || running;
      setText($.burstBtn, running ? '連続通信テスト中…' : '連続通信テスト開始');
      if (!running && !this.lastBurst) $.progress.hidden = true;

      // 操作実験（Phase 2）：接続中だけ。開始ボタンは HOST だけ
      const mv = this.move;
      $.move.hidden = !connected;
      if (connected) {
        const starting = !!(mv && mv.starting);
        $.moveBtn.hidden = s.role !== 'HOST';
        $.moveBtn.disabled = starting;
        setText($.moveBtn, starting ? '相手の準備を待っています…' : '操作実験を開始');
        setText($.moveSub, s.role === 'HOST'
          ? '押すと両方の画面がゲーム画面になります。あなた＝コタロ（いつもの操作）、相手＝ルミポ（相手の入力で動きます）。攻撃はまだできません。'
          : 'HOSTが「操作実験を開始」を押すとゲーム画面に切り替わります。あなたはルミポを左右移動・ジャンプで操作します。');
      }
      $.moveNote.hidden = !this.moveNote;
      setText($.moveNote, this.moveNote);

      // 下のボタン：接続中は「切断」、終わったら「メニューへ戻る」
      const active = s.active;
      $.disconnect.hidden = !active;
      setText($.disconnect, st === 'connected' ? '切断' : 'やめる');
      $.backMenu.hidden = active;
    }

    renderLog() {
      if (!this.isOpen) return;
      const ol = this.$.log;
      const frag = document.createDocumentFragment();
      for (const e of this.session.logs) {
        const li = document.createElement('li');
        li.className = 'lv-' + e.level;
        const t = document.createElement('span');
        t.className = 'ol-log-time';
        t.textContent = e.stamp;
        li.append(t, document.createTextNode(' ' + e.text));
        frag.appendChild(li);
      }
      ol.replaceChildren(frag);
      ol.scrollTop = ol.scrollHeight;
    }

    renderBurstProgress(p) {
      if (!p) return;
      const $ = this.$;
      $.progress.hidden = false;
      $.progressBar.style.width = Math.round((p.sent / p.n) * 100) + '%';
      setText($.progressText, p.waiting ? '送信完了・相手の集計を待っています…' : '送信 ' + p.sent + ' / ' + p.n + '（受信確認 ' + p.acks + '）');
    }

    renderBurstResult(res) {
      const $ = this.$;
      $.progressBar.style.width = '100%';
      setText($.progressText, '完了（' + (res.durationMs / 1000).toFixed(1) + ' 秒）');
      const na = (v) => v == null ? '不明' : String(v);
      const rows = [
        ['送信数', res.sent + ' パケット'],
        ['受信数（相手側）', res.recv == null ? '不明（相手の集計が届かず）' : res.recv + ' パケット'],
        ['欠落数', na(res.lost)],
        ['順序逆転数', na(res.reorder)],
        ['重複', na(res.dup)],
        ['平均遅延（片道の推定）', ms(res.oneWayAvg)],
        ['最大遅延（片道の推定）', ms(res.oneWayMax)],
        ['往復時間 平均 / 最大', ms(res.rttAvg) + ' / ' + ms(res.rttMax) + '（確認 ' + res.acks + ' 件）'],
        ['送信データ量（中身のみ）', bytesText(res.payloadBytes) + '（1パケット約 ' + Math.round(res.avgPacketBytes) + ' B）'],
        ['実際の送信量（暗号化等込み）', res.wireBytes == null ? '取得できず' : bytesText(res.wireBytes) + '（約 ' + (res.wireBytes * 8 / (res.durationMs / 1000) / 1000).toFixed(1) + ' kbps）'],
      ];
      if (res.hiddenDuring) rows.push(['注意', 'テスト中に画面が裏に回ったため、送信間隔が乱れた可能性があります']);
      const frag = document.createDocumentFragment();
      for (const [k, v] of rows) {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        frag.append(dt, dd);
      }
      $.burstResult.replaceChildren(frag);
      $.burstResult.hidden = false;
    }

    renderBurstIn(p) {
      const el = this.$.burstIn;
      el.hidden = false;
      el.textContent = p.done
        ? '相手からの連続通信：受信 ' + p.recv + ' / ' + p.expected + '・欠落 ' + p.lost + '・順序逆転 ' + p.reorder + '・重複 ' + p.dup
        : '相手からの連続通信を受信中… ' + p.recv + ' / ' + p.n;
    }
  }

  function setText(el, t) { if (el.textContent !== t) el.textContent = t; }

  // ---------------- 起動 ----------------
  function init() {
    const ui = new OnlineExperimentUI();
    KG.onlineUI = ui;
    const btn = document.getElementById('btn-online');
    if (btn) ui.bindButton(btn, () => { if (ui.open()) ui.sfx('confirm'); });
    // 開発・配信用：URL に ?online または #online を付けると、起動後すぐにオンライン実験画面を開く
    const params = new URLSearchParams(location.search);
    if (params.has('online') || location.hash === '#online') {
      let tries = 0;
      const t = setInterval(() => { if (ui.open() || ++tries > 100) clearInterval(t); }, 100);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.KG = window.KG || {});
