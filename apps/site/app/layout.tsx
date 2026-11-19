import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Provider } from '@/components/provider';
import { siteUrl } from '@/lib/shared';
import './global.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
    metadataBase: new URL(siteUrl),
    title: { default: 'sedge', template: '%s · sedge' },
    description: 'An always-on agent that lives on your machine.',
    icons: { icon: '/favicon.svg' },
};

export default function Layout({ children }: LayoutProps<'/'>) {
    return (
        <html
            lang="en"
            className={`${sans.variable} ${mono.variable} font-sans`}
            suppressHydrationWarning
        >
            <body className="flex min-h-screen flex-col">
                <Provider>{children}</Provider>
            </body>
        </html>
    );
}
