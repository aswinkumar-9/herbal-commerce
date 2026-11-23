import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Link, Outlet, createRoutesStub, data } from 'react-router';
import { describe, expect, it } from 'vitest';
import routes from '../routes.ts';
import Pages, { ErrorBoundary } from './pages.tsx';

// Found in Chrome (part 14B, step 7): a link to a page that couldn't be made
// drew the whole document anew, React made <script> elements for it, Trusted
// Types refused them, and the page went blank. Inside the pages' layout, the
// frame stays and only the page changes.
describe('the pages’ layout', () => {
  it('holds every page of the website', () => {
    expect(routes).toHaveLength(1);
    const [layout] = routes;
    expect(layout?.file).toBe('routes/pages.tsx');
    expect(layout?.path).toBeUndefined();
    expect(layout?.children?.length).toBeGreaterThan(10);
  });

  // The frame counts how often it is made; a link leads to a page whose
  // loader says "not found". Like root.tsx's Layout, the frame is around
  // the root's error page too.
  function site(withLayout: boolean) {
    const made = { count: 0 };
    function Frame({ children }: { children?: ReactNode }) {
      useEffect(() => {
        made.count += 1;
      }, []);
      return children ?? <Outlet />;
    }
    const pages = [
      {
        index: true,
        Component: () => <Link to="/gone">A page that is gone</Link>,
      },
      {
        path: 'gone',
        Component: () => null,
        loader: () => {
          throw data(null, { status: 404 });
        },
      },
    ];
    const Stub = createRoutesStub([
      {
        path: '/',
        Component: Frame,
        ...(withLayout
          ? {
              children: [
                {
                  Component: Pages,
                  ErrorBoundary: ErrorBoundary as ComponentType,
                  children: pages,
                },
              ],
            }
          : {
              ErrorBoundary: (props: Parameters<typeof ErrorBoundary>[0]) => (
                <Frame>
                  <ErrorBoundary {...props} />
                </Frame>
              ),
              children: pages,
            }),
      },
    ]);
    render(<Stub initialEntries={['/']} />);
    return made;
  }

  it('shows "not found" for a link within the site, keeping the frame', async () => {
    const made = site(true);
    await userEvent.click(
      await screen.findByRole('link', { name: 'A page that is gone' }),
    );
    expect(
      await screen.findByRole('heading', {
        name: 'We couldn’t find that page',
      }),
    ).toBeInTheDocument();
    expect(made.count).toBe(1);
  });

  it('is what keeps the frame: caught above it, the frame is made again', async () => {
    const made = site(false);
    await userEvent.click(
      await screen.findByRole('link', { name: 'A page that is gone' }),
    );
    await screen.findByRole('heading', { name: 'We couldn’t find that page' });
    expect(made.count).toBe(2);
  });
});
