import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { CompanyProvider } from './auth/CompanyContext';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { Calendar } from './pages/Calendar';
import { Companies } from './pages/Companies';
import { CompanyEdit } from './pages/CompanyEdit';
import { CompanyNew } from './pages/CompanyNew';
import { Copilot } from './pages/Copilot';
import { Dashboard } from './pages/Dashboard';
import { Documents } from './pages/Documents';
import { ForgotPassword } from './pages/ForgotPassword';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Profile } from './pages/Profile';
import { Register } from './pages/Register';
import { ResetPassword } from './pages/ResetPassword';
import { Rules } from './pages/Rules';
import { Billing } from './pages/Billing';
import { Analytics } from './pages/Analytics';
import { Tasks } from './pages/Tasks';
import { Team } from './pages/Team';

const APP_TITLE = 'Complaudi — An AI Platform for compliance Audit';
const LANDING_TITLE = 'Complaudi | Business Compliance & Verification Platform';
const LANDING_DESCRIPTION =
  'Complaudi helps Indian businesses manage registrations, verification, documents and compliance from one simple platform.';

function setMeta(name: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

/**
 * Title and robots for the public marketing page, and `noindex` for everything
 * behind the session gate.
 *
 * This lives here rather than inside Landing, because a component that sets the
 * title on mount can only restore the old one on unmount — which does nothing
 * for a hard load straight into /login, and the SPA would then serve the
 * marketing title on a private page. Keying it to the route is the only version
 * that is correct on the first paint.
 */
function useDocumentMeta(isLanding: boolean) {
  useEffect(() => {
    document.title = isLanding ? LANDING_TITLE : APP_TITLE;
    setMeta('description', LANDING_DESCRIPTION);
    setMeta('robots', isLanding ? 'index, follow' : 'noindex, nofollow');
  }, [isLanding]);
}

function TrialEnded({ endedAt, organization, onSignOut }: {
  endedAt: string; organization: string; onSignOut: () => void;
}) {
  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 460 }}>
        <div className="login-head">
          <img src="/logo.png" alt="Complaudi" style={{ height: 38, objectFit: 'contain' }} />
          <h1 style={{ marginTop: 8 }}>Your trial has ended</h1>
          <p className="muted tiny">
            The 14 days for {organization} finished on {new Date(endedAt).toLocaleDateString()}.
          </p>
        </div>
        <div className="card">
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>
              Nothing has been deleted. Your company, its compliance calendar and any evidence you attached are
              all still here — the account simply cannot be opened until it is upgraded.
            </p>
            <a className="btn btn-primary" href="mailto:sales@example.com?subject=Compliance%20Toolkit%20account"
               style={{ justifyContent: 'center' }}>
              Get in touch to continue
            </a>
            <button className="btn-ghost btn-sm" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { user, ready, logout } = useAuth();
  const { pathname } = useLocation();

  // Signed out, the marketing page is the front door and the two account pages
  // sit behind it. Login used to be the catch-all, which meant a shared link
  // landed on a sign-in form; now an unknown path gets the landing page and the
  // CTAs on it resolve to /register.
  const ACCOUNT_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password'];
  // The landing page is the catch-all, so a hard load of any *other* unknown
  // path is the indexable page. `ready` is included because the session probe
  // has not answered yet on first paint, and the marketing page is what that
  // paint will show.
  const isLanding = !user && !ACCOUNT_ROUTES.includes(pathname);

  // Unconditional and above every early return: this has to run on the first
  // paint of a hard load into any route, which a hook placed inside a branch
  // below would miss.
  useDocumentMeta(isLanding);

  // Password reset lives outside the session gate: a signed-in user who clicked
  // the emailed link must still land here, and a refresh must not flash login.
  if (pathname === '/forgot-password') return <ForgotPassword />;
  if (pathname === '/reset-password') return <ResetPassword />;

  // Wait for the session-restore probe so a refresh does not flash the login screen.
  if (!ready) return <Loading label="Starting" />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // An expired trial keeps its data and its login; it simply cannot reach the
  // application. Saying so plainly beats letting every request fail.
  if (user.trialEndsAt && new Date(user.trialEndsAt).getTime() < Date.now()) {
    return <TrialEnded endedAt={user.trialEndsAt} organization={user.organization.name} onSignOut={logout} />;
  }

  return (
    <CompanyProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="documents" element={<Documents />} />
          <Route path="companies" element={<Companies />} />
          <Route path="companies/new" element={<CompanyNew />} />
          <Route path="companies/:id/edit" element={<CompanyEdit />} />
          <Route path="copilot" element={<Copilot />} />
          <Route path="rules" element={<Rules />} />
          <Route path="team" element={<Team />} />
          <Route path="profile" element={<Profile />} />
          <Route path="billing" element={<Billing />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </CompanyProvider>
  );
}
