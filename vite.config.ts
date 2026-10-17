import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // chemins relatifs : la version construite est chargée en file:// par Electron
  base: './',
  plugins: [react()],
  resolve: {
    // @vscode/markdown-it-katex embarque son propre KaTeX (0.16) : sans dedupe,
    // l'export rend un markup 0.16 stylé par la CSS 0.18 de l'app (public/katex)
    // → tags \tag{…} non alignés à droite, métriques de polices décalées.
    dedupe: ['katex'],
  },
})
