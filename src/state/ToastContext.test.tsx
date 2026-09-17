import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TOAST_DURATION_MS, ToastProvider, useToast } from "./ToastContext";

function Probe({ onUndo }: { onUndo: () => void }) {
    const { toasts, showToast, dismissToast } = useToast();
    const first = toasts[0];
    return <div>
        <span data-testid="count">{toasts.length}</span>
        <span data-testid="first-id">{first?.id ?? ""}</span>
        <button onClick={() => showToast("Logged potty", { action: { label: "Undo", onAction: onUndo } })}>log</button>
        <button onClick={() => showToast("Overdue: potty", { durationMs: 0 })}>sticky</button>
        <button onClick={() => first && dismissToast(first.id)}>dismiss-first</button>
    </div>;
}

afterEach(() => {
    vi.useRealTimers();
});

describe("ToastProvider", () => {
    it("shows a toast with an action and runs it on click", () => {
        const onUndo = vi.fn();
        render(<ToastProvider><Probe onUndo={onUndo} /></ToastProvider>);

        fireEvent.click(screen.getByText("log"));
        expect(screen.getByTestId("toast-message")).toHaveTextContent("Logged potty");
        expect(screen.getByTestId("count")).toHaveTextContent("1");

        fireEvent.click(screen.getByText("Undo"));
        expect(onUndo).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("count")).toHaveTextContent("0");
    });

    it("auto-dismisses after the default undo window", () => {
        vi.useFakeTimers();
        render(<ToastProvider><Probe onUndo={vi.fn()} /></ToastProvider>);

        act(() => { fireEvent.click(screen.getByText("log")); });
        expect(screen.getByTestId("count")).toHaveTextContent("1");

        act(() => { vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS - 1); });
        expect(screen.getByTestId("count")).toHaveTextContent("1");

        act(() => { vi.advanceTimersByTime(1); });
        expect(screen.getByTestId("count")).toHaveTextContent("0");
    });

    it("keeps a sticky toast until it is dismissed explicitly", () => {
        vi.useFakeTimers();
        render(<ToastProvider><Probe onUndo={vi.fn()} /></ToastProvider>);

        act(() => { fireEvent.click(screen.getByText("sticky")); });
        act(() => { vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS * 2); });
        expect(screen.getByTestId("count")).toHaveTextContent("1");

        act(() => { fireEvent.click(screen.getByText("dismiss-first")); });
        expect(screen.getByTestId("count")).toHaveTextContent("0");
    });

    it("stacks multiple toasts and dismisses only the targeted one", () => {
        render(<ToastProvider><Probe onUndo={vi.fn()} /></ToastProvider>);

        fireEvent.click(screen.getByText("sticky"));
        fireEvent.click(screen.getByText("log"));
        expect(screen.getByTestId("count")).toHaveTextContent("2");

        fireEvent.click(screen.getAllByRole("button", { name: "Dismiss notification" })[0]);
        expect(screen.getByTestId("count")).toHaveTextContent("1");
        expect(screen.getByTestId("toast-message")).toHaveTextContent("Logged potty");
    });
});
