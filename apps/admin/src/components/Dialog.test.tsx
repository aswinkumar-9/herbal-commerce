import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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
        description={<p>Customers no longer see it.</p>}
      >
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

  it('gives the focus to its first field', async () => {
    await openIt();

    expect(screen.getByLabelText('Type its name')).toHaveFocus();
  });

  it('gives the focus to the safe button, not a list that scrolls', async () => {
    // As Chrome does: a list that scrolls can take the focus first.
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(
      function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
        const list = this.querySelector('ul');
        if (list) {
          list.tabIndex = 0;
          list.focus();
        }
      },
    );
    function Question() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Mark 8 packed</Button>
          <Dialog
            open={open}
            onClose={() => setOpen(false)}
            title="Mark 8 orders packed?"
            actions={
              <>
                <Button onClick={() => setOpen(false)}>Not yet</Button>
                <Button variant="primary">Mark 8 packed</Button>
              </>
            }
          >
            <ul aria-label="Chosen orders">
              <li>7KQ2M9XDPA</li>
            </ul>
          </Dialog>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Question />);

    await user.click(screen.getByRole('button', { name: 'Mark 8 packed' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: 'Not yet' }),
    ).toHaveFocus();
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

  it('gives the focus to the main area when what opened it is gone', async () => {
    function Gone() {
      const [open, setOpen] = useState(false);
      const [packed, setPacked] = useState(false);
      return (
        <main id="main" tabIndex={-1}>
          {packed ? null : (
            <Button onClick={() => setOpen(true)}>Mark 2 packed</Button>
          )}
          <Dialog
            open={open}
            onClose={() => setOpen(false)}
            title="Mark 2 orders packed?"
            actions={
              <Button
                onClick={() => {
                  setPacked(true);
                  setOpen(false);
                }}
              >
                Mark 2 packed
              </Button>
            }
          />
        </main>
      );
    }
    const user = userEvent.setup();
    render(<Gone />);
    await user.click(screen.getByRole('button', { name: 'Mark 2 packed' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(
      within(dialog).getByRole('button', { name: 'Mark 2 packed' }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('gives the focus to the main area when what opened it goes a moment after, as a row fading away', async () => {
    function Fading() {
      const [open, setOpen] = useState(false);
      const [removed, setRemoved] = useState(false);
      const [told, setTold] = useState(false);
      return (
        <main id="main" tabIndex={-1}>
          {removed ? null : (
            <Button onClick={() => setOpen(true)}>Remove Dev Patel</Button>
          )}
          {told ? <p>Dev Patel removed</p> : null}
          <Dialog
            open={open}
            onClose={() => setOpen(false)}
            title="Remove Dev Patel?"
            actions={
              <Button
                onClick={() => {
                  setOpen(false);
                  // The row still shows while it fades, and the page
                  // changes elsewhere meanwhile, as a note appears.
                  setTimeout(() => setTold(true), 10);
                  setTimeout(() => setRemoved(true), 60);
                }}
              >
                Remove Dev Patel
              </Button>
            }
          />
        </main>
      );
    }
    const user = userEvent.setup();
    render(<Fading />);
    await user.click(screen.getByRole('button', { name: 'Remove Dev Patel' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(
      within(dialog).getByRole('button', { name: 'Remove Dev Patel' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: 'Remove Dev Patel' }),
    ).toHaveFocus();

    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
  });

  it('leaves the focus alone when it moved on before what opened it went', async () => {
    function Elsewhere() {
      const [open, setOpen] = useState(false);
      const [removed, setRemoved] = useState(false);
      return (
        <main id="main" tabIndex={-1}>
          {removed ? null : (
            <Button onClick={() => setOpen(true)}>Remove Dev Patel</Button>
          )}
          <Button onClick={() => setRemoved(true)}>Invite an Admin</Button>
          <Dialog
            open={open}
            onClose={() => setOpen(false)}
            title="Remove Dev Patel?"
            actions={<Button onClick={() => setOpen(false)}>Keep them</Button>}
          />
        </main>
      );
    }
    const user = userEvent.setup();
    render(<Elsewhere />);
    await user.click(screen.getByRole('button', { name: 'Remove Dev Patel' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Keep them',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Invite an Admin' }));

    expect(
      screen.queryByRole('button', { name: 'Remove Dev Patel' }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Invite an Admin' }),
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
