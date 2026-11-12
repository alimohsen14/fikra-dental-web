import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // the older tests book days ahead and expect them to stay waiting; the WhatsApp rules are tested in messaging.e2e-spec.ts
    env: { AUTO_CONFIRM_WINDOW_HOURS: '0', MESSAGE_SCHEDULER: 'off', TERMS_ENFORCED: 'false' },
  },
});
