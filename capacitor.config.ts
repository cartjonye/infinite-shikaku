import type { CapacitorConfig } from '@capacitor/cli';

/**
 * One web build (dist/) runs as the website and inside the Android app (and the
 * iOS app later). The appId is permanent once published to a store.
 */
const config: CapacitorConfig = {
  appId: 'com.infiniteshikaku.app',
  appName: 'Infinite Shikaku',
  webDir: 'dist',
  backgroundColor: '#12141c',
  android: { backgroundColor: '#12141c' },
  ios: { backgroundColor: '#12141c' },
  plugins: {
    SystemBars: {
      // edge to edge; the CSS already pads with env(safe-area-inset-*)
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
      style: 'DARK', // light icons on the dark game background
    },
  },
};

export default config;
