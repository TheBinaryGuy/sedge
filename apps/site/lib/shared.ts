export const siteName = 'sedge';
export const siteUrl = 'https://sedge.sh';
export const docsRoute = '/docs';
export const repository = { user: 'sedge-hq', repo: 'sedge', branch: 'main' };
export const repositoryUrl = `https://github.com/${repository.user}/${repository.repo}`;

/** What the home page says first, and its social image. */
export const tagline = {
    title: 'An always-on agent that lives on your machine.',
    description:
        'sedge is a coding agent with a daemon behind it that keeps working after you close the terminal.',
};

/** The social image for a page: `/og/image.png` for the home page. */
export const socialImageUrl = (slugs: ReadonlyArray<string> = []) =>
    ['/og', ...slugs, 'image.png'].join('/');
