import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], env:{VITE_SUPABASE_URL:'',VITE_SUPABASE_PUBLISHABLE_KEY:''}, exclude: ['node_modules/**', 'dist/**'], testTimeout: 20000 }
});
