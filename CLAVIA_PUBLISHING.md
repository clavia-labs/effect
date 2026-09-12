# Publish Tardie AI packages

The `clavia/ai-providers` branch publishes four provider packages. Each package requires upstream `effect@4.0.0-rc.115`. The release workflow does not publish an Effect runtime.

| Directory                   | npm package                | Version                 |
| --------------------------- | -------------------------- | ----------------------- |
| `packages/ai/clavia`        | `@tardie/ai`               | `0.0.2`                 |
| `packages/ai/openai`        | `@tardie/ai-openai`        | `4.0.0-rc.113-clavia.1` |
| `packages/ai/anthropic`     | `@tardie/ai-anthropic`     | `4.0.0-rc.113-clavia.1` |
| `packages/ai/openai-compat` | `@tardie/ai-openai-compat` | `4.0.0-rc.113-clavia.1` |

## Install packages

```sh
npm install effect@4.0.0-rc.115 @tardie/ai-openai@4.0.0-rc.113-clavia.1
npm ls effect
```

The dependency tree must resolve to one Effect runtime. Upstream rc.114 includes the declaration fix in [#8162](https://github.com/Effect-TS/effect/pull/8162). The supported rc.115 runtime includes that fix.

## Check packages

The **Clavia packages** workflow checks types, lint, and provider tests. It builds the workspace dependencies and packs the four provider packages. A fresh npm consumer installs the archives with upstream Effect and checks declarations with `skipLibCheck: false`. It also runs shared provider tests and checks the dependency tree.

```sh
node scripts/clavia-release.mjs pack
node scripts/clavia-release.mjs check
```

`pack` checks package names, exports, repository metadata, and dependency references. `check` installs into a temporary directory without workspace aliases or dependency patches.

## Publish

1. Update each changed package version and its Effect peer dependency.
2. Push the checked changes to `clavia/ai-providers`.
3. Run **Clavia packages** on that branch with `publish` enabled. The default npm tag is `next`.

The publish job uses npm trusted publishing with GitHub provenance. Each package trusts repository `clavia-labs/effect`, workflow `clavia-publish.yml`, and environment `npm`. No npm token secret is required.

The job publishes the checked archives in dependency order. An existing version is skipped only when its registry integrity matches the archive. A version with different contents fails the job.
