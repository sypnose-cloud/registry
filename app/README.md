# Sypnose Registry — desktop app

Tauri 2 + React + TypeScript + Sigma.js. This is the **desktop app** half of the
[Sypnose Registry](../README.md) repo: open any folder → interactive knowledge graph,
live watcher, time-travel history, and chat with your own Anthropic key.

**For end-users:** don't build from source — install the signed MSIX or the plain
installer from the [Release](../README.md#-desktop-app-windows). The root README has the
full install + usage guide for the three features.

## Develop

```bash
npm install
npm run tauri dev      # hot-reload dev build
```

## Build a release + MSIX

The reproducible MSIX build (bump the version in one place, build, pack, sign, export
`.cer`, print SHA256) is scripted:

```bash
# bumps flow from MSIX_VERSION (default 2.0.0) into the artifact name
bash scripts/build-msix.sh
```

Signing reads the certificate password from `D:\CERTIFICADO\pass.txt` or the `CERT_PASS`
env var — **never hardcode it**. The canonical MSIX manifest is
`src-tauri/msix-staging/AppxManifest.xml` (this is the one that ships; it declares
`internetClient`, required by the chat + AI Bridge).

Version lives in four places, keep them in sync:
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json`,
`src-tauri/msix-staging/AppxManifest.xml`.
