import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider } from './auth/ThemeContext';
// Self-hosted so the font survives a locked-down CSP and needs no third-party
// request. The variable build is one file for every weight we use.
import '@fontsource-variable/inter';
import './styles.css';

/**
 * Register the service worker, in production only.
 *
 * Skipped in dev because a cached shell is exactly what makes a dev server
 * appear to ignore your edits, and skipped under Capacitor because the native
 * shell already serves the bundle from local disk — a cache in front of local
 * disk buys nothing and adds a way for the two to disagree.
 */
if ((import.meta as any).env?.PROD && 'serviceWorker' in navigator && !(window as any).Capacitor) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // A failed registration must never stop the app loading; it only means
      // no offline shell.
      console.warn('[pwa] service worker registration failed', err);
    });
  });
}

/**
 * Native shell touches, no-ops in a browser.
 *
 * Imported dynamically so the Capacitor bundles never reach the web build —
 * the browser has no use for them and they would be dead weight in the chunk
 * every visitor downloads.
 */
if ((window as any).Capacitor?.isNativePlatform?.()) {
  void (async () => {
    try {
      const [{ StatusBar, Style }, { SplashScreen }] = await Promise.all([
        import('@capacitor/status-bar'),
        import('@capacitor/splash-screen'),
      ]);
      // The topbar is light and the rail is navy; dark content on the status
      // bar is what stays legible against the page behind it.
      await StatusBar.setStyle({ style: Style.Dark });
      await SplashScreen.hide();
    } catch (err) {
      // A missing plugin must never stop the app rendering.
      console.warn('[native] shell setup skipped', err);
    }
  })();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
