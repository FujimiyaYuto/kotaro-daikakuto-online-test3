# コタロの大格闘 Online — Online Phase 1 完成報告

「WebRTC による 2 ブラウザ間の接続実験」。オンライン対戦（キャラクター同期など）は実装していません。

## 1. 採用した通信方式
- **WebRTC DataChannel（P2P）**。シグナリング（接続の仲介）は **PeerJS** と、その公開 Cloud PeerServer（`0.peerjs.com`）。
- DataChannel の設定：`reliable: true`（PeerJS 1.5.5 では `ordered: true` になる＝順序保証・再送あり）、`serialization: 'raw'`。
  - `raw` は文字列をそのまま送る方式。受信側は自前で「大きさ → JSON → type → 各値」の順に検証してから使う。
  - 公式ドキュメントでは serialization の値が `none` と書かれているが、1.5.5 のソース（`SerializationType.None = "raw"`、`_serializers` のキー）を確認し、実際に動く `'raw'` を使用。
- サーバー不要の静的サイト構成（GitHub Pages でそのまま動く）。秘密鍵なし。アカウント登録なし。

## 2. PeerJS
| 項目 | 内容 |
|---|---|
| ライブラリ | PeerJS **1.5.5**（2025-06-07 リリース、確認時点の最新安定版。2.0.0 は beta のみ） |
| 読み込み元 | `https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.5/peerjs.min.js`（バージョン固定） |
| SRI | `sha384-x0YgkOr/3UOZP2CRDxGW9e0Q+2Qjyr3uJrm4xU32Y7ZCNAo7Cc7bjhrZMi/dwczu`（実ファイルから計算し、ブラウザで integrity 付き読み込みが通ることを確認） |
| 読み込み方 | `<script async>`。CDN が遅い・落ちていても CPU 対戦の起動は待たない。オンライン実験で使う時に `window.Peer` を最大 10 秒待ち、無ければ「通信ライブラリを読み込めませんでした」 |
| 使用 API | `new Peer(id, {debug})` / `new Peer({debug})`、`peer.on('open'|'connection'|'error'|'disconnected'|'close')`、`peer.connect(id, {reliable, serialization})`、`peer.reconnect()`、`peer.destroy()`、`conn.on('open'|'data'|'close'|'error'|'iceStateChanged')`、`conn.send()`、`conn.close()`、`conn.peerConnection` / `conn.dataChannel` |
| ICE 設定 | PeerJS の既定値のまま（STUN: `stun.l.google.com:19302`、TURN: `eu-0/us-0.turn.peerjs.com`）。`?stunonly` で STUN のみ |

ローカル配置にする場合：`peerjs.min.js` をリポジトリに置き、`index.html` の `src` を差し替え（integrity は同じファイルなら同じ値）。通信コードは `window.Peer` を参照するだけなので他は変更不要。

### 外部サービスへの依存
- `cdnjs.cloudflare.com`（PeerJS ライブラリの配信）
- `0.peerjs.com`（PeerJS 公開シグナリングサーバー。無料・SLA なし。混雑・停止の可能性あり）
- `stun.l.google.com`（STUN。自分の外向きアドレスを知るため）
- `eu-0.turn.peerjs.com` / `us-0.turn.peerjs.com`（PeerJS 既定の TURN。**今回の確認環境では応答がなく、中継候補は得られなかった**。当てにしない前提）
- 対戦データそのもの（Ping・テスト信号）は P2P で直接流れ、サーバーには残らない。

## 3. ルームコードの仕組み
- 表示用：`KOTA-` + 4桁の数字（例 `KOTA-3812`）。数字は `crypto.getRandomValues` で生成。
- 内部の Peer ID：`kotaro-daikakuto-online-exp1-3812`（アプリ固有の長い接頭辞 + 4桁）。他アプリの ID と混ざらない。
- 衝突対策：同じ ID が使用中なら PeerServer が `unavailable-id` を返す → 別の4桁で作り直す（最大 6 回）。ID の一意性はサーバーが保証。
- 入力は `3812` / `KOTA-3812` / `kota3812` / 全角数字 いずれも可（NFKC 正規化）。
- 1 ルーム 1 人まで。2 人目以降は「このルームにはすでに他の人が参加しています」で断る。
- 注意：4桁なので第三者が当てずっぽうで入れる可能性はある（配信で読み上げる前提なので許容。満員後は入れない）。

## 4. 接続手順（HOST / GUEST）
1. HOST：「ルームを作る」→ PeerServer に `kotaro-…-NNNN` で登録 →「接続待機中」＋ルームコード表示。
2. GUEST：「ルームに参加」→ コード入力 →「接続」→ ランダム ID で PeerServer に登録 → `peer.connect(HOST の ID)`。
3. WebRTC の ICE が通り DataChannel が開く。
4. GUEST → `hello {app, v}`、HOST → `welcome {v}`（アプリ名・通信バージョン確認。違えば断る）。8 秒以内に済まなければ失敗。
5. 両方「接続しました」＋ HOST / GUEST 表示。Ping 開始。

## 5. Ping 測定
- 1 秒ごとに `ping {i, ts}` を送信 → 相手は同じ値で `pong` → 自分が記録した送信時刻（`performance.now()`）との差を RTT とする（相手の時計は使わない。自分が送っていない ID の pong は無視）。
- 表示：最新 PING、平均（直近 10 回）、最小 / 最大、最終受信からの秒数。
- 3 秒受信が無いと「相手からの応答が遅れています…」、10 秒で切断扱い。

## 6. 連続通信テスト
- 「連続通信テスト開始」で、毎秒 30 回 × 10 秒 = 300 パケットを送信。
- パケット：`{"t":"bp","id":1,"s":123,"ts":12345.6,"b":2}`（テスト番号・sequence・送信時刻・入力状態の模擬ビット）＝約 43 バイト。
- 受信側は 1 パケットごとに受信確認 `ba` を返し、終了後に集計 `br`（受信数・欠落・順序逆転・重複）を返す。
- 送信側の表示：送信数、受信数（相手側）、欠落数、順序逆転数、重複、平均 / 最大遅延（片道の推定 = 往復 ÷ 2）、往復時間、送信データ量（中身のみ）、実際の送信量（`getStats` の candidate-pair `bytesSent` 差分。暗号化・SCTP 込み、UDP/IP ヘッダは含まない）。
- 受信側にも「相手からの連続通信：受信 300 / 300・欠落 0…」を表示。双方同時に実行しても可。
- 送信間隔は時刻基準（遅れた分はまとめて送るので個数は保たれる）。テスト中に画面が裏に回った場合は注意を表示。

## 7. 実際のテスト結果
### (a) 実物の PeerJS 1.5.5 ＋ 公開 PeerServer（0.peerjs.com）、同じ PC の 2 タブ（Windows / Chromium 152）
| 項目 | 結果 |
|---|---|
| ルーム作成 | `KOTA-0219` 発行、PeerServer 登録成功 |
| 参加〜接続完了 | 約 1.2 秒（コード入力から hello/welcome 完了まで） |
| 経路 | `host / host / udp`（同じ PC 内なので LAN 直結） |
| Ping | 平均 約 1〜4 ms、最小 0.4 ms、最大 25 ms |
| LEFT / RIGHT / JUMP | 送受信 OK |
| 不正データ（未知 type・5000 文字） | 破棄（接続は維持） |
| 連続通信 300 パケット | 受信 300 / 欠落 0 / 順序逆転 0 / 重複 0、往復 平均 1.8 ms・最大 54 ms、中身 13.0 KB（43 B/パケット）、実送信 35.8 KB（≒ 28.7 kbps） |
| 満員のルームに 3 人目 | 「満員」で拒否、既存の接続は維持 |
| 存在しないコード | `peer-unavailable` →「ルームが見つかりません」 |
| GUEST のタブが別ページへ移動（bye なし） | HOST が約 2 秒で「接続が切れました」、Peer / 接続を解放 |
| STUN / TURN 候補 | STUN で srflx 候補は取得。PeerJS の TURN は応答なし（error 701）＝中継候補なし |

### (b) 自動テスト（Playwright / Chromium、2〜3 ページ。PeerJS 互換モック＋本物の RTCPeerConnection で UI 全体を検証）
- 38 + 5 + 8 項目すべて合格：作成・参加（全角コード）・HOST/GUEST 表示・Ping・平均 Ping・A/D/Space とボタン送信・ゲームへキーが漏れない・連続通信（双方向同時）・不正データ 7 種破棄（XSS・プロトタイプ汚染なし）・満員拒否・存在しないコード・入力エラー・タブを閉じる・RTCPeerConnection 強制終了（0.1 秒で検知）・無通信（3 秒で警告、10 秒で切断）・切断ボタン・再作成／再参加・Esc / 戻るで接続を残さない・サーバーに届かない場合・スマホ横／縦のタップ操作・入力欄フォーカス・横スクロールなし。

※ (a)(b) とも同一 PC 内の接続です。インターネット越し（別回線・携帯回線）の接続はまだ確認していません。

## 8. 切断時の挙動
- 「切断」ボタン：相手へ `bye` を送り、少し後に `DataConnection.close()` と `Peer.destroy()`。相手には「相手が切断しました」。
- 相手のタブを閉じた・更新した：`pagehide` で `bye` を送って閉じる。届かなくても DataChannel の close、ICE の failed、10 秒無受信のどれかで「接続が切れました」。
- 終了後は「メニューへ戻る」→ もう一度ルーム作成／参加できる。自動再接続はしない。
- タイトルへ戻る（戻る / Esc）時も必ず Peer と接続を閉じる。
- 古い接続から遅れて届くイベントは世代番号で無視（ゲーム全体が落ちない）。

## 9. セキュリティ
- 受信データは文字列のみ・512 文字以下・JSON オブジェクト・キー 8 個以下・既知の type のみ。各値は型と範囲を検証し、必要な値だけをコピーして使う。
- 1 秒あたり 240 件を超える受信は破棄。
- 画面への表示は `textContent` のみ（相手から届いた文字列は表示せず、検証済みの決まった値だけ表示）。`innerHTML` は自分の固定テンプレートだけ。
- 接続時にアプリ名・通信バージョンを確認。違うシリアライズ方式で来た接続は閉じる。

## 10. スマホ対応
- オンライン実験画面は縦・横どちらでも操作可能（この画面を開いている間は「横向きにしてください」案内を隠す）。縦画面のスマホは `?online` 付き URL で直接開ける。
- ゲーム本体はページ全体の touchstart / touchmove を止めているため、この画面の中だけ止めないようにした（入力欄のフォーカス・スクロール・ボタン操作のため）。
- ボタンは押して離した時に反応（スクロール開始時は取り消し）。LEFT / RIGHT / JUMP は押した瞬間に送信。
- 入力欄は数字キーボード（`inputmode="numeric"`）、文字サイズ 16px 以上（iPhone の自動拡大防止）。
- ログは「ログをコピー」で端末情報・状態・全ログ（最大 300 件）をクリップボードへ（実機テスト結果の共有用）。

## 11. TURN なしで起こり得る制限
- 両方が「対称型 NAT」や厳しいファイアウォールの内側にいると、P2P 経路が見つからず接続できない（例：一部の携帯回線（キャリアグレード NAT）、公衆 Wi-Fi、会社・学校のネットワーク、UDP が塞がれた環境）。
- この場合の表示：「相手と直接つながれませんでした…」。ログには `diag:` 行で ICE 状態・候補の種類（host / srflx / relay）・候補ペアの状態が残る。
  - `no remote candidates` → シグナリングが完了していない（コード違い・サーバー問題で、NAT の問題ではない）
  - `candidates exchanged but no path worked → likely NAT/firewall needing TURN` → TURN が必要な環境の可能性が高い
- PeerJS 既定の無料 TURN は今回の環境では使えなかったため、実質「TURN なし」として考える。

## 12. GitHub Pages へ公開する時
- このフォルダの中身をそのまま新しいリポジトリへ置き、Pages を有効にするだけ（ビルド不要）。
- HTTPS で配信されること（WebRTC とクリップボードに必要。GitHub Pages は HTTPS）。
- 公開中の Version 1.0 のリポジトリとは別にする。

## 13. 追加・変更したファイル
- 追加：`src/network/net-protocol.js`、`src/network/net-session.js`、`src/network/online-ui.js`、`css/online.css`、`docs/ONLINE_PHASE1.md`
- 変更：`index.html`（タイトル文字列、`online.css` の読み込み、「オンライン実験」ボタン 1 つ、スクリプト 4 行）、`README.md`
- **変更なし**：`src/` 直下の全 22 ファイル（ゲーム本体）、`css/style.css`、`assets/`（v1.0 とバイト単位で同一）

## 14. Version 1.0 の CPU 戦が変わっていないことの確認
- `diff -r`：ゲーム本体のファイルはすべて v1.0 と同一。
- 乱数を固定して v1.0 と実験版で同じ入力の試合を EASY / NORMAL / HARD / CHALLENGE それぞれ最後まで実行 → 全フレームの位置の記録・決着までのステップ数・勝敗が完全一致。
- 画面操作：タイトル → CPUと対戦（クリック／Enter）→ 難易度 4 種 → 対戦（A/D で移動）→ 勝敗 → もう一度（難易度維持）→ タイトルへ、をすべて確認。音声システム（AudioContext running）・エラーなし。
- オンライン実験画面を使った後でも CPU 対戦が普通に始まることを確認。

## 15. 実機確認のお願い
### PC
- [ ] GitHub Pages の URL でタイトル表示、CPU対戦が v1.0 と同じに遊べる（音も）
- [ ] 「オンライン実験」→「ルームを作る」で KOTA-#### が出る
- [ ] 別ブラウザ（例 Chrome と Edge）／別 PC から参加して両方「接続しました」＋ HOST / GUEST
- [ ] PING と平均 PING が 1 秒ごとに更新、最終受信が 1 秒未満
- [ ] A / D / Space で相手に「受信：LEFT / RIGHT / JUMP」
- [ ] 連続通信テスト：受信 300 / 欠落 0、遅延と送信量の値
- [ ] 切断ボタン → 相手が「相手が切断しました」。相手のタブを閉じる → こちらが「接続が切れました」（10 秒以内）
- [ ] メニューへ戻る → もう一度ルーム作成／参加できる
- [ ] 経路の表示（直接（同じネットワーク）／直接（NAT越え）／TURN中継）
### iPhone（Safari）
- [ ] 横画面：タイトルの「オンライン実験」をタップして開ける
- [ ] 縦画面：URL に `?online` を付けて開き、操作できる（タイトルは従来どおり横向き案内）
- [ ] コード入力欄をタップ → 数字キーボードが出る・画面が拡大しない
- [ ] PC ↔ iPhone（同じ Wi-Fi）で接続、LEFT / RIGHT / JUMP ボタン、連続通信テスト
- [ ] iPhone を Wi-Fi オフ（4G/5G）にして PC（自宅 Wi-Fi）と接続できるか。失敗した場合は「ログをコピー」の内容（特に `diag:` 行）を共有
- [ ] 接続中に Safari を閉じる／ホーム画面へ → PC 側が「接続が切れました」になる
- [ ] 画面ロック・アプリ切替から戻った時の表示（切断扱いでよい）
- [ ] CPU 対戦のスマホ操作・音が v1.0 と同じ
- （Android Chrome も同様）
