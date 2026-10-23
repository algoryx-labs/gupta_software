import type { FilterQuery } from 'mongoose';
import {
  buildPurchaseItemsWithTotals,
  computePurchaseAggregateTotals,
  type CreatePurchaseInput,
  type UpdatePurchaseInput,
  type PurchaseFilterInput,
} from '@gupta/shared';
import { PurchaseModel, getNextPurchaseSerial, type IPurchase, type IPurchaseItem } from '../../models/Purchase.js';
import { resolveCreatedByRef } from '../../config/admin.js';
import { ApiError } from '../../utils/ApiError.js';
import { removeStoredAttachment } from '../../utils/attachmentStorage.js';
import { getPagination, buildPaginationMeta } from '../../utils/pagination.js';
import * as inventorySvc from '../inventory/inventory.service.js';

type LegacyPurchase = IPurchase & {
  itemDescription?: string;
  item?: IPurchaseItem['item'];
  qty?: number;
  unit?: string;
  perRate?: number;
  freight?: number;
  labour?: number;
  gstPercent?: number;
  isHmPurchase?: boolean;
};

function normalizePurchase<T extends LegacyPurchase>(purchase: T): T {
  if (purchase.items?.length) return purchase;

  if (!purchase.itemDescription) return purchase;

  const legacyItem: IPurchaseItem = {
    itemDescription: purchase.itemDescription,
    item: purchase.item,
    qty: purchase.qty,
    unit: purchase.unit,
    perRate: purchase.perRate,
    freight: purchase.freight ?? 0,
    labour: purchase.labour ?? 0,
    subTotal: purchase.subTotal ?? 0,
    gstPercent: purchase.gstPercent ?? 18,
    gstAmount: purchase.gstAmount ?? 0,
    grandTotal: purchase.grandTotal ?? 0,
    isHmPurchase: purchase.isHmPurchase ?? false,
  };

  return { ...purchase, items: [legacyItem] };
}

function normalizePurchases<T extends LegacyPurchase>(purchases: T[]): T[] {
  return purchases.map(normalizePurchase);
}

function applyTotals(input: Pick<CreatePurchaseInput, 'items'>) {
  const items = buildPurchaseItemsWithTotals(input.items);
  const totals = computePurchaseAggregateTotals(items);
  return { items, ...totals };
}

function buildFilter(filters: PurchaseFilterInput): FilterQuery<IPurchase> {
  const query: FilterQuery<IPurchase> = {};

  if (filters.site) query.site = filters.site;
  if (filters.vendor) query.vendor = filters.vendor;
  if (filters.dateFrom || filters.dateTo) {
    query.billDate = {};
    if (filters.dateFrom) query.billDate.$gte = filters.dateFrom;
    if (filters.dateTo) query.billDate.$lte = filters.dateTo;
  }
  if (filters.search) {
    query.$or = [
      { billNo: new RegExp(filters.search, 'i') },
      { billName: new RegExp(filters.search, 'i') },
      { 'items.itemDescription': new RegExp(filters.search, 'i') },
      { itemDescription: new RegExp(filters.search, 'i') },
      { vendorNameRaw: new RegExp(filters.search, 'i') },
      { siteNameRaw: new RegExp(filters.search, 'i') },
    ];
  }

  return query;
}

const PURCHASE_SORT_FIELDS = new Set([
  'serialNo',
  'billDate',
  'billNo',
  'billName',
  'vendorNameRaw',
  'siteNameRaw',
  'grandTotal',
  'createdAt',
  'updatedAt',
]);

function buildPurchaseSort(sortBy = 'serialNo', sortOrder?: 'asc' | 'desc') {
  const direction: 1 | -1 = sortOrder === 'asc' ? 1 : -1;
  const key = PURCHASE_SORT_FIELDS.has(sortBy) ? sortBy : 'serialNo';
  const sort: Record<string, 1 | -1> = { [key]: direction };
  // Keep newest uploads on top when the primary key ties (or is not serialNo).
  if (key !== 'serialNo') sort.serialNo = -1;
  return { sort, numericBillNo: key === 'billNo' };
}

function applyPurchaseQuerySort<T extends ReturnType<typeof PurchaseModel.find>>(
  query: T,
  sortBy?: string,
  sortOrder?: 'asc' | 'desc',
) {
  const { sort, numericBillNo } = buildPurchaseSort(sortBy, sortOrder);
  let sorted = query.sort(sort);
  if (numericBillNo) {
    sorted = sorted.collation({ locale: 'en', numericOrdering: true });
  }
  return sorted;
}

export async function list(filters: PurchaseFilterInput) {
  const { page, limit, sortBy = 'serialNo', sortOrder } = filters;
  const { skip } = getPagination(page, limit);
  const filter = buildFilter(filters);
  const [data, total] = await Promise.all([
    applyPurchaseQuerySort(
      PurchaseModel.find(filter)
        .populate('vendor', 'name code gstin')
        .populate('tender', 'tenderName tenderNo code')
        .populate('site', 'name code')
        .populate('items.item', 'name')
        .populate('items.category', 'name code')
        .populate('createdBy', 'name'),
      sortBy,
      sortOrder,
    )
      .skip(skip)
      .limit(limit)
      .lean(),
    PurchaseModel.countDocuments(filter),
  ]);

  return { data: normalizePurchases(data as unknown as LegacyPurchase[]), meta: buildPaginationMeta(page, limit, total) };
}

export async function listForExport(filters: PurchaseFilterInput) {
  const filter = buildFilter(filters);
  const data = await applyPurchaseQuerySort(
    PurchaseModel.find(filter)
      .populate('vendor', 'name code')
      .populate('tender', 'tenderName tenderNo code')
      .populate('site', 'name code'),
    filters.sortBy,
    filters.sortOrder,
  ).lean();
  return normalizePurchases(data as unknown as LegacyPurchase[]);
}

export async function create(input: CreatePurchaseInput, userId: string) {
  const totals = applyTotals(input);
  const serialNo = await getNextPurchaseSerial();
  const resolvedSite = await inventorySvc.resolvePurchaseSiteId({
    site: input.site,
    siteNameRaw: input.siteNameRaw,
  });

  const purchase = await PurchaseModel.create({
    ...input,
    site: resolvedSite ?? input.site,
    ...totals,
    serialNo,
    createdBy: resolveCreatedByRef(userId),
  });

  await inventorySvc.syncPurchaseLedger(purchase, userId);
  return purchase;
}

export async function getById(id: string) {
  const purchase = await PurchaseModel.findById(id)
    .populate('vendor', 'name code gstin')
    .populate('tender', 'tenderName tenderNo code')
    .populate('site', 'name code')
    .populate('items.item', 'name')
    .populate('items.category', 'name code')
    .populate('createdBy', 'name email');

  if (!purchase) throw new ApiError(404, 'Purchase not found');
  return normalizePurchase(purchase.toObject() as LegacyPurchase);
}

export async function update(id: string, input: UpdatePurchaseInput) {
  const existing = await PurchaseModel.findById(id);
  if (!existing) throw new ApiError(404, 'Purchase not found');

  const updatePayload: Record<string, unknown> = { ...input };

  if (input.items) {
    Object.assign(updatePayload, applyTotals({ items: input.items }));
  }

  const resolvedSite = await inventorySvc.resolvePurchaseSiteId({
    site: (input.site ?? existing.site)?.toString(),
    siteNameRaw: input.siteNameRaw ?? existing.siteNameRaw,
  });
  if (resolvedSite) updatePayload.site = resolvedSite;

  const purchase = await PurchaseModel.findByIdAndUpdate(id, updatePayload, {
    new: true,
    runValidators: true,
  })
    .populate('vendor', 'name code')
    .populate('tender', 'tenderName tenderNo code')
    .populate('site', 'name code')
    .populate('items.item', 'name')
    .populate('items.category', 'name code');

  if (purchase) await inventorySvc.syncPurchaseLedger(purchase, undefined);
  return purchase;
}

export async function remove(id: string) {
  const purchase = await PurchaseModel.findByIdAndDelete(id);
  if (!purchase) throw new ApiError(404, 'Purchase not found');
  await inventorySvc.removePurchaseLedger(id);
  return purchase;
}

export async function addAttachment(id: string, filename: string, url: string) {
  const purchase = await PurchaseModel.findByIdAndUpdate(
    id,
    { $push: { attachments: { filename, url, uploadedAt: new Date() } } },
    { new: true },
  );
  if (!purchase) throw new ApiError(404, 'Purchase not found');
  return purchase;
}

export async function removeAttachment(id: string, attId: string) {
  const purchase = await PurchaseModel.findById(id);
  if (!purchase) throw new ApiError(404, 'Purchase not found');

  const attachment = purchase.attachments.find((att) => att._id?.toString() === attId);
  if (attachment?.url && attachment.url.startsWith('http')) {
    await removeStoredAttachment(attachment.url);
  }

  const updated = await PurchaseModel.findByIdAndUpdate(
    id,
    { $pull: { attachments: { _id: attId } } },
    { new: true },
  );
  if (!updated) throw new ApiError(404, 'Purchase not found');
  return updated;
}
