/** Shared browser download seam for deck and goal-set exports. */
export function sanitizeDownloadFileName(fileName: string): string {
    const safe = fileName.replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, "-")
        .replace(/^[. ]+|[. ]+$/g, "").trim();
    if (!safe) return "download";
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? `_${safe}` : safe;
}

/** Resolves initiation only: browsers expose no completion/cancel signal. */
export async function initiateBlobDownload(blob: Blob, fileName: string): Promise<void> {
    const url = URL.createObjectURL(blob);
    let anchor: HTMLAnchorElement | undefined;
    try {
        anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = sanitizeDownloadFileName(fileName);
        anchor.hidden = true;
        document.body.appendChild(anchor);
        anchor.click();
        // Give the browser time to consume the URL before releasing it.
        await new Promise<void>(resolve => setTimeout(resolve, 1000));
    } finally {
        try { anchor?.remove(); }
        finally { URL.revokeObjectURL(url); }
    }
}
