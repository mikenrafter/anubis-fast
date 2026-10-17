/**
 * Live-test helpers: a real Anubis (from nixpkgs, on PATH in `nix develop`) in
 * front of a small local site, and a Firefox (see firefox-addon-live) with
 * Anubis Fast loaded from `build/extension/`. Firefox reaches the site as
 * `http://forge.example/` through the harness proxy's `upstreams`.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, request, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { addonButtonId, FirefoxSession, waitFor, type FirefoxSessionOptions } from 'firefox-addon-live'

export const EXTENSION_ID = 'anubis-fast@mikenrafter'
export const EXTENSION_SOURCE = resolve(import.meta.dirname, '../../build/extension')
export const TOOLBAR_BUTTON = addonButtonId(EXTENSION_ID, 'browserAction')

/** Hostname Firefox uses for the protected site. */
export const SITE_HOST = 'forge.example'
export const SITE_URL = `http://${SITE_HOST}/`
/** Title of the origin's page, i.e. what Firefox shows once the challenge is passed. */
export const SITE_TITLE = 'tools/anubis-fast · Forge'
/** Title Anubis gives its challenge page. */
export const CHALLENGE_TITLE = 'Making sure you\'re not a bot!'

export type SolverMode = 'native' | 'wasm' | 'spoof' | 'javascript'
export const BADGES: Record<SolverMode, string> = { native: 'N', wasm: 'W', spoof: 'UA', javascript: 'JS' }

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

export interface ProtectedSite {
	/** Anubis' own address, for `upstreams`. */
	anubis: string
	stop(): Promise<void>
}

/**
 * Starts the origin site and a real Anubis in front of it. Every request with
 * a browser User-Agent gets a "fast" proof-of-work challenge at `difficulty`.
 */
export async function startProtectedSite(difficulty = 4): Promise<ProtectedSite> {
	const disposers: Array<() => Promise<void>> = []
	const stop = async () => {
		for (const dispose of disposers.reverse()) await dispose().catch(() => undefined)
	}
	try {
		const origin = await listen(createServer((_request, response) => {
			response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
			response.end(SITE_PAGE)
		}))
		disposers.push(() => new Promise<void>((done) => origin.close(() => done())))

		const directory = await mkdtemp(join(tmpdir(), 'anubis-fast-live-'))
		disposers.push(() => rm(directory, { recursive: true, force: true }))
		const policy = join(directory, 'policy.yaml')
		await writeFile(policy, [
			'bots:',
			'  - name: browsers',
			'    user_agent_regex: Mozilla',
			'    action: CHALLENGE',
			'    challenge:',
			`      difficulty: ${difficulty}`,
			'      algorithm: fast',
			'',
		].join('\n'))

		const [port, metricsPort] = [await freePort(), await freePort()]
		const anubis = `http://127.0.0.1:${port}`
		const child: ChildProcess = spawn('anubis', [
			'-bind', `127.0.0.1:${port}`,
			'-metrics-bind', `127.0.0.1:${metricsPort}`,
			'-target', `http://127.0.0.1:${(origin.address() as AddressInfo).port}`,
			'-policy-fname', policy,
			'-difficulty', String(difficulty),
			// Plain http on a made-up hostname: secure or partitioned cookies would be dropped.
			'-cookie-secure=false',
			'-cookie-partitioned=false',
			'-use-remote-address',
			'-slog-level', 'WARN',
		], { stdio: ['ignore', 'ignore', 'pipe'] })
		let log = ''
		child.stderr?.on('data', (chunk: Buffer) => { log += chunk.toString() })
		let exited: string | undefined
		child.once('error', (error) => { exited = `Could not start anubis (use nix develop): ${error.message}` })
		child.once('exit', (code) => { exited ??= `anubis exited (${code}): ${log}` })
		disposers.push(() => new Promise<void>((done) => {
			if (child.exitCode !== null || child.signalCode !== null) return done()
			child.once('exit', () => done())
			child.kill()
		}))
		await waitFor(async () => {
			if (exited) throw new Error(exited)
			return await status(`${anubis}/`).catch(() => undefined)
		}, 20_000, 'Anubis never answered')
		return { anubis, stop }
	} catch (error) {
		await stop()
		throw error
	}
}

/** Run `npm run build:solver && npm run build:extension` first; the add-on loads from `build/extension/`. */
export function startAnubisFast(site: ProtectedSite, options: Omit<FirefoxSessionOptions, 'addon'> = {}): Promise<FirefoxSession> {
	return FirefoxSession.start({
		...options,
		upstreams: { [SITE_HOST]: site.anubis, ...options.upstreams },
		addon: { source: EXTENSION_SOURCE, id: EXTENSION_ID },
	})
}

/** The toolbar badge text: N, W, UA or JS. */
export async function badgeText(session: FirefoxSession): Promise<string> {
	return await session.asExtension('return browser.browserAction.getBadgeText({})') as string
}

/**
 * Clicks the toolbar button until the badge shows `mode`, as a user would.
 * Pass `click` to supply the click (e.g. a gliding real click for captures).
 */
export async function chooseSolverMode(session: FirefoxSession, mode: SolverMode, click = () => session.realClick(TOOLBAR_BUTTON)): Promise<void> {
	for (let attempt = 0; attempt < 4; attempt++) {
		if (await badgeText(session) === BADGES[mode]) return
		await click()
		await sleep(300)
	}
	if (await badgeText(session) !== BADGES[mode]) throw new Error(`Solver mode never became ${mode}`)
}

/** Clears Anubis' cookies so the next visit is challenged again. */
export async function forgetPass(session: FirefoxSession): Promise<void> {
	await session.chrome('Services.cookies.removeAll(); return true')
}

/**
 * Opens the protected site in a new selected tab without waiting for it to
 * load (the challenge page and the site share a URL).
 */
export async function visitSite(session: FirefoxSession): Promise<void> {
	await session.chrome(`
		gBrowser.selectedTab = gBrowser.addTab(arguments[0], {
			triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
		})
		return true`, [SITE_URL])
}

/**
 * Title and URL of the selected tab, read from the browser chrome: page
 * scripts (including Marionette's) don't run with JavaScript disabled.
 */
export async function selectedPage(session: FirefoxSession): Promise<{ title: string, url: string, loading: boolean }> {
	return await session.chrome(`
		const browser = gBrowser.selectedBrowser
		return { title: browser.contentTitle, url: browser.currentURI.spec, loading: Boolean(browser.webProgress?.isLoadingDocument) }`) as { title: string, url: string, loading: boolean }
}

export async function waitForTitle(session: FirefoxSession, title: string, timeoutMs = 30_000): Promise<void> {
	await waitFor(async () => {
		const page = await selectedPage(session)
		return page.title === title && !page.loading ? true : undefined
	}, timeoutMs, `The page never showed "${title}"`)
}

/**
 * Text of the selected page's body. Read by an extension content script, which
 * still runs with page JavaScript off (Marionette's page scripts don't).
 */
export async function pageText(session: FirefoxSession): Promise<string> {
	return await session.asExtension(`
		const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
		const [text] = await browser.tabs.executeScript(tab.id, { code: 'document.body?.innerText ?? ""' })
		return text ?? ''`) as string
}

async function listen(server: Server): Promise<Server> {
	await new Promise<void>((done, fail) => {
		server.once('error', fail)
		server.listen(0, '127.0.0.1', () => done())
	})
	return server
}

async function freePort(): Promise<number> {
	const server = await listen(createServer())
	const { port } = server.address() as AddressInfo
	await new Promise<void>((done) => server.close(() => done()))
	return port
}

function status(url: string): Promise<number> {
	return new Promise((done, fail) => {
		request(url, { headers: { 'user-agent': 'curl/8' } }, (response) => {
			response.resume()
			done(response.statusCode ?? 0)
		}).on('error', fail).end()
	})
}

/** A small code-forge page, the kind of site Anubis usually guards. */
const SITE_PAGE = `<!doctype html><meta charset="utf-8"><title>${SITE_TITLE.replace('·', '&middot;')}</title>
<style>
	body { margin: 0; font: 15px system-ui, sans-serif; background: #f6f8fa; color: #1f2328; }
	header { display: flex; align-items: center; gap: 10px; padding: 14px 28px; background: #24292f; color: white; font-weight: 600; }
	header i { width: 22px; height: 22px; border-radius: 6px; background: #e8743b; display: inline-block; }
	main { max-width: 640px; margin: 28px auto; padding: 0 24px; }
	h1 { font-size: 22px; font-weight: 500; margin: 0 0 16px; }
	h1 b { font-weight: 600; }
	.files { background: white; border: 1px solid #d0d7de; border-radius: 8px; }
	.files div { display: flex; justify-content: space-between; padding: 9px 16px; border-top: 1px solid #d8dee4; font-size: 14px; }
	.files div:first-child { border-top: 0; background: #f6f8fa; border-radius: 8px 8px 0 0; color: #59636e; }
	.files span:last-child { color: #59636e; }
	.readme { margin-top: 18px; background: white; border: 1px solid #d0d7de; border-radius: 8px; padding: 14px 18px; }
	.readme h2 { margin: 0 0 6px; font-size: 18px; }
	.readme p { margin: 0; color: #424a53; }
</style>
<header><i></i>Forge</header>
<main>
	<h1>tools / <b>anubis-fast</b></h1>
	<section class="files">
		<div><span>main · 42 commits</span><span>2 days ago</span></div>
		<div><span>extension/</span><span>feat: solver mode toggle</span></div>
		<div><span>native/</span><span>native messaging host</span></div>
		<div><span>wasm/</span><span>Go/WASM solver</span></div>
		<div><span>README.md</span><span>docs: demo</span></div>
	</section>
	<section class="readme">
		<h2>You're through.</h2>
		<p>This page sits behind Anubis. Anubis Fast solved its proof-of-work challenge for you.</p>
	</section>
</main>`
