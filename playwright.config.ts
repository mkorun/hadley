// The browser tests (e2e/): Chromium, Firefox and WebKit against a site hadley built (e2e/serve.ts). Chromium is the
// system's, at HADLEY_E2E_CHROMIUM or /usr/bin/chromium; Firefox and WebKit are Playwright's own builds, which
// `bunx playwright install firefox webkit` fetches, and d0's fetch brings along. WebKit on Linux is WebKit, not Safari.
import { defineConfig, devices } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = 4173

export default defineConfig({
  testDir: 'e2e',
  // nothing in the repository: results and traces go to the temporary directory
  outputDir: join(tmpdir(), 'hadley-e2e-results'),
  reporter: 'list',
  forbidOnly: true,
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `bun e2e/serve.ts ${port}`,
    url: `http://127.0.0.1:${port}/`,
    timeout: 60_000,
    reuseExistingServer: false,
    // so that it removes its temporary site (e2e/serve.ts)
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: process.env.HADLEY_E2E_CHROMIUM ?? '/usr/bin/chromium' },
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
