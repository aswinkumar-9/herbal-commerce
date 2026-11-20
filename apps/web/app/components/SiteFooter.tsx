import { text } from '../text/en.ts';

// The foot of every page: only what is true of the shop today.
export function SiteFooter({ inert }: { inert: boolean }) {
  return (
    <footer
      inert={inert}
      aria-label={text.footer.label}
      className="border-t border-line py-12"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6">
        <p className="title-3 text-ink">{text.shop.name}</p>
        <p className="body-6 text-ink-muted">{text.footer.prices}</p>
        <p className="body-6 text-ink-muted">{text.footer.delivery}</p>
      </div>
    </footer>
  );
}
