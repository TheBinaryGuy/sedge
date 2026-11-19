'use client';
import { useState } from 'react';

/** The install command, with a button that copies it. */
export function CopyCommand({ command }: { command: string }) {
    const [label, setLabel] = useState('Copy');
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(command);
            setLabel('Copied');
        } catch {
            setLabel('Press ⌘C');
        }
        setTimeout(() => setLabel('Copy'), 1600);
    };
    return (
        <div className="flex items-center gap-3 rounded-xl border bg-fd-card py-3 pr-3 pl-4 font-mono text-[15px]">
            <code className="flex-1 overflow-x-auto whitespace-nowrap">
                <span className="text-fd-muted-foreground select-none">$ </span>
                {command}
            </code>
            <button
                type="button"
                onClick={() => void copy()}
                aria-label="Copy the install command"
                className="min-w-16 rounded-md border px-2.5 py-1.5 font-sans text-[13px] hover:border-fd-muted-foreground focus-visible:outline-2 focus-visible:outline-fd-ring"
            >
                {label}
            </button>
        </div>
    );
}
