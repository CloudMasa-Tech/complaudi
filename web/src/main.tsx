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
// After styles.css, and deliberately so: the marketing sheet re-declares type and
// control rules that styles.css also sets on bare elements, and it wins those
// on source order rather than on specificity alone.
import './landing/landing.css';
import './landing/premium-landing.css';

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
