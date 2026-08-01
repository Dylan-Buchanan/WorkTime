import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataProvider, useData } from "./DataContext";
import { InMemoryDataAccess } from "../lib/data/InMemoryDataAccess";

function Probe() { return <div data-testid="same">{useData() ? "yes" : "no"}</div>; }

describe("DataContext", () => {
    it("supplies the injected instance", () => {
        const data = new InMemoryDataAccess();
        render(<DataProvider dataAccess={data}><Probe /></DataProvider>);
        expect(screen.getByTestId("same")).toHaveTextContent("yes");
    });

    it("fails outside the provider", () => {
        expect(() => render(<Probe />)).toThrow("useData must be inside DataProvider");
    });
});
