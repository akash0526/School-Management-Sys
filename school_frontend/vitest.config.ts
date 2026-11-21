import { defineConfig } from 'vitest/config'

// Unit tests for pure logic (formatting, the API wrapper). No jsdom: these modules do not
// need a DOM, and the browser-level behaviour is already covered by tests/e2e/ui.mjs.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
})
