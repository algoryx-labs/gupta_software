import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Pencil, Trash2, Download, X, Info } from 'lucide-react';
import {
  createTenderSchema,
  TenderStatus,
  type CreateTenderInput,
  type Tender,
  type TenderSiteInput,
} from '@gupta/shared';
import { tendersApi } from '@/api/tenders';
import { PageWrapper } from '@/layouts/PageWrapper';
import { Button } from '@/components/Button';
import { Input, Textarea, Select } from '@/components/Input';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { ModalFormFooter } from '@/components/ModalFormFooter';
import { FormSection } from '@/components/FormSection';
import { ProgressSlider } from '@/components/ProgressSlider';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { Spinner } from '@/components/Spinner';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { exportToExcel } from '@/lib/exportToExcel';
import { toast } from '@/lib/notify';

const statusOptions = Object.values(TenderStatus).map((s) => ({
  value: s,
  label: s.charAt(0).toUpperCase() + s.slice(1),
}));

const statusFilterOptions = [
  { value: TenderStatus.ACTIVE, label: 'Active' },
  { value: TenderStatus.PENDING, label: 'Pending' },
  { value: TenderStatus.COMPLETED, label: 'Completed' },
  { value: TenderStatus.CANCELLED, label: 'Cancelled' },
  { value: '', label: 'All statuses' },
];

type TenderSortMode = 'desc' | 'asc' | 'expiringSoon';

const uploadSortOptions: Array<{ value: TenderSortMode; label: string }> = [
  { value: 'desc', label: 'Latest uploaded' },
  { value: 'asc', label: 'Oldest uploaded' },
  { value: 'expiringSoon', label: 'Expiring soon' },
];

const defaultSite = (): TenderSiteInput => ({
  siteNameRaw: '',
});

const defaultFormValues = (): CreateTenderInput => ({
  tenderName: '',
  tenderNo: '',
  uniqueId: '',
  orderValue: 0,
  emd: 0,
  pg: 0,
  sdFromBill: 0,
  paymentReceivedTillDate: 0,
  paymentOutstanding: 0,
  executionPending: 0,
  workCompleted: 0,
  progress: 0,
  status: TenderStatus.PENDING,
  sites: [defaultSite()],
});

function formatSitesSummary(sites: Tender['sites']) {
  if (!sites?.length) return '—';
  if (sites.length === 1) return sites[0].siteNameRaw;
  return `${sites[0].siteNameRaw} (+${sites.length - 1} more)`;
}

function tenderToFormValues(tender: Tender): CreateTenderInput {
  return {
    tenderName: tender.tenderName,
    tenderNo: tender.tenderNo,
    uniqueId: tender.uniqueId ?? '',
    orderValue: tender.orderValue,
    emd: tender.emd,
    pg: tender.pg,
    sdFromBill: tender.sdFromBill,
    paymentReceivedTillDate: tender.paymentReceivedTillDate,
    paymentOutstanding: tender.paymentOutstanding,
    executionPending: tender.executionPending,
    workCompleted: tender.workCompleted,
    bgNumber: tender.bgNumber,
    bgExpiryDate: tender.bgExpiryDate ? new Date(tender.bgExpiryDate) : undefined,
    fdrNumber: tender.fdrNumber,
    fdrExpiryDate: tender.fdrExpiryDate ? new Date(tender.fdrExpiryDate) : undefined,
    progress: tender.progress ?? 0,
    status: tender.status,
    notes: tender.notes,
    sites: (tender.sites?.length ? tender.sites : [defaultSite()]).map((site) => ({
      site: typeof site.site === 'string' ? site.site : undefined,
      siteNameRaw: site.siteNameRaw,
    })),
  };
}

function isInstrumentExpiringSoon(...dates: Array<string | Date | undefined>) {
  return dates.some((date) => {
    if (!date) return false;
    const d = new Date(date);
    const days = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return days >= 0 && days <= 60;
  });
}

function formatExpiryDate(date: string | Date | undefined) {
  const formatted = formatDate(date);
  if (!date || !isInstrumentExpiringSoon(date)) return formatted;
  return <span className="font-semibold text-red-600">{formatted}</span>;
}

function formatDateTime(date: string | Date | undefined | null) {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value ?? '—'}</dd>
    </div>
  );
}

function getCreatedByLabel(
  createdBy: string | { _id: string; name: string; email?: string } | undefined,
) {
  if (!createdBy) return '—';
  if (typeof createdBy === 'string') return createdBy;
  return createdBy.email ? `${createdBy.name} (${createdBy.email})` : createdBy.name;
}

function getSiteMasterLabel(site: Tender['sites'][number]) {
  const master = site.site as string | { name: string; code?: string } | undefined;
  if (!master || typeof master === 'string') return '—';
  return `${master.name}${master.code ? ` (${master.code})` : ''}`;
}

export default function TendersPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TenderStatus | ''>(TenderStatus.ACTIVE);
  const [uploadSort, setUploadSort] = useState<TenderSortMode>('desc');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);

  const listParams = {
    page,
    limit: 20,
    sortBy: uploadSort === 'expiringSoon' ? 'expiringSoon' : 'createdAt',
    sortOrder: uploadSort === 'expiringSoon' ? 'asc' : uploadSort,
    ...(search && { search }),
    ...(statusFilter && { status: statusFilter }),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['tenders', page, search, statusFilter, uploadSort],
    queryFn: () => tendersApi.list(listParams),
  });

  const { data: detailTender, isLoading: detailLoading } = useQuery({
    queryKey: ['tenders', infoId],
    queryFn: () => tendersApi.get(infoId!),
    enabled: !!infoId,
  });

  const form = useForm<CreateTenderInput>({
    resolver: zodResolver(createTenderSchema) as never,
    defaultValues: defaultFormValues(),
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'sites',
  });

  const createMutation = useMutation({
    mutationFn: tendersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
      toast.success('Tender created');
      closeModal();
    },
    onError: () => toast.error('Failed to create tender'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CreateTenderInput }) =>
      tendersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
      toast.success('Tender updated');
      closeModal();
    },
    onError: () => toast.error('Failed to update tender'),
  });

  const deleteMutation = useMutation({
    mutationFn: tendersApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
      setDeleteId(null);
      toast.success('Tender deleted');
    },
  });

  const closeModal = () => {
    setModalOpen(false);
    setEditId(null);
    form.reset(defaultFormValues());
  };

  const openCreate = () => {
    form.reset(defaultFormValues());
    setEditId(null);
    setModalOpen(true);
  };

  const openEdit = async (tender: Tender) => {
    try {
      const full = await tendersApi.get(tender._id);
      form.reset(tenderToFormValues(full));
      setEditId(tender._id);
      setModalOpen(true);
    } catch {
      toast.error('Failed to load tender');
    }
  };

  const onSubmit = (data: CreateTenderInput) => {
    if (editId) updateMutation.mutate({ id: editId, data });
    else createMutation.mutate(data);
  };

  const columns: Column<Tender>[] = [
    { key: 'serialNo', header: '#', className: 'w-12' },
    {
      key: 'uniqueId',
      header: 'Unique code',
      className: 'w-28',
      render: (r) => r.uniqueId?.trim() || '—',
    },
    { key: 'tenderNo', header: 'Tender No' },
    { key: 'tenderName', header: 'Name' },
    {
      key: 'sites',
      header: 'Sites',
      render: (r) => (
        <span title={(r.sites ?? []).map((s) => s.siteNameRaw).join(', ')}>
          {formatSitesSummary(r.sites ?? [])}
        </span>
      ),
    },
    { key: 'orderValue', header: 'Order Value', render: (r) => formatCurrency(r.orderValue) },
    {
      key: 'paymentOutstanding',
      header: 'Outstanding',
      render: (r) => formatCurrency(r.paymentOutstanding),
    },
    { key: 'bgExpiryDate', header: 'BG Expiry', render: (r) => formatExpiryDate(r.bgExpiryDate) },
    { key: 'fdrExpiryDate', header: 'FDR Expiry', render: (r) => formatExpiryDate(r.fdrExpiryDate) },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={r.status}>{r.status}</Badge>
          {isInstrumentExpiringSoon(r.bgExpiryDate, r.fdrExpiryDate) && (
            <Badge variant="expired">Expiring soon</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex gap-1">
          <button
            className="rounded p-1 hover:bg-blue-50"
            title="View details"
            onClick={() => setInfoId(r._id)}
          >
            <Info className="h-4 w-4 text-blue-600" />
          </button>
          <button className="rounded p-1 hover:bg-brand-50" onClick={() => openEdit(r)}>
            <Pencil className="h-4 w-4" />
          </button>
          <button className="rounded p-1 hover:bg-red-50" onClick={() => setDeleteId(r._id)}>
            <Trash2 className="h-4 w-4 text-red-500" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <PageWrapper
      title="Tenders"
      actions={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              const { data: rows } = await tendersApi.export({
                sortBy: uploadSort === 'expiringSoon' ? 'expiringSoon' : 'createdAt',
                sortOrder: uploadSort === 'expiringSoon' ? 'asc' : uploadSort,
                ...(statusFilter && { status: statusFilter }),
              });
              exportToExcel(
                rows.flatMap((r) =>
                  (r.sites?.length ? r.sites : [{ siteNameRaw: '—' }]).map((site) => ({
                    ...r,
                    site: site.siteNameRaw,
                    bgExpiryDate: formatDate(r.bgExpiryDate),
                    fdrExpiryDate: formatDate(r.fdrExpiryDate),
                  })),
                ),
                'tenders',
              );
            }}
          >
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Tender
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Input
          placeholder="Search tenders, sites..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-md"
        />
        <Select
          label="Status"
          options={statusFilterOptions}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as TenderStatus | '');
            setPage(1);
          }}
          className="!w-40"
        />
        <Select
          label="Sort"
          options={uploadSortOptions}
          value={uploadSort}
          onChange={(e) => {
            setUploadSort(e.target.value as TenderSortMode);
            setPage(1);
          }}
          className="!w-44"
        />
      </div>

      {uploadSort === 'expiringSoon' && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Showing tenders with BG or FDR expiring within 60 days first (nearest expiry on top).
          Highlighted rows are expiring soon.
        </p>
      )}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        page={page}
        totalPages={data?.meta.totalPages ?? 1}
        total={data?.meta.total}
        onPageChange={setPage}
        rowClassName={(r) =>
          isInstrumentExpiringSoon(r.bgExpiryDate, r.fdrExpiryDate)
            ? 'border-l-4 border-red-400 bg-red-50/90 hover:bg-red-100/80'
            : ''
        }
        keyExtractor={(r) => r._id}
      />

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editId ? 'Edit Tender' : 'Add Tender'}
        size="xl"
        onSubmit={form.handleSubmit(onSubmit)}
        footer={
          <ModalFormFooter
            onCancel={closeModal}
            submitLabel={editId ? 'Update' : 'Create'}
            loading={createMutation.isPending || updateMutation.isPending}
          />
        }
      >
        <div className="space-y-4">
          <FormSection title="Tender Details" tone="brand">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Tender Name" {...form.register('tenderName')} />
              <Input label="Tender No" {...form.register('tenderNo')} />
              <Select label="Status" options={statusOptions} {...form.register('status')} />
              <Input label="Unique ID" {...form.register('uniqueId')} />
              <div className="sm:col-span-2">
                <ProgressSlider
                  label="Progress"
                  value={form.watch('progress') ?? 0}
                  onChange={(value) => form.setValue('progress', value, { shouldDirty: true, shouldValidate: true })}
                  error={form.formState.errors.progress?.message}
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="Financial Details" tone="green">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Order Value" type="number" {...form.register('orderValue', { valueAsNumber: true })} />
              <Input label="EMD" type="number" {...form.register('emd', { valueAsNumber: true })} />
              <Input label="PG" type="number" {...form.register('pg', { valueAsNumber: true })} />
              <Input label="SD from Bill" type="number" {...form.register('sdFromBill', { valueAsNumber: true })} />
              <Input
                label="Payment Received"
                type="number"
                {...form.register('paymentReceivedTillDate', { valueAsNumber: true })}
              />
              <Input
                label="Outstanding"
                type="number"
                {...form.register('paymentOutstanding', { valueAsNumber: true })}
              />
              <Input
                label="Execution Pending"
                type="number"
                {...form.register('executionPending', { valueAsNumber: true })}
              />
              <Input label="Work Completed" type="number" {...form.register('workCompleted', { valueAsNumber: true })} />
            </div>
          </FormSection>

          <FormSection title="BG / FDR & Sites" tone="red">
            <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="BG Number" {...form.register('bgNumber')} />
              <Input label="FDR Number" {...form.register('fdrNumber')} />
              <Input label="BG Expiry" type="date" {...form.register('bgExpiryDate', { valueAsDate: true })} />
              <Input label="FDR Expiry" type="date" {...form.register('fdrExpiryDate', { valueAsDate: true })} />
            </div>

            <div className="space-y-4">
            {form.formState.errors.sites?.message && (
              <p className="text-sm text-red-500">{form.formState.errors.sites.message}</p>
            )}

            {fields.map((field, index) => (
              <div key={field.id} className="rounded-xl border border-red-200 bg-white/80 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600">Site {index + 1}</span>
                  {fields.length > 1 && (
                    <button
                      type="button"
                      className="rounded p-1 text-red-500 hover:bg-red-50"
                      onClick={() => remove(index)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <Input
                  label="Site Name"
                  error={form.formState.errors.sites?.[index]?.siteNameRaw?.message}
                  {...form.register(`sites.${index}.siteNameRaw`)}
                />
              </div>
            ))}

            <div className="flex items-center justify-end">
              <Button type="button" variant="secondary" onClick={() => append(defaultSite())}>
                <Plus className="h-4 w-4" /> Add Site
              </Button>
            </div>
            </div>
            </div>
          </FormSection>

          <FormSection title="Notes" tone="brand">
            <Textarea label="Notes" {...form.register('notes')} />
          </FormSection>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
        title="Delete Tender"
        message="Are you sure you want to delete this tender?"
      />

      <Modal
        open={!!infoId}
        onClose={() => setInfoId(null)}
        title="Tender Details"
        size="xl"
        footer={
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setInfoId(null)}>
              Close
            </Button>
          </div>
        }
      >
        {detailLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : detailTender ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Serial No" value={detailTender.serialNo} />
            <DetailField label="Tender Code" value={detailTender.code} />
            <DetailField label="Tender No" value={detailTender.tenderNo} />
            <DetailField label="Tender Name" value={detailTender.tenderName} />
            <DetailField label="Unique code" value={detailTender.uniqueId} />
            <DetailField label="Status" value={<Badge variant={detailTender.status}>{detailTender.status}</Badge>} />
            <DetailField label="Progress" value={`${detailTender.progress ?? 0}%`} />
            <DetailField label="Order Value" value={formatCurrency(detailTender.orderValue)} />
            <DetailField label="EMD" value={formatCurrency(detailTender.emd)} />
            <DetailField label="PG" value={formatCurrency(detailTender.pg)} />
            <DetailField label="SD from Bill" value={formatCurrency(detailTender.sdFromBill)} />
            <DetailField
              label="Payment Received Till Date"
              value={formatCurrency(detailTender.paymentReceivedTillDate)}
            />
            <DetailField label="Payment Outstanding" value={formatCurrency(detailTender.paymentOutstanding)} />
            <DetailField label="Execution Pending" value={formatCurrency(detailTender.executionPending)} />
            <DetailField label="Work Completed" value={formatCurrency(detailTender.workCompleted)} />
            <DetailField label="BG Number" value={detailTender.bgNumber} />
            <DetailField label="BG Expiry Date" value={formatDate(detailTender.bgExpiryDate)} />
            <DetailField label="FDR Number" value={detailTender.fdrNumber} />
            <DetailField label="FDR Expiry Date" value={formatDate(detailTender.fdrExpiryDate)} />
            <DetailField label="Created By" value={getCreatedByLabel(detailTender.createdBy)} />
            <DetailField label="Created At" value={formatDateTime(detailTender.createdAt)} />
            <DetailField label="Updated At" value={formatDateTime(detailTender.updatedAt)} />

            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Notes</dt>
              <dd className="mt-1 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900">
                {detailTender.notes?.trim() || '—'}
              </dd>
            </div>

            <div className="sm:col-span-2">
              <dt className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Sites</dt>
              <dd>
                {detailTender.sites?.length ? (
                  <div className="space-y-2">
                    {detailTender.sites.map((site, index) => (
                      <div
                        key={site._id ?? index}
                        className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm"
                      >
                        <p className="font-medium text-gray-900">Site {index + 1}: {site.siteNameRaw}</p>
                        <p className="mt-1 text-gray-600">Linked site master: {getSiteMasterLabel(site)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  '—'
                )}
              </dd>
            </div>

            <div className="sm:col-span-2">
              <dt className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Attachments</dt>
              <dd>
                {detailTender.attachments?.length ? (
                  <ul className="space-y-2">
                    {detailTender.attachments.map((attachment, index) => (
                      <li
                        key={attachment._id ?? index}
                        className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
                      >
                        <a
                          href={attachment.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-brand-600 hover:underline"
                        >
                          {attachment.filename}
                        </a>
                        <span className="text-gray-500">{formatDateTime(attachment.uploadedAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="py-8 text-center text-sm text-gray-500">Failed to load tender details.</p>
        )}
      </Modal>
    </PageWrapper>
  );
}
