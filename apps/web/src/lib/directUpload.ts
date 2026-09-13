/**
 * Upload files directly to DigitalOcean Spaces via a short-lived signed URL.
 * This bypasses App Platform / reverse-proxy body size limits (~1 MB) that
 * otherwise surface in the browser as a misleading CORS error.
 */

export interface PresignResponse {
  key: string;
  uploadUrl: string;
  publicUrl: string;
  headers: Record<string, string>;
}

export interface CompleteAttachmentBody {
  filename: string;
  key: string;
  url: string;
}

interface DirectUploadHandlers<T> {
  presign: (body: {
    filename: string;
    contentType: string;
    size: number;
  }) => Promise<PresignResponse>;
  complete: (body: CompleteAttachmentBody) => Promise<T>;
}

export async function uploadAttachmentDirect<T>(
  file: File,
  handlers: DirectUploadHandlers<T>,
): Promise<T> {
  const contentType = file.type || 'application/pdf';
  const signed = await handlers.presign({
    filename: file.name,
    contentType,
    size: file.size,
  });

  const putResponse = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: signed.headers,
    body: file,
  });

  if (!putResponse.ok) {
    throw new Error(`Storage upload failed (${putResponse.status})`);
  }

  return handlers.complete({
    filename: file.name,
    key: signed.key,
    url: signed.publicUrl,
  });
}
