import { useId } from 'react';
import { THEME_CHOICES } from '@herbal/design';
import { text } from '../text/en.ts';
import { useThemeChoice } from '../theme.ts';

const OPTION =
  'block rounded-full text-ink transition-colors peer-checked:bg-primary peer-checked:text-on-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus';

// Auto, Light or Dark: in the menu bar on a wide screen (small, its name
// for screen readers only), and in the phone menu (larger, named on
// screen).
export function ThemeSwitch({
  name,
  place,
}: {
  name: string;
  place: 'bar' | 'menu';
}) {
  const [choice, choose] = useThemeChoice();
  const labelId = useId();
  const inBar = place === 'bar';
  return (
    <div className={inBar ? 'hidden lg:block' : 'flex flex-col gap-3'}>
      <p
        id={labelId}
        className={inBar ? 'sr-only' : 'caption-4 text-ink-muted'}
      >
        {text.theme.label}
      </p>
      <fieldset
        aria-labelledby={labelId}
        className={
          inBar
            ? 'flex rounded-full p-1 inset-shadow-glass'
            : 'flex w-fit rounded-full border border-line-strong p-1'
        }
      >
        {THEME_CHOICES.map((value) => (
          <label key={value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={value}
              checked={choice === value}
              onChange={() => choose(value)}
              className="peer sr-only"
            />
            <span
              className={`${OPTION} ${inBar ? 'button-xsm px-3 py-2' : 'button-sm px-4 py-2'}`}
            >
              {text.theme[value]}
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
