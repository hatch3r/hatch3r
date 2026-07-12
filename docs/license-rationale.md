# License Rationale

> Why hatch3r ships under MIT, and what that means for downstream users.

## Summary

hatch3r is licensed under the [MIT License](https://opensource.org/license/mit) (full text at [`/LICENSE`](../LICENSE)). The MIT license is OSI-approved and is the most permissive of the widely-used open-source licenses: it grants free use, modification, distribution, sublicensing, and sale of the software, subject only to retention of the copyright notice and the standard disclaimer of warranty.

This document records the rationale behind that choice and the project's stance on monetization.

## Why MIT, not a copyleft or source-available license

Three reasons drive the MIT choice:

1. **The governance pattern is the asset, not the code.** hatch3r's differentiator is the 24-domain audit cycle, the 8 Binding Pillars (see the [governance overview](https://docs.hatch3r.com/docs/about)), the closed-loop self-evolution model, and the canonical-source / adapter-output separation. The TypeScript implementation under `src/` is replaceable; the governance corpus and the canonical content under `agents/`, `skills/`, `rules/`, `commands/`, and `hooks/` is what makes the framework valuable. Permissive licensing on the implementation maximizes the surface area on which that governance pattern can be observed, copied, and refined by others.

2. **Adoption flywheel beats license-extraction revenue.** The framework's quality bar is one-shot success rate of agent-generated code (see the [Vision overview](https://docs.hatch3r.com/docs/about) §Quality Bar). That metric improves with usage: more projects exercising the canonical content under more conditions surfaces more findings, which feed audit cycles, which raise the quality bar further. A copyleft or source-available license would suppress downstream usage in proprietary products, which would suppress the feedback signal. MIT removes that friction.

3. **Compatibility with downstream marketplaces.** hatch3r is targeted at the Claude Plugins marketplace, the Cursor extension ecosystem, and direct `npx` install. The Anthropic Claude Plugins marketplace and Cursor's plugin model both expect permissive (MIT / Apache-2.0 / BSD) licensing for plugins distributed through them. MIT is the lowest-friction choice across these channels (see [`docs/marketplace-submission.md`](./marketplace-submission.md)).

## What MIT permits downstream

Per the MIT license text, anyone receiving hatch3r may, without paying a fee or seeking permission:

- Use hatch3r in commercial products, including proprietary closed-source products
- Modify the canonical content (`agents/`, `skills/`, `rules/`, `commands/`, `hooks/`) and ship the modifications
- Re-license modifications under different terms (including proprietary terms) for redistribution
- Sell hatch3r or derivative works
- Embed hatch3r in services offered for a fee

The only conditions: retain the copyright notice and the standard MIT warranty disclaimer in copies or substantial portions. Attribution is required; royalty payments are not.

### Worked example: proprietary product embedding hatch3r

A vendor builds a closed-source IDE plugin that bundles hatch3r's canonical content (the 29 agents, 53 skills, 67 rules, 30 commands, and 7 hooks tracked in [`governance/inventory.json`](../governance/inventory.json) as of 2026-07-06). The vendor sells the plugin commercially. Under MIT, this is permitted with the following obligations:

1. Bundle a copy of [`/LICENSE`](../LICENSE) (or its substantive text) in the distributed product, in a location where users can find it — typically a `Third-Party Notices` view in the application, a `LICENSE` or `NOTICE` file in the distribution archive, or a section in the product's about page.
2. Retain the copyright line: `Copyright (c) 2026 hatch3r contributors`.

The vendor does not need to: open-source their plugin, contribute changes upstream, pay a royalty, request permission, or notify the hatch3r maintainers.

This permissiveness is deliberate. The framework's value compounds with adoption breadth (see [`docs/sustainability.md`](./sustainability.md) §Structural defenses against abandonment), and license friction reduces breadth.

## Anti-monetization signal

hatch3r is not monetized today and has no roadmap toward monetization. Specifically:

- **No enterprise tier.** There is no closed-source enterprise edition, no paid feature gate, and no plan to introduce one.
- **No closed-source upsell.** Every artifact the framework ships — the canonical agents, skills, rules, commands, and hooks bundled in the npm package — is part of the open repository.
- **No proprietary cloud service.** The CLI generates configuration locally; there is no hosted service collecting telemetry or gating capabilities behind authentication. Per the project's [CLI scope stance](https://docs.hatch3r.com/docs/about), "the CLI is NOT a runtime. It generates configuration; it does not execute agents."
- **No dual-license trick.** hatch3r is not offered under MIT with a parallel commercial license that includes additional rights. The MIT license is the only license; everyone gets identical terms.

The maintainer's intent is captured in the [Vision overview](https://docs.hatch3r.com/docs/about) §Distribution: "hatch3r is open-source. The focus is on building the ideal framework first. Distribution channels (npm, marketplace plugins, private registries) are secondary concerns that follow from getting the framework right."

For maintenance economics (how the project stays sustainable without monetization), see [`docs/sustainability.md`](./sustainability.md).

## Attribution requirements for downstream users

If you redistribute hatch3r or a substantial portion of it (canonical content, adapters, or pipeline modules), MIT requires retaining:

1. The copyright notice from [`/LICENSE`](../LICENSE): `Copyright (c) 2026 hatch3r contributors`
2. The MIT permission notice and warranty disclaimer

There is no requirement to credit hatch3r in user-facing UI, marketing materials, or product names. Attribution belongs in `LICENSE`, `NOTICE`, or `THIRD-PARTY-NOTICES` files, per the convention most permissive-license projects follow.

If you derive a fork that diverges from upstream hatch3r, please do not call the fork `hatch3r` to avoid user confusion. The name is not trademarked, but identical names harm downstream users trying to distinguish the canonical project from forks.

## License changes

Contributions are received under MIT on the inbound=outbound model. The DCO (Developer Certificate of Origin) sign-off enforced on every commit certifies the *origin* of each contribution and the contributor's right to submit it under the project's existing MIT license — DCO 1.1 clauses (a)-(c), [developercertificate.org](https://developercertificate.org/). The DCO is a certification of provenance, **not** a relicensing-consent instrument: it neither collects nor implies consent to change the license. (This is the defining contrast between the DCO and a CLA — a CLA can pre-collect relicensing rights; the DCO does not. See [`CONTRIBUTING.md`](../CONTRIBUTING.md) §Developer Certificate of Origin.)

A future license change would therefore rely on MIT's own permissive grant — MIT lets a recipient sublicense and redistribute under other terms as long as the copyright notice and warranty disclaimer are retained — plus fresh grants from contributors for any right MIT does not itself convey (for example, an express patent grant; see [Patent posture](#patent-posture)). No license change has ever been proposed and none is planned. If a proposal ever arises, it routes through the `/h4tcher-evolve` governance-evolution engine and requires explicit owner consent; the DCO plays no consenting role in that decision.

## Patent posture

The MIT license is **silent on patents**: it grants copyright permissions (use, modify, distribute, sublicense, sell) but conveys no express patent license from contributors and carries no patent-retaliation clause. Apache-2.0 — the most common permissive alternative — differs on exactly this axis: its §3 grants each downstream user an express, perpetual patent license from every contributor and terminates that grant for any party who initiates patent litigation over the work ([Apache-2.0 patent provisions vs MIT, Mend](https://www.mend.io/blog/top-10-apache-license-questions-answered/), accessed 2026-07-12).

This axis is material to hatch3r specifically because its canonical content is designed for downstream embedding and redistribution — the worked example under [What MIT permits downstream](#what-mit-permits-downstream) is a vendor bundling that content into a commercial product. Express-patent-grant-versus-silence is the distinction an adopting vendor's counsel weighs when redistributed work might implicate contributor-held patents. For a configuration generator that ships prompt and specification text plus TypeScript scaffolding rather than a novel patentable algorithm, the practical patent-exposure surface is low — but the record states the posture rather than leaving it implicit.

**Current posture:** MIT (patent silence), accepted as the default. **Pending disposition (Owner: Human):** formally ratify one of — (a) deliberately accept MIT's patent silence on the low-exposure rationale above, or (b) assess migration to Apache-2.0 for its express patent grant. This is tracked as a Strategic Decision Register item and closes the queued "MIT-vs-Apache licensing record" candidate; the disposition lands through the governance decision ceremony, not by this document asserting the outcome.

## References

- [OSI MIT License canonical text](https://opensource.org/license/mit)
- [`/LICENSE`](../LICENSE) — the MIT license as applied to this repository
- [Vision overview](https://docs.hatch3r.com/docs/about) §Distribution — vision-level distribution stance
- [`docs/sustainability.md`](./sustainability.md) — how the project stays maintainable without monetization
- [`docs/marketplace-submission.md`](./marketplace-submission.md) — marketplace-listing implications of MIT
- [Developer Certificate of Origin 1.1](https://developercertificate.org/) — certifies contribution origin under the existing license; not a relicensing-consent instrument
- [Apache License 2.0 §3](https://www.apache.org/licenses/LICENSE-2.0) — the express patent grant that MIT omits, referenced in *Patent posture*
