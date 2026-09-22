// supabase/functions/_shared/mailer.ts
import { env } from './env.ts';

export interface SendMailOptions {
  to: string;
  subject: string;
  body?: string;
  html?: string;
}

export function reminderTemplate(name: string, itemTitle: string, companyName: string, dueDate: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eaecf0;border-radius:12px;padding:28px">
    <h1 style="margin:0 0 4px;font-size:18px;color:#101828">Compliance Reminder</h1>
    <p style="margin:0 0 20px;color:#667085;font-size:14px">Hello ${name},</p>
    <p style="margin:0 0 14px;color:#101828;font-size:14px;line-height:1.55">
      <strong>${itemTitle}</strong> for <strong>${companyName}</strong> is due on <strong>${dueDate}</strong>.
    </p>
    <p style="margin:0 0 22px;color:#667085;font-size:14px">Please complete the task and upload supporting evidence on the compliance portal.</p>
  </div>
</body></html>`;
}

export async function sendEmail(opts: SendMailOptions): Promise<{ sent: boolean; messageId?: string }> {
  const textContent = opts.body || opts.subject;

  if (!env.RESEND_API_KEY) {
    console.log(`[Email Console Fallback] To: ${opts.to} | Subject: ${opts.subject}\n${textContent}`);
    return { sent: true, messageId: `console-${Date.now()}` };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [opts.to],
        subject: opts.subject,
        text: textContent,
        html: opts.html || textContent,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Resend Error]:', errText);
      return { sent: false };
    }

    const data = await res.json();
    return { sent: true, messageId: data.id };
  } catch (err) {
    console.error('[Email Send Error]:', err);
    return { sent: false };
  }
}
