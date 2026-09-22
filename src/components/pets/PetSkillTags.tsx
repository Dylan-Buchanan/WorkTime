import React, { useMemo } from "react";
import { MultiSelect } from "../MultiSelect";
import type { PetTrainingSkill } from "../../state/types";

interface PetSkillMultiSelectProps {
    label: string;
    skills: readonly PetTrainingSkill[];
    value: string[];
    onChange: (next: string[]) => void;
}

function unknownSkillLabel(id: string): string {
    return `Unknown skill (${id})`;
}

/** The shared picker for new and existing training-session tags. */
export const PetSkillMultiSelect: React.FC<PetSkillMultiSelectProps> = ({ label, skills, value, onChange }) => {
    const options = useMemo(() => {
        const knownIds = new Set(skills.map((skill) => skill.id));
        return [
            ...skills.map((skill) => ({ value: skill.id, label: skill.label })),
            ...value.filter((id) => !knownIds.has(id)).map((id) => ({ value: id, label: unknownSkillLabel(id) })),
        ];
    }, [skills, value]);

    return <MultiSelect label={label} minWidth="min-w-[12rem]" options={options} value={value} onChange={onChange} />;
};

/** Renders every stored id; dangling ids intentionally remain visible. */
export const PetSkillTags: React.FC<{ skillIds?: readonly string[]; skills: readonly PetTrainingSkill[] }> = ({
    skillIds,
    skills,
}) => {
    if (!skillIds?.length) return <span className="text-[11px] text-neutral-500">Untagged</span>;
    const labels = new Map(skills.map((skill) => [skill.id, skill.label]));
    return (
        <span className="flex flex-wrap gap-1">
            {skillIds.map((id, index) => (
                <span key={`${id}-${index}`} className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300">
                    {labels.get(id) ?? unknownSkillLabel(id)}
                </span>
            ))}
        </span>
    );
};
