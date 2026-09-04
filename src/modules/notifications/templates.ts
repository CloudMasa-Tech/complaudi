import { formatDate } from '../../lib/dates';

export interface ReminderLine {
  companyName: string;
  title: string;
  form: string | null;
  periodLabel: string;
  dueDate: Date;
  severity: string;
  daysOut: number;
  penaltyNote: string | null;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function timing(daysOut: number): string {
  if (daysOut < 0) return `${Math.abs(daysOut)} day${Math.abs(daysOut) === 1 ? '' : 's'} overdue`;
  if (daysOut === 0) return 'due today';
  if (daysOut === 1) return 'due tomorrow';
  return `due in ${daysOut} days`;
}

export function digestSubject(lines: ReminderLine[]): string {
  const overdue = lines.filter((l) => l.daysOut < 0).length;
  const today = lines.filter((l) => l.daysOut === 0).length;

  if (overdue > 0 && today > 0) return `${overdue} overdue and ${today} due today — compliance update`;
  if (overdue > 0) return `${overdue} compliance filing${overdue === 1 ? '' : 's'} overdue`;
  if (today > 0) return `${today} compliance filing${today === 1 ? '' : 's'} due today`;
  return `${lines.length} upcoming compliance deadline${lines.length === 1 ? '' : 's'}`;
}

export function digestText(recipientName: string, lines: ReminderLine[], appUrl: string): string {
  const sorted = [...lines].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const body = sorted
    .map((l) => {
      const form = l.form ? ` (${l.form})` : '';
      const penalty = l.daysOut <= 0 && l.penaltyNote ? `\n     Risk: ${l.penaltyNote}` : '';
      return `  •  ${l.title}${form}\n     ${l.companyName} — ${l.periodLabel}\n     Due ${formatDate(l.dueDate)} — ${timing(l.daysOut)} [${l.severity}]${penalty}`;
    })
    .join('\n\n');

  return `Hello ${recipientName},

Here is where your compliance calendar stands.

${body}

Open the dashboard: ${appUrl}

— Compliance Toolkit
This is an automated reminder. Deadlines shown are based on the statutory dates recorded in your calendar; confirm state-specific dates with your advisor.`;
}

export function digestHtml(recipientName: string, lines: ReminderLine[], appUrl: string): string {
  const sorted = [...lines].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const colour = (d: number) => (d < 0 ? '#b42318' : d <= 1 ? '#b54708' : '#175cd3');

  const rows = sorted
    .map(
      (l) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #eaecf0">
          <div style="font-weight:600;color:#101828">${escapeHtml(l.title)}${l.form ? ` <span style="font-weight:400;color:#667085">(${escapeHtml(l.form)})</span>` : ''}</div>
          <div style="color:#667085;font-size:13px;margin-top:2px">${escapeHtml(l.companyName)} — ${escapeHtml(l.periodLabel)}</div>
          <div style="margin-top:6px;font-size:13px;color:${colour(l.daysOut)};font-weight:600">
            Due ${formatDate(l.dueDate)} · ${timing(l.daysOut)} · ${escapeHtml(l.severity)}
          </div>
        </td>
      </tr>`,
    )
    .join('');

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eaecf0;border-radius:12px;padding:28px">
    <h1 style="margin:0 0 4px;font-size:18px;color:#101828">Compliance update</h1>
    <p style="margin:0 0 20px;color:#667085;font-size:14px">Hello ${escapeHtml(recipientName)}, here is where your calendar stands.</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <a href="${escapeHtml(appUrl)}" style="display:inline-block;margin-top:22px;background:#101828;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">Open dashboard</a>
    <p style="margin:22px 0 0;color:#98a2b3;font-size:12px;line-height:1.5">Automated reminder. Dates reflect the statutory deadlines recorded in your calendar; confirm state-specific dates with your advisor.</p>
  </div>
</body></html>`;
}

// ------------------------------------------------------------------ company invite

export interface InviteEmail {
  inviterName: string;
  companyName: string;
  role: string;
  signupUrl: string;
}

export function inviteSubject(inviteeName: string, companyName: string): string {
  return `${inviteeName}, you've been invited to ${companyName} on Compliance Toolkit`;
}

export function inviteText(inviteeName: string, data: InviteEmail): string {
  return `Hello ${inviteeName},

${data.inviterName} has invited you to ${data.companyName} on Compliance Toolkit as a ${data.role}.

To accept, open the link below and set your own password. You will then be able to sign in and see the compliance calendar for ${data.companyName}.

${data.signupUrl}

If you were not expecting this invitation, you can safely ignore this email.

— Compliance Toolkit`;
}

export function inviteHtml(inviteeName: string, data: InviteEmail): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eaecf0;border-radius:12px;padding:28px">
    <h1 style="margin:0 0 4px;font-size:18px;color:#101828">You've been invited</h1>
    <p style="margin:0 0 20px;color:#667085;font-size:14px">Hello ${escapeHtml(inviteeName)},</p>
    <p style="margin:0 0 14px;color:#101828;font-size:14px;line-height:1.55">
      ${escapeHtml(data.inviterName)} has invited you to <strong>${escapeHtml(data.companyName)}</strong>
      on Compliance Toolkit as a <strong>${escapeHtml(data.role)}</strong>.
    </p>
    <p style="margin:0 0 22px;color:#667085;font-size:14px;line-height:1.55">
      To accept, open the link below and set your own password. You will then be able to sign in and
      see the compliance calendar for ${escapeHtml(data.companyName)}.
    </p>
    <a href="${escapeHtml(data.signupUrl)}" style="display:inline-block;background:#3538cd;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:600">Accept invitation</a>
    <p style="margin:22px 0 0;color:#98a2b3;font-size:12px;line-height:1.5">If you were not expecting this invitation, you can safely ignore this email.</p>
  </div>
</body></html>`;
}
