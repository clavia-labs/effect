# Publish Clavia AI packages

The `clavia/ai-providers` branch publishes four packages from this fork. Upstream `effect` remains a pinned peer dependency.

| Directory                   | npm package                | Initial version         |
| --------------------------- | -------------------------- | ----------------------- |
| `packages/ai/clavia`        | `@clavia/ai`               | `0.0.1`                 |
| `packages/ai/openai`        | `@clavia/ai-openai`        | `4.0.0-rc.110-clavia.0` |
| `packages/ai/anthropic`     | `@clavia/ai-anthropic`     | `4.0.0-rc.110-clavia.0` |
| `packages/ai/openai-compat` | `@clavia/ai-openai-compat` | `4.0.0-rc.110-clavia.0` |

## Check packages

The **Clavia packages** workflow runs on pushes and pull requests to `clavia/ai-providers`. It checks types, lint, and provider tests. It builds four packages and packs them with pnpm. A fresh npm consumer installs those archives with the published Effect runtime, checks declarations, and runs the shared provider tests. The workflow uploads the checked archives as `clavia-packages`.

Run the same package checks locally after building:

```sh
node scripts/clavia-release.mjs pack
node scripts/clavia-release.mjs check
```

`pack` checks package names, exports, repository metadata, and dependency references. `check` installs into a temporary directory without workspace aliases or dependency patches.

## First publication

npm requires a package to exist before its trusted publisher can be configured. Authenticate with an npm account that can publish under `@clavia`. Use the checked archives for the first publication, in this order:

```sh
npm login
npm publish artifacts/clavia/clavia-ai-0.0.1.tgz --access public --tag next --provenance=false
npm publish artifacts/clavia/clavia-ai-openai-4.0.0-rc.110-clavia.0.tgz --access public --tag next --provenance=false
npm publish artifacts/clavia/clavia-ai-anthropic-4.0.0-rc.110-clavia.0.tgz --access public --tag next --provenance=false
npm publish artifacts/clavia/clavia-ai-openai-compat-4.0.0-rc.110-clavia.0.tgz --access public --tag next --provenance=false
```

Local bootstrap publication has no GitHub provenance. Subsequent CI publications use OIDC authentication and provenance.

## Configure npm trust

Use npm 11.15 or later with an authenticated account. Each package needs this trust relationship:

- Repository: `clavia-labs/effect`
- Workflow filename: `clavia-publish.yml`
- Environment: `npm`
- Permission: direct publication

```sh
npm trust github @clavia/ai --repo clavia-labs/effect --file clavia-publish.yml --env npm --allow-publish
npm trust github @clavia/ai-openai --repo clavia-labs/effect --file clavia-publish.yml --env npm --allow-publish
npm trust github @clavia/ai-anthropic --repo clavia-labs/effect --file clavia-publish.yml --env npm --allow-publish
npm trust github @clavia/ai-openai-compat --repo clavia-labs/effect --file clavia-publish.yml --env npm --allow-publish
```

npm can require an interactive two-factor check. The workflow needs no npm token secret. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

## Release a version

1. Update each changed package version in its manifest. Increment the provider suffix, such as `rc.110-clavia.0` to `rc.110-clavia.1`. Update the wrapper version when its code changes.
2. Push the reviewed changes to `clavia/ai-providers`.
3. Open **Actions → Clavia packages → Run workflow** on that branch.
4. Select `publish` and the npm tag. The default tag is `next`.

The publish job runs after all checks pass. It publishes the checked archives in dependency order. An existing version is skipped only when its registry integrity matches the archive. A version with different contents fails the job.

The fork uses this workflow for its four packages. Upstream release automation retains its upstream repository guard.
