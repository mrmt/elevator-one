# Elevator One — アーキテクチャ

`elevator-one.html`（= リポジトリ直下の `index.html`）1ファイルにHTML/CSS/JSがすべて入っている。
ビルド工程なし、外部ライブラリなし。読むときはこのファイルをそのまま開けばよい。

このドキュメントは「どう繋がっているか」を記録する。「何ができるか」は `README.md` を見ること。

## ファイル内の構成順序

1. `<style>` — CSS変数（`--sea-*` が背景色、他は固定パレット）
2. `<body>` — ヘッダー / 3カラムのmain（プリセット・XYパッド・パラメータ）/ フッター
3. `<script>` その1 — メッセージカタログ `I18N`（UI文字列はすべてここ。後述）
4. `<script>` その2（アプリ本体、IIFE）内部、おおよそ上から下へ:
   - 表示言語の決定（`lang`, `t()`）
   - パラメータ定義（`P`, `SLIDERS`, `SEQP`, `HARMP`）
   - プリセット定義（`PRESETS`）
   - `target` / `current`（後述）
   - オーディオグラフ構築（`build()`）
   - `apply()` — current値をオーディオグラフに反映
   - 単発の音（`ping`, `scheduleEvents`）
   - 平滑化ループ（`smooth()`、100ms間隔）
   - シーケンサ（`playStep`, `seqTick`, `mutateBar`）
   - 展開＝コード進行（`chordBar`, `chordStep`, `PROGS`, `CHORD`, `RHY`）
   - UI生成（プリセットボタン、スライダー、シャッフル、ツールチップ）
   - XYパッドの描画ループ（`draw`, マリンスノー, 背景色 `seaColors`）
   - バックグラウンド再生（`tick`, `startClock`, `routeToSink`, `setupMediaSession`）
   - 起動/停止/録音（`startEngine`, `stopEngine`, 自動起動）
   - 表示言語の適用（`applyI18n()`）— DOMが出揃ってから呼ぶので最後

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
master   … dry/reverb/delay の合流点
comp     … DynamicsCompressor
makeup   … コンプで削った分を戻すゲイン (volume が 80 を超えた分だけ持ち上がる)
out      … tanh のソフトクリッパー (WaveShaper)。最終段でピークを 1.0 未満に丸める
           出力先は destination か <audio> 要素 (「バックグラウンド再生」節を見ること)
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
- クロックは `seqTick()`。`AudioContext.currentTime` を基準に約21ms間隔で先読みスケジュール
  （`nextStepTime < ctx.currentTime + .15` の間ループで詰める、Web Audioのタイミング精度確保の定石）。
  この間隔を刻んでいるのは AudioWorklet（「バックグラウンド再生」節）
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

- 音量スライダー (`#s_volume`、0〜100、既定80) だけは他と単位が違う。`volume/80` を `target.level` に
  写す (80 で 1.0 に頭打ち) ので、音源側の `c.level` 参照は従来のまま動く。80 を超えた分は
  `boost = (volume-80)/20` として `apply()` がコンプ (threshold / knee / ratio / attack) と
  `makeup`・`master` に配る。このスライダーも `stopShuffle()` を呼ばない (出力音量であって雰囲気ではない)
- スライダー・XYパッド・プリセットボタンはすべて `target[key]` を書き換えるだけで、
  音への反映は前述の補間ループと `apply()` に一任している。UI側に音声処理は一切ない
- プリセットは `applyPreset(idx, btn)` 経由で適用。手動操作（スライダー/XYパッド/プリセット直接選択）は
  すべて `stopShuffle()` を呼び、シャッフル中の自動切り替えを止める
- シャッフルは読み込み時に `startShuffle()` を呼んで既定でONにしてある。放置しても雰囲気が
  変わり続けるのが既定の体験で、手動操作をした時点でOFFになる
- 切り替え間隔は `shuffleSec` (既定30、範囲10〜120秒)。`#s_shuffleSec` の `input` で即座に
  `setInterval` を張り直す。このスライダーだけは意図的に `stopShuffle()` を呼ばない
  (シャッフルの設定であって、雰囲気の手動操作ではないため)
- XYパッド上の数値表示 (`.overlay`) は既定で縦に4つ積む。iOS の landscape のようにパッドが
  横長 (アスペクト比2以上) になると縦に入りきらないので、`.plane` をコンテナにした
  `@container pad (min-aspect-ratio: 2/1)` で2列2行に折り返す (Issue #21)。
  コンテナクエリ非対応の環境では従来どおり縦積みのまま
- 現在の mood は `updateMood()` が3か所へ同時に反映する（ヘッダーの `#mood` /
  `document.title` / `MediaMetadata`）。`applyPreset()` が `moodIdx` を更新して
  `moodEdited` を落とし、手動操作で呼ばれる `clearPresetHighlight()` が `moodEdited` を立てる。
  立っている間は表示名の末尾に ` (edit)` が付く（Issue #12）
- バージョン文字列は JS の `VERSION` 定数が単一のソース。ヘッダーの `#ver` と
  `MediaMetadata.artist` の両方がここから作られるので、上げるときは1か所だけ直せばよい
- ツールチップは `data-tip` 属性 + 単一の `#tip` 要素を使い回すグローバル委譲方式
  （`mouseover`/`mouseout`/`focusin`/`focusout` をdocumentに1回だけ登録）。
  新しい操作要素にツールチップを足したいときは `data-tip="説明文"` を属性に足すだけでよい
- ツールチップは表示から5秒 (`TIP_LIFE_MS`) で自動的に消える。ポインタを止めていると `mouseout` が
  来ず出しっぱなしになるため (Issue #11)。自動消滅だけは `#tip.fade` で
  0.9秒かけてゆっくり畳み、hover を外したときの 0.12s と区別している。
  消えたあともポインタを動かせば `mouseover` が来て出し直せる

## 表示言語（ja / en）

UI文字列は直書きせず、アプリ本体のIIFEの**外**にあるメッセージカタログ `I18N` に集めてある。
IIFEの外に出しているのは、データ塊を本体と分けて読めるようにするためと、テストから
`page.evaluate(() => Object.keys(I18N.ja))` でキー集合を検査できるようにするため。
classic script のトップレベル `const` はグローバルレキシカルスコープに入るだけなので `window` は汚れない。

```
I18N.ja / I18N.en  ──t(key)──▶  applyI18n()  ──▶  [data-i18n]      textContent
      ▲                              │            [data-i18n-tip]  data-tip 属性
      │                              │            [data-i18n-aria] aria-label 属性
   lang ('ja' | 'en')                └──────────▶ #lang のラベル / 録音ボタン / hideTip()
```

- **キーの命名** — `transport.*` / `tab.*` / `section.*` / `pad.*` / `param.<パラメータ名>` /
  `tip.<パラメータ名 or 要素名>` / `preset.<id>.name` / `preset.<id>.desc` / `footer.*`。
  `param.*` と `tip.*` のキーは `P` のキーとそのまま対応する（`makeSlider()` が
  `param.${key}` / `tip.${key}` を組み立てるので、新しいスライダーはカタログに2件足すだけで表示できる）
- **初期言語** — `localStorage['elevator-one:lang']` に保存値があればそれ、無ければ
  `navigator.languages` に `ja` が含まれるかで決める。`localStorage` が使えない環境（Safari の
  プライベートモード等）でも例外で落ちないよう read/write とも `try` で包んである
- **言語切替で作り直すDOMは無い** — スライダーもプリセットも生成時に `data-i18n*` を付けてあるので、
  `applyI18n()` がDOMを1回走査すれば全部追従する。プリセットの `<small>`（英語名）だけは
  en では見出しと同じ文字列になるため `html[lang="en"] .preset small{display:none}` で隠している
- **例外は録音ボタンだけ** — 「録音 / 停止 / 保存 / 録音不可」は状態で文言が変わるので
  `updateRecLabel()` が `aria-label` と `data-tip` を持つ。`applyI18n()` から呼ばれる
  （再生 / 一時停止は2つのボタンに分けたので状態で変わらず、`data-i18n*` で足りる）
- ヘッダーの ▶ / ⏸ / ● はアイコンだけで文字を持たない (Issue #30)。3つとも `.tbtn.xport` の
  同じ正方形で、文言は `aria-label` と `data-tip` にしかない。表示テキストが無いので
  `data-i18n` は付けず、`data-i18n-aria` / `data-i18n-tip` で言語に追随させる
- 数値と単位（`BPM`, `15s`, `Hz`）は言語非依存なのでカタログに入れない

**文字列を足すとき**は (1) `I18N.ja` と `I18N.en` の両方に同じキーで足す、(2) 要素に
`data-i18n`（または `-tip` / `-aria`）を付ける、の2手順だけ。片方の言語に入れ忘れると
`tests/i18n.spec.js` のキー集合テストが落ちる。

## 自動起動の仕組み

`startEngine()` は `starting` ロックを持つ非同期関数（多重起動防止）。ページ読み込み時に

1. 即座に `startEngine()` を試行（多くの場合ブラウザの自動再生ポリシーでブロックされる）
2. `pointerdown` / `keydown` をcapture phaseでdocumentに仕込み、最初の1回で `startEngine()` を呼んで
   自分自身を解除する

という二段構え。**ブラウザの自動再生ポリシーを回避する完全な方法は存在しない**ため、
「開いたら必ず無音操作なしで鳴る」動作は保証できない。これは実装の不備ではなく制約。

## バックグラウンド再生

iOS の Safari は画面ロックやバックグラウンド遷移で、2つの別々のやり方で音を止めてくる。
どちらも塞がないと鳴り続けない（Issue #6）。

### 1. AudioContext が中断される — 出力を `<audio>` 要素へ移す

`<audio>` / `<video>` 要素の再生は背景でも継続するが、Web Audio 単体は中断される。そこで
発音開始時に `routeToSink()` が出力経路を差し替える。

```
out ──▶ streamDest (MediaStreamDestination) ──▶ <audio>.srcObject   ← 差し替え後
out ──▶ ctx.destination                                             ← 差し替え前 / 失敗時
```

`streamDest` は録音用に元からあったものを共用している。iOS には `play()` が解決しても
音が出ない事例があるため、**`currentTime` が実際に進んだときだけ**成功とみなす
(`sinkAdvances()` が100ms間隔で最大1.5秒見る。固定待ちにすると負荷の高い端末で誤って
失敗と判定してしまう)。成功したときに初めて `out.disconnect(ctx.destination)` する。
失敗したら `<audio>` を止めて destination へ繋ぎ直すので、対応していない環境でも従来どおり鳴る。

判定中に発音を止められることがあるので、停止側は `sinkActive` の確定を待たずに
`<audio>` を止め、判定側も成功時に `running` を見直す。

あわせて `navigator.audioSession.type = 'playback'` の申告（発音ボタンを押した最初、
`ctx` を作る前に行う）と、`MediaSession` のメタデータ / play / pause ハンドラ登録を行う。
ロック画面やコントロールセンターに出る操作ボタンはこれ。

`MediaMetadata` の `title` には現在の mood、`artist` にはアプリ名とバージョン
（`Elevator One v1.3`）を入れる。ロック画面と CarPlay に出るのはこの2つだけなので、
mood が変わるたびに `updateMediaMetadata()` で差し替えている（Issue #12）。

画面上のボタンもロック画面に合わせ、**再生と一時停止を並べてある**（Issue #25）。
`setPowerUI(on)` が両方の `data-on` / `aria-pressed` を更新し、いま置かれている状態の側が
アンバーで点灯する（再生中なら再生ボタン）。ボタン位置が状態で入れ替わらないので押し間違えない。

押下は `startAudio()` / `stopAudio()` に集約してあり、どちらも現在の状態と同じ操作は
何もせずに返る。ロック画面（MediaSession）とスペースキーも同じ関数を通る。

ヘッダーの並びは次の3つで役割を分けてある。

- **再生 / 一時停止 / 録音**（`.tbtn.xport`）— それぞれ ▶ / ⏸ / ● のアイコンを持つ操作ボタン。
  録音は幅によらず ● だけで、状態（録音中はオキサイド、非対応は `disabled`）を色で示す。
  再生と一時停止は狭幅（900px以下）でラベルを `display:none` にしてアイコンに畳み、
  ヘッダーの1行を守る
- **言語切替**（`.sub.lang`）— 操作ボタンではなく表示の切り替えなので、枠を持たせず
  バージョン表示と同じ `.sub` の字面でその隣に置く。押せることは hover と focus で示す

アイコンだけのボタンでも読み上げと説明は落とさない。`aria-label` と `data-tip` は
`data-i18n-aria` / `data-i18n-tip` で言語に追随し、録音ボタンだけは文言が状態でも変わるので
（「録音」「停止 / 保存」「録音不可」）`updateRecLabel()` がこの2つを差し替える。

### 2. `setInterval` / `setTimeout` が絞られる — 時計を音声スレッドへ移す

背景ではタイマーが止まるので、たとえ音が続いてもシーケンサが進まなくなる。そこで
`startClock()` が `AudioWorklet` を1つ立て、128フレーム × 8（約21ms）ごとに
`port.postMessage` でメインスレッドの `tick()` を叩く。ワークレットのコードは単一ファイル
構成を保つため Blob URL で読み込む（`CLOCK_SRC`）。

`tick()` から呼ばれるもの:

| | 間隔 |
| --- | --- |
| `smooth()` — target→current の平滑化、`apply()`、`readout()` | 100ms（`tick` 側で間引く） |
| `seqTick()` — 16ステップの先読みスケジュール | 毎回 |
| `runScheduled()` — 単発音 / グレイン / 根音の移動 | 毎回 |

`runScheduled()` は `setTimeout` の連鎖をやめて `nextEventTime` / `nextGrainTime` /
`nextRootTime`（すべて `ctx.currentTime` 基準）と現在時刻を突き合わせる方式にしてある。
`scheduleEvents()` などは「次の予定時刻を決める」だけの関数になった。

### 3. 鳴り終わったノードの後片付けも音声スレッドへ

発音は音声時計で回り続けるのに後片付けを `setTimeout` に載せていると、背景では**鳴り終わった
ノードがグラフに繋がったまま残り続ける**（Issue #23）。ヘッドレス WebKit で12分測った範囲では
メモリは頭打ちになり破綻しなかったが、繋ぎっぱなしのノードが増え続ける状態そのものが
背景再生の前提と噛み合っていないので、時計と同じ扱いに揃えてある。

そこで `disposeAt(node, at)` / `showStepAt(idx, at)` で予定として積み、`runDisposals()` が
`tick()` から `ctx.currentTime` と突き合わせて実行する。ステップ表示は遅れた分をまとめて
描き直さず、期限が来たもののうち最新の1つだけを反映する。

`runDisposals()` は `tick()` の `running` 判定より**手前**で呼ぶ。発音を止めた直後にも
鳴り終わりを迎えるノードが残っているためで、ここで即座に全部切ってしまうと
フェードアウト中の単発音が途切れる（`flushDisposals()` が捨てるのは表示の予定だけ）。

### 4. 中断されたら自力で戻る

割り込み（通知音・他アプリの再生・電話）で `AudioContext` が `interrupted` に落ちたり、
`<audio>` が pause させられることがある。復帰を `visibilitychange` だけに頼ると、
画面ロック中に止められた場合そのまま無音が続く。`reviveAudio()` を

- `ctx.onstatechange`
- `<audio>` の `pause` / `ended`
- `visibilitychange`
- 保険の `setInterval(4000)`（音声時計は中断中に止まるので、ここだけ通常のタイマー）

の4経路から呼び、`running` なら `ctx.resume()` と `<audio>.play()` を試す。

AudioWorklet が使えない環境では `setInterval(tick, 25)` へフォールバックする。ワークレット
ノードは `comp` に繋いである（destination に繋ぐとテスト用プローブが誤検知するため。出力は無音）。

### 検証できる範囲

`tests/background.spec.js`（`background-chromium` / `background-webkit`）が確かめるのは
「発音時に経路が期待どおり組まれたか」と、次の2点まで。

- **タイマーが絞られても鳴り終わったノードが積み上がらない** — 800ms 以上の `setTimeout` を
  落として背景を模擬し、宛先ごとの生存入力数が頭打ちになることを見る（Issue #23 の修正前は
  20秒で 257 まで伸びる）
- **外から止められても自力で再生に戻る** — `<audio>` を pause させ、`reviveAudio()` が
  鳴らし直すことを見る

**実機でロックしても鳴り続けるかどうかは自動テストでは確かめられない**ので、
iPhone 実機での確認が要る。

## 既知の設計上の制約

### iPadOS では約50分でタブごと落ちる（Issue #23、未解決）

画面をロックしたまま再生し続けると、**50〜55分でページごと落ちる**。音が止まるのではなく
WebContent プロセスが終了しており、前面に戻すとページが読み込み直された状態になる。
落ちる直前まで `ctx.state=running` / `<audio>` 再生中 / 音声時計も生きており、
劣化の兆候なく突然終了する（メモリ圧による OS 側の終了と見られる）。

**アプリ側の対策では直らないことを実測で確認済み。** ノード生成もオートメーションも
完全にゼロにした状態（ドローンのみを鳴らす診断モード）でも 54.2分で落ちた。

| 条件 | ノード生成 | オートメーション | 落ちるまで |
| --- | --- | --- | --- |
| 通常 | 13.8/秒 | 約625/秒 | 50.2分 / 50.6分 |
| オートメーションを1/5に | 13.8/秒 | 126/秒 | 72.1分 |
| 音源をボイス割り当てに | 2.24/秒 | 166/秒 | 53.0分 |
| **蓄積を完全にゼロ** | **0** | **0** | **54.2分** |

72.1分だけが突出しており外れ値と見ている。原因は `AudioContext` + `<audio>` +
MediaStream を長時間動かし続けること自体か、iPadOS のバックグラウンド音声の扱いにある。
経過は Issue #23 に記録した。macOS の Safari では6時間連続再生しても問題ない。

### その他

- ブラウザストレージ（localStorage等）は不使用。設定の永続化は一切なく、リロードで全パラメータが初期値に戻る
- 録音は `MediaRecorder` による `audio/webm` 固定。他形式への変換は行っていない
- オフライン専用。外部ネットワークへの通信は存在しない（CDN等も読み込んでいない）
- キャンバス（XYパッド）は `ResizeObserver` + `window.resize` でサイズ追従するが、
  リサイズ時に `trail`（軌跡）配列をクリアしている（座標系が変わるため）
- 全体レイアウトは `100dvh` 固定で溢れた分は各セクション内スクロール。幅900px以下では1カラムに積み替え、
  高さ720px以下ではプリセットの英字サブラベルなどを間引く専用のメディアクエリが効く
- `viewport-fit=cover` を指定し、ノッチ / ホームインジケータは `body` の
  `padding:env(safe-area-inset-*)` で避ける。指定しないと iOS がページをセーフエリア内に押し込み、
  landscape で上下左右に余白が出る (Issue #9)。背景は padding 領域まで塗られるので画面全体に広がる
