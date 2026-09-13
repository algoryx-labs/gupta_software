import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID');

/** Max attachment size (must match API multer + Spaces upload limits). */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export const attachmentPresignSchema = z.object({
  filename: z.string().min(1, 'Filename is required').max(255),
  contentType: z.string().min(1, 'Content type is required').max(100),
  size: z.coerce
    .number()
    .int()
    .positive('File size is required')
    .max(MAX_ATTACHMENT_BYTES, 'File too large (max 20MB)'),
});

export type AttachmentPresignInput = z.infer<typeof attachmentPresignSchema>;

export const attachmentCompleteSchema = z.object({
  filename: z.string().min(1, 'Filename is required').max(255),
  key: z.string().min(1, 'Object key is required').max(500),
  url: z.string().url('Invalid file URL'),
});

export type AttachmentCompleteInput = z.infer<typeof attachmentCompleteSchema>;
