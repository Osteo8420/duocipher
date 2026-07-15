import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Chat Sécurisé',
        short_name: 'SecureChat',
        description: 'Messagerie chiffrée de bout en bout, sans dépendance de confiance',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        icons: [
          { src: 'icon.svg', sizes: '512x512', type: 'image/svg+xml' }
        ]
      }
    })
  ]
});
