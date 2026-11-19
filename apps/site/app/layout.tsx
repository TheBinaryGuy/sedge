import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Provider } from '@/components/provider';
import { siteName, siteUrl, socialImageUrl, tagline } from '@/lib/shared';
import './global.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
    metadataBase: new URL(siteUrl),
    title: { default: siteName, template: `%s · ${siteName}` },
    description: tagline.title,
    icons: { icon: '/favicon.svg' },
    openGraph: {
        type: 'website',
        siteName,
        url: '/',
        title: siteName,
        description: tagline.title,
        images: { url: socialImageUrl(), width: 1200, height: 630, alt: tagline.title },
    },
    twitter: { card: 'summary_large_image' },
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
