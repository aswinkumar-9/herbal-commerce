import { index, layout, route } from '@react-router/dev/routes';
import type { RouteConfig } from '@react-router/dev/routes';

// The website's pages (ADR 0039). Any other address is the "not found"
// page, with the status 404.
export default [
  // Every page sits in one layout, which shows "not found", "short break"
  // and "something went wrong" inside the site's frame (routes/pages.tsx).
  layout('routes/pages.tsx', [
    index('routes/home.tsx'),
    route('shop', 'routes/shop.tsx'),
    route('categories/:slug', 'routes/category.tsx'),
    route('products/:slug', 'routes/product.tsx'),
    // Signing in and out, the account and its emailed links, and the
    // customer's own page (ADR 0041).
    route('sign-in', 'routes/sign-in.tsx'),
    route('sign-out', 'routes/sign-out.tsx'),
    route('sign-up', 'routes/sign-up.tsx'),
    route('verify-email', 'routes/verify-email.tsx'),
    route('forgot-password', 'routes/forgot-password.tsx'),
    route('reset-password', 'routes/reset-password.tsx'),
    route('account', 'routes/account.tsx'),
    route('account/password', 'routes/account-password.tsx'),
    route('account/addresses/new', 'routes/address-new.tsx'),
    route('account/addresses/:id', 'routes/address-edit.tsx'),
    // The policy pages (ADR 0040): /privacy, /terms, /refunds, /shipping and
    // /contact. Any other single word is "not found", from the loader.
    route(':page', 'routes/policy.tsx'),
    route('*', 'routes/not-found.tsx'),
  ]),
] satisfies RouteConfig;
