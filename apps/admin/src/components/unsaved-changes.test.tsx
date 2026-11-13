import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import {
  Link,
  Navigate,
  Outlet,
  RouterProvider,
  createMemoryRouter,
  useNavigate,
} from 'react-router';
import { describe, expect, it } from 'vitest';
import { useUnsavedChanges } from './unsaved-changes';

let endSession: () => void = () => undefined;

// Like RequireSession: when the session ends, the page closes and staff go
// to the sign-in page.
function Session() {
  const [signedIn, setSignedIn] = useState(true);
  useEffect(() => {
    endSession = () => setSignedIn(false);
  }, []);
  return signedIn ? <Outlet /> : <Navigate to="/sign-in" replace />;
}

function EditPage() {
  const [name, setName] = useState('Hair Care');
  const [saved, setSaved] = useState('Hair Care');
  const navigate = useNavigate();
  const { prompt, allowLeaving } = useUnsavedChanges(name !== saved);
  return (
    <>
      <h1>Edit Hair Care</h1>
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button
        type="button"
        onClick={() => {
          setSaved(name);
          allowLeaving();
          navigate('/catalog');
        }}
      >
        Save and close
      </button>
      <Link to="/catalog">Catalog</Link>
      <Link to="/catalog/hair-care?section=tax">Tax section</Link>
      {prompt}
    </>
  );
}

function openEditor() {
  const router = createMemoryRouter(
    [
      {
        element: <Session />,
        children: [
          { path: '/catalog', element: <h1>Catalog</h1> },
          { path: '/catalog/hair-care', element: <EditPage /> },
        ],
      },
      { path: '/sign-in', element: <h1>Sign in</h1> },
    ],
    { initialEntries: ['/catalog', '/catalog/hair-care'] },
  );
  render(<RouterProvider router={router} />);
  return { user: userEvent.setup(), router };
}

async function change(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), ' and Scalp');
}

describe('a page with changes not saved', () => {
  it('lets staff leave freely while nothing changed', async () => {
    const { user } = openEditor();

    await user.click(screen.getByRole('link', { name: 'Catalog' }));

    expect(
      await screen.findByRole('heading', { name: 'Catalog' }),
    ).toBeInTheDocument();
  });

  it('asks before staff follow a link, and stays when they keep editing', async () => {
    const { user } = openEditor();
    await change(user);

    await user.click(screen.getByRole('link', { name: 'Catalog' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Leave without saving?',
    });
    expect(dialog).toHaveAccessibleDescription(
      'Your changes on this page are not saved yet. If you leave, they are lost.',
    );

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Hair Care and Scalp');
  });

  it('leaves when staff choose to, changes lost', async () => {
    const { user } = openEditor();
    await change(user);

    await user.click(screen.getByRole('link', { name: 'Catalog' }));
    await user.click(
      await screen.findByRole('button', { name: 'Leave without saving' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Catalog' }),
    ).toBeInTheDocument();
  });

  it('asks on the back button too', async () => {
    const { user, router } = openEditor();
    await change(user);

    await act(() => router.navigate(-1));

    expect(
      await screen.findByRole('dialog', { name: 'Leave without saving?' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/catalog/hair-care');
  });

  it('stays out of the way within the same page', async () => {
    const { user, router } = openEditor();
    await change(user);

    await user.click(screen.getByRole('link', { name: 'Tax section' }));

    expect(router.state.location.search).toBe('?section=tax');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets a save leave the page at once', async () => {
    const { user } = openEditor();
    await change(user);

    await user.click(screen.getByRole('button', { name: 'Save and close' }));

    expect(
      await screen.findByRole('heading', { name: 'Catalog' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never holds up signing out', async () => {
    const { user } = openEditor();
    await change(user);

    act(() => endSession());

    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks the browser to warn before the tab closes or reloads, only while changed', async () => {
    const { user } = openEditor();
    const leaving = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(leaving()).toBe(false);
    await change(user);
    expect(leaving()).toBe(true);

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Hair Care');
    expect(leaving()).toBe(false);
  });
});
