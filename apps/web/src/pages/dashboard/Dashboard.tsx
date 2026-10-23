import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { IndianRupee, Receipt, FileText, AlertTriangle, Wallet } from 'lucide-react';
import { dashboardApi } from '@/api/dashboard';
import { tendersApi } from '@/api/tenders';
import { PageWrapper } from '@/layouts/PageWrapper';
import { StatCard } from '@/components/StatCard';
import { Spinner } from '@/components/Spinner';
import { Select } from '@/components/Input';
import { formatCurrency, formatNumber } from '@/lib/formatters';

const STATUS_PIE_COLORS: Record<string, string> = {
  Active: '#2563EB',
  Completed: '#22C55E',
  Pending: '#F59E0B',
  Expired: '#EF4444',
  Cancelled: '#94A3B8',
};

const STATUS_ORDER = ['Active', 'Completed', 'Pending', 'Expired', 'Cancelled'] as const;

export default function DashboardPage() {
  const [tenderId, setTenderId] = useState('');

  const { data: tendersData, isLoading: tendersLoading } = useQuery({
    queryKey: ['tenders', 'dashboard-filter'],
    queryFn: () => tendersApi.list({ limit: 100, sortBy: 'tenderName', sortOrder: 'asc' }),
  });

  const tenderOptions = useMemo(
    () =>
      (tendersData?.data ?? []).map((t) => ({
        value: t._id,
        label: `${t.tenderNo} — ${t.tenderName}`,
      })),
    [tendersData],
  );

  // Reason: default to the first tender once the list loads (no "All tenders" option)
  useEffect(() => {
    if (!tenderOptions.length) return;
    const stillValid = tenderOptions.some((t) => t.value === tenderId);
    if (!tenderId || !stillValid) {
      setTenderId(tenderOptions[0].value);
    }
  }, [tenderOptions, tenderId]);

  const selectedTenderLabel = tenderOptions.find((t) => t.value === tenderId)?.label;

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', tenderId],
    queryFn: () => dashboardApi.summary({ tender: tenderId }),
    enabled: !!tenderId,
  });

  const tenderPie = useMemo(() => {
    if (!data) return [];
    const slices = [
      { name: 'Active', value: data.tenders.activeCount },
      { name: 'Completed', value: data.tenders.completedCount },
      { name: 'Pending', value: data.tenders.pendingCount },
      { name: 'Expired', value: data.tenders.expiredCount },
      { name: 'Cancelled', value: data.tenders.cancelledCount },
    ].filter((d) => d.value > 0);

    return [...slices].sort(
      (a, b) => STATUS_ORDER.indexOf(a.name as (typeof STATUS_ORDER)[number]) - STATUS_ORDER.indexOf(b.name as (typeof STATUS_ORDER)[number]),
    );
  }, [data]);

  const tenderPieTotal = useMemo(
    () => tenderPie.reduce((sum, slice) => sum + slice.value, 0),
    [tenderPie],
  );

  const selectedTender = useMemo(
    () => (tendersData?.data ?? []).find((t) => t._id === tenderId),
    [tendersData, tenderId],
  );

  const selectedTenderStatus = useMemo(() => {
    if (!selectedTender?.status) return null;
    return selectedTender.status.charAt(0).toUpperCase() + selectedTender.status.slice(1);
  }, [selectedTender]);

  const tenderSpendBreakdown = useMemo(() => {
    if (!data) return [];
    return [
      { name: 'Purchases', total: data.purchases.totalGrandValue, fill: '#2563EB' },
      { name: 'Labour', total: data.labourExpenses.totalAmount, fill: '#22C55E' },
      { name: 'Salary', total: data.salaryExpenses.totalAmount, fill: '#F59E0B' },
    ].filter((row) => row.total > 0);
  }, [data]);

  const filters = (
    <Select
      label="Tender"
      layout="inline"
      options={tenderOptions}
      value={tenderId}
      onChange={(e) => setTenderId(e.target.value)}
      className="!w-auto min-w-[180px]"
    />
  );

  const showLoading = tendersLoading || (!!tenderId && isLoading);

  return (
    <PageWrapper title="Dashboard" actions={filters}>
      {showLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : !tenderOptions.length ? (
        <p className="py-20 text-center text-sm text-muted">No tenders available</p>
      ) : data ? (
        <div className="space-y-6">
          {selectedTenderLabel && (
            <p className="text-sm text-muted">
              Showing stats for <span className="font-medium text-gray-700">{selectedTenderLabel}</span>
            </p>
          )}

          <div className="card">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="font-semibold">Tender Progress</h3>
              <span className="text-sm font-medium text-brand-700">{data.tenders.progress ?? 0}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-brand-gradient transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, data.tenders.progress ?? 0))}%` }}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard
              title="Total Purchase Value"
              value={formatCurrency(data.purchases.totalGrandValue)}
              subtitle={`${formatNumber(data.purchases.totalCount)} bills`}
              icon={IndianRupee}
              accent
            />
            <StatCard
              title="Total GST"
              value={formatCurrency(data.purchases.totalGst)}
              icon={Receipt}
            />
            <StatCard
              title="Tender Order Value"
              value={formatCurrency(data.tenders.totalOrderValue)}
              subtitle={selectedTenderLabel}
              icon={FileText}
            />
            <StatCard
              title="Labour Expense"
              value={formatCurrency(data.labourExpenses.totalAmount)}
              subtitle={`${formatNumber(data.labourExpenses.totalCount)} entries`}
              icon={IndianRupee}
            />
            <StatCard
              title="Salary Expense"
              value={formatCurrency(data.salaryExpenses.totalAmount)}
              subtitle={`${formatNumber(data.salaryExpenses.totalDays)} days · ${formatNumber(data.salaryExpenses.employeeCount)} assignments`}
              icon={Wallet}
            />
            <StatCard
              title="Outstanding Payments"
              value={formatCurrency(data.tenders.totalOutstanding)}
              subtitle={`${data.tenders.expiringBgs.length} BGs expiring soon`}
              icon={AlertTriangle}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card">
              <h3 className="mb-4 font-semibold">Monthly Purchases</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.purchases.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0E3DC" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="total" fill="#2563EB" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <div className="mb-1 flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Tender Status</h3>
                  <p className="text-xs text-muted">Across all tenders</p>
                </div>
                {selectedTenderStatus && (
                  <span
                    className="rounded-lg border px-2.5 py-1 text-xs font-medium"
                    style={{
                      color: STATUS_PIE_COLORS[selectedTenderStatus] ?? '#64748B',
                      borderColor: `${STATUS_PIE_COLORS[selectedTenderStatus] ?? '#64748B'}33`,
                      backgroundColor: `${STATUS_PIE_COLORS[selectedTenderStatus] ?? '#64748B'}14`,
                    }}
                  >
                    Selected: {selectedTenderStatus}
                  </span>
                )}
              </div>
              {tenderPie.length > 0 ? (
                <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto]">
                  <div className="relative h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={tenderPie}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={58}
                          outerRadius={88}
                          paddingAngle={tenderPie.length > 1 ? 3 : 0}
                          stroke="#fff"
                          strokeWidth={2}
                        >
                          {tenderPie.map((slice) => (
                            <Cell key={slice.name} fill={STATUS_PIE_COLORS[slice.name] ?? '#64748B'} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number, name: string) => [
                            `${value} · ${tenderPieTotal ? Math.round((value / tenderPieTotal) * 100) : 0}%`,
                            name,
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-semibold text-gray-900">{tenderPieTotal}</span>
                      <span className="text-xs text-muted">tenders</span>
                    </div>
                  </div>

                  <div className="min-w-[140px] space-y-2.5">
                    {tenderPie.map((slice) => {
                      const pct = tenderPieTotal ? Math.round((slice.value / tenderPieTotal) * 100) : 0;
                      return (
                        <div key={slice.name} className="flex items-center justify-between gap-3 text-sm">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: STATUS_PIE_COLORS[slice.name] }}
                            />
                            <span className="text-gray-700">{slice.name}</span>
                          </div>
                          <span className="font-medium text-gray-900">
                            {slice.value}
                            <span className="ml-1 text-xs font-normal text-muted">{pct}%</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-muted">No tender data</p>
              )}
            </div>

            <div className="card">
              <div className="mb-4">
                <h3 className="font-semibold">Tender Spend Breakdown</h3>
                <p className="text-xs text-muted">Purchases, labour & salary for selected tender</p>
              </div>
              {tenderSpendBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={tenderSpendBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0E3DC" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${(v / 100000).toFixed(0)}L`} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                      {tenderSpendBreakdown.map((row) => (
                        <Cell key={row.name} fill={row.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-12 text-center text-sm text-muted">No spend recorded for this tender yet</p>
              )}
              {selectedTender && (
                <div className="mt-4 grid gap-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted">Order value</span>
                    <span className="font-medium">{formatCurrency(selectedTender.orderValue)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted">Outstanding</span>
                    <span className="font-medium">{formatCurrency(selectedTender.paymentOutstanding)}</span>
                  </div>
                  {selectedTender.bgExpiryDate && (
                    <div className="flex justify-between gap-2 sm:col-span-2">
                      <span className="text-muted">BG expiry</span>
                      <span className="font-medium">
                        {new Date(selectedTender.bgExpiryDate).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                        {selectedTender.bgNumber ? ` · ${selectedTender.bgNumber}` : ''}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="card">
              <h3 className="mb-4 font-semibold">Top Vendors</h3>
              <div className="space-y-3">
                {data.purchases.topVendors.map((v, i) => (
                  <div key={v.vendorId} className="flex items-center justify-between">
                    <span className="text-sm">
                      {i + 1}. {v.vendorName}
                    </span>
                    <span className="text-sm font-medium">{formatCurrency(v.total)}</span>
                  </div>
                ))}
                {data.purchases.topVendors.length === 0 && (
                  <p className="text-sm text-muted">No vendor data</p>
                )}
              </div>
            </div>
          </div>

          {data.tenders.expiringBgs.length > 0 && (
            <div className="card border-amber-200 bg-amber-50/50">
              <h3 className="mb-3 font-semibold text-amber-800">Bank Guarantees Expiring (60 days)</h3>
              <div className="space-y-2">
                {data.tenders.expiringBgs.map((bg) => (
                  <div key={bg._id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      {bg.tenderName} ({bg.tenderNo})
                    </span>
                    <span className="font-medium text-amber-700">
                      {bg.daysUntilExpiry} days · BG: {bg.bgNumber || 'N/A'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </PageWrapper>
  );
}
