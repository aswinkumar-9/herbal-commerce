import { render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { createRoutesStub } from 'react-router';

// Draws one page in the website's frame, at an address, with its loader's
// answer, as React Router would after the server made it.
export function renderPage({
  path = '/',
  url = path,
  Component,
  loader,
  ErrorBoundary,
}: {
  path?: string;
  url?: string;
  Component: ComponentType<never>;
  loader?: () => unknown;
  ErrorBoundary?: ComponentType<never>;
}) {
  const Stub = createRoutesStub([
    {
      path,
      Component: Component as ComponentType,
      ...(loader ? { loader } : {}),
      ...(ErrorBoundary
        ? { ErrorBoundary: ErrorBoundary as ComponentType }
        : {}),
    },
  ]);
  return render(<Stub initialEntries={[url]} />);
}
