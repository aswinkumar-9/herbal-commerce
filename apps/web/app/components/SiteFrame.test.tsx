import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const toggle = () => screen.getByRole('button', { name: 'Menu' });
const panel = () => document.getElementById('menu') as HTMLElement;

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
