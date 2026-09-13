import api from './axios';
import type { LabourExpense, PaginatedResponse } from '@gupta/shared';
import type { CreateLabourExpenseInput, UpdateLabourExpenseInput } from '@gupta/shared';

export const labourExpensesApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<PaginatedResponse<LabourExpense>>('/labour-expenses', { params }).then((r) => r.data),
  create: (data: CreateLabourExpenseInput) =>
    api.post<LabourExpense>('/labour-expenses', data).then((r) => r.data),
  update: (id: string, data: UpdateLabourExpenseInput) =>
    api.patch<LabourExpense>(`/labour-expenses/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/labour-expenses/${id}`).then((r) => r.data),
};
