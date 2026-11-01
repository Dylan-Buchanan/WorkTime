import type { DeckPlan, DeckSlide } from "./types";

export interface DeckCopyFieldChange {
    label: string;
    before: string;
    after: string;
}

export interface DeckSlideCopyChange {
    slideId: string;
    slideTitle: string;
    fields: DeckCopyFieldChange[];
}

function copyFields(slide: DeckSlide): Record<string, string> {
    const fields: Record<string, string> = { "Slide title": slide.title, "Speaker notes": slide.notes };
    switch (slide.kind) {
        case "title":
            fields.Purpose = slide.purpose;
            break;
        case "recap":
            fields.Did = slide.did;
            fields.Current = slide.current;
            fields["Miss reason"] = slide.missReason;
            slide.planned.forEach((item, index) => { fields[`Planned item ${index + 1}`] = item.text; });
            break;
        case "misses":
            slide.items.forEach((item, index) => {
                fields[`Miss ${index + 1} text`] = item.text;
                fields[`Miss ${index + 1} reason`] = item.reason;
            });
            break;
        case "next-plans":
            slide.items.forEach((item, index) => { fields[`Next plan ${index + 1}`] = item.text; });
            break;
        case "closing":
            slide.commitments.forEach((item, index) => { fields[`Commitment ${index + 1}`] = item.text; });
            break;
    }
    return fields;
}

/** Exact copy changes for one pass, matched by slide ID; derived values are ignored. */
export function findDeckCopyChanges(before: DeckPlan, after: DeckPlan): DeckSlideCopyChange[] {
    const previous = new Map(before.slides.map(slide => [slide.id, slide]));
    return after.slides.flatMap(slide => {
        const original = previous.get(slide.id);
        if (!original || original.kind !== slide.kind) return [];
        const oldFields = copyFields(original);
        const fields = Object.entries(copyFields(slide)).flatMap(([label, value]) =>
            oldFields[label] !== undefined && oldFields[label] !== value
                ? [{ label, before: oldFields[label], after: value }] : []);
        return fields.length ? [{ slideId: slide.id, slideTitle: slide.title, fields }] : [];
    });
}
