import { Component, type ReactNode } from 'react';
import { Link } from 'react-router';

import './AppShell.css';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /**
   * Changes reset the boundary. The route table passes the current location
   * key so navigating away from a broken view restores the app.
   */
  readonly resetKey?: string;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
}

/**
 * Route-level safety net. It intentionally renders a fixed message instead of
 * the thrown error: error messages and component stacks can contain user
 * content, so nothing about the failure is displayed or logged here.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    // No user content, stack trace, or error message is written to the
    // console. Recovery stays explicit and local to this boundary.
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps): void {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <section className="error-view" role="alert" aria-labelledby="error-view-title">
        <h2 id="error-view-title">This view could not open</h2>
        <p>Nothing has been changed. Reload the app, or return to the case shelf.</p>
        <div className="error-view__actions">
          <button type="button" className="error-view__action" onClick={this.handleReload}>
            Reload
          </button>
          <Link className="error-view__action" to="/">
            Back to shelf
          </Link>
        </div>
      </section>
    );
  }
}
