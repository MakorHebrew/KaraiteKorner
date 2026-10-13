# Karaite Korner

Static remake of [karaite-korner.org](https://www.karaite-korner.org/). The articles, translations, reports, and files are kept, including sections that are no longer linked on the live site. Addresses that the live site sends to another website still do that.

The published site is plain HTML, CSS, and images. GitHub Pages can host it without a server.

## Build

```bash
npm ci
npm run build
```

`npm run build` reads `content/raw`, writes the site to `dist/`, and writes `search-index.json`. Search loads that file in the browser and looks up the query there. Open `dist/index.html` in a browser, or serve the folder:

```bash
npx --yes serve dist
```

To refresh the saved pages from the live site and the Internet Archive:

```bash
npm run fetch
```

Live files win. A live external redirect is recorded in `content/redirects.json` and is not replaced with an older copy. Missing files are filled from the archive.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` publishes `dist/` on every push to `main`. In the repository settings, set Pages to **GitHub Actions**.

Until the domain is pointed here, the site is served at `https://makorhebrew.github.io/KariteKorner/`. Links are relative, so the same files also work at the real domain.

## Custom domain

`CNAME` is `www.karaite-korner.org`. After Pages is enabled, set these records at the domain registrar, then wait for GitHub to issue a certificate:

- `www` as a CNAME to `makorhebrew.github.io`
- the bare domain as A records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`

GitHub Pages cannot send a real HTTP 301. Each old address that used to redirect is a page that forwards immediately and links to the same destination.
