import { strict as assert } from "node:assert"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { gunzipSync } from "node:zlib"
import { cpSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const destination = join(root, "artifacts/clavia")
const providers = ["clavia", "openai", "anthropic", "openai-compat", "openrouter", "bedrock"].map((directory) => {
  const path = join(root, "packages/ai", directory)
  const manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8"))
  const name = directory === "clavia" ? "@tardie/ai" : `@tardie/ai-${directory}`
  assert.equal(manifest.name, name)
  return { path, manifest, file: join(destination, `${name.slice(1).replace("/", "-")}-${manifest.version}.tgz`) }
})
const effectVersion = providers[0].manifest.peerDependencies.effect
const targets = providers
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: "inherit" })
const action = process.argv[2]
assert.ok(["pack", "check", "verify", "publish"].includes(action), "Expected pack, check, verify, or publish")

if (action === "pack") {
  mkdirSync(destination, { recursive: true })
  for (const target of providers) run("pnpm", ["pack", "--pack-destination", destination], target.path)
}

for (const target of targets) {
  const manifest = JSON.parse(execFileSync("tar", ["-xOf", target.file, "package/package.json"], { encoding: "utf8" }))
  assert.equal(manifest.name, target.manifest.name)
  assert.equal(manifest.version, target.manifest.version)
  assert.equal(manifest.peerDependencies.effect, effectVersion)
  assert.equal(manifest.repository.url, "https://github.com/clavia-labs/effect.git")
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    assert.ok(!name.startsWith("@effect/ai-"), `Unexpected upstream provider dependency: ${name}`)
    assert.ok(!/^(workspace:|link:|file:)/.test(version), `Unresolved dependency: ${name}`)
  }
  for (const [name, path] of Object.entries(manifest.exports)) {
    if (name !== "./package.json" && path !== null) assert.ok(path.startsWith("./dist/"), `Source export: ${name}`)
  }
}

if (action === "check") {
  const consumer = realpathSync(mkdtempSync(join(tmpdir(), "tardie-ai-consumer-")))
  writeFileSync(join(consumer, "package.json"), JSON.stringify({
    name: "clavia-package-check", private: true, type: "module",
    dependencies: { effect: effectVersion }
  }))
  for (const target of targets) cpSync(target.file, join(consumer, basename(target.file)))
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...providers.map((target) => `./${basename(target.file)}`), `@effect/vitest@${effectVersion}`, "vitest@5.0.0", "typescript@7.0.2", "@types/node@24"], consumer)
  const installedRuntime = JSON.parse(readFileSync(join(consumer, "node_modules/effect/package.json"), "utf8"))
  assert.equal(installedRuntime.name, "effect")
  assert.equal(installedRuntime.version, effectVersion)
  cpSync(join(root, "packages/ai/clavia/test"), join(consumer, "test"), { recursive: true })
  cpSync(join(root, "packages/ai/bedrock/test"), join(consumer, "test/bedrock"), { recursive: true })
  const entrypoints = Object.entries(installedRuntime.exports)
    .filter(([key, value]) => value !== null && key !== "./package.json" && !key.includes("*"))
    .map(([key]) => key === "." ? "effect" : `effect/${key.slice(2)}`)
  writeFileSync(join(consumer, "test/runtime.ts"), entrypoints.map((name, index) => `export * as runtime${index} from "${name}"`).join("\n"))
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", strict: true, exactOptionalPropertyTypes: true, skipLibCheck: false, allowImportingTsExtensions: true, noEmit: true, types: ["node"] }, include: ["test/**/*.ts"] }))
  run("npm", ["exec", "--no", "--", "tsc", "-p", "tsconfig.json"], consumer)
  run("npm", ["exec", "--no", "--", "vitest", "run", "test/LanguageModel.test.ts", "test/ProviderStreams.test.ts", "test/bedrock/BedrockLanguageModel.test.ts"], consumer)
  run("npm", ["ls", "effect"], consumer)
  console.log(`Packed consumer checked at ${consumer}`)
}

if (action === "publish" || action === "verify") {
  const tag = process.argv[3] ?? "next"
  assert.ok(["next", "latest"].includes(tag), "Expected next or latest npm tag")
  for (const target of targets) {
    const spec = `${target.manifest.name}@${target.manifest.version}`
    const existing = spawnSync("npm", ["view", spec, "dist.integrity", "--json"], { encoding: "utf8" })
    if (existing.status === 0) {
      const integrity = `sha512-${createHash("sha512").update(readFileSync(target.file)).digest("base64")}`
      if (JSON.parse(existing.stdout) !== integrity) {
        const url = JSON.parse(execFileSync("npm", ["view", spec, "dist.tarball", "--json"], { encoding: "utf8" }))
        const response = await fetch(url)
        assert.ok(response.ok, `Could not download ${spec}: ${response.status}`)
        const published = Buffer.from(await response.arrayBuffer())
        assert.equal(`sha512-${createHash("sha512").update(published).digest("base64")}`, JSON.parse(existing.stdout), `${spec} registry checksum mismatch`)
        assert.deepEqual(gunzipSync(readFileSync(target.file)), gunzipSync(published), `${spec} already exists with different package contents`)
      }
      console.log(`${spec} already published with matching contents`)
      continue
    }
    assert.notEqual(action, "verify", `${spec} is not available in the registry`)
    assert.ok(existing.stderr.includes("E404"), existing.stderr || "npm lookup failed")
    run("npm", ["publish", target.file, "--access", "public", "--tag", tag, "--provenance"])
  }
}
