import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Save } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('a button', () => {
  it('is a plain button unless told otherwise, so it never sends a form by accident', async () => {
    const sent = vi.fn((event: SubmitEvent) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={(event) => sent(event.nativeEvent as SubmitEvent)}>
        <Button>Cancel</Button>
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
    expect(sent).not.toHaveBeenCalled();
  });

  it('does what it says when clicked', async () => {
    const clicked = vi.fn();
    const user = userEvent.setup();
    render(
      <Button variant="primary" icon={Save} onClick={clicked}>
        Save
      </Button>,
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(clicked).toHaveBeenCalledOnce();
  });

  describe('while its request is on the way', () => {
    it('says so, ignores clicks, and keeps the focus', async () => {
      const clicked = vi.fn();
      const user = userEvent.setup();
      render(
        <Button busy busyLabel="Saving…" onClick={clicked}>
          Save
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Saving…' });

      button.focus();
      await user.click(button);
      await user.keyboard('{Enter}');

      expect(clicked).not.toHaveBeenCalled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toBeDisabled();
      expect(button).toHaveFocus();
    });

    it('does not send its form a second time, by click or by Enter', async () => {
      const sent = vi.fn();
      const user = userEvent.setup();
      render(
        <form
          onSubmit={(event) => {
            event.preventDefault();
            sent();
          }}
        >
          <label>
            Name
            <input defaultValue="Hair Care" />
          </label>
          <Button type="submit" busy>
            Save
          </Button>
        </form>,
      );

      await user.click(screen.getByRole('button', { name: 'Save' }));
      await user.type(screen.getByLabelText('Name'), '{Enter}');

      expect(sent).not.toHaveBeenCalled();
    });
  });
});
