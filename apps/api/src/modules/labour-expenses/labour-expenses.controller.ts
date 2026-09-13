import type { Request, Response } from 'express';
import * as svc from './labour-expenses.service.js';

export async function list(req: Request, res: Response) {
  res.json(await svc.list(req.query as never));
}

export async function create(req: Request, res: Response) {
  const expense = await svc.create(req.body, req.user!.sub);
  res.status(201).json(expense);
}

export async function update(req: Request, res: Response) {
  const expense = await svc.update(req.params.id, req.body);
  res.json(expense);
}

export async function remove(req: Request, res: Response) {
  await svc.remove(req.params.id);
  res.json({ message: 'Labour expense deleted' });
}
