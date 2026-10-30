import { SetMetadata } from '@nestjs/common';

export const STAFF_ONLY = 'staffOnly';

// Marks a route handler, or a whole controller, as staff only: it then takes
// staff access tokens and refuses customer ones. Every other protected route
// is for customers. Unlike @Public(), a whole controller may be marked,
// because this only ever narrows who gets in.
export const StaffOnly = () => SetMetadata(STAFF_ONLY, true);
