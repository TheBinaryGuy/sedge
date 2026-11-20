import Link from 'next/link';
import { CopyCommand } from '@/components/copy-command';
import { Diagram } from '@/components/diagram';
import { Logo } from '@/components/logo';
import { repositoryUrl, tagline } from '@/lib/shared';

const POINTS = [
    {
        title: 'It keeps going.',
        text: 'A daemon wakes for each event (a message, a timer, a webhook, a sensor, your CI failing), does the work, and sleeps again. A run a restart cuts short picks up where it stopped.',
    },
    {
        title: 'It reaches you.',
        text: 'Write to it on Telegram or Slack. It answers there, and asks before anything risky with Approve and Deny buttons.',
    },
    {
        title: 'It stays quiet.',
        text: 'Conditions, throttles and a cheap triage model drop the events that need nothing, so you hear about what matters.',
    },
    {
        title: 'It stays within bounds.',
        text: 'Optional limits on runs and spend, and an OS sandbox that keeps its commands away from your credentials.',
    },
    {
        title: 'It remembers.',
        text: 'A small memory it keeps itself, checked against what happened every night.',
    },
    {
        title: "It's a coding agent.",
        text: 'The TUI is pi, with its models, commands, MCP servers and skills. The daemon gets your MCP servers and skills too.',
    },
];

export default function HomePage() {
    return (
        <main className="relative flex flex-1 justify-center px-4 py-16 sm:py-24">
            <div
                aria-hidden="true"
                className="dot-field pointer-events-none absolute inset-x-0 top-0 h-40"
            />
            <div className="relative w-full max-w-xl">
                <Logo className="mb-7 h-11 w-auto text-fd-primary" />
                <h1 className="mb-2 text-[28px] leading-tight font-semibold tracking-tight text-balance">
                    {tagline.title}
                </h1>
                <p className="mb-8 text-fd-muted-foreground text-pretty">{tagline.description}</p>
                <CopyCommand command="curl -fsSL sedge.sh | sh" />
                <p className="mt-3 mb-10 text-sm text-fd-muted-foreground">
                    or{' '}
                    <code className="font-mono text-[13px] text-fd-foreground">
                        npm i -g @sedge-hq/sedge
                    </code>
                </p>
                <ul className="mb-10 grid gap-3.5">
                    {POINTS.map((point) => (
                        <li key={point.title}>
                            <strong className="font-semibold">{point.title}</strong>{' '}
                            <span className="text-fd-muted-foreground">{point.text}</span>
                        </li>
                    ))}
                </ul>
                <Diagram />
                <footer className="flex gap-4 text-sm text-fd-muted-foreground">
                    <Link href="/docs" className="hover:text-fd-foreground">
                        Docs
                    </Link>
                    <a href={repositoryUrl} className="hover:text-fd-foreground">
                        GitHub
                    </a>
                    <a href={`${repositoryUrl}/releases`} className="hover:text-fd-foreground">
                        Releases
                    </a>
                    <span>MIT</span>
                </footer>
            </div>
        </main>
    );
}
