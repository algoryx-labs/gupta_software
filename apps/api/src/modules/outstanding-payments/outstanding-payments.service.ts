import mongoose, { type FilterQuery } from 'mongoose';
import {
  type CreateOutstandingPaymentInput,
  type OutstandingPaymentFilterInput,
} from '@gupta/shared';
import { OutstandingPaymentModel, type IOutstandingPayment } from '../../models/OutstandingPayment.js';
import { TenderModel } from '../../models/Tender.js';
import { resolveCreatedByRef } from '../../config/admin.js';
import { ApiError } from '../../utils/ApiError.js';
import { getPagination, buildPaginationMeta } from '../../utils/pagination.js';

function buildFilter(filters: OutstandingPaymentFilterInput): FilterQuery<IOutstandingPayment> {
  const query: FilterQuery<IOutstandingPayment> = {};

  if (filters.tender) query.tender = filters.tender;
  if (filters.site) query.site = filters.site;
  if (filters.dateFrom || filters.dateTo) {
    query.paymentDate = {};
    if (filters.dateFrom) query.paymentDate.$gte = filters.dateFrom;
    if (filters.dateTo) query.paymentDate.$lte = filters.dateTo;
  }

  return query;
}

export async function list(filters: OutstandingPaymentFilterInput) {
  const { page, limit } = filters;
  const { skip } = getPagination(page, limit);
  const filter = buildFilter(filters);

  const [data, total] = await Promise.all([
    OutstandingPaymentModel.find(filter)
      .populate('tender', 'tenderName tenderNo paymentOutstanding')
      .populate('site', 'name code')
      .populate('createdBy', 'name')
      .sort({ paymentDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    OutstandingPaymentModel.countDocuments(filter),
  ]);

  return { data, meta: buildPaginationMeta(page, limit, total) };
}

function buildCreatePayload(input: CreateOutstandingPaymentInput, userId: string) {
  const createdBy = resolveCreatedByRef(userId);

  return {
    tender: input.tender,
    ...(input.site ? { site: input.site } : {}),
    siteNameRaw: input.siteNameRaw,
    amount: input.amount,
    paymentDate: input.paymentDate,
    ...(input.description ? { description: input.description } : {}),
    ...(createdBy ? { createdBy } : {}),
  };
}

export async function create(input: CreateOutstandingPaymentInput, userId: string) {
  const tender = await TenderModel.findById(input.tender);
  if (!tender) throw new ApiError(404, 'Tender not found');

  const payment = await OutstandingPaymentModel.create(buildCreatePayload(input, userId));

  await TenderModel.findByIdAndUpdate(input.tender, {
    $inc: { paymentOutstanding: input.amount },
  });

  return OutstandingPaymentModel.findById(payment._id)
    .populate('tender', 'tenderName tenderNo paymentOutstanding')
    .populate('site', 'name code')
    .populate('createdBy', 'name')
    .lean();
}

export async function remove(id: string) {
  const payment = await OutstandingPaymentModel.findById(id);
  if (!payment) throw new ApiError(404, 'Outstanding payment not found');

  await OutstandingPaymentModel.findByIdAndDelete(id);
  await TenderModel.findByIdAndUpdate(payment.tender, {
    $inc: { paymentOutstanding: -payment.amount },
  });

  return payment;
}

export async function getSummaryStats(dateFrom?: Date, dateTo?: Date, tender?: string) {
  const match: Record<string, unknown> = {};
  if (tender) match.tender = new mongoose.Types.ObjectId(tender);
  if (dateFrom || dateTo) {
    match.paymentDate = {};
    if (dateFrom) (match.paymentDate as Record<string, Date>).$gte = dateFrom;
    if (dateTo) (match.paymentDate as Record<string, Date>).$lte = dateTo;
  }

  const [stats, byTender, recent] = await Promise.all([
    OutstandingPaymentModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          totalCount: { $sum: 1 },
        },
      },
    ]),
    OutstandingPaymentModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$tender',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'tenders',
          localField: '_id',
          foreignField: '_id',
          as: 'tender',
        },
      },
      { $unwind: { path: '$tender', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          tenderId: '$_id',
          tenderName: { $ifNull: ['$tender.tenderName', 'Unknown'] },
          tenderNo: { $ifNull: ['$tender.tenderNo', ''] },
          total: 1,
          count: 1,
          _id: 0,
        },
      },
    ]),
    OutstandingPaymentModel.find(match)
      .populate('tender', 'tenderName tenderNo')
      .populate('site', 'name code')
      .sort({ paymentDate: -1 })
      .limit(10)
      .lean(),
  ]);

  const summary = stats[0] ?? { totalAmount: 0, totalCount: 0 };

  return {
    totalAmount: summary.totalAmount,
    totalCount: summary.totalCount,
    byTender,
    recent,
  };
}
