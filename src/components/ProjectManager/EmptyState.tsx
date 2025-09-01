import React from "react";

export const EmptyState: React.FC<{
    title: string;
    description?: string;
    action?: React.ReactNode;
}> = ({ title, description, action }) => {
    return (
        <div className="flex flex-col items-center justify-center text-center p-6 gap-3 text-sm opacity-80">
            <div className="text-base font-medium">{title}</div>
            {description && (
                <div className="max-w-sm text-xs leading-relaxed">
                    {description}
                </div>
            )}
            {action}
        </div>
    );
};
