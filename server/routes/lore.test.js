// server/routes/lore.test.js — Story 2.3 (lore-pages).
//
// Two things this file proves. First, renderLoreMarkdown is a correct, pure
// renderer of the documented markdown subset, and it escapes raw HTML rather than
// passing it through. Second, the route's ONE genuine security discipline — the
// manifest slug allowlist plus the directory-containment check — actually stops a
// path-traversal payload from reaching a file outside the lore directory.
//
// The lore route reads NO Mongo, but the test still mocks the same two seams the
// sibling stories use, because `requireAuth` sits in front of the route and
// resolves req.user from Mongo: a request must authenticate through the same
// fixtures to get PAST the gate.
//   1. Discord's /users/@me — MOCKED via a swapped globalThis.fetch.
//   2. The players collection — a fake Db injected via db.setTestDb.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../index.js';
import { setTestDb } from '../db.js';
import { _resetTokenCache } from '../middleware/auth.js';
import { renderLoreMarkdown, LORE_MANIFEST, LORE_DIR } from './lore.js';

const DISCORD_API = 'https://discord.com/api/v10';

// A single player fixture is all the gate needs (the lore route never reads it).
const TEST_PLAYERS = [
  { discord_id: '111', role: 'player', character_ids: [], discord_username: 'player_one' },
];

function makeFakeDb({ players = [] } = {}) {
  const data = { players };
  return {
    collection(name) {
      const docs = data[name] ?? [];
      return { find() { return { toArray: async () => docs.map((d) => ({ ...d })) }; } };
    },
  };
}

function installTestDb() {
  setTestDb(makeFakeDb({ players: TEST_PLAYERS }));
}

// --- Discord mock (mirrors server/routes/world.test.js) ---------------------

function fakeRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mockDiscord(profileId) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith(DISCORD_API)) {
      if (u.includes('/users/@me')) return fakeRes(200, { id: profileId, username: `u${profileId}` });
      throw new Error(`unexpected Discord fetch to ${u}`);
    }
    return original(url, opts);
  };
  return { restore: () => { globalThis.fetch = original; } };
}

async function withServer(fn) {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function getAs(base, discordId, requestPath) {
  const m = mockDiscord(discordId);
  try {
    _resetTokenCache();
    const res = await fetch(`${base}${requestPath}`, { headers: { Authorization: `Bearer token-for-${discordId}` } });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* leave null */ }
    return { status: res.status, rawBody: text, body };
  } finally {
    m.restore();
  }
}

// ===========================================================================
// renderLoreMarkdown UNIT TESTS (AC #6, #14)
// ===========================================================================

test('renderLoreMarkdown: headings render to h1..h3', () => {
  assert.equal(renderLoreMarkdown('# One'), '<h1>One</h1>');
  assert.equal(renderLoreMarkdown('## Two'), '<h2>Two</h2>');
  assert.equal(renderLoreMarkdown('### Three'), '<h3>Three</h3>');
});

test('renderLoreMarkdown: a plain paragraph', () => {
  assert.equal(renderLoreMarkdown('Just some prose.'), '<p>Just some prose.</p>');
});

test('renderLoreMarkdown: bold and italic', () => {
  assert.equal(renderLoreMarkdown('a **bold** word'), '<p>a <strong>bold</strong> word</p>');
  assert.equal(renderLoreMarkdown('an *italic* word'), '<p>an <em>italic</em> word</p>');
  assert.equal(renderLoreMarkdown('an _italic_ word'), '<p>an <em>italic</em> word</p>');
});

test('renderLoreMarkdown: inline code is not further formatted', () => {
  assert.equal(renderLoreMarkdown('use `Presence + Persuasion` here'), '<p>use <code>Presence + Persuasion</code> here</p>');
  // asterisks inside a code span are literal, not italic markers
  assert.equal(renderLoreMarkdown('`a * b`'), '<p><code>a * b</code></p>');
});

test('renderLoreMarkdown: fenced code block, body escaped and not inline-processed', () => {
  const html = renderLoreMarkdown('```\nline **one**\n<b>x</b>\n```');
  assert.equal(html, '<pre><code>line **one**\n&lt;b&gt;x&lt;/b&gt;</code></pre>');
});

test('renderLoreMarkdown: unordered list', () => {
  assert.equal(renderLoreMarkdown('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
});

test('renderLoreMarkdown: ordered list', () => {
  assert.equal(renderLoreMarkdown('1. first\n2. second'), '<ol><li>first</li><li>second</li></ol>');
});

test('renderLoreMarkdown: link', () => {
  assert.equal(renderLoreMarkdown('see [the guide](game-guide) now'), '<p>see <a href="game-guide">the guide</a> now</p>');
});

test('renderLoreMarkdown: block quote', () => {
  assert.equal(renderLoreMarkdown('> a quote\n> continued'), '<blockquote><p>a quote continued</p></blockquote>');
});

test('renderLoreMarkdown: horizontal rule', () => {
  assert.equal(renderLoreMarkdown('above\n\n---\n\nbelow'), '<p>above</p>\n<hr>\n<p>below</p>');
});

test('renderLoreMarkdown (SAFETY): raw HTML / <script> is escaped, never passed through', () => {
  const html = renderLoreMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=y>');
  assert.ok(!/<script>/.test(html), 'a live <script> tag must never be emitted');
  assert.ok(!/<img/.test(html), 'a live <img> tag must never be emitted');
  assert.ok(html.includes('&lt;script&gt;'), 'the script source must appear as escaped text');
});

test('renderLoreMarkdown (SAFETY): a dangerous URL scheme in a link is neutralised, never a live href', () => {
  // javascript: / data: / vbscript: contain no HTML-special chars, so HTML-escaping
  // alone would let them through as a clickable href. The scheme guard renders the
  // label as plain text instead. Ordinary and relative links are unaffected.
  const js = renderLoreMarkdown('[click me](javascript:alert(1))');
  assert.ok(!/href="javascript:/i.test(js), 'no javascript: href may be emitted');
  assert.ok(js.includes('click me'), 'the label survives as plain text');

  const data = renderLoreMarkdown('[x](data:text/html,<script>alert(1)</script>)');
  assert.ok(!/href="data:/i.test(data), 'no data: href may be emitted');

  const vb = renderLoreMarkdown('[y](vbscript:msgbox(1))');
  assert.ok(!/href="vbscript:/i.test(vb), 'no vbscript: href may be emitted');

  // Legitimate links are still rendered as anchors.
  assert.equal(renderLoreMarkdown('[the guide](game-guide)'), '<p><a href="game-guide">the guide</a></p>');
  assert.ok(/href="https:\/\/example\.test"/.test(renderLoreMarkdown('[e](https://example.test)')), 'https link preserved');
});

test('renderLoreMarkdown: does not turn hyphens into em-dashes', () => {
  const html = renderLoreMarkdown('roll twice - keep the better result');
  assert.ok(!html.includes('—'), 'no em-dash must be introduced');
  assert.ok(html.includes(' - '), 'the literal hyphen is preserved');
});

test('renderLoreMarkdown: empty / whitespace / null yield an honest empty result, no crash', () => {
  assert.equal(renderLoreMarkdown(''), '');
  assert.equal(renderLoreMarkdown('   \n  \n'), '');
  assert.equal(renderLoreMarkdown(null), '');
  assert.equal(renderLoreMarkdown(undefined), '');
});

// ===========================================================================
// SECURITY DISCRIMINATION (AC #5, #14) — the allowlist has teeth
// ===========================================================================

test('SECURITY (discrimination): a traversal slug resolves OUTSIDE the lore dir, and is NOT a manifest slug', () => {
  const manifestSlugs = new Set(LORE_MANIFEST.map((e) => e.slug));
  const payload = '../../db';
  // A naive `path.join(LORE_DIR, slug + '.md')` (no allowlist) WOULD escape the
  // lore directory — this is exactly the danger the allowlist exists to stop.
  const naivePath = path.join(LORE_DIR, `${payload}.md`);
  assert.ok(!naivePath.startsWith(LORE_DIR + path.sep), 'control: a naive join of the payload escapes the lore dir');
  // The route never builds that path, because the payload is not a manifest slug.
  assert.ok(!manifestSlugs.has(payload), 'the traversal payload must not be an allowlisted slug');
});

// ===========================================================================
// ROUTE TESTS (AC #7, #5, #8, #14) — through the auth gate
// ===========================================================================

test('AC #7: GET /api/lore returns the ordered manifest as [{ slug, title }] with no bodies', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { status, body, rawBody } = await getAs(base, '111', '/api/lore');
    assert.equal(status, 200);
    assert.deepEqual(body, [
      { slug: 'setting-primer', title: 'Setting primer' },
      { slug: 'game-guide', title: 'Game guide' },
      { slug: 'rules', title: 'Rules' },
      { slug: 'friendly-errata', title: 'Friendly errata' },
    ]);
    // no file bodies rode along
    assert.ok(!rawBody.includes('html'), 'the index must not carry rendered html');
    assert.ok(!rawBody.includes('Placeholder'), 'the index must not carry file contents');
  });
});

test('AC #6/#14: GET /api/lore/:slug returns { slug, title, html } rendered from the committed file', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { status, body } = await getAs(base, '111', '/api/lore/setting-primer');
    assert.equal(status, 200);
    assert.equal(body.slug, 'setting-primer');
    assert.equal(body.title, 'Setting primer');
    // rendered, not raw markdown
    assert.ok(body.html.includes('<h1>Setting primer</h1>'), 'heading rendered');
    assert.ok(body.html.includes('<blockquote>'), 'placeholder banner rendered as a block quote');
    assert.ok(!body.html.includes('# Setting primer'), 'raw markdown must not leak through');
    // no live script and no em-dash in the rendered output
    assert.ok(!/<script>/.test(body.html));
    assert.ok(!body.html.includes('—'), 'no em-dash in rendered lore html');
  });
});

test('AC #5/#14 (SECURITY): an unknown slug returns 404 NOT_FOUND, no external file contents', async () => {
  installTestDb();
  await withServer(async (base) => {
    const { status, body, rawBody } = await getAs(base, '111', '/api/lore/no-such-page');
    assert.equal(status, 404);
    assert.equal(body.error, 'NOT_FOUND');
    // none of this repo's out-of-lore source leaked
    assert.ok(!rawBody.includes('renderLoreMarkdown'), 'no source from lore.js leaked');
    assert.ok(!rawBody.includes('MONGODB_URI'), 'no config/env content leaked');
  });
});

test('AC #5/#14 (SECURITY): a path-traversal payload returns 404 and reads no file outside the lore dir', async () => {
  installTestDb();
  await withServer(async (base) => {
    // Encoded traversal so the `..` survives to the :slug param rather than being
    // collapsed by the client. Whatever the router does with it, it must 404 and
    // must not return the contents of any file outside the lore directory.
    for (const p of ['/api/lore/..%2F..%2Fdb', '/api/lore/..%2Fconfig', '/api/lore/%2Fetc%2Fpasswd']) {
      const { status, rawBody } = await getAs(base, '111', p);
      assert.equal(status, 404, `${p} must 404`);
      assert.ok(!rawBody.includes('renderLoreMarkdown'), `${p} must not leak lore.js`);
      assert.ok(!rawBody.includes('connectDb'), `${p} must not leak db.js`);
      assert.ok(!rawBody.includes('root:'), `${p} must not leak a passwd-style file`);
    }
  });
});

test('AC #8: a manifest slug whose backing file is missing returns a modelled CONTENT_ERROR, no path/stack', async () => {
  installTestDb();
  const filePath = path.join(LORE_DIR, 'friendly-errata.md');
  const stashed = `${filePath}.stashed-for-test`;
  await fs.rename(filePath, stashed);
  try {
    await withServer(async (base) => {
      const { status, body, rawBody } = await getAs(base, '111', '/api/lore/friendly-errata');
      assert.equal(status, 500);
      assert.equal(body.error, 'CONTENT_ERROR');
      // no filesystem path, fs error string, or stack trace in the body
      assert.ok(!rawBody.includes('friendly-errata.md'), 'no filesystem path in the body');
      assert.ok(!rawBody.includes('ENOENT'), 'no fs error string in the body');
      assert.ok(!rawBody.includes(' at '), 'no stack trace in the body');
    });
  } finally {
    await fs.rename(stashed, filePath); // always restore the committed file
  }
});

test('AC #3/#14: /api/lore and /api/lore/:slug are behind requireAuth — no token gets 401', async () => {
  installTestDb();
  await withServer(async (base) => {
    const index = await fetch(`${base}/api/lore`);
    assert.equal(index.status, 401);
    const page = await fetch(`${base}/api/lore/setting-primer`);
    assert.equal(page.status, 401);
  });
});
