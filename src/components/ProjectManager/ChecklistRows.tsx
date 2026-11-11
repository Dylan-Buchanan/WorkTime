import { useId, type CSSProperties, type ReactNode, type Ref } from "react";
import type { ChecklistItem } from "../../lib/pm/checklistOrder";

export function ChecklistZones({ open, done }: { open?: ReactNode; done?: ReactNode }) {
    return (
        <div className="space-y-1">
            {open && <div className="space-y-1">{open}</div>}
            {open && done && <hr className="border-neutral-800" />}
            {done && <div className="space-y-1">{done}</div>}
        </div>
    );
}

export function ChecklistRow({ item, onToggle, handle, rowRef, style }: {
    item: ChecklistItem;
    onToggle: (id: string) => void;
    handle?: ReactNode;
    rowRef?: Ref<HTMLDivElement>;
    style?: CSSProperties;
}) {
    const checkboxId = useId();
    return (
        <div ref={rowRef} style={style} className="flex items-center gap-2 rounded border border-neutral-800 bg-neutral-900 px-1 text-[11px]">
            <div className="flex size-9 shrink-0 items-center justify-center">{handle}</div>
            <input id={checkboxId} type="checkbox" checked={item.done} onChange={() => onToggle(item.id)} />
            <label htmlFor={checkboxId} className={`min-w-0 flex-1 break-words py-2 pr-1 ${item.done ? "line-through opacity-60" : ""}`}>
                {item.title}
            </label>
        </div>
    );
}
