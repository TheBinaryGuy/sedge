'use client';
import { ImageZoom } from 'fumadocs-ui/components/image-zoom';

const ALT =
    'How sedge works: channels, signals, timers and the terminal put events into the inbox; a durable run works with memory, skills, MCP servers, tools and approvals; what it sends leaves through the outbox to you, and your reply comes back as an event.';

/** The README's diagram, in the theme's version; click to see it full size. */
export function Diagram() {
    return (
        <div className="mb-10 overflow-hidden rounded-2xl border">
            <ImageZoom
                src="/docs/architecture-light.svg"
                alt={ALT}
                width={1200}
                height={660}
                className="w-full dark:hidden"
            />
            <ImageZoom
                src="/docs/architecture-dark.svg"
                alt={ALT}
                width={1200}
                height={660}
                className="hidden w-full dark:block"
            />
        </div>
    );
}
