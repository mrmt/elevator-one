// @ts-check
import { defineConfig, devices } from '@playwright/test';

const PORT = 8123;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    // 表示言語はブラウザ言語で決まるので、既定を固定しないとCI環境依存になる
    locale: 'ja-JP',
  },

  // 静的HTML1枚なので配信はpython3で足りる (ubuntu/macOSともに標準搭載)
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },

  projects: [
    // 音の検証。ヘッドレスWebKitはAudioContextのresumeが不安定なためChromiumのみ
    {
      name: 'audio-chromium',
      testMatch: /audio\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
    // バックグラウンド再生の経路。iOS が対象なのでWebKitでも走らせる
    {
      name: 'background-chromium',
      testMatch: /background\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
    {
      name: 'background-webkit',
      testMatch: /background\.spec\.js/,
      use: { ...devices['iPhone 14'] },
    },
    // macOS相当。3カラムのデスクトップレイアウト
    {
      name: 'desktop-chromium',
      testMatch: /interaction\.spec\.js/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // iOS相当。WebKit + タッチ。
    // 英語は日本語より文字列が長く、ヘッダーが折り返す危険が一番高いのがこの幅なので、
    // 狭幅のレイアウト検証だけは英語で走らせる
    {
      name: 'mobile-webkit',
      testMatch: /interaction\.spec\.js/,
      use: { ...devices['iPhone 14'], locale: 'en-US' },
    },
    // iPadOS相当
    {
      name: 'tablet-webkit',
      testMatch: /interaction\.spec\.js/,
      use: { ...devices['iPad (gen 7)'] },
    },
    // 表示言語。locale はテスト側の test.use() で切り替える
    {
      name: 'i18n-chromium',
      testMatch: /i18n\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
