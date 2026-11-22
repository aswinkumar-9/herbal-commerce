import { createContext } from 'react';

// The page's nonce (app/entry.server.tsx), for the few inline scripts the
// page writes itself: on the server only. In the browser it is undefined:
// a browser hides a nonce from scripts once the page is read, and the
// scripts have run by then.
export const NonceContext = createContext<string | undefined>(undefined);
