# Publish Tardie AI packages

The `clavia/ai-providers` branch publishes six AI packages. Each package requires upstream `effect@4.0.0-rc.115`. The release workflow does not publish an Effect runtime.

| Directory                   | npm package                | Version                 |
| --------------------------- | -------------------------- | ----------------------- |
| `packages/ai/bedrock`       | `@tardie/ai-bedrock`       | `0.0.8`                 |
| `packages/ai/clavia`        | `@tardie/ai`               | `0.0.4`                 |
| `packages/ai/openai`        | `@tardie/ai-openai`        | `4.0.0-rc.113-clavia.6` |
| `packages/ai/anthropic`     | `@tardie/ai-anthropic`     | `4.0.0-rc.113-clavia.5` |
| `packages/ai/openai-compat` | `@tardie/ai-openai-compat` | `4.0.0-rc.113-clavia.6` |
| `packages/ai/openrouter`    | `@tardie/ai-openrouter`    | `4.0.0-rc.113-clavia.3` |

## Install packages

```sh
npm install effect@4.0.0-rc.115 @tardie/ai-openai@4.0.0-rc.113-clavia.6
npm ls effect
```

The dependency tree must resolve to one Effect runtime. Upstream rc.114 includes the declaration fix in [#8162](https://github.com/Effect-TS/effect/pull/8162). The supported rc.115 runtime includes that fix.

## Check packages

The **Clavia packages** workflow checks types, lint, and provider tests. It builds the workspace dependencies and packs the six AI packages. A fresh npm consumer installs the archives with upstream Effect and checks declarations with `skipLibCheck: false`. It also runs shared provider tests and checks the dependency tree.

```sh
node scripts/clavia-release.mjs pack
node scripts/clavia-release.mjs check
```

`pack` checks package names, exports, repository metadata, and dependency references. `check` installs into a temporary directory without workspace aliases or dependency patches.

## Publish

1. Update each changed package version and its Effect peer dependency.
2. Push the checked changes to `clavia/ai-providers`.
3. Run **Clavia packages** on that branch with `publish` enabled. The default npm tag is `next`.
4. Run `node scripts/clavia-release.mjs verify` to compare the archives with npm without publishing.

The publish job uses npm trusted publishing with GitHub provenance. Each package trusts repository `clavia-labs/effect`, workflow `clavia-publish.yml`, and environment `npm`. No npm token secret is required.

The job publishes the checked archives in dependency order. An existing version is skipped only when its registry checksum matches the archive or its checksum-verified, decompressed tar archive matches byte for byte. This permits gzip headers to differ across operating systems. A version with different contents fails the job.

## Bedrock first publication

`@tardie/ai-bedrock` contains the AWS SDK dependency and exposes `BedrockLanguageModel.layer` and `BedrockLanguageModel.Config`. It supports Converse streaming. `generateText` returns a typed unsupported-operation error. The provider tests also run against the packed package.

The package needs an initial authenticated npm publication before its trusted publisher can be configured. Use repository `clavia-labs/effect`, workflow `clavia-publish.yml`, and environment `npm` for subsequent releases.
