/**
 * Control for noJavaScript.live.test.ts: the same Firefox and Anubis, page
 * JavaScript off, but no Anubis Fast. The challenge page never clears.
 */

import { afterAll, beforeAll, expect, it } from 'vitest'
import { FirefoxSession } from 'firefox-addon-live'
import { CHALLENGE_TITLE, SITE_HOST, selectedPage, startProtectedSite, visitSite, type ProtectedSite } from './anubisFast'

let site: ProtectedSite
let session: FirefoxSession

beforeAll(async () => {
	site = await startProtectedSite(4)
	session = await FirefoxSession.start({
		width: 800,
		height: 562,
		upstreams: { [SITE_HOST]: site.anubis },
		prefs: { 'javascript.enabled': false },
	})
}, 120_000)

afterAll(async () => {
	await session?.close()
	await site?.stop()
})

it('stays on the challenge page without Anubis Fast', async () => {
	await visitSite(session)
	await new Promise((done) => setTimeout(done, 8_000))
	expect((await selectedPage(session)).title).toBe(CHALLENGE_TITLE)
})
