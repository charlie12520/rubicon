import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

// App.tsx is a ~3k-line component tree: any render-time throw used to unmount
// the whole cockpit to a blank page with no message. This boundary keeps the
// failure visible and recoverable mid-session.
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Rubicon crashed during render:", error, info.componentStack);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleResetAndReload = (): void => {
    try {
      window.localStorage.clear();
    } catch {
      // Storage unavailable — reload is still worth attempting.
    }
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <div className="app-crash-screen" role="alert">
        <h1>Rubicon hit a render error</h1>
        <p className="app-crash-message">{this.state.error.message || String(this.state.error)}</p>
        <p className="app-crash-hint">
          The rest of this session's data is untouched on disk. Reload to recover; if it crashes again immediately,
          clear the saved UI state and reload.
        </p>
        <div className="app-crash-actions">
          <button type="button" onClick={this.handleReload}>
            Reload
          </button>
          <button type="button" onClick={this.handleResetAndReload}>
            Clear saved UI state &amp; reload
          </button>
        </div>
      </div>
    );
  }
}
