import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss' // Importa tailwind
import autoprefixer from 'autoprefixer' // Importa autoprefixer

function getDefaultPort() {
  const raw = String(process.env.APP_FLAVOR || process.env.VITE_APP_FLAVOR || '').toLowerCase();
  if (raw === 'guitar') return 5174;
  if (raw === 'united') return 5175;
  // grandstaff (default)
  return 5173;
}

function getPort() {
  const raw = String(process.env.VITE_PORT || '').trim();
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return getDefaultPort();
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: getPort(),
    strictPort: true,
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss,
        autoprefixer,
      ],
    },
  },
})