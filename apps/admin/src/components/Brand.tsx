import { Leaf } from 'lucide-react';

export function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
        <Leaf aria-hidden="true" className="size-5" />
      </span>
      <div className="leading-tight">
        <p className="font-semibold">Herbal Commerce</p>
        <p className="text-sm text-ink-muted">Admin console</p>
      </div>
    </div>
  );
}
