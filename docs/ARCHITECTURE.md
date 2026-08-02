# Elevator One — アーキテクチャ

`elevator-one.html`（= リポジトリ直下の `index.html`）1ファイルにHTML/CSS/JSがすべて入っている。
ビルド工程なし、外部ライブラリなし。読むときはこのファイルをそのまま開けばよい。

このドキュメントは「どう繋がっているか」を記録する。「何ができるか」は `README.md` を見ること。

## ファイル内の構成順序

1. `<style>` — CSS変数（`--sea-*` が背景色、他は固定パレット）
2. `<body>` — ヘッダー / 3カラムのmain（プリセット・XYパッド・パラメータ）/ フッター
3. `<script>` 内部、おおよそ上から下へ:
   - パラメータ定義（`P`, `SLIDERS`, `SEQP`, `HARMP`）
   - プリセット定義（`PRESETS`, `PRESET_TIP`, `TIPS`）
   - `target` / `current`（後述）
   - オーディオグラフ構築（`build()`）
   - `apply()` — current値をオーディオグラフに反映
   - 単発の音（`ping`, `scheduleEvents`）
   - 平滑化ループ（`setInterval` 100ms）
   - シーケンサ（`playStep`, `seqTick`, `mutateBar`）
   - 展開＝コード進行（`chordBar`, `chordStep`, `PROGS`, `CHORD`, `RHY`）
   - UI生成（プリセットボタン、スライダー、シャッフル、ツールチップ）
   - XYパッドの描画ループ（`draw`, マリンスノー, 背景色 `seaColors`）
   - 起動/停止/録音（`startEngine`, `stopEngine`, 自動起動）

## パラメータの流れ：target → current → オーディオグラフ

すべてのパラメータは3つの状態を持つ。

```
target[key]   ユーザーやプリセットが設定する「行き先」
current[key]  実際に鳴っている「現在地」。100msごとのループで target に指数的に近づく
apply()       current を読んで AudioParam に setTargetAtTime で反映
```

追従の速さは `glide`（UI上の「推移時間」、既定15秒）。ループ内で
`tau = glide/3` を使った指数補間をしている（`setInterval` 100ms、`draw`とは別ループ）。

**「値を変えても音がすぐ変わらない」のはバグではなくこの仕組みが理由。** 挙動を変えたい場合は
`glide` の既定値か、補間ループの `tau` の係数を触る。

XYパッド（明るさ/密度）も同じ仕組みに乗っている。`target.bright` / `target.density` を
ポインタ操作で直接書き換えているだけで、専用のロジックはない。

## オーディオグラフ

`build()` が `AudioContext` 生成時に一度だけ全ノードを組む（以後は使い回し、`ready` フラグで
未構築時の `apply()` 呼び出しをガードしている）。

### 送り先バス（共通）

```
dry      … 直接音
revSend  … コンボリューションリバーブ（impulse 7秒, decay 2.4）へ
dlySend  … フィードバック付きディレイ（左右ではなくモノラル1系統、フィルタ付き）へ
master   … dry/reverb/delay の合流点。DynamicsCompressor を経て destination とストリーム録音へ
```

ドローン、ノイズ、金属共鳴、質感チェーン、シーケンサ、展開パッド——すべて最終的に
`dry` / `revSend` / `dlySend` のどれか（複数可）に接続される。

### 音源ごとの経路

| 音源 | 内部バス | 主な接続先 | 制御しているパラメータ |
| --- | --- | --- | --- |
| ドローン5声 (`voices`) | `droneBus` | `droneBus` → 質感チェーン → dry/rev/dly | weight, tension, bright, motion, level, harm(減衰) |
| ノイズ層 (`noise`) | `droneBus` 経由 | 同上 | bright, motion |
| 金属共鳴 (`metal`, 4本のバンドパス) | 直結 | dry/rev/dly | grit(×GRIT_MAX), harm(減衰) |
| 質感チェーン (`build.tex`) | `droneBus` の後段 | dry/rev/dly | grit(×GRIT_MAX): 歪み量・リング周波数・粉塵量・LP/HP |
| グレイン (`grain()`, 単発生成) | 直結 | dry/rev/dly | grit(×GRIT_MAX), harm(減衰) |
| シーケンサ (`build.seq`) | `sBus` → 2系統のディレイタップ | master + revSend | seq(音量), tempo, reso(カットオフ), sres(レゾナンス), space(ディレイ量) |
| 展開パッド (`build.pad`) | `padSum→padFil→padEnv→padBus` + コーラス | dry/rev/dly | harm(音量), bright(フィルタ), chordrhy(発音パターン) |

**droneBus は「ドローン + ノイズ」の合流点であり、質感チェーンの入口でもある。**
`droneBus.gain` 自体も `harm` で絞られる（`apply()` 内: `tx.droneBus.gain = (1-gr*.28)*(1-c.harm*.95)`）。
展開（`harm`）が上がるとドローン側の出力そのものが引っ込む実装であり、
別レイヤーとして混ぜているのではなく droneBus のゲートで直接クロスフェードしている。

### GRIT_MAX という頭打ち定数

「ざらつき」(`grit`) スライダーは 0–1 だが、実効値の上限を `GRIT_MAX`（現在 0.8）で頭打ちにしている。
歪み・リングモジュレーション・粉塵・金属共鳴・グレイン発生間隔・シーケンサの矩形波混入判定——
`grit` を参照する箇所は必ず `c.grit*GRIT_MAX` の形で使うルール。将来 grit の効きすぎ/効かなさすぎを
調整したいときはこの定数1箇所を変えれば全体に反映される。同種の「効きすぎ防止」定数を今後増やす場合も、
この命名パターン（`XXX_MAX`、ファイル冒頭付近に定義）を踏襲すると探しやすい。

### 質感チェーンの中身（`build.tex`）

```
droneBus → texIn(gain) → shaper(WaveShaper) → texHP → texLP → ringGate → crkGate → texOut → dry/rev/dly
```

- `shaper.curve` は起動時に1回だけ生成する固定カーブ（tanh + 倍音を混ぜた折り返し）。動的に変える設計にはなっていない
- `ringGate.gain` に `ringOsc`（矩形波LFO）を加算的に注入することでリングモジュレーションを模している。正確な乗算リングモジュレータではなく、gainパラメータを揺らす近似
- `crkGate` も同様にノイズで揺らす。`ringGate`と`crkGate`は直列なので、両方のデプスが0なら`texOut`はほぼ`texIn`の歪みだけを通す

### シーケンサの音程・タイミング

- 16ステップのパターン (`pattern[]`) は `reseed()` で生成。各ステップは `{on, deg, oct, acc}`
- `playStep(i, time)` が実際の発音。音程は `rootMidi` と `c.weight` から算出した基準音に
  スケール度数 `st.deg` を足す。緊張度でスケール自体が2種類切り替わる
- クロックは `seqTick()`。`AudioContext.currentTime` を基準に25ms間隔で先読みスケジュール
  （`nextStepTime < ctx.currentTime + .15` の間ループで詰める、Web Audioのタイミング精度確保の定石）
- 4ステップごと（`i % 4 === 0`）に低音パルスが `build.seq.bus` へ入る。**この経路は「音量」フェーダー
  (`seq`) の影響を受ける** よう `build.seq.bus` に接続している（旧バージョンで `dry` 直結になっていて
  フェーダーが効かないバグがあったため、修正済み）

### 展開＝コード進行のロジック

- `PROGS`：6種類のマイナー調進行。各要素は `{r: 半音オフセット4つ, q: 長短4つ}`
- `CHORD`：`m`/`M` それぞれのトライアド＋9th（`[0,3,7,14]` / `[0,4,7,14]`）
- `chordBar(time)`：シーケンサの0拍目（`seqTick`内で`idx===0`）ごとに呼ばれる。
  `current.chordrhy >= .5` なら2小節周期、それ未満なら4小節周期。
  1周終わるたびに `mutate` の値に応じた確率で `PROGS` の別の進行に乗り換える
- `setChord(time)`：4声に `setValueAtTime` で音程を直接書く。**ポルタメントを掛けないのはここが理由**
  （`linearRampToValueAtTime` 等を使わず瞬時切り替え）
- `chordStep(i, time)`：`chordrhy` の値でリズムパターン（`RHY[0..2]`）を切り替え、
  該当ステップだけ `padEnv.gain` にエンベロープをかける。`chordrhy < .08` のときはこの関数は発音せず、
  代わりに `apply()` 側で `padEnv.gain` を常時1に固定して持続音にしている

新しい進行を足すときは `PROGS` に1要素追加するだけでよい（4要素固定の配列であること以外に制約はない）。
コードの声部を増やす／音域を変えるときは `build.pad.padVoices`（現在4声固定）と `setChord` 内の
`notes` 配列の対応関係を合わせて変更すること。

## UI ⇄ 状態の対応

- スライダー・XYパッド・プリセットボタンはすべて `target[key]` を書き換えるだけで、
  音への反映は前述の補間ループと `apply()` に一任している。UI側に音声処理は一切ない
- プリセットは `applyPreset(idx, btn)` 経由で適用。手動操作（スライダー/XYパッド/プリセット直接選択）は
  すべて `stopShuffle()` を呼び、シャッフル中の自動切り替えを止める
- ツールチップは `data-tip` 属性 + 単一の `#tip` 要素を使い回すグローバル委譲方式
  （`mouseover`/`mouseout`/`focusin`/`focusout` をdocumentに1回だけ登録）。
  新しい操作要素にツールチップを足したいときは `data-tip="説明文"` を属性に足すだけでよい

## 自動起動の仕組み

`startEngine()` は `starting` ロックを持つ非同期関数（多重起動防止）。ページ読み込み時に

1. 即座に `startEngine()` を試行（多くの場合ブラウザの自動再生ポリシーでブロックされる）
2. `pointerdown` / `keydown` をcapture phaseでdocumentに仕込み、最初の1回で `startEngine()` を呼んで
   自分自身を解除する

という二段構え。**ブラウザの自動再生ポリシーを回避する完全な方法は存在しない**ため、
「開いたら必ず無音操作なしで鳴る」動作は保証できない。これは実装の不備ではなく制約。

## 既知の設計上の制約

- ブラウザストレージ（localStorage等）は不使用。設定の永続化は一切なく、リロードで全パラメータが初期値に戻る
- 録音は `MediaRecorder` による `audio/webm` 固定。他形式への変換は行っていない
- オフライン専用。外部ネットワークへの通信は存在しない（CDN等も読み込んでいない）
- キャンバス（XYパッド）は `ResizeObserver` + `window.resize` でサイズ追従するが、
  リサイズ時に `trail`（軌跡）配列をクリアしている（座標系が変わるため）
- 全体レイアウトは `100dvh` 固定で溢れた分は各セクション内スクロール。幅900px以下では1カラムに積み替え、
  高さ720px以下ではプリセットの英字サブラベルなどを間引く専用のメディアクエリが効く
