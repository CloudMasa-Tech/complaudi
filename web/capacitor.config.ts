import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native Android and iOS shells around the built React app.
 *
 * One codebase: `npm run build` produces dist/, and `npx cap sync` copies it
 * into the two native projects. There is no second frontend to keep in step.
 *
 * The thing that decides whether the native app works at all is the API origin.
 * Inside the shell the webview is served from capacitor://localhost (iOS) or
 * https://localhost (Android) — there is no server behind it, so a relative
 * "/api/v1/..." resolves to nothing. The app must therefore be built in
 * SUPABASE mode, where resolveApiUrl produces absolute function URLs, or with
 * VITE_API_BASE_URL set to an absolute origin. SUPABASE is the default, so a
 * plain build is already correct; `npm run build:native` makes it explicit.
 *
 * The edge functions answer Access-Control-Allow-Origin: *, so the native
 * origins need no CORS change.
 */
const config: CapacitorConfig = {
  // Permanent once published — the store listing is keyed to it and it cannot
  // be changed afterwards without shipping a new app. Confirm before release.
  appId: 'in.cloudmasa.complaudi',
  appName: 'Complaudi',
  webDir: 'dist',

  android: {
    // https rather than the default http, so the webview counts as a secure
    // context and crypto.subtle, which the auth code uses, is available.
    initialFocus: false,
  },
  server: {
    androidScheme: 'https',
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: '#0d2144',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    StatusBar: {
      // The sidebar and topbar are dark; light content keeps the clock legible.
      style: 'DARK',
      backgroundColor: '#1b3a6b',
    },
  },
};

export default config;
