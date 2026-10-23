import type { InventoryDirection, InventoryMovementType } from '../enums.js';

export interface InventoryMatrixItem {
  key: string;
  itemId?: string;
  name: string;
  itemDescription: string;
  unit?: string;
  categoryId?: string;
  categoryNameRaw?: string;
  categoryCode?: string;
}

export interface InventoryStockLine {
  itemKey: string;
  itemId?: string;
  itemName: string;
  itemDescription: string;
  unit?: string;
  categoryId?: string;
  categoryNameRaw?: string;
  categoryCode?: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  quantity: number;
  billNo?: string;
  billName?: string;
  /** Unit rate from the purchase line, when available */
  perRate?: number;
  tenderNo?: string;
  tenderName?: string;
}

export interface InventoryMatrixSite {
  _id: string;
  name: string;
  code: string;
}

export interface InventoryMatrixCell {
  itemKey: string;
  siteId: string;
  quantity: number;
}

export interface InventoryOverviewResponse {
  items: InventoryMatrixItem[];
  sites: InventoryMatrixSite[];
  cells: InventoryMatrixCell[];
  stockLines: InventoryStockLine[];
}

export interface InventoryReceipt {
  purchaseId: string;
  purchaseSerialNo: number;
  billNo: string;
  billName?: string;
  billDate: string | Date;
  siteId: string;
  siteName: string;
  siteCode: string;
  purchaseItemId: string;
  itemId?: string;
  itemKey: string;
  itemDescription: string;
  unit?: string;
  categoryId?: string;
  categoryNameRaw?: string;
  categoryCode?: string;
  receivedQty: number;
  balanceQty: number;
  perRate?: number;
  tenderNo?: string;
  tenderName?: string;
}

export interface InventoryLedgerEntry {
  _id: string;
  movementType: InventoryMovementType;
  direction: InventoryDirection;
  item?: string;
  itemDescription: string;
  unit?: string;
  categoryId?: string;
  categoryNameRaw?: string;
  categoryCode?: string;
  site: string;
  siteName?: string;
  siteCode?: string;
  quantity: number;
  fromSite?: string;
  fromSiteName?: string;
  toSite?: string;
  toSiteName?: string;
  purchaseId?: string;
  purchaseSerialNo?: number;
  billNo?: string;
  notes?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt: string | Date;
}
