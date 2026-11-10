import { useId } from "react";

interface SwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    description?: string;
    disabled?: boolean;
}

export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
    const id = useId();
    const descriptionId = description ? `${id}-description` : undefined;

    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-labelledby={id}
            aria-describedby={descriptionId}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className="flex min-h-8 w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px] text-neutral-200 hover:bg-neutral-800/40 focus-visible:outline focus-visible:outline-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
            <span>
                <span id={id} className="font-medium">{label}</span>
                {description && <span id={descriptionId} className="block text-[10px] text-neutral-400">{description}</span>}
            </span>
            <span aria-hidden className={`flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 ${checked ? "bg-indigo-600" : "bg-neutral-600"}`}>
                <span className={`size-3 rounded-full bg-white ${checked ? "translate-x-3" : ""}`} />
            </span>
        </button>
    );
}
