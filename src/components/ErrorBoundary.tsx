import { TriangleAlert } from "lucide-react";
import { Component, type ReactNode } from "react";

/** Keeps one broken view from taking the whole window down. */
export class ErrorBoundary extends Component<{ children: ReactNode; onClose?: () => void; resetKey?: unknown }, { error: Error | null; key: unknown }> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey?: unknown }, state: { error: Error | null; key: unknown }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const body = (
      <div className="empty">
        <div className="empty-icon">
          <TriangleAlert />
        </div>
        <h3>Something went wrong here</h3>
        <p>{this.state.error.message}</p>
        <button className="btn" onClick={() => (this.setState({ error: null }), this.props.onClose?.())}>
          {this.props.onClose ? "Close" : "Try Again"}
        </button>
      </div>
    );
    // The reader covers the window; its error does too.
    return this.props.onClose ? <div className="reader" style={{ "--r-bg": "var(--bg)", "--r-fg": "var(--text)" } as React.CSSProperties}>{body}</div> : body;
  }
}
