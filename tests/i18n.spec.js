import { test, expect } from '@playwright/test';

/** ひらがな・カタカナ・漢字 */
const CJK = /[぀-ヿ㐀-鿿]/;

const LANG_KEY = 'elevator-one:lang';

test.describe('ブラウザ言語が日本語のとき', () => {
  test.use({ locale: 'ja-JP' });

  test('日本語で立ち上がる', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(page.locator('#lang')).toHaveText('JA');
    await expect(page.locator('#play')).toHaveAttribute('aria-label', '再生');
    await expect(page.locator('#tabs .tab[data-tab="mood"]')).toHaveText('雰囲気');
    await expect(page.locator('#rec')).toHaveAttribute('aria-label', /録音|録音不可/);
    // プリセットは「静止」+ 英語名の2段表示
    const first = page.locator('.preset').first();
    await expect(first).toContainText('静止');
    await expect(first.locator('small')).toHaveText('stillness');
  });
});

test.describe('ブラウザ言語が日本語以外のとき', () => {
  test.use({ locale: 'en-US' });

  test('英語で立ち上がる', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#lang')).toHaveText('EN');
    await expect(page.locator('#play')).toHaveAttribute('aria-label', 'Play');
    await expect(page.locator('#tabs .tab[data-tab="mood"]')).toHaveText('mood');
    // en では英語名が見出しと重複するので <small> はCSSで隠れる (innerText は display:none を含まない)
    await expect(page.locator('.preset').first()).toHaveText('stillness', { useInnerText: true });
    await expect(page.locator('.preset small').first()).toBeHidden();
  });

  test('画面に日本語が残らない', async ({ page }) => {
    await page.goto('/index.html');

    // 表示されているテキスト
    const text = await page.evaluate(() => document.body.innerText);
    expect(text, '画面に日本語が残っている').not.toMatch(CJK);

    // 隠れているタブ (デスクトップ幅では display:none) と、すべてのツールチップ
    const rest = await page.evaluate(() => [
      ...[...document.querySelectorAll('#tabs .tab')].map((el) => el.textContent),
      ...[...document.querySelectorAll('[data-tip]')].map((el) => el.dataset.tip),
      ...[...document.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label')),
    ].join('\n'));
    expect(rest).not.toMatch(CJK);
  });
});

test.describe('切り替えと永続化', () => {
  test.use({ locale: 'en-US' });

  test('ボタンで切り替わり、リロードしても保たれる', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.locator('#lang').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(page.locator('#lang')).toHaveText('JA');
    await expect(page.locator('#tabs .tab[data-tab="mood"]')).toHaveText('雰囲気');
    // 動的生成されたスライダーとプリセットも追従する
    await expect(page.locator('label[for="s_weight"] span').first()).toHaveText('重さ');
    await expect(page.locator('.preset').first()).toContainText('静止');

    expect(await page.evaluate((k) => localStorage.getItem(k), LANG_KEY)).toBe('ja');

    // ヘッダーの mood 名とブラウザのタイトルも訳し直される (Issue #12)
    const mood = await page.locator('#mood').textContent();
    expect(mood).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    await expect(page).toHaveTitle(`Elevator One — ${mood}`);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(page.locator('#lang')).toHaveText('JA');
  });

  test('保存値を消すとブラウザ言語に戻る', async ({ page }) => {
    await page.goto('/index.html');
    await page.locator('#lang').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

    await page.evaluate((k) => localStorage.removeItem(k), LANG_KEY);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('カタログ', () => {
  test('ja と en でキー集合が一致する', async ({ page }) => {
    await page.goto('/index.html');
    // I18N はIIFEの外のトップレベル const なので、グローバルスコープから引ける
    const { ja, en } = await page.evaluate(() => ({
      ja: Object.keys(I18N.ja).sort(),
      en: Object.keys(I18N.en).sort(),
    }));
    expect(ja.length).toBeGreaterThan(0);
    expect(en, '訳し忘れ / 余分なキーがある').toEqual(ja);
  });

  test('DOMで使われているキーがすべてカタログにある', async ({ page }) => {
    await page.goto('/index.html');
    const { used, missing } = await page.evaluate(() => {
      const attrs = ['data-i18n', 'data-i18n-tip', 'data-i18n-aria'];
      const keys = attrs.flatMap((a) =>
        [...document.querySelectorAll(`[${a}]`)].map((el) => el.getAttribute(a)));
      return {
        used: keys.length,
        missing: [...new Set(keys)].filter((k) => !(k in I18N.ja) || !(k in I18N.en)),
      };
    });
    expect(used).toBeGreaterThan(0);
    expect(missing, '属性のキーがカタログに無い').toEqual([]);
  });
});
