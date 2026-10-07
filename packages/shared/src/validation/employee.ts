import { z } from 'zod';
import { EmployeeCategory } from '../enums.js';
import { objectIdSchema } from './common.js';

const employeeFieldsSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  phone: z.string().min(1, 'Phone is required').max(20),
  salary: z.coerce.number().min(0, 'Salary must be 0 or more'),
  category: z.nativeEnum(EmployeeCategory, { required_error: 'Category is required' }),
  categoryOther: z.string().max(100, 'Category is too long').optional(),
});

function refineCategoryOther<T extends { category?: EmployeeCategory; categoryOther?: string }>(
  data: T,
  ctx: z.RefinementCtx,
) {
  if (data.category === EmployeeCategory.OTHER && !data.categoryOther?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Please specify the category',
      path: ['categoryOther'],
    });
  }
}

export const createEmployeeSchema = employeeFieldsSchema.superRefine(refineCategoryOther);

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = employeeFieldsSchema.partial().superRefine(refineCategoryOther);

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const employeeFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.enum(['unassigned', 'assigned', 'changed']).optional(),
  tender: objectIdSchema.optional(),
  category: z.nativeEnum(EmployeeCategory).optional(),
});

export type EmployeeFilterInput = z.infer<typeof employeeFilterSchema>;

export const assignEmployeeSchema = z.object({
  tender: objectIdSchema,
  /** Optional initial days; omitted/undefined keeps prod clients working (defaults to 0). */
  daysWorked: z.coerce.number().int().min(0, 'Days must be 0 or more').optional(),
});

export type AssignEmployeeInput = z.infer<typeof assignEmployeeSchema>;

export const changeEmployeeTenderSchema = z.object({
  tender: objectIdSchema,
  daysWorkedOnCurrent: z.coerce.number().int().min(0, 'Days must be 0 or more'),
});

export type ChangeEmployeeTenderInput = z.infer<typeof changeEmployeeTenderSchema>;

export const unassignEmployeeSchema = z.object({
  daysWorkedOnCurrent: z.coerce.number().int().min(0, 'Days must be 0 or more').optional(),
});

export type UnassignEmployeeInput = z.infer<typeof unassignEmployeeSchema>;

export const updateEmployeeDaysSchema = z.object({
  daysWorked: z.coerce.number().int().min(0, 'Days must be 0 or more'),
});

export type UpdateEmployeeDaysInput = z.infer<typeof updateEmployeeDaysSchema>;

export const tenderExpenseFilterSchema = z.object({
  tender: objectIdSchema.optional(),
});

export type TenderExpenseFilterInput = z.infer<typeof tenderExpenseFilterSchema>;
