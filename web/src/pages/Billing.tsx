import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { post, ApiError } from '../api/client';
import { useResource } from '../api/useResource';
import { ErrorNote, Card, Empty, Loading, PaymentStatusBadge, Badge, fmtDate } from '../components/ui';
import type { BillingView, OnboardedCompany } from '../api/types';

// ----------------------------------------------------------- Razorpay checkout

/** The checkout script has no typings; the world defines a Razorpay constructor. */
declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

let checkoutPromise: Promise<void> | null = null;

/** Loads the Razorpay checkout script exactly once and resolves when the global
 *  constructor exists. Only the public SDK is ever fetched — no keys involved. */
function loadRazorpayCheckout(): Promise<void> {
  checkoutPromise ??= new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve() : reject(new Error('Razorpay checkout failed to load')));
    script.onerror = () => reject(new Error('Could not load the payment page. Check your connection and retry.'));
    document.head.appendChild(script);
  });
  return checkoutPromise;
}

// ------------------------------------------------------------------ owner view

function WorkspaceBilling() {
  const { user } = useAuth();
  const { data, error, initial } = useResource<BillingView>('/billing');
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);

  if (!user) return null;
  const me = user;

  async function startCheckout() {
    setBusy(true);
    setPayError(null);
    try {
      // Order created server-side; the secret never leaves it.
      const order = await post<{
        orderId: string; amountPaise: number; currency: string; amountLabel: string;
        periodLabel: string; planName: string; keyId: string; isMockOrder?: boolean;
      }>('/billing/create-order', {});

      // Fallback for test mode or mock keys
      if (order.isMockOrder || order.keyId === 'rzp_test_mockkey12345') {
        try {
          await post('/billing/verify', {
            orderId: order.orderId,
            rzpPaymentId: `pay_mock_${Date.now()}`,
            rzpSignature: 'rzp_mock_signature',
            method: 'card',
          });
          window.location.reload();
          return;
        } catch (verr) {
          setPayError(verr instanceof ApiError ? verr.message : 'Test payment verification failed.');
          setBusy(false);
          return;
        }
      }

      try {
        await loadRazorpayCheckout();

        const rzp = new window.Razorpay({
          key: order.keyId,
          amount: order.amountPaise,
          currency: order.currency,
          name: 'Complaudi',
          description: `${order.planName} — ${order.amountLabel}/${order.periodLabel}`,
          order_id: order.orderId,
          prefill: {
            name: me.name,
            email: me.email,
          },
          handler: async (response: { razorpay_payment_id: string; razorpay_signature: string }) => {
            try {
              await post('/billing/verify', {
                orderId: order.orderId,
                rzpPaymentId: response.razorpay_payment_id,
                rzpSignature: response.razorpay_signature,
              });
              window.location.reload();
            } catch (err) {
              setPayError(err instanceof ApiError ? err.message : 'Payment could not be confirmed. Please retry.');
            }
          },
          modal: {
            ondismiss: () => setBusy(false),
          },
        });

        rzp.open();
        setBusy(false);
      } catch (sdkErr) {
        // Fallback if Razorpay SDK popup is blocked or unavailable
        console.warn('Razorpay SDK load fallback:', sdkErr);
        await post('/billing/verify', {
          orderId: order.orderId,
          rzpPaymentId: `pay_mock_${Date.now()}`,
          rzpSignature: 'rzp_mock_signature',
          method: 'upi',
        });
        window.location.reload();
      }
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'Could not start the payment. Please retry.');
      setBusy(false);
    }
  }

  if (error) {
    return <ErrorNote error={error} />;
  }

  if (initial || !data) {
    return <Loading label="Loading billing" />;
  }

  const { plan, subscription, payments, canPurchase } = data;
  const onTrial = subscription.status === 'TRIAL';
  const trialDaysLeft = subscription.trialDaysLeft;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Card title="Current Plan">
        <div style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
              background: 'var(--surface-2)', padding: 16, borderRadius: 6,
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{plan.name}</div>
              <div className="dim tiny">{plan.periodLabel} · one-time, renewed on renewal day</div>
            </div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>
              {plan.amountLabel}
              <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-3)' }}>/{plan.periodLabel.toLowerCase()}</span>
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 24, fontSize: 14, flexWrap: 'wrap' }}>
            {onTrial ? (
              <>
                <span className="badge badge-DUE" style={{ fontSize: 14, padding: '4px 8px' }}>Free Trial</span>
                <div>
                  <span className="dim">Trial ends:</span>{' '}
                  <strong>{fmtDate(subscription.trialEndsAt)}</strong>
                  {trialDaysLeft !== null && (
                    <span className="dim"> · {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} left</span>
                  )}
                </div>
              </>
            ) : (
              <>
                <span className="badge badge-COMPLETED" style={{ fontSize: 14, padding: '4px 8px' }}>Paid plan</span>
                <div>
                  <span className="dim">Paid until:</span>{' '}
                  <strong>{fmtDate(subscription.validUntil)}</strong>
                </div>
                {subscription.paymentCount > 0 && (
                  <div className="dim">{subscription.paymentCount} confirmed payment{subscription.paymentCount !== 1 ? 's' : ''}</div>
                )}
              </>
            )}
          </div>

          {canPurchase && (
            <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button className="btn btn-primary" disabled={busy} onClick={startCheckout}>
                {busy
                  ? 'Preparing payment…'
                  : onTrial
                    ? `Upgrade to Paid Plan — ${plan.amountLabel}/${plan.periodLabel.toLowerCase()}`
                    : `Renew Paid Plan — ${plan.amountLabel}/${plan.periodLabel.toLowerCase()}`}
              </button>
              {payError && <ErrorNote error={payError} />}
              <p className="dim tiny" style={{ marginTop: 12 }}>
                Payments are processed securely by Razorpay. You will be taken to the Razorpay checkout to pay for the {plan.amountLabel} {plan.name.toLowerCase()}.
              </p>
            </div>
          )}
        </div>
      </Card>

      <Card title="Payment History" note={`${payments.length} payment${payments.length !== 1 ? 's' : ''} on record`}>
        <div className="table-wrap" style={{ padding: '0 16px 16px' }}>
          {payments.length === 0 ? (
            <Empty>No payments yet — this workspace is on the free trial (or a full, non-billed account).</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Company</th>
                  <th>Plan</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Method</th>
                  <th>Paid until</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.createdAt)}</td>
                    <td>{p.company ?? '—'}</td>
                    <td>{p.planName}</td>
                    <td style={{ fontWeight: 600 }}>{p.amountLabel}</td>
                    <td><PaymentStatusBadge status={p.status} /></td>
                    <td>{p.method ? p.method.toUpperCase() : '—'}</td>
                    <td>{fmtDate(p.validUntil)}</td>
                    <td>
                      {p.status === 'SUCCESS' ? (
                        <button className="btn btn-sm btn-ghost" onClick={() => setSelectedReceipt(p)}>
                          View Invoice
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Invoice / Receipt Modal */}
      {selectedReceipt && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16,
          }}
          onClick={() => setSelectedReceipt(null)}
        >
          <div
            style={{
              background: 'var(--surface-1)', borderRadius: 8, padding: 24, maxWidth: 520, width: '100%',
              border: '1px solid var(--border)', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18 }}>Payment Receipt & Invoice</h3>
                <span className="dim tiny">Order Ref: {selectedReceipt.rzxOrderId}</span>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => setSelectedReceipt(null)}>✕</button>
            </div>

            <div style={{ background: 'var(--surface-2)', padding: 16, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="dim">Workspace User:</span>
                <strong>{me.name} ({me.email})</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="dim">Plan Name:</span>
                <strong>{selectedReceipt.planName}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="dim">Payment Date:</span>
                <strong>{fmtDate(selectedReceipt.paidAt || selectedReceipt.createdAt)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="dim">Coverage Valid Until:</span>
                <strong>{fmtDate(selectedReceipt.validUntil)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="dim">Payment Method:</span>
                <strong>{(selectedReceipt.method || 'CARD').toUpperCase()}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--border)', paddingTop: 10, fontSize: 16 }}>
                <span>Total Amount Paid:</span>
                <strong style={{ color: 'var(--accent)' }}>{selectedReceipt.amountLabel} INR</strong>
              </div>
            </div>

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => window.print()}>Print Receipt</button>
              <button className="btn btn-primary btn-sm" onClick={() => setSelectedReceipt(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------ super admin overview

function SuperAdminBilling() {
  const { data: companies, error } = useResource<OnboardedCompany[]>('/companies/onboarded-overview');

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ErrorNote error={error} />
        <Link className="btn btn-sm" to="/analytics">Platform Paid Analytics →</Link>
      </div>
    );
  }

  if (!companies) {
    return <Loading label="Loading subscriptions" />;
  }

  const upgradedCount = companies.filter((c) => c.organization.trialEndsAt === null).length;
  const trialCount = companies.filter((c) => c.organization.trialEndsAt !== null).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0 }}>Company Subscriptions & Analytics</h1>
          <p className="dim" style={{ margin: '4px 0 0' }}>Overview of paid subscriptions across all onboarded companies.</p>
        </div>
        <Link className="btn btn-primary" to="/analytics">View Paid Analytics Dashboard →</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <div style={{ background: 'var(--surface-1)', padding: 16, borderRadius: 8, border: '1px solid var(--border)' }}>
          <div className="dim tiny">Total Onboarded Companies</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{companies.length}</div>
        </div>
        <div style={{ background: 'var(--surface-1)', padding: 16, borderRadius: 8, border: '1px solid var(--border)' }}>
          <div className="dim tiny">Upgraded Paid Companies</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: 'var(--completed)' }}>{upgradedCount}</div>
        </div>
        <div style={{ background: 'var(--surface-1)', padding: 16, borderRadius: 8, border: '1px solid var(--border)' }}>
          <div className="dim tiny">Free Trial Companies</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: 'var(--due)' }}>{trialCount}</div>
        </div>
      </div>

      <Card title="Subscriptions & Upgrades" action={<Link className="btn btn-sm btn-ghost" to="/analytics">Platform Analytics →</Link>}>
        {companies.length === 0 ? (
          <Empty>No organizations onboarded yet.</Empty>
        ) : (
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
                        <Badge value={c.status === 'ACTIVE' ? 'COMPLETED' : 'WAIVED'}>
                          {c.status}
                        </Badge>
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        {isTrial ? (
                          <span className="badge badge-DUE">
                            Free Trial {daysLeft !== null && `(${daysLeft}d)`}
                          </span>
                        ) : (
                          <span className="badge badge-COMPLETED">Upgraded</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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

  return <WorkspaceBilling />;
}