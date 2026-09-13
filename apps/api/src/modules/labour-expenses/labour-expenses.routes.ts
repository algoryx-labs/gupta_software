import { Router } from 'express';
import {
  Permission,
  createLabourExpenseSchema,
  updateLabourExpenseSchema,
  labourExpenseFilterSchema,
} from '@gupta/shared';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { activityLogger } from '../../middleware/activityLogger.js';
import * as ctrl from './labour-expenses.controller.js';

const router = Router();

router.use(authenticate, authorize(Permission.MANAGE_PURCHASES));

router.get('/', validate(labourExpenseFilterSchema, 'query'), asyncHandler(ctrl.list));
router.post('/', validate(createLabourExpenseSchema), activityLogger('create', 'LabourExpense'), asyncHandler(ctrl.create));
router.patch('/:id', validate(updateLabourExpenseSchema), activityLogger('update', 'LabourExpense'), asyncHandler(ctrl.update));
router.delete('/:id', activityLogger('delete', 'LabourExpense'), asyncHandler(ctrl.remove));

export default router;
