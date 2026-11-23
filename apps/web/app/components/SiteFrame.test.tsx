import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Form,
  Link,
  Outlet,
  createRoutesStub,
  useNavigation,
} from 'react-router';
import { describe, expect, it } from 'vitest';
import { mediaListeners, mediaMatches } from '../test/setup.ts';
import { renderPage } from '../test/render.tsx';
import { SiteFrame } from './SiteFrame.tsx';

function Page() {
  return (
    <SiteFrame>
      <h1>A page</h1>
      <a href="#somewhere">A link on the page</a>
    </SiteFrame>
  );
}

function Frame() {
  return (
    <SiteFrame>
      <Outlet />
    </SiteFrame>
  );
}

// The first page leads on three ways: to the next page, to itself again
// (as the shop's filters do), and by sending a form. It says how the
// going is.
function FirstPage() {
  const navigation = useNavigation();
  return (
    <>
      <Link to="/next">The next page</Link>
      <Link to="/?again=1">The same page again</Link>
      <Form method="post" action="/next">
        <button type="submit">Send</button>
      </Form>
      <p data-testid="going">{navigation.state}</p>
    </>
  );
}

function NextPage() {
  return <h1>The next page</h1>;
}

const toggle = () => screen.getByRole('button', { name: 'Menu' });
const panel = () => document.getElementById('menu') as HTMLElement;

// A page under the root, whose loader says whether someone is signed in.
function openAs(signedIn: boolean, cartPacks: number | null = null) {
  const Stub = createRoutesStub([
    {
      id: 'root',
      path: '/',
      loader: () => ({ signedIn, cartPacks }),
      Component: Page,
    },
  ]);
  render(<Stub initialEntries={['/']} />);
}

describe('the customer’s place in the menu', () => {
  it('is the way to sign in for a visitor', async () => {
    openAs(false);
    const bar = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(bar).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    expect(within(bar).queryByRole('link', { name: 'Account' })).toBeNull();
  });

  it('is the account for a signed-in customer, in the bar and the phone menu', async () => {
    openAs(true);
    const bar = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(bar).getByRole('link', { name: 'Account' })).toHaveAttribute(
      'href',
      '/account',
    );
    expect(
      screen.getAllByRole('link', { name: 'Account', hidden: true }),
    ).toHaveLength(2);
    expect(
      screen.queryByRole('link', { name: 'Sign in', hidden: true }),
    ).toBeNull();
  });

  it('has the customer’s orders once signed in, before the account, and none for a visitor', async () => {
    openAs(true);
    const bar = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(bar).getByRole('link', { name: 'Orders' })).toHaveAttribute(
      'href',
      '/orders',
    );
    expect(
      within(bar)
        .getAllByRole('link')
        .map((link) => link.textContent)
        .slice(-2),
    ).toEqual(['Orders', 'Account']);
    expect(
      screen.getAllByRole('link', { name: 'Orders', hidden: true }),
    ).toHaveLength(2);
    cleanup();
    openAs(false);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(
      screen.queryByRole('link', { name: 'Orders', hidden: true }),
    ).toBeNull();
  });
});

describe('the cart in the menu', () => {
  it('is there once signed in, with how many packs it holds, read out', async () => {
    openAs(true, 3);
    const bar = await screen.findByRole('navigation', { name: 'Main' });
    const cart = within(bar).getByRole('link', { name: 'Cart, 3 packs' });
    expect(cart).toHaveAttribute('href', '/cart');
    expect(cart).toHaveTextContent('3');
    expect(
      screen.getAllByRole('link', { name: 'Cart, 3 packs', hidden: true }),
    ).toHaveLength(2);
  });

  it('says one pack as one', async () => {
    openAs(true, 1);
    expect(
      await screen.findAllByRole('link', {
        name: 'Cart, 1 pack',
        hidden: true,
      }),
    ).toHaveLength(2);
  });

  it('shows no number while it is empty, or the API can’t say', async () => {
    for (const packs of [0, null]) {
      openAs(true, packs);
      const bar = await screen.findByRole('navigation', { name: 'Main' });
      expect(within(bar).getByRole('link', { name: 'Cart' })).toHaveTextContent(
        /^Cart$/,
      );
      cleanup();
    }
  });

  it('is not there for a visitor: the cart is for signed-in customers', async () => {
    openAs(false);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(
      screen.queryByRole('link', { name: /^Cart/, hidden: true }),
    ).toBeNull();
  });
});

describe('every page’s frame', () => {
  it('starts with a link to skip to the page, then the menu bar, the page and its foot', () => {
    renderPage({ Component: Page });
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#main');
    expect(document.getElementById('main')).toContainElement(
      screen.getByRole('heading', { name: 'A page' }),
    );
    const bar = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(bar).getByRole('link', { name: 'Herbal Commerce' }),
    ).toHaveAttribute('href', '/');
    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      'Prices include GST.',
    );
  });

  it('leads from its foot to the shop’s five policies, marking the one open', () => {
    renderPage({ path: '/:page', url: '/terms', Component: Page });
    const policies = within(screen.getByRole('contentinfo')).getByRole(
      'navigation',
      { name: 'The shop’s policies' },
    );
    const links = within(policies).getAllByRole('link');
    expect(
      links.map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Privacy policy', '/privacy'],
      ['Terms and conditions', '/terms'],
      ['Refunds and cancellations', '/refunds'],
      ['Shipping and delivery', '/shipping'],
      ['Contact us', '/contact'],
    ]);
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([
      null,
      'page',
      null,
      null,
      null,
    ]);
  });

  it('shows which page you are on, in the bar and the phone menu', () => {
    renderPage({ Component: Page });
    for (const home of screen.getAllByRole('link', {
      name: 'Home',
      hidden: true,
    })) {
      expect(home).toHaveAttribute('aria-current', 'page');
    }
  });

  it('leads to the shop, marked as current there', () => {
    renderPage({ path: '/shop', url: '/shop?q=tulsi', Component: Page });
    const bar = screen.getByRole('navigation', { name: 'Main' });
    const shop = within(bar).getByRole('link', { name: 'Shop' });
    expect(shop).toHaveAttribute('href', '/shop');
    expect(shop).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByRole('link', { name: 'Home' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('shows no page as current elsewhere', () => {
    renderPage({ path: '/elsewhere', url: '/elsewhere', Component: Page });
    for (const home of screen.getAllByRole('link', {
      name: 'Home',
      hidden: true,
    })) {
      expect(home).not.toHaveAttribute('aria-current');
    }
  });

  it('has the phone menu closed and hidden at first', () => {
    renderPage({ Component: Page });
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).toHaveAttribute('aria-controls', 'menu');
    expect(panel()).not.toBeVisible();
  });
});

describe('the phone menu', () => {
  it('opens over the page, which can’t be reached until it closes', async () => {
    renderPage({ Component: Page });
    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(panel()).toBeVisible();
    expect(panel()).toHaveAttribute('data-open');
    expect(
      within(panel()).getByRole('navigation', { name: 'Main, on a phone' }),
    ).toBeInTheDocument();
    expect(document.getElementById('main')).toHaveAttribute('inert');
    expect(screen.getByRole('contentinfo', { hidden: true })).toHaveAttribute(
      'inert',
    );
    expect(screen.getByText('Skip to content')).toHaveAttribute('inert');
  });

  it('brings its parts in one after another, all within 400 ms', async () => {
    renderPage({ Component: Page });
    await userEvent.click(toggle());
    const delays = [
      ...panel().querySelectorAll<HTMLElement>('[data-menu-item]'),
    ].map((item) => item.style.transitionDelay);
    expect(delays[0]).toBe('0s');
    expect(delays.at(-1)).not.toBe('0s');
    expect(
      Math.max(...delays.map((delay) => Number.parseFloat(delay))),
    ).toBeLessThanOrEqual(0.4);
  });

  it('closes with its button, fades, then hides, and the page can be reached again', async () => {
    renderPage({ Component: Page });
    await userEvent.click(toggle());
    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).not.toHaveAttribute('data-open');
    expect(document.getElementById('main')).not.toHaveAttribute('inert');
    // Still there while it fades (300 ms), then gone.
    expect(panel()).toBeVisible();
    await waitFor(() => expect(panel()).not.toBeVisible());
  });

  it('closes with Escape, and the keyboard goes back to its button', async () => {
    renderPage({ Component: Page });
    await userEvent.click(toggle());
    // The keyboard is in the menu, on its theme switch.
    within(panel()).getByRole('radio', { name: 'Auto' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).toHaveFocus();
  });

  it('closes when one of its links is followed', async () => {
    renderPage({ Component: Page });
    await userEvent.click(toggle());
    await userEvent.click(within(panel()).getByRole('link', { name: 'Home' }));
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes if the window grows wide, where there is no phone menu', async () => {
    renderPage({ Component: Page });
    await userEvent.click(toggle());
    act(() => {
      mediaMatches.set('(min-width: 64rem)', true);
      for (const listener of mediaListeners.get('(min-width: 64rem)') ?? []) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides at once when the device asks for less motion', async () => {
    mediaMatches.set('(prefers-reduced-motion: reduce)', true);
    renderPage({ Component: Page });
    await userEvent.click(toggle());
    await userEvent.click(toggle());
    // Far sooner than the 300 ms fade.
    await waitFor(() => expect(panel()).not.toBeVisible(), { timeout: 100 });
  });

  it('holds the theme switch too', async () => {
    renderPage({ Component: Page });
    await userEvent.click(toggle());
    expect(
      within(panel()).getByRole('group', { name: 'Theme' }),
    ).toBeInTheDocument();
  });
});

// Every way on from the first page waits until arrive() is called.
function openHeld() {
  let arrive = () => {};
  const held = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const waitForIt = async () => {
    await held;
    return null;
  };
  const Stub = createRoutesStub([
    {
      id: 'root',
      path: '/',
      loader: () => ({ signedIn: false }),
      Component: Frame,
      children: [
        {
          index: true,
          loader: ({ request }) =>
            new URL(request.url).search ? waitForIt() : null,
          Component: FirstPage,
        },
        {
          path: 'next',
          loader: waitForIt,
          action: () => null,
          Component: NextPage,
        },
      ],
    },
  ]);
  render(<Stub initialEntries={['/']} />);
  return async () => {
    await act(async () => {
      arrive();
      await held;
    });
  };
}

const going = () => screen.getByTestId('going');

describe('going to the next page', () => {
  it('shows a thin bar, read out as loading the page, until the page arrives', async () => {
    const arrive = openHeld();
    await userEvent.click(
      await screen.findByRole('link', { name: 'The next page' }),
    );
    expect(
      await screen.findByRole('progressbar', { name: 'Loading the page' }),
    ).toBeInTheDocument();
    await arrive();
    expect(
      await screen.findByRole('heading', { name: 'The next page' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows nothing while a page simply sits open', async () => {
    openAs(false);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows nothing when the same page changes, which shows its own wait', async () => {
    const arrive = openHeld();
    await userEvent.click(
      await screen.findByRole('link', { name: 'The same page again' }),
    );
    await waitFor(() => expect(going()).toHaveTextContent('loading'));
    expect(screen.queryByRole('progressbar')).toBeNull();
    await arrive();
  });

  it('shows nothing after a form is sent, whose button shows the wait', async () => {
    const arrive = openHeld();
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
    await waitFor(() => expect(going()).toHaveTextContent('loading'));
    expect(screen.queryByRole('progressbar')).toBeNull();
    await arrive();
  });
});
