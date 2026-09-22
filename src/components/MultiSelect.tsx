import React, { useEffect, useMemo, useRef, useState } from "react";

export const MultiSelect: React.FC<{
    label: string;
    minWidth?: string;
    options: { value: string; label: string }[];
    value: string[];
    onChange: (next: string[]) => void;
}> = ({ label, minWidth, options, value, onChange }) => {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDocMouseDown = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDocMouseDown);
        return () => document.removeEventListener("mousedown", onDocMouseDown);
    }, [open]);

    const knownValues = useMemo(() => new Set(options.map((option) => option.value)), [options]);
    const selectedCount = options.filter((option) => value.includes(option.value)).length;
    const allSelected = options.length > 0 && selectedCount === options.length;
    const summary = allSelected
        ? "All selected"
        : selectedCount === 0
          ? label
          : selectedCount === 1
            ? options.find((option) => value.includes(option.value))?.label ?? `${selectedCount} selected`
            : `${selectedCount} selected`;

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                className={`bg-neutral-900 rounded px-2 py-1.5 sm:py-1 text-left flex items-center justify-between gap-2 ${minWidth ?? "min-w-[100px]"}`}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={label}
            >
                <span className="truncate">{summary}</span>
                <span className="text-[8px] opacity-60">▼</span>
            </button>
            {open && (
                <div
                    role="listbox"
                    aria-multiselectable
                    aria-label={label}
                    className="absolute z-20 mt-1 w-full min-w-[10rem] max-h-52 overflow-y-auto rounded border border-neutral-700 bg-neutral-900 p-1 shadow-xl habit-scroll"
                >
                    {options.length === 0 && <div className="px-2 py-1 text-[11px] opacity-60">No options</div>}
                    {options.map((option) => (
                        <label key={option.value} className="flex items-center gap-2 rounded px-2 py-1 text-[11px] cursor-pointer hover:bg-neutral-800">
                            <input
                                type="checkbox"
                                checked={value.includes(option.value)}
                                onChange={() => {
                                    const next = value.includes(option.value)
                                        ? value.filter((selected) => selected !== option.value)
                                        : [...value.filter((selected) => knownValues.has(selected)), option.value];
                                    onChange(next);
                                }}
                            />
                            <span className="truncate">{option.label}</span>
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
};
