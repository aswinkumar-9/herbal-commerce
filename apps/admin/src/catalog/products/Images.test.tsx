import {
  act,
  createEvent,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ALL_PRODUCTS,
  BACK,
  CATEGORIES,
  FRONT,
  HAIR,
  IMAGES,
  OIL,
  PRODUCT,
  SHAMPOO,
  SIDE,
  SKIN,
  VARIANTS,
  categoriesOf,
  fieldsRefused,
  imagesOf,
  productsOf,
  variantsOf,
} from '../../test/catalog-fixtures';
import { heldBack, openSignedIn } from '../../test/console';
import { json } from '../../test/fake-api';
import { catalogKeys } from '../catalog-queries';

const ALL = [FRONT, SIDE, BACK];
const UPLOAD = (product: { id: string }) =>
  `POST /v1/staff/products/${product.id}/images`;
const ORDER = `PUT /v1/staff/products/${SHAMPOO.id}/images/order`;
const PATCH = (image: { id: string }) => `PATCH /v1/staff/images/${image.id}`;
const DELETE = (image: { id: string }) => `DELETE /v1/staff/images/${image.id}`;
const LIST_NAME = 'Images, the main photo first';
const UPLOADS = 'Files being added';

// An image the API made from an upload, last in the order.
function made(id: string, position: number, product = SHAMPOO) {
  return {
    ...BACK,
    id,
    productId: product.id,
    position,
    url: `http://127.0.0.1:3000/media/products/${id}-large.webp`,
    thumbnailUrl: `http://127.0.0.1:3000/media/products/${id}-small.webp`,
    createdAt: `2026-11-1${position}T09:00:00.000Z`,
  };
}
const NEW_A = made('2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d', 3);
const NEW_B = made('3b4c5d6e-7f8a-4b9c-8d1e-2f3a4b5c6d7e', 4);

const photo = (name: string, type = 'image/jpeg', size = 4096) =>
  new File([new Uint8Array(size)], name, { type });

async function openImages(
  options: Parameters<typeof openSignedIn>[1] & {
    product?: { id: string; name: string };
  } = {},
) {
  const product = options.product ?? SHAMPOO;
  const console = openSignedIn(`/catalog/products/${product.id}`, {
    ...options,
    answers: {
      [CATEGORIES]: categoriesOf([HAIR, SKIN]),
      [PRODUCT(product)]: () => json(200, product),
      [VARIANTS(product)]: variantsOf([]),
      [IMAGES(product)]: imagesOf(ALL),
      ...options.answers,
    },
  });
  await screen.findByRole('heading', { name: product.name, level: 1 });
  return console;
}

const section = () => screen.getByRole('region', { name: 'Images' });

async function waitForList() {
  return screen.findByRole('list', { name: LIST_NAME });
}

function rows() {
  return within(screen.getByRole('list', { name: LIST_NAME })).getAllByRole(
    'listitem',
  );
}

// Each row's description, or its name when it has none.
function rowNames() {
  return rows().map((row) =>
    within(row)
      .getByRole('button', { name: /^Move / })
      .getAttribute('aria-label')
      ?.replace(/^Move /, ''),
  );
}

function upload(name: string) {
  const found = within(
    screen.getByRole('list', { name: UPLOADS }),
  ).getAllByRole('listitem');
  const row = found.find((item) => item.textContent?.includes(name));
  if (!row) {
    throw new Error(`No upload ${name}`);
  }
  return row;
}

const chooser = () => within(section()).getByLabelText('Choose images');

// The product has a description of its own, on the page under the dialog.
const describeBox = () =>
  within(
    screen.getByRole('dialog', { name: 'Describe the image' }),
  ).getByLabelText('Description');

describe("a product's images", () => {
  it('lists them, the main photo first, with their descriptions and sizes', async () => {
    await openImages();
    await waitForList();

    // Named by their description, else by the order they were added.
    expect(rowNames()).toEqual([
      'The bottle, from the front',
      'Image 1',
      'Image 3',
    ]);
    const [front, side, back] = rows();
    expect(front).toHaveTextContent('The bottle, from the front');
    expect(front).toHaveTextContent('Main photo');
    expect(front).toHaveTextContent('1600 × 1200 pixels');
    expect(side).toHaveTextContent('No description');
    expect(side).toHaveTextContent('Image 1 · 1200 × 1600 pixels');
    expect(side).not.toHaveTextContent('Main photo');
    expect(back).toHaveTextContent('Image 3 · 1600 × 1200 pixels');
    expect(front?.querySelector('img')).toHaveAttribute(
      'src',
      FRONT.thumbnailUrl,
    );
    expect(within(section()).getByText('3 of 6')).toBeInTheDocument();
    expect(within(section()).getByText(/3 more fit\./)).toBeInTheDocument();
  });

  it('invites the first images when there are none', async () => {
    await openImages({
      product: OIL,
      answers: { [IMAGES(OIL)]: imagesOf([]) },
    });

    expect(
      await within(section()).findByText('No images yet'),
    ).toBeInTheDocument();
    expect(within(section()).getByText('0 of 6')).toBeInTheDocument();
    expect(within(section()).getByText(/6 more fit\./)).toBeInTheDocument();
    expect(chooser()).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp',
    );
    expect(
      within(section()).queryByRole('list', { name: LIST_NAME }),
    ).not.toBeInTheDocument();
  });

  it('says when they could not be loaded, and tries again', async () => {
    const { user } = await openImages({
      answers: { [IMAGES(SHAMPOO)]: [() => json(500), imagesOf(ALL)] },
    });

    expect(
      await within(section()).findByText('The images could not be loaded'),
    ).toBeInTheDocument();
    await user.click(within(section()).getByRole('button', { name: /again/ }));

    await waitForList();
    expect(rows()).toHaveLength(3);
  });

  it('is not on a new product’s page until it is added', async () => {
    const { api } = openSignedIn('/catalog/products/new', {
      answers: { [CATEGORIES]: categoriesOf([HAIR, SKIN]) },
    });
    await screen.findByRole('heading', { name: 'New product' });

    expect(
      screen.queryByRole('region', { name: 'Images' }),
    ).not.toBeInTheDocument();
    expect(api.unexpected).toEqual([]);
  });
});

describe('adding images', () => {
  it('sends the chosen files one at a time, in the order chosen, each with its progress', async () => {
    const first = heldBack();
    const second = heldBack();
    const { user, api } = await openImages({
      answers: {
        [UPLOAD(SHAMPOO)]: [first.answer, second.answer],
      },
    });
    await waitForList();

    await user.upload(chooser(), [
      photo('label.jpg'),
      photo('box.png', 'image/png', 3 * 1024 * 1024),
    ]);

    expect(
      await within(upload('label.jpg')).findByText('4 KB · Uploading, 50%'),
    ).toBeInTheDocument();
    expect(
      within(upload('label.jpg')).getByRole('progressbar', {
        name: 'Uploading label.jpg',
      }),
    ).toHaveAttribute('value', '50');
    expect(upload('box.png')).toHaveTextContent('3.0 MB · Waiting');
    expect(screen.getByText('2 images are on their way.')).toBeInTheDocument();
    // The files on their way fill the room.
    expect(within(section()).getByText(/One more fits\./)).toBeInTheDocument();
    const sent = api.to('POST', `/v1/staff/products/${SHAMPOO.id}/images`);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toBeInstanceOf(File);
    expect(sent[0]?.body).toHaveProperty('name', 'label.jpg');
    expect(new Headers(sent[0]?.init.headers).get('Content-Type')).toBe(
      'image/jpeg',
    );

    // All of it sent: the server checks it, which cannot be called off.
    act(() => api.allSent());
    expect(
      await within(upload('label.jpg')).findByText(
        '4 KB · Checking the image…',
      ),
    ).toBeInTheDocument();
    expect(
      within(upload('label.jpg')).getByRole('progressbar'),
    ).not.toHaveAttribute('value');
    expect(
      within(upload('label.jpg')).queryByRole('button', { name: /Cancel/ }),
    ).not.toBeInTheDocument();

    first.release(json(201, NEW_A));
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(rowNames()[3]).toBe('Image 4');
    expect(screen.getByText('label.jpg is added.')).toBeInTheDocument();
    expect(within(section()).getByText('4 of 6')).toBeInTheDocument();

    // Then the next one.
    await waitFor(() =>
      expect(upload('box.png')).toHaveTextContent('Uploading'),
    );
    const both = api.to('POST', `/v1/staff/products/${SHAMPOO.id}/images`);
    expect(both[1]?.body).toHaveProperty('name', 'box.png');
    expect(new Headers(both[1]?.init.headers).get('Content-Type')).toBe(
      'image/png',
    );
    second.release(json(201, NEW_B));
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(
      screen.queryByRole('list', { name: UPLOADS }),
    ).not.toBeInTheDocument();
    expect(within(section()).getByText(/One more fits\./)).toBeInTheDocument();
  });

  it('takes dropped files too, and says why a file cannot be added', async () => {
    const answer = heldBack();
    const { user, api } = await openImages({
      answers: { [UPLOAD(SHAMPOO)]: answer.answer },
    });
    await waitForList();

    fireEvent.drop(within(section()).getByText('Add more images'), {
      dataTransfer: {
        types: ['Files'],
        files: [
          photo('IMG_0042.HEIC', ''),
          photo('empty.png', 'image/png', 0),
          photo('front.webp', 'image/webp'),
        ],
      },
    });

    expect(
      await screen.findByText(
        '1 image is on its way. 2 files cannot be added: the list says why.',
      ),
    ).toBeInTheDocument();
    expect(upload('IMG_0042.HEIC')).toHaveTextContent(
      'HEIC photos cannot be used. Save it as a JPEG first.',
    );
    expect(upload('empty.png')).toHaveTextContent('The file is empty.');
    // A refused file cannot be tried again, only put away.
    expect(
      within(upload('empty.png')).queryByRole('button', { name: /again/ }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(upload('front.webp')).toHaveTextContent('Uploading, 50%'),
    );
    expect(
      api.to('POST', `/v1/staff/products/${SHAMPOO.id}/images`),
    ).toHaveLength(1);

    await user.click(
      screen.getByRole('button', { name: 'Remove IMG_0042.HEIC' }),
    );
    await waitFor(() =>
      expect(screen.queryByText('IMG_0042.HEIC')).not.toBeInTheDocument(),
    );
  });

  it('lights up while files are dragged over it', async () => {
    await openImages();
    await waitForList();
    const zone = within(section()).getByText('Add more images').parentElement;
    if (!zone) {
      throw new Error('No drop zone');
    }

    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } });
    expect(zone).toHaveClass('border-primary');
    fireEvent.dragLeave(zone, { relatedTarget: null });
    expect(zone).not.toHaveClass('border-primary');
    // Text dragged from the page is not a file.
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['text/plain'] } });
    expect(zone).not.toHaveClass('border-primary');
  });

  it('turns away files dropped beside the zone, which would open in place of the console', async () => {
    const { router } = await openImages();
    await waitForList();
    const dragOver = (target: Element, types: string[]) => {
      const dataTransfer = { types, dropEffect: 'copy' };
      const event = createEvent.dragOver(target, { dataTransfer });
      fireEvent(target, event);
      return {
        handled: event.defaultPrevented,
        effect: dataTransfer.dropEffect,
      };
    };
    const beside = within(section()).getByRole('heading', { name: 'Images' });

    expect(dragOver(beside, ['Files'])).toEqual({
      handled: true,
      effect: 'none',
    });
    // The zone takes them.
    expect(
      dragOver(within(section()).getByText('Add more images'), ['Files']),
    ).toEqual({ handled: true, effect: 'copy' });
    // Text is the browser's to handle.
    expect(dragOver(beside, ['text/plain']).handled).toBe(false);

    // Once staff leave the page, the browser's own way comes back.
    await act(() => router.navigate('/'));
    expect(dragOver(document.body, ['Files']).handled).toBe(false);
  });

  it('takes no more than the room left', async () => {
    const five = [FRONT, SIDE, BACK, made(NEW_A.id, 3), made(NEW_B.id, 4)];
    const answer = heldBack();
    const { user } = await openImages({
      answers: {
        [IMAGES(SHAMPOO)]: imagesOf(five),
        [UPLOAD(SHAMPOO)]: answer.answer,
      },
    });
    await waitForList();

    await user.upload(chooser(), [photo('one.jpg'), photo('two.jpg')]);

    expect(upload('two.jpg')).toHaveTextContent(
      'There is no room for it: a product has at most 6 images.',
    );
    expect(
      within(section()).getByText(
        'The files on their way fill the last places: a product has at most 6 images.',
      ),
    ).toBeInTheDocument();
    expect(
      within(section()).queryByLabelText('Choose images'),
    ).not.toBeInTheDocument();

    answer.release(json(201, made('4c5d6e7f-8a9b-4c0d-9e2f-3a4b5c6d7e8f', 5)));
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(
      within(section()).getByText(
        'The product has 6 images, the most it can have. Delete one to add another.',
      ),
    ).toBeInTheDocument();
  });

  it('sends the next file once the one on its way is cancelled, still one at a time', async () => {
    const { user, api } = await openImages({
      answers: {
        [UPLOAD(SHAMPOO)]: [
          heldBack().answer,
          heldBack().answer,
          heldBack().answer,
        ],
      },
    });
    await waitForList();

    await user.upload(chooser(), [
      photo('one.jpg'),
      photo('two.jpg'),
      photo('three.jpg'),
    ]);
    await waitFor(() =>
      expect(upload('one.jpg')).toHaveTextContent('Uploading, 50%'),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel one.jpg' }));
    await waitFor(() =>
      expect(upload('two.jpg')).toHaveTextContent('Uploading, 50%'),
    );

    // The cancelled one's end must not let a third go alongside.
    act(() => api.allSent());
    await waitFor(() =>
      expect(upload('two.jpg')).toHaveTextContent('Checking the image…'),
    );
    expect(upload('three.jpg')).toHaveTextContent('Waiting');
    expect(
      api.to('POST', `/v1/staff/products/${SHAMPOO.id}/images`),
    ).toHaveLength(2);
  });

  it('cancels a file on its way, and one still waiting', async () => {
    const answer = heldBack();
    const { user, api } = await openImages({
      answers: { [UPLOAD(SHAMPOO)]: answer.answer },
    });
    await waitForList();

    await user.upload(chooser(), [photo('one.jpg'), photo('two.jpg')]);
    await waitFor(() =>
      expect(upload('one.jpg')).toHaveTextContent('Uploading, 50%'),
    );

    await user.click(screen.getByRole('button', { name: 'Cancel two.jpg' }));
    await user.click(screen.getByRole('button', { name: 'Cancel one.jpg' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('list', { name: UPLOADS }),
      ).not.toBeInTheDocument(),
    );

    // An answer that comes after all changes nothing.
    answer.release(json(201, NEW_A));
    await act(() => Promise.resolve());
    expect(rows()).toHaveLength(3);
    expect(
      api.to('POST', `/v1/staff/products/${SHAMPOO.id}/images`),
    ).toHaveLength(1);
  });

  it('offers a second try when the server could not take a file, but not when it refused it', async () => {
    const { user } = await openImages({
      answers: {
        [UPLOAD(SHAMPOO)]: [
          () => json(503),
          () =>
            fieldsRefused([
              {
                field: 'image',
                message: 'The image needs at least 400 pixels on each side',
              },
            ]),
          () => json(201, NEW_A),
        ],
      },
    });
    await waitForList();

    await user.upload(chooser(), [photo('label.jpg'), photo('tiny.jpg')]);

    expect(
      await within(upload('tiny.jpg')).findByText(
        '4 KB · The image needs at least 400 pixels on each side',
      ),
    ).toBeInTheDocument();
    expect(upload('label.jpg')).toHaveTextContent(
      'The server had a problem. Try again in a moment.',
    );
    expect(
      screen.queryByRole('button', { name: 'Try tiny.jpg again' }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Try label.jpg again' }),
    );

    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(screen.getByText('label.jpg is added.')).toBeInTheDocument();
    expect(upload('tiny.jpg')).toBeInTheDocument();
  });

  it('asks before staff leave while files are on their way', async () => {
    const answer = heldBack();
    const { user, router } = await openImages({
      answers: { [UPLOAD(SHAMPOO)]: answer.answer },
    });
    await waitForList();
    const leaving = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leaving()).toBe(false);

    await user.upload(chooser(), [photo('label.jpg')]);
    await act(() => router.navigate('/catalog/products'));

    expect(
      await screen.findByRole('dialog', { name: 'Leave without saving?' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      `/catalog/products/${SHAMPOO.id}`,
    );
    expect(leaving()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));

    answer.release(json(201, NEW_A));
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(leaving()).toBe(false);
  });

  it('stops the file on its way when staff leave anyway', async () => {
    const answer = heldBack();
    const { user, router, queryClient } = await openImages({
      answers: {
        [UPLOAD(SHAMPOO)]: answer.answer,
        [ALL_PRODUCTS]: productsOf([SHAMPOO]),
      },
    });
    await waitForList();
    await user.upload(chooser(), [photo('label.jpg')]);

    await act(() => router.navigate('/catalog/products'));
    await user.click(
      await screen.findByRole('button', { name: 'Leave without saving' }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/catalog/products'),
    );

    // Its answer, had it come, would have added it.
    answer.release(json(201, NEW_A));
    await act(() => Promise.resolve());
    expect(
      queryClient.getQueryData<unknown[]>(catalogKeys.images(SHAMPOO.id)),
    ).toHaveLength(3);
  });
});

describe('ordering images with the keyboard', () => {
  it('moves one, says where it went, and the first becomes the main photo', async () => {
    const { user, api } = await openImages({
      answers: {
        [ORDER]: imagesOf([
          { ...SIDE, position: 0 },
          { ...FRONT, position: 1 },
          BACK,
        ]),
      },
    });
    await waitForList();
    const handle = screen.getByRole('button', { name: 'Move Image 1' });
    expect(handle).toHaveAccessibleDescription(
      expect.stringContaining('press Up or Down to move an image one place'),
    );

    handle.focus();
    await user.keyboard('{ArrowUp}');

    expect(rowNames()).toEqual([
      'Image 1',
      'The bottle, from the front',
      'Image 3',
    ]);
    expect(rows()[0]).toHaveTextContent('Main photo');
    expect(rows()[1]).not.toHaveTextContent('Main photo');
    expect(
      screen.getByText('Image 1 moved to position 1 of 3.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Order saved')).toBeInTheDocument();
    expect(api.to('PUT', ORDER.replace('PUT ', ''))[0]?.body).toEqual({
      ids: [SIDE.id, FRONT.id, BACK.id],
    });
    // The saved order stays.
    expect(rowNames()[0]).toBe('Image 1');
  });

  it('goes back to the saved order when the images changed meanwhile', async () => {
    const { user } = await openImages({
      answers: {
        [IMAGES(SHAMPOO)]: [imagesOf(ALL), imagesOf([FRONT, SIDE])],
        [ORDER]: () =>
          json(409, {
            message:
              "The product's images changed while you were ordering them. Reload and try again.",
          }),
      },
    });
    await waitForList();

    screen.getByRole('button', { name: 'Move Image 3' }).focus();
    await user.keyboard('{Home}');

    expect(
      await screen.findByText(
        "The product's images changed while you were ordering them. Reload and try again.",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(rowNames()).toEqual(['The bottle, from the front', 'Image 1']),
    );
  });
});

describe("an image's description", () => {
  it('describes an image for people who cannot see it', async () => {
    const described = {
      ...BACK,
      altText: 'The back label, with the ingredients',
    };
    const { user, api } = await openImages({
      answers: { [PATCH(BACK)]: () => json(200, described) },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Describe Image 3' }));
    const dialog = screen.getByRole('dialog', { name: 'Describe the image' });
    expect(within(dialog).getByLabelText('Description')).toHaveValue('');
    await user.type(
      within(dialog).getByLabelText('Description'),
      '  The back label, with the ingredients ',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Save description' }),
    );

    expect(await screen.findByText('Description saved')).toBeInTheDocument();
    expect(api.to('PATCH', `/v1/staff/images/${BACK.id}`)[0]?.body).toEqual({
      altText: 'The back label, with the ingredients',
    });
    expect(rowNames()).toEqual([
      'The bottle, from the front',
      'Image 1',
      'The back label, with the ingredients',
    ]);
    expect(
      screen.queryByRole('dialog', { name: 'Describe the image' }),
    ).not.toBeInTheDocument();
  });

  it('takes a description away when it is emptied, and sends nothing when it is the same', async () => {
    const { user, api } = await openImages({
      answers: { [PATCH(FRONT)]: () => json(200, { ...FRONT, altText: null }) },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Describe Image 1' }));
    await user.click(screen.getByRole('button', { name: 'Save description' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Describe the image' }),
      ).not.toBeInTheDocument(),
    );
    expect(api.to('PATCH', `/v1/staff/images/${SIDE.id}`)).toEqual([]);

    await user.click(
      screen.getByRole('button', {
        name: 'Describe The bottle, from the front',
      }),
    );
    await user.clear(describeBox());
    await user.click(screen.getByRole('button', { name: 'Save description' }));

    expect(await screen.findByText('Description removed')).toBeInTheDocument();
    expect(api.to('PATCH', `/v1/staff/images/${FRONT.id}`)[0]?.body).toEqual({
      altText: null,
    });
    expect(rowNames()[0]).toBe('Image 2');
  });

  it('marks what the API refused, and says when it failed', async () => {
    const { user } = await openImages({
      answers: {
        [PATCH(SIDE)]: [
          () =>
            fieldsRefused([
              { field: 'altText', message: 'At most 150 characters' },
            ]),
          () => json(503),
        ],
      },
    });
    await waitForList();
    await user.click(screen.getByRole('button', { name: 'Describe Image 1' }));
    const box = describeBox();
    expect(box).toHaveAttribute('maxlength', '150');

    await user.type(box, 'The side');
    await user.click(screen.getByRole('button', { name: 'Save description' }));
    await waitFor(() =>
      expect(box).toHaveAccessibleDescription(
        expect.stringContaining('At most 150 characters'),
      ),
    );
    expect(box).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Save description' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server had a problem. Try again in a moment.',
    );
  });

  it('asks before staff leave with a description half typed', async () => {
    const { user, router } = await openImages();
    await waitForList();
    await user.click(screen.getByRole('button', { name: 'Describe Image 1' }));
    await user.type(describeBox(), 'The side');

    await act(() => router.navigate('/catalog/products'));

    expect(
      await screen.findByRole('dialog', { name: 'Leave without saving?' }),
    ).toBeInTheDocument();
  });
});

describe('deleting an image', () => {
  it('deletes one for good, Admins too, and reads the list again', async () => {
    const reread = heldBack();
    const { user, api } = await openImages({
      answers: {
        [IMAGES(SHAMPOO)]: [imagesOf(ALL), reread.answer],
        [DELETE(BACK)]: () => new Response(null, { status: 204 }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Delete Image 3' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this image?' });
    expect(dialog).toHaveAccessibleDescription(
      'It is removed for good, from the shop too. The audit log keeps a record of it.',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete for good' }),
    );

    expect(await screen.findByText('Image deleted')).toBeInTheDocument();
    expect(api.to('DELETE', `/v1/staff/images/${BACK.id}`)).toHaveLength(1);
    // Gone at once, before the list is read again.
    await waitFor(() =>
      expect(rowNames()).toEqual(['The bottle, from the front', 'Image 1']),
    );

    // Someone else added one meanwhile.
    reread.release(json(200, { images: [FRONT, SIDE, NEW_A] }));
    await waitFor(() => expect(rows()).toHaveLength(3));
  });

  it('says the next one becomes the main photo', async () => {
    const { user } = await openImages();
    await waitForList();

    await user.click(
      screen.getByRole('button', {
        name: 'Delete The bottle, from the front',
      }),
    );

    expect(
      screen.getByRole('dialog', { name: 'Delete this image?' }),
    ).toHaveAccessibleDescription(
      expect.stringContaining('The next image becomes the main photo.'),
    );
  });

  it("keeps a live product's last image", async () => {
    const { user } = await openImages({
      answers: { [IMAGES(SHAMPOO)]: imagesOf([FRONT]) },
    });
    await waitForList();

    await user.click(
      screen.getByRole('button', {
        name: 'Delete The bottle, from the front',
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete this image?' });
    expect(dialog).toHaveTextContent(
      'A live product needs at least one image. Add another first, or take the product offline.',
    );
    expect(dialog).not.toHaveAccessibleDescription(
      expect.stringContaining('main photo'),
    );
    expect(
      within(dialog).queryByRole('button', { name: 'Delete for good' }),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  });

  it('lets a draft lose its last image', async () => {
    const only = { ...FRONT, productId: OIL.id };
    const { user } = await openImages({
      product: OIL,
      answers: {
        [IMAGES(OIL)]: [imagesOf([only]), imagesOf([])],
        [DELETE(only)]: () => new Response(null, { status: 204 }),
      },
    });
    await waitForList();

    await user.click(
      screen.getByRole('button', {
        name: 'Delete The bottle, from the front',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Delete for good' }));

    expect(
      await within(section()).findByText('No images yet'),
    ).toBeInTheDocument();
  });

  it('shows why the API would not delete it', async () => {
    const { user } = await openImages({
      answers: {
        [DELETE(BACK)]: () =>
          json(409, {
            message:
              'A live product needs at least one image. Add another first, or take the product offline.',
          }),
      },
    });
    await waitForList();

    await user.click(screen.getByRole('button', { name: 'Delete Image 3' }));
    await user.click(screen.getByRole('button', { name: 'Delete for good' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A live product needs at least one image. Add another first, or take the product offline.',
    );
    expect(rows()).toHaveLength(3);
  });
});
