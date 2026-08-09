import { test, expect } from '@playwright/test';

/** iPhone/iPad プロファイル (hasTouch) かどうか */
const isTouch = (testInfo) => testInfo.project.use.hasTouch === true;

/** XYパッド上のKPI表示の並び (行数・列数) と、パッドからはみ出していないか */
const overlayLayout = (page) => page.locator('.overlay').evaluate((el) => {
  const box = el.getBoundingClientRect();
  const items = [...el.children].map((c) => c.getBoundingClientRect());
  return {
    rows: new Set(items.map((b) => Math.round(b.y))).size,
    cols: new Set(items.map((b) => Math.round(b.x))).size,
    clipped: items.some((b) => b.y < box.y - 1 || b.bottom > box.bottom + 1),
  };
});

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
  for (const selector of ['#lang', '#play', '#pause', '#plane']) {
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

test('パッドが横長でないときは KPI が縦に4つ並ぶ', async ({ page }) => {
  // 2列2行への切り替えは横長のときだけ (Issue #21)
  const pad = await page.locator('#plane').boundingBox();
  expect(pad.width / pad.height).toBeLessThan(2);
  const { rows, clipped } = await overlayLayout(page);
  expect(rows).toBe(4);
  expect(clipped).toBe(false);
});

// 再生 / 一時停止を並べ、いま置かれている状態の側が点灯する (Issue #25)
test('再生と一時停止が並び、現在の状態の側が点灯する', async ({ page }) => {
  const play = page.locator('#play');
  const pause = page.locator('#pause');

  // 読み込み直後は停止中なので一時停止側が点灯
  await expect(play).toHaveAttribute('data-on', '0');
  await expect(pause).toHaveAttribute('data-on', '1');
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await expect(pause).toHaveAttribute('aria-pressed', 'true');

  await play.click();
  await expect(play).toHaveAttribute('data-on', '1');
  await expect(pause).toHaveAttribute('data-on', '0');
  await expect(play).toHaveAttribute('aria-pressed', 'true');

  // 同じ状態への押下は何も起こさない
  await play.click();
  await expect(play).toHaveAttribute('data-on', '1');

  await pause.click();
  await expect(play).toHaveAttribute('data-on', '0');
  await expect(pause).toHaveAttribute('data-on', '1');
  await pause.click();
  await expect(pause).toHaveAttribute('data-on', '1');
});

// アイコンだけのボタンなので、文言は aria-label が持つ (Issue #30)
test('再生 / 一時停止の読み上げ名は言語に追随する', async ({ page }) => {
  const play = page.locator('#play');
  const pause = page.locator('#pause');
  // プロファイルによって表示言語が違うので、どちらの言語でも通る形で見る
  await expect(play).toHaveAttribute('aria-label', /再生|Play/);
  await expect(pause).toHaveAttribute('aria-label', /一時停止|Pause/);

  await page.locator('#lang').click();
  await expect(play).toHaveAttribute('aria-label', /再生|Play/);
  await expect(pause).toHaveAttribute('aria-label', /一時停止|Pause/);
});

// 2つのボタンが同じ大きさに揃っていること (Issue #30)
test('再生 / 一時停止のボタンは同じ大きさ', async ({ page }) => {
  const boxes = await Promise.all(
    ['play', 'pause'].map((id) => page.locator(`#${id}`).boundingBox())
  );
  expect(Math.abs(boxes[1].width - boxes[0].width)).toBeLessThan(1);
  expect(Math.abs(boxes[1].height - boxes[0].height)).toBeLessThan(1);
  // アイコンだけなので、テキストは持たない
  for (const id of ['play', 'pause']) {
    expect(await page.locator(`#${id}`).innerText()).toBe('');
  }
  // 録音機能は廃止した (Issue #34)
  await expect(page.locator('#rec')).toHaveCount(0);
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

test('シャッフルの間隔スライダーは即座に反映され、シャッフルを止めない', async ({ page }, testInfo) => {
  if (isTouch(testInfo)) await page.locator('#tabs .tab[data-tab="mood"]').tap();
  const slider = page.locator('#s_shuffleSec');
  await expect(slider).toHaveValue('30');
  await expect(slider).toHaveAttribute('min', '10');
  await expect(slider).toHaveAttribute('max', '120');
  await slider.fill('75');
  await slider.dispatchEvent('input');
  await expect(page.locator('#v_shuffleSec')).toHaveText('75s');
  await expect(page.locator('#shuffle')).toHaveAttribute('aria-pressed', 'true');
});

test.describe('現在の mood の表示', () => {
  // シャッフル中は mood タブを開かないと何が鳴っているのか分からなかった (Issue #12)
  const moodText = (page) => page.locator('#mood').textContent();

  test('ヘッダーのバージョンの右に出て、ブラウザのタイトルにも入る', async ({ page }) => {
    const mood = await moodText(page);
    expect(mood).not.toBe('');
    await expect(page).toHaveTitle(`Elevator One — ${mood}`);

    // 並び順は タイトル → バージョン → mood
    const mark = await page.locator('.mark').boundingBox();
    const ver = await page.locator('#ver').boundingBox();
    const box = await page.locator('#mood').boundingBox();
    expect(ver.x).toBeGreaterThan(mark.x + mark.width - 2);
    expect(box.x).toBeGreaterThan(ver.x + ver.width - 2);
    expect(box.y).toBeGreaterThanOrEqual(mark.y);
    expect(box.y).toBeLessThan(mark.y + mark.height);
  });

  test('パラメータを手で変えると末尾に (edit) が付く', async ({ page }, testInfo) => {
    const before = await moodText(page);
    expect(before).not.toMatch(/\(edit\)$/);

    // XYパッドの操作はどのプロファイルでも既定のタブでできる
    const box = await page.locator('#plane').boundingBox();
    const x = box.x + box.width * 0.85;
    const y = box.y + box.height * 0.2;
    if (isTouch(testInfo)) {
      await page.touchscreen.tap(x, y);
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.up();
    }

    await expect(page.locator('#mood')).toHaveText(`${before} (edit)`);
    await expect(page).toHaveTitle(`Elevator One — ${before} (edit)`);
  });

  test('プリセットを選び直すと (edit) が外れてその名前になる', async ({ page }, testInfo) => {
    const box = await page.locator('#plane').boundingBox();
    if (isTouch(testInfo)) {
      await page.touchscreen.tap(box.x + box.width * 0.8, box.y + box.height * 0.3);
      await page.locator('#tabs .tab[data-tab="mood"]').tap();
    } else {
      await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.3);
    }
    await expect(page.locator('#mood')).toHaveText(/\(edit\)$/);

    const preset = page.locator('.preset[aria-pressed]').first();
    const name = await preset.locator('span').first().textContent();
    await preset.click();
    await expect(page.locator('#mood')).toHaveText(name);
  });
});

test.describe('ツールチップ', () => {
  test.skip(({ hasTouch }) => hasTouch, 'hover のあるプロファイルのみ');

  const opacity = (page) =>
    page.locator('#tip').evaluate((el) => parseFloat(getComputedStyle(el).opacity));

  test('hover で出て、5秒でゆっくり消える', async ({ page }) => {
    // ポインタを動かさないと mouseout が来ないので出しっぱなしになっていた (Issue #11)
    await page.locator('#play').hover();
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
    await page.locator('#play').hover();
    await expect(page.locator('#tip')).toHaveClass(/\bon\b/);
    await page.locator('.mark').hover();
    await expect.poll(() => opacity(page), { timeout: 2000 }).toBe(0);
  });

  test('消えたあと同じ要素に hover し直すと出る', async ({ page }) => {
    await page.locator('#play').hover();
    await page.waitForTimeout(6500);
    expect(await opacity(page)).toBe(0);
    await page.locator('.mark').hover();
    await page.locator('#play').hover();
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

  test('横長のパッドでは KPI が2列2行になり、見切れない', async ({ page }) => {
    // 縦に4つ積むと上下がはみ出すので、横幅を使って折り返す (Issue #21)
    const pad = await page.locator('#plane').boundingBox();
    expect(pad.width / pad.height).toBeGreaterThan(2);

    const { rows, cols, clipped } = await overlayLayout(page);
    expect(rows).toBe(2);
    expect(cols).toBe(2);
    expect(clipped).toBe(false);
  });
});
