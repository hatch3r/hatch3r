---
id: hatch3r-cli-zstd
description: "Fast lossless compression with high ratio. Use when high-ratio compression with single-digit-millisecond decompress speeds; invoke `zstd`. Designed for cold-storage payloads and CI artifact upload/download steps."
tags: ["cli-tools", "archive", "core"]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
cli_tool:
  id: zstd
  bin: zstd
  tier: 1
  category: archive
  homepage: https://github.com/facebook/zstd
---
<!-- HATCH3R-CLI-SKILL-GENERATED v1 -->
# zstd

Fast lossless compression with high ratio

## When to Use

Reach for `zstd` when the task is in the **archive** category and the agent would otherwise call an MCP tool or read large outputs into context.

## Token Cost

CLI tools return structured stdout that fits in <1KB for typical queries; equivalent MCP calls regularly exceed 10KB.
Reference: Anthropic engineering (Nov 4 2025) — code-execution-over-MCP yields 98.7% token reduction.

## Recipes

```bash
tar --zstd -cf bundle.tar.zst dist/ governance/
```
Stream `tar` through zstd in one shot — default level (~3) gives high-ratio archives an order of magnitude faster than gzip.

```bash
tar --zstd -xf bundle.tar.zst -C /tmp/restore/
```
Extract a zstd-compressed tarball to a target directory — paired with the previous recipe for round-trip backup.

```bash
zstd -19 -T0 huge.csv
```
Level 19 (near-max ratio) with `-T0` (all CPU threads) — appropriate for archival snapshots where compression time is fine.

```bash
pzstd --keep -d findings.tar.zst
```
Parallel decompression preserving the input (`--keep`) — fastest restore path for large `.zst` archives on multi-core hosts.

```bash
zstd --train datasets/*.json -o dict.zstd && zstd -D dict.zstd payload.json
```
Train a dictionary from a sample corpus then compress with `-D dict.zstd` — wins when payloads share schema (logs, structured events).

## Wrong Choice When

- Don't use `zstd` for distribution where every byte of size matters and decompression speed does not. Reach for `xz` (`xz -9e`) — slower but tighter ratios for immutable releases.
- Don't ship a zstd archive to legacy Windows recipients without a bundled decoder; native support landed in Windows 11 but earlier hosts need 7-Zip 21.07+. Reach for `zip` for broadest compatibility.
- Don't reach for `zstd` to compress already-compressed payloads (JPEGs, MP4s, existing zips); ratios approach 1.0 and the CPU spend is wasted. Skip compression or use `tar -cf` with no codec.

## Alternatives

| Tool | When to prefer |
|------|----------------|
| `xz` | Immutable release artifacts where size is the dominant cost. |
| `gzip` | Universal compatibility — every UNIX-like system since 1992. |
| `zip` | Windows recipients without native `.zst` support; flat distribution archives. |
| `7z` | Heterogeneous payloads where xz-style LZMA2 plus per-file streaming beats both zstd and gzip. |

## Detection / Install

Verify with:
```bash
command -v zstd
```

Install (mac):

```bash
# brew
brew install zstd
```

Homepage: https://github.com/facebook/zstd
