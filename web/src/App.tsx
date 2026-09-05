import { Navigate, Route, Routes } from 'react-router-dom';
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
import { Login } from './pages/Login';
import { Profile } from './pages/Profile';
import { Register } from './pages/Register';
import { Rules } from './pages/Rules';
import { Subscriptions } from './pages/Subscriptions';
import { Tasks } from './pages/Tasks';
import { Team } from './pages/Team';

function TrialEnded({ endedAt, organization, onSignOut }: {
  endedAt: string; organization: string; onSignOut: () => void;
}) {
  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 460 }}>
        <div className="login-head">
          <div className="brand-mark" style={{ width: 38, height: 38, fontSize: 17 }}>C</div>
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

  // Wait for the session-restore probe so a refresh does not flash the login screen.
  if (!ready) return <Loading label="Starting" />;

  // Signed out, the only two destinations are signing in and signing up.
  if (!user) {
    return (
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Login />} />
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
          <Route path="subscriptions" element={<Subscriptions />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </CompanyProvider>
  );
}
