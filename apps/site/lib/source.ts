import { llms, loader } from 'fumadocs-core/source';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { defineDocs } from 'fumadocs-mdx/macro';
import { docsRoute } from './shared';

/** The repository's docs/ folder (copied in by `bun run assets`): the pages GitHub shows. */
const docs = defineDocs({
    dir: 'content/docs',
    docs: {
        schema: pageSchema,
        postprocess: { includeProcessedMarkdown: true },
    },
    meta: { schema: metaSchema },
});

export const source = loader({
    baseUrl: docsRoute,
    source: docs.toFumadocsSource(),
});

/** /llms.txt, /llms-full.txt and each page as Markdown, for agents. */
export const docsLlms = llms(source, {
    renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText('processed')}`,
    renderUrl: (item) => (/^\/.*\.(md|txt)$/.test(item.url) ? `/llms.mdx${item.url}` : item.url),
});
