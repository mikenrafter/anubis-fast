/**
 * Regenerates the README / product-page captures in product-page/ from a real
 * Firefox with Anubis Fast loaded, on a private Xvfb display:
 *
 *   no-js        page JavaScript is off (about:config); opening a site behind a
 *                real Anubis shows the challenge, which Anubis Fast solves
 *   solver-mode  clicking the toolbar button cycles the solver: N, W, UA, JS
 *
 * The site is a local page behind a real Anubis (from nixpkgs), reached as
 * http://forge.example/. The harness is firefox-addon-live (a flake input; see
 * flake.nix).
 *
 * Usage (inside `nix develop`):
 *   npm run capture:readme                 # every scene
 *   npm run capture:readme -- solver-mode  # only these scenes
 *   OUT_DIR=/tmp/shots npm run capture:readme
 */

import { resolve } from 'node:path'
import { GLIDE, runCaptures, settle, waitFor, type FirefoxSession, type Rect } from 'firefox-addon-live'
import {
	CHALLENGE_TITLE,
	EXTENSION_ID,
	EXTENSION_SOURCE,
	SITE_HOST,
	SITE_TITLE,
	TOOLBAR_BUTTON,
	chooseSolverMode,
	forgetPass,
	pageText,
	selectedPage,
	startProtectedSite,
	waitForTitle,
	type SolverMode,
} from '../tests/live/anubisFast'

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))
/**
 * Difficulty 5 keeps the challenge page up for a second or two in WASM mode,
 * long enough to read; at Anubis' default of 4 it barely shows.
 */
const DIFFICULTY = 5

const site = await startProtectedSite(DIFFICULTY)
try {
	await runCaptures({
		outDir: resolve(import.meta.dirname, '../product-page'),
		session: {
			addon: { source: EXTENSION_SOURCE, id: EXTENSION_ID },
			upstreams: { [SITE_HOST]: site.anubis },
			bookmarksToolbar: false,
			prefs: {
				'javascript.enabled': false,
				'browser.aboutConfig.showWarning': false,
				// Keep the address bar dropdown to the typed site.
				'browser.urlbar.suggest.topsites': false,
				'browser.urlbar.suggest.searches': false,
				'browser.urlbar.suggest.quickactions': false,
				'browser.search.suggest.enabled': false,
			},
		},
		setup: async (session) => {
			await closeAlerts(session)
			await chooseSolverMode(session, 'wasm')
		},
		scenes: {
			'no-js': {
				async run(session, kit) {
					await forgetPass(session)
					await session.openTab('about:config')
					await settle(session)
					const stop = await kit.record('demo-no-js')
					await sleep(600)
					await session.realClick({ content: '#about-config-search' }, { glide: GLIDE })
					await session.type('javascript.enabled')
					await sleep(1_800)
					await session.realClick('urlbar-input', { glide: GLIDE })
					await sleep(300)
					await session.type(SITE_HOST)
					await sleep(300)
					await session.keys('Return')
					// Still of the challenge page once Anubis Fast has taken it over.
					await waitFor(async () => {
						if ((await selectedPage(session)).title !== CHALLENGE_TITLE) return undefined
						return (await pageText(session)).includes('FAST ANUBIS') ? true : undefined
					}, 10_000, 'The challenge page never showed Anubis Fast\'s status')
					await kit.still('demo-no-js')
					await waitForTitle(session, SITE_TITLE, 60_000)
					await sleep(2_200)
					await stop()
				},
			},

			'solver-mode': {
				async run(session, kit) {
					await chooseSolverMode(session, 'native')
					await session.openTab(`http://${SITE_HOST}/`)
					await waitForTitle(session, SITE_TITLE, 60_000)
					await settle(session)
					const crop = await toolbarCorner(session)
					const stop = await session.record(kit.out('demo-solver-mode.gif'), crop, { width: crop.width * 2 })
					await sleep(800)
					// Aim just below and left of the icon's centre so the pointer doesn't hide the badge.
					const button = await session.screenRect(TOOLBAR_BUTTON)
					await session.pointerToPoint(button.x + button.width / 2 - 3, button.y + button.height / 2 + 5, GLIDE)
					for (const mode of ['wasm', 'spoof', 'javascript', 'native'] satisfies SolverMode[]) {
						await sleep(1_000)
						await session.pointerClick()
						if (mode === 'wasm') {
							await sleep(400)
							await session.screenshot(kit.out('demo-solver-mode.png'), crop, crop.width * 2)
						}
					}
					await sleep(1_200)
					await stop()
					await chooseSolverMode(session, 'wasm')
				},
			},
		},
	})
} finally {
	await site.stop()
}

/** The right end of the toolbar, where the add-on's button and badge sit. */
async function toolbarCorner(session: FirefoxSession): Promise<Rect> {
	const button = await session.screenRect(TOOLBAR_BUTTON)
	const toolbar = await session.screenRect('nav-bar')
	const width = 240
	const x = Math.min(Math.round(button.x + button.width / 2 - width / 2), Math.round(toolbar.x + toolbar.width - width))
	return { x: Math.max(0, x), y: Math.round(toolbar.y), width, height: Math.round(toolbar.height) }
}

/** Closes the background script's "Anubis Fast loaded" notification, if Firefox drew one. */
async function closeAlerts(session: FirefoxSession): Promise<void> {
	await session.chrome(`
		for (const alert of Services.wm.getEnumerator('alert:alert')) alert.close()
		return true`)
}
