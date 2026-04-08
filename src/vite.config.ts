// NOTE: This file is intentionally kept renderer-safe (no Node fs/path imports).
// The app uses the root-level `vite.config.ts` for builds.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
