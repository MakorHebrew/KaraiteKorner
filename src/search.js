const input = document.querySelector("#search-query");
const status = document.querySelector("#search-status");
const list = document.querySelector("#search-results");

let index = [];

function escapeHtml(value) {
  return value.replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  }[character]));
}

function termsIn(query) {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length >= 2);
}

function highlight(text, terms) {
  const lower = text.toLowerCase();
  const spans = [];
  for (const term of terms) {
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(term, from);
      if (at === -1) break;
      spans.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (!last || span[0] > last[1]) merged.push([...span]);
    else last[1] = Math.max(last[1], span[1]);
  }
  let html = "";
  let cursor = 0;
  for (const [start, end] of merged) {
    html += `${escapeHtml(text.slice(cursor, start))}<mark>${escapeHtml(text.slice(start, end))}</mark>`;
    cursor = end;
  }
  return html + escapeHtml(text.slice(cursor));
}

function snippet(text, terms) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) return text.slice(0, 220);
  const start = Math.max(0, at - 80);
  const end = Math.min(text.length, at + 160);
  let slice = text.slice(start, end).trim();
  if (start > 0) slice = `…${slice}`;
  if (end < text.length) slice = `${slice}…`;
  return slice;
}

function render(query) {
  const terms = termsIn(query);
  if (!terms.length) {
    status.textContent = query.trim() ? "Type at least two letters." : "Search the archive.";
    list.replaceChildren();
    return;
  }

  const hits = [];
  for (const page of index) {
    const title = page.title.toLowerCase();
    const body = page.text.toLowerCase();
    let score = 0;
    let matched = true;
    for (const term of terms) {
      const inTitle = title.includes(term);
      const inBody = body.includes(term);
      if (!inTitle && !inBody) {
        matched = false;
        break;
      }
      if (inTitle) score += 8;
      let count = 0;
      let from = 0;
      while (count < 10) {
        const found = body.indexOf(term, from);
        if (found === -1) break;
        count += 1;
        from = found + term.length;
      }
      score += count;
    }
    if (matched) hits.push({ page, score });
  }

  hits.sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title));
  const shown = hits.slice(0, 40);
  const countLabel = hits.length === 1 ? "1 page" : `${hits.length} pages`;
  status.textContent = hits.length ? countLabel : "No pages contain those words.";
  list.innerHTML = shown
    .map(({ page }) => {
      const excerpt = snippet(page.text, terms);
      return `<li><a href="${escapeHtml(page.url)}">${highlight(page.title, terms)}</a><p class="snippet">${highlight(excerpt, terms)}</p></li>`;
    })
    .join("");
}

function remember(query) {
  const url = new URL(location.href);
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  history.replaceState(null, "", url);
}

status.textContent = "Loading the index…";
fetch("search-index.json")
  .then((response) => {
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  })
  .then((pages) => {
    index = pages;
    const query = new URLSearchParams(location.search).get("q") || "";
    input.value = query;
    render(query);
  })
  .catch(() => {
    status.textContent = "The search index could not be loaded.";
  });

input.addEventListener("input", () => {
  remember(input.value);
  render(input.value);
});

document.querySelector(".page-search").addEventListener("submit", (event) => {
  event.preventDefault();
  remember(input.value);
  render(input.value);
});
