// iOS でバックグラウンド / 画面ロック中も鳴り続けるための経路が、
// 発音開始時にきちんと組み上がるかを見る。
// 実機での継続再生そのものは自動テストでは確かめられないので、
// ここで見るのは「経路が期待どおり選ばれたか」まで。
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__probe = { worklet: false, detached: false, interval25: false };
    const OrigWorkletNode = window.AudioWorkletNode;
    if (OrigWorkletNode) {
      window.AudioWorkletNode = class extends OrigWorkletNode {
        constructor(...args) { super(...args); window.__probe.worklet = true; }
      };
    }
    const origDisconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.disconnect = function (dest, ...rest) {
      if (dest instanceof AudioDestinationNode) window.__probe.detached = true;
      return origDisconnect.call(this, dest, ...rest);
    };
    // 音声時計に失敗したときだけ使われるフォールバック
    const origSetInterval = window.setInterval;
    window.setInterval = function (fn, ms, ...rest) {
      if (ms === 25) window.__probe.interval25 = true;
      return origSetInterval.call(window, fn, ms, ...rest);
    };
  });
});

test('発音すると出力が <audio> 要素へ移り、時計が AudioWorklet になる', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByRole('button', { name: /発音|Sound/ }).click();
  await page.waitForTimeout(2000);   // routeToSink() の再生確認 (400ms) を待つ

  const state = await page.evaluate(() => {
    const el = document.querySelector('audio');
    return {
      ...window.__probe,
      playing: !!el && !el.paused && el.currentTime > 0,
      mediaState: navigator.mediaSession?.playbackState,
      hasMetadata: !!navigator.mediaSession?.metadata,
    };
  });

  expect(state.playing).toBe(true);       // メディア要素として実際に鳴っている
  expect(state.detached).toBe(true);      // ctx.destination からは切り離した (二重再生しない)
  expect(state.worklet).toBe(true);       // 音声スレッドの時計が立ち上がった
  expect(state.interval25).toBe(false);   // フォールバックへ落ちていない
  expect(state.mediaState).toBe('playing');
  expect(state.hasMetadata).toBe(true);   // ロック画面に出す情報を申告した
});

test('音声時計がシーケンサを進め続ける', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByRole('button', { name: /発音|Sound/ }).click();
  await page.waitForTimeout(1000);

  const nowStep = () => page.evaluate(
    () => [...document.querySelectorAll('#steps i')].findIndex(e => e.classList.contains('now'))
  );
  const before = await nowStep();
  await page.waitForTimeout(700);
  const after = await nowStep();

  expect(before).toBeGreaterThanOrEqual(0);
  expect(after).not.toBe(before);
});

test('発音を止めるとメディア要素も止まる', async ({ page }) => {
  await page.goto('/index.html');
  const power = page.getByRole('button', { name: /発音|Sound/ });
  await power.click();
  await page.waitForTimeout(1500);
  await power.click();
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => ({
    paused: document.querySelector('audio')?.paused,
    mediaState: navigator.mediaSession?.playbackState,
  }));
  expect(state.paused).toBe(true);
  expect(state.mediaState).toBe('paused');

  // 鳴らし直したときに <audio> が止まったままにならないこと
  await power.click();
  await page.waitForTimeout(1000);
  const again = await page.evaluate(() => {
    const el = document.querySelector('audio');
    return { playing: !!el && !el.paused && el.currentTime > 0, mediaState: navigator.mediaSession?.playbackState };
  });
  expect(again.playing).toBe(true);
  expect(again.mediaState).toBe('playing');
});
