import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../errorReporting";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

type State = { failed: boolean };

/** Replaces a crashed screen with a way out instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const withStack = new Error(error.message);
    withStack.stack = `${error.stack ?? ""}\n${info.componentStack ?? ""}`;
    reportError("render", withStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Card role="alert" className="flex max-w-sm flex-col gap-3 p-5 text-center">
          <h1 className="font-display text-2xl text-accent-text">Something went wrong</h1>
          <p className="text-sm text-muted">
            The game hit an error and was reported. Your seat is safe; reloading picks up where you
            left off.
          </p>
          <Button variant="primary" onClick={() => location.reload()}>
            Reload
          </Button>
        </Card>
      </div>
    );
  }
}
