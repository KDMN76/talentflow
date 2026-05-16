"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

/**
 * Per-rij error boundary voor JobCards op de vacaturelijst.
 *
 * Waarom per-rij ipv hele lijst: als één job kapot data heeft (bv. NULL veld
 * dat de render breekt), willen we niet de hele pagina laten witten — alleen
 * die rij tonen als fout-state, de rest renders normaal.
 *
 * DESIGN.md §2 (status-color "neutral" voor proces-failure, geen rood), §4
 * (cards: white surface, 8px radius), §3 (workhorse 13px/500).
 */

interface Props {
  jobId: string;
  jobTitle?: string | null;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class JobRowBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Geen Sentry-DSN actief; loggen naar console zodat de error in dev-tools
    // wel zichtbaar blijft en niet stilletjes wordt gegeten.
    // eslint-disable-next-line no-console
    console.error(
      `[JobRowBoundary] render-fout voor job ${this.props.jobId} (${
        this.props.jobTitle ?? "onbekende titel"
      }):`,
      error,
      info.componentStack
    );
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-[13px] dark:border-zinc-800 dark:bg-zinc-950"
          style={{ borderRadius: "8px" }}
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500"
            aria-hidden
          />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-zinc-900 dark:text-zinc-100">
              Deze vacature kon niet getoond worden
            </p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              {this.props.jobTitle
                ? `"${this.props.jobTitle}"`
                : `Vacature ${this.props.jobId.slice(0, 8)}`}{" "}
              bevat onverwachte data. De rest van de lijst werkt nog.
            </p>
            <p className="mt-1 font-mono text-[11px] text-zinc-400">
              {this.state.error.message}
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
