import { test, expect } from '@playwright/test';

/** iPhone/iPad プロファイル (hasTouch) かどうか */
const isTouch = (testInfo) => testInfo.project.use.hasTouch === true;

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html');
});

test('ページ全体がスクロールしない', async ({ page }) => {
  // 縦積みでページが伸びると背景グラデーションがせり上がる (Issue #2) ため、
  // 全プロファイルで1画面に収まっていることを保証する
  const { scrollHeight, clientHeight } = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement.scrollHeight,
    clientHeight: document.scrollingElement.clientHeight,
  }));
  expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);
});

test('ヘッダーのボタンとXYパッドがビューポート内に収まる', async ({ page }) => {
  const viewport = page.viewportSize();
  for (const selector of ['#lang', '#power', '#plane']) {
    const box = await page.locator(selector).boundingBox();
    expect(box, `${selector} が見えていない`).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  }
});

test('XYパッドが操作に足るサイズを持つ', async ({ page }) => {
  // セクションが1画面に詰め込まれるとパッドが潰れて事実上操作できなくなる (Issue #2)。
  // 実測値は iPhone 375px / iPad 821px / desktop 662px、潰れると 111px まで縮む
  const viewport = page.viewportSize();
  const box = await page.locator('#plane').boundingBox();
  expect(box.height).toBeGreaterThan(200);
  expect(box.height / viewport.height).toBeGreaterThan(0.3);
  expect(box.width / viewport.width).toBeGreaterThan(0.3);
});

test('発音ボタンがトグルする', async ({ page }) => {
  const power = page.locator('#power');
  await expect(power).toHaveAttribute('aria-pressed', 'false');
  await power.click();
  await expect(power).toHaveAttribute('aria-pressed', 'true');
  await power.click();
  await expect(power).toHaveAttribute('aria-pressed', 'false');
});

test('XYパッドの操作で明るさが変わる', async ({ page }, testInfo) => {
  const box = await page.locator('#plane').boundingBox();
  const before = await page.locator('#rb').textContent();

  const x = box.x + box.width * 0.85;
  const y = box.y + box.height * 0.2;
  if (isTouch(testInfo)) {
    await page.touchscreen.tap(x, y);
  } else {
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.up();
  }

  await expect(page.locator('#rb')).not.toHaveText(before);
});

test('プリセットを選ぶと選択状態になり、シャッフルが解除される', async ({ page }, testInfo) => {
  if (isTouch(testInfo)) await page.locator('#tabs .tab[data-tab="mood"]').tap();
  const preset = page.locator('.preset[aria-pressed]').first();
  await preset.click();
  await expect(preset).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#shuffle')).toHaveAttribute('aria-pressed', 'false');
});

test('シャッフルが既定でONになっている', async ({ page }, testInfo) => {
  if (isTouch(testInfo)) await page.locator('#tabs .tab[data-tab="mood"]').tap();
  await expect(page.locator('#shuffle')).toHaveAttribute('aria-pressed', 'true');
  // 起動時に1件が適用されるので、どれかが選択状態になっている
  await expect(page.locator('.preset[aria-pressed="true"]')).toHaveCount(1);
});

test.describe('狭幅 (iOS / iPadOS)', () => {
  test.skip(({ viewport }) => viewport.width > 900, '狭幅レイアウトのみ');

  test('タブで3セクションを切り替えられる', async ({ page }) => {
    const main = page.locator('#main');
    await expect(main).toHaveAttribute('data-tab', 'pad');
    await expect(page.locator('#tab-pad')).toBeVisible();
    await expect(page.locator('#tab-mood')).toBeHidden();

    for (const [tab, section] of [
      ['mood', '#tab-mood'],
      ['sound', '#tab-sound'],
      ['pad', '#tab-pad'],
    ]) {
      await page.locator(`#tabs .tab[data-tab="${tab}"]`).tap();
      await expect(main).toHaveAttribute('data-tab', tab);
      await expect(page.locator(section)).toBeVisible();
      await expect(page.locator(`#tabs .tab[data-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
    }
  });

  test('タブバーが表示される', async ({ page }) => {
    await expect(page.locator('#tabs')).toBeVisible();
  });
});

test.describe('デスクトップ (macOS)', () => {
  test.skip(({ viewport }) => viewport.width <= 900, 'デスクトップ幅のみ');

  test('3カラムが同時に見えていてタブバーは出ない', async ({ page }) => {
    await expect(page.locator('#tabs')).toBeHidden();
    for (const section of ['#tab-mood', '#tab-pad', '#tab-sound']) {
      await expect(page.locator(section)).toBeVisible();
    }
  });
});
