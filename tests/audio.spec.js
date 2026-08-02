import { test, expect } from '@playwright/test';
import { installAudioProbe, readLevel, maxPeakOver } from './helpers/audio.js';

test.describe('音が鳴るか', () => {
  test.beforeEach(async ({ page }) => {
    await installAudioProbe(page);
    await page.goto('/index.html');
  });

  test('読み込み直後は発音していない', async ({ page }) => {
    await expect(page.locator('#power')).toHaveAttribute('aria-pressed', 'false');
    // AudioContext自体がまだ作られていない = プローブも無い
    expect(await readLevel(page)).toBeNull();
  });

  test('発音ボタンでAudioContextが動き、実際に波形が出る', async ({ page }) => {
    await page.locator('#s_level').fill('1'); // 音量を最大にして立ち上がりを速くする
    await page.locator('#power').click();
    await expect(page.locator('#power')).toHaveAttribute('aria-pressed', 'true');

    // master.gain は setTargetAtTime(時定数1.2s) で立ち上がるので数秒観測する
    const { peak, last } = await maxPeakOver(page, 6000);
    expect(last.state).toBe('running');
    expect(peak).toBeGreaterThan(0.01);
  });

  test('発音を止めると無音に戻る', async ({ page }) => {
    await page.locator('#s_level').fill('1');
    await page.locator('#power').click();
    const started = await maxPeakOver(page, 6000);
    expect(started.peak).toBeGreaterThan(0.01);

    await page.locator('#power').click();
    await expect(page.locator('#power')).toHaveAttribute('aria-pressed', 'false');

    // フェードアウト (時定数2.0s) の完了を待ってから測る
    await page.waitForTimeout(8000);
    const stopped = await maxPeakOver(page, 1500);
    expect(stopped.peak).toBeLessThan(started.peak / 10);
  });
});
