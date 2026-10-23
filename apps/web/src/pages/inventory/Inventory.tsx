import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowRightLeft, Download, MinusCircle, Package } from 'lucide-react';
import type { InventoryLedgerEntry } from '@gupta/shared';
import type {
  AllocateStockInput,
  ConsumeStockInput,
  InventoryReceipt,
  InventoryStockLine,
} from '@gupta/shared';
import { inventoryApi } from '@/api/inventory';
import { sitesApi, categoriesApi } from '@/api/masters';
import { tendersApi } from '@/api/tenders';
import { PageWrapper } from '@/layouts/PageWrapper';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { Badge } from '@/components/Badge';
import { Spinner } from '@/components/Spinner';
import { Pagination } from '@/components/Pagination';
import { exportToExcel } from '@/lib/exportToExcel';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { toast } from '@/lib/notify';
import { InventoryMovementType } from '@gupta/shared';

type Tab = 'overview' | 'receipts' | 'ledger';

type InventoryFilterState = {
  search: string;
  siteId: string;
  categoryId: string;
  movementType: string;
};

const defaultFilters = (): InventoryFilterState => ({
  search: '',
  siteId: '',
  categoryId: '',
  movementType: '',
});

const movementTypeOptions = [
  { value: '', label: 'All transactions' },
  { value: InventoryMovementType.PURCHASE_IN, label: 'Stock In' },
  { value: InventoryMovementType.ALLOCATION, label: 'Transfer' },
  { value: InventoryMovementType.CONSUMPTION, label: 'Stock Out' },
  { value: InventoryMovementType.ADJUSTMENT, label: 'Adjustment' },
];

function matchesSearch(values: Array<string | undefined>, search: string) {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const haystack = values.filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(q);
}

function filterStockLine(line: InventoryStockLine, filters: InventoryFilterState) {
  if (filters.siteId && line.siteId !== filters.siteId) return false;
  if (filters.categoryId && line.categoryId !== filters.categoryId) return false;
  return matchesSearch(
    [
      line.itemName,
      line.itemDescription,
      line.categoryNameRaw,
      line.categoryCode,
      line.billNo,
      line.billName,
      line.tenderNo,
      line.tenderName,
      line.siteCode,
      line.siteName,
    ],
    filters.search,
  );
}

function filterReceipt(receipt: InventoryReceipt, filters: InventoryFilterState) {
  if (filters.siteId && receipt.siteId !== filters.siteId) return false;
  if (filters.categoryId && receipt.categoryId !== filters.categoryId) return false;
  return matchesSearch(
    [
      receipt.itemDescription,
      receipt.categoryNameRaw,
      receipt.categoryCode,
      receipt.billNo,
      receipt.billName,
      receipt.tenderNo,
      receipt.tenderName,
      receipt.siteCode,
      receipt.siteName,
      String(receipt.purchaseSerialNo),
    ],
    filters.search,
  );
}

function hasActiveFilters(filters: InventoryFilterState, includeMovementType: boolean) {
  return Boolean(
    filters.search.trim() ||
      filters.siteId ||
      filters.categoryId ||
      (includeMovementType && filters.movementType),
  );
}

type LedgerDisplayRow = {
  id: string;
  date: string | Date;
  label: string;
  badgeVariant: string;
  itemDescription: string;
  categoryNameRaw?: string;
  categoryCode?: string;
  unit?: string;
  quantity: number;
  detail: React.ReactNode;
  qtyPrefix: '+' | '−' | '';
  qtyClass: string;
  reference?: string;
};

function CategoryTag({
  name,
  code,
}: {
  name?: string;
  code?: string;
}) {
  if (!name?.trim()) {
    return (
      <Badge variant="default" className="normal-case text-muted">
        Uncategorized
      </Badge>
    );
  }

  return (
    <Badge variant="admin" className="normal-case">
      {code ? `${code} · ${name}` : name}
    </Badge>
  );
}

function ledgerCategoryFields(entry: InventoryLedgerEntry) {
  return {
    categoryNameRaw: entry.categoryNameRaw,
    categoryCode: entry.categoryCode,
  };
}

function isAllocationPair(a: InventoryLedgerEntry, b: InventoryLedgerEntry) {
  return (
    a.movementType === 'ALLOCATION' &&
    b.movementType === 'ALLOCATION' &&
    a.fromSite === b.fromSite &&
    a.toSite === b.toSite &&
    a.itemDescription === b.itemDescription &&
    a.quantity === b.quantity &&
    Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) < 5000
  );
}

function buildLedgerRows(entries: InventoryLedgerEntry[]): LedgerDisplayRow[] {
  const used = new Set<string>();
  const rows: LedgerDisplayRow[] = [];

  for (const entry of entries) {
    if (used.has(entry._id)) continue;

    if (entry.movementType === 'ALLOCATION' && entry.direction === 'OUT') {
      const inEntry = entries.find(
        (e) =>
          !used.has(e._id) &&
          e.direction === 'IN' &&
          isAllocationPair(entry, e),
      );
      if (inEntry) {
        used.add(entry._id);
        used.add(inEntry._id);
        rows.push({
          id: entry._id,
          date: entry.createdAt,
          label: 'Transfer',
          badgeVariant: 'active',
          itemDescription: entry.itemDescription,
          ...ledgerCategoryFields(entry),
          unit: entry.unit,
          quantity: entry.quantity,
          detail: (
            <span className="inline-flex items-center gap-1.5">
              <span className="font-medium">{entry.fromSiteName ?? '—'}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted" />
              <span className="font-medium">{entry.toSiteName ?? '—'}</span>
            </span>
          ),
          qtyPrefix: '',
          qtyClass: 'text-gray-900',
          reference: entry.notes ?? undefined,
        });
        continue;
      }
    }

    if (entry.movementType === 'ALLOCATION' && entry.direction === 'IN') {
      const hasOutPair = entries.some(
        (e) => !used.has(e._id) && e.direction === 'OUT' && isAllocationPair(e, entry),
      );
      if (hasOutPair) continue;
    }

    used.add(entry._id);

    if (entry.movementType === 'PURCHASE_IN') {
      rows.push({
        id: entry._id,
        date: entry.createdAt,
        label: 'Stock In',
        badgeVariant: 'completed',
        itemDescription: entry.itemDescription,
        ...ledgerCategoryFields(entry),
        unit: entry.unit,
        quantity: entry.quantity,
        detail: (
          <span>
            Received at <span className="font-medium">{entry.siteName ?? entry.siteCode ?? '—'}</span>
          </span>
        ),
        qtyPrefix: '+',
        qtyClass: 'text-green-700',
        reference: entry.billNo ? `Bill ${entry.billNo}` : entry.notes,
      });
      continue;
    }

    if (entry.movementType === 'CONSUMPTION') {
      rows.push({
        id: entry._id,
        date: entry.createdAt,
        label: 'Stock Out',
        badgeVariant: 'expired',
        itemDescription: entry.itemDescription,
        ...ledgerCategoryFields(entry),
        unit: entry.unit,
        quantity: entry.quantity,
        detail: (
          <span>
            Issued from <span className="font-medium">{entry.siteName ?? entry.siteCode ?? '—'}</span>
          </span>
        ),
        qtyPrefix: '−',
        qtyClass: 'text-red-600',
        reference: entry.notes,
      });
      continue;
    }

    const isEntry = entry.direction === 'IN';
    rows.push({
      id: entry._id,
      date: entry.createdAt,
      label: isEntry ? 'Entry' : 'Exit',
      badgeVariant: isEntry ? 'completed' : 'expired',
      itemDescription: entry.itemDescription,
      ...ledgerCategoryFields(entry),
      unit: entry.unit,
      quantity: entry.quantity,
      detail: (
        <span>
          {isEntry ? 'Added at' : 'Removed from'}{' '}
          <span className="font-medium">{entry.siteName ?? entry.siteCode ?? '—'}</span>
        </span>
      ),
      qtyPrefix: isEntry ? '+' : '−',
      qtyClass: isEntry ? 'text-green-700' : 'text-red-600',
      reference: entry.notes ?? entry.billNo,
    });
  }

  return rows;
}

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [ledgerPage, setLedgerPage] = useState(1);
  const [filters, setFilters] = useState<InventoryFilterState>(defaultFilters);
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [consumeOpen, setConsumeOpen] = useState(false);
  const [allocateForm, setAllocateForm] = useState<AllocateStockInput>({
    fromSiteId: '',
    toSiteId: '',
    itemDescription: '',
    quantity: 0,
  });
  const [allocateContext, setAllocateContext] = useState<{
    fromSiteLabel: string;
    itemLabel: string;
    availableQty: number;
    unit?: string;
  } | null>(null);
  const [consumeForm, setConsumeForm] = useState<ConsumeStockInput>({
    siteId: '',
    itemDescription: '',
    quantity: 0,
  });
  const [consumeItemKey, setConsumeItemKey] = useState('');

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['inventory', 'overview'],
    queryFn: inventoryApi.overview,
  });

  const stockLines = overview?.stockLines ?? [];

  const { data: categoriesData } = useQuery({
    queryKey: ['categories', 'inventory-filters'],
    queryFn: () => categoriesApi.list({ limit: 100 }),
  });

  const { data: receipts, isLoading: receiptsLoading } = useQuery({
    queryKey: ['inventory', 'receipts'],
    queryFn: inventoryApi.receipts,
    enabled: tab === 'receipts' || consumeOpen,
  });

  const { data: sitesData } = useQuery({
    queryKey: ['sites', 'inventory-allocate'],
    queryFn: () => sitesApi.list({ limit: 100 }),
    enabled: allocateOpen,
  });

  const { data: tendersData } = useQuery({
    queryKey: ['tenders', 'inventory-allocate'],
    queryFn: () => tendersApi.list({ limit: 100 }),
    enabled: allocateOpen,
  });

  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: [
      'inventory',
      'ledger',
      ledgerPage,
      filters.siteId,
      filters.categoryId,
      filters.movementType,
      filters.search,
    ],
    queryFn: () =>
      inventoryApi.ledger({
        page: ledgerPage,
        limit: 20,
        site: filters.siteId || undefined,
        category: filters.categoryId || undefined,
        movementType: filters.movementType || undefined,
        search: filters.search.trim() || undefined,
      }),
    enabled: tab === 'ledger',
  });

  const siteOptions = useMemo(() => {
    const sites = overview?.sites ?? [];
    return [
      { value: '', label: 'All sites' },
      ...sites.map((site) => ({ value: site._id, label: `${site.code} — ${site.name}` })),
    ];
  }, [overview?.sites]);

  const categoryOptions = useMemo(() => {
    const categories = categoriesData?.data ?? [];
    return [
      { value: '', label: 'All categories' },
      ...categories.map((category) => ({
        value: category._id,
        label: category.code ? `${category.code} — ${category.name}` : category.name,
      })),
    ];
  }, [categoriesData]);

  const filteredStockLines = useMemo(
    () => stockLines.filter((line) => filterStockLine(line, filters)),
    [stockLines, filters],
  );

  const filteredReceipts = useMemo(
    () => (receipts ?? []).filter((receipt) => filterReceipt(receipt, filters)),
    [receipts, filters],
  );

  const updateFilters = (patch: Partial<InventoryFilterState>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setLedgerPage(1);
  };

  const clearFilters = () => {
    setFilters(defaultFilters());
    setLedgerPage(1);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
  };

  const allocateMutation = useMutation({
    mutationFn: inventoryApi.allocate,
    onSuccess: () => {
      invalidate();
      toast.success('Stock allocated');
      setAllocateOpen(false);
      setAllocateContext(null);
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      toast.error(err.response?.data?.message ?? 'Failed to allocate stock'),
  });

  const consumeMutation = useMutation({
    mutationFn: inventoryApi.consume,
    onSuccess: () => {
      invalidate();
      toast.success('Stock issued');
      setConsumeOpen(false);
      setConsumeItemKey('');
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      toast.error(err.response?.data?.message ?? 'Failed to issue stock'),
  });

  const toSiteOptions = useMemo(() => {
    const fromId = allocateForm.fromSiteId?.toString() ?? '';
    const fromName = allocateContext?.fromSiteLabel.split('—').pop()?.trim().toLowerCase() ?? '';
    const options: { value: string; label: string }[] = [];
    const seen = new Set<string>();

    const addOption = (value: string, label: string) => {
      if (!value || value === fromId || seen.has(value)) return;
      seen.add(value);
      options.push({ value, label });
    };

    for (const site of sitesData?.data ?? overview?.sites ?? []) {
      addOption(site._id.toString(), `${site.code} — ${site.name}`);
    }

    for (const tender of tendersData?.data ?? []) {
      for (const tenderSite of tender.sites ?? []) {
        const name = tenderSite.siteNameRaw?.trim();
        if (!name) continue;

        const siteRef = tenderSite.site as string | { _id: string } | undefined;
        const linkedId = typeof siteRef === 'string' ? siteRef : siteRef?._id;

        if (linkedId) {
          addOption(linkedId.toString(), name);
        } else if (name.toLowerCase() !== fromName) {
          addOption(`name:${name}`, name);
        }
      }
    }

    options.sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: '', label: 'Select destination site' }, ...options];
  }, [sitesData, tendersData, overview?.sites, allocateForm.fromSiteId, allocateContext]);

  const openAllocateFromStock = (line: InventoryStockLine) => {
    setAllocateForm({
      fromSiteId: line.siteId,
      toSiteId: '',
      itemId: line.itemId,
      itemDescription: line.itemDescription,
      unit: line.unit,
      quantity: line.quantity,
      notes: line.billNo ? `From bill ${line.billNo}` : undefined,
    });
    setAllocateContext({
      fromSiteLabel: `${line.siteCode} — ${line.siteName}`,
      itemLabel: line.itemDescription,
      availableQty: line.quantity,
      unit: line.unit,
    });
    setAllocateOpen(true);
  };

  const openAllocateFromReceipt = (receipt: InventoryReceipt) => {
    setAllocateForm({
      fromSiteId: receipt.siteId,
      toSiteId: '',
      itemId: receipt.itemId,
      itemDescription: receipt.itemDescription,
      unit: receipt.unit,
      quantity: receipt.balanceQty,
      notes: `From purchase #${receipt.purchaseSerialNo} (${receipt.billNo})`,
    });
    setAllocateContext({
      fromSiteLabel: `${receipt.siteCode} — ${receipt.siteName}`,
      itemLabel: receipt.itemDescription,
      availableQty: receipt.balanceQty,
      unit: receipt.unit,
    });
    setAllocateOpen(true);
  };

  const consumeSiteOptions = useMemo(() => {
    const bySite = new Map<string, string>();
    for (const line of stockLines) {
      if (line.quantity <= 0) continue;
      bySite.set(line.siteId, `${line.siteCode} — ${line.siteName}`);
    }
    return [
      { value: '', label: 'Select site' },
      ...[...bySite.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [stockLines]);

  const consumeItemOptions = useMemo(() => {
    if (!consumeForm.siteId) {
      return [{ value: '', label: 'Select site first' }];
    }
    const lines = stockLines.filter(
      (line) => line.siteId === consumeForm.siteId && line.quantity > 0,
    );
    if (!lines.length) {
      return [{ value: '', label: 'No stock at this site' }];
    }
    return [
      { value: '', label: 'Select item' },
      ...lines.map((line) => ({
        value: line.itemKey,
        label: `${line.itemDescription} (${line.quantity} ${line.unit ?? ''} available)`.trim(),
      })),
    ];
  }, [stockLines, consumeForm.siteId]);

  const selectedConsumeLine = useMemo(() => {
    if (!consumeForm.siteId || !consumeItemKey) return null;
    return (
      stockLines.find(
        (line) => line.siteId === consumeForm.siteId && line.itemKey === consumeItemKey,
      ) ?? null
    );
  }, [stockLines, consumeForm.siteId, consumeItemKey]);

  const handleConsumeSiteChange = (siteId: string) => {
    setConsumeForm({
      siteId,
      itemDescription: '',
      quantity: 0,
    });
    setConsumeItemKey('');
  };

  const handleConsumeItemChange = (itemKey: string) => {
    setConsumeItemKey(itemKey);
    const line = stockLines.find(
      (entry) => entry.siteId === consumeForm.siteId && entry.itemKey === itemKey,
    );
    if (!line) return;
    setConsumeForm((f) => ({
      ...f,
      itemId: line.itemId,
      itemDescription: line.itemDescription,
      unit: line.unit,
      quantity: line.quantity,
    }));
  };

  const openConsumeEmpty = () => {
    setConsumeForm({ siteId: '', itemDescription: '', quantity: 0 });
    setConsumeItemKey('');
    setConsumeOpen(true);
  };

  const openConsumeFromStock = (line: InventoryStockLine) => {
    setConsumeForm({
      siteId: line.siteId,
      itemId: line.itemId,
      itemDescription: line.itemDescription,
      unit: line.unit,
      quantity: line.quantity,
      notes: '',
    });
    setConsumeItemKey(line.itemKey);
    setConsumeOpen(true);
  };

  const openConsumeFromReceipt = (receipt: InventoryReceipt) => {
    setConsumeForm({
      siteId: receipt.siteId,
      itemId: receipt.itemId,
      itemDescription: receipt.itemDescription,
      unit: receipt.unit,
      quantity: receipt.balanceQty,
      notes: '',
    });
    setConsumeItemKey(receipt.itemKey);
    setConsumeOpen(true);
  };

  const handleConsumeSubmit = () => {
    if (!consumeForm.siteId) {
      toast.error('Please select a site');
      return;
    }
    if (!consumeItemKey || !consumeForm.itemDescription) {
      toast.error('Please select an item');
      return;
    }

    const maxQty = selectedConsumeLine?.quantity ?? 0;
    if (!consumeForm.quantity || consumeForm.quantity <= 0) {
      toast.error('Enter a valid quantity');
      return;
    }
    if (consumeForm.quantity > maxQty) {
      toast.error(`Quantity cannot exceed available stock (${maxQty})`);
      return;
    }

    consumeMutation.mutate(consumeForm);
  };

  const handleAllocateSubmit = () => {
    const selected = allocateForm.toSiteId;
    if (!selected) {
      toast.error('Please select destination site');
      return;
    }

    const maxQty = allocateContext?.availableQty ?? 0;
    if (!allocateForm.quantity || allocateForm.quantity <= 0) {
      toast.error('Enter a valid quantity');
      return;
    }
    if (allocateForm.quantity > maxQty) {
      toast.error(`Quantity cannot exceed available stock (${maxQty})`);
      return;
    }

    const payload: AllocateStockInput = { ...allocateForm };
    if (selected.startsWith('name:')) {
      payload.toSiteId = undefined;
      payload.toSiteName = selected.slice(5);
    } else {
      payload.toSiteId = selected;
      payload.toSiteName = undefined;
    }

    allocateMutation.mutate(payload);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Site Stock' },
    { id: 'receipts', label: 'Purchase Receipts' },
    { id: 'ledger', label: 'Ledger' },
  ];

  const loading = overviewLoading;

  return (
    <PageWrapper
      title="Inventory"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={openConsumeEmpty}>
            <MinusCircle className="h-4 w-4" /> Issue Stock
          </Button>
          {filteredStockLines.length > 0 && (
            <Button
              variant="secondary"
              onClick={() =>
                exportToExcel(
                  filteredStockLines.map((line) => ({
                    Item: line.itemName,
                    Description: line.itemDescription,
                    Category: line.categoryCode
                      ? `${line.categoryCode} · ${line.categoryNameRaw ?? ''}`
                      : (line.categoryNameRaw ?? ''),
                    Unit: line.unit ?? '',
                    Site: `${line.siteCode} — ${line.siteName}`,
                    Quantity: line.quantity,
                    'Bill No': line.billNo ?? '',
                    Tender: line.tenderNo ?? '',
                    'Purchase Rate': line.perRate ?? '',
                  })),
                  'inventory-stock',
                )
              }
            >
              <Download className="h-4 w-4" /> Export
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-3 flex gap-1 border-b border-border">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === item.id
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-muted hover:text-gray-700'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <InventoryFilterBar
        filters={filters}
        siteOptions={siteOptions}
        categoryOptions={categoryOptions}
        showMovementType={tab === 'ledger'}
        resultCount={
          tab === 'overview'
            ? filteredStockLines.length
            : tab === 'receipts'
              ? filteredReceipts.length
              : ledger?.meta.total
        }
        onChange={updateFilters}
        onClear={clearFilters}
        active={hasActiveFilters(filters, tab === 'ledger')}
      />

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : tab === 'overview' ? (
        <StockListTab
          stockLines={filteredStockLines}
          emptyMessage={
            hasActiveFilters(filters, false) && filteredStockLines.length === 0
              ? 'No stock matches your filters.'
              : undefined
          }
          onAllocate={openAllocateFromStock}
          onIssue={openConsumeFromStock}
        />
      ) : tab === 'receipts' ? (
        <ReceiptsTab
          receipts={filteredReceipts}
          loading={receiptsLoading}
          emptyMessage={
            hasActiveFilters(filters, false) && filteredReceipts.length === 0
              ? 'No receipts match your filters.'
              : undefined
          }
          onAllocate={openAllocateFromReceipt}
          onConsume={openConsumeFromReceipt}
        />
      ) : (
        <LedgerTab
          entries={ledger?.data ?? []}
          loading={ledgerLoading}
          page={ledgerPage}
          totalPages={ledger?.meta.totalPages ?? 1}
          total={ledger?.meta.total}
          onPageChange={setLedgerPage}
          emptyMessage={
            hasActiveFilters(filters, true) && (ledger?.data?.length ?? 0) === 0 && !ledgerLoading
              ? 'No ledger entries match your filters.'
              : undefined
          }
        />
      )}

      <Modal
        open={allocateOpen}
        onClose={() => {
          setAllocateOpen(false);
          setAllocateContext(null);
        }}
        title="Allocate Stock"
        footer={
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setAllocateOpen(false);
                setAllocateContext(null);
              }}
            >
              Cancel
            </Button>
            <Button loading={allocateMutation.isPending} onClick={handleAllocateSubmit}>
              Allocate
            </Button>
          </div>
        }
      >
        {allocateContext && (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Item</p>
                  <p className="mt-1 font-medium text-gray-900">{allocateContext.itemLabel}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">From Site</p>
                  <p className="mt-1 font-medium text-gray-900">{allocateContext.fromSiteLabel}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Available</p>
                  <p className="mt-1 font-medium text-gray-900">
                    {allocateContext.availableQty} {allocateContext.unit ?? ''}
                  </p>
                </div>
              </div>
            </div>
            <Input
              label={`Quantity to allocate${allocateContext.unit ? ` (${allocateContext.unit})` : ''}`}
              type="number"
              min={0}
              max={allocateContext.availableQty}
              step="any"
              value={allocateForm.quantity || ''}
              onChange={(e) =>
                setAllocateForm((f) => ({ ...f, quantity: Number(e.target.value) }))
              }
            />
            {toSiteOptions.length <= 1 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                No other sites found. Add sites under <strong>Masters → Sites</strong> or add more sites
                to your tender, then try again.
              </p>
            ) : (
              <Select
                label="To Site"
                options={toSiteOptions}
                value={allocateForm.toSiteId}
                onChange={(e) => setAllocateForm((f) => ({ ...f, toSiteId: e.target.value }))}
              />
            )}
            <Textarea
              label="Notes (optional)"
              value={allocateForm.notes ?? ''}
              onChange={(e) => setAllocateForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={consumeOpen}
        onClose={() => {
          setConsumeOpen(false);
          setConsumeItemKey('');
        }}
        title="Issue / Consume Stock"
        footer={
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setConsumeOpen(false);
                setConsumeItemKey('');
              }}
            >
              Cancel
            </Button>
            <Button loading={consumeMutation.isPending} onClick={handleConsumeSubmit}>
              Issue Stock
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Select
            label="Site"
            options={consumeSiteOptions}
            value={consumeForm.siteId}
            onChange={(e) => handleConsumeSiteChange(e.target.value)}
          />
          <Select
            label="Item"
            options={consumeItemOptions}
            value={consumeItemKey}
            onChange={(e) => handleConsumeItemChange(e.target.value)}
            disabled={!consumeForm.siteId}
          />
          {selectedConsumeLine && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Description</p>
                  <p className="mt-1 font-medium text-gray-900">{selectedConsumeLine.itemDescription}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Available</p>
                  <p className="mt-1 font-medium text-gray-900">
                    {selectedConsumeLine.quantity} {selectedConsumeLine.unit ?? ''}
                  </p>
                </div>
                {selectedConsumeLine.billNo && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Bill No</p>
                    <p className="mt-1 font-medium text-gray-900">{selectedConsumeLine.billNo}</p>
                  </div>
                )}
                {(selectedConsumeLine.categoryNameRaw || selectedConsumeLine.categoryCode) && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Category</p>
                    <div className="mt-1">
                      <CategoryTag
                        name={selectedConsumeLine.categoryNameRaw}
                        code={selectedConsumeLine.categoryCode}
                      />
                    </div>
                  </div>
                )}
                {selectedConsumeLine.unit && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Unit</p>
                    <p className="mt-1 font-medium text-gray-900">{selectedConsumeLine.unit}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          <Input
            label={`Quantity to issue${selectedConsumeLine?.unit ? ` (${selectedConsumeLine.unit})` : ''}`}
            type="number"
            min={0}
            max={selectedConsumeLine?.quantity}
            step="any"
            disabled={!selectedConsumeLine}
            value={consumeForm.quantity || ''}
            onChange={(e) => setConsumeForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
          />
          <Textarea
            label="Notes (optional)"
            value={consumeForm.notes ?? ''}
            onChange={(e) => setConsumeForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
      </Modal>
    </PageWrapper>
  );
}

function InventoryFilterBar({
  filters,
  siteOptions,
  categoryOptions,
  showMovementType,
  resultCount,
  onChange,
  onClear,
  active,
}: {
  filters: InventoryFilterState;
  siteOptions: { value: string; label: string }[];
  categoryOptions: { value: string; label: string }[];
  showMovementType: boolean;
  resultCount?: number;
  onChange: (patch: Partial<InventoryFilterState>) => void;
  onClear: () => void;
  active: boolean;
}) {
  return (
    <div className="card mb-4 !p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
        <div className="min-w-0 flex-1">
          <Input
            label="Search"
            placeholder="Item, bill no., category, tender, site..."
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
          />
        </div>

        <div
          className={`grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:w-auto xl:min-w-[24rem] ${
            showMovementType ? 'xl:grid-cols-3 xl:min-w-[36rem]' : 'xl:grid-cols-2'
          }`}
        >
          <Select
            label="Site"
            options={siteOptions}
            value={filters.siteId}
            onChange={(e) => onChange({ siteId: e.target.value })}
          />
          <Select
            label="Category"
            options={categoryOptions}
            value={filters.categoryId}
            onChange={(e) => onChange({ categoryId: e.target.value })}
          />
          {showMovementType && (
            <Select
              label="Transaction"
              options={movementTypeOptions}
              value={filters.movementType}
              onChange={(e) => onChange({ movementType: e.target.value })}
            />
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-3 text-xs text-muted">
        <span>
          {typeof resultCount === 'number'
            ? `${resultCount} record${resultCount === 1 ? '' : 's'}`
            : ' '}
        </span>
        {active && (
          <button
            type="button"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
            onClick={onClear}
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

function InventoryRowActions({
  onAllocate,
  onIssue,
  allocateLabel = 'Allocate',
  issueLabel = 'Issue',
  disabled = false,
}: {
  onAllocate: () => void;
  onIssue: () => void;
  allocateLabel?: string;
  issueLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        title={allocateLabel}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onAllocate}
      >
        <ArrowRightLeft className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{allocateLabel}</span>
      </button>
      <button
        type="button"
        title={issueLabel}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onIssue}
      >
        <MinusCircle className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{issueLabel}</span>
      </button>
    </div>
  );
}

function StockListTab({
  stockLines,
  emptyMessage,
  onAllocate,
  onIssue,
}: {
  stockLines: InventoryStockLine[];
  emptyMessage?: string;
  onAllocate: (line: InventoryStockLine) => void;
  onIssue: (line: InventoryStockLine) => void;
}) {
  return (
    <div className="card overflow-hidden !p-0">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[14%]" />
            <col className="w-[16%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[6%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-brand-50/50">
              <th className="px-4 py-3 text-left font-medium text-gray-700">Item</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Category</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Site</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Bill No</th>
              <th className="px-4 py-3 text-right font-medium text-gray-700">Purchase Rate</th>
              <th className="px-4 py-3 text-right font-medium text-gray-700">Available</th>
              <th className="px-4 py-3 text-right font-medium text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {stockLines.map((line) => (
              <tr key={`${line.itemKey}:${line.siteId}`} className="border-b border-border/60 hover:bg-brand-50/20">
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-gray-900">{line.itemDescription || line.itemName}</div>
                  {line.itemName &&
                    line.itemName !== line.itemDescription &&
                    line.itemName.trim().toLowerCase() !== line.itemDescription.trim().toLowerCase() && (
                      <div className="mt-0.5 text-xs text-muted">{line.itemName}</div>
                    )}
                  {line.unit && <div className="mt-1 text-xs text-muted">Unit: {line.unit}</div>}
                </td>
                <td className="px-4 py-3 align-top">
                  <CategoryTag name={line.categoryNameRaw} code={line.categoryCode} />
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-gray-900">{line.siteCode}</div>
                  <div className="text-xs text-muted">{line.siteName}</div>
                </td>
                <td className="px-4 py-3 align-top text-gray-600">
                  <div>{line.billNo ?? '—'}</div>
                  {line.tenderNo && (
                    <div className="mt-0.5 text-xs text-muted">{line.tenderNo}</div>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-right text-gray-700">
                  {typeof line.perRate === 'number' ? formatCurrency(line.perRate) : '—'}
                </td>
                <td className="px-4 py-3 align-top text-right font-semibold text-gray-900">
                  {line.quantity}
                  {line.unit ? <span className="ml-1 text-xs font-normal text-muted">{line.unit}</span> : null}
                </td>
                <td className="px-4 py-3 align-top">
                  <InventoryRowActions onAllocate={() => onAllocate(line)} onIssue={() => onIssue(line)} />
                </td>
              </tr>
            ))}
            {stockLines.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted">
                  <Package className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  {emptyMessage ??
                    'No stock yet. Add purchases with a site and item quantity — stock syncs automatically on refresh.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReceiptsTab({
  receipts,
  loading,
  emptyMessage,
  onAllocate,
  onConsume,
}: {
  receipts: InventoryReceipt[];
  loading: boolean;
  emptyMessage?: string;
  onAllocate: (receipt: InventoryReceipt) => void;
  onConsume: (receipt: InventoryReceipt) => void;
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="card overflow-hidden !p-0">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-[24%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-brand-50/50">
              <th className="px-4 py-3 text-left font-medium text-gray-700">Purchase</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Item</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Category</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">Site</th>
              <th className="px-4 py-3 text-right font-medium text-gray-700">Rate</th>
              <th className="px-4 py-3 text-right font-medium text-gray-700">Received</th>
              <th className="px-4 py-3 text-right font-medium text-gray-700">Balance</th>
              <th className="px-4 py-3 text-right font-medium text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={`${receipt.purchaseId}-${receipt.purchaseItemId}`} className="border-b border-border/60 hover:bg-brand-50/20">
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-gray-900">#{receipt.purchaseSerialNo}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {receipt.billNo} · {formatDate(receipt.billDate)}
                  </div>
                  {receipt.tenderNo && (
                    <div className="mt-0.5 text-xs text-muted">{receipt.tenderNo}</div>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-gray-900">{receipt.itemDescription}</div>
                  {receipt.unit && <div className="mt-1 text-xs text-muted">Unit: {receipt.unit}</div>}
                </td>
                <td className="px-4 py-3 align-top">
                  <CategoryTag name={receipt.categoryNameRaw} code={receipt.categoryCode} />
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-gray-900">{receipt.siteCode}</div>
                  <div className="text-xs text-muted">{receipt.siteName}</div>
                </td>
                <td className="px-4 py-3 align-top text-right text-gray-700">
                  {typeof receipt.perRate === 'number' ? formatCurrency(receipt.perRate) : '—'}
                </td>
                <td className="px-4 py-3 align-top text-right text-gray-700">
                  {receipt.receivedQty}
                  {receipt.unit ? <span className="ml-1 text-xs text-muted">{receipt.unit}</span> : null}
                </td>
                <td className="px-4 py-3 align-top text-right font-semibold text-gray-900">
                  {receipt.balanceQty}
                  {receipt.unit ? <span className="ml-1 text-xs font-normal text-muted">{receipt.unit}</span> : null}
                </td>
                <td className="px-4 py-3 align-top">
                  <InventoryRowActions
                    disabled={receipt.balanceQty <= 0}
                    onAllocate={() => onAllocate(receipt)}
                    onIssue={() => onConsume(receipt)}
                  />
                </td>
              </tr>
            ))}
            {receipts.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-muted">
                  {emptyMessage ?? 'No purchase receipts found. Add purchases with items and a linked site.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LedgerTab({
  entries,
  loading,
  page,
  totalPages,
  total,
  emptyMessage,
  onPageChange,
}: {
  entries: Awaited<ReturnType<typeof inventoryApi.ledger>>['data'];
  loading: boolean;
  page: number;
  totalPages: number;
  total?: number;
  emptyMessage?: string;
  onPageChange: (page: number) => void;
}) {
  const rows = useMemo(() => buildLedgerRows(entries), [entries]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-border bg-brand-50/50">
                <th className="px-4 py-3 text-left font-medium text-gray-700">Date</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Transaction</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Item</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Category</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Details</th>
                <th className="px-4 py-3 text-right font-medium text-gray-700">Qty</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Ref</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 hover:bg-brand-50/20">
                  <td className="px-4 py-3 align-top whitespace-nowrap text-gray-700">{formatDate(row.date)}</td>
                  <td className="px-4 py-3 align-top">
                    <Badge variant={row.badgeVariant}>{row.label}</Badge>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-gray-900">{row.itemDescription}</div>
                    {row.unit && <div className="mt-1 text-xs text-muted">{row.unit}</div>}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <CategoryTag name={row.categoryNameRaw} code={row.categoryCode} />
                  </td>
                  <td className="px-4 py-3 align-top text-gray-700">{row.detail}</td>
                  <td className={`px-4 py-3 align-top text-right font-semibold whitespace-nowrap ${row.qtyClass}`}>
                    {row.qtyPrefix}
                    {row.quantity} {row.unit ?? ''}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-muted">{row.reference ?? '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted">
                    {emptyMessage ?? 'No ledger entries yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={onPageChange} />
    </div>
  );
}
