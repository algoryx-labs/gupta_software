import { Router } from 'express';
import {
  Permission,
  createLoaSchema,
  updateLoaSchema,
  loaFilterSchema,
  attachmentPresignSchema,
  attachmentCompleteSchema,
} from '@gupta/shared';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticate } from '../../middleware/auth.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { activityLogger } from '../../middleware/activityLogger.js';
import { upload } from '../../utils/upload.js';
import * as ctrl from './loas.controller.js';

const router = Router();

router.use(authenticate, authorize(Permission.MANAGE_TENDERS));

router.get('/', validate(loaFilterSchema, 'query'), asyncHandler(ctrl.list));
router.post('/', validate(createLoaSchema), activityLogger('create', 'Loa'), asyncHandler(ctrl.create));
router.get('/:id', asyncHandler(ctrl.getById));
router.patch('/:id', validate(updateLoaSchema), activityLogger('update', 'Loa'), asyncHandler(ctrl.update));
router.delete('/:id', activityLogger('delete', 'Loa'), asyncHandler(ctrl.remove));
router.post(
  '/:id/attachments/presign',
  validate(attachmentPresignSchema),
  asyncHandler(ctrl.presignAttachment),
);
router.post(
  '/:id/attachments/complete',
  validate(attachmentCompleteSchema),
  activityLogger('upload_attachment', 'Loa'),
  asyncHandler(ctrl.completeAttachment),
);
router.post(
  '/:id/attachments',
  upload.single('file'),
  activityLogger('upload_attachment', 'Loa'),
  asyncHandler(ctrl.uploadAttachment),
);
router.delete(
  '/:id/attachments/:attId',
  activityLogger('delete_attachment', 'Loa'),
  asyncHandler(ctrl.deleteAttachment),
);

export default router;
