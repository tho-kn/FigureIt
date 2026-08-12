import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:1420', trace: 'off', video: 'off', screenshot: 'off' },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 1420',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: true,
  },
})
