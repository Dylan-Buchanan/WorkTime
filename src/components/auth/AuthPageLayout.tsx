import React from "react";

export function AuthPageLayout({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
    return (
        <main className="min-h-screen flex items-center justify-center bg-neutral-950 px-4 py-8 text-neutral-200">
            <section className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl sm:p-8">
                <div className="mb-6 text-center">
                    <p className="mb-2 text-xs uppercase tracking-[0.3em] text-neutral-500">WorkTime</p>
                    <h1 className="text-xl font-semibold text-neutral-100">{title}</h1>
                </div>
                {children}
            </section>
        </main>
    );
}
