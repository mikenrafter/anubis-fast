/**
 * With page JavaScript turned off (`javascript.enabled` false, as NoScript or
 * uBlock Origin's "block JavaScript" would), Anubis' own challenge script never
 * runs. Anubis Fast's content and background scripts still solve a real Anubis
 * "fast" challenge and land on the protected site, in WASM and JavaScript mode.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { waitFor, type FirefoxSession } from 'firefox-addon-live'
import {
	CHALLENGE_TITLE,
	SITE_TITLE,
	SITE_URL,
	TOOLBAR_BUTTON,
	badgeText,
	chooseSolverMode,
	forgetPass,
	pageText,
	selectedPage,
	startAnubisFast,
	startProtectedSite,
	visitSite,
	waitForTitle,
	type ProtectedSite,
	type SolverMode,
} from './anubisFast'

let site: ProtectedSite
let session: FirefoxSession

beforeAll(async () => {
	site = await startProtectedSite(4)
	session = await startAnubisFast(site, {
		width: 800,
		height: 562,
		prefs: { 'javascript.enabled': false },
	})
}, 120_000)

afterAll(async () => {
	await session?.close()
	await site?.stop()
})

// Runs first: the later tests change the saved solver.
describe('fresh install', () => {
	it('starts in WASM mode with no saved choice', async () => {
		// AMO users have no native helper, so the default must be a solver that ships in the add-on.
		expect(await badgeText(session)).toBe('W')
		expect(await session.asExtension('return (await browser.storage.local.get("solverMode")).solverMode')).toBeNull()
	})
})

describe('page JavaScript disabled', () => {
	it('runs with javascript.enabled off', async () => {
		expect(await session.chrome('return Services.prefs.getBoolPref("javascript.enabled")')).toBe(false)
	})

	for (const mode of ['wasm', 'javascript'] satisfies SolverMode[]) {
		it(`solves the challenge in ${mode} mode`, async () => {
			await chooseSolverMode(session, mode)
			await forgetPass(session)
			await visitSite(session)
			// The challenge page comes first, relabelled by the content script.
			let sawChallenge = false
			let sawStatus = false
			let statusCopies = 0
			const deadline = Date.now() + 60_000
			while (Date.now() < deadline) {
				const page = await selectedPage(session)
				if (page.title === CHALLENGE_TITLE) {
					sawChallenge = true
					const text = await pageText(session).catch(() => '')
					if (text.includes('FAST ANUBIS')) sawStatus = true
					statusCopies = Math.max(statusCopies, text.split('FAST ANUBIS solver using').length - 1)
				}
				if (page.title === SITE_TITLE && !page.loading) break
				await new Promise((done) => setTimeout(done, 50))
			}
			await waitForTitle(session, SITE_TITLE, 1_000)
			expect(sawChallenge).toBe(true)
			expect(sawStatus).toBe(true)
			// One status line, not one per Anubis placeholder (#status, the script-error box, <noscript>).
			expect(statusCopies).toBe(1)
			expect((await selectedPage(session)).url).toBe(SITE_URL)
			expect(await pageText(session)).toContain('Anubis Fast solved its proof-of-work challenge')
			const cookies = await session.chrome(`
				return [...Services.cookies.getCookiesFromHost('forge.example', {})].map((cookie) => cookie.name)`) as string[]
			expect(cookies.some((name) => name.startsWith('techaro.lol-anubis-auth'))).toBe(true)
		})
	}
})

describe('toolbar button', () => {
	it('cycles Native → WASM → UA → JS and remembers the choice', async () => {
		await chooseSolverMode(session, 'native')
		const seen = [await badgeText(session)]
		for (let click = 0; click < 4; click++) {
			await session.realClick(TOOLBAR_BUTTON)
			await new Promise((done) => setTimeout(done, 300))
			seen.push(await badgeText(session))
		}
		expect(seen).toEqual(['N', 'W', 'UA', 'JS', 'N'])
		await chooseSolverMode(session, 'wasm')
		expect(await session.asExtension('return (await browser.storage.local.get("solverMode")).solverMode')).toBe('wasm')
	})

	it('keeps a saved choice over the WASM default when the add-on restarts', async () => {
		await chooseSolverMode(session, 'native')
		// Mark the badge, then restart the add-on. The restart closes the page that
		// asked for it, so that call may fail.
		await session.asExtension(`
			await browser.browserAction.setBadgeText({ text: '?' })
			browser.runtime.reload()
			return true`).catch(() => undefined)
		// The restarted background sets W at load; only the saved choice turns it to N.
		await waitFor(async () => await badgeText(session).catch(() => undefined) === 'N' ? true : undefined,
			15_000, 'The saved Native choice did not survive a restart')
		expect(await session.asExtension('return (await browser.storage.local.get("solverMode")).solverMode')).toBe('native')
	})
})
