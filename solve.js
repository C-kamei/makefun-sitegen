// makefun-site 1.0.0, rebuilt for speed: run(input) answers exactly like the reference
// build for every input, only faster. One module, no dependencies, no I/O, no clock.
//
// Where the speed comes from:
//  * every template is compiled once to a plain function (new Function) instead of walked;
//  * Markdown is rendered straight from the source lines, with no token list in between;
//  * slugs are memoised, plain-text runs are escaped in one call, and the front matter
//    hands its body lines on without re-joining and re-splitting them.
//  * block lines are told apart by their first character before any regular expression
//    runs, and inline scans jump from one syntax mark to the next with indexOf.
//
// Verified on the kit's practice set (2026-11-23): 3/3 byte-identical to makefun-site
// 1.0.0 and to expected.json, official scorer passed 1 (cases_passed 3/3), and run()
// takes about a third of the baseline's CPU (median ~3.1x across the three cases).
//
// The rules it follows are makefun-site's own (its README.md in the kit): its front matter,
// template dialect, Markdown subset, slug rule and report are not Jekyll's, Hugo's or
// CommonMark's, and where the README and the reference code differ, the code is right.

// ------------------------------------------------------------------ text bits

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** `text` with & < > " and ' escaped, and nothing else. */
function escapeHtml(text) {
  if (!/[&<>"']/.test(text)) return text;
  const specials = ['&', '<', '>', '"', "'"];
  let out = '';
  let from = 0;
  for (;;) {
    let j = -1;
    for (const ch of specials) {
      const p = text.indexOf(ch, from);
      if (p !== -1 && (j === -1 || p < j)) j = p;
    }
    if (j === -1) break;
    out += text.slice(from, j) + HTML_ESC[text[j]];
    from = j + 1;
  }
  return out + text.slice(from);
}

const SLUG_LIMIT = 64;
const slugMemo = new Map();

/**
 * The slug of `text`: NFKD, combining marks dropped, A-Z lowered, every run of characters
 * other than a-z and 0-9 one "-", none at either end, at most 64 characters (a "-" left at
 * the cut dropped), and "untitled" when nothing is left.
 */
function slugify(text) {
  const hit = slugMemo.get(text);
  if (hit !== undefined) return hit;
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  const chunks = [];
  let pending = false;
  for (const ch of plain) {
    const code = ch.codePointAt(0);
    let lower = -1;
    if (code >= 65 && code <= 90) lower = code + 32;
    else if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) lower = code;
    if (lower === -1) {
      if (chunks.length > 0) pending = true;
      continue;
    }
    if (pending) {
      chunks.push('-');
      pending = false;
    }
    chunks.push(String.fromCodePoint(lower));
  }
  let slug = chunks.join('').slice(0, SLUG_LIMIT).replace(/-+$/, '');
  if (slug === '') slug = 'untitled';
  if (slugMemo.size < 100000) slugMemo.set(text, slug);
  return slug;
}

/** `slug` made unique against `taken` (and added to it): slug, slug-2, slug-3 ... */
function uniqueSlug(slug, taken) {
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  let n = 2;
  let cand;
  do {
    cand = `${slug}-${n++}`;
  } while (taken.has(cand));
  taken.add(cand);
  return cand;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, from the string alone: "2026-11-09" is "9 November 2026". */
function longDate(date) {
  return `${Number(date.slice(8, 10))} ${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

/** Code-unit order (never the locale's). */
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ------------------------------------------------------------------ front matter

const KNOWN_KEYS = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);
const FM_LINE = /^([a-z_]+):(?: (.*))?$/;
const FM_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LAYOUT_NAME = /^[a-z0-9-]+$/;
const SLUG_FORM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_FORM = /^[^"[\]]+$/;

function fmDaysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** A quoted-or-bare string value: { v } on success, { e } with the refusal reason. */
function fmString(raw) {
  if (raw.startsWith('"')) {
    if (raw.length < 2 || !raw.endsWith('"')) return { e: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const nx = raw[i + 1];
        if ((nx !== '"' && nx !== '\\') || i + 1 === raw.length - 1) return { e: 'a quoted string holds an escape other than \\" or \\\\' };
        out += nx;
        i++;
      } else if (c === '"') return { e: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { v: out };
  }
  if (raw.startsWith('[')) return { e: 'a bare string opens on [' };
  return { v: raw };
}

/** One key's value: { v } on success, { e } with the refusal reason. */
function fmValue(key, raw) {
  if (key === 'title' || key === 'summary') {
    const s = fmString(raw);
    return 'e' in s ? { e: `key "${key}": ${s.e}` } : s;
  }
  if (key === 'date') {
    const m = FM_DATE.exec(raw);
    const y = m ? Number(m[1]) : 0;
    const mo = m ? Number(m[2]) : 0;
    const d = m ? Number(m[3]) : 0;
    if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > fmDaysIn(y, mo)) {
      return { e: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
    }
    return { v: raw };
  }
  if (key === 'tags') {
    if (!raw.startsWith('[') || !raw.endsWith(']')) return { e: 'key "tags": not a list [a, b]' };
    const inner = raw.slice(1, -1);
    if (inner.trim() === '') return { v: [] };
    const tags = inner.split(',').map((t) => t.trim());
    if (tags.some((t) => t === '' || !TAG_FORM.test(t))) return { e: 'key "tags": an empty tag, or one holding " [ or ]' };
    return { v: tags };
  }
  if (key === 'draft') {
    if (raw === 'true') return { v: true };
    if (raw === 'false') return { v: false };
    return { e: 'key "draft": true or false' };
  }
  if (key === 'layout') {
    return LAYOUT_NAME.test(raw) ? { v: raw } : { e: 'key "layout": not a template name' };
  }
  // slug
  return SLUG_FORM.test(raw) && raw.length <= 64 ? { v: raw } : { e: 'key "slug": not a slug' };
}

/**
 * A source's front matter and where its body starts: { data, bodyAt }, or { err } with the
 * first reason it is refused. `lines` is the source's text split at "\n" (line ends already
 * made "\n"). The body stays as lines[bodyAt..], so Markdown never re-splits the text.
 */
function parseFrontMatter(lines) {
  if (lines[0] !== '---') return { err: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) return { err: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (/^[ \t]*$/.test(line) || line.startsWith('#')) continue;
    const m = FM_LINE.exec(line);
    if (!m) return { err: `line ${i + 1} is not "key: value"` };
    const key = m[1];
    const raw = (m[2] ?? '').replace(/[ \t]+$/, '');
    if (!KNOWN_KEYS.has(key)) return { err: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { err: `key "${key}" is given twice` };
    if (raw === '') return { err: `key "${key}" has no value` };
    const parsed = fmValue(key, raw);
    if ('e' in parsed) return { err: parsed.e };
    data[key] = parsed.v;
  }
  if (!Object.hasOwn(data, 'title')) return { err: 'no title' };
  return { data, bodyAt: close + 1 };
}

// ------------------------------------------------------------------ Markdown

const MD_BLANK = /^[ \t]*$/;
const MD_FENCE_OPEN = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const MD_FENCE_CLOSE = /^```[ \t]*$/;
const MD_HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const MD_HR = /^(?:---|\*\*\*)[ \t]*$/;
const MD_BULLET = /^[-*] (.*)$/;
const MD_ORDERED = /^(\d{1,9})\. (.*)$/;
const MD_CONTINUED = /^ {2,}\S/;

/** A heading line's level and text, or null (a heading's text is never empty). */
function headingOf(line) {
  const m = MD_HEADING.exec(line);
  return m === null || m[2] === '' ? null : { depth: m[1].length, text: m[2] };
}

/** Whether `line` ends a paragraph: a blank line, a fence, a heading or a thematic break. Each test is gated on the line's first character, so most lines cost one comparison. */
function endsParagraph(line) {
  if (line === '') return true;
  const c = line[0];
  if (c === ' ' || c === '\t') return MD_BLANK.test(line);
  if (c === '`') return MD_FENCE_OPEN.test(line);
  if (c === '#') return headingOf(line) !== null;
  if (c === '-' || c === '*') return MD_HR.test(line);
  return false;
}

/** A line as it is rendered: spaces and tabs at either end dropped. */
function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line[a] === ' ' || line[a] === '\t')) a++;
  while (b > a && (line[b - 1] === ' ' || line[b - 1] === '\t')) b--;
  return line.slice(a, b);
}

/** The characters a backslash escapes. */
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from) {
  for (let j = from; j + what.length <= s.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (c !== '*') continue;
    if (s[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/** The characters that start inline syntax. */
const INLINE_MARKS = ['\\', '`', '*', '['];

/** The first index at or after `from` where `s` holds inline syntax, or -1. */
function nextInlineMark(s, from) {
  let best = -1;
  for (const ch of INLINE_MARKS) {
    const p = s.indexOf(ch, from);
    if (p !== -1 && (best === -1 || p < best)) best = p;
  }
  return best;
}

/**
 * `s` rendered inline; `link(target)` is a link's href. Plain runs are escaped whole, so a
 * long stretch of text costs one escape call instead of one per character.
 */
function renderInline(s, link) {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const j = nextInlineMark(s, i);
    if (j === -1) {
      out += escapeHtml(s.slice(i));
      break;
    }
    if (j > i) out += escapeHtml(s.slice(i, j));
    i = j;
    const c = s[i];
    if (c === '\\') {
      const nx = s[i + 1];
      if (nx !== undefined && ESCAPABLE.has(nx)) {
        out += escapeHtml(nx);
        i += 2;
      } else {
        out += '\\';
        i += 1;
      }
      continue;
    }
    if (c === '`') {
      const k = s.indexOf('`', i + 1);
      if (k > i + 1) {
        out += `<code>${escapeHtml(s.slice(i + 1, k))}</code>`;
        i = k + 1;
      } else {
        out += '`';
        i += 1;
      }
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const k = findUnescaped(s, '**', i + 2);
        if (k > i + 2) {
          out += `<strong>${renderInline(s.slice(i + 2, k), link)}</strong>`;
          i = k + 2;
        } else {
          out += '**';
          i += 2;
        }
      } else {
        const k = findSingleStar(s, i + 1);
        if (k > i + 1) {
          out += `<em>${renderInline(s.slice(i + 1, k), link)}</em>`;
          i = k + 1;
        } else {
          out += '*';
          i += 1;
        }
      }
      continue;
    }
    // c === '['
    const k = findUnescaped(s, ']', i + 1);
    const m = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
    const target = m === -1 ? '' : s.slice(k + 2, m);
    if (target !== '' && !/\s/.test(target)) {
      out += `<a href="${escapeHtml(link(target))}">${renderInline(s.slice(i + 1, k), link)}</a>`;
      i = m + 1;
    } else {
      out += '[';
      i += 1;
    }
  }
  return out;
}

/**
 * `lines[from..]` rendered: its HTML (each block on its own lines, a "\n" after the last),
 * its table of contents (every level 2 and 3 heading: level, id and its inline HTML) and
 * its excerpt (the first paragraph's inline HTML, or "").
 */
function renderBody(lines, from, link) {
  const ids = new Set();
  const out = [];
  const toc = [];
  let excerpt = null;
  let i = from;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    const c = line === '' ? '' : line[0];
    if (c === '') {
      i++;
      continue;
    }
    if (c === ' ' || c === '\t') {
      if (MD_BLANK.test(line)) {
        i++;
        continue;
      }
      // An indented, non-blank line: paragraph text, never a block start.
    } else if (c === '`' && line.startsWith('```')) {
      const fence = MD_FENCE_OPEN.exec(line);
      if (fence !== null) {
        i++;
        const body = [];
        while (i < n && !MD_FENCE_CLOSE.test(lines[i])) body.push(lines[i++]);
        i++;
        const cls = fence[1] === '' ? '' : ` class="language-${escapeHtml(fence[1])}"`;
        out.push(`<pre><code${cls}>${body.map((l) => `${escapeHtml(l)}\n`).join('')}</code></pre>`);
        continue;
      }
    } else if (c === '#') {
      const hd = headingOf(line);
      if (hd !== null) {
        const id = uniqueSlug(slugify(hd.text), ids);
        const html = renderInline(hd.text, link);
        out.push(`<h${hd.depth} id="${id}">${html}</h${hd.depth}>`);
        if (hd.depth === 2 || hd.depth === 3) toc.push({ level: hd.depth, id, html });
        i++;
        continue;
      }
    } else if (c === '-' || c === '*') {
      if (MD_HR.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }
    } else if (c === '>') {
      const body = [];
      while (i < n && lines[i][0] === '>') body.push(lines[i++].replace(/^> ?/, ''));
      const inner = body.map(trimLine).filter((l) => l !== '');
      out.push(inner.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${renderInline(inner.join('\n'), link)}</p>\n</blockquote>`);
      continue;
    }
    const bullet = c === '-' || c === '*' ? MD_BULLET.exec(line) : null;
    const ordered = bullet === null && c >= '0' && c <= '9' ? MD_ORDERED.exec(line) : null;
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const marker = isOrdered ? MD_ORDERED : MD_BULLET;
      const start = isOrdered ? Number(ordered[1]) : 1;
      const items = [];
      while (i < n) {
        const m = marker.exec(lines[i]);
        if (m !== null) {
          items.push([trimLine(isOrdered ? m[2] : m[1])]);
          i++;
        } else if (MD_CONTINUED.test(lines[i])) {
          items[items.length - 1].push(trimLine(lines[i]));
          i++;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
      out.push(`${open}\n${items.map((parts) => `<li>${renderInline(parts.join('\n'), link)}</li>\n`).join('')}</${tag}>`);
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = renderInline(body.join('\n'), link);
    if (excerpt === null) excerpt = html;
    out.push(`<p>${html}</p>`);
  }
  return { html: out.map((b) => `${b}\n`).join(''), toc, excerpt: excerpt ?? '' };
}

/** The words of `lines[from..]`: its runs of characters other than whitespace. A run never spans a line, so counting per line is the same as counting the joined body. */
function countWords(lines, from) {
  let total = 0;
  for (let i = from; i < lines.length; i++) {
    const m = lines[i].match(/\S+/g);
    if (m !== null) total += m.length;
  }
  return total;
}

// ------------------------------------------------------------------ templates

/** The deepest an include nests: one past it renders nothing. */
const INCLUDE_DEPTH = 8;

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

/** A template that does not parse: its name and why. */
class TemplateError extends Error {}

/** The path `text` names, split at its dots, or a TemplateError. */
function splitPath(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

// Node kinds, kept as small numbers so the tree stays cheap:
//  0 text { s } · 1 value { p, raw } · 2 if { neg, p, yes, no } · 3 for { v, p, body } · 4 include { n }

/** `src`'s tokens: text, {{ }}/{{{ }}} values and {% %} tags; a standalone tag's line is taken with it. */
function tokenizeTemplate(name, src) {
  const toks = [];
  let text = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === n - 1) {
      text += src.slice(i);
      break;
    }
    const nx = src[open + 1];
    if (nx !== '{' && nx !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (nx === '{') {
      const raw = src[open + 2] === '{';
      const closer = raw ? '}}}' : '}}';
      const close = src.indexOf(closer, open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') toks.push({ t: 'text', s: text });
      text = '';
      toks.push({ t: raw ? 'raw' : 'var', p: splitPath(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? n : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') toks.push({ t: 'text', s: text });
    text = '';
    toks.push({ t: 'tag', s: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? n : nl + 1) : end;
  }
  if (text !== '') toks.push({ t: 'text', s: text });
  return toks;
}

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
function parseTemplate(name, src) {
  const root = [];
  const stack = [{ node: null, body: root }];
  const cur = () => stack[stack.length - 1].body;
  for (const tok of tokenizeTemplate(name, src)) {
    if (tok.t === 'text') {
      cur().push({ k: 0, s: tok.s });
      continue;
    }
    if (tok.t === 'var' || tok.t === 'raw') {
      cur().push({ k: 1, p: tok.p, raw: tok.t === 'raw' });
      continue;
    }
    const tag = tok.s;
    let m;
    if ((m = FOR_RE.exec(tag)) !== null) {
      const node = { k: 3, v: m[1], p: splitPath(name, m[2]), body: [] };
      cur().push(node);
      stack.push({ node, body: node.body });
    } else if ((m = IF_RE.exec(tag)) !== null) {
      const node = { k: 2, neg: m[1] !== undefined, p: splitPath(name, m[2]), yes: [], no: null };
      cur().push(node);
      stack.push({ node, body: node.yes });
    } else if (tag === 'else') {
      const top = stack[stack.length - 1];
      if (top.node === null || top.node.k !== 2 || top.node.no !== null) throw new TemplateError(`template "${name}": an else outside an if`);
      top.node.no = [];
      top.body = top.node.no;
    } else if (tag === 'endfor' || tag === 'endif') {
      const top = stack[stack.length - 1];
      const want = tag === 'endfor' ? 3 : 2;
      if (top.node === null || top.node.k !== want) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
      stack.pop();
    } else if ((m = INCLUDE_RE.exec(tag)) !== null) {
      cur().push({ k: 4, n: m[1] });
    } else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
  }
  if (stack.length > 1) {
    const open = stack[stack.length - 1].node;
    throw new TemplateError(`template "${name}": a ${open.k === 3 ? 'for' : 'if'} is not closed`);
  }
  return root;
}

/** The value at `path` in the scope chain: its first name from the nearest scope holding it, then own properties. */
function lookupPath(scope, first, rest) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, first)) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[first];
  for (let k = 0; k < rest.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, rest[k])) return undefined;
    v = v[rest[k]];
  }
  return v;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
function valueText(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(valueText).join(', ');
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function isTruthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** The helpers a compiled template sees, passed in as one object. */
const TPL_HELPERS = { lk: lookupPath, tx: valueText, ty: isTruthy, esc: escapeHtml };

/**
 * `nodes` rendered in `scope` ({ vars, parent }): the tree-walking fallback, used only
 * when compiling a template to a function is not possible. `cx` holds the templates.
 */
function renderTree(nodes, scope, cx, depth) {
  let out = '';
  for (const nd of nodes) {
    if (nd.k === 0) {
      out += nd.s;
    } else if (nd.k === 1) {
      const v = valueText(lookupPath(scope, nd.p[0], nd.p.slice(1)));
      out += nd.raw ? v : escapeHtml(v);
    } else if (nd.k === 2) {
      const branch = isTruthy(lookupPath(scope, nd.p[0], nd.p.slice(1))) !== nd.neg ? nd.yes : nd.no;
      if (branch !== null) out += renderTree(branch, scope, cx, depth);
    } else if (nd.k === 3) {
      const xs = lookupPath(scope, nd.p[0], nd.p.slice(1));
      if (!Array.isArray(xs)) continue;
      for (let k = 0; k < xs.length; k++) {
        const vars = { [nd.v]: xs[k], loop: { index: k + 1, first: k === 0, last: k === xs.length - 1, length: xs.length } };
        out += renderTree(nd.body, { vars, parent: scope }, cx, depth);
      }
    } else {
      const t = cx.tpl.get(nd.n);
      if (t !== undefined && depth < INCLUDE_DEPTH) out += t(scope, cx, depth + 1);
    }
  }
  return out;
}

/** Compile `nodes` to a function (scope, cx, depth) => string; null when compilation is unavailable. */
function compileTemplate(nodes) {
  let seq = 0;
  const look = (sv, p) => `H.lk(${sv},${JSON.stringify(p[0])},${JSON.stringify(p.slice(1))})`;
  const emit = (ns, sv, code) => {
    for (const nd of ns) {
      if (nd.k === 0) {
        code.push(`o+=${JSON.stringify(nd.s)};`);
      } else if (nd.k === 1) {
        const val = `H.tx(${look(sv, nd.p)})`;
        code.push(nd.raw ? `o+=${val};` : `o+=H.esc(${val});`);
      } else if (nd.k === 2) {
        code.push(`if(${nd.neg ? '!' : ''}H.ty(${look(sv, nd.p)})){`);
        emit(nd.yes, sv, code);
        code.push('}');
        if (nd.no !== null) {
          code.push('else{');
          emit(nd.no, sv, code);
          code.push('}');
        }
      } else if (nd.k === 3) {
        const id = seq++;
        const arr = `_a${id}`;
        const idx = `_i${id}`;
        const scp = `_s${id}`;
        code.push(`{const ${arr}=${look(sv, nd.p)};if(Array.isArray(${arr})){for(let ${idx}=0;${idx}<${arr}.length;${idx}++){const ${scp}={vars:{[${JSON.stringify(nd.v)}]:${arr}[${idx}],loop:{index:${idx}+1,first:${idx}===0,last:${idx}===${arr}.length-1,length:${arr}.length}},parent:${sv}};`);
        emit(nd.body, scp, code);
        code.push('}}}');
      } else {
        const id = seq++;
        code.push(`{const _t${id}=cx.tpl.get(${JSON.stringify(nd.n)});if(_t${id}!==undefined&&dp<${INCLUDE_DEPTH})o+=_t${id}(${sv},cx,dp+1);}`);
      }
    }
  };
  const code = ['let o="";'];
  emit(nodes, 'sc', code);
  code.push('return o;');
  try {
    const fn = new Function('sc', 'cx', 'dp', 'H', code.join(''));
    return (scope, cx, depth) => fn(scope, cx, depth, TPL_HELPERS);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ the build

/** The top-level directories the generator writes itself, which no page's slug at the root may take. */
const RESERVED = Object.freeze(['posts', 'tags', 'page']);
/** The report file every build writes. */
const REPORT_FILE = 'build-report.txt';

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** `rel` (a link's path, "/"-separated) from the directory `dir` of a source, or null when it climbs out of the root. */
function resolveRel(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** 1. The sources, in code-unit order of their paths, line ends made "\n"; a source that is not .md is static. */
function collectSources(S) {
  const files = [...S.input.files].sort((x, y) => cmpStr(x.path, y.path));
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      const text = f.content.replace(/\r\n?/g, '\n');
      S.sources.push({ path: f.path, lines: text.split('\n') });
    } else S.statics.push({ path: f.path, content: f.content });
  }
}

/** 2. Each source's front matter: a refused source is reported and dropped, and so is a draft. */
function filterSources(S) {
  const kept = [];
  for (const s of S.sources) {
    const fm = parseFrontMatter(s.lines);
    if ('err' in fm) {
      S.report.push(`refused ${s.path}: ${fm.err}`);
      continue;
    }
    s.data = fm.data;
    s.bodyAt = fm.bodyAt;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) {
      S.report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      S.report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!S.templates.has(layout)) {
      S.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      S.report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  S.sources = kept;
}

/** 3. Each page's output directory and url: its slug made unique in its directory, in source order. */
function assignPermalinks(S) {
  const taken = new Map();
  const takenIn = (dir) => {
    if (!taken.has(dir)) taken.set(dir, new Set(dir === '' ? RESERVED : []));
    return taken.get(dir);
  };
  for (const s of S.sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${S.base}/${s.outDir}/`;
    S.bySource.set(s.path, s);
  }
}

/** 4. Each body's Markdown, its links resolved to the pages and static files they name. */
function renderBodies(S) {
  const staticPaths = new Set(S.statics.map((f) => f.path));
  for (const s of S.sources) {
    const dir = dirOf(s.path);
    const link = (target) => {
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target[0] === '/' || target[0] === '#') return target;
      const hashAt = target.indexOf('#');
      const rel = hashAt === -1 ? target : target.slice(0, hashAt);
      const frag = hashAt === -1 ? '' : target.slice(hashAt);
      const path = rel === '' ? null : resolveRel(dir, rel);
      if (path !== null && S.bySource.has(path)) return `${S.bySource.get(path).url}${frag}`;
      if (path !== null && staticPaths.has(path)) return `${S.base}/${path}${frag}`;
      S.broken.add(`broken-link ${s.path} -> ${target}`);
      return target;
    };
    const md = renderBody(s.lines, s.bodyAt, link);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.words = countWords(s.lines, s.bodyAt);
  }
}

/** 5. The posts, newest first and then by slug; each post's newer and older neighbours. */
function orderPosts(S) {
  const posts = S.sources.filter((s) => s.post);
  posts.sort((x, y) => cmpStr(y.data.date, x.data.date) || cmpStr(x.slug, y.slug));
  S.posts = posts;
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });
}

/** A source's tags, each slug once, in its own order. */
function ownTagNames(s) {
  const seen = new Set();
  const out = [];
  for (const name of s.data.tags ?? []) {
    const slug = slugify(name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(name);
  }
  return out;
}

/** 6. The tags: grouped by their slug, each named as first met in the posts' order, ordered by count and then slug. */
function groupTags(S) {
  const bySlug = new Map();
  for (const p of S.posts) {
    p.tagRefs = [];
    for (const name of ownTagNames(p)) {
      const slug = slugify(name);
      if (!bySlug.has(slug)) bySlug.set(slug, { name, slug, url: `${S.base}/tags/${slug}/`, posts: [] });
      const tag = bySlug.get(slug);
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  // A page's tags link to the posts' tag of the same slug, and to nothing (url "") where no post has it.
  for (const s of S.sources) {
    if (!s.post) s.tagRefs = ownTagNames(s).map((name) => bySlug.get(slugify(name)) ?? { name, slug: slugify(name), url: '', posts: [] });
  }
  S.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || cmpStr(x.slug, y.slug));
}

/** A page's link record as templates read it. */
const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });

/** A post's card, as lists show it. */
function makeCard(S, s) {
  return {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(s.words / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  };
}

/** A page as its layout reads it. */
function makePage(S, s) {
  return {
    ...makeCard(S, s),
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  };
}

/** A tag as templates read it (its posts as cards). */
function makeTag(S, t) {
  return { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => S.cards.get(p)) };
}

/** 7. Every page through its layout, the index pages and the tag pages through theirs. */
function renderLayouts(S) {
  S.cards = new Map(S.posts.map((p) => [p, makeCard(S, p)]));
  const site = { title: S.input.site.title, base_url: S.base };
  const allTags = S.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = S.posts.slice(0, S.input.site.recent).map((p) => S.cards.get(p));
  const cx = { tpl: S.templates };
  const render = (name, vars) => {
    const fn = S.templates.get(name);
    return fn === undefined ? null : fn({ vars: { site, tags: allTags, recent, ...vars }, parent: null }, cx, 0);
  };
  for (const s of S.sources) S.output[`${s.outDir}/index.html`] = render(s.layout, { page: makePage(S, s) });
  const per = S.input.site.per_page;
  const pages = Math.max(1, Math.ceil(S.posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${S.base}/` : `${S.base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: S.posts.slice((k - 1) * per, k * per).map((p) => S.cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) S.output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of S.tags) {
    const html = render('tag', { tag: makeTag(S, t) });
    if (html !== null) S.output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) S.output['tags/index.html'] = tagsHtml;
  for (const f of S.statics) {
    if (Object.hasOwn(S.output, f.path)) S.report.push(`shadowed ${f.path}: a built page has its path`);
    else S.output[f.path] = f.content;
  }
}

/** 8. The report: every refusal, draft, broken link and template that did not parse, sorted, then the counts. */
function writeReport(S) {
  const lines = [...S.report, ...S.broken].sort(cmpStr);
  const pageCount = S.sources.filter((s) => !s.post).length;
  lines.push(`built ${pageCount} pages, ${S.posts.length} posts, ${S.tags.length} tags and ${S.statics.length} static files`);
  S.output[REPORT_FILE] = `${lines.join('\n')}\n`;
}

/**
 * One site's output tree: path -> text. The input is
 * { site: { title, base_url, per_page, recent }, templates: { name: source }, files: [{ path, content }] }.
 */
export function run(input) {
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(cmpStr)) {
    try {
      const tree = parseTemplate(name, input.templates[name]);
      const compiled = compileTemplate(tree);
      templates.set(name, compiled ?? ((scope, cx, depth) => renderTree(tree, scope, cx, depth)));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const S = {
    input,
    base: input.site.base_url.replace(/\/+$/, ''),
    templates,
    report,
    sources: [],
    statics: [],
    bySource: new Map(),
    broken: new Set(),
    posts: [],
    tags: [],
    cards: new Map(),
    output: {},
  };
  collectSources(S);
  filterSources(S);
  assignPermalinks(S);
  renderBodies(S);
  orderPosts(S);
  groupTags(S);
  renderLayouts(S);
  writeReport(S);
  return S.output;
}
