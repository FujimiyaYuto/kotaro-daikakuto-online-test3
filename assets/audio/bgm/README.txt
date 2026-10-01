コタロの大格闘 — BGM ファイルの置き場所

ここに正式な BGM ファイルを置くと、ゲーム内の仮BGM（合成音）の代わりに再生されます。
利用条件がはっきりしている音源（自作・依頼して制作したもの・商用利用可の素材など）だけを置いてください。

1. ファイルを置く（ループ再生されます。曲の終わりと始まりが自然につながるものが理想）
     assets/audio/bgm/title.mp3   … タイトル・難易度選択（同じ曲が続けて流れます）
     assets/audio/bgm/battle.mp3  … 対戦
   形式は mp3 を推奨（iPhone / Android / PC のブラウザで再生できます）。m4a(AAC) も可。

2. src/config.js の audio.bgmFiles にパスを書く
     bgmFiles: {
       title: 'assets/audio/bgm/title.mp3',
       battle: 'assets/audio/bgm/battle.mp3',
     },

3. 音量は src/config.js の audio.bgm（BGM）・audio.se（効果音）・audio.master（全体）で調整します。

・パスが null の間、またはファイルが読み込めなかった時は、仮BGM を流します（エラーでゲームは止まりません）。
・仮BGM も止めたい時は audio.synthFallback を false にすると、BGM は無音になります。
