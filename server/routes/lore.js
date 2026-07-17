// server/routes/lore.js — Story 2.3 (lore-pages).
//
// The lore section: static, editorial, in-repo reference prose (setting primer,
// game guide, rules, a friendly errata summary). Unlike the sibling content
// routers, this one touches NO Mongo document at all — it reads none of the
// mongo-store.js accessors and issues NO writes of any kind. Its ONLY I/O is
// READ-ONLY `fs` reads of the committed markdown files under server/content/lore/.
// This is the first content router in the repo that reads from the filesystem
// rather than from Mongo; that read-only-filesystem posture is stated here so a
// later change does not quietly turn it into a Mongo or a write path.
//
// WHY NO [LEAK-GATE] / [PROJECTION] TAGS (deliberate, per the story's Dev Notes):
// every logged-in viewer receives byte-identical content. There is no owner tier,
// no `revealed_to`, no per-viewer projection, no `req.user` read, and no upstream
// document whose newly-added field could ride through a spread. So the sibling
// stories' projection tags do not apply and are NOT invented here.
//
// THE TWO DISCIPLINES THAT DO CARRY WEIGHT:
//  (1) LOGIN GATE (AC #3): lore CONTENT is served ONLY through this gated API
//      (mounted after app.use(requireAuth)), never baked into un-gated Netlify
//      static HTML. A logged-out request for lore content gets the same login
//      redirect a logged-out character request gets.
//  (2) SLUG ALLOWLIST / NO PATH TRAVERSAL (AC #5): the `:slug` path parameter is
//      the only user-controlled input, and it selects a file to read. It is
//      validated against the fixed manifest allowlist BEFORE it ever touches a
//      filesystem path. A slug not in the manifest returns 404 and reads nothing.
//      Defence in depth: the resolved absolute path is containment-checked against
//      the lore directory before the read, so even a manifest bug cannot escape.

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The lore markdown lives under server/ (not repo-root) for two reasons:
//  1. render.yaml sets `rootDir: server`, so the Render API service builds and
//     runs from server/; a repo-root content/lore/ is outside that root.
//  2. The login gate (AC #3) requires the content to be API-served, not
//     Netlify-served, so the files must sit where this API can fs-read them.
const __dirname = path.dirname(fileURLToPath(import.meta.url)); // server/routes
export const LORE_DIR = path.resolve(__dirname, '..', 'content', 'lore');

// The manifest (AC #4): the single source of truth for which slugs are valid,
// what each page is called, and the order the four v1 pages appear in. Titles are
// NOT derived from file contents — they live here. The slug is also the markdown
// filename stem (server/content/lore/<slug>.md).
export const LORE_MANIFEST = Object.freeze([
  { slug: 'setting-primer', title: 'Setting primer' },
  { slug: 'game-guide', title: 'Game guide' },
  { slug: 'rules', title: 'Rules' },
  { slug: 'friendly-errata', title: 'Friendly errata' },
]);

// Fast slug -> manifest-entry lookup for the allowlist check.
const MANIFEST_BY_SLUG = new Map(LORE_MANIFEST.map((e) => [e.slug, e]));

// ---------------------------------------------------------------------------
// renderLoreMarkdown — the pure, separately unit-testable renderer (AC #6).
//
// Converts a documented markdown SUBSET to an HTML string: headings, paragraphs,
// bold + italic, inline code, fenced code blocks, unordered + ordered lists,
// links, block quotes, and horizontal rules.
//
// The content is TRUSTED (in-repo, single-author), so this is not an
// untrusted-input sanitiser — but it still escapes raw HTML in the SOURCE by
// default and never passes `<script>` or arbitrary markup through as live markup.
// Block structure is detected on the RAW line (so a markdown `>` is a block quote,
// not an escaped `&gt;`), and every text SEGMENT is HTML-escaped at the point it
// is emitted (in renderInline, and for fenced-code bodies), so the output contains
// only the tags this renderer itself produces (defence in depth). No "smart
// punctuation": hyphens are never turned into em-dashes (AC #12).
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A sentinel for parking code-span contents while the other inline transforms
// run. It uses a private-use code point that no transform (all of which key off
// * _ [ ] ( )) can touch and the trusted source will not contain, so the restored
// <code> lands exactly where the span was, with no stray whitespace.
const CODE_MARK = '';

// URL schemes a rendered link must never carry as a live href (defence in depth;
// see the link transform below). Leading whitespace is tolerated before the scheme.
const UNSAFE_URL_SCHEME = /^\s*(?:javascript|data|vbscript):/i;

// Inline transforms. The raw segment is HTML-escaped FIRST (so any `<script>` or
// stray markup becomes inert text), then code spans are extracted to sentinels so
// no bold/italic/link transform reaches inside them, then restored last.
function renderInline(rawText) {
  const text = escapeHtml(rawText);
  const codeSpans = [];
  let out = text.replace(/`([^`]+)`/g, (_m, code) => {
    codeSpans.push(code);
    return `${CODE_MARK}${codeSpans.length - 1}${CODE_MARK}`;
  });

  // Links: [label](url). Source already escaped, so a stray quote is &quot; and a
  // space cannot appear in the captured url (so no attribute injection). Defence in
  // depth on the URL SCHEME: an escaped source still lets a dangerous scheme through
  // (javascript:/data:/vbscript: contain no HTML-special chars), so a link whose
  // url uses one is rendered as its plain label text rather than a live href. This
  // matches the renderer's escape-by-default posture (AC #6) and keeps a future
  // authoring slip from producing a clickable script URL. Ordinary relative slugs
  // (e.g. game-guide) and http/https/mailto links are unaffected.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) =>
    UNSAFE_URL_SCHEME.test(url) ? label : `<a href="${url}">${label}</a>`,
  );

  // Bold before italic so **x** is not mis-read as italic. Non-greedy, no nesting.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Restore code spans.
  out = out.replace(new RegExp(`${CODE_MARK}(\\d+)${CODE_MARK}`, 'g'), (_m, i) => `<code>${codeSpans[Number(i)]}</code>`);
  return out;
}

const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_RE = /^[-*+]\s+(.*)$/;
const OL_RE = /^\d+\.\s+(.*)$/;

// Render an array of already-escaped lines to HTML blocks. Used recursively for
// block-quote bodies.
function renderBlocks(lines) {
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line — a block separator.
    if (trimmed === '') {
      i += 1;
      continue;
    }

    // Fenced code block: a line starting with ``` opens it; the next ``` closes.
    // The body is emitted verbatim (already HTML-escaped), never inline-processed.
    if (trimmed.startsWith('```')) {
      const body = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== '```') {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // consume the closing fence (or run off the end)
      html.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // Horizontal rule.
    if (HR_RE.test(trimmed)) {
      html.push('<hr>');
      i += 1;
      continue;
    }

    // Heading.
    const heading = trimmed.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    // Block quote: gather consecutive `>`-prefixed lines, strip the marker, and
    // render the inner content recursively.
    if (trimmed.startsWith('>')) {
      const inner = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        inner.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      html.push(`<blockquote>${renderBlocks(inner)}</blockquote>`);
      continue;
    }

    // Unordered list.
    if (UL_RE.test(trimmed)) {
      const items = [];
      while (i < lines.length && UL_RE.test(lines[i].trim())) {
        items.push(`<li>${renderInline(lines[i].trim().match(UL_RE)[1].trim())}</li>`);
        i += 1;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Ordered list.
    if (OL_RE.test(trimmed)) {
      const items = [];
      while (i < lines.length && OL_RE.test(lines[i].trim())) {
        items.push(`<li>${renderInline(lines[i].trim().match(OL_RE)[1].trim())}</li>`);
        i += 1;
      }
      html.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Paragraph: gather consecutive lines that are not blank and do not open
    // another block, join with a space, and inline-render.
    const para = [];
    while (i < lines.length) {
      const l = lines[i];
      const t = l.trim();
      if (
        t === '' ||
        t.startsWith('```') ||
        t.startsWith('>') ||
        HR_RE.test(t) ||
        HEADING_RE.test(t) ||
        UL_RE.test(t) ||
        OL_RE.test(t)
      ) {
        break;
      }
      para.push(t);
      i += 1;
    }
    html.push(`<p>${renderInline(para.join(' '))}</p>`);
  }

  return html.join('\n');
}

export function renderLoreMarkdown(md) {
  if (md == null) return '';
  // Parse block structure on the RAW lines (so `>` reads as a block quote, not an
  // escaped `&gt;`); each text segment is HTML-escaped where it is emitted, so raw
  // HTML in the source never survives as live markup.
  const lines = String(md).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  return renderBlocks(lines);
}

// ---------------------------------------------------------------------------
// The router — two thin, read-only endpoints. No Mongo, no writes.
// ---------------------------------------------------------------------------

const router = express.Router();

// GET /api/lore — the ordered manifest as [{ slug, title }], no file bodies.
// Feeds the frontend lore index page (AC #7).
router.get('/lore', (req, res) => {
  res.json(LORE_MANIFEST.map(({ slug, title }) => ({ slug, title })));
});

// GET /api/lore/:slug — one rendered lore page.
//
// Order is load-bearing (AC #5): allowlist FIRST, then build the path, then a
// containment check, then read. The raw slug is NEVER concatenated into a path
// before it has been confirmed to be a manifest slug.
router.get('/lore/:slug', async (req, res) => {
  const entry = MANIFEST_BY_SLUG.get(req.params.slug);
  if (!entry) {
    // Unknown slug, or a path-traversal payload (e.g. ../config): not a manifest
    // slug, so nothing is ever read. Clean, body-safe 404.
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Lore page not found' });
  }

  // Only now build the path — from the ALLOWLISTED slug, not the raw parameter.
  const filePath = path.resolve(LORE_DIR, `${entry.slug}.md`);

  // Defence in depth: assert the resolved path still lives inside the lore
  // directory before reading, so even a manifest bug cannot escape it.
  if (filePath !== path.join(LORE_DIR, `${entry.slug}.md`) || !filePath.startsWith(LORE_DIR + path.sep)) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Lore page not found' });
  }

  let md;
  try {
    md = await fs.readFile(filePath, 'utf8');
  } catch {
    // A manifest slug whose backing file is missing/unreadable: a modelled content
    // error (mirroring the 503 STORE_ERROR shape), NEVER a raw 500 and never a
    // path or stack trace in the body (AC #8).
    return res.status(500).json({ error: 'CONTENT_ERROR', message: 'Lore page temporarily unavailable' });
  }

  res.json({ slug: entry.slug, title: entry.title, html: renderLoreMarkdown(md) });
});

export default router;
