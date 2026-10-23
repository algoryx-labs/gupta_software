import { z } from 'zod';
import { objectIdSchema } from './common.js';

export const createOutstandingPaymentSchema = z.object({
  tender: z.string().min(1, 'Tender is required').regex(/^[a-f\d]{24}$/i, 'Invalid tender'),
  site: objectIdSchema.nullish().transform((value) => value ?? undefined),
  siteNameRaw: z.string().min(1, 'Site is required'),
  amount: z.coerce.number().min(0.01, 'Amount must be greater than 0'),
  paymentDate: z.coerce.date(),
  description: z.string().max(200, 'Description is too long').optional(),
});

export type CreateOutstandingPaymentInput = z.infer<typeof createOutstandingPaymentSchema>;

export const outstandingPaymentFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  tender: objectIdSchema.optional(),
  site: objectIdSchema.optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

export type OutstandingPaymentFilterInput = z.infer<typeof outstandingPaymentFilterSchema>;
