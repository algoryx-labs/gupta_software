import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { EmployeeAssignmentStatus, EmployeeCategory } from '@gupta/shared';

export interface IEmployeeTenderHistory {
  _id?: Types.ObjectId;
  tender: Types.ObjectId;
  daysWorked: number;
  /** Salary at assignment end — optional for older prod history rows */
  monthlySalary?: number;
  /** Locked expense at assignment end — optional for older prod history rows */
  expense?: number;
  assignedAt: Date;
  endedAt: Date;
}

export interface IEmployee extends Document {
  name: string;
  phone: string;
  employeeId: string;
  salary: number;
  category: EmployeeCategory;
  categoryOther?: string;
  status: EmployeeAssignmentStatus;
  currentTender?: Types.ObjectId;
  currentDaysWorked: number;
  assignedAt?: Date;
  tenderHistory: IEmployeeTenderHistory[];
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const tenderHistorySchema = new Schema<IEmployeeTenderHistory>(
  {
    tender: { type: Schema.Types.ObjectId, ref: 'Tender', required: true },
    daysWorked: { type: Number, required: true, min: 0 },
    monthlySalary: { type: Number, min: 0 },
    expense: { type: Number, min: 0 },
    assignedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
  },
  { _id: true },
);

const employeeSchema = new Schema<IEmployee>(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    employeeId: { type: String, required: true, unique: true, trim: true, uppercase: true },
    salary: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      enum: Object.values(EmployeeCategory),
      required: true,
    },
    categoryOther: { type: String, trim: true, maxlength: 100 },
    status: {
      type: String,
      enum: Object.values(EmployeeAssignmentStatus),
      default: EmployeeAssignmentStatus.UNASSIGNED,
    },
    currentTender: { type: Schema.Types.ObjectId, ref: 'Tender' },
    currentDaysWorked: { type: Number, default: 0, min: 0 },
    assignedAt: { type: Date },
    tenderHistory: { type: [tenderHistorySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

employeeSchema.index({ name: 1 });
employeeSchema.index({ status: 1 });
employeeSchema.index({ category: 1 });
employeeSchema.index({ currentTender: 1 });

export const EmployeeModel = mongoose.model<IEmployee>('Employee', employeeSchema);

const EMPLOYEE_ID_PREFIX = 'GTE';
const EMPLOYEE_ID_PAD = 3;

export async function getNextEmployeeId(): Promise<string> {
  const docs = await EmployeeModel.find({ employeeId: new RegExp(`^${EMPLOYEE_ID_PREFIX}\\d+$`, 'i') })
    .select('employeeId')
    .lean();

  let max = 0;
  for (const doc of docs) {
    const n = Number.parseInt(doc.employeeId.replace(new RegExp(`^${EMPLOYEE_ID_PREFIX}`, 'i'), ''), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }

  return `${EMPLOYEE_ID_PREFIX}${String(max + 1).padStart(EMPLOYEE_ID_PAD, '0')}`;
}

export const DAYS_IN_MONTH = 30;

export function dailyRate(monthlySalary: number): number {
  return monthlySalary / DAYS_IN_MONTH;
}

export function calculateExpense(monthlySalary: number, daysWorked: number): number {
  return dailyRate(monthlySalary) * daysWorked;
}

/** Inclusive calendar days from assign date through asOf (UTC date parts). */
export function calendarDaysWorked(assignedAt: Date, asOf: Date = new Date()): number {
  const start = Date.UTC(assignedAt.getFullYear(), assignedAt.getMonth(), assignedAt.getDate());
  const end = Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function historyExpense(
  entry: { daysWorked: number; monthlySalary?: number; expense?: number },
  fallbackSalary: number,
): number {
  if (typeof entry.expense === 'number' && !Number.isNaN(entry.expense)) {
    return entry.expense;
  }
  const salary =
    typeof entry.monthlySalary === 'number' && !Number.isNaN(entry.monthlySalary)
      ? entry.monthlySalary
      : fallbackSalary;
  return calculateExpense(salary, entry.daysWorked);
}
