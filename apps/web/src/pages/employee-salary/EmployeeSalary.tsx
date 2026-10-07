import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRightLeft,
  CalendarDays,
  ChevronDown,
  Pencil,
  Plus,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import {
  createEmployeeSchema,
  EmployeeAssignmentStatus,
  EmployeeCategory,
  EMPLOYEE_CATEGORY_LABELS,
  resolveCategoryLabel,
  type CreateEmployeeInput,
  type EmployeePopulated,
  type TenderSalaryExpenseSummary,
} from '@gupta/shared';
import { employeesApi } from '@/api/employees';
import { tendersApi } from '@/api/tenders';
import { PageWrapper } from '@/layouts/PageWrapper';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal, ConfirmDialog } from '@/components/Modal';
import { ModalFormFooter } from '@/components/ModalFormFooter';
import { FormSection } from '@/components/FormSection';
import { DataTable, type Column } from '@/components/DataTable';
import { Badge } from '@/components/Badge';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { toast } from '@/lib/notify';

type ActionMode = 'assign' | 'change' | 'unassign' | null;

const statusLabels: Record<EmployeeAssignmentStatus, string> = {
  [EmployeeAssignmentStatus.UNASSIGNED]: 'Unassigned',
  [EmployeeAssignmentStatus.ASSIGNED]: 'Assigned',
  [EmployeeAssignmentStatus.CHANGED]: 'Moved (legacy)',
};

const statusVariants: Record<EmployeeAssignmentStatus, string> = {
  [EmployeeAssignmentStatus.UNASSIGNED]: 'default',
  [EmployeeAssignmentStatus.ASSIGNED]: 'active',
  [EmployeeAssignmentStatus.CHANGED]: 'pending',
};

const categoryOptions = Object.values(EmployeeCategory).map((value) => ({
  value,
  label: EMPLOYEE_CATEGORY_LABELS[value],
}));

function getTenderLabel(
  tender?: EmployeePopulated['currentTender'] | null,
): string {
  if (!tender) return '—';
  if (tender.tenderNo && tender.tenderName) return `${tender.tenderNo} — ${tender.tenderName}`;
  return tender.tenderNo ?? tender.tenderName ?? '—';
}

function preferredDays(employee: EmployeePopulated): number {
  return Math.max(employee.currentDaysWorked ?? 0, employee.suggestedDaysWorked ?? 0);
}

function historyEntryExpense(employee: EmployeePopulated, entry: EmployeePopulated['tenderHistory'][number]) {
  if (typeof entry.expense === 'number') return entry.expense;
  const salary = typeof entry.monthlySalary === 'number' ? entry.monthlySalary : employee.salary;
  return (salary / 30) * entry.daysWorked;
}

function DaysWorkedCell({
  employee,
  onSave,
  saving,
}: {
  employee: EmployeePopulated;
  onSave: (daysWorked: number) => void;
  saving: boolean;
}) {
  const [value, setValue] = useState(String(employee.currentDaysWorked));
  const dirty = (parseInt(value, 10) || 0) !== employee.currentDaysWorked;
  const suggested = employee.suggestedDaysWorked;

  return (
    <div className="flex min-w-[9rem] flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          className="!w-16 !py-1 !text-sm"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={!dirty || saving}
          loading={saving}
          onClick={() => onSave(parseInt(value, 10) || 0)}
          className="!px-2 !py-1 text-xs"
        >
          Save
        </Button>
      </div>
      {typeof suggested === 'number' && (
        <button
          type="button"
          className="flex items-center gap-1 text-left text-[11px] text-brand-600 hover:underline"
          title="Set days from assign date through today"
          onClick={() => {
            setValue(String(suggested));
            if (suggested !== employee.currentDaysWorked) onSave(suggested);
          }}
        >
          <CalendarDays className="h-3 w-3" />
          Calendar: {suggested}d
        </button>
      )}
    </div>
  );
}

const defaultFormValues = (): CreateEmployeeInput => ({
  name: '',
  phone: '',
  salary: 0,
  category: EmployeeCategory.OFFICE,
  categoryOther: '',
});

export default function EmployeeSalaryPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editEmployee, setEditEmployee] = useState<EmployeePopulated | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionEmployee, setActionEmployee] = useState<EmployeePopulated | null>(null);
  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [selectedTenderId, setSelectedTenderId] = useState('');
  const [daysInput, setDaysInput] = useState(0);
  const [historyEmployee, setHistoryEmployee] = useState<EmployeePopulated | null>(null);
  const [expenseTenderFilter, setExpenseTenderFilter] = useState('');

  const listParams = {
    page,
    limit: 20,
    ...(search && { search }),
    ...(statusFilter && { status: statusFilter }),
    ...(categoryFilter && { category: categoryFilter }),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['employees', page, search, statusFilter, categoryFilter],
    queryFn: () => employeesApi.list(listParams),
  });

  const { data: expenseData } = useQuery({
    queryKey: ['employees', 'tender-expenses', expenseTenderFilter],
    queryFn: () =>
      employeesApi.tenderExpenses(expenseTenderFilter ? { tender: expenseTenderFilter } : undefined),
  });

  const { data: tendersData } = useQuery({
    queryKey: ['tenders', 'employee-salary'],
    queryFn: () => tendersApi.list({ limit: 100, sortBy: 'tenderName', sortOrder: 'asc' }),
  });

  const tenders = tendersData?.data ?? [];

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

  const form = useForm<CreateEmployeeInput>({
    resolver: zodResolver(createEmployeeSchema) as never,
    defaultValues: defaultFormValues(),
  });

  const selectedCategory = form.watch('category');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['employees'] });
  };

  const createMutation = useMutation({
    mutationFn: employeesApi.create,
    onSuccess: () => {
      invalidate();
      toast.success('Employee added');
      closeModal();
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      toast.error(err.response?.data?.message ?? 'Failed to add employee'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CreateEmployeeInput }) =>
      employeesApi.update(id, data),
    onSuccess: () => {
      invalidate();
      toast.success('Employee updated');
      closeModal();
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      toast.error(err.response?.data?.message ?? 'Failed to update employee'),
  });

  const deleteMutation = useMutation({
    mutationFn: employeesApi.remove,
    onSuccess: () => {
      invalidate();
      toast.success('Employee deleted');
      setDeleteId(null);
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, tender, daysWorked }: { id: string; tender: string; daysWorked?: number }) =>
      employeesApi.assign(id, { tender, daysWorked }),
    onSuccess: () => {
      invalidate();
      toast.success('Employee assigned to tender');
      closeActionModal();
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      toast.error(err.response?.data?.message ?? 'Failed to assign employee'),
  });

  const changeTenderMutation = useMutation({
    mutationFn: ({
      id,
      tender,
      daysWorkedOnCurrent,
    }: {
      id: string;
      tender: string;
      daysWorkedOnCurrent: number;
    }) => employeesApi.changeTender(id, { tender, daysWorkedOnCurrent }),
    onSuccess: () => {
      invalidate();
      toast.success('Tender changed — previous days saved');
      closeActionModal();
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      toast.error(err.response?.data?.message ?? 'Failed to change tender'),
  });

  const unassignMutation = useMutation({
    mutationFn: ({ id, daysWorkedOnCurrent }: { id: string; daysWorkedOnCurrent: number }) =>
      employeesApi.unassign(id, { daysWorkedOnCurrent }),
    onSuccess: () => {
      invalidate();
      toast.success('Employee unassigned');
      closeActionModal();
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      toast.error(err.response?.data?.message ?? 'Failed to unassign employee'),
  });

  const updateDaysMutation = useMutation({
    mutationFn: ({ id, daysWorked }: { id: string; daysWorked: number }) =>
      employeesApi.updateDays(id, { daysWorked }),
    onSuccess: () => {
      invalidate();
      toast.success('Days updated');
    },
    onError: () => toast.error('Failed to update days'),
  });

  const closeModal = () => {
    setModalOpen(false);
    setEditEmployee(null);
    form.reset(defaultFormValues());
  };

  const openCreate = () => {
    setEditEmployee(null);
    form.reset(defaultFormValues());
    setModalOpen(true);
  };

  const openEdit = (employee: EmployeePopulated) => {
    setEditEmployee(employee);
    form.reset({
      name: employee.name,
      phone: employee.phone,
      salary: employee.salary,
      category: employee.category ?? EmployeeCategory.OFFICE,
      categoryOther: employee.categoryOther ?? '',
    });
    setModalOpen(true);
  };

  const closeActionModal = () => {
    setActionEmployee(null);
    setActionMode(null);
    setSelectedTenderId('');
    setDaysInput(0);
  };

  const openAssign = (employee: EmployeePopulated) => {
    setActionEmployee(employee);
    setActionMode('assign');
    setSelectedTenderId('');
    setDaysInput(0);
  };

  const openChangeTender = (employee: EmployeePopulated) => {
    setActionEmployee(employee);
    setActionMode('change');
    setSelectedTenderId('');
    setDaysInput(preferredDays(employee));
  };

  const openUnassign = (employee: EmployeePopulated) => {
    setActionEmployee(employee);
    setActionMode('unassign');
    setDaysInput(preferredDays(employee));
  };

  const handleActionConfirm = () => {
    if (!actionEmployee) return;

    if (actionMode === 'assign') {
      if (!selectedTenderId) {
        toast.error('Select a tender');
        return;
      }
      assignMutation.mutate({
        id: actionEmployee._id,
        tender: selectedTenderId,
        daysWorked: daysInput,
      });
      return;
    }

    if (actionMode === 'change') {
      if (!selectedTenderId) {
        toast.error('Select a new tender');
        return;
      }
      changeTenderMutation.mutate({
        id: actionEmployee._id,
        tender: selectedTenderId,
        daysWorkedOnCurrent: daysInput,
      });
      return;
    }

    if (actionMode === 'unassign') {
      unassignMutation.mutate({ id: actionEmployee._id, daysWorkedOnCurrent: daysInput });
    }
  };

  const expenseSummaries: TenderSalaryExpenseSummary[] = Array.isArray(expenseData)
    ? expenseData
    : expenseData
      ? [expenseData]
      : [];

  const columns: Column<EmployeePopulated>[] = [
    { key: 'employeeId', header: 'Emp ID' },
    { key: 'name', header: 'Name' },
    {
      key: 'category',
      header: 'Category',
      render: (r) =>
        resolveCategoryLabel(r.category, r.categoryOther, EMPLOYEE_CATEGORY_LABELS),
    },
    { key: 'phone', header: 'Phone' },
    {
      key: 'salary',
      header: 'Monthly Salary',
      render: (r) => formatCurrency(r.salary),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge variant={statusVariants[r.status]}>{statusLabels[r.status]}</Badge>
      ),
    },
    {
      key: 'currentTender',
      header: 'Current Tender',
      render: (r) => getTenderLabel(r.currentTender),
    },
    {
      key: 'currentDaysWorked',
      header: 'Days (Current)',
      render: (r) =>
        r.status === EmployeeAssignmentStatus.UNASSIGNED ? (
          '—'
        ) : (
          <DaysWorkedCell
            key={`${r._id}-${r.currentDaysWorked}`}
            employee={r}
            saving={updateDaysMutation.isPending && updateDaysMutation.variables?.id === r._id}
            onSave={(daysWorked) => updateDaysMutation.mutate({ id: r._id, daysWorked })}
          />
        ),
    },
    {
      key: 'currentTenderExpense',
      header: 'Current Expense',
      render: (r) =>
        r.status === EmployeeAssignmentStatus.UNASSIGNED
          ? '—'
          : formatCurrency(r.currentTenderExpense ?? 0),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex items-center gap-1">
          <button
            className="rounded p-1 hover:bg-gray-100"
            title="Edit"
            onClick={() => openEdit(r)}
          >
            <Pencil className="h-4 w-4 text-gray-500" />
          </button>
          {r.status === EmployeeAssignmentStatus.UNASSIGNED && (
            <button
              className="rounded p-1 hover:bg-blue-50"
              title="Assign to tender"
              onClick={() => openAssign(r)}
            >
              <UserPlus className="h-4 w-4 text-blue-600" />
            </button>
          )}
          {r.status !== EmployeeAssignmentStatus.UNASSIGNED && (
            <>
              <button
                className="rounded p-1 hover:bg-amber-50"
                title="Change tender"
                onClick={() => openChangeTender(r)}
              >
                <ArrowRightLeft className="h-4 w-4 text-amber-600" />
              </button>
              <button
                className="rounded p-1 hover:bg-gray-100"
                title="Unassign"
                onClick={() => openUnassign(r)}
              >
                <UserMinus className="h-4 w-4 text-gray-600" />
              </button>
            </>
          )}
          <button
            className="rounded p-1 hover:bg-gray-100"
            title="View history"
            onClick={() => setHistoryEmployee(r)}
          >
            <ChevronDown className="h-4 w-4 text-gray-500" />
          </button>
          <button
            className="rounded p-1 hover:bg-red-50"
            title="Delete"
            onClick={() => setDeleteId(r._id)}
          >
            <Trash2 className="h-4 w-4 text-red-500" />
          </button>
        </div>
      ),
    },
  ];

  const actionLoading =
    assignMutation.isPending ||
    changeTenderMutation.isPending ||
    unassignMutation.isPending;

  const actionTitle =
    actionMode === 'assign'
      ? 'Assign to Tender'
      : actionMode === 'change'
        ? 'Change Tender'
        : 'Unassign Employee';

  const actionMessage =
    actionMode === 'change'
      ? `Enter days worked on ${getTenderLabel(actionEmployee?.currentTender)} before moving to the new tender.`
      : actionMode === 'unassign'
        ? 'Enter days worked on the current tender before unassigning.'
        : 'Select a tender and optionally set starting days already worked.';

  const actionCalendarHint =
    actionMode !== 'assign' && actionEmployee?.suggestedDaysWorked != null
      ? `Calendar days since assign: ${actionEmployee.suggestedDaysWorked}`
      : null;

  return (
    <PageWrapper
      title="Employee Salary"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search name, phone, ID..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="!w-48"
          />
          <Select
            options={[
              { value: '', label: 'All statuses' },
              { value: 'unassigned', label: 'Unassigned' },
              { value: 'assigned', label: 'Assigned' },
              { value: 'changed', label: 'Moved (legacy)' },
            ]}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="!w-40"
          />
          <Select
            options={[
              { value: '', label: 'All categories' },
              ...Object.values(EmployeeCategory).map((value) => ({
                value,
                label: EMPLOYEE_CATEGORY_LABELS[value],
              })),
            ]}
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            className="!w-44"
          />
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Employee
          </Button>
        </div>
      }
    >
      <DataTable
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        page={page}
        totalPages={data?.meta.totalPages ?? 1}
        total={data?.meta.total}
        onPageChange={setPage}
        emptyTitle="No employees"
        emptyDescription="Click Add Employee to register staff and track salary by tender"
        keyExtractor={(r) => r._id}
      />

      <div className="mt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Tender Salary Expenses</h2>
          <Select
            options={[{ value: '', label: 'All tenders' }, ...tenderOptions.slice(1)]}
            value={expenseTenderFilter}
            onChange={(e) => setExpenseTenderFilter(e.target.value)}
            className="!w-64"
          />
        </div>

        {expenseSummaries.length === 0 ? (
          <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-muted">
            No salary expenses recorded for tenders yet.
          </p>
        ) : (
          <div className="space-y-4">
            {expenseSummaries.map((summary) => (
              <div key={summary.tender._id} className="rounded-xl border border-gray-200 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {summary.tender.tenderNo} — {summary.tender.tenderName}
                    </p>
                    <p className="text-sm text-muted">
                      {summary.totalDays} total days · {summary.employees.length} entries
                    </p>
                  </div>
                  <p className="text-lg font-semibold text-brand-700">
                    {formatCurrency(summary.totalExpense)}
                  </p>
                </div>
                {summary.employees.length > 0 && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted">
                        <th className="pb-2 pr-4">Employee</th>
                        <th className="pb-2 pr-4">Days</th>
                        <th className="pb-2 pr-4">Expense</th>
                        <th className="pb-2">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.employees.map((row, idx) => (
                        <tr key={`${row.employee._id}-${idx}`} className="border-b border-gray-50">
                          <td className="py-2 pr-4">
                            {row.employee.employeeId} — {row.employee.name}
                          </td>
                          <td className="py-2 pr-4">{row.daysWorked}</td>
                          <td className="py-2 pr-4">{formatCurrency(row.expense)}</td>
                          <td className="py-2">
                            <Badge variant={row.isCurrent ? 'active' : 'default'}>
                              {row.isCurrent ? 'Current' : 'Past'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editEmployee ? 'Edit Employee' : 'Add Employee'}
        size="lg"
        onSubmit={form.handleSubmit((d) =>
          editEmployee
            ? updateMutation.mutate({ id: editEmployee._id, data: d })
            : createMutation.mutate(d),
        )}
        footer={
          <ModalFormFooter
            onCancel={closeModal}
            submitLabel={editEmployee ? 'Update' : 'Create'}
            loading={createMutation.isPending || updateMutation.isPending}
          />
        }
      >
        <div className="space-y-4">
          <FormSection title="Employee Details" tone="brand">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Name"
                error={form.formState.errors.name?.message}
                {...form.register('name')}
              />
              <Input
                label="Phone"
                error={form.formState.errors.phone?.message}
                {...form.register('phone')}
              />
              <Select
                label="Category"
                options={categoryOptions}
                error={form.formState.errors.category?.message}
                {...form.register('category', {
                  onChange: () => {
                    if (form.getValues('category') !== EmployeeCategory.OTHER) {
                      form.setValue('categoryOther', '');
                    }
                  },
                })}
              />
              {selectedCategory === EmployeeCategory.OTHER && (
                <Input
                  label="Specify category"
                  placeholder="e.g. Driver, Storekeeper"
                  error={form.formState.errors.categoryOther?.message}
                  {...form.register('categoryOther')}
                />
              )}
            </div>
          </FormSection>
          <FormSection title="Salary" tone="green">
            <Input
              label="Monthly Salary"
              type="number"
              step="any"
              error={form.formState.errors.salary?.message}
              {...form.register('salary', { valueAsNumber: true })}
            />
          </FormSection>
        </div>
      </Modal>

      <Modal
        open={!!actionEmployee && !!actionMode}
        onClose={closeActionModal}
        title={actionTitle}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={closeActionModal}>
              Cancel
            </Button>
            <Button loading={actionLoading} onClick={handleActionConfirm}>
              Confirm
            </Button>
          </div>
        }
      >
        <p className="mb-4 text-sm text-muted">{actionMessage}</p>
        {actionEmployee && (
          <p className="mb-4 font-medium">
            {actionEmployee.employeeId} — {actionEmployee.name}
          </p>
        )}
        <div className="grid gap-4">
          {(actionMode === 'assign' || actionMode === 'change') && (
            <Select
              label={actionMode === 'change' ? 'New Tender' : 'Tender'}
              options={tenderOptions.filter(
                (opt) =>
                  opt.value === '' ||
                  opt.value !== actionEmployee?.currentTender?._id,
              )}
              value={selectedTenderId}
              onChange={(e) => setSelectedTenderId(e.target.value)}
            />
          )}
          {(actionMode === 'assign' || actionMode === 'change' || actionMode === 'unassign') && (
            <div className="space-y-2">
              <Input
                label={
                  actionMode === 'assign'
                    ? 'Days already worked (optional)'
                    : 'Days worked on current tender'
                }
                type="number"
                min={0}
                value={daysInput}
                onChange={(e) => setDaysInput(parseInt(e.target.value, 10) || 0)}
              />
              {actionMode === 'assign' && (
                <p className="text-xs text-muted">
                  Usually leave 0. You can update days later from the table, or use Calendar sync.
                </p>
              )}
              {actionCalendarHint && (
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-brand-600 hover:underline"
                  onClick={() =>
                    setDaysInput(actionEmployee?.suggestedDaysWorked ?? daysInput)
                  }
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  Use {actionCalendarHint}
                </button>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!historyEmployee}
        onClose={() => setHistoryEmployee(null)}
        title="Tender Assignment History"
        size="lg"
        footer={
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setHistoryEmployee(null)}>
              Close
            </Button>
          </div>
        }
      >
        {historyEmployee && (
          <>
            <p className="mb-4 font-medium">
              {historyEmployee.employeeId} — {historyEmployee.name}
            </p>
            {historyEmployee.tenderHistory.length === 0 ? (
              <p className="text-sm text-muted">No previous tender assignments.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted">
                    <th className="pb-2 pr-4">Tender</th>
                    <th className="pb-2 pr-4">Days Worked</th>
                    <th className="pb-2 pr-4">Expense</th>
                    <th className="pb-2 pr-4">Assigned</th>
                    <th className="pb-2">Ended</th>
                  </tr>
                </thead>
                <tbody>
                  {historyEmployee.tenderHistory.map((entry) => (
                    <tr key={entry._id} className="border-b border-gray-50">
                      <td className="py-2 pr-4">{getTenderLabel(entry.tender)}</td>
                      <td className="py-2 pr-4">{entry.daysWorked}</td>
                      <td className="py-2 pr-4">
                        {formatCurrency(historyEntryExpense(historyEmployee, entry))}
                      </td>
                      <td className="py-2 pr-4">{formatDate(entry.assignedAt)}</td>
                      <td className="py-2">{formatDate(entry.endedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
        title="Delete Employee"
        message="Are you sure you want to delete this employee? Assignment history will be lost."
      />
    </PageWrapper>
  );
}
