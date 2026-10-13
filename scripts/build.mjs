import { mkdir, readFile, writeFile, copyFile, readdir, stat, rm } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import chardet from "chardet";
import iconv from "iconv-lite";

const ROOT = path.resolve(import.meta.dirname, "..");
const RAW = path.join(ROOT, "content", "raw");
const DIST = path.join(ROOT, "dist");
const HTML_EXT = /\.(shtml|html|htm)$/i;
const DROP_SCRIPTS = /kk_info\.js|side_menu\.js|bottom_menu\.js|copyright\.js|subscription_box\.js|search_box\.js|urchin\.js|google-analytics|googletagmanager|extreme-dm|statcounter|nedstat|histats/i;
const SKIP_PAGES = new Set(["google.htm", "last_updated.htm"]);

const SECTION_NAMES = {
  "": "Site pages",
  "light-of-israel": "Light of Israel",
  ned: "Dutch",
  hebrew: "Hebrew",
  chinese: "Chinese",
  deutsch: "German",
  espanol: "Spanish",
  italiana: "Italian",
  translations: "Translations",
  rekhavi: "Rekhavi articles",
  new_moon: "New moon reports",
  abib: "Abib reports",
  aviv: "Aviv reports",
  tanach: "Tanach",
  downloads: "Downloads",
  bookstore: "Bookstore",
  store: "Store",
  members: "Members",
  contacts: "Contacts",
  sources: "Sources",
  audio: "Audio",
  __media: "Media files",
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function prefixFor(rel) {
  const depth = rel.split("/").filter(Boolean).length - 1;
  return depth > 0 ? "../".repeat(depth) : "";
}

function decode(buf, rel) {
  const head = buf.subarray(0, 2500).toString("latin1");
  const meta = head.match(/charset\s*=\s*["']?\s*([a-zA-Z0-9._-]+)/i);
  let encoding = meta?.[1]?.toLowerCase() || "";
  if (encoding === "iso-8859-1" || encoding === "latin1" || encoding === "us-ascii") encoding = "";
  if (!encoding || !iconv.encodingExists(encoding)) {
    const detected = (chardet.detect(buf) || "").toLowerCase();
    encoding = iconv.encodingExists(detected) ? detected : "windows-1252";
  }
  if ((encoding === "windows-1252" || encoding === "iso-8859-1") && /^hebrew\//i.test(rel)) {
    encoding = "windows-1255";
  }
  const text = iconv.decode(buf, encoding);
  const hebrew = (text.match(/[\u0590-\u05FF]/g) || []).length;
  if (hebrew < 8 && encoding !== "windows-1255" && encoding !== "iso-8859-8") {
    const alt = iconv.decode(buf, "windows-1255");
    const altHebrew = (alt.match(/[\u0590-\u05FF]/g) || []).length;
    const altLatin = (alt.match(/[A-Za-z]{3,}/g) || []).length;
    if (altHebrew > 40 && altHebrew > hebrew * 3 && altLatin < altHebrew) return alt;
  }
  return text;
}

async function readHtml(rel, stack = new Set()) {
  if (stack.has(rel)) return "";
  stack.add(rel);
  const buf = await readFile(path.join(RAW, rel));
  let html = decode(buf, rel);
  const include = /<!--\s*#include\s+(?:virtual|file)\s*=\s*["']([^"']+)["']\s*-->/gi;
  const parts = [];
  let last = 0;
  let match;
  while ((match = include.exec(html))) {
    parts.push(html.slice(last, match.index));
    const target = match[1].replace(/^\/+/, "").split("?")[0];
    const candidates = [target, path.posix.join(path.posix.dirname(rel), target)];
    let inserted = "";
    for (const candidate of candidates) {
      const normalized = path.posix.normalize(candidate).replace(/^(\.\.\/)+/, "");
      try {
        await stat(path.join(RAW, normalized));
        inserted = await readHtml(normalized, stack);
        break;
      } catch {
        /* try the next location */
      }
    }
    parts.push(inserted);
    last = match.index + match[0].length;
  }
  parts.push(html.slice(last));
  return parts.join("");
}

function dominantDir(text) {
  const hebrew = (text.match(/[\u0590-\u05FF]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return hebrew > 40 && hebrew > latin ? "rtl" : "ltr";
}

function rewriteUrl(value, prefix) {
  if (!value) return value;
  const trimmed = value.trim();
  if (!trimmed || /^(mailto:|javascript:|#|data:)/i.test(trimmed)) return value;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("//")) {
    let url;
    try {
      url = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
    } catch {
      return value;
    }
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "karaite-korner.org") return value;
    if (url.pathname === "/") return `${prefix}index.html${url.hash}`;
    return `${prefix}${url.pathname.replace(/^\/+/, "")}${url.search}${url.hash}`;
  }
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    if (trimmed === "/") return `${prefix}index.html`;
    return `${prefix}${trimmed.slice(1)}`;
  }
  return value;
}

function header(prefix, current) {
  const items = [
    ["index.html", "Home"],
    ["main.shtml", "Karaism"],
    ["holidays.shtml", "Holidays"],
    ["new_moon.shtml", "Calendar"],
    ["archive.html", "Archive"],
    ["search.html", "Search"],
  ];
  const links = items
    .map(([href, label]) => {
      const currentAttr = current === href ? ' aria-current="page"' : "";
      return `<a href="${prefix}${href}"${currentAttr}>${label}</a>`;
    })
    .join("");
  return `<a class="skip-link" href="#content">Skip to content</a>
<header class="site-header">
  <a class="brand" href="${prefix}index.html"><img src="${prefix}logobox.gif" alt="The Karaite Korner" width="307" height="151"></a>
  <nav class="site-nav" aria-label="Primary">${links}</nav>
  <form class="search-form" action="${prefix}search.html" method="get" role="search">
    <label class="visually-hidden" for="site-search">Search</label>
    <input id="site-search" name="q" type="search" placeholder="Search the archive">
  </form>
</header>`;
}

function footer(prefix) {
  return `<footer class="site-footer">
  <p>Karaite Korner. Copyright 1998–2007. All rights reserved.</p>
  <p><a href="${prefix}archive.html">Full archive</a> · <a href="${prefix}donate.shtml">Donate</a></p>
</footer>`;
}

function shell({ title, description, body, rel, dir = "ltr", wide = false, ignore = false, extraHead = "" }) {
  const prefix = prefixFor(rel);
  const desc = description?.trim()
    ? `<meta name="description" content="${escapeHtml(description.trim())}">`
    : "";
  const ignoreAttr = ignore ? ' data-pagefind-ignore="all"' : "";
  const mainClass = wide ? ' class="wide"' : "";
  const indexAttr = ignore ? "" : " data-pagefind-body";
  return `<!DOCTYPE html>
<html lang="${dir === "rtl" ? "he" : "en"}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${desc}
<link rel="stylesheet" href="${prefix}assets/site.css">
<link rel="icon" href="${prefix}logobox.gif">
${extraHead}
</head>
<body${ignoreAttr}>
${header(prefix, rel)}
<main id="content"${indexAttr}${mainClass}>
${body}
</main>
${footer(prefix)}
</body>
</html>
`;
}

function isEmbedded(rel) {
  return /(?:^|\/)(?:pages|thumbnails)\//i.test(rel) || /ThumbnailFrame\.htm$/i.test(rel);
}

function barePage({ title, body, styles }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title || "Karaite Korner")}</title>
${(styles || []).join("\n")}
</head>
<body>
${body}
</body>
</html>
`;
}

function transformBody(html, prefix) {
  html = html.replace(/\s%[\w]+%/g, "");
  const $ = load(html, { decodeEntities: false });
  $("script, noscript").each((_, el) => {
    const blob = `${$(el).attr("src") || ""} ${$(el).html() || ""}`;
    if (DROP_SCRIPTS.test(blob) || /urchinTracker|_uacct|kk_referrer/.test(blob)) $(el).remove();
  });
  $("img").each((_, el) => {
    if (DROP_SCRIPTS.test($(el).attr("src") || "")) $(el).remove();
  });
  const styles = [];
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!href || /kk_style\.css/i.test(href)) return;
    styles.push(`<link rel="stylesheet" href="${escapeHtml(rewriteUrl(href, prefix))}">`);
  });
  $("style").each((_, el) => {
    styles.push($.html(el));
  });
  $("img").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (/logobox\.gif|site_outline\.gif/i.test(src)) {
      const block = $(el).closest("center, p");
      if (block.length && block.find("img").length === 1) block.remove();
      else $(el).closest("a").addBack().remove();
    }
  });
  $("a[href*='extreme-dm'], a[href*='statcounter'], img[src*='extreme-dm']").remove();
  $("form").each((_, el) => {
    const action = $(el).attr("action") || "";
    if (!/cgi-bin|formmail/i.test(action)) return;
    let host = "karaite-korner.org";
    try {
      host = new URL(action, "https://www.karaite-korner.org/").hostname.replace(/^www\./, "");
    } catch {
      host = "karaite-korner.org";
    }
    if (host === "karaite-korner.org" || /formmail/i.test(action)) {
      $(el).replaceWith('<p class="retired-form">This form is no longer active.</p>');
    }
  });
  $("[href], [src], [background]").each((_, el) => {
    for (const attr of ["href", "src", "background"]) {
      const value = $(el).attr(attr);
      if (!value) continue;
      const next = rewriteUrl(value, prefix);
      if (next !== value) $(el).attr(attr, next);
    }
  });
  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  const description = $('meta[name="description"]').attr("content") || "";
  if ($("frameset").length) {
    const items = [];
    $("frame[src], iframe[src]").each((_, el) => {
      const src = $(el).attr("src");
      const name = $(el).attr("name") || src;
      if (src) items.push(`<li><a href="${escapeHtml(src)}">${escapeHtml(name)}</a></li>`);
    });
    const body = `<h1>${escapeHtml(title || "Frames")}</h1>
<p>This page was a set of frames. Each part is available on its own.</p>
<ul>${items.join("")}</ul>`;
    return { title, description, body, styles, wide: true };
  }
  const body = $("body").length ? $("body").html() || "" : $.root().html() || "";
  const wide = /iframe|galleryStyle|web photo gallery/i.test(html);
  return { title, description, body: body.trim(), styles, wide };
}

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, base)));
    else if (entry.isFile()) files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return files;
}

function labelFor(rel, title) {
  const cleaned = (title || "").replace(/\s+/g, " ").trim();
  if (cleaned && !/^karaite korner$/i.test(cleaned)) {
    return cleaned.length > 90 ? `${cleaned.slice(0, 87)}…` : cleaned;
  }
  const base = path.posix.basename(rel).replace(/\.(shtml|html|htm)$/i, "");
  return base.replace(/[_-]+/g, " ");
}

function sectionKey(rel) {
  const [top] = rel.split("/");
  return rel.includes("/") ? top : "";
}

async function writePage(rel, html) {
  const dest = path.join(DIST, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, html);
}

function renderHome(outline, redirects) {
  const groups = outline.groups
    .map((group) => {
      const items = group.links
        .map(([href, label]) => {
          const icon = '<svg class="external" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg><span class="visually-hidden"> (external link)</span>';
          let text = escapeHtml(label);
          if (redirects[`/${href}`]) {
            const parts = label.split(" ");
            const last = escapeHtml(parts.pop());
            const head = parts.length ? `${escapeHtml(parts.join(" "))} ` : "";
            text = `${head}<span class="nowrap">${last}${icon}</span>`;
          }
          return `<li><a href="${escapeHtml(href)}">${text}</a></li>`;
        })
        .join("");
      return `<section><h2>${escapeHtml(group.title)}</h2><ul>${items}</ul></section>`;
    })
    .join("");
  const body = `<h1>Karaite Korner</h1>
<p class="lede">${escapeHtml(outline.intro)}</p>
<div class="outline">${groups}</div>
<section class="archive-group">
  <h2>Archive</h2>
  <p>Older sections of the site are kept here as well, including translations, the Light of Israel essays, new-moon reports, and holiday articles that are no longer linked from the front page.</p>
  <p><a href="archive.html">Browse the full archive</a></p>
</section>`;
  return shell({
    title: "Karaite Korner",
    description: outline.intro,
    body,
    rel: "index.html",
    wide: true,
  });
}

function renderArchive(pages, files) {
  const groups = new Map();
  for (const page of pages) {
    if (page.rel === "index.html" || page.rel === "index.shtml" || page.rel === "archive.html" || page.rel === "search.html") continue;
    const key = sectionKey(page.rel);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(page);
  }
  const media = files.filter((rel) => /\.(pdf|zip|mp3|wav)$/i.test(rel));
  if (media.length) groups.set("__media", media.map((rel) => ({ rel, title: path.posix.basename(rel) })));

  const order = Object.keys(SECTION_NAMES);
  const keys = [...groups.keys()].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
  });
  const html = keys
    .map((key) => {
      const name = SECTION_NAMES[key] || key.replace(/-/g, " ");
      const items = groups
        .get(key)
        .sort((a, b) => a.rel.localeCompare(b.rel))
        .map((page) => `<li><a href="${escapeHtml(page.rel)}">${escapeHtml(labelFor(page.rel, page.title))}</a></li>`)
        .join("");
      return `<section class="archive-group"><h2>${escapeHtml(name)}</h2><ul>${items}</ul></section>`;
    })
    .join("");
  const body = `<h1>Archive</h1>
<p>Every page still published on Karaite Korner, plus sections that were taken offline and restored from the historical copies. Links on the home page that leave this site are marked with an external-link icon.</p>
${html}`;
  return shell({
    title: "Archive — Karaite Korner",
    description: "Full archive of Karaite Korner articles, translations, and reports.",
    body,
    rel: "archive.html",
    wide: true,
    ignore: true,
  });
}

function renderSearch() {
  const body = `<h1>Search</h1>
<form class="page-search" action="search.html" method="get" role="search">
  <label class="visually-hidden" for="search-query">Search the archive</label>
  <input id="search-query" name="q" type="search" placeholder="Search the archive" autocomplete="off">
</form>
<p id="search-status">Loading the index…</p>
<ul id="search-results"></ul>
<script src="search.js"></script>`;
  return shell({
    title: "Search — Karaite Korner",
    description: "Search the Karaite Korner archive.",
    body,
    rel: "search.html",
    ignore: true,
  });
}

async function writeSearchIndex(pages) {
  const entries = [];
  for (const page of pages) {
    const html = await readFile(path.join(DIST, page.rel), "utf8");
    if (html.includes('data-pagefind-ignore="all"')) continue;
    const $ = load(html);
    $("main").find("p, div, li, h1, h2, h3, h4, tr, br, dd, dt, blockquote, center").each((_, el) => {
      $(el).prepend(" ");
    });
    const text = $("main").text().replace(/\s+/g, " ").trim();
    if (text.length < 40) continue;
    entries.push({
      title: (page.title || page.rel).replace(/\s+/g, " ").trim(),
      url: page.rel,
      text: text.slice(0, 80000),
    });
  }
  const json = JSON.stringify(entries);
  await writeFile(path.join(DIST, "search-index.json"), json);
  console.log(`Search index: ${entries.length} pages, ${json.length} bytes`);
}

function renderRedirect(rel, target) {
  const safe = escapeHtml(target);
  const body = `<h1>This page has moved</h1>
<p>The article that used to live here is now published elsewhere.</p>
<p><a href="${safe}">Continue to ${safe}</a></p>`;
  return shell({
    title: "This page has moved — Karaite Korner",
    description: `This page now lives at ${target}`,
    body,
    rel,
    ignore: true,
    extraHead: `<meta http-equiv="refresh" content="0; url=${safe}">\n<link rel="canonical" href="${safe}">`,
  });
}

async function main() {
  const redirects = JSON.parse(await readFile(path.join(ROOT, "content", "redirects.json"), "utf8"));
  const outline = JSON.parse(await readFile(path.join(ROOT, "src", "outline.json"), "utf8"));
  const files = await walk(RAW);
  const pages = [];

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  for (const rel of files) {
    if (redirects[`/${rel}`]) continue;
    if (rel === "robots.txt") continue;
    if (HTML_EXT.test(rel)) {
      if (rel === "index.html" || rel === "index.shtml" || SKIP_PAGES.has(rel)) continue;
      const html = await readHtml(rel);
      const prefix = prefixFor(rel);
      const transformed = transformBody(html, prefix);
      const dir = dominantDir(`${transformed.title}\n${transformed.body}`);
      const title = transformed.title || "Karaite Korner";
      const page = isEmbedded(rel)
        ? barePage({ title, body: transformed.body || "", styles: transformed.styles })
        : shell({
            title,
            description: transformed.description,
            body: transformed.body || "<p></p>",
            rel,
            dir,
            wide: transformed.wide,
            extraHead: (transformed.styles || []).join("\n"),
          });
      await writePage(rel, page);
      pages.push({ rel, title });
      continue;
    }
    const dest = path.join(DIST, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(path.join(RAW, rel), dest);
  }

  const home = renderHome(outline, redirects);
  await writePage("index.html", home);
  await writePage("index.shtml", home.replace("<body>", '<body data-pagefind-ignore="all">'));
  pages.push({ rel: "index.html", title: "Karaite Korner" });

  await writePage("archive.html", renderArchive(pages, files));
  await writePage("search.html", renderSearch());
  await writeSearchIndex(pages);
  await copyFile(path.join(ROOT, "src", "search.js"), path.join(DIST, "search.js"));

  for (const [urlPath, target] of Object.entries(redirects)) {
    const rel = urlPath.replace(/^\/+/, "");
    const httpsTarget = target.replace(/^http:\/\//i, "https://");
    await writePage(rel, renderRedirect(rel, httpsTarget));
  }

  await mkdir(path.join(DIST, "assets"), { recursive: true });
  await copyFile(path.join(ROOT, "src", "site.css"), path.join(DIST, "assets", "site.css"));
  await writeFile(path.join(DIST, ".nojekyll"), "");
  await writeFile(path.join(DIST, "CNAME"), "www.karaite-korner.org\n");
  await writeFile(path.join(DIST, "robots.txt"), "User-agent: *\nAllow: /\n");
  console.log(`Built ${pages.length} articles and ${Object.keys(redirects).length} redirects`);
}

await main();
