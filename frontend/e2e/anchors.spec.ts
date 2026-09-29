import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// In-document anchor links (`[x](#section)`) on the real Document page.
//
// Unlike the other specs this one needs no backend: every /api call is
// answered by page.route from an in-memory doc + comment list, so it runs
// against the bare Vite dev server. The fixture is the same file users
// can upload by hand to check a deployment (e2e/fixtures/ancres-test.md).

const MD = readFileSync(
  fileURLToPath(new URL('./fixtures/ancres-test.md', import.meta.url)),
  'utf8',
);
const COMMENTED = 'Cette phrase porte un commentaire de non-régression.';

interface MockState {
  content: string;
  comments: Record<string, unknown>[];
  created: Record<string, unknown>[];
}

function comment(id: string, exact: string) {
  return {
    id,
    documentId: 'doc1',
    // start == end == 0 → resolved against the rendered text, the same
    // path agent (MCP) comments take; human comments use real offsets,
    // which exercise the same textContent walk.
    anchor: { start: 0, end: 0, exact },
    author: 'Relecteur',
    body: 'Commentaire de test',
    resolved: false,
    replies: [],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };
}

async function mockApi(page: Page, state: MockState) {
  await page.route('**/api/**', async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/me') return json({ user: null });
    if (path === '/api/auth/config') return json({ githubEnabled: false });
    if (path === '/api/documents/doc1')
      return json({
        id: 'doc1',
        title: 'Test des ancres internes',
        origin: 'upload',
        sourceKind: 'upload',
        content: state.content,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
      });
    if (path === '/api/documents/doc1/comments') {
      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        state.created.push(body);
        const c = { ...comment(`c${state.comments.length + 1}`, body.anchor.exact), ...body };
        state.comments.push(c);
        return json(c, 201);
      }
      return json(state.comments);
    }
    if (path === '/api/documents/doc1/checks') return json({ hasPolicy: false, results: [] });
    if (path === '/api/documents/doc1/edit-lock') return json({ locked: false });
    if (path.endsWith('/events')) return route.fulfill({ status: 204, body: '' });
    if (req.method() === 'GET' && /\/(reviews|review-requests|reviewers|mention-candidates)$/.test(path))
      return json([]);
    return json({});
  });
}

// Top of the element relative to the viewport. A heading "scrolled into
// view" sits just under the 96px scroll-margin-top, well inside the window.
async function viewportTop(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => el.getBoundingClientRect().top);
}

// Smooth scrolling takes ~0.5–1s; wait until scrollY stops moving.
async function waitScrollIdle(page: Page) {
  let prev = -1;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const y = await page.evaluate(() => window.scrollY);
    if (y === prev) return;
    prev = y;
  }
}

async function openDoc(page: Page, hash = '') {
  const state: MockState = { content: MD, comments: [comment('c1', COMMENTED)], created: [] };
  await mockApi(page, state);
  await page.addInitScript(() => localStorage.setItem('markupmarkdown:author', 'Relecteur'));
  await page.goto(`/d/doc1${hash}`);
  await expect(page.locator('.mm-prose h1')).toBeVisible();
  return state;
}

const toc = (page: Page, name: string) =>
  page.locator('.mm-prose a', { hasText: name }).first();

test.describe('in-document anchor links', () => {
  const cases: Array<[string, string]> = [
    ['Résumé exécutif', '#user-content-résumé-exécutif'],
    ['Intro (second, doublon)', '#user-content-intro-1'],
    ['Ponctuation et emoji', '#user-content--qa--v20-cest--prêt--'],
    ['Chiffres et majuscules', '#user-content-3-étapes-clés-2026'],
    ['Symboles', '#user-content-coût--bénéfice-'],
    ['Ancre HTML brute', '#user-content-ancre-manuelle'],
    ['Titre en majuscules dans le lien', '#user-content-résumé-exécutif'],
  ];

  for (const [label, id] of cases) {
    test(`TOC link "${label}" scrolls its target into view`, async ({ page }) => {
      await openDoc(page);
      const selector = `[id="${id.slice(1)}"]`;
      expect(await viewportTop(page, selector)).toBeGreaterThan(page.viewportSize()!.height);

      await toc(page, label).click();
      await waitScrollIdle(page);

      const top = await viewportTop(page, selector);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThan(200);
      // Stays on the SPA route, hash is shareable (without the prefix).
      const url = new URL(page.url());
      expect(url.pathname).toBe('/d/doc1');
      expect(decodeURIComponent(url.hash).toLowerCase()).toBe(
        `#${id.slice('#user-content-'.length)}`,
      );
    });
  }

  test('duplicate headings: each link reaches its own heading', async ({ page }) => {
    await openDoc(page);
    await toc(page, 'Intro (premier)').click();
    await waitScrollIdle(page);
    const first = await viewportTop(page, '[id="user-content-intro"]');
    expect(first).toBeLessThan(200);
    // The second Intro is far below the first.
    expect(await viewportTop(page, '[id="user-content-intro-1"]')).toBeGreaterThan(
      page.viewportSize()!.height,
    );
  });

  test('opening a URL with #anchor lands on the section', async ({ page }) => {
    await openDoc(page, '#' + encodeURIComponent('3-étapes-clés-2026'));
    await waitScrollIdle(page);
    const top = await viewportTop(page, '[id="user-content-3-étapes-clés-2026"]');
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(200);
  });

  test('back-to-top link from the bottom of a long doc', async ({ page }) => {
    await openDoc(page, '#fin-du-document');
    await waitScrollIdle(page);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(2000);
    await toc(page, 'Retour en haut').click();
    await waitScrollIdle(page);
    expect(await viewportTop(page, '.mm-prose h1')).toBeGreaterThanOrEqual(0);
  });

  test('missing anchor and bare # are harmless', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openDoc(page);
    await toc(page, 'Ancre inexistante').click();
    await toc(page, 'Dièse seul').click();
    await expect(page.locator('.mm-prose h1')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/d/doc1');
    expect(errors).toEqual([]);
  });

  test('external links are not intercepted', async ({ page }) => {
    await openDoc(page);
    await page.route('https://example.com/**', (r) =>
      r.fulfill({ contentType: 'text/html', body: '<p>externe</p>' }),
    );
    const link = toc(page, 'Lien externe');
    await expect(link).toHaveAttribute('href', 'https://example.com/');
    await link.click();
    await expect(page).toHaveURL('https://example.com/');
  });
});

test.describe('comments are unaffected by heading ids', () => {
  test('anchored comment stays highlighted, also after reload and a new revision', async ({ page }) => {
    const state = await openDoc(page, '#r%C3%A9sum%C3%A9-ex%C3%A9cutif');
    const hl = page.locator('span.mm-highlight[data-comment-id="c1"]');
    await expect(hl).toHaveText(COMMENTED);
    await expect(hl).toBeInViewport();

    await page.reload();
    await expect(hl).toHaveText(COMMENTED);

    // New revision: headings shift (a new one is inserted above), the
    // commented sentence is untouched → the highlight must follow it.
    state.content = MD.replace('## Résumé exécutif', '## Nouveau titre\n\nAjout.\n\n## Résumé exécutif');
    await page.reload();
    await expect(page.locator('[id="user-content-nouveau-titre"]')).toHaveCount(1);
    await expect(hl).toHaveText(COMMENTED);
  });

  test('selecting text inside a heading still creates an anchored comment', async ({ page }) => {
    const state = await openDoc(page);
    const popover = page.locator('div.fixed.z-30 button', { hasText: 'Comment' });
    await expect(popover).toHaveCount(0);

    const h = page.locator('[id="user-content-coût--bénéfice-"]');
    await h.scrollIntoViewIfNeeded();
    await h.selectText();
    // The page turns the selection into an anchor on mouseup.
    const box = (await h.boundingBox())!;
    await page.mouse.move(box.x + 5, box.y + box.height / 2);
    await page.mouse.up();
    await popover.click();

    await page.getByPlaceholder(/Add a comment/).fill('Titre à reformuler');
    await page.getByRole('button', { name: 'Comment', exact: true }).last().click();
    await expect.poll(() => state.created.length).toBe(1);
    const anchor = state.created[0].anchor as { exact: string; start: number; end: number };
    expect(anchor.exact.trim()).toBe('Coût / bénéfice (€)');
    await expect(
      page.locator('.mm-prose span.mm-highlight[data-comment-id="c2"]'),
    ).toContainText('Coût / bénéfice');
  });
});
