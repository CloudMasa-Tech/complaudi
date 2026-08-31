/**
 * Email delivery. Falls back to a console transport when SMTP is not
 * configured, so reminder logic can be exercised end to end in development
 * without wiring up a mail provider.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (env.mailDriver === 'console') return null;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export async function sendMail(message: MailMessage): Promise<{ delivered: boolean; messageId?: string }> {
  const transport = getTransporter();

  if (!transport) {
    logger.info({ to: message.to, subject: message.subject }, 'email (console transport)');
    logger.debug({ body: message.text }, 'email body');
    return { delivered: false };
  }

  const info = await transport.sendMail({ from: env.MAIL_FROM, ...message });
  return { delivered: true, messageId: info.messageId };
}

export async function verifyMailer(): Promise<boolean> {
  const transport = getTransporter();
  if (!transport) return false;
  try {
    await transport.verify();
    return true;
  } catch (err) {
    logger.error({ err }, 'SMTP verification failed');
    return false;
  }
}
