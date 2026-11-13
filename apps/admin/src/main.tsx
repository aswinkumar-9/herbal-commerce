import './zod-config';
import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { routes } from './App';
import { createQueryClient } from './api/query-client';
import './index.css';

const queryClient = createQueryClient();
const router = createBrowserRouter(routes);

const root = document.getElementById('root');
if (!root) {
  throw new Error('The page has no #root element');
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Follows the computer's "reduce motion" setting. */}
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
