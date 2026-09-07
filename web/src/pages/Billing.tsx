import { useAuth } from '../auth/AuthContext';
import { useResource } from '../api/useResource';
import type { OnboardedCompany } from '../api/types';
import { Card, Loading, Empty, Badge, fmtDate } from '../components/ui';

function SuperAdminBilling() {
  const { data: companies, error } = useResource<OnboardedCompany[]>('/companies/onboarded-overview');

  if (error) {
    return <div className="alert alert-error">{error}</div>;
  }

  if (!companies) {
    return <Loading label="Loading subscriptions" />;
  }

  if (companies.length === 0) {
    return <Empty>No organizations onboarded yet.</Empty>;
  }

  return (
    <Card title="Subscriptions & Upgrades">
      <div style={{ overflowX: 'auto', padding: '0 16px 16px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '12px 8px', fontWeight: 600 }}>Company</th>
              <th style={{ padding: '12px 8px', fontWeight: 600 }}>Workspace</th>
              <th style={{ padding: '12px 8px', fontWeight: 600 }}>Onboarded</th>
              <th style={{ padding: '12px 8px', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '12px 8px', fontWeight: 600 }}>Plan</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => {
              const isTrial = c.organization.trialEndsAt !== null;
              const trialEndsAt = c.organization.trialEndsAt;
              let daysLeft = null;
              if (isTrial && trialEndsAt) {
                daysLeft = Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000));
              }

              return (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 8px' }}>
                    <div style={{ fontWeight: 500 }}>{c.legalName}</div>
                    <span className="dim tiny">{c.entityType}</span>
                  </td>
                  <td style={{ padding: '12px 8px' }}>{c.organization.name}</td>
                  <td style={{ padding: '12px 8px' }}>{fmtDate(c.onboardedAt)}</td>
                  <td style={{ padding: '12px 8px' }}>
                    <Badge value={c.status === 'ACTIVE' ? 'success' : 'dim'}>
                      {c.status}
                    </Badge>
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    {isTrial ? (
                      <span className="badge badge-warning">
                        Free Trial {daysLeft !== null && `(${daysLeft}d)`}
                      </span>
                    ) : (
                      <span className="badge badge-success">Upgraded</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function WorkspaceBilling({ trialDaysLeft, organization, canUpdate, createdAt }: { trialDaysLeft: number | null, organization: string, canUpdate: boolean, createdAt: string }) {
  const isTrial = trialDaysLeft !== null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Card title="Billing Details">
        <div style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Current Plan</h3>
          {isTrial ? (
            <div style={{ marginBottom: 16 }}>
              <span className="badge badge-warning" style={{ fontSize: 14, padding: '4px 8px' }}>
                14-Day Free Trial
              </span>
              <div style={{ marginTop: 12, display: 'flex', gap: 24, fontSize: 14 }}>
                <div>
                  <span className="dim">Onboarded on:</span>{' '}
                  <strong>{fmtDate(createdAt)}</strong>
                </div>
                <div>
                  <span className="dim">Trial remaining:</span>{' '}
                  <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''}</strong>
                </div>
              </div>
              <p className="dim" style={{ marginTop: 12 }}>
                This workspace has {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} left in its trial.
                {canUpdate && ' Upgrade now to ensure uninterrupted access.'}
              </p>
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <span className="badge badge-success" style={{ fontSize: 14, padding: '4px 8px' }}>
                Upgraded Version
              </span>
              <div style={{ marginTop: 12, display: 'flex', gap: 24, fontSize: 14 }}>
                <div>
                  <span className="dim">Onboarded on:</span>{' '}
                  <strong>{fmtDate(createdAt)}</strong>
                </div>
              </div>
              <p className="dim" style={{ marginTop: 12 }}>
                Your workspace <strong>{organization}</strong> is on the active paid plan.
              </p>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>Plan details</h4>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card-alt)', padding: 16, borderRadius: 6 }}>
              <div>
                <div style={{ fontWeight: 600 }}>Standard Monthly</div>
                <div className="dim tiny">Billed monthly</div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>
                $20 <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-dim)' }}>/ month</span>
              </div>
            </div>
          </div>
        </div>
      </Card>
      
      <Card title="Payment Method">
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: 'var(--surface-2)', padding: '8px 12px', borderRadius: 4, fontWeight: 600, border: '1px solid var(--border)' }}>
              VISA
            </div>
            <div>
              <div style={{ fontWeight: 500 }}>Visa ending in 4242</div>
              <div className="dim tiny">Expires 12/2028</div>
            </div>
          </div>
          {canUpdate && (
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-sm">Update payment method</button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export function Billing() {
  const { user } = useAuth();

  if (!user) return null;

  if (user.role === 'SUPER_ADMIN') {
    return <SuperAdminBilling />;
  }

  if (user.role === 'COMPANY_OWNER') {
    return <WorkspaceBilling trialDaysLeft={user.trialDaysLeft} organization={user.organization.name} canUpdate={true} createdAt={user.createdAt} />;
  }

  // Admin, CA, Viewer
  return <WorkspaceBilling trialDaysLeft={user.trialDaysLeft} organization={user.organization.name} canUpdate={false} createdAt={user.createdAt} />;
}
