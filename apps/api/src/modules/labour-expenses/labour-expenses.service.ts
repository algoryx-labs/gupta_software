import mongoose, { type FilterQuery } from 'mongoose';
import {
  LabourExpenseCategory,
  type CreateLabourExpenseInput,
  type LabourExpenseFilterInput,
  type UpdateLabourExpenseInput,
} from '@gupta/shared';
import { LabourExpenseModel, type ILabourExpense } from '../../models/LabourExpense.js';
import { resolveCreatedByRef } from '../../config/admin.js';
import { ApiError } from '../../utils/ApiError.js';
import { getPagination, buildPaginationMeta } from '../../utils/pagination.js';

function buildFilter(filters: LabourExpenseFilterInput): FilterQuery<ILabourExpense> {
  const query: FilterQuery<ILabourExpense> = {};

  if (filters.tender) query.tender = filters.tender;
  if (filters.site) query.site = filters.site;
  if (filters.category) query.category = filters.category;
  if (filters.dateFrom || filters.dateTo) {
    query.expenseDate = {};
    if (filters.dateFrom) query.expenseDate.$gte = filters.dateFrom;
    if (filters.dateTo) query.expenseDate.$lte = filters.dateTo;
  }

  return query;
}

function normalizeCategoryFields(input: CreateLabourExpenseInput): CreateLabourExpenseInput {
  const category = input.category ?? LabourExpenseCategory.OTHER;
  if (category !== LabourExpenseCategory.OTHER) {
    return { ...input, category, categoryOther: undefined };
  }
  return { ...input, category, categoryOther: input.categoryOther?.trim() || undefined };
}

function withCategoryDefaults<T extends { category?: LabourExpenseCategory | null; categoryOther?: string }>(
  row: T,
): T & { category: LabourExpenseCategory } {
  return {
    ...row,
    category: row.category ?? LabourExpenseCategory.OTHER,
  };
}

export async function list(filters: LabourExpenseFilterInput) {
  const { page, limit } = filters;
  const { skip } = getPagination(page, limit);
  const filter = buildFilter(filters);

  const [data, total] = await Promise.all([
    LabourExpenseModel.find(filter)
      .populate('tender', 'tenderName tenderNo')
      .populate('site', 'name code')
      .populate('createdBy', 'name')
      .sort({ expenseDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    LabourExpenseModel.countDocuments(filter),
  ]);

  return {
    data: data.map((row) => withCategoryDefaults(row)),
    meta: buildPaginationMeta(page, limit, total),
  };
}

export async function create(input: CreateLabourExpenseInput, userId: string) {
  const payload = normalizeCategoryFields(input);
  const expense = await LabourExpenseModel.create({
    ...payload,
    category: payload.category,
    createdBy: resolveCreatedByRef(userId),
  });

  return LabourExpenseModel.findById(expense._id)
    .populate('tender', 'tenderName tenderNo')
    .populate('site', 'name code')
    .populate('createdBy', 'name')
    .lean()
    .then((row) => (row ? withCategoryDefaults(row) : row));
}

export async function update(id: string, input: UpdateLabourExpenseInput) {
  const payload = normalizeCategoryFields(input);
  const expense = await LabourExpenseModel.findByIdAndUpdate(
    id,
    {
      tender: payload.tender,
      site: payload.site ?? null,
      siteNameRaw: payload.siteNameRaw,
      category: payload.category,
      categoryOther: payload.categoryOther ?? null,
      amount: payload.amount,
      expenseDate: payload.expenseDate,
      description: payload.description || null,
    },
    { new: true, runValidators: true },
  )
    .populate('tender', 'tenderName tenderNo')
    .populate('site', 'name code')
    .populate('createdBy', 'name')
    .lean();

  if (!expense) throw new ApiError(404, 'Labour expense not found');
  return withCategoryDefaults(expense);
}

export async function remove(id: string) {
  const expense = await LabourExpenseModel.findByIdAndDelete(id);
  if (!expense) throw new ApiError(404, 'Labour expense not found');
  return expense;
}

type LabourExpenseRecent = {
  _id: mongoose.Types.ObjectId;
  tender: unknown;
  site?: unknown;
  siteNameRaw: string;
  category: LabourExpenseCategory;
  categoryOther?: string;
  amount: number;
  expenseDate: Date;
  description?: string;
  notes?: string;
};

export async function getSummaryStats(
  dateFrom?: Date,
  dateTo?: Date,
  tender?: string,
): Promise<{
  totalAmount: number;
  totalCount: number;
  bySite: { siteName: string; total: number; count: number }[];
  recent: LabourExpenseRecent[];
}> {
  const match: FilterQuery<ILabourExpense> = {};
  if (tender) match.tender = new mongoose.Types.ObjectId(tender);
  if (dateFrom || dateTo) {
    match.expenseDate = {};
    if (dateFrom) match.expenseDate.$gte = dateFrom;
    if (dateTo) match.expenseDate.$lte = dateTo;
  }

  const [stats, bySite, recentDocs] = await Promise.all([
    LabourExpenseModel.aggregate<{ totalAmount: number; totalCount: number }>([
      { $match: match },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          totalCount: { $sum: 1 },
        },
      },
    ]),
    LabourExpenseModel.aggregate<{ siteName: string; total: number; count: number }>([
      { $match: match },
      { $group: { _id: '$siteNameRaw', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 10 },
      { $project: { siteName: '$_id', total: 1, count: 1, _id: 0 } },
    ]),
    LabourExpenseModel.find(match)
      .populate('tender', 'tenderName tenderNo')
      .populate('site', 'name code')
      .sort({ expenseDate: -1 })
      .limit(10)
      .lean(),
  ]);

  const summary = stats[0] ?? { totalAmount: 0, totalCount: 0 };
  const recent: LabourExpenseRecent[] = recentDocs.map((row) => ({
    _id: row._id as mongoose.Types.ObjectId,
    tender: row.tender,
    site: row.site,
    siteNameRaw: row.siteNameRaw,
    category: row.category ?? LabourExpenseCategory.OTHER,
    categoryOther: row.categoryOther,
    amount: row.amount,
    expenseDate: row.expenseDate,
    description: row.description,
  }));

  return {
    totalAmount: summary.totalAmount,
    totalCount: summary.totalCount,
    bySite,
    recent,
  };
}
