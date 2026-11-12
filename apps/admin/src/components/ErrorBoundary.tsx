import { Component } from 'react';
import type { ReactNode } from 'react';

interface State {
  failed: boolean;
}

// A page that breaks shows a calm message instead of a blank screen. What
// went wrong stays out of the page: the browser's console has it for
// developers.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}

// Also the router's answer to an error in a page it opens.
export function CrashScreen() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section className="w-full max-w-sm rounded-card border border-line bg-surface p-8 text-center shadow-soft">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-ink-muted">
          The page could not be shown. Reloading usually helps.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 h-10 rounded-lg bg-primary px-4 text-sm font-medium text-on-primary transition-colors hover:bg-primary-strong"
        >
          Reload the page
        </button>
      </section>
    </main>
  );
}
