import { test, expect } from '@playwright/test';
import { installAudioProbe, readLevel, maxPeakOver } from './helpers/audio.js';

test.describe('音が鳴るか', () => {
  test.beforeEach(async ({ page }) => {
    await installAudioProbe(page);
    await page.goto('/index.html');
  });

  test('読み込み直後は発音していない', async ({ page }) => {
    await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false');
    // AudioContext自体がまだ作られていない = プローブも無い
    expect(await readLevel(page)).toBeNull();
  });

  test('発音ボタンでAudioContextが動き、実際に波形が出る', async ({ page }) => {
    await page.locator('#s_volume').fill('100'); // 音量を最大にして立ち上がりを速くする
    await page.locator('#play').click();
    await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'true');

    // master.gain は setTargetAtTime(時定数1.2s) で立ち上がるので数秒観測する
    const { peak, last } = await maxPeakOver(page, 6000);
    expect(last.state).toBe('running');
    expect(peak).toBeGreaterThan(0.01);
  });

  test('発音を止めると無音に戻る', async ({ page }) => {
    await page.locator('#s_volume').fill('100');
    await page.locator('#play').click();
    const started = await maxPeakOver(page, 6000);
    expect(started.peak).toBeGreaterThan(0.01);

    await page.locator('#pause').click();
    await expect(page.locator('#play')).toHaveAttribute('aria-pressed', 'false');

    // フェードアウト (時定数2.0s) の完了を待ってから測る
    await page.waitForTimeout(8000);
    const stopped = await maxPeakOver(page, 1500);
    expect(stopped.peak).toBeLessThan(started.peak / 10);
  });
});

test.describe('音量スライダー', () => {
  // プリセットごとに音量差があるので、比較は同じプリセットに固定してから行う
  async function peakAt(page, volume) {
    await installAudioProbe(page);
    await page.goto('/index.html');
    await page.locator('.preset').nth(3).click();   // シャッフルを止めて同じ雰囲気に固定する
    await page.locator('#s_volume').fill(String(volume));
    await page.locator('#play').click();
    await page.waitForTimeout(9000);                // 立ち上がり (時定数1.2s) を待つ
    const { peak } = await maxPeakOver(page, 8000);
    return peak;
  }

  test('80 より上げると音が大きくなり、それでもクリップしない', async ({ page }) => {
    test.setTimeout(120000);
    const base = await peakAt(page, 80);
    const loud = await peakAt(page, 100);
    expect(base).toBeGreaterThan(0.01);
    expect(loud).toBeGreaterThan(base * 1.5);
    expect(loud).toBeLessThan(1);
  });
});
