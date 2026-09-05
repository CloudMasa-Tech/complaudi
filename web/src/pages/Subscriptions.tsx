
import { useResource } from '../api/useResource';
import type { OnboardedCompany } from '../api/types';
import { Card, Loading, Empty, Badge, fmtDate } from '../components/ui';

export function Subscriptions() {
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
