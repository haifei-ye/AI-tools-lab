# REA first real analysis test record

## Scope

- Test date: 2026-10-13
- REA source commit: `4773c152bc5f299fa682575bb8d1efea7587c7bc`
- Runtime: Node.js `v24.18.0`, npm `11.16.0`
- Target: [node-fetch/node-fetch](https://github.com/node-fetch/node-fetch)
- Target commit: [`8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f`](https://github.com/node-fetch/node-fetch/tree/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f)
- Target package version: `3.1.1`
- Target license: MIT

The target clone is stored locally under `target/node-fetch/`. The clone and raw
REA output are intentionally ignored so third-party source and generated
evidence are not committed to this repository.

## Command

The command was run from `rea-study/rea` with the dedicated Node executable:

```powershell
& "D:\tools\node-v24.18.0-win-x64\node.exe" `
  "scripts/rea.mjs" `
  "analyze-javascript-application" `
  "D:\AI-tools-lab\rea-study\examples\first-real-analysis\target\node-fetch" `
  "--artifact-format" "directory" `
  "--format" "json" `
  "--full-output"
```

Stdout and stderr were saved separately:

```text
raw-output/node-fetch-analysis.json
raw-output/node-fetch-analysis.stderr.log
```

## Result

```text
REA_ANALYSIS_EXIT_CODE=1
OVERALL=PARTIAL
ERROR_CODE=capability_unavailable
ERROR_CATEGORY=unsupported_provider
```

REA produced a valid JSON error envelope containing a partial Evidence
observation. Artifact inventory succeeded, but source AST analysis did not.
The confirmed blocker was the missing source-build artifact:

```text
rea-study/rea/native/windows/build/manifest.json
```

REA documents `npm run build:windows-native` as a separate Linux + MinGW-w64
build lane. This Windows machine has neither a WSL distribution nor the
required cross-compiler, and no toolchain was installed during this test.

## Raw output integrity

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `node-fetch-analysis.json` | 495421 | `6597a2d30d7b28a4b0169295b74a3830d3fe632b6a1169689be0d6b6248f0507` |
| `node-fetch-analysis.stderr.log` | 628 | `60fa154902cb89eab178b4811575173eafcf5f5ee0ec0a2b1c51a2f6b9775806` |

The interpreted report is in
[`../../notes/07-first-real-analysis.md`](../../notes/07-first-real-analysis.md).

