import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup/vscode.runtime.mjs'],
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        // Pure TypeScript interfaces — zero executable code
        'src/domain/entities/InsightsReport.ts',
        'src/domain/entities/Operation.ts',
        'src/domain/interfaces/index.ts',
        // VS Code extension entry-point — requires real activation context
        'src/extension.ts',
      ],
    },
  },
});