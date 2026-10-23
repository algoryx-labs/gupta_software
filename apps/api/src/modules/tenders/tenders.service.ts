import type { FilterQuery } from 'mongoose';
import {
  type CreateTenderInput,
  type UpdateTenderInput,
  type TenderFilterInput,
  TenderStatus,
} from '@gupta/shared';
import { TenderModel, getNextTenderSerial, type ITender } from '../../models/Tender.js';
import { LabourExpenseModel } from '../../models/LabourExpense.js';
import { resolveCreatedByRef } from '../../config/admin.js';
import { ApiError } from '../../utils/ApiError.js';
import { formatEntityCode } from '../../utils/entityCode.js';
import { getPagination, buildPaginationMeta } from '../../utils/pagination.js';

function buildFilter(filters: TenderFilterInput): FilterQuery<ITender> {
  const query: FilterQuery<ITender> = {};
  if (filters.status) query.status = filters.status;
  if (filters.search) {
    query.$or = [
      { tenderName: new RegExp(filters.search, 'i') },
      { tenderNo: new RegExp(filters.search, 'i') },
      { uniqueId: new RegExp(filters.search, 'i') },
      { code: new RegExp(filters.search, 'i') },
      { bgNumber: new RegExp(filters.search, 'i') },
      { fdrNumber: new RegExp(filters.search, 'i') },
      { 'sites.siteNameRaw': new RegExp(filters.search, 'i') },
    ];
  }
  return query;
}

const STATUS_SORT_ORDER: Record<TenderStatus, number> = {
  [TenderStatus.ACTIVE]: 0,
  [TenderStatus.PENDING]: 1,
  [TenderStatus.COMPLETED]: 2,
  [TenderStatus.CANCELLED]: 3,
  [TenderStatus.EXPIRED]: 4,
};

function compareByStatusThenDate(
  a: { status: TenderStatus; createdAt: Date },
  b: { status: TenderStatus; createdAt: Date },
  dateDir: 1 | -1,
) {
  const statusDiff = STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status];
  if (statusDiff !== 0) return statusDiff;
  return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dateDir;
}

const EXPIRING_SOON_DAYS = 60;

function getNearestExpiryMs(tender: {
  bgExpiryDate?: Date | string;
  fdrExpiryDate?: Date | string;
}): number | null {
  const now = Date.now();
  const windowEnd = now + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000;
  const candidates: number[] = [];

  for (const date of [tender.bgExpiryDate, tender.fdrExpiryDate]) {
    if (!date) continue;
    const ms = new Date(date).getTime();
    if (ms >= now && ms <= windowEnd) candidates.push(ms);
  }

  return candidates.length ? Math.min(...candidates) : null;
}

function compareByExpiringSoon(
  a: {
    bgExpiryDate?: Date | string;
    fdrExpiryDate?: Date | string;
    createdAt: Date;
  },
  b: {
    bgExpiryDate?: Date | string;
    fdrExpiryDate?: Date | string;
    createdAt: Date;
  },
) {
  const aExpiry = getNearestExpiryMs(a);
  const bExpiry = getNearestExpiryMs(b);

  if (aExpiry !== null && bExpiry !== null) return aExpiry - bExpiry;
  if (aExpiry !== null) return -1;
  if (bExpiry !== null) return 1;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function normalizeTender<T extends { sites?: ITender['sites'] }>(tender: T): T {
  return { ...tender, sites: tender.sites ?? [] };
}

function normalizeTenders<T extends { sites?: ITender['sites'] }>(tenders: T[]): T[] {
  return tenders.map(normalizeTender);
}

export async function list(filters: TenderFilterInput) {
  const { page, limit, sortBy = 'createdAt', sortOrder } = filters;
  const { skip } = getPagination(page, limit);
  const filter = buildFilter(filters);
  const dateDir = sortOrder === 'asc' ? 1 : -1;

  if (sortBy === 'expiringSoon') {
    const [allData, total] = await Promise.all([
      TenderModel.find(filter)
        .populate('createdBy', 'name')
        .populate('sites.site', 'name code')
        .lean(),
      TenderModel.countDocuments(filter),
    ]);

    const sorted = [...allData].sort(compareByExpiringSoon);
    const data = sorted.slice(skip, skip + limit);

    return { data: normalizeTenders(data), meta: buildPaginationMeta(page, limit, total) };
  }

  if (filters.status) {
    const sort: Record<string, 1 | -1> = { [sortBy]: dateDir };
    const [data, total] = await Promise.all([
      TenderModel.find(filter)
        .populate('createdBy', 'name')
        .populate('sites.site', 'name code')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      TenderModel.countDocuments(filter),
    ]);

    return { data: normalizeTenders(data), meta: buildPaginationMeta(page, limit, total) };
  }

  const [allData, total] = await Promise.all([
    TenderModel.find(filter)
      .populate('createdBy', 'name')
      .populate('sites.site', 'name code')
      .lean(),
    TenderModel.countDocuments(filter),
  ]);

  const sorted = [...allData].sort((a, b) => compareByStatusThenDate(a, b, dateDir));
  const data = sorted.slice(skip, skip + limit);

  return { data: normalizeTenders(data), meta: buildPaginationMeta(page, limit, total) };
}

export async function listForExport(filters: TenderFilterInput) {
  const filter = buildFilter(filters);
  const dateDir = filters.sortOrder === 'asc' ? 1 : -1;
  const data = await TenderModel.find(filter).populate('sites.site', 'name code').lean();

  const sorted =
    filters.sortBy === 'expiringSoon'
      ? [...data].sort(compareByExpiringSoon)
      : filters.status
        ? [...data].sort(
            (a, b) =>
              (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dateDir,
          )
        : [...data].sort((a, b) => compareByStatusThenDate(a, b, dateDir));

  return normalizeTenders(sorted);
}

export async function create(input: CreateTenderInput, userId: string) {
  const serialNo = await getNextTenderSerial();
  const code = formatEntityCode('TND', serialNo);
  return TenderModel.create({ ...input, serialNo, code, createdBy: resolveCreatedByRef(userId) });
}

export async function getById(id: string) {
  const tender = await TenderModel.findById(id)
    .populate('createdBy', 'name email')
    .populate('sites.site', 'name code');
  if (!tender) throw new ApiError(404, 'Tender not found');
  return normalizeTender(tender.toObject());
}

export async function update(id: string, input: UpdateTenderInput) {
  const tender = await TenderModel.findByIdAndUpdate(id, input, { new: true, runValidators: true })
    .populate('sites.site', 'name code');
  if (!tender) throw new ApiError(404, 'Tender not found');
  return tender;
}

export async function remove(id: string) {
  const linkedExpenses = await LabourExpenseModel.countDocuments({ tender: id });
  if (linkedExpenses > 0) {
    throw new ApiError(409, 'Cannot delete tender while labour expenses are linked to it');
  }

  const tender = await TenderModel.findByIdAndDelete(id);
  if (!tender) throw new ApiError(404, 'Tender not found');
  return tender;
}

export async function addAttachment(id: string, filename: string, url: string) {
  const tender = await TenderModel.findByIdAndUpdate(
    id,
    { $push: { attachments: { filename, url, uploadedAt: new Date() } } },
    { new: true },
  );
  if (!tender) throw new ApiError(404, 'Tender not found');
  return tender;
}

export { TenderStatus };
