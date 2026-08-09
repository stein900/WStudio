import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // chemins relatifs : la version construite est chargée en file:// par Electron
  base: './',
  plugins: [react()],
})
