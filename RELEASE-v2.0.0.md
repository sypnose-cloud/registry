# Release v2.0.0 — build receipt & publish checklist

Desktop app (Sypnose Registry, Tauri 2 + React + Sigma). Prepared locally, **not yet
published** — push + GitHub Release are done manually by the maintainer.

## What v2.0.0 ships

The desktop app with the three headline features, all verified present in the binary:

- **Live graph** (watcher) — re-indexes on file changes.
- **Time-travel** (SQLite snapshots + history slider).
- **Chat** with the graph (Ask Claude, user-provided Anthropic key).
- Bonus: Export digest for NotebookLM/Drive; local AI Bridge on `:44444`.

## Version bump (0.1.0 → 2.0.0)

| File | New value |
|---|---|
| `app/src-tauri/tauri.conf.json` | `"version": "2.0.0"` |
| `app/src-tauri/Cargo.toml` (+ `Cargo.lock`) | `version = "2.0.0"` |
| `app/package.json` | `"version": "2.0.0"` |
| `app/src-tauri/msix-staging/AppxManifest.xml` | `Version="2.0.0.0"` (the shipping manifest) |
| `app/msix-package/AppxManifest.xml` | `Version="2.0.0.0"` (legacy alt manifest, kept in sync) |

## Build (reproducible)

Single canonical pipeline now lives in `app/scripts/build-msix.sh` (version is
parametrized via `MSIX_VERSION`, default `2.0.0`; manifest source of truth =
`app/src-tauri/msix-staging/AppxManifest.xml`, which declares `internetClient`
required by chat + AI Bridge).

Executed locally on Windows (build tools present):

```
npx tauri build            # -> Finished release in 13m25s, exit 0
                           #    sypnose-registry.exe (v2.0.0, M1-M5)
                           #    NSIS: "Sypnose Registry_2.0.0_x64-setup.exe"
                           #    MSI:  "Sypnose Registry_2.0.0_x64_en-US.msi"
makeappx pack ...          # -> Package creation succeeded, exit 0
                           #    SypnoseRegistry_2.0.0_x64.msix (9 files)
```

### Artifact hashes (UNSIGNED — see signing note)

```
SHA256 (SypnoseRegistry_2.0.0_x64.msix, unsigned pack):
  cabbb82c140ec5bccf555006eed802f476139d1e124d9fe93a21b343daebe101

Embedded sypnose-registry.exe SHA256:
  990572856bece89d34b6af98c21cb68b7c1b84950aa1685efc26b9df3e254b23
  (matches target/release/sypnose-registry.exe — the freshly built v2.0.0 binary)
```

> The final SHA256 to publish is the one of the **signed** MSIX (signing changes the
> file). Recompute after the signing step below.

## ⚠️ Signing — REQUIRED, must run on a machine with the certificate

Signing could **not** be completed in the build environment: the certificate password
was unavailable. Real output:

```
SignTool Error: The specified PFX password is not correct.   (exit 1)
```

Because `D:\CERTIFICADO\pass.txt` is absent and `CERT_PASS` is unset. To finish the
release, run on the machine that has the cert + password:

```bash
# Option 1 — one shot: build + pack + sign + export .cer + sha256 (needs cert password)
export CERT_PASS='<the RepackagerExpress_renewed.pfx password>'   # or create D:\CERTIFICADO\pass.txt
bash app/scripts/build-msix.sh

# Option 2 — the app is already built; just sign the packed MSIX:
SIGNTOOL="C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\signtool.exe"
MSIX="app\src-tauri\target\release\bundle\msix\SypnoseRegistry_2.0.0_x64.msix"
CERT="D:\CERTIFICADO\RepackagerExpress_renewed.pfx"
& $SIGNTOOL sign /fd SHA256 /a /f $CERT /p $env:CERT_PASS $MSIX
& $SIGNTOOL verify /pa $MSIX
```

Then export the public certificate (so strangers can trust the package) and hash:

```powershell
# .cer for sideload trust
(Get-AuthenticodeSignature $MSIX).SignerCertificate |
  Export-Certificate -FilePath .\SypnoseRegistry.cer -Type CERT

# final published SHA256 (of the SIGNED file)
Get-FileHash $MSIX -Algorithm SHA256 |
  ForEach-Object { "$($_.Hash)  SypnoseRegistry_2.0.0_x64.msix" } |
  Out-File .\SypnoseRegistry_2.0.0_x64.msix.sha256 -Encoding ascii
```

`build-msix.sh` already performs the verify + `.cer` export + sha256 automatically when
the password is available.

## Publish (maintainer only — nothing here is pushed)

Local state after M6: commit + tags `v2.0` and `m6-release`, **no push**.

```bash
# 1. push the branch + tags (maintainer, after secret review)
git push origin feat/m5-export-digest
git push origin v2.0 m6-release          # or: git push origin --tags

# 2. create the GitHub Release with the SIGNED artifacts + checksums
gh release create v2.0.0 \
  --title "Sypnose Registry v2.0.0" \
  --notes "Live graph · time-travel · chat. See README for install." \
  "app/src-tauri/target/release/bundle/msix/SypnoseRegistry_2.0.0_x64.msix" \
  "app/src-tauri/target/release/bundle/msix/SypnoseRegistry.cer" \
  "app/src-tauri/target/release/bundle/msix/SypnoseRegistry_2.0.0_x64.msix.sha256" \
  "app/src-tauri/target/release/bundle/nsis/Sypnose Registry_2.0.0_x64-setup.exe"

# 3. Microsoft Store: submit SypnoseRegistry_2.0.0_x64.msix to Partner Center.
```

> A `.github/workflows/release.yml` also builds NSIS/MSI + SHA256SUMS on any `v*` tag and
> opens a **draft** Release; attach the signed MSIX + `.cer` to that draft before publishing.
> (CI can't sign the MSIX — the private cert isn't in the public repo.)
