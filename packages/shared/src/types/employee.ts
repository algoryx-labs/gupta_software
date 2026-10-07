import type { EmployeeAssignmentStatus, EmployeeCategory } from '../enums.js';

export interface EmployeeTenderHistory {
  _id?: string;
  tender: string;
  daysWorked: number;
  /** Snapshot of monthly salary when the assignment ended (older rows may omit). */
  monthlySalary?: number;
  /** Locked expense when the assignment ended (older rows may omit). */
  expense?: number;
  assignedAt: string | Date;
  endedAt: string | Date;
}

export interface Employee {
  _id: string;
  name: string;
  phone: string;
  employeeId: string;
  salary: number;
  category: EmployeeCategory;
  categoryOther?: string;
  status: EmployeeAssignmentStatus;
  currentTender?: string;
  currentDaysWorked: number;
  assignedAt?: string | Date;
  tenderHistory: EmployeeTenderHistory[];
  createdBy?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface EmployeePopulated extends Omit<Employee, 'currentTender' | 'tenderHistory' | 'createdBy'> {
  currentTender?: { _id: string; tenderName: string; tenderNo: string } | null;
  tenderHistory: (Omit<EmployeeTenderHistory, 'tender'> & {
    tender: { _id: string; tenderName: string; tenderNo: string } | null;
  })[];
  createdBy?: { _id: string; name: string };
  dailyRate?: number;
  currentTenderExpense?: number;
  /** Inclusive calendar days from assignedAt through today (computed, not stored). */
  suggestedDaysWorked?: number;
}

export interface TenderEmployeeExpense {
  employee: {
    _id: string;
    name: string;
    employeeId: string;
    salary: number;
  };
  daysWorked: number;
  expense: number;
  isCurrent: boolean;
}

export interface TenderSalaryExpenseSummary {
  tender: { _id: string; tenderName: string; tenderNo: string };
  totalDays: number;
  totalExpense: number;
  employees: TenderEmployeeExpense[];
}
