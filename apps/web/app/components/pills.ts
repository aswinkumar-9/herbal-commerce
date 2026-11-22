// The website's buttons and the links that look like them: pills (ADR
// 0036). The page's one main action is a saffron gold pill with dark text;
// any other is a deep gold one, or an outlined one for a quiet step (the
// next page, say).
export const GOLD_PILL =
  'button-md inline-flex items-center justify-center gap-2 rounded-full bg-gold px-6 py-3 text-on-gold transition hover:bg-gold-strong active:scale-98';

export const GOLD_PILL_LARGE =
  'button-lg inline-flex items-center justify-center gap-2 rounded-full bg-gold px-8 py-3 text-on-gold transition hover:bg-gold-strong active:scale-98';

export const PILL =
  'button-md inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-on-primary transition hover:bg-primary-strong active:scale-98';

export const OUTLINE_PILL =
  'button-md inline-flex items-center justify-center gap-2 rounded-full border border-line-strong px-6 py-3 text-ink transition hover:bg-surface-muted active:scale-98';

// For what can't be undone, such as removing an address, once asked.
export const DANGER_PILL =
  'button-md inline-flex items-center justify-center gap-2 rounded-full bg-danger px-6 py-3 text-on-danger transition hover:bg-danger-strong active:scale-98';
