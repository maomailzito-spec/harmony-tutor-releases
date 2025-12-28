import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss' // Importa tailwind
import autoprefixer from 'autoprefixer' // Importa autoprefixer

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  css: {
    postcss: {
      plugins: [
        tailwindcss,
        autoprefixer,
      ],
    },
  },
})