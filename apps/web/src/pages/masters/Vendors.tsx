import { createVendorSchema, type Vendor } from '@gupta/shared';
import { vendorsApi } from '@/api/masters';
import { MasterCrudPage } from './MasterCrudPage';
import type { Column } from '@/components/DataTable';

const vendorFormFields = [
  { name: 'name', label: 'Vendor Name' },
  { name: 'contactPerson', label: 'Contact Person Name' },
  { name: 'phone', label: 'Mobile' },
  { name: 'email', label: 'Email' },
  { name: 'gstin', label: 'GSTIN' },
  { name: 'address', label: 'Address', type: 'textarea' as const },
  { name: 'notes', label: 'Notes', type: 'textarea' as const },
];

const vendorDetailFields = [
  { name: 'code', label: 'Vendor Code' },
  ...vendorFormFields,
];

const columns: Column<Vendor>[] = [
  { key: 'code', header: 'Code', className: 'w-28' },
  { key: 'name', header: 'Vendor Name' },
  { key: 'gstin', header: 'GST', render: (r) => r.gstin?.trim() || '—' },
  { key: 'phone', header: 'Mobile' },
];

export default function VendorsPage() {
  return (
    <MasterCrudPage<Vendor>
      title="Vendors"
      queryKey="vendors"
      schema={createVendorSchema}
      defaultValues={{ name: '', contactPerson: '', phone: '', email: '', gstin: '', address: '', notes: '' }}
      fields={vendorFormFields}
      detailFields={vendorDetailFields}
      columns={columns}
      listFn={vendorsApi.list}
      createFn={(data) => vendorsApi.create(data as never)}
      updateFn={(id, data) => vendorsApi.update(id, data as never)}
      removeFn={vendorsApi.remove}
    />
  );
}
