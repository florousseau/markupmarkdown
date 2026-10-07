import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';

// In-thread fix loop, end to end: a human comments the SECOND of two
// identical sentences, an agent answers in the thread through the real
// MCP endpoint with a `replacement`, the human clicks Apply, and a
// second tab on the same revision sees the thread flip to resolved
// without reloading (SSE).
//
// Needs a signed-in session + an agent token, which can't come from
// GitHub OAuth in tests: seed them with e2e/fixtures/seed-session.js
// and export E2E_SESSION / E2E_TOKEN. Skipped otherwise.

const SESSION = process.env.E2E_SESSION;
const TOKEN = process.env.E2E_TOKEN;

const CONTENT = '# Pets\n\nThe cat sat on the mat. The cat ran away.\n';

async function asHuman(context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'mm_session', value: SESSION!, url: baseURL }]);
}

async function mcpCall(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const res = await request.post('/mcp', {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  expect(res.ok()).toBeTruthy();
  const text = await res.text();
  expect(text).not.toContain('"isError":true');
  return text;
}

test('agent reply suggestion is applied at the right occurrence and resolves live in another tab', async ({
  browser,
  request,
  baseURL,
}) => {
  test.skip(!SESSION || !TOKEN, 'E2E_SESSION / E2E_TOKEN not set (see e2e/fixtures/seed-session.js)');
  const cookie = { Cookie: `mm_session=${SESSION}` };

  const docRes = await request.post('/api/documents', {
    headers: cookie,
    data: { content: CONTENT, title: 'Reply suggestion E2E' },
  });
  expect(docRes.ok()).toBeTruthy();
  const doc = await docRes.json();

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await asHuman(ctxA, baseURL!);
  await asHuman(ctxB, baseURL!);
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await pageA.goto(`/d/${doc.id}`);
  await expect(pageA.locator('text=The cat sat on the mat.').first()).toBeVisible({ timeout: 15000 });

  // The human selects the SECOND "The cat" in the rendered doc and
  // comments it through the real UI (selection → popover → composer).
  await pageA.evaluate(() => {
    const p = Array.from(document.querySelectorAll('p')).find((el) =>
      el.textContent?.includes('The cat ran away.')
    )!;
    const text = p.firstChild as Text;
    const at = text.data.lastIndexOf('The cat');
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + 'The cat'.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  // The floating selection popover (not the review bar's "Comment").
  await pageA.locator('div.fixed').getByRole('button', { name: 'Comment' }).click();
  const composer = pageA.getByPlaceholder('Add a comment… (use @ to mention)');
  await composer.fill('Make this a dog.');
  await composer.press('Control+Enter');

  const listed = async () =>
    (await (await request.get(`/api/documents/${doc.id}/comments`, { headers: cookie })).json()) as Array<{
      id: string;
      anchor: { exact: string; prefix?: string; suffix?: string };
    }>;
  await expect.poll(async () => (await listed()).length, { timeout: 10000 }).toBe(1);
  const comment = (await listed())[0];
  expect(comment.anchor.exact).toBe('The cat');
  // Context was captured from the rendered selection.
  expect(comment.anchor.prefix).toContain('sat on the mat. ');
  expect(comment.anchor.suffix).toContain(' ran away.');

  // Agent answers in the thread over MCP.
  await mcpCall(request, 'reply', {
    comment_id: comment.id,
    body: 'Done — swapped the animal.',
    replacement: 'A dog',
  });

  await pageB.goto(`/d/${doc.id}`);

  // The suggestion renders inside the agent's reply, as the active one.
  const activeA = pageA.locator('[data-suggestion-state="active"]');
  await expect(activeA).toHaveCount(1, { timeout: 15000 });
  await activeA.getByRole('button', { name: 'Result' }).click();
  await expect(activeA).toContainText('A dog');
  await expect(pageB.locator('[data-suggestion-state="active"]')).toHaveCount(1, { timeout: 15000 });

  // Apply from tab A → navigates to the new revision.
  await activeA.getByRole('button', { name: 'Apply' }).click();
  await expect(pageA).not.toHaveURL(new RegExp(`/d/${doc.id}$`), { timeout: 15000 });
  await expect(pageA.locator('text=The cat sat on the mat. A dog ran away.').first()).toBeVisible({
    timeout: 15000,
  });

  // Tab B (still on the parent revision, no reload): the thread is now
  // resolved, so it leaves the default "open" list.
  await expect(pageB.locator('[data-suggestion-state="active"]')).toHaveCount(0, { timeout: 15000 });

  // Server state agrees.
  const comments = await (await request.get(`/api/documents/${doc.id}/comments`, { headers: cookie })).json();
  const thread = comments.find((c: { id: string }) => c.id === comment.id);
  expect(thread.resolved).toBe(true);
  expect(thread.replies[0].suggestion.appliedAt).toBeTruthy();

  await ctxA.close();
  await ctxB.close();
});

