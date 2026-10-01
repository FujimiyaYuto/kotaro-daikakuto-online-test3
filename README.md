# コタロの大格闘 Online（実験版） — Online Phase 3

> このフォルダは、完成版 Version 1.0 をコピーして作った **オンライン対戦の実験版** です。
> 公開中の Version 1.0 とは別物として扱います（Version 1.0 のゲーム部分のファイルは一切変更していません）。
> Online Phase 1 =「2つのブラウザを WebRTC でつなぐ通信実験」、Online Phase 2 =「GUEST がルミポを左右移動・ジャンプで操作する実験」。
> Online Phase 3 =「GUEST 側の予測（Client-side Prediction）で、自分のルミポがすぐ動くようにする実験」。
> 攻撃・ダメージ・勝敗のオンライン化（正式なオンライン対戦）はまだです。

## オンライン実験（Online Phase 1）
タイトル →「オンライン実験 TEST」→「ルームを作る」/「ルームに参加」

- ルームを作ると `KOTA-1234` のようなルームコードが表示されます。参加する側はその4桁を入力して「接続」。
- 接続後：Ping（1秒ごと）・平均Ping・最終受信からの時間・経路（直接／TURN中継）などの診断、
  LEFT / RIGHT / JUMP の通信テスト（PC は A / D / Space）、連続通信テスト（毎秒30回×10秒）、通信ログ（直近20件・コピー可）。
- URL に `?online`（または `#online`）を付けると、起動後すぐにオンライン実験画面を開きます（縦画面のスマホでも操作できます）。
- 開発用：`?stunonly` で PeerJS の TURN を使わない設定、`?netdebug` で PeerJS の詳細ログをコンソールへ。
- 通信は PeerJS 1.5.5（cdnjs から読み込み）と PeerJS の公開シグナリングサーバー（0.peerjs.com）を使います。詳しくは `docs/ONLINE_PHASE1.md`。

## 操作実験（Online Phase 2）
接続後、HOST の「操作実験を開始」で両方がゲーム画面へ。HOST = コタロ（いつもの操作）、GUEST = ルミポ（左右移動・ジャンプのみ）。
- GUEST の操作：PC は A / D・← / →、ジャンプは Space / W / ↑。スマホは画面下の LEFT / RIGHT / JUMP。
- HOST が正しい状態を決め（HOST authoritative）、GUEST へ 30Hz で位置などを送る。GUEST は 70ms 遅らせて補間表示（予測なし）。
- 「診断」で PING・入力 / 状態の Hz・番号・遅延の目安を表示。「実験を終了」で接続画面へ戻る。
- 詳しくは `docs/ONLINE_PHASE2.md`。

## 予測（Online Phase 3）
- GUEST の画面では、ルミポが入力した次のフレームから動く（予測）。正しい状態は今までどおり HOST が決め、ずれは自然に補正される。
- GUEST の「予測 ON / OFF」ボタン（または P キー）で、Phase 2 と同じ表示（予測なし）と切り替えて比べられる。URL に `?pred=off` で最初から OFF。
- 診断に予測誤差・補正回数・snap 回数・未確認入力数を表示。詳しくは `docs/ONLINE_PHASE3.md`。

| 追加したファイル | 内容 |
|---|---|
| `src/network/net-protocol.js` | メッセージ形式・受信データの検証・ルームコード |
| `src/network/net-session.js` | PeerJS による接続（HOST / GUEST）・Ping・通信テスト・切断検知・診断 |
| `src/network/online-ui.js` | オンライン実験画面 |
| `src/network/online-move.js` | 操作実験（Phase 2）・予測（Phase 3）：遠隔入力・状態同期・補間表示・予測と補正・GUEST パッド |
| `css/online.css` | オンライン実験画面のスタイル |
| `docs/ONLINE_PHASE1.md` / `ONLINE_PHASE2.md` / `ONLINE_PHASE3.md` | 仕組み・テスト結果・実機確認項目 |

---

# （以下は Version 1.0 の説明）

# コタロの大格闘 — Version 1.0

海中のクラゲの世界で、コタロがCPU「ルミポ」と戦う 2D カジュアル対戦アクションです。
ブラウザで `index.html` を開けば遊べます（PC・スマートフォン横画面対応）。サーバーに置く場合は、このフォルダをそのまま公開してください。

## 遊び方
タイトル →「CPUと対戦」→ 難易度（EASY / NORMAL / HARD / CHALLENGE）→ 対戦 → 勝敗 →「もう一度」/「タイトルへ戻る」

| 操作 | PC | スマートフォン |
|---|---|---|
| 移動 | A / D（← / →） | 左スティック |
| ジャンプ（空中でもう1回） | Space | ジャンプ |
| ぽよんアタック | J | 攻撃 |
| クラゲ電撃 | K | 必殺 |
| バブルショット | L | 泡 |
| ガード（押している間） | I | 防御 |
| もう一度（対戦中） | R | — |

## 設定（src/config.js）
- `audio.master` / `audio.bgm` / `audio.se` … 全体・BGM・効果音の音量
- `audio.bgmFiles` … 正式な BGM ファイルのパス（置き方は `assets/audio/bgm/README.txt`）。未指定の間はゲーム内で合成するオリジナルの仮BGM（`audio.synthFallback`）
- `DEBUG_ENABLED` … 公開版は `false`。`true` にすると H キーで開発用表示（当たり判定・CPUの判断など）、T キーでタッチUIの切替

## 素材
- コタロさんの SD 画像（`assets/kotaro.png`）は許可を得て使用している素材です。加工・再生成はしていません。
- 背景・ステージ・ルミポ・エフェクトはすべてゲーム内の図形描画、効果音と仮BGMはゲーム内で合成した音です（外部の音源・画像は使っていません）。
