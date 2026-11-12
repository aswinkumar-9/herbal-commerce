import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Broken(): never {
  throw new Error('staff-1 has no row 42 in "orders"');
}

describe('a page that breaks', () => {
  it('shows a calm message, and nothing of what went wrong', () => {
    // React reports the error to the browser's console, as it should.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );

    expect(
      screen.getByRole('heading', { name: 'Something went wrong' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reload the page' }),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('orders');
  });
});
