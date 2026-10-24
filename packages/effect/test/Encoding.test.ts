import { assert, describe, it } from "@effect/vitest"
import { Encoding } from "effect"

const assertRandomHex = (length: number, expectedLength: number): void => {
  const value = Encoding.randomHex(length)
  assert.strictEqual(value.length, expectedLength)
  assert.match(value, /^[0-9a-f]*$/)
}

describe("Encoding", () => {
  describe("base64 native encoding", () => {
    it("preserves byte views, padding, and UTF-8", () => {
      const bytes = Uint8Array.from({ length: 8196 }, (_, index) => index % 256)
      for (const length of [0, 1, 2, 3, 31, 32, 33, 127, 128, 129, 8192, 8193]) {
        const input = bytes.subarray(1, length + 1)
        assert.strictEqual(Encoding.encodeBase64(input), Buffer.from(input).toString("base64"))
        assert.strictEqual(Encoding.encodeBase64Url(input), Buffer.from(input).toString("base64url"))
      }
      assert.strictEqual(Encoding.encodeBase64("한글 café"), Buffer.from("한글 café").toString("base64"))
    })

    it("retains the buffered fallback when the native encoder is unavailable", () => {
      const prototype = Uint8Array.prototype
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "toBase64")
      Object.defineProperty(prototype, "toBase64", { value: undefined, configurable: true })
      try {
        for (const length of [0, 1, 2, 31, 32, 127, 128, 129, 4096, 4097, 4098]) {
          const input = Uint8Array.from({ length }, (_, index) => index % 256)
          assert.strictEqual(Encoding.encodeBase64(input), Buffer.from(input).toString("base64"))
        }
      } finally {
        if (descriptor) Object.defineProperty(prototype, "toBase64", descriptor)
        else Reflect.deleteProperty(prototype, "toBase64")
      }
    })

    it("ignores instance overrides and preserves detached empty-buffer behavior", () => {
      const bytes = new Uint8Array(128).fill(255)
      Object.assign(bytes, {
        toBase64: () => {
          throw new Error("Instance overrides must not run")
        }
      })
      assert.strictEqual(Encoding.encodeBase64(bytes), Buffer.from(bytes).toString("base64"))
      const detached = new Uint8Array(128)
      structuredClone(detached.buffer, { transfer: [detached.buffer] })
      assert.strictEqual(Encoding.encodeBase64(detached), "")
    })
  })

  describe("randomHex", () => {
    it("generates lowercase hexadecimal words", () => {
      assertRandomHex(0, 0)
      assertRandomHex(8, 8)
      assertRandomHex(16, 16)
      assertRandomHex(32, 32)
    })

    it("rounds non-negative lengths down to multiples of 8", () => {
      assertRandomHex(7, 0)
      assertRandomHex(15.9, 8)
      assertRandomHex(23, 16)
    })

    it("uses unsigned 32-bit coercion without validation", () => {
      assertRandomHex(Number.NaN, 0)
      assertRandomHex(Number.POSITIVE_INFINITY, 0)
      assertRandomHex(2 ** 32, 0)
      assertRandomHex(2 ** 32 + 8, 8)
    })
  })
})
