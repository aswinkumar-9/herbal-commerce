import { applyDecorators, SetMetadata } from '@nestjs/common';
import { StaffOnly } from './staff-only.decorator';

export const SUPER_USER_ONLY = 'superUserOnly';

// Marks a route handler, or a whole controller, as for Super Users only. It
// is a staff route too, so it takes staff tokens only, and the roles guard
// then refuses Admins with 403. Like @StaffOnly(), it only ever narrows who
// gets in, so a whole controller may be marked.
export const SuperUserOnly = () =>
  applyDecorators(StaffOnly(), SetMetadata(SUPER_USER_ONLY, true));
