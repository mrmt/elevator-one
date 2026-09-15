import { test, expect } from '@playwright/test';

// ?vjw で起動したときだけ開く VJ ウィンドウ。VDMX などでキャプチャする素材なので、
// 黒背景・等幅フォント・時間とともに文字列が動き続けることを確かめる

/** VJW を開き、ポップアップを返す。読み込み時にブロックされた場合は再生ボタンで開く */
async function openVJW(page) {
  const popup = page.waitForEvent('popup');
  await page.goto('/index.html?vjw');
  await page.locator('#play').click();
  const vjw = await popup;
  await expect(vjw.locator('#params')).not.toBeEmpty();
  return vjw;
}

test('?vjw が無ければボタンは出ず、再生してもウィンドウは開かない', async ({ page }) => {
  let opened = false;
  page.on('popup', () => { opened = true; });
  await page.goto('/index.html');
  await expect(page.locator('#vjw')).toBeHidden();
  await page.locator('#play').click();
  await page.waitForTimeout(1500);
  expect(opened).toBe(false);
});

test('?vjw で黒背景・等幅フォントの VJ ウィンドウが開く', async ({ page }) => {
  const vjw = await openVJW(page);
  await expect(page.locator('#vjw')).toBeVisible();
  const style = await vjw.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return { bg: cs.backgroundColor, font: cs.fontFamily };
  });
  expect(style.bg).toBe('rgb(0, 0, 0)');
  expect(style.font).toMatch(/Menlo|Monaco|monospace/);
  await expect(vjw).toHaveTitle(/VJW/);
});

test('再生中は表示が動き続け、イベントログが増える', async ({ page }) => {
  const vjw = await openVJW(page);
  const snap = () => vjw.evaluate(() => ({
    top: document.getElementById('top').textContent,
    wave: document.getElementById('wave').textContent,
    logLines: document.getElementById('log').textContent.split('\n').filter(Boolean).length,
  }));
  await expect(vjw.locator('#graph')).toContainText('drone.0', { timeout: 5000 });
  const a = await snap();
  await page.waitForTimeout(3000);
  const b = await snap();
  expect(b.top).not.toBe(a.top);
  expect(b.wave).not.toBe(a.wave);
  expect(b.wave).toMatch(/[0-9A-F]{4}/);
  expect(b.logLines).toBeGreaterThan(a.logLines);
  await expect(vjw.locator('#log')).toContainText('SYS');
  await expect(vjw.locator('#spec')).toContainText('dBFS');
});

test('閉じた VJ ウィンドウをヘッダーのボタンで開き直せる', async ({ page }) => {
  const vjw = await openVJW(page);
  await vjw.close();
  const popup = page.waitForEvent('popup');
  await page.locator('#vjw').click();
  const again = await popup;
  await expect(again.locator('#params')).toContainText('bright');
});
