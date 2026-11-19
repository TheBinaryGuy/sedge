import { notFound } from 'next/navigation';
import { socialImage } from '@/lib/og';
import { tagline } from '@/lib/shared';
import { source } from '@/lib/source';

export const dynamic = 'force-static';
export const dynamicParams = false;

/** `/og/image.png` for the home page, `/og/docs/<page>/image.png` for each docs page. */
export async function GET(_request: Request, props: RouteContext<'/og/[...slug]'>) {
    const { slug } = await props.params;
    const path = slug.slice(0, -1);
    if (path.length === 0) {
        return socialImage({ title: tagline.title, description: tagline.description });
    }
    const page = path[0] === 'docs' ? source.getPage(path.slice(1)) : undefined;
    if (!page) notFound();
    return socialImage({
        title: page.data.title,
        description: page.data.description,
        section: 'docs',
    });
}

export function generateStaticParams() {
    return [
        { slug: ['image.png'] },
        ...source.getPages().map((page) => ({ slug: ['docs', ...page.slugs, 'image.png'] })),
    ];
}
