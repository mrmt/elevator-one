# テスト

`index.html` は Web Audio と DOM 操作そのものが実体なので、実ブラウザを動かす Playwright でテストしている。push すると GitHub Actions (`.github/workflows/ci.yml`) がブランチを問わず同じテストを走らせる。

## ローカル実行

```sh
npm ci
npx playwright install chromium webkit   # 初回のみ
npm test
```

`npm test` は `playwright.config.js` の `webServer` 設定に従って `python3 -m http.server 8123` を自動で起動する。ブラウザ上でテストを追いたいときは `npm run test:ui`。

## プロジェクト構成

`playwright.config.js` の `projects` が検証対象の環境を表す。

| project | 対象 | 実行するテスト |
| --- | --- | --- |
| `audio-chromium` | 音が鳴るか | `tests/audio.spec.js` |
| `background-chromium` | バックグラウンド再生の経路 | `tests/background.spec.js` |
| `background-webkit` | 同上 (iPhone 14 / WebKit) | `tests/background.spec.js` |
| `desktop-chromium` | macOS 相当 (1440x900) | `tests/interaction.spec.js` |
| `mobile-webkit` | iOS 相当 (iPhone 14 / WebKit、英語表示) | `tests/interaction.spec.js` |
| `tablet-webkit` | iPadOS 相当 (iPad gen 7 / WebKit) | `tests/interaction.spec.js` |
| `i18n-chromium` | 表示言語の切り替え | `tests/i18n.spec.js` |

表示言語はブラウザ言語で決まるため、既定の `locale` を `ja-JP` に固定してある（CI環境の既定に
引きずられないように）。`mobile-webkit` だけは `en-US`。英語は日本語より文字列が長く、ヘッダーが
折り返す危険が一番高いのが iPhone 幅なので、狭幅のレイアウト検証は英語で走らせている。

WebKit は iOS/iPadOS Safari と同じエンジンなので、デバイスエミュレーションで「iOS で操作できそうか」を近似している。音の検証はヘッドレス WebKit だと `AudioContext` の resume が不安定なため Chromium だけで行う。

## 音が鳴るかの確かめ方

アプリのオーディオグラフは IIFE の中に閉じていて外から掴めない。`tests/helpers/audio.js` の `installAudioProbe()` が `AudioNode.prototype.connect` をラップし、`AudioDestinationNode` へ繋がる信号を `AnalyserNode` にも分岐させる。テストはそこから波形を読み、ピークが立つこと・停止後に落ちることを確認している。

`master.gain` は `setTargetAtTime` (時定数 1.2s、停止時 2.0s) で変化するため、判定の前に数秒待つ必要がある。`maxPeakOver()` が一定時間ポーリングして最大ピークを返す。

## テストを足すとき

- 音の性質に関わるもの (新しい音源、エフェクト、シーケンサの挙動) → `tests/audio.spec.js` に追加。プローブの波形を見る
- 画面と操作に関わるもの → `tests/interaction.spec.js` に追加。全 project で走るので、狭幅だけ・デスクトップだけの検証は `test.skip(({ viewport }) => ...)` で振り分ける
- UI文字列に関わるもの → `tests/i18n.spec.js` に追加。カタログのキー集合テストと、DOMの
  `data-i18n*` がカタログに存在するかのテストがあるので、文字列を足しただけで訳し忘れや
  属性のタイポは落ちる
- バックグラウンド再生に関わるもの → `tests/background.spec.js` に追加。`page.addInitScript()` で
  `AudioWorkletNode` / `AudioNode.prototype.disconnect` / `setInterval` を包み、どの経路が選ばれたかを
  `window.__probe` に記録している。ロック中に鳴り続けるかは自動テストでは分からないので、実機で見ること
- 新しい環境を足したいとき (例: Android Chrome) → `playwright.config.js` の `projects` に追加する。`testMatch` でどの spec を走らせるか決まる

数値の閾値を置くときは実測値をコメントに残しておくと、後から緩め過ぎ・厳し過ぎを判断しやすい。
