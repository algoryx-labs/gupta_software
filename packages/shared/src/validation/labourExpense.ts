import { z } from 'zod';
import { LabourExpenseCategory } from '../enums.js';
import { objectIdSchema } from './common.js';

export const createLabourExpenseSchema = z
  .object({
    tender: z.string().min(1, 'Tender is required').regex(/^[a-f\d]{24}$/i, 'Invalid tender'),
    site: objectIdSchema.optional(),
    siteNameRaw: z.string().min(1, 'Site is required'),
    category: z.nativeEnum(LabourExpenseCategory, { required_error: 'Category is required' }),
    categoryOther: z.string().max(100, 'Category is too long').optional(),
    amount: z.coerce.number().min(0, 'Amount must be 0 or more'),
    expenseDate: z.coerce.date(),
    description: z.string().max(200, 'Description is too long').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.category === LabourExpenseCategory.OTHER && !data.categoryOther?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Please specify the category',
        path: ['categoryOther'],
      });
    }
  });

export type CreateLabourExpenseInput = z.infer<typeof createLabourExpenseSchema>;

export const updateLabourExpenseSchema = createLabourExpenseSchema;
export type UpdateLabourExpenseInput = z.infer<typeof updateLabourExpenseSchema>;

export const labourExpenseFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  tender: objectIdSchema.optional(),
  site: objectIdSchema.optional(),
  category: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.nativeEnum(LabourExpenseCategory).optional(),
  ),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

export type LabourExpenseFilterInput = z.infer<typeof labourExpenseFilterSchema>;
