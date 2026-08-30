import { defineConfig } from 'vitest/config';

// Cấu hình Vitest độc lập với vite.config.ts (không load plugin React/PostCSS —
// các test chỉ nhắm vào hàm thuần, chạy trong môi trường node).
export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
