import { index, route } from '@react-router/dev/routes';
import type { RouteConfig } from '@react-router/dev/routes';

// The website's pages (ADR 0039). Any other address is the "not found"
// page, with the status 404.
export default [
  index('routes/home.tsx'),
  route('shop', 'routes/shop.tsx'),
  route('categories/:slug', 'routes/category.tsx'),
  route('products/:slug', 'routes/product.tsx'),
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
