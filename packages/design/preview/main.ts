// The preview page's script: the theme switch, the phone menu, the reveals,
// the form's checks, and the specimens written from the design system's own
// data, so the page can never drift from it. Nothing is turned from a string
// into HTML: the policy's Trusted Types would refuse it.
import { TEXT_STYLES, TYPE_SCALE } from '../src/foundations.ts';
import { SHOP_MOTION, shopLook } from '../src/looks/shop.ts';
import {
  THEME_CHOICES,
  THEME_KEY,
  applyThemeChoice,
  deviceStorage,
  readThemeChoice,
  saveThemeChoice,
} from '../src/theme.ts';
import type { ThemeChoice } from '../src/theme.ts';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = `cubic-bezier(${SHOP_MOTION.ease.join(', ')})`;
const ms = (seconds: number): number => seconds * 1000;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

// Light, dark, or as the device is set. Every switch on the page shows the
// same choice, and so does another tab once one changes it.
function themeSwitches(): void {
  const inputs = [
    ...document.querySelectorAll<HTMLInputElement>(
      '[data-theme-switch] input[type="radio"]',
    ),
  ];
  const show = (choice: ThemeChoice): void => {
    for (const input of inputs) {
      input.checked = input.value === choice;
    }
  };
  const choose = (choice: ThemeChoice): void => {
    applyThemeChoice(document.documentElement, choice);
    show(choice);
  };
  show(readThemeChoice(deviceStorage()));
  for (const input of inputs) {
    input.addEventListener('change', () => {
      const choice = THEME_CHOICES.find((value) => value === input.value);
      if (choice) {
        saveThemeChoice(deviceStorage(), choice);
        choose(choice);
      }
    });
  }
  addEventListener('storage', (event) => {
    if (event.key === THEME_KEY || event.key === null) {
      choose(readThemeChoice(deviceStorage()));
    }
  });
}

// The phone menu opens over the page; the page behind it can't be reached
// until it closes. Its links arrive one after another, 60 ms apart, all
// within 400 ms however many there are.
function phoneMenu(): void {
  const toggle =
    document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const panel = document.querySelector<HTMLElement>('#menu');
  if (!toggle || !panel) {
    return;
  }
  const behind = [
    ...document.querySelectorAll<HTMLElement>('main, footer, [href="#main"]'),
  ];
  const items = [...panel.querySelectorAll<HTMLElement>('[data-menu-item]')];
  const step = Math.min(
    SHOP_MOTION.stagger,
    SHOP_MOTION.menuCap / Math.max(items.length - 1, 1),
  );
  let hiding: ReturnType<typeof setTimeout> | undefined;

  const setOpen = (open: boolean): void => {
    clearTimeout(hiding);
    toggle.setAttribute('aria-expanded', String(open));
    for (const node of behind) {
      node.inert = open;
    }
    if (open) {
      items.forEach((item, index) => {
        item.style.transitionDelay = `${index * step}s`;
      });
      panel.hidden = false;
      // Drawn once closed, so the opening is seen.
      panel.getBoundingClientRect();
      panel.dataset['open'] = '';
    } else {
      for (const item of items) {
        item.style.transitionDelay = '0s';
      }
      delete panel.dataset['open'];
      hiding = setTimeout(
        () => {
          panel.hidden = true;
        },
        reducedMotion ? 0 : ms(SHOP_MOTION.durations.hover),
      );
    }
  };
  const isOpen = (): boolean => toggle.getAttribute('aria-expanded') === 'true';

  toggle.addEventListener('click', () => setOpen(!isOpen()));
  panel.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) {
      setOpen(false);
    }
  });
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });
  // A wide screen has no phone menu: it closes if the window grows.
  matchMedia('(min-width: 64rem)').addEventListener('change', (event) => {
    if (event.matches && isOpen()) {
      setOpen(false);
    }
  });
}

// Each part rises 32 px into view and fades in, once, as the page reaches it.
// Parts that arrive together follow one another. With reduced motion, or
// without the script, everything simply shows.
function reveals(): void {
  if (reducedMotion || !('IntersectionObserver' in window)) {
    return;
  }
  document.documentElement.dataset['reveals'] = '';
  const observer = new IntersectionObserver(
    (entries) => {
      entries
        .filter((entry) => entry.isIntersecting)
        .forEach(({ target }, index) => {
          observer.unobserve(target);
          if (target instanceof HTMLElement) {
            target.dataset['shown'] = '';
            target.animate(
              [
                { opacity: 0, translate: `0 ${SHOP_MOTION.rise}px` },
                { opacity: 1, translate: '0 0' },
              ],
              {
                duration: ms(SHOP_MOTION.durations.reveal),
                delay: ms(index * SHOP_MOTION.stagger),
                easing: EASE,
                fill: 'backwards',
              },
            );
          }
        });
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  for (const part of document.querySelectorAll('[data-reveal]')) {
    observer.observe(part);
  }
}

// The tagline starts quiet and lights up word by word, in reading order, as
// each word passes 60% of the way up the screen.
function tagline(): void {
  const line = document.querySelector<HTMLElement>('[data-tagline]');
  if (!line || reducedMotion || !('IntersectionObserver' in window)) {
    return;
  }
  const words: HTMLElement[] = [];
  for (const node of [...line.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE) {
      continue;
    }
    const pieces = document.createDocumentFragment();
    for (const piece of (node.textContent ?? '').split(/(\s+)/)) {
      if (/^\s*$/.test(piece)) {
        pieces.append(piece);
      } else {
        const word = element(
          'span',
          'text-ink/30 transition-colors duration-500 ease-settle data-lit:text-ink',
          piece,
        );
        words.push(word);
        pieces.append(word);
      }
    }
    node.replaceWith(pieces);
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries
        .filter((entry) => entry.isIntersecting)
        .forEach(({ target }, index) => {
          observer.unobserve(target);
          if (target instanceof HTMLElement) {
            target.style.transitionDelay = `${index * SHOP_MOTION.stagger}s`;
            target.dataset['lit'] = '';
          }
        });
    },
    { rootMargin: '0px 0px -40% 0px' },
  );
  for (const word of words) {
    observer.observe(word);
  }
}

// Every text style, written from the foundations: its name, size, line
// height and weight, and a line set in it.
function textStyles(): void {
  const list = document.querySelector('#text-styles');
  const samples: Record<string, string> = {
    heading: 'Calm pages for good herbs',
    title: 'Titles lead a card or a list',
    body: 'Running text stays easy to read, in daylight and at night.',
    button: 'Add to cart',
    caption: 'Helper text, badges and fine print',
  };
  for (const [name, { step, weight }] of Object.entries(TEXT_STYLES)) {
    const { size, lineHeight } = TYPE_SCALE[step];
    const item = element('li', 'flex min-w-0 flex-col gap-2');
    item.append(
      element(
        'p',
        'caption-4 text-ink-muted',
        `${name} · ${size}/${lineHeight} · ${weight}`,
      ),
      element(
        'p',
        `${name} break-words text-ink`,
        samples[name.split('-')[0] ?? ''] ?? '',
      ),
    );
    list?.append(item);
  }
}

// Every colour, both themes' values, with a swatch of the one showing now.
function swatches(): void {
  const list = document.querySelector('#swatches');
  const { light, dark } = shopLook.colors;
  for (const name of Object.keys(light)) {
    const item = element(
      'li',
      'flex flex-col gap-3 rounded-3xl border border-line bg-surface p-2 pb-4',
    );
    const swatch = element('div', 'h-16 rounded-2xl border border-line');
    swatch.style.backgroundColor = `var(--${name})`;
    const label = element('div', 'flex flex-col gap-1 px-2');
    label.append(
      element('p', 'title-4 text-ink', name),
      element('p', 'caption-5 text-ink-muted', `Light ${light[name] ?? ''}`),
      element('p', 'caption-5 text-ink-muted', `Dark ${dark[name] ?? ''}`),
    );
    item.append(swatch, label);
    list?.append(item);
  }
}

// The motion values, as the design system holds them.
function motion(): void {
  const list = document.querySelector('#motion');
  const { durations, rise, stagger, menuRise, menuCap } = SHOP_MOTION;
  const rows: [string, string][] = [
    ['Under the pointer', `${ms(durations.hover)} ms`],
    ['Layout and position', `${ms(durations.layout)} ms`],
    ['Rising into view', `${ms(durations.reveal)} ms, ${rise} px`],
    [
      'Menu links',
      `${ms(stagger)} ms apart, ${menuRise} px, all within ${ms(menuCap)} ms`,
    ],
  ];
  for (const [term, value] of rows) {
    const row = element(
      'div',
      'flex flex-col gap-1 rounded-3xl border border-line bg-surface p-6',
    );
    row.append(
      element('dt', 'caption-4 text-ink-muted', term),
      element('dd', 'title-2 text-ink', value),
    );
    list?.append(row);
  }
}

// The form says what is wrong beside the field, once it has been sent, and
// keeps saying it as the field is put right. It sends nothing.
function noteForm(): void {
  const form = document.querySelector<HTMLFormElement>('#note-form');
  const status = document.querySelector('#note-status');
  if (!form || !status) {
    return;
  }
  const fields = [
    ...form.querySelectorAll<HTMLInputElement>('input[required]'),
  ];
  // Spaces alone are no answer.
  const problem = (input: HTMLInputElement): string => {
    if (input.value.trim() === '') {
      return input.type === 'email'
        ? 'Enter your email address.'
        : 'Enter your name.';
    }
    if (input.validity.typeMismatch) {
      return 'Enter an email address like name@example.com.';
    }
    return '';
  };
  const check = (input: HTMLInputElement): boolean => {
    const message = problem(input);
    const error = document.getElementById(`${input.id}-error`);
    if (error) {
      error.textContent = message;
      error.hidden = message === '';
    }
    if (message) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
    return message === '';
  };
  let sent = false;
  for (const input of fields) {
    input.addEventListener('input', () => {
      if (sent) {
        check(input);
      }
    });
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    sent = true;
    const wrong = fields.filter((input) => !check(input));
    if (wrong.length > 0) {
      status.textContent = '';
      wrong[0]?.focus();
      return;
    }
    status.textContent = 'Saved. This preview sends nothing.';
    form.reset();
    sent = false;
  });
}

textStyles();
swatches();
motion();
themeSwitches();
phoneMenu();
noteForm();
tagline();
reveals();
