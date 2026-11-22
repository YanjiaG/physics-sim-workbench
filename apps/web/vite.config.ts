import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // 编辑器/工具在源目录写临时文件（.xxx.tmpdir/）时会占用文件句柄，
      // chokidar 去 watch 会抛 EBUSY 直接崩掉 dev server。
      ignored: ['**/.*.tmpdir/**', '**/*.tmp', '**/.cache/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1400,
  },
});
