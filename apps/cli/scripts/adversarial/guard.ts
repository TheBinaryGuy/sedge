/*
 * The harness's own guard: the whole test daemon runs inside a Seatbelt profile that refuses to
 * read anything in the real home folder except what the daemon needs to run (the checkout's code,
 * bun, and the pi agent folder for model access), and inside the checkout the parts that may hold
 * secrets (the dev home `.sedge-dev`, `.claude`, `.git`, any `.env`). It can't connect to Unix
 * sockets in the real home either, such as a real sedge daemon's. So even with sedge's sandbox
 * off, nothing a test talks the agent into can reach the real ~/.ssh, ~/.npmrc, ~/.aws and the like.
 */
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const REAL_HOME = homedir();
const ROOT = resolve(import.meta.dir, '../../../..');

/** Inside the checkout: where secrets may be, which the daemon never needs. */
const ROOT_PRIVATE = ['.sedge-dev', '.claude', '.git'].map((name) => `${ROOT}/${name}`);

const q = (path: string) => `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

export const guardProfile = () =>
    [
        '(version 1)',
        '(allow default)',
        `(deny file-read-data (subpath ${q(REAL_HOME)}))`,
        `(deny file-write* (subpath ${q(REAL_HOME)}))`,
        // No keychain either: sedge's secrets are in a file here, and the real keychain is off limits.
        '(deny mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd") (global-name "com.apple.security.agent"))',
        `(allow file-read-data (subpath ${q(ROOT)}) (subpath ${q(`${REAL_HOME}/.bun`)}) (subpath ${q(`${REAL_HOME}/.pi/agent`)}))`,
        // Later rules win: the checkout's private parts stay closed.
        `(deny file-read-data ${ROOT_PRIVATE.map((p) => `(subpath ${q(p)})`).join(' ')} (regex #"/\\.env[^/]*$"))`,
        // pi may refresh its login and caches in its own folder.
        `(allow file-write* (subpath ${q(`${REAL_HOME}/.pi/agent`)}))`,
        // A real sedge daemon's socket (and any other) in the real home is out of reach.
        `(deny network-outbound (remote unix-socket (subpath ${q(REAL_HOME)})))`,
    ].join('\n');

/** What the daemon has to reach in the real home. */
const NEEDED = [ROOT, `${REAL_HOME}/.bun`, `${REAL_HOME}/.pi/agent`];

/**
 * For worlds with sedge's sandbox on (a sandbox can't be applied inside another, so the guard
 * can't wrap those daemons): everything in the real home except the paths the daemon needs and
 * their ancestors, to list in `sandbox.hidden`. sedge then hides them from commands and file tools.
 */
export const realHomeHidden = (): Array<string> => {
    const ancestors = new Set<string>();
    for (const path of NEEDED) {
        let p = path;
        while (p.startsWith(REAL_HOME) && p !== REAL_HOME) {
            ancestors.add(p);
            p = resolve(p, '..');
        }
    }
    const hidden: Array<string> = [];
    const dirs = [REAL_HOME, ...[...ancestors].filter((a) => !NEEDED.includes(a))];
    for (const dir of dirs) {
        let names: Array<string> = [];
        try {
            names = readdirSync(dir);
        } catch {
            continue;
        }
        for (const name of names) {
            const child = `${dir}/${name}`;
            if (!ancestors.has(child)) hidden.push(child);
        }
    }
    // The checkout's own private parts, and any .env in it outside node_modules.
    const envFiles = [...new Bun.Glob('**/.env*').scanSync({ cwd: ROOT, dot: true })]
        .filter((f) => !f.includes('node_modules') && !f.startsWith('.git/'))
        .map((f) => `${ROOT}/${f}`);
    return [...hidden, ...ROOT_PRIVATE, ...envFiles];
};

export const guarded = (argv: ReadonlyArray<string>) => [
    '/usr/bin/sandbox-exec',
    '-p',
    guardProfile(),
    ...argv,
];

if (import.meta.main) {
    // Self-check: the guard blocks the real home and still lets a nested sandbox-exec run.
    const check = (cmd: string) => {
        const p = Bun.spawnSync(guarded(['/bin/bash', '-c', cmd]), { cwd: '/var/tmp' });
        console.log(
            `$ ${cmd}\n  -> exit ${p.exitCode} ${p.stdout.toString().trim().slice(0, 100)} ${p.stderr.toString().trim().slice(0, 200)}`,
        );
    };
    check(`cat ${REAL_HOME}/.npmrc >/dev/null && echo READABLE || echo blocked`);
    check(`ls ${REAL_HOME} >/dev/null && echo LISTABLE || echo blocked`);
    check(`ls ${REAL_HOME}/.ssh >/dev/null && echo LISTABLE || echo blocked`);
    check(`ls ${REAL_HOME}/.pi/agent >/dev/null && echo pi-agent-listable`);
    check(`cat ${ROOT}/.sedge-dev/.env >/dev/null && echo READABLE || echo blocked`);
    check(`cat ${REAL_HOME}/.ssh/* >/dev/null && echo READABLE || echo blocked`);
    check(`ls ${ROOT}/.sedge-dev >/dev/null && echo LISTABLE || echo blocked`);
    check(`cat ${ROOT}/package.json >/dev/null && echo checkout-readable`);
    // A socket of our own in the real home stands in for a real daemon's (never touched).
    const sock = `${ROOT}/.adv-guard-test.sock`;
    const { rmSync } = await import('node:fs');
    rmSync(sock, { force: true });
    const listener = Bun.listen({ unix: sock, socket: { data() {} } });
    const p = Bun.spawn(
        guarded([
            process.execPath,
            '-e',
            `await Bun.connect({unix: ${JSON.stringify(sock)}, socket: {data(){}}}).then(s => (s.end(), console.log('CONNECTED')), () => console.log('blocked'))`,
        ]),
        { cwd: '/var/tmp', stdout: 'pipe', stderr: 'pipe' },
    );
    await p.exited;
    console.log(
        `$ connect to a unix socket in the real home\n  -> ${(await new Response(p.stdout).text()).trim()}`,
    );
    listener.stop(true);
    rmSync(sock, { force: true });
    check(`bun --version`);
    check('security find-generic-password -s sedge-adv-nonexistent-item 2>&1 | head -1');
    check('curl -s -o /dev/null -w "%{http_code}" https://example.com');
    check(
        `/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny file-write* (subpath "/var/tmp/sadv"))' /bin/bash -c 'echo nested-ok; touch /var/tmp/sadv/x && echo WROTE || echo nested-deny-works'`,
    );
}
