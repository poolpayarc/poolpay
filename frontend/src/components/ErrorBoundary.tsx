import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { PAGE, Button, btnSecondary } from "./ui";

/**
 * Last line of defence for the routed pages. Without this, any error thrown
 * during render or in an effect unmounts the whole React root and the user is
 * left staring at a genuinely blank page with no way back except a refresh.
 *
 * `resetKey` is the current pathname: navigating elsewhere clears the error so
 * a single bad page doesn't wedge the rest of the app.
 */
type Props = { children: ReactNode; resetKey?: string };
type State = { error: Error | null; resetKey?: string };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  /** Navigating to another route clears the error without a second render pass. */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[PoolPay] page crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={PAGE}>
        <div className="flex flex-col items-center rounded-2xl border border-danger/40 bg-danger/[0.06] px-6 py-14 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-danger/30 bg-white text-xl text-danger-strong">
            !
          </div>
          <p className="text-base font-medium text-ink">This page hit an unexpected error</p>
          <p className="mt-2 max-w-md text-sm text-muted">
            Nothing was sent to the blockchain. You can retry ,if it keeps happening, the details
            below will help track it down.
          </p>
          <pre className="mt-4 max-w-full overflow-x-auto rounded-lg border border-hairline bg-white px-3 py-2 text-left font-mono text-xs text-muted">
            {error.message || String(error)}
          </pre>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button onClick={() => this.setState({ error: null })}>Retry</Button>
            <Link to="/app" className={btnSecondary}>
              Back to pools
            </Link>
          </div>
        </div>
      </div>
    );
  }
}
