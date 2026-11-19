import installer from '../../../scripts/install.sh';

interface Env {
    readonly ASSETS: Fetcher;
}

/** Command-line clients get the installer at `/`; browsers get the page. */
const CLI = /^(curl|wget|fetch|httpie|xh|powershell|libfetch|aria2)\b/i;

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const wantsInstaller =
            url.pathname === '/install.sh' ||
            url.pathname === '/install' ||
            (url.pathname === '/' && CLI.test(request.headers.get('user-agent') ?? ''));
        if (wantsInstaller) {
            return new Response(installer, {
                headers: {
                    'content-type': 'text/x-shellscript; charset=utf-8',
                    'cache-control': 'public, max-age=300',
                },
            });
        }
        return env.ASSETS.fetch(request);
    },
} satisfies ExportedHandler<Env>;
