import { Router } from 'express';
import {
  Permission,
  purchaseFilterSchema,
  createPurchaseSchema,
  updatePurchaseSchema,
  attachmentPresignSchema,
  attachmentCompleteSchema,
} from '@gupta/shared';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { activityLogger } from '../../middleware/activityLogger.js';
import { upload } from '../../utils/upload.js';
import * as ctrl from './purchases.controller.js';

const router = Router();

router.use(authenticate, authorize(Permission.MANAGE_PURCHASES));

router.get('/export', validate(purchaseFilterSchema, 'query'), asyncHandler(ctrl.exportData));
router.get('/', validate(purchaseFilterSchema, 'query'), asyncHandler(ctrl.list));
router.post('/', validate(createPurchaseSchema), activityLogger('create', 'Purchase'), asyncHandler(ctrl.create));
router.get('/:id', asyncHandler(ctrl.getById));
router.patch('/:id', validate(updatePurchaseSchema), activityLogger('update', 'Purchase'), asyncHandler(ctrl.update));
router.delete('/:id', activityLogger('delete', 'Purchase'), asyncHandler(ctrl.remove));
router.post(
  '/:id/attachments/presign',
  validate(attachmentPresignSchema),
  asyncHandler(ctrl.presignAttachment),
);
router.post(
  '/:id/attachments/complete',
  validate(attachmentCompleteSchema),
  activityLogger('upload_attachment', 'Purchase'),
  asyncHandler(ctrl.completeAttachment),
);
router.post(
  '/:id/attachments',
  upload.single('file'),
  activityLogger('upload_attachment', 'Purchase'),
  asyncHandler(ctrl.uploadAttachment),
);
router.delete(
  '/:id/attachments/:attId',
  activityLogger('delete_attachment', 'Purchase'),
  asyncHandler(ctrl.deleteAttachment),
);

export default router;
