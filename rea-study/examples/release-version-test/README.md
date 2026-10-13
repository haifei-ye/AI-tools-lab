# REA release version test record

This directory records the isolated comparison between the official npm release
`rea-agents@6.4.0` and the current REA source checkout.

## Fixed input

- Target: `node-fetch`
- Commit: `8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f`
- Target path used during the test:
  `../first-real-analysis/target/node-fetch`
- Node.js: `v24.18.0`
- npm: `11.16.0`

The release and source runs reported the same subject digest, inventory manifest,
and inventory graph digest, confirming that both runs examined the same target
files.

## Command

```powershell
npx -y rea-agents@6.4.0 analyze-javascript-application `
  "D:\AI-tools-lab\rea-study\examples\first-real-analysis\target\node-fetch" `
  --json
```

The npm cache was redirected to this directory's ignored `.npm-cache/` folder.

## Result

| Metric | Result |
| --- | ---: |
| Exit code | 0 |
| Parsed JavaScript files | 25 |
| Visited AST nodes | 32,516 |
| Semantic nodes | 21,713 |
| Semantic relations | 22,970 |
| Semantic unknowns | 8,062 |
| Parse failures | 0 |

The full analysis and comparison are documented in
[`../../notes/09-release-vs-source.md`](../../notes/09-release-vs-source.md).

## Excluded local artifacts

The following are intentionally ignored and must not be committed:

- `.npm-cache/`
- `node_modules/`
- `raw-output/`
- `target/`

The ignored raw JSON was validated before exclusion:

| Local file | Bytes | SHA-256 |
| --- | ---: | --- |
| `raw-output/release-6.4.0-analysis.json` | 39,465,121 | `7bd9ce53bf82d6b3a2e44c32186c2e0733364e3214d822ee75fc38aeb13a3760` |
| `raw-output/release-6.4.0-analysis.stderr.log` | 6,348 | `b7cd18856c201e69efc6c90ca22e38617e5b555202e04d386085de466bbc84f4` |
