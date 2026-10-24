import * as Encoding from "effect/Encoding"
import * as Stream from "effect/Stream"
import type * as Prompt from "effect/unstable/ai/Prompt"
import * as HttpBody from "effect/unstable/http/HttpBody"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"

/**
 * DEFAULT_REQUEST_BODY_CHUNK_BYTES limits input bytes per encoded request chunk.
 *
 * @category configuration
 * @since 4.0.0
 */
export const DEFAULT_REQUEST_BODY_CHUNK_BYTES = 48 * 1024

const Source = Symbol.for("@tardie/ai-openai/RequestFileStream")
const Metadata = Symbol.for("@tardie/ai-openai/RequestBody")

interface FileSource {
  readonly key: string
  readonly file: Prompt.FileStream
}

interface BodyMetadata {
  readonly json: unknown
  readonly chunkBytes: number
}

/** @internal */
export const attachFileStream = <T extends object>(value: T, key: keyof T & string, file: Prompt.FileStream): T =>
  Object.assign(value, { [Source]: { key, file } satisfies FileSource })

/** @internal */
export const copyFileStream = (from: object, to: object): void => {
  if (Source in from) Object.assign(to, { [Source]: from[Source] })
}

const encodeFile = (file: Prompt.FileStream, chunkBytes: number): Stream.Stream<string, Error> =>
  Stream.suspend(() => {
    let remainder = new Uint8Array(0)
    const chunks = file.stream.pipe(
      Stream.flatMap((bytes) =>
        Stream.fromIterable((function*() {
          for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
            yield bytes.subarray(offset, offset + chunkBytes)
          }
        })())
      ),
      Stream.rechunk(1),
      Stream.map((bytes) => {
        let input = bytes
        if (remainder.length) {
          input = new Uint8Array(remainder.length + bytes.length)
          input.set(remainder)
          input.set(bytes, remainder.length)
        }
        const length = input.length - input.length % 3
        remainder = input.slice(length)
        return Encoding.encodeBase64(input.subarray(0, length))
      })
    )
    return Stream.concat(chunks, Stream.suspend(() => Stream.succeed(Encoding.encodeBase64(remainder))))
  })

const encoder = new TextEncoder()
type JsonPart = string | Stream.Stream<string, Error>

const serializable = (value: unknown): boolean =>
  value !== undefined && typeof value !== "function" && typeof value !== "symbol"

const normalizeJson = (value: unknown, ancestors: Set<object>, key = ""): unknown => {
  if (value !== null && typeof value === "object" && "toJSON" in value && typeof value.toJSON === "function") {
    value = value.toJSON(key)
  }
  if (!serializable(value)) return undefined
  if (typeof value === "bigint") throw new TypeError("Cannot serialize a BigInt request value")
  if (typeof value === "number" && !Number.isFinite(value)) return null
  if (value === null || typeof value !== "object") return value
  if (ancestors.has(value)) throw new TypeError("Cannot serialize a circular request body")
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return Array.from(value, (child, index) => normalizeJson(child, ancestors, String(index)) ?? null)
    }
    const normalized = Object.fromEntries(
      Object.entries(value).flatMap(([field, child]) => {
        const result = normalizeJson(child, ancestors, field)
        return result === undefined ? [] : [[field, result]]
      })
    )
    copyFileStream(value, normalized)
    return normalized
  } finally {
    ancestors.delete(value)
  }
}

function* jsonParts(value: unknown, chunkBytes: number, ancestors: Set<object>, key = ""): Generator<JsonPart> {
  if (value !== null && typeof value === "object" && "toJSON" in value && typeof value.toJSON === "function") {
    value = value.toJSON(key)
  }
  if (value === null || typeof value !== "object") {
    yield JSON.stringify(value) ?? "null"
    return
  }
  if (ancestors.has(value)) throw new TypeError("Cannot serialize a circular request body")
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      yield "["
      for (let index = 0; index < value.length; index++) {
        if (index) yield ","
        yield* jsonParts(value[index], chunkBytes, ancestors, String(index))
      }
      yield "]"
      return
    }
    const attachment = Source in value ? value[Source] as FileSource : undefined
    yield "{"
    let first = true
    for (const [field, child] of Object.entries(value)) {
      if (!serializable(child)) continue
      if (!first) yield ","
      first = false
      yield `${JSON.stringify(field)}:`
      if (attachment?.key === field) {
        if (typeof child !== "string") throw new TypeError("Streamed file content requires a string prefix")
        yield JSON.stringify(child).slice(0, -1)
        yield encodeFile(attachment.file, chunkBytes)
        yield "\""
      } else {
        yield* jsonParts(child, chunkBytes, ancestors, field)
      }
    }
    yield "}"
  } finally {
    ancestors.delete(value)
  }
}

/** @internal */
export const streamedRequestBody = (json: unknown, chunkBytes: number): HttpBody.Stream => {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) {
    throw new RangeError("requestBodyChunkBytes must be a positive safe integer")
  }
  const normalized = normalizeJson(json, new Set())
  const stream = Stream.suspend(() =>
    Stream.fromIterable(jsonParts(normalized, chunkBytes, new Set())).pipe(
      Stream.flatMap((part) => typeof part === "string" ? Stream.succeed(part) : part),
      Stream.map((part) => encoder.encode(part))
    )
  )
  return Object.assign(HttpBody.stream(stream, "application/json"), {
    [Metadata]: { json: normalized, chunkBytes } satisfies BodyMetadata
  })
}

/**
 * getRequestBody reads structured Responses request metadata without consuming streamed file bytes.
 *
 * @category request bodies
 * @since 4.0.0
 */
export const getRequestBody = (request: HttpClientRequest.HttpClientRequest): unknown | undefined => {
  const body = request.body
  if (Metadata in body) return (body[Metadata] as BodyMetadata).json
  if (body._tag !== "Uint8Array" || !body.contentType.includes("json")) return undefined
  try {
    return JSON.parse(new TextDecoder().decode(body.body))
  } catch {
    return undefined
  }
}

/**
 * setRequestBody rebuilds JSON metadata and preserves cold file sources on streamed requests.
 * Object spreads preserve file-source symbols; JSON serialization discards them.
 *
 * @category request bodies
 * @since 4.0.0
 */
export const setRequestBody = (
  request: HttpClientRequest.HttpClientRequest,
  json: unknown
): HttpClientRequest.HttpClientRequest => {
  const body = request.body
  return Metadata in body
    ? HttpClientRequest.setBody(request, streamedRequestBody(json, (body[Metadata] as BodyMetadata).chunkBytes))
    : HttpClientRequest.bodyJsonUnsafe(request, json)
}
