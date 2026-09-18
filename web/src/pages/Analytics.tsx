import { useAuth } from '../auth/AuthContext';
import { useResource } from '../api/useResource';
import { Card, Stat, Loading, Empty, ErrorNote, PaymentStatusBadge, fmtDate, fmtDateTime } from '../components/ui';
import type { AnalyticsView } from '../api/types';

const ORG_BUCKETS: { key: keyof AnalyticsView['organisations']; label: string; hint: string }[] = [
  { key: 'total', label: 'Organisations', hint: 'all workspaces on the platform' },
  { key: 'onTrial', label: 'On trial', hint: 'free trial window not yet over' },
  { key: 'payingNow', label: 'Paying now', hint: 'a confirmed payment is on record' },
  { key: 'fullUnbilled', label: 'Full accounts', hint: 'originally exempt from billing' },
  { key: 'trialExpired', label: 'Trial expired', hint: 'trial over, never paid' },
  { key: 'churned', label: 'Churned', hint: 'paid at least once, coverage lapsed' },
];

export function Analytics() {
  const { user } = useAuth();
  const { data, error, initial } = useResource<AnalyticsView>('/billing/analytics');

  if (user && user.role !== 'SUPER_ADMIN') {
    return <Empty>Platform analytics are restricted to platform administrators.</Empty>;
  }

  if (error) {
    return <ErrorNote error={error} />;
  }

  if (initial || !data) {
    return <Loading label="Loading platform analytics" />;
  }

  const maxTrend = data.trend.reduce((m, t) => Math.max(m, t.amountPaise), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ margin: 0 }}>Platform Analytics</h1>
        <p className="dim" style={{ margin: '4px 0 0' }}>
          Every figure below comes from real Payment rows captured by Razorpay — nothing is estimated.
        </p>
      </div>

      <Card title="Revenue" note="captured payments only">
        <div className="grid grid-4" style={{ padding: 16 }}>
          <Stat label={data.revenueLabels.allTime} value={fmtINR(data.revenue.allTime)} />
          <Stat label={data.revenueLabels.thisMonth} value={fmtINR(data.revenue.thisMonth)} />
          <Stat label={data.revenueLabels.thisYear} value={fmtINR(data.revenue.thisYear)} />
          <Stat label={data.revenueLabels.fiscalYear} value={fmtINR(data.revenue.fiscalYear)} />
        </div>
      </Card>

      <Card title="Organisations" note="bucket each workspace by subscription state">
        <div className="grid grid-4" style={{ padding: 16 }}>
          {ORG_BUCKETS.map((b) => (
            <Stat key={b.key} label={b.label} value={data.organisations[b.key]} foot={b.hint} />
          ))}
          <Stat
            label="Trial → paid conversion"
            value={data.conversion.displayRate}
            foot={`${data.conversion.converted} of ${data.conversion.trialSignups} trial signups converted`}
          />
          <Stat
            label="Churn (ever converted)"
            value={data.churn.displayRate}
            foot={`${data.churn.churned} of ${data.churn.everConverted} paying accounts churned`}
          />
        </div>
      </Card>

      <Card title="Renewals coming up" note="valid-until dates driven by Payment rows">
        {data.renewals.list.length === 0 ? (
          <Empty>No upcoming renewals — no paid subscriptions covering the next two months.</Empty>
        ) : (
          <div className="table-wrap" style={{ padding: '0 16px 16px' }}>
            <table>
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Covered until</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {data.renewals.list.map((r) => (
                  <tr key={r.organizationId}>
                    <td>{r.organizationName ?? '—'}</td>
                    <td>{fmtDate(r.validUntil)}</td>
                    <td>
                      <span className={`badge badge-${r.dueInDays <= 30 ? 'DUE' : 'WAIVED'}`}>
                        in {r.dueInDays} day{r.dueInDays !== 1 ? 's' : ''}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Monthly revenue" note="captured payments by calendar month">
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.trend.length === 0 ? (
            <Empty>No captured payments yet.</Empty>
          ) : (
            data.trend.map((t) => (
              <div key={t.key} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 90px', alignItems: 'center', gap: 12, fontSize: 14 }}>
                <span className="dim">{t.label}</span>
                <div style={{ background: 'var(--surface-2)', borderRadius: 4, height: 18, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: maxTrend > 0 ? `${Math.max(2, (t.amountPaise / maxTrend) * 100)}%` : '0%',
                      background: 'var(--accent)',
                      borderRadius: 4,
                    }}
                  />
                </div>
                <span style={{ textAlign: 'right', fontWeight: 600 }}>{t.amountLabel}</span>
              </div>
            ))
          )}
        </div>
      </Card>

      {data.failedPayments.length > 0 && (
        <Card title="Failed / refunded payments" note="last 30 days">
          <div className="table-wrap" style={{ padding: '0 16px 16px' }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Workspace</th>
                  <th>Order</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.failedPayments.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.createdAt)}</td>
                    <td>{p.organizationName ?? '—'}</td>
                    <td className="mono">{p.rzxOrderId}</td>
                    <td>{p.amountLabel}</td>
                    <td><PaymentStatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="All payments" note={`${data.paymentHistory.length} most recent across the platform`}>
        {data.paymentHistory.length === 0 ? (
          <Empty>No payments anywhere yet.</Empty>
        ) : (
          <div className="table-wrap" style={{ padding: '0 16px 16px' }}>
            <table>
              <thead>
                <tr>
                  <th>At</th>
                  <th>Workspace</th>
                  <th>Company</th>
                  <th>Paid by</th>
                  <th>Plan</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {data.paymentHistory.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDateTime(p.createdAt)}</td>
                    <td>{p.organizationName ?? '—'}</td>
                    <td>{p.companyName ?? '—'}</td>
                    <td>{p.paidBy ? `${p.paidBy.name} (${p.paidBy.email})` : '—'}</td>
                    <td>{p.planName}</td>
                    <td style={{ fontWeight: 600 }}>{p.amountLabel}</td>
                    <td><PaymentStatusBadge status={p.status} /></td>
                    <td>{p.method ? p.method.toUpperCase() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function fmtINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}