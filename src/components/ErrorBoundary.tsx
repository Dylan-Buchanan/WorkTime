import React from "react";

type Props = {
    children: React.ReactNode;
    fallback?: React.ReactNode | ((error: any) => React.ReactNode);
    onReset?: () => void;
};

type State = { hasError: boolean; error: any };

export class ErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false, error: null };

    static getDerivedStateFromError(error: any): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: any, info: any) {
        try {
            console.error("UI crash captured by ErrorBoundary", error, info);
        } catch {}
    }

    reset = () => {
        this.setState({ hasError: false, error: null });
        this.props.onReset?.();
    };

    render() {
        if (this.state.hasError) {
            const Fallback = this.props.fallback;
            if (typeof Fallback === "function") {
                return <>{(Fallback as any)(this.state.error)}</>;
            }
            if (Fallback) return <>{Fallback}</>;
            return (
                <div className="p-4 text-xs text-red-300 space-y-2">
                    <div className="font-medium">Something went wrong rendering this view.</div>
                    <div className="opacity-80 break-all">{String(this.state.error?.message || this.state.error)}</div>
                    <button className="px-2 py-1 bg-neutral-800 rounded" onClick={this.reset}>
                        Try again
                    </button>
                </div>
            );
        }
        return this.props.children as any;
    }
}

export default ErrorBoundary;
