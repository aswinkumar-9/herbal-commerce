import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { heldBack, openSignedIn } from '../test/console';
import { RAVI, json } from '../test/fake-api';
import {
  DISCARD,
  DRAFT_TEXT,
  LIVE_TEXT,
  MEERA_REF,
  NEVER_WRITTEN,
  POLICIES,
  POLICY,
  PUBLISH,
  RAVI_REF,
  SAVE,
  SAVED_AT,
  V1,
  V2,
  VERSION,
  VERSIONS,
  answer,
  detailOf,
  summariesOf,
} from '../test/policy-fixtures';

type Answers = NonNullable<Parameters<typeof openSignedIn>[1]>['answers'];

function openPolicy(answers: Answers = {}, page = 'privacy') {
  return openSignedIn(`/policies/${page}`, {
    staff: RAVI,
    answers: {
      [POLICY('privacy')]: answer(detailOf()),
      [VERSIONS('privacy')]: answer({ versions: [V2, V1], nextBefore: null }),
      [POLICIES]: summariesOf({}),
      ...answers,
    },
  });
}

const box = () => screen.findByRole('textbox', { name: 'The page’s text' });
const preview = () => screen.getByRole('region', { name: 'Preview' });
const button = (name: string) => screen.getByRole('button', { name });
const dialog = () => screen.getByRole('dialog');
const inDialog = (name: string) =>
  within(dialog()).getByRole('button', { name });

describe('a policy page in the console', () => {
  it('opens with its draft in the box, shown beside it as customers will see it', async () => {
    openPolicy();

    expect(
      await screen.findByRole('heading', { name: 'Privacy policy', level: 1 }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.title).toBe('Privacy policy · Herbal Commerce Admin'),
    );
    expect(await box()).toHaveValue(DRAFT_TEXT);
    expect(
      screen.getByText(
        'On the website: Version 2, published 21 Nov 2026 at 15:35 by Ravi Kumar.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Draft saved 21 Nov 2026 at 17:00 by Ravi Kumar. Not published yet.',
      ),
    ).toBeInTheDocument();

    const shown = preview();
    expect(
      within(shown)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Who we are', 'What we keep']);
    expect(
      within(shown).getByText('We grow and sell herbs.'),
    ).toBeInTheDocument();
    expect(
      within(within(shown).getByRole('list'))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Your name', 'Your address']);

    // Nothing changed yet: only publishing or discarding the draft.
    expect(button('Save draft')).toBeDisabled();
    expect(button('Publish')).toBeEnabled();
    expect(button('Discard draft')).toBeEnabled();
    expect(
      screen.getByText(`${DRAFT_TEXT.length} of 30,000 characters`),
    ).toBeInTheDocument();
  });

  it('starts from the text on the website when there is no draft, and empty when never written', async () => {
    openPolicy({
      [POLICY('privacy')]: answer(detailOf({ draft: null })),
    });
    expect(await box()).toHaveValue(LIVE_TEXT);
    expect(
      screen.queryByRole('button', { name: 'Publish' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Discard draft' }),
    ).not.toBeInTheDocument();
  });

  it('says when a page was never written, with an empty preview', async () => {
    openPolicy(
      {
        [POLICY('contact')]: answer(NEVER_WRITTEN('contact')),
        [VERSIONS('contact')]: answer({ versions: [], nextBefore: null }),
      },
      'contact',
    );

    expect(await box()).toHaveValue('');
    expect(
      screen.getByText(
        'Not on the website yet: customers see a note that it is being written.',
      ),
    ).toBeInTheDocument();
    expect(
      within(preview()).getByText(
        'Nothing to show yet: write the page in the box.',
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        'None yet: the first appears here once you publish.',
      ),
    ).toBeInTheDocument();
    expect(button('Save draft')).toBeDisabled();
  });

  it('shows what is typed at once, and saves it as the draft on its revision', async () => {
    const saved = '## Who we are\n\nA new line.';
    const { user, api } = openPolicy({
      [SAVE('privacy')]: answer(
        detailOf({
          revision: 5,
          draft: { body: saved, updatedAt: SAVED_AT, updatedBy: RAVI_REF },
        }),
      ),
    });

    await user.clear(await box());
    await user.type(
      await box(),
      '## Who we are{Enter}{Enter}A new line.{Enter}{Enter}',
    );
    await waitFor(() =>
      expect(within(preview()).getByText('A new line.')).toBeInTheDocument(),
    );
    // A changed text is saved before it is published.
    expect(button('Publish')).toBeDisabled();
    expect(
      screen.getByText(
        'Save the draft first: Publish puts the saved draft on the website.',
      ),
    ).toBeInTheDocument();

    await user.click(button('Save draft'));

    expect(await screen.findByText('Draft saved')).toBeInTheDocument();
    // Cleaned as the API keeps it, on the revision the box was written on.
    expect(api.to('PUT', '/v1/staff/policies/privacy/draft')[0]?.body).toEqual({
      body: saved,
      revision: 4,
    });
    await waitFor(() => expect(button('Publish')).toBeEnabled());
    expect(button('Save draft')).toBeDisabled();
  });

  it('publishes the saved draft after asking, then shows it as the newest version', async () => {
    const published = detailOf({
      revision: 5,
      draft: null,
      published: {
        version: 3,
        publishedAt: SAVED_AT,
        publishedBy: RAVI_REF,
        body: DRAFT_TEXT,
      },
    });
    const v3 = { version: 3, publishedAt: SAVED_AT, publishedBy: RAVI_REF };
    const { user, api } = openPolicy({
      [PUBLISH('privacy')]: answer(published),
      [VERSIONS('privacy')]: [
        answer({ versions: [V2, V1], nextBefore: null }),
        answer({ versions: [v3, V2, V1], nextBefore: null }),
      ],
    });

    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    expect(dialog()).toHaveTextContent('Publish the privacy policy?');
    expect(dialog()).toHaveTextContent(
      'Customers see the saved draft at once, as version 3.',
    );
    expect(dialog()).toHaveTextContent(
      'Version 2, on the website now, stays in the list of versions.',
    );
    await user.click(inDialog('Publish version 3'));

    expect(
      await screen.findByText('Privacy policy published as version 3'),
    ).toBeInTheDocument();
    expect(
      api.to('POST', '/v1/staff/policies/privacy/publish')[0]?.body,
    ).toEqual({
      revision: 4,
    });
    expect(
      screen.getByText(
        'On the website: Version 3, published 21 Nov 2026 at 17:00 by Ravi Kumar.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Publish' }),
    ).not.toBeInTheDocument();
    const versions = within(
      await screen.findByRole('list', { name: 'Versions' }),
    );
    await waitFor(() =>
      expect(versions.getAllByRole('listitem')).toHaveLength(3),
    );
  });

  it('can be talked out of publishing, and sends nothing', async () => {
    const { user, api } = openPolicy();

    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    await user.click(inDialog('Not now'));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(api.to('POST', '/v1/staff/policies/privacy/publish')).toHaveLength(
      0,
    );
  });

  it('discards the draft after asking, and the box goes back to the text on the website', async () => {
    const { user, api } = openPolicy({
      [DISCARD('privacy', 4)]: answer(detailOf({ revision: 5, draft: null })),
    });

    await user.click(
      await screen.findByRole('button', { name: 'Discard draft' }),
    );
    expect(dialog()).toHaveTextContent(
      'The draft is lost, and the box goes back to version 2, the text on the website.',
    );
    await user.click(inDialog('Discard draft'));

    expect(await screen.findByText('Draft discarded')).toBeInTheDocument();
    expect(
      api.to('DELETE', '/v1/staff/policies/privacy/draft?revision=4'),
    ).toHaveLength(1);
    expect(await box()).toHaveValue(LIVE_TEXT);
  });

  it('undoes changes not saved yet, back to the saved draft', async () => {
    const { user } = openPolicy();

    await user.type(await box(), ' More words.');
    await user.click(button('Undo my changes'));

    expect(await box()).toHaveValue(DRAFT_TEXT);
    expect(button('Save draft')).toBeDisabled();
  });

  it('keeps the words of someone writing when the page changed elsewhere, and replaces them only when asked', async () => {
    const theirs = detailOf({
      revision: 6,
      draft: {
        body: 'Meera’s words',
        updatedAt: SAVED_AT,
        updatedBy: MEERA_REF,
      },
    });
    const { user } = openPolicy({
      [POLICY('privacy')]: [answer(detailOf()), answer(theirs)],
      [SAVE('privacy')]: () =>
        json(409, {
          message:
            'This page was saved, published or discarded since you opened it. Open it again to see the newest text.',
        }),
    });

    await user.type(await box(), ' Mine.');
    await user.click(button('Save draft'));

    expect(
      await screen.findByText(
        'This page was saved, published or discarded since you opened it. Open it again to see the newest text.',
      ),
    ).toBeInTheDocument();
    // The page is read again: its newer revision is noticed, the words stay.
    expect(
      await screen.findByText(
        /This page was changed elsewhere since you started writing/,
      ),
    ).toBeInTheDocument();
    expect(await box()).toHaveValue(`${DRAFT_TEXT} Mine.`);

    await user.click(button('Load the newest text'));
    expect(dialog()).toHaveTextContent('Replace your words?');
    await user.click(inDialog('Keep my words'));
    expect(await box()).toHaveValue(`${DRAFT_TEXT} Mine.`);

    await user.click(button('Load the newest text'));
    await user.click(inDialog('Replace my words'));
    expect(await box()).toHaveValue('Meera’s words');
    await waitFor(() =>
      expect(
        screen.queryByText(/This page was changed elsewhere/),
      ).not.toBeInTheDocument(),
    );
  });

  it('saves on the revision the words were written on, so a change made elsewhere is never overwritten', async () => {
    const theirs = detailOf({
      revision: 6,
      draft: {
        body: 'Meera’s words',
        updatedAt: SAVED_AT,
        updatedBy: MEERA_REF,
      },
    });
    const { user, api, queryClient } = openPolicy({
      [POLICY('privacy')]: [answer(detailOf()), answer(theirs)],
      [SAVE('privacy')]: () =>
        json(409, { message: 'This page was saved elsewhere.' }),
    });

    await user.type(await box(), ' Mine.');
    // Meera saves meanwhile, and the console reads the page again.
    await queryClient.invalidateQueries({
      queryKey: ['policies', 'page', 'privacy'],
    });
    expect(
      await screen.findByText(/This page was changed elsewhere/),
    ).toBeInTheDocument();
    await user.click(button('Save draft'));

    expect(
      await screen.findByText('This page was saved elsewhere.'),
    ).toBeInTheDocument();
    expect(api.to('PUT', '/v1/staff/policies/privacy/draft')[0]?.body).toEqual({
      body: `${DRAFT_TEXT} Mine.`,
      revision: 4,
    });
    // Nor can the older draft be published over hers.
    expect(button('Publish')).toBeDisabled();
  });

  it('saves nothing from an empty box', async () => {
    const { user } = openPolicy();

    await user.clear(await box());
    expect(button('Save draft')).toBeDisabled();
    await user.type(await box(), '   {Enter}{Enter}  ');
    expect(button('Save draft')).toBeDisabled();
  });

  it('keeps the line breaks inside a list item and a paragraph', async () => {
    openPolicy({
      [POLICY('privacy')]: answer(
        detailOf({
          draft: {
            body: 'Herbal Commerce\nMarket Road\n\n- First item\n  goes on here',
            updatedAt: SAVED_AT,
            updatedBy: RAVI_REF,
          },
        }),
      ),
    });

    await box();
    const shown = preview();
    const paragraph = within(shown).getByText(/Herbal Commerce/);
    expect(paragraph.textContent).toBe('Herbal Commerce\nMarket Road');
    expect(paragraph).toHaveClass('whitespace-pre-line');
    const item = within(shown).getByRole('listitem');
    expect(item.textContent).toBe('First item\ngoes on here');
    expect(item).toHaveClass('whitespace-pre-line');
  });

  it('takes the newest text at once when nothing in the box was changed', async () => {
    const theirs = detailOf({
      revision: 6,
      draft: {
        body: 'Meera’s words',
        updatedAt: SAVED_AT,
        updatedBy: MEERA_REF,
      },
    });
    const { queryClient } = openPolicy({
      [POLICY('privacy')]: [answer(detailOf()), answer(theirs)],
    });

    expect(await box()).toHaveValue(DRAFT_TEXT);
    await queryClient.invalidateQueries({
      queryKey: ['policies', 'page', 'privacy'],
    });

    await waitFor(async () => expect(await box()).toHaveValue('Meera’s words'));
    expect(
      screen.queryByText(/This page was changed elsewhere/),
    ).not.toBeInTheDocument();
  });

  it('says beside the box why the API refused the text', async () => {
    const { user } = openPolicy({
      [SAVE('privacy')]: () =>
        json(400, {
          message: 'Validation failed',
          errors: [
            {
              field: 'body',
              message:
                'The text has hidden control characters: paste it as plain text',
            },
          ],
        }),
    });

    await user.type(await box(), ' x');
    await user.click(button('Save draft'));

    expect(
      await screen.findByText(
        'The text has hidden control characters: paste it as plain text',
      ),
    ).toBeInTheDocument();
    expect(await box()).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses a text longer than a page holds, saying by how much, without cutting it', async () => {
    openPolicy();

    fireEvent.change(await box(), { target: { value: 'a'.repeat(30_001) } });

    expect(
      await screen.findByText(
        'A page holds at most 30,000 characters: remove 1.',
      ),
    ).toBeInTheDocument();
    expect((await box()).getAttribute('maxlength')).toBeNull();
    expect(button('Save draft')).toBeDisabled();
    expect(screen.getByText('30,001 of 30,000 characters')).toBeInTheDocument();
  });

  it('shows code typed in the text as words, never running it', async () => {
    openPolicy({
      [POLICY('privacy')]: answer(
        detailOf({
          draft: {
            body: '## <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>',
            updatedAt: SAVED_AT,
            updatedBy: RAVI_REF,
          },
        }),
      ),
    });

    await box();
    const shown = preview();
    expect(within(shown).getByRole('heading', { level: 3 })).toHaveTextContent(
      '<img src=x onerror=alert(1)>',
    );
    expect(
      within(shown).getByText('<script>alert(1)</script>'),
    ).toBeInTheDocument();
    expect(shown.querySelector('img, script')).toBeNull();
  });

  it('asks before leaving with changes not saved', async () => {
    const { user, router } = openPolicy();

    await user.type(await box(), ' More.');
    await user.click(
      within(screen.getByRole('main')).getByRole('link', {
        name: 'Policy pages',
      }),
    );

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Leave without saving?',
    );
    await user.click(inDialog('Keep editing'));
    expect(router.state.location.pathname).toBe('/policies/privacy');
  });

  it('lists every version, and shows one as customers saw it', async () => {
    const { user } = openPolicy({
      [VERSION('privacy', 1)]: answer({
        ...V1,
        page: 'privacy',
        body: '## The first\n\nOur first words.',
      }),
    });

    const versions = within(
      await screen.findByRole('list', { name: 'Versions' }),
    );
    const rows = versions.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(
      'Version 2 · on the websitePublished 21 Nov 2026 at 15:35 by Ravi Kumar',
    );
    expect(rows[1]).toHaveTextContent(
      'Version 1Published 20 Nov 2026 at 10:00 by Meera Rao',
    );

    await user.click(versions.getByRole('button', { name: 'Read version 1' }));

    expect(dialog()).toHaveTextContent('Privacy policy, version 1');
    expect(
      await within(dialog()).findByRole('heading', { name: 'The first' }),
    ).toBeInTheDocument();
    expect(dialog()).toHaveTextContent(
      'Published 20 Nov 2026 at 10:00 by Meera Rao.',
    );
  });

  it('shows the newest versions first, and the older ones on asking', async () => {
    const version = (number: number) => ({ ...V1, version: number });
    const { user } = openPolicy({
      [VERSIONS('privacy')]: answer({
        versions: [version(4), version(3)],
        nextBefore: 3,
      }),
      [VERSIONS('privacy', '?before=3')]: answer({
        versions: [version(2), version(1)],
        nextBefore: null,
      }),
    });

    const list = await screen.findByRole('list', { name: 'Versions' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
      'Version 4 · on the website',
    );

    await user.click(button('Show older versions'));

    await waitFor(() =>
      expect(within(list).getAllByRole('listitem')).toHaveLength(4),
    );
    expect(within(list).getAllByRole('listitem')[3]).toHaveTextContent(
      'Version 1',
    );
    // Only the newest is on the website; the last page has no more after it.
    expect(within(list).getAllByText(/on the website/)).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: 'Show older versions' }),
    ).toBeNull();
  });

  it('says so when the older versions could not be loaded, and tries again', async () => {
    const { user } = openPolicy({
      [VERSIONS('privacy')]: answer({ versions: [V2], nextBefore: 2 }),
      [VERSIONS('privacy', '?before=2')]: [
        () => json(503, { message: 'Busy' }),
        answer({ versions: [V1], nextBefore: null }),
      ],
    });

    await user.click(
      await screen.findByRole('button', { name: 'Show older versions' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Older versions could not be loaded.',
    );
    await user.click(button('Show older versions'));
    const list = screen.getByRole('list', { name: 'Versions' });
    await waitFor(() =>
      expect(within(list).getAllByRole('listitem')).toHaveLength(2),
    );
  });

  it('waits for one change at a time: the buttons rest while one is saving', async () => {
    const held = heldBack();
    const { user } = openPolicy({ [SAVE('privacy')]: held.answer });

    await user.type(await box(), ' x');
    await user.click(button('Save draft'));

    await waitFor(() =>
      expect(button('Save draft')).toHaveAttribute('aria-disabled', 'true'),
    );
    expect(button('Undo my changes')).toBeDisabled();
    held.release(json(200, detailOf({ revision: 5 })));
    expect(await screen.findByText('Draft saved')).toBeInTheDocument();
  });

  it('has no page for an unknown policy', async () => {
    openSignedIn('/policies/cookies', { staff: RAVI });

    expect(
      await screen.findByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
  });
});
