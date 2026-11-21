// Browser smoke test: signs in as each demo role, visits every screen that role can use,
// and fails on JS errors, failed API calls (4xx/5xx) or a visible error boundary.
//
// Needs: the API and `npm run dev` running, and a DEMO database (`npm run db:demo` in school_backend).
//   node tests/e2e/ui.mjs                        # http://localhost:5173
//   BASE=https://staging.example node tests/e2e/ui.mjs
// Screenshots go to ./screenshots (desktop 1360px + phone 390px).
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const PASS = process.env.DEMO_PASSWORD ?? 'Demo@School2083'
const OUT = new URL('../../screenshots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const DESKTOP = { width: 1360, height: 860 }
const PHONE = { width: 390, height: 844 }
let failures = 0

async function asRole(username, viewport, steps) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport === PHONE ? 2 : 1 })
  const page = await ctx.newPage()
  page.setDefaultTimeout(10_000)
  const problems = []
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`))
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400 && !expectedFailure(r)) problems.push(`[http ${r.status()}] ${r.request().method()} ${new URL(r.url()).pathname}`)
  })

  const tag = `${username}${viewport === PHONE ? '@phone' : ''}`
  try {
    await page.goto(BASE)
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password', { exact: true }).fill(PASS)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.locator('main').waitFor()

    const ctxApi = {
      page,
      /** client-side navigation (keeps the in-memory session, like clicking a link) */
      go: async (path) => {
        await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)
        await settle(page)
      },
      shot: async (name) => {
        await settle(page)
        await page.screenshot({ path: `${OUT}/${tag.replace('@', '-')}-${name}.png`, fullPage: true })
      },
      expectText: async (text) => {
        const seen = await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)
        if (!seen) problems.push(`[missing] "${text}" on ${page.url().replace(BASE, '')}`)
      },
      tab: async (name) => {
        await page.getByRole('button', { name, exact: true }).click()
        await settle(page)
      },
    }
    await settle(page)
    await steps(ctxApi)
  } catch (e) {
    problems.push(`[exception] ${e.message.split('\n')[0]} @ ${(e.stack.match(/ui\.mjs:\d+/g) ?? []).join(' < ')}`)
  }
  const boundary = await page.getByText(/Something went wrong|A new version is available/).count()
  if (boundary) problems.push('[error boundary visible]')
  const unique = [...new Set(problems)]
  if (unique.length) failures++
  console.log(`${unique.length ? '✗' : '✓'} ${tag}${unique.length ? '\n    ' + unique.join('\n    ') : ''}`)
  await browser.close()
}

// The UI probes a few endpoints that legitimately answer 4xx (e.g. a report card for an unprocessed exam).
function expectedFailure(r) {
  const p = new URL(r.url()).pathname
  return r.status() === 404 && /\/report-card/.test(p)
}

async function settle(page) {
  await page.waitForLoadState('domcontentloaded')
  // wait until spinners are gone (max 6 s) — never `networkidle`, polling screens never go idle
  await page.waitForFunction(() => !document.querySelector('.animate-spin'), null, { timeout: 6000 }).catch(() => {})
  await page.waitForTimeout(250)
}

// ─── Admin: every staff screen, plus the new ones ───────────────────────────
await asRole('admin', DESKTOP, async ({ go, shot, expectText, tab, page }) => {
  await expectText('Himalayan Model') // branding from the DB
  await shot('dashboard')
  await go('/students'); await shot('students')
  await go('/students/110'); await shot('student-profile')
  await tab('Guardians'); await shot('student-guardians')
  await page.getByRole('button', { name: /^Edit guardian/ }).first().click()
  await page.getByText('Edit guardian').waitFor(); await settle(page); await shot('guardian-edit-modal')
  await page.keyboard.press('Escape')
  await tab('Enrollment'); await expectText('Optional subjects'); await expectText('Computer Science'); await shot('student-enrollment')
  await go('/guardians'); await expectText('Parents & guardians'); await shot('guardians')
  await page.locator('input[placeholder^="Search by name"]').fill('Gurung'); await page.waitForTimeout(600); await settle(page)
  await expectText('Dil Bahadur Gurung')
  await go('/staff'); await shot('staff')
  await go('/academic'); await shot('academic')
  await go('/enrollment'); await shot('enrollment')
  await go('/attendance'); await shot('attendance')
  await go('/exams'); await shot('exams')
  await page.getByRole('button', { name: /^Edit First Terminal/ }).click()
  await page.getByText('Edit exam').waitFor(); await shot('exam-edit-modal'); await page.keyboard.press('Escape')
  await go('/exams/1'); await shot('exam-detail')
  await go('/fees'); await shot('fees')
  await go('/fees/collect'); await shot('fees-collect')
  await go('/fees/receipts/1'); await expectText('PAN'); await shot('receipt')
  await go('/report-card/1/67'); await expectText('Progress report'); await shot('report-card')
  await go('/users'); await shot('users')
  await go('/security'); await shot('security')
  await go('/settings'); await expectText('School profile'); await expectText('Replace logo'); await shot('settings')
  await go('/account'); await expectText('Change password'); await shot('account')
})

// ─── Teacher: limited menu, own staff record, forbidden admin pages ─────────
await asRole('teacher', DESKTOP, async ({ go, shot, expectText }) => {
  await shot('dashboard')
  await go('/attendance'); await shot('attendance')
  await go('/exams/2'); await shot('exam-marks')
  await go('/account'); await expectText('My staff record'); await expectText('Sita'); await shot('account')
  await go('/settings'); await expectText("don't have access")
})

// ─── Accountant ─────────────────────────────────────────────────────────────
await asRole('accountant', DESKTOP, async ({ go, shot, expectText }) => {
  await expectText('Outstanding'); await shot('dashboard')
  await go('/fees'); await go('/fees/collect'); await shot('collect')
  await go('/guardians'); await expectText('Parents & guardians')
})

// ─── Parent & student portal ────────────────────────────────────────────────
await asRole('parent', DESKTOP, async ({ go, shot, expectText, page, tab }) => {
  await expectText('Aarav'); await shot('portal')
  await page.locator('a[href^="/portal/"]').first().click(); await settle(page); await shot('child')
  for (const t of ['Attendance', 'Results', 'Fees']) await tab(t)
  await go('/students'); await expectText("don't have access")
})
await asRole('student', DESKTOP, async ({ shot }) => { await shot('portal') })

// ─── Phone layout (390 px) ──────────────────────────────────────────────────
await asRole('admin', PHONE, async ({ go, shot, page }) => {
  await shot('dashboard')
  await go('/students/110'); await shot('student')
  await go('/fees/collect'); await shot('collect')
  // the page itself must not scroll sideways (wide tables scroll inside their own container)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflow > 1) throw new Error(`page is ${overflow}px wider than the phone screen`)
})
await asRole('parent', PHONE, async ({ shot, page }) => {
  await shot('portal')
  await page.locator('a[href^="/portal/"]').first().click(); await settle(page); await shot('child')
})

console.log(failures ? `\n${failures} role run(s) had problems` : '\nAll role runs clean')
process.exit(failures ? 1 : 0)
