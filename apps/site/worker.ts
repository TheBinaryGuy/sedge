import installer from '../../../scripts/install.sh';

interface Env {
    readonly ASSETS: Fetcher;
}

/** Command-line clients get the installer at `/`; browsers get the page. */
const CLI = /^(curl|wget|fetch|httpie|xh|powershell|libfetch|aria2)\b/i;

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
        // One canonical address: plain HTTP and www. both go to https://sedge.sh in one hop, the
        // installer included (`curl -fsSL sedge.sh` follows redirects with -L).
        if (!local && (url.protocol === 'http:' || url.hostname.startsWith('www.'))) {
            url.protocol = 'https:';
            url.hostname = url.hostname.replace(/^www\./, '');
            return Response.redirect(url.toString(), 301);
        }
        const response = await serve(request, url, env);
        const secured = new Response(response.body, response);
        secured.headers.set('strict-transport-security', 'max-age=31536000');
        return secured;
    },
} satisfies ExportedHandler<Env>;

async function serve(request: Request, url: URL, env: Env): Promise<Response> {
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
}
