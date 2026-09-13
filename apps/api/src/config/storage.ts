import crypto from 'crypto';
import path from 'path';
import {
  DeleteObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

const endpoint =
  env.DO_SPACES_ENDPOINT ?? `https://${env.DO_SPACES_REGION}.digitaloceanspaces.com`;

export const s3Client = new S3Client({
  endpoint,
  region: env.DO_SPACES_REGION,
  credentials: {
    accessKeyId: env.DO_SPACES_KEY,
    secretAccessKey: env.DO_SPACES_SECRET,
  },
  forcePathStyle: false,
});

function corsOrigins(): string[] {
  return env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function publicFileUrl(key: string): string {
  if (env.DO_SPACES_PUBLIC_URL) {
    return `${env.DO_SPACES_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
  }
  return `https://${env.DO_SPACES_BUCKET}.${env.DO_SPACES_REGION}.digitaloceanspaces.com/${key}`;
}

export function buildObjectKey(folder: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase() || '.pdf';
  return `${folder}/${Date.now()}-${crypto.randomUUID()}${ext}`;
}

export function keyFromFileUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\/+/, '');
    if (!pathname) return null;

    if (env.DO_SPACES_PUBLIC_URL) {
      const base = new URL(env.DO_SPACES_PUBLIC_URL);
      if (parsed.origin === base.origin) return pathname;
    }

    const bucketHost = `${env.DO_SPACES_BUCKET}.${env.DO_SPACES_REGION}.digitaloceanspaces.com`;
    if (parsed.hostname === bucketHost) return pathname;

    return pathname;
  } catch {
    return null;
  }
}

export async function uploadFileToSpaces(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<string> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.DO_SPACES_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read',
    }),
  );

  return publicFileUrl(key);
}

export async function createPresignedPutUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 600,
): Promise<{ uploadUrl: string; headers: Record<string, string>; publicUrl: string }> {
  const command = new PutObjectCommand({
    Bucket: env.DO_SPACES_BUCKET,
    Key: key,
    ContentType: contentType,
    ACL: 'public-read',
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });

  return {
    uploadUrl,
    publicUrl: publicFileUrl(key),
    headers: {
      'Content-Type': contentType,
      'x-amz-acl': 'public-read',
    },
  };
}

/**
 * Allow browser direct uploads to Spaces (needed to bypass App Platform ~1MB body limit).
 * Safe to call on every boot; updates the bucket CORS rules for configured web origins.
 */
export async function ensureSpacesCors(): Promise<void> {
  const origins = corsOrigins();
  if (!origins.length) return;

  try {
    await s3Client.send(
      new PutBucketCorsCommand({
        Bucket: env.DO_SPACES_BUCKET,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: origins,
              AllowedMethods: ['GET', 'PUT', 'HEAD'],
              AllowedHeaders: ['*'],
              ExposeHeaders: ['ETag', 'x-amz-request-id'],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    logger.info('DigitalOcean Spaces CORS configured', { origins });
  } catch (err) {
    logger.error('Failed to configure Spaces CORS (browser direct uploads may fail)', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function deleteFileFromSpaces(url: string): Promise<void> {
  const key = keyFromFileUrl(url);
  if (!key) return;

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: env.DO_SPACES_BUCKET,
      Key: key,
    }),
  );
}
