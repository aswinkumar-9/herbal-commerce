# 0035. The console's look: glass and clay

- Status: Accepted and implemented (part 12E)
- Date: 2026-11-20
- Updated: 2026-11-20 (part 13: the look moved, unchanged, into the design system, `packages/design`, and fields got an edge that keeps 3:1, see ADR 0036)

## Context

The owner asked for a look that blends minimalism, glass, clay, flat design and Material (`docs/requirements.md`, section 10). On 2026-11-18 they asked whether the console followed it. It didn't: it was minimal and flat, with only one frosted bar. They chose:
1. to give the admin console glass and clay touches now, on its own branch, while keeping its text easy to read;
2. then to plan a design system as a part of its own, before the website.

On 2026-11-19 they added that every later change to the console follows this look.

On 2026-11-20 they made clear it is the look of the console, for Admins and Super Users. The customer website and apps will look very different, from a reference video the owner will send when the design system is planned.

Staff read numbers in the console all day, so its text must stay as clear as before.

## Decision

### Where each touch goes

- **A soft glow behind the page.**
  - Three faint radial gradients, one green, one amber and one mint, on a layer that stays still while the page scrolls (`body::before`).
  - It gives the glass something to frost.
  - It is pure CSS, with no image.
- **Glass on what floats over the page:**
  - the menu: on the left on wide screens, and at the top on a phone;
  - the product page's save bar;
  - a dialog's backdrop, which now blurs the page as well as dimming it.
- **Clay on what staff touch or read as a unit.** It is soft, raised, lit from above, with a faint shade at the bottom:
  - cards: a product's sections, the Stock page's groups, each batch, the overview's areas, sign-in, and the error screens;
  - rows: products and categories;
  - buttons;
  - chips: stock levels, Draft, Off sale, a batch's tags, the role, the main image, and the menu's highlight.
- **Wells:** fields, the search box, a switch's track, a batch's four numbers, and the count dialog's "should be on the shelf" box look set into the page.
- **Pressed:** a chosen thing looks pushed in:
  - the chosen Stock filter;
  - the chosen "What happened" option in "Change stock";
  - a button while it is held.

Dialogs, toasts and the idle warning stay solid, as do cards and fields, with the largest clay shadow, so they float above the page.

### The vocabulary

The rules were at the top of `src/index.css`. Since part 13 they live in the design system, in `packages/design/src/looks/console.ts` and `console.rules.css` (ADR 0036). Each touch is a Tailwind class, so a new page uses the same words:

| Class | What it is |
| --- | --- |
| `glass` | Frosted glass: 88% of the surface colour, blurred and a little more saturated behind. Solid where it can't be, see below. |
| `inset-shadow-glass` | Glass's lit top edge |
| `shadow-chip`, `shadow-clay-sm`, `shadow-clay`, `shadow-clay-lg` | Raised clay, from a chip to a dialog |
| `inset-shadow-clay` | Clay's lit top edge and shaded bottom, on a light surface |
| `inset-shadow-clay-solid` | The same on a coloured button |
| `inset-shadow-well` | A field set into the page |
| `inset-shadow-pressed`, `inset-shadow-pressed-solid` | Pushed in: chosen, or held |
| `rounded-card` (now 1 rem), `rounded-control` (0.75 rem) | The softer corners of cards, and of buttons and fields |

- **Each colour has a value for each theme,** as before, so light and dark both follow.
- **Coloured buttons** get a faint white sheen from the top, a lit top edge and a darker bottom edge. While held, their shadow moves inside.
- **These are Tailwind's own shadow layers,** so a focus ring still adds to a field's well instead of replacing it.

### Text stays readable

- **Text never sits on see-through glass below 4.5:1** (WCAG 2.2 AA).
  - Glass is 88% solid.
  - Even with pure black under it (pure white in the dark theme), muted text keeps 4.5:1.
  - At 80% it would have dropped to about 3.7:1, which is why glass is 88% solid.
- **Text on cards and fields sits on solid colours,** as before.
- **The glow is faint:** muted text on it keeps at least 5.06:1 in the light theme and 7.25:1 in the dark one. This was measured at five screen sizes, from a phone to 2560 pixels wide, where the glow is strongest.
- **Measured from the pixels in Chrome,** with the text hidden so that only what is behind it counts:

| | Light | Dark |
| --- | --- | --- |
| The menu, as it is | 6.03:1 | 7.41:1 |
| The save bar, as it is | 5.89:1 | 6.92:1 |
| The save bar, black (or white) under it | 4.62:1 | 5.08:1 |
| The phone's top bar, as it is | 5.14:1 | 5.90:1 |
| The phone's top bar, black (or white) under it | 4.62:1 | 5.08:1 |

### For those who ask the computer for less

- **Less transparency** (`prefers-reduced-transparency`): glass turns solid, and a dialog's backdrop dims without blurring.
- **More contrast** (`prefers-contrast: more`): the same, and the glow behind the page goes.
- **A browser that can't blur** gets solid glass.
- **Windows' contrast themes** drop shadows and gradients. Every card, button and field keeps its border, so shapes stay visible.
- **"Reduce motion"** still turns the movement off, the new hover and press included.

### Smaller changes

- **On a phone, the menu bar stays at the top** while the page scrolls under its glass.
  - While the menu is open, the bar turns solid and scrolls on its own.
  - What the browser scrolls to stops below the bar (`scroll-padding-top`).
  - "Skip to the page" shows above the bar.
- **The overview's areas lift 2 pixels** under the pointer, with a deeper shadow.
- **A button's press now eases in.** Tailwind 4 moves a button with `scale`, not `transform`, and the old transition named only `transform`, so the press used to snap.
- **A dialog's backdrop writes its colours out.** Older browsers don't pass the page's colour names to a backdrop.

### Security

- **The page's security policy is unchanged.** No new packages, no fonts or images from anywhere: the glow and the sheen are CSS gradients, and the font is still the computer's own.
- **The built console's check still passes:** the policy first, nothing inline, no source maps.

## Alternatives considered

- **Glass on cards, dialogs and fields.** Rejected: staff read numbers and fill forms there all day, and text over a moving, see-through page is harder to read.
- **Glass at 70 to 80%.** Rejected: muted text could fall to about 3.7:1 with something dark under it.
- **Full neumorphism:** shapes in the page's own colour, with no borders. Rejected: shapes vanish for people who see contrast poorly, and in Windows' contrast themes.
- **A light and dark switch in the console.** Left to the design-system part. The console still follows the computer's setting.
- **A web font.** Rejected for now: the policy would have to allow another site, and the computer's font reads well.
- **Blur everywhere.** Rejected: it costs work on every frame, most on low-end devices. The console blurs in three places only.
- **The same look for the customer website and apps.** Rejected by the owner on 2026-11-20: the shop gets its own look, from their reference video.

## Consequences

- **A new console page uses these classes,** not shadows, blurs or colours of its own.
- **The design-system part** will move the shared foundations into tokens shared by the console, the website and the apps:
  - accessibility rules, spacing, type and motion;
  - two looks on top: this one for the console, and the customer one from the owner's reference video.
- **Tests:**
  - the console's 492 tests pass unchanged, as the look changes no behaviour;
  - typecheck, lint, Prettier and the build check pass;
  - **in a real browser:** headless Chrome drove the built console under its full policy, in the light and the dark theme. 14 checks each:
    - the contrast above;
    - the dialog's blur;
    - less transparency and more contrast;
    - the phone's bar staying at the top and turning solid when open;
    - no sideways scrolling;
    - no policy violation or page error.

    The glow alone was measured too, at five screen sizes in each theme.
- **Lessons:**
  - **Measure contrast on glass from the pixels, at its worst.** The page as it is looked fine at 80%; black under it did not.
  - **Tailwind 4 moves with `scale` and `translate`, not `transform`.** A transition must name the property that moves.
