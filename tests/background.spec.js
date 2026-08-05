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

// 出力先の <audio> が実際に鳴り出すまで待つ。
// routeToSink() は再生が進むのを最大1.5秒見てから経路を確定するので、固定待ちにしない
const waitForSink = page => page.waitForFunction(() => {
  const el = document.querySelector('audio');
  return !!el && !el.paused && el.currentTime > 0;
}, null, { timeout: 8000 });

test('発音すると出力が <audio> 要素へ移り、時計が AudioWorklet になる', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByRole('button', { name: /発音|Sound/ }).click();
  await waitForSink(page);

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

// ロック画面 / CarPlay に出る情報。中身は MediaMetadata がすべて (Issue #12)
test('MediaMetadata に現在の mood とアプリ名が入る', async ({ page }) => {
  await page.goto('/index.html');
  const mood = await page.locator('#mood').textContent();
  await page.getByRole('button', { name: /発音|Sound/ }).click();
  await waitForSink(page);

  const meta = () => page.evaluate(() => {
    const m = navigator.mediaSession?.metadata;
    return m && { title: m.title, artist: m.artist };
  });
  expect(await meta()).toEqual({ title: mood, artist: 'Elevator One v1.3' });

  // 手で値を変えると (edit) が付き、ロック画面側にも伝わる
  const box = await page.locator('#plane').boundingBox();
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.3);
  await expect(page.locator('#mood')).toHaveText(`${mood} (edit)`);
  expect((await meta()).title).toBe(`${mood} (edit)`);
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

// iOS のバックグラウンドでは setTimeout が絞られる。音声時計は回り続けるので発音は続き、
// 後片付けを setTimeout に載せていると、鳴り終わったノードだけが積み上がっていく。
// 発火しないクロージャがノードを掴むため GC も効かず、最後はメモリ切れで音が消える (Issue #23)
test('タイマーが絞られても鳴り終わったノードが積み上がらない', async ({ page }) => {
  await page.addInitScript(() => {
    // 後片付け用の長いタイマーだけ落とす。経路判定に使う短いものは残さないと音が出ない
    const origSetTimeout = window.setTimeout;
    window.setTimeout = function (fn, ms, ...rest) {
      return ms >= 800 ? 0 : origSetTimeout.call(window, fn, ms, ...rest);
    };
    // 宛先ごとに、繋がったまま残っている入力の数を数える
    let id = 0;
    const tag = n => n.__id || (n.__id = ++id);
    window.__inputs = new Map();
    const origConnect = AudioNode.prototype.connect;
    const origDisconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.connect = function (dest, ...rest) {
      if (dest instanceof AudioNode) {
        const k = tag(dest);
        (this.__out || (this.__out = [])).push(k);
        window.__inputs.set(k, (window.__inputs.get(k) || 0) + 1);
      }
      return origConnect.call(this, dest, ...rest);
    };
    AudioNode.prototype.disconnect = function (...args) {
      for (const k of this.__out || []) window.__inputs.set(k, window.__inputs.get(k) - 1);
      this.__out = [];
      return origDisconnect.apply(this, args);
    };
  });

  await page.goto('/index.html');
  // シーケンサを確実に鳴らす。狭幅では別タブに隠れていて fill が使えないので値を直に入れる
  await page.evaluate(() => {
    for (const id of ['s_seq', 's_tempo']) {
      const el = document.getElementById(id);
      el.value = '1';
      el.dispatchEvent(new Event('input'));
    }
  });
  await page.getByRole('button', { name: /発音|Sound/ }).click();
  await waitForSink(page);

  const peak = () => page.evaluate(() => Math.max(...window.__inputs.values()));
  await page.waitForTimeout(6000);
  const early = await peak();
  await page.waitForTimeout(20000);
  const late = await peak();

  // 鳴っている最中の音の分は繋がっているが、その数で頭打ちになるはず。
  // 積み上がっていれば 20 秒で数百に達する
  expect(late).toBeLessThan(80);
  expect(late - early).toBeLessThan(40);
});

// 画面ロック中に割り込みで止められても、前面に戻る操作を待たずに鳴らし直す (Issue #23)
test('外から止められても自力で再生に戻る', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByRole('button', { name: /発音|Sound/ }).click();
  await waitForSink(page);

  await page.evaluate(() => document.querySelector('audio').pause());
  await page.waitForFunction(() => !document.querySelector('audio').paused, null, { timeout: 8000 });
  expect(await page.evaluate(() => document.querySelector('audio').paused)).toBe(false);
});

test('発音を止めるとメディア要素も止まる', async ({ page }) => {
  await page.goto('/index.html');
  const power = page.getByRole('button', { name: /発音|Sound/ });
  await power.click();
  await waitForSink(page);
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
  await waitForSink(page);
  const again = await page.evaluate(() => {
    const el = document.querySelector('audio');
    return { playing: !!el && !el.paused && el.currentTime > 0, mediaState: navigator.mediaSession?.playbackState };
  });
  expect(again.playing).toBe(true);
  expect(again.mediaState).toBe('playing');
});
