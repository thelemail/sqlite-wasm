import { defineConfig } from 'vitest/config';
import { webdriverio } from '@vitest/browser-webdriverio';
import { shared, testOptions } from './vitest.shared.ts';

export default defineConfig({
	...shared,
	test: {
		...testOptions,
		fileParallelism: false,
		browser: {
			enabled: true,
			headless: false,
			provider: webdriverio(),
			instances: [{ browser: 'safari' }]
		}
	}
});
