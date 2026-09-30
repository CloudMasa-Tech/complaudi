import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { post, ApiError } from '../api/client';
import { useResource } from '../api/useResource';
import { ErrorNote, Card, Empty, Loading, PaymentStatusBadge, Badge, fmtDate } from '../components/ui';
import type { BillingPaymentRow, BillingView, OnboardedCompany, PlanOption } from '../api/types';

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

interface CreateOrderResponse extends PlanOption {
  orderId: string;
  currency: string;
  planName: string;
  keyId: string | null;
  paymentId: string;
  /** Set by the server when it holds no Razorpay credentials, which it only
   *  does outside production. The page never decides this for itself. */
  isMockOrder: boolean;
}

function WorkspaceBilling() {
  const { user } = useAuth();
  const { data, error, initial } = useResource<BillingView>('/billing');
  /** Which plan's checkout is in flight, so only that button shows a spinner. */
  const [busy, setBusy] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<BillingPaymentRow | null>(null);

  if (!user) return null;
  const me = user;

  async function startCheckout(plan: PlanOption) {
    setBusy(plan.key);
    setPayError(null);
    try {
      // Only the plan key travels. The amount is looked up server-side from the
      // catalog, so the page cannot ask to be charged a different number.
      const order = await post<CreateOrderResponse>('/billing/create-order', { planKey: plan.key });

      // A server running without Razorpay credentials — local development —
      // answers with a simulated order and credits it without a real payment.
      // Whether that is allowed is the server's decision; these placeholders
      // carry no authority and are rejected by any server that has keys.
      if (order.isMockOrder) {
        await post('/billing/verify', {
          orderId: order.orderId,
          rzpPaymentId: 'simulated',
          rzpSignature: 'simulated',
        });
        window.location.reload();
        return;
      }

      await loadRazorpayCheckout();

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amountPaise,
        currency: order.currency,
        name: 'Complaudi',
        description: `${order.name} — ${order.baseLabel} + ${order.taxPercent}% GST`,
        order_id: order.orderId,
        prefill: { name: me.name, email: me.email },
        notes: { plan: order.name },
        theme: { color: '#1b3a6b' },
        handler: async (response: { razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await post('/billing/verify', {
              orderId: order.orderId,
              rzpPaymentId: response.razorpay_payment_id,
              rzpSignature: response.razorpay_signature,
            });
            window.location.reload();
          } catch (err) {
            // The money may well have left their account — Razorpay's webhook
            // is the backstop that credits it — so this must not read as "your
            // payment failed".
            setPayError(
              err instanceof ApiError
                ? err.message
                : 'We could not confirm the payment. If your account was debited it will be credited shortly; refresh in a minute.',
            );
            setBusy(null);
          }
        },
        modal: { ondismiss: () => setBusy(null) },
      });

      rzp.open();
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'Could not start the payment. Please retry.');
      setBusy(null);
    }
  }

  if (error) {
    return <ErrorNote error={error} />;
  }

  if (initial || !data) {
    return <Loading label="Loading billing" />;
  }

  const { plans, subscription, payments, canPurchase } = data;
  const onTrial = subscription.status === 'TRIAL';
  const trialDaysLeft = subscription.trialDaysLeft;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Card title="Subscription" id="subscription">
        <div style={{ padding: 16 }}>
          <div className="sub-state">
            {onTrial ? (
              <>
                <span className="badge badge-DUE">Free trial</span>
                <div>
                  <span className="dim">Trial ends</span>{' '}
                  <strong>{fmtDate(subscription.trialEndsAt)}</strong>
                  {trialDaysLeft !== null && (
                    <span className={trialDaysLeft <= 3 ? 'sub-urgent' : 'dim'}>
                      {' · '}{trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} left
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <span className="badge badge-COMPLETED">Active subscription</span>
                <div>
                  <span className="dim">Paid until</span> <strong>{fmtDate(subscription.validUntil)}</strong>
                  {subscription.currentPlanName && (
                    <span className="dim"> · {subscription.currentPlanName} plan</span>
                  )}
                </div>
                {subscription.paymentCount > 0 && (
                  <span className="dim tiny">
                    {subscription.paymentCount} confirmed payment{subscription.paymentCount !== 1 ? 's' : ''}
                  </span>
                )}
              </>
            )}
          </div>

          {canPurchase && (
            <>
              <h3 className="plan-pick-head">
                {onTrial ? 'Choose a plan' : 'Extend your subscription'}
              </h3>
              <p className="dim tiny plan-pick-sub">
                {onTrial
                  ? 'Everything in the trial, kept running. Prices exclude GST, which is shown on each plan.'
                  : 'Paying again extends from your current end date — no days are lost.'}
              </p>

              <div className="plan-grid">
                {plans.map((plan) => (
                  <PlanCard
                    key={plan.key}
                    plan={plan}
                    current={subscription.currentPlanKey === plan.key}
                    busy={busy === plan.key}
                    disabled={busy !== null}
                    onChoose={() => startCheckout(plan)}
                  />
                ))}
              </div>

              {payError && <ErrorNote error={payError} />}
              <p className="dim tiny plan-foot">
                Payments are processed by Razorpay. Cards, UPI, net banking and wallets are accepted.
                Your subscription starts the moment the payment is confirmed.
              </p>
            </>
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
              background: 'var(--surface)', borderRadius: 8, padding: 24, maxWidth: 520, width: '100%',
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
              {selectedReceipt.taxAmountPaise > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="dim">Plan charge:</span>
                    <strong>{selectedReceipt.baseLabel}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="dim">GST @ {selectedReceipt.taxPercent}%:</span>
                    <strong>{selectedReceipt.taxLabel}</strong>
                  </div>
                </>
              )}
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

/**
 * One purchasable term.
 *
 * Every figure here is printed from the server's plan catalog — the base, the
 * GST line and the total all arrive computed. The page deliberately does no
 * arithmetic: a total worked out in the browser is one that can disagree with
 * the amount the order was created for.
 */
function PlanCard({
  plan, current, busy, disabled, onChoose,
}: {
  plan: PlanOption;
  current: boolean;
  busy: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  return (
    <div className={`plan-card${plan.recommended ? ' is-recommended' : ''}`}>
      {plan.recommended && <span className="plan-flag">Best value</span>}

      <div className="plan-term">{plan.name}</div>

      <div className="plan-price">
        <span className="plan-price-main">{plan.baseLabel}</span>
        <span className="plan-price-unit">+ GST</span>
      </div>

      <dl className="plan-split">
        <div><dt>Plan</dt><dd>{plan.baseLabel}</dd></div>
        <div><dt>GST @ {plan.taxPercent}%</dt><dd>{plan.taxLabel}</dd></div>
        <div className="plan-total"><dt>Total payable</dt><dd>{plan.amountLabel}</dd></div>
      </dl>

      {plan.periodDays > 365 && (
        <p className="plan-saving">Works out at {plan.perYearLabel} a year</p>
      )}

      <button
        className={`btn ${plan.recommended ? 'btn-primary' : 'btn-secondary'} plan-btn`}
        disabled={disabled}
        onClick={onChoose}
      >
        {busy ? 'Opening checkout…' : current ? `Extend ${plan.periodLabel}` : `Get ${plan.periodLabel}`}
      </button>

      {current && <p className="plan-current">Your current plan</p>}
    </div>
  );
}

// ------------------------------------------------------ super admin overview

function SuperAdminBilling() {
  const { user } = useAuth();
  const { data: companies, error } = useResource<OnboardedCompany[]>('/companies/onboarded-overview');
  if (!user) return null;
  const me = user;

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
        <div style={{ background: 'var(--surface)', padding: 16, borderRadius: 8, border: '1px solid var(--border)' }}>
          <div className="dim tiny">Total Onboarded Companies</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{companies.length}</div>
        </div>
        <div style={{ background: 'var(--surface)', padding: 16, borderRadius: 8, border: '1px solid var(--border)' }}>
          <div className="dim tiny">Upgraded Paid Companies</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: 'var(--good)' }}>{upgradedCount}</div>
        </div>
        <div style={{ background: 'var(--surface)', padding: 16, borderRadius: 8, border: '1px solid var(--border)' }}>
          <div className="dim tiny">Free Trial Companies</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: 'var(--high)' }}>{trialCount}</div>
        </div>
      </div>

      <WorkspaceBilling />

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
                  const ownOrg = c.organization.id === me.organizationId;
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
                        <div className="sub-cell">
                          <Badge value={c.status === 'ACTIVE' ? 'COMPLETED' : 'WAIVED'}>
                            {c.status}
                          </Badge>
                          {isTrial && (ownOrg ? (
                            // Purchasing is organisation-scoped on the server:
                            // an order is always created against the buyer's own
                            // organisation. So this offers the upgrade where it
                            // can actually be completed, and says who has to do
                            // it everywhere else.
                            <a className="btn btn-sm btn-primary" href="#subscription">Upgrade</a>
                          ) : (
                            <span className="dim tiny">Owner upgrades from their own workspace</span>
                          ))}
                        </div>
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