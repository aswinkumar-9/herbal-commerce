import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSavedOrder } from './use-saved-order';

const A = { id: 'a' };
const B = { id: 'b' };
const C = { id: 'c' };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// The hook over a list the test can change, as the cache would.
function setup(send: (ids: string[]) => Promise<{ id: string }[]>) {
  const onSaved = vi.fn();
  const onFailed = vi.fn();
  const hook = renderHook(
    ({ items }) => useSavedOrder({ items, send, onSaved, onFailed }),
    { initialProps: { items: [A, B, C] } },
  );
  return { ...hook, onSaved, onFailed };
}

describe('the order on screen', () => {
  it('follows a drag without sending anything', () => {
    const send = vi.fn();
    const { result } = setup(send);

    act(() => result.current.arrange(['b', 'a', 'c']));
    act(() => result.current.arrange(['b', 'c', 'a']));

    expect(result.current.ids).toEqual(['b', 'c', 'a']);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing for a row dropped where it started', () => {
    const send = vi.fn();
    const { result } = setup(send);

    act(() => result.current.arrange(['b', 'a', 'c']));
    act(() => result.current.save(['a', 'b', 'c']));

    expect(send).not.toHaveBeenCalled();
    expect(result.current.ids).toEqual(['a', 'b', 'c']);
    expect(result.current.saving).toBe(false);
  });

  it('follows the server again once the order is saved', async () => {
    const answer = deferred<{ id: string }[]>();
    const { result, rerender, onSaved } = setup(() => answer.promise);

    act(() => result.current.save(['c', 'a', 'b']));
    expect(result.current.saving).toBe(true);

    await act(async () => answer.resolve([C, A, B]));
    rerender({ items: [C, A, B] });

    expect(onSaved).toHaveBeenCalledWith([C, A, B]);
    expect(result.current.saving).toBe(false);
    // A later change from the server shows.
    rerender({ items: [B, C, A] });
    expect(result.current.ids).toEqual(['b', 'c', 'a']);
  });

  it('keeps a drag that started while saving', async () => {
    const answer = deferred<{ id: string }[]>();
    const { result, rerender } = setup(() => answer.promise);

    act(() => result.current.save(['b', 'a', 'c']));
    act(() => result.current.arrange(['b', 'c', 'a']));
    await act(async () => answer.resolve([B, A, C]));
    rerender({ items: [B, A, C] });

    expect(result.current.ids).toEqual(['b', 'c', 'a']);
  });

  it('puts the server’s order back when saving fails, and drops what waited', async () => {
    const answer = deferred<{ id: string }[]>();
    const send = vi.fn(() => answer.promise);
    const { result, onFailed } = setup(send);
    const refused = new Error('refused');

    act(() => result.current.save(['b', 'a', 'c']));
    act(() => result.current.save(['b', 'c', 'a']));
    await act(async () => answer.reject(refused));

    expect(onFailed).toHaveBeenCalledWith(refused);
    expect(result.current.ids).toEqual(['a', 'b', 'c']);
    expect(result.current.saving).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not send what waited when the saved order already matches it', async () => {
    const answer = deferred<{ id: string }[]>();
    const send = vi.fn(() => answer.promise);
    const { result } = setup(send);

    act(() => result.current.save(['b', 'a', 'c']));
    act(() => result.current.save(['b', 'c', 'a']));
    act(() => result.current.save(['b', 'a', 'c']));
    await act(async () => answer.resolve([B, A, C]));

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.saving).toBe(false);
  });
});
