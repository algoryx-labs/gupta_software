import path from 'path';
import { ApiError } from './ApiError.js';
import {
  buildObjectKey,
  createPresignedPutUrl,
  deleteFileFromSpaces,
  publicFileUrl,
  uploadFileToSpaces,
} from '../config/storage.js';

const PDF_MIME = 'application/pdf';

export type AttachmentFolder = 'purchases' | 'tenders' | 'loas';

interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

function assertPdfAllowed(originalName: string, contentType: string, pdfOnly?: boolean) {
  const ext = path.extname(originalName).toLowerCase();
  if (pdfOnly && ext !== '.pdf') {
    throw new ApiError(400, 'Only PDF receipts are allowed');
  }
  if (pdfOnly && contentType && contentType !== PDF_MIME && contentType !== 'application/octet-stream') {
    throw new ApiError(400, 'Only PDF receipts are allowed');
  }
}

export async function storeAttachment(
  file: UploadedFile,
  folder: AttachmentFolder,
  options?: { pdfOnly?: boolean },
): Promise<{ filename: string; url: string }> {
  assertPdfAllowed(file.originalname, file.mimetype, options?.pdfOnly);

  const key = buildObjectKey(`attachments/${folder}`, file.originalname);
  const contentType = file.mimetype || (path.extname(file.originalname).toLowerCase() === '.pdf' ? PDF_MIME : 'application/octet-stream');

  const url = await uploadFileToSpaces(file.buffer, key, contentType);

  return { filename: file.originalname, url };
}

export async function createAttachmentPresign(
  folder: AttachmentFolder,
  filename: string,
  contentType: string,
  options?: { pdfOnly?: boolean },
) {
  const normalizedType = contentType || PDF_MIME;
  assertPdfAllowed(filename, normalizedType, options?.pdfOnly);

  const key = buildObjectKey(`attachments/${folder}`, filename);
  const signed = await createPresignedPutUrl(key, normalizedType);

  return {
    key,
    uploadUrl: signed.uploadUrl,
    publicUrl: signed.publicUrl,
    headers: signed.headers,
  };
}

export function resolveCompletedAttachment(
  folder: AttachmentFolder,
  input: { filename: string; key: string; url: string },
): { filename: string; url: string } {
  const prefix = `attachments/${folder}/`;
  if (!input.key.startsWith(prefix)) {
    throw new ApiError(400, 'Invalid upload key');
  }

  const expectedUrl = publicFileUrl(input.key);
  if (input.url !== expectedUrl) {
    throw new ApiError(400, 'Invalid upload URL');
  }

  assertPdfAllowed(input.filename, PDF_MIME, folder !== 'tenders');

  return { filename: input.filename, url: expectedUrl };
}

export async function removeStoredAttachment(url: string): Promise<void> {
  await deleteFileFromSpaces(url);
}
