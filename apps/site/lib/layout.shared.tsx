import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Logo } from '@/components/logo';
import { repositoryUrl, siteName } from './shared';

export function baseOptions(): BaseLayoutProps {
    return {
        nav: {
            title: (
                <span className="inline-flex items-center gap-2 font-semibold">
                    <Logo className="h-4 w-auto text-fd-primary" />
                    {siteName}
                </span>
            ),
        },
        links: [{ text: 'Docs', url: '/docs', active: 'nested-url' }],
        githubUrl: repositoryUrl,
    };
}
