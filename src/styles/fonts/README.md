# Self-hosted fonts

`ibm-plex.ts` loads IBM Plex Sans and IBM Plex Mono from the files in this
folder with `next/font/local`; `app/layout.tsx` imports it.

## Why not `next/font/google`

`next/font/google` downloads the stylesheet and font files from Google Fonts
on every build and every dev-server compile. Google decides per request which
URLs to return, and sometimes returns extensionless
`https://fonts.gstatic.com/l/font?kit=…&skey=…&v=…` URLs. Turbopack in Next
16.3.x/16.4.x reads the font options back as a query string and splits them
at those `&`s, so the compile fails with:

```
Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
next/font/google queries have exactly one entry
```

and the page renders a Build Error overlay instead of the app. That made
`tests/e2e/outage.spec.ts` fail at random in CI, and could fail
`next build`. Fixed upstream in vercel/next.js#100158 (16.5 canary only, at
the time of writing). Files in the repo also mean builds never need the
network for fonts.

## The files

The exact files Google Fonts served for the request `next/font/google` made
(css2 API, Chrome user agent), byte-identical to what the app used before:

| Folder | Google version | Request |
|--------|----------------|---------|
| `ibm-plex-sans/<subset>.woff2` | `ibmplexsans/v23` | `family=IBM+Plex+Sans:wght@400;500;600;700&display=swap` |
| `ibm-plex-mono/<weight>-<subset>.woff2` | `ibmplexmono/v20` | `family=IBM+Plex+Mono:wght@400;500;600&display=swap` |

The Sans files are variable fonts (one file per subset covers all four
weights); Mono has one file per weight and subset. Subsets: `latin`,
`latin-ext`, `cyrillic`, `cyrillic-ext`, `vietnamese`, and `greek` (Sans only,
which Mono does not have).

To change weights or update the fonts, fetch the stylesheet with the same
user agent next/font used, download each `src: url(…)` into the matching file
name, and copy each rule's `unicode-range` into `ibm-plex.ts`:

```bash
curl -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
```

## License

IBM Plex is © 2017 IBM Corp., licensed under the SIL Open Font License 1.1
(`OFL.txt`, as published with the fonts in google/fonts). The files are
redistributed unmodified.
