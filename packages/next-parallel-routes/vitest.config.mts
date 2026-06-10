import { defineConfig } from 'vitest/config'

// Plugin source files (index.cjs, macro.cjs, preload.cjs) live at the
// package root, not under src/. Tests live under `test/`.
export default defineConfig({
  test: {
    name: 'next-parallel-routes',
    include: ['test/**/*.test.ts'],
  },
})
