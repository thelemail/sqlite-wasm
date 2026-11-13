import { fileURLToPath } from 'node:url';
import type { ViteUserConfig } from 'vitest/config';

export const shared = {
	resolve: {
		alias: {
			'@thelemail/sqlite-wasm': fileURLToPath(new URL('./dist/sqlite3.mjs', import.meta.url))
		}
	},
	optimizeDeps: {
		exclude: ['@thelemail/sqlite-wasm']
	}
} satisfies ViteUserConfig;

export const testOptions = {
	include: ['test/**/*.test.ts'],
	testTimeout: 120_000,
	hookTimeout: 60_000
};
