import React from "react";

export const SidebarProjectSkeleton: React.FC = () => (
    <div className="animate-pulse flex items-center gap-2 py-1">
        <div className="w-3 h-3 rounded-full bg-neutral-500/30" />
        <div className="h-3 flex-1 bg-neutral-500/30 rounded" />
    </div>
);

export const TaskRowSkeleton: React.FC = () => (
    <div className="animate-pulse grid grid-cols-[16px_1fr_60px] items-center gap-2 py-2 text-xs">
        <div className="w-4 h-4 rounded bg-neutral-500/30" />
        <div className="h-3 bg-neutral-500/30 rounded" />
        <div className="h-3 bg-neutral-500/30 rounded" />
    </div>
);

export const InspectorSkeleton: React.FC = () => (
    <div className="p-4 animate-pulse space-y-3">
        <div className="h-5 bg-neutral-500/30 rounded w-2/3" />
        <div className="h-4 bg-neutral-500/30 rounded w-1/2" />
        <div className="h-24 bg-neutral-500/30 rounded" />
    </div>
);
