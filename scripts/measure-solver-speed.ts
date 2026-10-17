/**
 * Times each solver mode against a real Anubis in a live Firefox, for the
 * README's solver speed table.
 *
 * For every run it clears Anubis' cookies, opens http://forge.example/ (page
 * JavaScript off, so only Anubis Fast solves) and records, from a small proxy
 * in front of Anubis:
 *   - total: first request for the page (which gets the challenge) to the
 *     request that gets the unlocked page;
 *   - solve: the `elapsedTime` Anubis Fast reports to Anubis (WASM and
 *     JavaScript only; Native solves outside the browser).
 *
 * Usage (inside `nix develop`):
 *   npm run measure:solvers -- [--runs 10] [--difficulty 4] [wasm javascript …]
 *
 * Native mode needs the host: set ANUBIS_FAST_HOST to an `anubis-fast-host`
 * (e.g. `$(nix build --print-out-paths)/bin/anubis-fast-host`). Its manifest
 * is written under a temporary HOME used only by this Firefox, never to
 * ~/.mozilla. The host reaches forge.example through HTTP_PROXY, pointed at
 * the local Anubis.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, request, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { waitFor, type FirefoxSession } from 'firefox-addon-live'
import {
	EXTENSION_ID,
	SITE_HOST,
	SITE_TITLE,
	SITE_URL,
	chooseSolverMode,
	forgetPass,
	selectedPage,
	startAnubisFast,
	startProtectedSite,
	visitSite,
	type SolverMode,
} from '../tests/live/anubisFast'

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		runs: { type: 'string', default: '10' },
		difficulty: { type: 'string', default: '4' },
	},
})
const runs = Number(values.runs)
const difficulty = Number(values.difficulty)
const nativeHost = process.env.ANUBIS_FAST_HOST
const modes = (positionals.length > 0 ? positionals : [...nativeHost ? ['native'] : [], 'wasm', 'javascript']) as SolverMode[]
if (modes.includes('native') && !nativeHost) throw new Error('Native mode needs ANUBIS_FAST_HOST (see the comment at the top)')
if (modes.includes('spoof')) throw new Error('UA spoof only rewrites https:// requests; the local site is http://')

interface Run { total: number, solve: number | undefined }

const site = await startProtectedSite(difficulty)
const recorder = await startRecorder(site.anubis)
const home = await mkdtemp(join(tmpdir(), 'anubis-fast-home-'))
let session: FirefoxSession | undefined
const results = new Map<SolverMode, Run[]>()
try {
	if (nativeHost) {
		for (const directory of [join(home, '.mozilla/native-messaging-hosts'), join(home, '.config/mozilla/native-messaging-hosts')]) {
			await mkdir(directory, { recursive: true })
			await writeFile(join(directory, 'anubis_fast.json'), JSON.stringify({
				name: 'anubis_fast',
				description: 'Native Anubis proof-of-work bridge',
				path: nativeHost,
				type: 'stdio',
				allowed_extensions: [EXTENSION_ID],
			}))
		}
	}
	// Firefox, and the native host it starts, inherit these.
	const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, HTTP_PROXY: process.env.HTTP_PROXY }
	Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), HTTP_PROXY: site.anubis })
	try {
		session = await startAnubisFast(site, {
			width: 800,
			height: 562,
			upstreams: { [SITE_HOST]: recorder.url },
			prefs: { 'javascript.enabled': false },
		})
	} finally {
		for (const [name, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[name]
			else process.env[name] = value
		}
	}
	for (const mode of modes) {
		await chooseSolverMode(session, mode)
		// One unrecorded warm-up run per mode (worker start-up, native host launch).
		for (let run = -1; run < runs; run++) {
			const result = await timeOneRun(session)
			if (mode === 'native' && result.solve !== undefined) throw new Error('Native mode fell back to the browser solver')
			if (run >= 0) results.set(mode, [...results.get(mode) ?? [], result])
			console.error(`${mode} ${run < 0 ? 'warm-up' : `#${run + 1}`}: total ${result.total} ms, solve ${result.solve ?? '-'} ms`)
		}
	}
} finally {
	await session?.close()
	await new Promise<void>((done) => recorder.server.close(() => done()))
	await site.stop()
	await rm(home, { recursive: true, force: true })
}

const names: Record<SolverMode, string> = { native: 'Native', wasm: 'WASM', spoof: 'User-Agent spoof', javascript: 'JavaScript' }
console.log(`\nDifficulty ${difficulty}, ${runs} runs per mode (medians; min–max in brackets)\n`)
console.log('| Solver | Challenge to unlocked page | Solve only |')
console.log('| --- | --- | --- |')
for (const [mode, list] of results) {
	const solves = list.map((run) => run.solve).filter((solve): solve is number => solve !== undefined)
	console.log(`| ${names[mode]} | ${summary(list.map((run) => run.total))} | ${solves.length > 0 ? summary(solves) : 'n/a'} |`)
}

async function timeOneRun(session: FirefoxSession): Promise<Run> {
	await forgetPass(session)
	recorder.requests.length = 0
	await visitSite(session)
	await waitFor(async () => {
		const page = await selectedPage(session)
		return page.title === SITE_TITLE && !page.loading ? true : undefined
	}, 120_000, 'The site never unlocked')
	await session.chrome('gBrowser.removeTab(gBrowser.selectedTab, { animate: false }); return true')
	const pageLoads = recorder.requests.filter((request) => request.path === '/')
	if (pageLoads.length < 2) throw new Error(`Expected a challenged and an unlocked load, got ${JSON.stringify(recorder.requests)}`)
	const pass = recorder.requests.find((request) => request.path.includes('/api/pass-challenge'))
	const elapsed = pass ? new URL(pass.path, SITE_URL).searchParams.get('elapsedTime') : null
	return {
		total: Math.round(pageLoads.at(-1)!.at - pageLoads[0]!.at),
		solve: elapsed === null ? undefined : Number(elapsed),
	}
}

/**
 * Sits between Firefox's proxy and Anubis and notes when each request
 * arrives, so runs are timed from the network side.
 */
async function startRecorder(upstream: string): Promise<{ server: Server, url: string, requests: Array<{ path: string, at: number }> }> {
	const requests: Array<{ path: string, at: number }> = []
	const server = createServer((incoming, response) => {
		const path = incoming.url ?? '/'
		requests.push({ path, at: performance.now() })
		const forward = request(new URL(path, upstream), { method: incoming.method, headers: incoming.headers }, (reply) => {
			response.writeHead(reply.statusCode ?? 502, reply.headers)
			reply.pipe(response)
		})
		forward.on('error', () => response.writeHead(502).end())
		incoming.pipe(forward)
	})
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()))
	return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests }
}

function summary(values: number[]): string {
	const sorted = [...values].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	const median = sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
	return `${format(median)} (${format(sorted[0]!)}–${format(sorted.at(-1)!)})`
}

function format(ms: number): string {
	return ms >= 1_000 ? `${(ms / 1_000).toFixed(2)} s` : `${ms} ms`
}
