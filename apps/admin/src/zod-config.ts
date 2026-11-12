import { z } from 'zod';

// Zod would try `new Function` to speed up parsing. The console's policy
// forbids it (no eval, Trusted Types), so it is never tried, and the browser
// reports no violation. Imported first, before anything is parsed.
z.config({ jitless: true });
