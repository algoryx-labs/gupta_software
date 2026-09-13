import type { Request, Response } from 'express';
import type { AttachmentCompleteInput, AttachmentPresignInput } from '@gupta/shared';
import { ApiError } from '../../utils/ApiError.js';
import {
  createAttachmentPresign,
  resolveCompletedAttachment,
  storeAttachment,
} from '../../utils/attachmentStorage.js';
import * as svc from './purchases.service.js';

export async function list(req: Request, res: Response) {
  res.json(await svc.list(req.query as never));
}

export async function create(req: Request, res: Response) {
  const purchase = await svc.create(req.body, req.user!.sub);
  res.status(201).json(purchase);
}

export async function getById(req: Request, res: Response) {
  res.json(await svc.getById(req.params.id));
}

export async function update(req: Request, res: Response) {
  res.json(await svc.update(req.params.id, req.body));
}

export async function remove(req: Request, res: Response) {
  await svc.remove(req.params.id);
  res.json({ message: 'Purchase deleted' });
}

export async function presignAttachment(req: Request, res: Response) {
  const body = req.body as AttachmentPresignInput;
  // Ensure the purchase exists before issuing a signed URL.
  await svc.getById(req.params.id);
  res.json(
    await createAttachmentPresign('purchases', body.filename, body.contentType, { pdfOnly: true }),
  );
}

export async function completeAttachment(req: Request, res: Response) {
  const body = req.body as AttachmentCompleteInput;
  const stored = resolveCompletedAttachment('purchases', body);
  res.json(await svc.addAttachment(req.params.id, stored.filename, stored.url));
}

export async function uploadAttachment(req: Request, res: Response) {
  if (!req.file) {
    throw new ApiError(400, 'No file uploaded');
  }

  const stored = await storeAttachment(req.file, 'purchases', { pdfOnly: true });
  res.json(await svc.addAttachment(req.params.id, stored.filename, stored.url));
}

export async function deleteAttachment(req: Request, res: Response) {
  res.json(await svc.removeAttachment(req.params.id, req.params.attId));
}

export async function exportData(req: Request, res: Response) {
  const data = await svc.listForExport(req.query as never);
  res.json({ data });
}
