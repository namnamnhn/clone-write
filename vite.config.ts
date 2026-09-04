import path from 'path';
import { cpSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createGeminiBridgeMiddleware } from './server/geminiBridge';
import { resolveGeminiTransportMode } from './server/geminiBridgeMode';

const configDir = path.dirname(fileURLToPath(import.meta.url));

const copyPdfJsAssets = () => ({
  name: 'copy-pdfjs-assets',
  writeBundle(options: { dir?: string }) {
    const outputDir = path.resolve(configDir, options.dir ?? 'dist');
    const pdfAssetDir = path.join(outputDir, 'assets', 'pdfjs');
    mkdirSync(pdfAssetDir, { recursive: true });
    cpSync(path.join(configDir, 'node_modules', 'pdfjs-dist', 'cmaps'), path.join(pdfAssetDir, 'cmaps'), { recursive: true });
    cpSync(path.join(configDir, 'node_modules', 'pdfjs-dist', 'standard_fonts'), path.join(pdfAssetDir, 'standard_fonts'), { recursive: true });
  },
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const serverBridgeEnabled = resolveGeminiTransportMode(process.env) === 'server';
    const bridgeMiddleware = createGeminiBridgeMiddleware();
    const geminiBridgePlugin = {
      name: 'gemini-server-bridge',
      configureServer(server: { middlewares: { use: (handler: typeof bridgeMiddleware) => void } }) {
        if (serverBridgeEnabled) server.middlewares.use(bridgeMiddleware);
      },
      configurePreviewServer(server: { middlewares: { use: (handler: typeof bridgeMiddleware) => void } }) {
        if (serverBridgeEnabled) server.middlewares.use(bridgeMiddleware);
      },
    };
    const browserGeminiKey = serverBridgeEnabled ? 'undefined' : JSON.stringify(env.GEMINI_API_KEY);
    return {
      // Dùng đường dẫn tương đối để bản build có thể được phục vụ từ bất kỳ thư mục con nào.
      // Trình duyệt vẫn chặn ES module khi mở thẳng bằng file://, vì vậy dist kèm START_APP.bat
      // để chạy một HTTP server chỉ lắng nghe trên 127.0.0.1.
      base: './',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      build: {
        target: 'esnext',
        rollupOptions: {
          output: {
            // TÁI CẤU TRÚC BUNDLE: chunk chính từng đạt ~2.18MB vì toàn bộ dependency nằm
            // chung 1 file. Tách theo nhóm vendor để trình duyệt tải song song + cache riêng
            // từng nhóm (khi nâng cấp app, vendor không đổi vẫn được tái sử dụng từ cache).
            // NÂNG CẤP (mục 4.2): pdfjs/docx/jszip đã chuyển sang DYNAMIC import tại điểm gọi
            // (parsers.ts/exporters.ts) và KHÔNG còn được liệt kê trong manualChunks nữa —
            // Rollup tự đặt chúng vào các chunk lazy riêng, chỉ tải khi người dùng thực sự
            // nhập/xuất tài liệu, không còn nằm trong initial load.
            // FIX (bundle split thật sự lỏng lẻo): dạng object ở trên chỉ khớp import CHÍNH XÁC
            // 'react'/'react-dom' — nhưng React 19 + code hiện dùng `react-dom/client` (subpath)
            // để mount app, Rollup không coi đó là cùng module với 'react-dom' nên toàn bộ
            // react-dom (~190KB) vẫn lọt vào main bundle thay vì vào 'vendor-react' (kết quả:
            // vendor-react build ra chỉ ~3-4KB — vô dụng, main bundle vẫn to như chưa tách).
            // SỬA: chuyển sang dạng function, so khớp theo ĐƯỜNG DẪN thật trong node_modules
            // (bắt được mọi subpath: react-dom, react-dom/client, react/jsx-runtime...) thay vì
            // so khớp tên module import tĩnh.
            manualChunks(id) {
              const normalizedId = id.replace(/\\/g, '/');
              if (id.includes('node_modules')) {
                if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/scheduler')) {
                  return 'vendor-react';
                }
                if (id.includes('node_modules/@google/genai')) {
                  return 'vendor-genai';
                }
                if (id.includes('node_modules/lucide-react')) {
                  return 'vendor-icons';
                }
              }
              // Tách runtime dịch/API khỏi UI chính. Đây là code nghiệp vụ lớn, thay đổi theo nhịp khác UI;
              // tách riêng giúp cache ổn định và giữ từng chunk dưới ngưỡng 500 kB mà không đổi luồng chạy.
              if (
                normalizedId.includes('/src/hooks/useTranslator.ts') ||
                normalizedId.includes('/src/hooks/translator/') ||
                normalizedId.includes('/src/hooks/smartFix/') ||
                normalizedId.includes('/src/services/workflows/translate/')
              ) {
                return 'app-translation-runtime';
              }
              if (
                normalizedId.includes('/src/services/api/') ||
                normalizedId.includes('/src/utils/quotaManager.ts')
              ) {
                return 'app-api-runtime';
              }
              // Prompt template (constants/prompts) khá nặng chữ và ít đổi so với code logic —
              // tách riêng để trình duyệt cache lâu dài, không phải tải lại mỗi lần vá UI.
              if (id.includes('/src/prompts')) {
                return 'app-prompts';
              }
            }
          }
        }
      },
      optimizeDeps: {
        esbuildOptions: {
          target: 'esnext'
        }
      },
      plugins: [react(), copyPdfJsAssets(), geminiBridgePlugin],
      define: {
        '__GEMINI_SERVER_BRIDGE__': JSON.stringify(serverBridgeEnabled),
        'process.env.API_KEY': browserGeminiKey,
        'process.env.GEMINI_API_KEY': browserGeminiKey
      },
      resolve: {
        alias: {
          '@': path.resolve(configDir, './src'),
        }
      }
    };
});
