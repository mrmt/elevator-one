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

test('バージョンがタイトルの右に表示される', async ({ page }) => {
  // 狭幅ではタグラインを省くが、バージョンだけは全プロファイルで残す (Issue #8)
  const ver = page.locator('.ver');
  await expect(ver).toBeVisible();
  await expect(ver).toHaveText(/^v\d+\.\d+/);
  const mark = await page.locator('.mark').boundingBox();
  const box = await ver.boundingBox();
  // タイトルの右、かつ同じ行にある
  expect(box.x).toBeGreaterThanOrEqual(mark.x + mark.width - 2);
  expect(box.y).toBeGreaterThanOrEqual(mark.y);
  expect(box.y).toBeLessThan(mark.y + mark.height);
  // タイトルより小さい文字
  const size = (sel) => page.locator(sel).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await size('.ver')).toBeLessThan(await size('.mark'));
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

test.describe('ツールチップ', () => {
  test.skip(({ hasTouch }) => hasTouch, 'hover のあるプロファイルのみ');

  const opacity = (page) =>
    page.locator('#tip').evaluate((el) => parseFloat(getComputedStyle(el).opacity));

  test('hover で出て、5秒でゆっくり消える', async ({ page }) => {
    // ポインタを動かさないと mouseout が来ないので出しっぱなしになっていた (Issue #11)
    await page.locator('#power').hover();
    await expect(page.locator('#tip')).toHaveClass(/\bon\b/);
    await expect(page.locator('#tip')).toHaveText(/.+/);
    // フェードイン (.12s) を待ってから測る
    await expect.poll(() => opacity(page), { timeout: 2000 }).toBe(1);

    // 4秒の時点ではまだ出ている (寿命は5秒)
    await page.waitForTimeout(4000);
    expect(await opacity(page)).toBeGreaterThan(0.9);

    // 5秒を越えるとフェードが始まり、0.9秒かけて消える
    await page.waitForTimeout(1500);
    expect(await opacity(page)).toBeLessThan(0.9);
    await expect.poll(() => opacity(page), { timeout: 3000 }).toBe(0);
  });

  test('ポインタを外すとすぐ消える', async ({ page }) => {
    await page.locator('#power').hover();
    await expect(page.locator('#tip')).toHaveClass(/\bon\b/);
    await page.locator('.mark').hover();
    await expect.poll(() => opacity(page), { timeout: 2000 }).toBe(0);
  });

  test('消えたあと同じ要素に hover し直すと出る', async ({ page }) => {
    await page.locator('#power').hover();
    await page.waitForTimeout(6500);
    expect(await opacity(page)).toBe(0);
    await page.locator('.mark').hover();
    await page.locator('#power').hover();
    await expect(page.locator('#tip')).toHaveClass(/\bon\b/);
    await expect.poll(() => opacity(page), { timeout: 2000 }).toBe(1);
  });
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

  // タブ自体が XY パッドであることを示すので、見出し行は重複
  test('XYパッドの見出し行は出ない', async ({ page }) => {
    await expect(page.locator('#tab-pad > .eyebrow')).toBeHidden();
  });
});

test.describe('デスクトップ (macOS)', () => {
  test.skip(({ viewport }) => viewport.width <= 900, 'デスクトップ幅のみ');

  test('XYパッドの見出し行が出る', async ({ page }) => {
    await expect(page.locator('#tab-pad > .eyebrow')).toBeVisible();
  });

  test('3カラムが同時に見えていてタブバーは出ない', async ({ page }) => {
    await expect(page.locator('#tabs')).toBeHidden();
    for (const section of ['#tab-mood', '#tab-pad', '#tab-sound']) {
      await expect(page.locator(section)).toBeVisible();
    }
  });
});

test.describe('iOS landscape', () => {
  test.skip(({ hasTouch }) => !hasTouch, 'タッチ端末プロファイルのみ');

  // iPhone 16 landscape 相当
  test.use({ viewport: { width: 874, height: 402 } });

  test('viewport-fit=cover を指定している', async ({ page }) => {
    // 指定しないと iOS はページをセーフエリア内に押し込み、上に余白が出る (Issue #9)
    const meta = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(meta).toContain('viewport-fit=cover');
  });

  test('セーフエリアを避けても上端に余白が出ず1画面に収まる', async ({ page }) => {
    // safe-area の値は WebKit のエミュレーションでは 0 になるため、
    // 実機 (iPhone 16 landscape: 左右59px / 下21px、上は0) の inset を手で当てて確かめる
    await page.evaluate(() => { document.body.style.padding = '0 59px 21px 59px'; });
    const header = await page.locator('header').boundingBox();
    expect(header.y).toBe(0);
    expect(header.x).toBe(59);
    const { scrollHeight, clientHeight } = await page.evaluate(() => ({
      scrollHeight: document.scrollingElement.scrollHeight,
      clientHeight: document.scrollingElement.clientHeight,
    }));
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);
  });
});
