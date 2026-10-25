import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

// Marks one route handler as reachable without an access token.
// Every other route needs one: the guard denies by default.
export const Public = () => SetMetadata(IS_PUBLIC, true);
