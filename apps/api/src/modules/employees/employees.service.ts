import type { FilterQuery } from 'mongoose';
import {
  EmployeeAssignmentStatus,
  EmployeeCategory,
  type AssignEmployeeInput,
  type ChangeEmployeeTenderInput,
  type CreateEmployeeInput,
  type EmployeeFilterInput,
  type UnassignEmployeeInput,
  type UpdateEmployeeDaysInput,
  type UpdateEmployeeInput,
} from '@gupta/shared';
import {
  EmployeeModel,
  calculateExpense,
  calendarDaysWorked,
  dailyRate,
  getNextEmployeeId,
  historyExpense,
  type IEmployee,
} from '../../models/Employee.js';
import { TenderModel } from '../../models/Tender.js';
import { resolveCreatedByRef } from '../../config/admin.js';
import { ApiError } from '../../utils/ApiError.js';
import { getPagination, buildPaginationMeta } from '../../utils/pagination.js';

const employeePopulate = [
  { path: 'currentTender', select: 'tenderName tenderNo' },
  { path: 'tenderHistory.tender', select: 'tenderName tenderNo' },
  { path: 'createdBy', select: 'name' },
];

function buildFilter(filters: EmployeeFilterInput): FilterQuery<IEmployee> {
  const query: FilterQuery<IEmployee> = {};

  if (filters.search) {
    const regex = new RegExp(filters.search, 'i');
    query.$or = [{ name: regex }, { phone: regex }, { employeeId: regex }];
  }
  if (filters.status) query.status = filters.status;
  if (filters.tender) query.currentTender = filters.tender;
  if (filters.category) query.category = filters.category;

  return query;
}

function normalizeCategoryFields<T extends { category?: EmployeeCategory; categoryOther?: string }>(
  input: T,
): T {
  if (input.category && input.category !== EmployeeCategory.OTHER) {
    return { ...input, categoryOther: undefined };
  }
  if (input.categoryOther !== undefined) {
    return { ...input, categoryOther: input.categoryOther.trim() || undefined };
  }
  return input;
}

function enrichEmployee(employee: Record<string, unknown>) {
  const salary = employee.salary as number;
  const currentDays = (employee.currentDaysWorked as number) ?? 0;
  const assignedAt = employee.assignedAt ? new Date(employee.assignedAt as string | Date) : undefined;
  const hasActiveAssignment =
    employee.status !== EmployeeAssignmentStatus.UNASSIGNED && Boolean(employee.currentTender);

  return {
    ...employee,
    dailyRate: dailyRate(salary),
    currentTenderExpense: calculateExpense(salary, currentDays),
    suggestedDaysWorked:
      hasActiveAssignment && assignedAt && !Number.isNaN(assignedAt.getTime())
        ? calendarDaysWorked(assignedAt)
        : undefined,
  };
}

function pushTenderHistory(
  employee: IEmployee,
  daysWorked: number,
) {
  if (!employee.currentTender) return;
  const salary = employee.salary;
  employee.tenderHistory.push({
    tender: employee.currentTender,
    daysWorked,
    monthlySalary: salary,
    expense: calculateExpense(salary, daysWorked),
    assignedAt: employee.assignedAt ?? new Date(),
    endedAt: new Date(),
  });
}

async function assertTenderExists(tenderId: string) {
  const tender = await TenderModel.findById(tenderId).select('_id');
  if (!tender) throw new ApiError(404, 'Tender not found');
}

async function getEmployeeOrThrow(id: string) {
  const employee = await EmployeeModel.findById(id);
  if (!employee) throw new ApiError(404, 'Employee not found');
  return employee;
}

export async function list(filters: EmployeeFilterInput) {
  const { page, limit } = filters;
  const { skip } = getPagination(page, limit);
  const filter = buildFilter(filters);

  const [data, total] = await Promise.all([
    EmployeeModel.find(filter)
      .populate(employeePopulate)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    EmployeeModel.countDocuments(filter),
  ]);

  return {
    data: data.map((row) => enrichEmployee(row as Record<string, unknown>)),
    meta: buildPaginationMeta(page, limit, total),
  };
}

export async function getById(id: string) {
  const employee = await EmployeeModel.findById(id).populate(employeePopulate).lean();
  if (!employee) throw new ApiError(404, 'Employee not found');
  return enrichEmployee(employee as Record<string, unknown>);
}

export async function create(input: CreateEmployeeInput, userId: string) {
  const payload = normalizeCategoryFields(input);
  const employeeId = await getNextEmployeeId();

  const employee = await EmployeeModel.create({
    ...payload,
    employeeId,
    createdBy: resolveCreatedByRef(userId),
  });

  return EmployeeModel.findById(employee._id).populate(employeePopulate).lean();
}

export async function update(id: string, input: UpdateEmployeeInput) {
  const payload = normalizeCategoryFields({ ...input });

  const employee = await EmployeeModel.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  })
    .populate(employeePopulate)
    .lean();

  if (!employee) throw new ApiError(404, 'Employee not found');
  return enrichEmployee(employee as Record<string, unknown>);
}

export async function remove(id: string) {
  const employee = await EmployeeModel.findByIdAndDelete(id);
  if (!employee) throw new ApiError(404, 'Employee not found');
  return employee;
}

export async function assign(id: string, input: AssignEmployeeInput) {
  const employee = await getEmployeeOrThrow(id);

  if (employee.status !== EmployeeAssignmentStatus.UNASSIGNED) {
    throw new ApiError(400, 'Employee is already assigned. Use change tender instead.');
  }

  await assertTenderExists(input.tender);

  employee.status = EmployeeAssignmentStatus.ASSIGNED;
  employee.currentTender = input.tender as never;
  employee.currentDaysWorked = input.daysWorked ?? 0;
  employee.assignedAt = new Date();
  await employee.save();

  return getById(id);
}

export async function changeTender(id: string, input: ChangeEmployeeTenderInput) {
  const employee = await getEmployeeOrThrow(id);

  if (
    employee.status === EmployeeAssignmentStatus.UNASSIGNED ||
    !employee.currentTender
  ) {
    throw new ApiError(400, 'Employee is not assigned to any tender');
  }

  if (employee.currentTender.toString() === input.tender) {
    throw new ApiError(400, 'Employee is already assigned to this tender');
  }

  await assertTenderExists(input.tender);

  pushTenderHistory(employee, input.daysWorkedOnCurrent);

  // Stay "assigned" after a move so filters/UX stay consistent (CHANGED kept for legacy rows).
  employee.status = EmployeeAssignmentStatus.ASSIGNED;
  employee.currentTender = input.tender as never;
  employee.currentDaysWorked = 0;
  employee.assignedAt = new Date();
  await employee.save();

  return getById(id);
}

export async function unassign(id: string, input: UnassignEmployeeInput) {
  const employee = await getEmployeeOrThrow(id);

  if (
    employee.status === EmployeeAssignmentStatus.UNASSIGNED ||
    !employee.currentTender
  ) {
    throw new ApiError(400, 'Employee is not assigned to any tender');
  }

  const daysWorked = input.daysWorkedOnCurrent ?? employee.currentDaysWorked;
  pushTenderHistory(employee, daysWorked);

  employee.status = EmployeeAssignmentStatus.UNASSIGNED;
  employee.currentTender = undefined;
  employee.currentDaysWorked = 0;
  employee.assignedAt = undefined;
  await employee.save();

  return getById(id);
}

export async function updateDays(id: string, input: UpdateEmployeeDaysInput) {
  const employee = await getEmployeeOrThrow(id);

  if (
    employee.status === EmployeeAssignmentStatus.UNASSIGNED ||
    !employee.currentTender
  ) {
    throw new ApiError(400, 'Employee is not assigned to any tender');
  }

  employee.currentDaysWorked = input.daysWorked;
  await employee.save();

  return getById(id);
}

export async function getTenderExpenseSummary(tenderId?: string) {
  const tenderFilter = tenderId ? { _id: tenderId } : {};
  const tenders = await TenderModel.find(tenderFilter)
    .select('tenderName tenderNo')
    .sort({ tenderName: 1 })
    .lean();

  const employees = await EmployeeModel.find()
    .select('name employeeId salary currentTender currentDaysWorked tenderHistory')
    .lean();

  const summaries = tenders.map((tender) => {
    const tenderIdStr = tender._id.toString();
    const employeeExpenses: Array<{
      employee: { _id: string; name: string; employeeId: string; salary: number };
      daysWorked: number;
      expense: number;
      isCurrent: boolean;
    }> = [];

    for (const emp of employees) {
      for (const entry of emp.tenderHistory ?? []) {
        if (entry.tender?.toString() === tenderIdStr) {
          employeeExpenses.push({
            employee: {
              _id: emp._id.toString(),
              name: emp.name,
              employeeId: emp.employeeId,
              salary: emp.salary,
            },
            daysWorked: entry.daysWorked,
            expense: historyExpense(entry, emp.salary),
            isCurrent: false,
          });
        }
      }

      if (emp.currentTender?.toString() === tenderIdStr) {
        employeeExpenses.push({
          employee: {
            _id: emp._id.toString(),
            name: emp.name,
            employeeId: emp.employeeId,
            salary: emp.salary,
          },
          daysWorked: emp.currentDaysWorked,
          expense: calculateExpense(emp.salary, emp.currentDaysWorked),
          isCurrent: true,
        });
      }
    }

    const totalDays = employeeExpenses.reduce((sum, row) => sum + row.daysWorked, 0);
    const totalExpense = employeeExpenses.reduce((sum, row) => sum + row.expense, 0);

    return {
      tender: {
        _id: tenderIdStr,
        tenderName: tender.tenderName,
        tenderNo: tender.tenderNo,
      },
      totalDays,
      totalExpense,
      employees: employeeExpenses,
    };
  });

  return tenderId ? summaries[0] ?? null : summaries.filter((s) => s.totalDays > 0 || s.employees.length > 0);
}
