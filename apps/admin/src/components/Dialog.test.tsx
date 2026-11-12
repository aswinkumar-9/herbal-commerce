import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';

function DeleteQuestion({
  locked = false,
  onClose = () => undefined,
}: {
  locked?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose();
    setOpen(false);
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>Delete Hair Care</Button>
      <Dialog
        open={open}
        onClose={close}
        tone="danger"
        locked={locked}
        title="Delete Hair Care?"
        actions={
          <>
            <Button onClick={close}>Keep it</Button>
            <Button variant="danger">Delete for good</Button>
          </>
        }
      >
        <p>Customers no longer see it.</p>
        <label>
          Type its name
          <input />
        </label>
      </Dialog>
    </>
  );
}

async function openIt(props: Parameters<typeof DeleteQuestion>[0] = {}) {
  const user = userEvent.setup();
  render(<DeleteQuestion {...props} />);
  await user.click(screen.getByRole('button', { name: 'Delete Hair Care' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Delete Hair Care?',
  });
  return { user, dialog };
}

describe('a dialog', () => {
  it('opens as a modal dialog, named by its title and described by its text', async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const { dialog } = await openIt();

    expect(showModal).toHaveBeenCalledOnce();
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAccessibleDescription(
      expect.stringContaining('Customers no longer see it.'),
    );
  });

  it('closes with its own button, and the focus goes back to the button that opened it', async () => {
    const { user } = await openIt();

    await user.click(screen.getByRole('button', { name: 'Keep it' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: 'Delete Hair Care' }),
    ).toHaveFocus();
  });

  it('closes with Escape', async () => {
    const onClose = vi.fn();
    const { dialog } = await openIt({ onClose });

    const escape = new Event('cancel', { cancelable: true });
    fireEvent(dialog, escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('closes with a click on the backdrop', async () => {
    const onClose = vi.fn();
    const { dialog } = await openIt({ onClose });

    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stays open when a drag starts inside and ends on the backdrop', async () => {
    const onClose = vi.fn();
    const { dialog } = await openIt({ onClose });

    fireEvent.pointerDown(screen.getByLabelText('Type its name'));
    fireEvent.click(dialog);
    fireEvent.click(screen.getByText('Customers no longer see it.'));

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute('open');
  });

  it('stays open when a press on the backdrop is followed by a click inside', async () => {
    const onClose = vi.fn();
    const { dialog } = await openIt({ onClose });

    // The press ended outside the window, so no click came of it.
    fireEvent.pointerDown(dialog);
    fireEvent.click(screen.getByText('Customers no longer see it.'));

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute('open');
  });

  it('while locked, stays open on Escape and on the backdrop', async () => {
    const onClose = vi.fn();
    const { dialog } = await openIt({ locked: true, onClose });

    const escape = new Event('cancel', { cancelable: true });
    fireEvent(dialog, escape);
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);

    expect(escape.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute('open');
  });

  // A browser may close it without asking (Escape pressed twice quickly).
  it('when the browser closes it anyway, the page hears of it', async () => {
    const onClose = vi.fn();
    const { dialog } = await openIt({ onClose });

    (dialog as HTMLDialogElement).close();

    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('when the browser closes it while locked, it opens again', async () => {
    const onClose = vi.fn();
    const { dialog } = await openIt({ locked: true, onClose });

    (dialog as HTMLDialogElement).close();

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute('open');
  });
});
