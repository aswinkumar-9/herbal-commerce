import { THEME_KEY } from '@herbal/design';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ThemeSwitch } from './ThemeSwitch.tsx';

const theme = () => document.documentElement.dataset['theme'];

function renderBoth() {
  render(
    <>
      <div data-testid="bar">
        <ThemeSwitch name="theme-bar" place="bar" />
      </div>
      <div data-testid="menu">
        <ThemeSwitch name="theme-menu" place="menu" />
      </div>
    </>,
  );
  const bar = within(screen.getByTestId('bar')).getByRole('group', {
    name: 'Theme',
  });
  const menu = within(screen.getByTestId('menu')).getByRole('group', {
    name: 'Theme',
  });
  return { bar, menu };
}

describe('the theme switch', () => {
  it('offers Auto, Light and Dark, and follows the device until one is chosen', () => {
    const { bar } = renderBoth();
    const choices = within(bar).getAllByRole('radio');
    expect(choices.map((choice) => choice.getAttribute('value'))).toEqual([
      'system',
      'light',
      'dark',
    ]);
    expect(within(bar).getByRole('radio', { name: 'Auto' })).toBeChecked();
    expect(theme()).toBeUndefined();
  });

  it('shows the chosen theme at once, keeps it on this device, and every switch agrees', async () => {
    const { bar, menu } = renderBoth();
    await userEvent.click(within(bar).getByRole('radio', { name: 'Dark' }));
    expect(theme()).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(within(menu).getByRole('radio', { name: 'Dark' })).toBeChecked();

    await userEvent.click(within(menu).getByRole('radio', { name: 'Light' }));
    expect(theme()).toBe('light');
    expect(within(bar).getByRole('radio', { name: 'Light' })).toBeChecked();
  });

  it('goes back to the device’s setting with Auto, keeping nothing', async () => {
    localStorage.setItem(THEME_KEY, 'dark');
    const { bar } = renderBoth();
    expect(within(bar).getByRole('radio', { name: 'Dark' })).toBeChecked();
    await userEvent.click(within(bar).getByRole('radio', { name: 'Auto' }));
    expect(theme()).toBeUndefined();
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('follows a choice made in another tab', () => {
    const { bar } = renderBoth();
    localStorage.setItem(THEME_KEY, 'light');
    act(() => {
      dispatchEvent(
        new StorageEvent('storage', { key: THEME_KEY, newValue: 'light' }),
      );
    });
    expect(theme()).toBe('light');
    expect(within(bar).getByRole('radio', { name: 'Light' })).toBeChecked();
  });

  it('still shows the choice where the browser keeps nothing', async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    try {
      const { bar } = renderBoth();
      await userEvent.click(within(bar).getByRole('radio', { name: 'Dark' }));
      expect(theme()).toBe('dark');
      expect(within(bar).getByRole('radio', { name: 'Dark' })).toBeChecked();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('can be used with the keyboard', async () => {
    const { bar } = renderBoth();
    within(bar).getByRole('radio', { name: 'Auto' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(theme()).toBe('light');
  });
});
