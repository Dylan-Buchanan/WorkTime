import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WaitingBadge, WaitingDot } from "./WaitingIndicator";

describe("waiting indicators", () => {
    it.each(["agent", "person"] as const)("labels the %s dot for assistive technology and hover", (type) => {
        render(<WaitingDot waiting={{ type, since: "2026-08-12T09:00:00Z" }} />);
        expect(screen.getByRole("img", { name: `Waiting on ${type}` })).toHaveAttribute("title", `Waiting on ${type}`);
    });

    it.each([
        ["agent", "text-violet-300", "bg-violet-400/15"],
        ["person", "text-amber-300", "bg-amber-500/10"],
    ] as const)("renders the %s badge with elapsed hover copy and a clear action", (type, foreground, background) => {
        const onClear = vi.fn();
        render(<WaitingBadge waiting={{ type, since: "2026-08-12T09:00:00Z" }} nowMs={Date.parse("2026-08-15T10:00:00Z")} onClear={onClear} />);
        expect(screen.getByTitle(`Waiting on ${type} · 3 days`)).toHaveClass(foreground, background);
        expect(screen.getByText(`WAITING · ${type.toUpperCase()}`)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Clear waiting" }));
        expect(onClear).toHaveBeenCalledOnce();
    });
});
