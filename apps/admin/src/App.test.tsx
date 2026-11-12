import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it("shows the console's name", () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Herbal Commerce' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Admin console')).toBeInTheDocument();
  });
});
