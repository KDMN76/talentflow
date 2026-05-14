/**
 * File-storage abstractie voor TalentFlow.
 *
 * Twee implementaties:
 *   - LocalDiskStorage  : default in dev, schrijft naar process.cwd()/uploads
 *   - S3Storage         : MinIO of AWS S3 via @aws-sdk/client-s3
 *
 * Selecteer via env STORAGE_DRIVER ('local' | 's3'). Singleton via getStorage().
 *
 * Key-formaat (afgesproken contract):
 *   tenants/<tenantId>/candidates/<candidateId>/resumes/<resumeId>__<safeFilename>
 */

import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../middleware/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

export interface FileStorage {
  put(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  getStream(key: string): Promise<NodeJS.ReadableStream>;
  delete(key: string): Promise<void>;
  /**
   * Returns a URL the browser can use. For local disk this is the static
   * `/uploads/...` path served by Express. For S3 this is a presigned URL
   * valid for `ttlSeconds` (default 15 minutes).
   */
  getDownloadUrl(key: string, ttlSeconds?: number): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a safe storage key. Strips path separators and dangerous chars from
 * the filename so we never escape the tenant prefix.
 */
export function buildResumeStorageKey(
  tenantId: string,
  candidateId: string,
  resumeId: string,
  filename: string
): string {
  const safe = filename
    .replace(/[\\/]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
  return `tenants/${tenantId}/candidates/${candidateId}/resumes/${resumeId}__${safe}`;
}

const DEFAULT_PRESIGN_TTL = 15 * 60; // 15 minutes

// ─────────────────────────────────────────────────────────────────────────────
// LocalDiskStorage
// ─────────────────────────────────────────────────────────────────────────────

export class LocalDiskStorage implements FileStorage {
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    // Backwards-compat: existing `uploadResume` writes to uploads/resumes/<basename>
    // and the static handler is mounted on /uploads. We keep that root.
    this.rootDir = rootDir ?? path.join(process.cwd(), 'uploads');
  }

  /** Map a logical storage key to a disk path. We flatten the key under
   *  `<rootDir>/resumes/<basename>` so existing `/uploads/resumes/<basename>`
   *  URLs keep working AND new tenant-scoped keys are still served by the
   *  same Express static handler.
   *
   *  NB: we keep the full logical key in the DB; on disk we only need the
   *  basename so URLs match the existing static handler. To avoid filename
   *  collisions across tenants, the resumeId prefix in the key already makes
   *  the basename unique.
   */
  private toDiskPath(key: string): string {
    const base = path.basename(key);
    return path.join(this.rootDir, 'resumes', base);
  }

  private toDownloadPath(key: string): string {
    const base = path.basename(key);
    return `/uploads/resumes/${base}`;
  }

  async put(key: string, buffer: Buffer, _mimeType: string): Promise<void> {
    const target = this.toDiskPath(key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer);
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    const target = this.toDiskPath(key);
    if (!fs.existsSync(target)) {
      throw new Error(`File not found: ${key}`);
    }
    return fs.createReadStream(target);
  }

  async delete(key: string): Promise<void> {
    const target = this.toDiskPath(key);
    if (fs.existsSync(target)) {
      try {
        fs.unlinkSync(target);
      } catch (err) {
        logger.warn('[storage:local] failed to delete file', {
          key,
          error: (err as Error).message,
        });
      }
    }
  }

  async getDownloadUrl(key: string, _ttlSeconds?: number): Promise<string> {
    return this.toDownloadPath(key);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// S3Storage (works against MinIO with forcePathStyle)
// ─────────────────────────────────────────────────────────────────────────────

export class S3Storage implements FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(opts: {
    endpoint?: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle?: boolean;
  }) {
    this.bucket = opts.bucket;
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle ?? Boolean(opts.endpoint),
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
    });
  }

  async put(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    if (!out.Body) {
      throw new Error(`Empty body for key: ${key}`);
    }
    // AWS SDK v3 Body is `Readable | ReadableStream | Blob` depending on platform.
    // In Node we always get a Readable.
    return out.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  async getDownloadUrl(key: string, ttlSeconds?: number): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, {
      expiresIn: ttlSeconds ?? DEFAULT_PRESIGN_TTL,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

let cached: FileStorage | null = null;

export function getStorage(): FileStorage {
  if (cached) return cached;

  const driver = (process.env.STORAGE_DRIVER ?? 'local').toLowerCase();

  if (driver === 's3') {
    const bucket = process.env.STORAGE_S3_BUCKET;
    const accessKeyId = process.env.STORAGE_S3_ACCESS_KEY;
    const secretAccessKey = process.env.STORAGE_S3_SECRET_KEY;
    const region = process.env.STORAGE_S3_REGION ?? 'us-east-1';
    const endpoint = process.env.STORAGE_S3_ENDPOINT;

    if (!bucket || !accessKeyId || !secretAccessKey) {
      logger.warn(
        '[storage] STORAGE_DRIVER=s3 but missing S3 config; falling back to local disk'
      );
      cached = new LocalDiskStorage();
      return cached;
    }

    cached = new S3Storage({
      bucket,
      accessKeyId,
      secretAccessKey,
      region,
      endpoint,
      forcePathStyle: Boolean(endpoint),
    });
    logger.info('[storage] using S3 driver', { bucket, endpoint, region });
    return cached;
  }

  cached = new LocalDiskStorage();
  logger.info('[storage] using local-disk driver', {
    root: path.join(process.cwd(), 'uploads'),
  });
  return cached;
}

/** Test helper — only for unit tests that want to swap the singleton. */
export function _resetStorageForTests(s: FileStorage | null): void {
  cached = s;
}
