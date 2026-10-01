/*
 * config.js — ゲーム全体の調整値
 * 操作感の数値は基本ここ（とキャラクター定義の movement 上書き）だけを触れば変わるようにしています。
 * 座標系: ワールド単位（1単位 ≒ 画面高さ720基準の1px）、x は右が正、y は下が正。
 */
(function (KG) {
  'use strict';

  KG.CONFIG = {
    // 固定タイムステップ（対戦ゲームで挙動を端末差なく揃えるため 60Hz 固定）
    fixedStep: 1 / 60,
    maxStepsPerFrame: 5,
    maxDevicePixelRatio: 2,

    // カメラが最低限映すワールド範囲。画面が横長ならこれより横に広く映る
    view: { minWidth: 1280, minHeight: 720 },

    camera: {
      followSharpness: 7,      // 追従の速さ（大きいほどキビキビ）
      zoomSharpness: 3,
      padding: { x: 260, y: 200 }, // 対象キャラの周囲に確保する余白
      maxZoomOut: 1.7,         // 複数キャラ時に引ける最大倍率（1 = 基本サイズ）
      focusOffsetY: -80,       // 注視点を少し上に（キャラを画面のやや下に置く）
    },

    // 蓄積ダメージと吹っ飛び（計算は combat.js の KG.Knockback）
    combat: {
      knockbackGrowth: 0.012,  // 蓄積ダメージ1%ごとに吹っ飛び速度が +1.2%（技データで上書き可）
      maxKnockbackScale: 3.0,  // 吹っ飛び倍率の上限
      maxDamage: 999,
      // 被弾後の操作不能（hitstun）= base + 吹っ飛び速度 × perSpeed フレーム（上限 max）
      hitstunBaseFrames: 8,
      hitstunPerSpeed: 0.01,   // 速度1000で +10F
      hitstunMaxFrames: 40,
      launchAirFriction: 400,  // 吹っ飛び中の横方向の減速（空中）
      hurtGroundFriction: 3200, // 操作不能中に着地した時の減速
      tumbleSpin: 0.012,       // 吹っ飛び中の見た目の回転の速さ
      restoreAirJumpOnHit: true, // 攻撃を受けたら空中ジャンプを回復（復帰しやすく）
    },

    // 対戦ルール（ストック・場外・リスポーン）。場外範囲はステージデータ側（stage.js の blastZone）
    rules: {
      stocks: 3,               // 初期ストック
      respawnDelay: 1.0,       // 場外になってからリスポーンまでの待ち（秒）
      invincibleTime: 2.0,     // リスポーン直後の無敵（秒）
    },

    // ガード（fighter.js / combat.js）。技データの hitbox に guardstun / guardPushback を書けば技ごとに上書きできる
    guard: {
      startupFrames: 3,        // 押してから防御が有効になるまで（約50ms）。この間に当たると普通に被弾
      stunFrames: 10,          // ガード成功後の硬直（約0.17秒）。この間は移動・ジャンプ・攻撃できない
      pushback: 420,           // ガード成功時に攻撃元から離れる方向へ押される初速（通常の吹っ飛びとは別）
      pushbackFriction: 2400,  // 押し戻しの減速（初速420なら約37押される）
      hitstop: 4,              // ガード成功時のヒットストップ（攻撃側・ガード側とも）
    },

    // テスト用 CPU の行動パラメータ（ai.js）
    cpu: {
      attackRangeX: 100,       // この横距離以内なら攻撃
      attackChance: 1.0,       // 攻撃できる時に実際に攻撃する確率（難易度で変わる）
      hesitateTime: 0.3,       // 攻撃を見送った時の様子見時間
      attackRangeY: 80,        // この高さの差以内なら攻撃
      reactionTime: 0.12,      // 攻撃範囲に入ってから攻撃するまでの間（秒）
      attackCooldown: 0.55,    // 攻撃後、次の攻撃までの間（秒）
      stopDistance: 55,        // これより近ければ歩かない
      respawnWait: 0.6,        // リスポーン直後に動かない時間（秒）
      jumpHoldTime: 0.22,      // ジャンプボタンを押し続ける時間（大ジャンプ）
      targetAboveHeight: 110,  // 相手がこれより高い所にいればジャンプを試す
      targetAboveRangeX: 300,
      ledgeProbe: 30,          // 進行方向のこの先に足場があるか調べる
      safeDropDepth: 700,      // この深さ以内に足場があれば「降りても安全」
      gapJumpReach: 330,       // 穴の先のこの距離に足場があれば飛び越える
      stuckTime: 0.25,         // 歩こうとして止まっている時間がこれを超えたらジャンプ

      // ---- ガード判断（Phase 8）。将来の難易度設定はここの値を変えるだけで作れる ----
      guard: {
        reactionMin: 0.15,     // 危険に気づいてから判断するまで（秒）。この範囲でランダム
        reactionMax: 0.28,
        chance: 0.45,          // 1つの危険につき1回だけ抽選。ガードする確率
        minHold: 0.35,         // 一度ガードしたら最低これだけ続ける（秒）
        maxHold: 0.9,          // 危険が続いてもこれ以上は固まらない（秒）
        rejudgeWait: 0.6,      // ガードを解いた後、次の危険を判断しない時間（秒）
        meleeRangeX: 200,      // 相手の攻撃動作を「危険」と見る横距離
        meleeRangeY: 120,      // 同・高さの差
        projectileRange: 340,  // 自分へ向かって来る飛び道具を「危険」と見る距離
        projectileRangeY: 110, // 飛び道具の高さと自分の体の中心の差
        // 相手が走って近づいて来る（見て分かる「攻めて来そう」）も警戒の対象。こちらは少し低い確率
        approachRange: 280,    // この距離以内で
        approachSpeed: 250,    // 相手がこれ以上の速さでこちらへ向かって来ていたら
        approachChance: 0.35,
      },

      // ---- 技の使い分け（Phase 11）。ルミポの突進・光弾・対空をいつ使うか（NORMAL の値）----
      //   状況（距離・高さ）が合った時に1回だけ抽選 → 当たれば decideDelay 秒（反応）待ってから技を出す。
      //   外れたら rethink 秒は同じ状況で抽選し直さない。使った後は cooldown 秒その技を候補にしない。
      //   直前に使った技と同じ技は確率に repeatPenalty を掛ける（連打しにくい。使えなくはしない）
      moves: {
        repeatPenalty: 0.5,
        // 至近距離で通常攻撃を続けて使った後、一度下がって間合いを作る確率（連打の単調さを減らす）
        backstepChance: 0.3,   // 2回続けて通常攻撃した後に抽選
        backstepTime: 0.45,    // 下がる時間（秒）。約150下がって中距離にする
        dash: {                // 突進：通常攻撃が届かない中距離の、ほぼ同じ高さの相手
          chance: 0.5, cooldown: 2.2, decideDelay: 0.22, rethink: 0.6,
          minDist: 150, maxDist: 290, maxDy: 50,
        },
        shot: {                // 光弾：離れている、ほぼ同じ高さの相手（弾が当たる高さ）
          chance: 0.45, cooldown: 2.8, decideDelay: 0.3, rethink: 0.8,
          minDist: 340, maxDist: 720, maxDy: 60,
        },
        antiAir: {             // 対空：近くの、明らかに上にいる相手
          chance: 0.6, cooldown: 1.1, decideDelay: 0.16, rethink: 0.4,
          rangeX: 115, minAbove: 90, maxAbove: 290,
        },
      },
    },

    // 試合の流れ（Phase 9）
    match: {
      countdownStep: 0.7,      // 3 → 2 → 1 → START! の各表示時間（秒）
      startShow: 0.6,          // START! の表示時間（この表示が出た瞬間に試合開始）
      endDelay: 1.3,           // 最後のストックが無くなってから勝敗表示までの間（秒）
    },

    // CPU 難易度の初期選択（KG.CPU_DIFFICULTY のキー）。通常は難易度選択画面で選ぶ。
    // 開発用：URL の #easy / #normal / #hard（または ?cpu=）で難易度選択画面の初期選択を変えられる
    cpuDifficulty: 'normal',

    debug: false,

    // 公開版（Version 1.0）では false。true にすると H キーの開発用表示・T キーのタッチUI切替・URL の ?debug が使える
    DEBUG_ENABLED: false,

    // ---- サウンド（Phase 13）。設定画面は無いので、ここで調整する ----
    audio: {
      enabled: true,
      master: 0.85,          // 全体
      bgm: 0.32,             // BGM（重要な効果音より小さく）
      se: 0.9,               // 効果音
      bgmFade: 0.8,          // BGM の切り替え・音量変化のフェード（秒）
      resultDuck: 0.18,      // 勝敗表示中の対戦BGMの音量（倍率）。ジングルを聞きやすく
      endingDuck: 0.45,      // 最後のKO直後〜勝敗表示までの対戦BGMの音量（倍率）
      // BGM ファイル（用意できたらパスを書く。例 'assets/audio/bgm/title.mp3'）。null の間は下の synthFallback を使う
      //   ファイルが読み込めなかった時もエラーにせず synthFallback（または無音）で続ける
      bgmFiles: {
        title: null,         // タイトル・難易度選択（同じ曲を続けて流す）
        battle: null,        // 対戦
      },
      synthFallback: true,   // BGM ファイルが無い間、ゲーム内で合成するオリジナルの仮BGMを流す（false で無音）
      maxVoices: 18,         // 効果音の同時発音数の上限（超えた分は鳴らさない。KO・勝敗・UI は優先）
    },
  };

  KG.VERSION = '1.0.0';

  /*
   * CPU 難易度（Phase 9）
   * KG.CONFIG.cpu（= NORMAL の値）に上書きする差分だけを書く。AI のロジックはどの難易度も同じ。
   *   attackChance … 攻撃できる状況になった時に実際に攻撃する確率（見送ると hesitateTime だけ様子見）
   * 反応時間の下限はどの難易度でも 0.12 秒以上（人間らしさを残す。入力は読まない）
   */
  KG.CPU_DIFFICULTY = {
    easy: {
      label: 'EASY',
      desc: 'はじめてでも遊びやすい', // 難易度選択画面の説明（Phase 10）
      reactionTime: 0.28,      // 攻撃範囲に入ってから攻撃するまで
      attackCooldown: 1.0,     // 攻撃の間隔
      attackChance: 0.6,       // 攻撃の機会を4割見送る
      hesitateTime: 0.45,
      guard: { reactionMin: 0.24, reactionMax: 0.4, chance: 0.2, approachChance: 0.12, minHold: 0.3, maxHold: 0.7, rejudgeWait: 1.0 },
      // 全部の技を使うが、機会を見送りやすく・間隔が長く・出すまでが遅い（読みやすい）
      moves: {
        backstepChance: 0.2,
        dash: { chance: 0.25, cooldown: 4.0, decideDelay: 0.4, rethink: 1.2 },
        shot: { chance: 0.22, cooldown: 5.0, decideDelay: 0.5, rethink: 1.5 },
        antiAir: { chance: 0.3, cooldown: 2.2, decideDelay: 0.28, rethink: 0.9 },
      },
    },
    normal: {
      label: 'NORMAL',          // Phase 8 の CPU そのまま
      desc: '基本の強さ',
    },
    hard: {
      label: 'HARD',
      desc: 'ガードも攻撃も手強い',
      reactionTime: 0.08,
      attackCooldown: 0.4,
      attackRangeX: 108,
      stopDistance: 45,
      targetAboveRangeX: 360,
      guard: { reactionMin: 0.12, reactionMax: 0.2, chance: 0.65, approachChance: 0.5, minHold: 0.4, maxHold: 1.0, rejudgeWait: 0.4, approachRange: 300 },
      // 距離と高さに合った技を積極的に選ぶ。反応は速めだが 0.12 秒以上、技の予兆（溜め）は他の難易度と同じ
      moves: {
        repeatPenalty: 0.6,
        backstepChance: 0.35,
        dash: { chance: 0.75, cooldown: 1.5, decideDelay: 0.14, rethink: 0.35 },
        shot: { chance: 0.65, cooldown: 2.0, decideDelay: 0.2, rethink: 0.5 },
        antiAir: { chance: 0.85, cooldown: 0.8, decideDelay: 0.12, rethink: 0.25 },
      },
    },

    /*
     * CHALLENGE（Phase 12）：ゲームに慣れた人向けの挑戦枠。
     * 技の性能・予兆・ダメージは他の難易度と同じ。強さは「判断・位置取り・技選択・攻めの継続・隙を見つける」で出す。
     *   ・反応は HARD より少し速いが、どれも 0.10 秒以上（攻撃の判断・技の判断・ガードの判断）
     *   ・ガードは 1 危険 1 抽選・正面のみ・地上のみ・技中は不可（Phase 8 のルールのまま）で、確率 75%
     *   ・tactics（戦術）を持つのはこの難易度だけ。tactics が無い難易度の AI は Phase 11 と同じ動き
     */
    challenge: {
      label: 'CHALLENGE',
      desc: '本気のルミポに挑戦',
      special: true,            // 難易度選択画面で少し特別な見た目にする
      reactionTime: 0.1,        // 通常攻撃の間合いに入ってから攻撃するまで（最短 0.10 秒）
      attackCooldown: 0.4,
      attackRangeX: 108,
      stopDistance: 45,
      targetAboveRangeX: 360,
      // ガード：1危険1抽選・正面のみ・地上のみ（ルールは共通）。releaseAfterStun = 受けた攻撃が終わり硬直が解けたら、すぐ次の行動へ
      // ignoreRecovery = 相手の技が後隙に入ったら危険ではないと見る（守りを解いて後隙を狙える）。minHold も短め
      guard: { reactionMin: 0.1, reactionMax: 0.16, chance: 0.75, approachChance: 0.5, minHold: 0.2, maxHold: 1.0, rejudgeWait: 0.35, approachRange: 300, releaseAfterStun: true, ignoreRecovery: true },
      moves: {
        repeatPenalty: 0.6,
        backstepChance: 0.45,
        dash: { chance: 0.8, cooldown: 1.4, decideDelay: 0.1, rethink: 0.3 },
        shot: { chance: 0.7, cooldown: 1.8, decideDelay: 0.12, rethink: 0.4 },
        antiAir: { chance: 0.9, cooldown: 0.8, decideDelay: 0.1, rethink: 0.2 },
      },
      // ---- 復帰（Phase 12.1・CHALLENGE だけ。ai.js の smartRecover が使う）----
      //   場外に出たら着地するまで復帰を最優先。自分の普通の動き（同じジャンプ力・重力・空中速度・空中ジャンプ回数）で
      //   「この方向へ動き続けて、このタイミングで空中ジャンプしたら足場に乗れるか」を短く試算して、乗れる方法を選ぶ。
      //   ジャンプしなくても乗れるなら温存し、待つと間に合わなくなる直前に使う。
      recovery: {
        evalEvery: 6,          // 何フレームごとに考え直すか
        jumpStep: 6,           // 空中ジャンプのタイミング候補の間隔（フレーム。近い所は2、跳ぶ直前は1フレームずつ）
        jumpMax: 48,           // 何フレーム先までジャンプの候補を試すか
        latestMargin: 8,       // 「これ以上待つと間に合わない」までの余裕がこのフレーム以下になったら跳ぶ
        simFrames: 240,        // 試算する長さ（フレーム）
        fallingFast: 900,      // 理由表示：これより速く落ちている → FALLING_FAST
        blastDanger: 450,      // 理由表示：下の場外ラインまでこれ以下 → BLAST_DANGER
        farFromStage: 260,     // 理由表示：足場までの横の距離がこれ以上 → FAR_FROM_STAGE
      },
      // ---- 立て直し（Phase 12.2・CHALLENGE だけ。ai.js の updateStabilize が使う）----
      //   被弾の操作不能が解けた時・復帰して着地した時に、相手が近い／詰めて来ている／崖際／高ダメージなら短く「立て直す」。
      //   無敵や性能の強化は無し。持っている移動・ガードだけで、安全に着地して相手の追撃を防ぐ・かわす。
      stabilize: {
        triggerRange: 320,     // 相手がこの距離以内なら危険
        chaseSpeed: 180,       // 相手がこの速さ以上でこちらへ向かって来ていたら「追撃に来ている」
        watchRange: 450,       // これより遠く、追って来てもいなければ立て直しは不要
        highDamage: 80,        // 自分の蓄積ダメージがこれ以上なら（もう一度飛ばされると危ない）立て直しを選びやすい
        chanceDanger: 0.9,     // 危険な時に立て直しを選ぶ確率
        chanceMild: 0.5,       // 少し危険（崖際・高ダメージだけ等）な時の確率
        // 空中：自分の着地点を自分の動きで試算し、相手から遠い安全な足場へ（ジャンプは使わない）
        airEvalEvery: 6,
        edgeAvoid: 60,         // 着地点が足場の端からこの距離以内なら避ける
        turnFrames: 5,         // 着地のこのフレーム前に相手の方を向く（正面でガードできるように）
        // 地上：正面から近づく相手にはガード（確率）、まだ遠ければ安全な方向へ少し下がる
        guardRange: 230,
        nearRange: 140,
        guardChance: 0.75,
        guardHold: [0.3, 0.5],
        disengageTime: 0.4,
        edgeKeep: 180,         // 下がる先の足場の端までこれ以上ある時だけ下がる（自分から場外へ走らない）
        safeDist: 330,         // この距離まで離れ、相手も詰めて来ていなければ終了
        maxTime: 0.9,          // 立て直しは最長でもこの秒数（逃げ続けない）
        afterGuardDelay: [0.03, 0.08],
        rushWindow: 3.0,       // 被弾から何秒の間、相手が再び詰めて来たら立て直しをもう一度考えるか
        maxRetrigger: 1,       // その間にもう一度立て直す回数の上限（逃げ続けない）
        punishMinLeft: 10,     // 立て直し中に後隙を狙うのは、相手の後隙がこのフレーム以上残る時だけ（通常攻撃が間に合う）
        gapCampRange: 180,     // 穴を飛び越える先のこの距離以内で相手が待ち構えていたら
        gapWaitMax: 3.0,       // 最長この秒数は跳ばずに待つ（相手が技を出したらその隙に跳ぶ。待ち続けはしない）
        gapBackoffDist: 370,   // 待つ間は、相手からこの距離まで足場の奥へ下がる（光弾が届く距離）
      },
      // ---- 戦術（CHALLENGE だけ。ai.js の updateTactics が使う）----
      tactics: {
        reconsider: [0.25, 0.55],   // 戦術の目的を考え直す間隔（秒、この範囲でランダム）＝毎フレーム切り替えない
        // 間合い管理
        idealMid: 210,              // 中距離の目安（突進・光弾が候補に戻る距離）
        holdChance: 0.25,           // 中距離で技が使えない時、少しだけ待って様子を見る確率
        holdTime: [0.15, 0.35],
        spaceOnGuardChance: 0.6,    // 近くで相手がガードを固めている → 下がって間合いを作る確率
        jabStreakSoft: 2,           // 通常攻撃がこの回数続いたら、下がる確率を上げる
        jabStreakHard: 3,           // この回数続いたら、ほぼ下がる（状況的に最適なら続けることもある）
        backstepAtHard: 0.85,
        // 光弾の後
        followShotChance: 0.65,     // 光弾を撃った後、弾の後ろから距離を詰める確率（毎回ではない）
        followMaxTime: 1.4,         // 追いかける最大時間（秒）
        // 着地への圧力（現在位置 + 速度 × 短い時間 の粗い予測のみ）
        landingChance: 0.55,        // 相手が跳ぶたびに 1 回抽選
        landingPredictMax: 0.35,    // 予測する時間の上限（秒）
        landingStandoff: 90,        // 予測した着地点からこの距離の所に立つ（通常攻撃が届く手前）
        landingRange: 420,          // これより遠い着地点は追わない
        // ガード後
        afterGuardJabRange: 125,    // ガード硬直が解けた時、相手がこの距離以内なら通常攻撃を有力候補に
        afterGuardDelay: [0.03, 0.08], // 硬直が解けてから動き出すまでの小さな間（機械的に最速にしない）
        // 相手の後隙（Fighter の技の状態 'recovery' を見る）
        punishRange: 150,           // 相手の後隙を見たら、この距離までは歩いて詰めて通常攻撃を狙う
        punishMinFrames: 8,         // 相手の後隙の残りがこのフレーム以上ある時だけ狙う（間に合わない時は突っ込まない）
        // 崖際
        edgeCaution: 110,           // 自分の足場の端までこの距離以内で、相手が足場の外にいる → 追わずに待つ
        edgePressureRange: 240,     // 相手が足場の端からこの距離以内 → 中央側に回って逃がさない位置を取る
        edgePressureGap: 130,       // その時に取る相手との距離（通常攻撃の少し外。相手が動けば通常攻撃・突進）
        edgePressureChance: 0.6,
      },
    },
  };

  // 難易度名 → AI 設定（NORMAL の値に差分を重ねる。guard は1段深くまで重ねる）
  KG.cpuProfile = function (name) {
    const diff = KG.CPU_DIFFICULTY[name] || KG.CPU_DIFFICULTY.normal;
    const base = KG.CONFIG.cpu;
    const out = Object.assign({}, base, diff);
    out.guard = Object.assign({}, base.guard, diff.guard || {});
    // 技の使い分け（Phase 11）：技ごとに1段深く重ねる
    const dm = diff.moves || {};
    out.moves = Object.assign({}, base.moves, dm);
    for (const k of ['dash', 'shot', 'antiAir']) out.moves[k] = Object.assign({}, base.moves[k], dm[k] || {});
    // 戦術（CHALLENGE のみ）。無い難易度は null ＝ Phase 11 の AI と同じ
    out.tactics = diff.tactics ? Object.assign({}, diff.tactics) : null;
    out.recovery = diff.recovery ? Object.assign({}, diff.recovery) : null; // 賢い復帰（CHALLENGE のみ）
    out.stabilize = diff.stabilize ? Object.assign({}, diff.stabilize) : null; // 被弾後の立て直し（CHALLENGE のみ）
    out.difficulty = KG.CPU_DIFFICULTY[name] ? name : 'normal';
    return out;
  };

  // 移動パラメータの既定値（キャラクター定義の movement で個別に上書き可能）
  KG.DEFAULT_MOVEMENT = {
    groundSpeed: 440,     // 地上の最高速度
    groundAccel: 3600,    // 地上の加速
    groundDecel: 4200,    // 入力なし時の地上減速
    turnAccel: 6400,      // 地上で逆方向に入れた時の切り返し
    airSpeed: 400,        // 空中の最高速度
    airAccel: 2200,       // 空中での左右操作の効き
    airDecel: 700,        // 空中で入力なし時の減速（慣性が残る）

    gravity: 2700,
    maxFallSpeed: 1300,

    jumpSpeed: 1080,      // 地上ジャンプ初速（最高到達 約216）
    airJumpSpeed: 980,    // 空中ジャンプ初速
    maxAirJumps: 1,       // 空中ジャンプ回数（0 にすると1段ジャンプのみ）
    jumpCutFactor: 0.55,  // 上昇中にボタンを離した時の速度倍率（小ジャンプ）。1 で無効
    coyoteTime: 0.08,     // 足場から落ちた直後でもジャンプできる猶予（秒）
    jumpBufferTime: 0.1,  // 着地直前の先行入力を受け付ける時間（秒）
    attackBufferTime: 0.1, // 攻撃の先行入力（技の終わり際に押した攻撃を次に出す）
  };
})(window.KG = window.KG || {});
