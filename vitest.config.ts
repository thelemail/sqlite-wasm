import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { shared, testOptions } from './vitest.shared.ts';

export default defineConfig({
	...shared,
	test: {
		...testOptions,
		browser: {
			enabled: true,
			headless: true,
			provider: playwright({ persistentContext: true }),
			instances: [{ browser: 'chromium' }, { browser: 'firefox' }]
		}
	}
});
