import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ErrorBoundaryProps {
    children: ReactNode;
    resetKey?: string;
    fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
    error: Error | null;
    caughtAt: string | undefined;
}

export default class ErrorBoundary extends Component<
    ErrorBoundaryProps,
    ErrorBoundaryState
> {
    state: ErrorBoundaryState = { error: null, caughtAt: undefined };

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { error };
    }

    static getDerivedStateFromProps(
        props: ErrorBoundaryProps,
        state: ErrorBoundaryState,
    ): Partial<ErrorBoundaryState> | null {
        if (state.error === null) return { caughtAt: props.resetKey };
        if (state.caughtAt !== props.resetKey) {
            return { error: null, caughtAt: props.resetKey };
        }
        return null;
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error("[ErrorBoundary]", error, info.componentStack);
    }

    private reset = (): void => {
        this.setState({ error: null, caughtAt: this.props.resetKey });
    };

    render(): ReactNode {
        const { error } = this.state;
        if (!error) return this.props.children;
        if (this.props.fallback) return this.props.fallback(error, this.reset);

        return (
            <div className="empty-screen" role="alert">
                <div className="empty-card">
                    <div className="empty-kicker">Something went wrong</div>
                    <h2>This screen could not be displayed</h2>
                    <p>
                        The rest of the portal is still working. Try again, or go back and
                        open the screen a second time.
                    </p>
                    <p className="auth-error">{error.message}</p>
                    <button type="button" className="btn btn-primary" onClick={this.reset}>
                        Try again
                    </button>
                </div>
            </div>
        );
    }
}
