import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initiateBlobDownload, sanitizeDownloadFileName } from "./delivery";

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("URL", class extends URL {
        static createObjectURL = vi.fn(() => "blob:deck");
        static revokeObjectURL = vi.fn();
    });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("initiateBlobDownload", () => {
    it("clicks a sanitized download anchor, resolves initiation, and releases the URL after a delay", async () => {
        const writes = vi.spyOn(Storage.prototype, "setItem");
        const blob = new Blob(["deck"]);
        let clicked = false;
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
            expect(this.isConnected).toBe(true);
            expect(this.href).toBe("blob:deck");
            expect(this.download).toBe("Work-review-.pptx");
            clicked = true;
        });
        const pending = initiateBlobDownload(blob, "Work/review\u0000.pptx");
        expect(clicked).toBe(true);
        expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        await vi.runAllTimersAsync();
        await expect(pending).resolves.toBeUndefined();
        expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:deck");
        expect(document.querySelector('a[download]')).toBeNull();
        expect(writes).not.toHaveBeenCalled();
    });

    it("rejects an object URL error without clicking an anchor", async () => {
        vi.mocked(URL.createObjectURL).mockImplementation(() => { throw new Error("URL failed"); });
        const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
        await expect(initiateBlobDownload(new Blob(), "deck.pptx")).rejects.toThrow("URL failed");
        expect(click).not.toHaveBeenCalled();
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    it.each(["create", "append", "click"])("rejects an anchor %s error and releases the URL", async stage => {
        const fail = () => { throw new Error("Anchor failed"); };
        if (stage === "create") vi.spyOn(document, "createElement").mockImplementation(fail);
        if (stage === "append") vi.spyOn(document.body, "appendChild").mockImplementation(fail);
        if (stage === "click") vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(fail);
        await expect(initiateBlobDownload(new Blob(), "deck.pptx")).rejects.toThrow("Anchor failed");
        expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:deck");
        expect(document.querySelector('a[download]')).toBeNull();
    });
});

it("sanitizes separators, controls, Windows special characters, reserved names and empty names", () => {
    expect(sanitizeDownloadFileName(' ..Work\\Life/:*?<>|"\n\u0085. ')).toBe("Work-Life----------");
    expect(sanitizeDownloadFileName("CON.pptx")).toBe("_CON.pptx");
    expect(sanitizeDownloadFileName(". ")).toBe("download");
    expect(sanitizeDownloadFileName("Work-2026-10-04.pptx")).toBe("Work-2026-10-04.pptx");
});
