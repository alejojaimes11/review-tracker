// Run: deno test supabase/functions/_shared/ (from a directory without a package.json, or with --no-check)
import { generateToken, hashToken, TOKEN_PATTERN } from './client-auth.ts'

function assert(cond: boolean, msg = 'assertion failed') {
  if (!cond) throw new Error(msg)
}
function assertEquals<T>(actual: T, expected: T, msg = '') {
  if (actual !== expected) throw new Error(`${msg} expected ${String(expected)}, got ${String(actual)}`)
}

Deno.test('generateToken: 43 chars of base64url (256 bits), never repeats', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 200; i++) {
    const token = generateToken()
    assertEquals(token.length, 43, 'length')
    assert(TOKEN_PATTERN.test(token), 'pattern')
    seen.add(token)
  }
  assertEquals(seen.size, 200, 'unique')
})

Deno.test('hashToken: SHA-256 hex, deterministic, differs per token, is not the token', async () => {
  const token = generateToken()
  const hash = await hashToken(token)
  assert(/^[0-9a-f]{64}$/.test(hash), 'hex shape')
  assertEquals(hash, await hashToken(token), 'deterministic')
  assert(hash !== (await hashToken(generateToken())), 'differs per token')
  assert(!hash.includes(token), 'hash does not contain the token')
})

Deno.test('hashToken: known SHA-256 vector', async () => {
  assertEquals(await hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'vector')
})

Deno.test('TOKEN_PATTERN rejects malformed tokens', () => {
  for (const bad of ['', 'short', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(42) + '=', 'a'.repeat(42) + '/', ' ' + 'a'.repeat(42)]) {
    assert(!TOKEN_PATTERN.test(bad), `rejects "${bad}"`)
  }
})
