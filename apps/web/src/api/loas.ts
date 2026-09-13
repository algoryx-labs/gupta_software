import api from './axios';
import type { Loa, PaginatedResponse } from '@gupta/shared';
import type { CreateLoaInput, UpdateLoaInput } from '@gupta/shared';
import { uploadAttachmentDirect } from '@/lib/directUpload';

export const loasApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<PaginatedResponse<Loa>>('/loas', { params }).then((r) => r.data),
  get: (id: string) => api.get<Loa>(`/loas/${id}`).then((r) => r.data),
  create: (data: CreateLoaInput) => api.post<Loa>('/loas', data).then((r) => r.data),
  update: (id: string, data: UpdateLoaInput) =>
    api.patch<Loa>(`/loas/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/loas/${id}`).then((r) => r.data),
  uploadAttachment: (id: string, file: File) =>
    uploadAttachmentDirect<Loa>(file, {
      presign: (body) => api.post(`/loas/${id}/attachments/presign`, body).then((r) => r.data),
      complete: (body) =>
        api.post(`/loas/${id}/attachments/complete`, body).then((r) => r.data),
    }),
  deleteAttachment: (id: string, attId: string) =>
    api.delete<Loa>(`/loas/${id}/attachments/${attId}`).then((r) => r.data),
};
