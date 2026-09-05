/**
 * Evidence storage.
 *
 * Supabase Storage in any deployed environment; the local-disk driver keeps the
 * app runnable before Supabase credentials exist, so onboarding a new developer
 * does not require provisioning a bucket first.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

(globalThis as any).WebSocket = ws;
import { env } from '../config/env';
import { AppError } from './errors';
import { logger } from './logger';

export interface StorageDriver {
  readonly name: 'supabase' | 'local';
  upload(key: string, body: Buffer, mimeType: string): Promise<void>;
  download(key: string): Promise<Buffer>;
  /** A time-limited URL, or null for drivers that cannot issue one. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string | null>;
  remove(key: string): Promise<void>;
}

class SupabaseStorage implements StorageDriver {
  readonly name = 'supabase' as const;
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string, private readonly bucket: string) {
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async upload(key: string, body: Buffer, mimeType: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).upload(key, body, {
      contentType: mimeType,
      upsert: false,
    });
    if (error) throw new AppError(`Upload failed: ${error.message}`, 502, 'STORAGE_ERROR');
  }

  async download(key: string): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) throw new AppError(`Download failed: ${error?.message ?? 'no data'}`, 502, 'STORAGE_ERROR');
    return Buffer.from(await data.arrayBuffer());
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(key, expiresInSeconds);
    if (error) throw new AppError(`Could not sign URL: ${error.message}`, 502, 'STORAGE_ERROR');
    return data?.signedUrl ?? null;
  }

  async remove(key: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([key]);
    if (error) throw new AppError(`Delete failed: ${error.message}`, 502, 'STORAGE_ERROR');
  }
}

class LocalStorage implements StorageDriver {
  readonly name = 'local' as const;
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    // Storage keys are constructed server-side, but a traversal here would be
    // an arbitrary-file-write, so refuse anything that escapes the root.
    if (!full.startsWith(path.resolve(this.root) + path.sep)) {
      throw new AppError('Invalid storage key', 400, 'STORAGE_ERROR');
    }
    return full;
  }

  async upload(key: string, body: Buffer): Promise<void> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
  }

  async download(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async signedUrl(): Promise<string | null> {
    return null; // served through the API instead
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
}

function build(): StorageDriver {
  if (env.storageDriver === 'supabase') {
    logger.info({ bucket: env.SUPABASE_STORAGE_BUCKET }, 'using Supabase storage');
    return new SupabaseStorage(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, env.SUPABASE_STORAGE_BUCKET);
  }
  logger.warn({ dir: env.LOCAL_STORAGE_DIR }, 'SUPABASE_URL is not set — falling back to local disk storage');
  return new LocalStorage(env.LOCAL_STORAGE_DIR);
}

export const storage: StorageDriver = build();

export const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

/** Keys are namespaced by tenant so a bucket listing cannot cross organizations. */
export function buildStorageKey(parts: {
  organizationId: string;
  companyId: string;
  itemId?: string | null;
  fileName: string;
}): string {
  const safeName = parts.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  const scope = parts.itemId ? `items/${parts.itemId}` : 'general';
  return `orgs/${parts.organizationId}/companies/${parts.companyId}/${scope}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
}
