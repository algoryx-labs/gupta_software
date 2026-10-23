import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import {
  createOutstandingPaymentSchema,
  type CreateOutstandingPaymentInput,
  type OutstandingPaymentPopulated,
  type Tender,
  type TenderSite,
} from '@gupta/shared';
import { outstandingPaymentsApi } from '@/api/outstandingPayments';
import { tendersApi } from '@/api/tenders';
import { PageWrapper } from '@/layouts/PageWrapper';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { ModalFormFooter } from '@/components/ModalFormFooter';
import { FormSection } from '@/components/FormSection';
import { DataTable, type Column } from '@/components/DataTable';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { toast } from '@/lib/notify';

type PopulatedTenderSite = TenderSite & {
  site?: string | { _id: string; name: string; code: string };
};

type TenderOption = Tender & {
  sites: PopulatedTenderSite[];
};

type PaymentRow = OutstandingPaymentPopulated;

function getSiteRefId(siteRef?: string | { _id: string }): string | undefined {
  if (!siteRef) return undefined;
  return typeof siteRef === 'string' ? siteRef : siteRef._id;
}

function getTenderSiteKey(site: PopulatedTenderSite): string {
  return getSiteRefId(site.site) ?? `name:${site.siteNameRaw}`;
}

function getTenderLabel(tender: PaymentRow['tender']): string {
  if (!tender || typeof tender === 'string') return '—';
  if (tender.tenderNo && tender.tenderName) return `${tender.tenderNo} — ${tender.tenderName}`;
  return tender.tenderNo ?? tender.tenderName ?? '—';
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function prepareCreatePayload(
  data: CreateOutstandingPaymentInput,
): CreateOutstandingPaymentInput {
  return {
    tender: data.tender,
    siteNameRaw: data.siteNameRaw,
    amount: data.amount,
    paymentDate: data.paymentDate,
    ...(data.site ? { site: data.site } : {}),
    ...(data.description?.trim() ? { description: data.description.trim() } : {}),
  };
}

const defaultFormValues = (): CreateOutstandingPaymentInput => ({
  tender: '',
  siteNameRaw: '',
  amount: 0,
  paymentDate: new Date(),
});

export default function OutstandingPaymentsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedSiteKey, setSelectedSiteKey] = useState('');

  const dateParams = {
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
  };

  const { data: summaryData } = useQuery({
    queryKey: ['outstanding-payments', 'summary', dateFrom, dateTo],
    queryFn: () => outstandingPaymentsApi.summary(dateParams),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['outstanding-payments', page, dateFrom, dateTo],
    queryFn: () => outstandingPaymentsApi.list({ page, limit: 20, ...dateParams }),
  });

  const { data: tendersData } = useQuery({
    queryKey: ['tenders', 'outstanding-payment-form'],
    queryFn: () => tendersApi.list({ limit: 100, sortBy: 'tenderName', sortOrder: 'asc' }),
    enabled: modalOpen,
  });

  const tenders = (tendersData?.data ?? []) as TenderOption[];

  const form = useForm<CreateOutstandingPaymentInput>({
    resolver: zodResolver(createOutstandingPaymentSchema) as never,
    defaultValues: defaultFormValues(),
  });

  const selectedTenderId = form.watch('tender');
  const selectedTender = tenders.find((t) => t._id === selectedTenderId);

  const tenderOptions = useMemo(
    () => [
      { value: '', label: 'Select tender' },
      ...tenders.map((t) => ({
        value: t._id,
        label: `${t.tenderNo} — ${t.tenderName}`,
      })),
    ],
    [tenders],
  );

  const siteOptions = useMemo(() => {
    if (!selectedTender?.sites?.length) {
      return [{ value: '', label: selectedTenderId ? 'No sites for this tender' : 'Select tender first' }];
    }
    return [
      { value: '', label: 'Select site' },
      ...selectedTender.sites.map((site) => ({
        value: getTenderSiteKey(site),
        label: site.siteNameRaw,
      })),
    ];
  }, [selectedTender, selectedTenderId]);

  const createMutation = useMutation({
    mutationFn: outstandingPaymentsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['outstanding-payments'] });
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
      toast.success('Outstanding payment added');
      closeModal();
    },
    onError: (error: { response?: { data?: { message?: string } } }) =>
      toast.error(error.response?.data?.message ?? 'Failed to add outstanding payment'),
  });

  const deleteMutation = useMutation({
    mutationFn: outstandingPaymentsApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['outstanding-payments'] });
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
      toast.success('Outstanding payment deleted');
      setDeleteId(null);
    },
  });

  const closeModal = () => {
    setModalOpen(false);
    form.reset(defaultFormValues());
    setSelectedSiteKey('');
  };

  const openCreate = () => {
    form.reset(defaultFormValues());
    setSelectedSiteKey('');
    setModalOpen(true);
  };

  const handleSiteChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const key = e.target.value;
    setSelectedSiteKey(key);

    if (!key || !selectedTender) {
      form.setValue('site', undefined);
      form.setValue('siteNameRaw', '');
      return;
    }

    const siteEntry = selectedTender.sites.find((s) => getTenderSiteKey(s) === key);
    if (!siteEntry) return;

    form.setValue('site', getSiteRefId(siteEntry.site), { shouldValidate: true });
    form.setValue('siteNameRaw', siteEntry.siteNameRaw, { shouldValidate: true });
  };

  const columns: Column<PaymentRow>[] = [
    {
      key: 'paymentDate',
      header: 'Date',
      render: (r) => formatDate(r.paymentDate),
    },
    {
      key: 'tender',
      header: 'Tender',
      render: (r) => getTenderLabel(r.tender),
    },
    {
      key: 'siteNameRaw',
      header: 'Site',
    },
    {
      key: 'description',
      header: 'Description',
      render: (r) => r.description || '—',
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (r) => formatCurrency(r.amount),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <button
          className="rounded p-1 hover:bg-red-50"
          onClick={() => setDeleteId(r._id)}
        >
          <Trash2 className="h-4 w-4 text-red-500" />
        </button>
      ),
    },
  ];

  return (
    <PageWrapper
      title="Outstanding Payment"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="!w-auto"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="!w-auto"
          />
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      }
    >
      {summaryData && (
        <div className="mb-4 flex flex-wrap gap-4 text-sm">
          <div className="rounded-xl bg-red-50 px-4 py-2">
            <span className="text-muted">Total Outstanding: </span>
            <span className="font-semibold text-red-700">{formatCurrency(summaryData.totalAmount)}</span>
          </div>
          <div className="rounded-xl bg-gray-50 px-4 py-2">
            <span className="text-muted">Entries: </span>
            <span className="font-semibold">{summaryData.totalCount}</span>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        data={(data?.data ?? []) as unknown as PaymentRow[]}
        loading={isLoading}
        page={page}
        totalPages={data?.meta.totalPages ?? 1}
        total={data?.meta.total}
        onPageChange={setPage}
        emptyTitle="No outstanding payments"
        emptyDescription="Click Add to record an outstanding payment"
        keyExtractor={(r) => r._id}
      />

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title="Add Outstanding Payment"
        size="lg"
        onSubmit={form.handleSubmit((d) => createMutation.mutate(prepareCreatePayload(d)))}
        footer={
          <ModalFormFooter
            onCancel={closeModal}
            loading={createMutation.isPending}
          />
        }
      >
        <div className="space-y-4">
          <FormSection title="Tender & Site" tone="brand">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Tender"
                options={tenderOptions}
                error={form.formState.errors.tender?.message}
                {...form.register('tender', {
                  onChange: () => {
                    form.setValue('site', undefined);
                    form.setValue('siteNameRaw', '');
                    setSelectedSiteKey('');
                  },
                })}
              />
              <Select
                label="Site"
                options={siteOptions}
                value={selectedSiteKey}
                onChange={handleSiteChange}
                disabled={!selectedTenderId}
                error={form.formState.errors.siteNameRaw?.message}
              />
              <input type="hidden" {...form.register('siteNameRaw')} />
              <input type="hidden" {...form.register('site')} />
            </div>
            {selectedTender && (
              <p className="mt-3 text-sm text-muted">
                Current tender outstanding:{' '}
                <span className="font-semibold text-red-700">
                  {formatCurrency(selectedTender.paymentOutstanding)}
                </span>
              </p>
            )}
          </FormSection>
          <FormSection title="Payment Details" tone="green">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Amount"
                type="number"
                step="any"
                error={form.formState.errors.amount?.message}
                {...form.register('amount', { valueAsNumber: true })}
              />
              <Input
                label="Payment Date"
                type="date"
                error={form.formState.errors.paymentDate?.message}
                defaultValue={toDateInputValue(new Date())}
                {...form.register('paymentDate', { valueAsDate: true })}
              />
            </div>
          </FormSection>
          <FormSection title="Description" tone="red">
            <Input
              label="Description"
              placeholder="e.g. Bill pending, retention amount"
              error={form.formState.errors.description?.message}
              {...form.register('description')}
            />
          </FormSection>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
        title="Delete Outstanding Payment"
        message="Are you sure? This will reduce the tender's outstanding balance by this amount."
      />
    </PageWrapper>
  );
}
