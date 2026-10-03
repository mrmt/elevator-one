// MIDI クロック。実機のポートは無いので、navigator.requestMIDIAccess を偽物に差し替えて
// send() に渡ったバイトとタイムスタンプを記録する。
import { test, expect } from '@playwright/test';

const FAKE_MIDI = () => {
  window.__midi = [];
  const port = {
    id: 'fake-1', name: 'Fake Synth', type: 'output', state: 'connected',
    send(data, ts) { window.__midi.push({ b: data[0], ts: ts ?? performance.now() }); },
    clear() { window.__midi.push({ b: 'clear' }); },
  };
  const access = { outputs: new Map([[port.id, port]]), inputs: new Map(), onstatechange: null };
  navigator.requestMIDIAccess = () => Promise.resolve(access);
};

const msgs = page => page.evaluate(() => window.__midi);
const bpm = async page => parseInt(await page.locator('#bpmlab').textContent(), 10);

// 「接続…」から一覧を取り、偽のポートを選ぶ
async function choosePort(page) {
  const sel = page.locator('#s_midi');
  await sel.selectOption('?');
  await expect(sel.locator('option', { hasText: 'Fake Synth' })).toHaveCount(1);
  await sel.selectOption({ label: 'Fake Synth' });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(FAKE_MIDI);
});

test('出力先を選ぶ行がシーケンサ欄にあり、接続… でポートが並ぶ', async ({ page }) => {
  await page.goto('/index.html');
  const sel = page.locator('#seqparams #s_midi');
  await expect(sel).toBeAttached();
  await expect(sel.locator('option')).toHaveText(['オフ', '接続…']);
  await choosePort(page);
  await expect(sel.locator('option')).toHaveText(['オフ', 'Fake Synth']);
  await expect(sel).toHaveValue('fake-1');
});

test('再生すると Start のあとにテンポどおりの間隔でクロックが出て、停止で Stop が出る', async ({ page }) => {
  await page.goto('/index.html');
  await choosePort(page);
  await page.locator('#play').click();
  await page.waitForTimeout(500);
  const bpm1 = await bpm(page);
  await page.waitForTimeout(3500);
  const bpm2 = await bpm(page);
  await page.locator('#pause').click();

  const m = await msgs(page);
  // 最初は Start。クロックはそのあとに、6発ずつ (16分1つぶん) 出る
  expect(m[0].b).toBe(0xFA);
  expect(m[1].b).toBe(0xF8);
  const clocks = m.filter(x => x.b === 0xF8);
  expect(clocks.length % 6).toBe(0);
  expect(clocks.length).toBeGreaterThan(96);   // 4秒なら 55 BPM でも1小節 (96発) は超える
  expect(clocks[0].ts).toBeGreaterThanOrEqual(m[0].ts);
  // テンポは推移時間をかけて動くので、測り始めと終わりの BPM の間に収まればよい
  const d = clocks.slice(1).map((c, i) => c.ts - clocks[i].ts).sort((a, b) => a - b);
  const median = d[Math.floor(d.length / 2)];
  const lo = 60000 / Math.max(bpm1, bpm2) / 24, hi = 60000 / Math.min(bpm1, bpm2) / 24;
  expect(median).toBeGreaterThan(lo * 0.97);
  expect(median).toBeLessThan(hi * 1.03);
  // タイムスタンプは単調に増える
  expect(d[0]).toBeGreaterThan(0);

  // 止めると予約を捨ててから Stop。以後クロックは増えない
  expect(m.slice(-2).map(x => x.b)).toEqual(['clear', 0xFC]);
  const n = m.length;
  await page.waitForTimeout(800);
  expect((await msgs(page)).length).toBe(n);
});

test('再生中に選ぶと Start から送り始める', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#play').click();
  await page.waitForTimeout(500);
  await choosePort(page);
  await expect.poll(async () => (await msgs(page)).length, { timeout: 8000 }).toBeGreaterThan(6);
  const m = await msgs(page);
  expect(m[0].b).toBe(0xFA);
  expect(m.filter(x => x.b === 0xF8).length % 6).toBe(0);
});

test('オフでは何も送らない', async ({ page }) => {
  await page.goto('/index.html');
  await choosePort(page);
  await page.locator('#s_midi').selectOption('');
  await page.locator('#play').click();
  await page.waitForTimeout(1500);
  expect(await msgs(page)).toEqual([]);
});

test('前回選んだポートは、許可済みなら読み込み時に選び直す', async ({ page, context }) => {
  await context.grantPermissions(['midi']);
  await page.goto('/index.html');
  await choosePort(page);
  await page.reload();
  await expect(page.locator('#s_midi')).toHaveValue('fake-1');
});

test('言語を切り替えると「オフ」「接続…」も追随する', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#lang').click();
  await expect(page.locator('#s_midi option')).toHaveText(['off', 'connect…']);
});

test('Web MIDI の無いブラウザでは行を出さない', async ({ page }) => {
  await page.addInitScript(() => { delete Navigator.prototype.requestMIDIAccess; delete navigator.requestMIDIAccess; });
  await page.goto('/index.html');
  await expect(page.locator('#s_midi')).toHaveCount(0);
});
