import { signState, verifyState } from "./state.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}: expected ${b}, got ${a}`);
}

async function assertRejects(fn: () => Promise<unknown>, message: string) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(message);
}

Deno.test("signState/verifyState roundtrip", async () => {
  const payload = {
    user_id: "11111111-1111-1111-1111-111111111111",
    account_label: "Privat",
    platform: "web" as const,
    nonce: crypto.randomUUID(),
    exp: Date.now() + 60_000,
  };
  const state = await signState(payload, "test-secret");
  const verified = await verifyState(state, "test-secret");
  assertEquals(verified, payload, "roundtrip payload mismatch");
});

Deno.test("verifyState rejects tampered payload", async () => {
  const payload = {
    user_id: "11111111-1111-1111-1111-111111111111",
    account_label: "Privat",
    platform: "web" as const,
    nonce: crypto.randomUUID(),
    exp: Date.now() + 60_000,
  };
  const state = await signState(payload, "test-secret");
  const [payloadB64, sigB64] = state.split(".");
  const tampered = `${payloadB64}x.${sigB64}`;
  await assertRejects(() => verifyState(tampered, "test-secret"), "tampered state should be rejected");
});

Deno.test("verifyState rejects wrong secret", async () => {
  const payload = {
    user_id: "11111111-1111-1111-1111-111111111111",
    account_label: "Privat",
    platform: "native" as const,
    nonce: crypto.randomUUID(),
    exp: Date.now() + 60_000,
  };
  const state = await signState(payload, "secret-a");
  await assertRejects(() => verifyState(state, "secret-b"), "wrong secret should be rejected");
});

Deno.test("verifyState rejects expired state", async () => {
  const payload = {
    user_id: "11111111-1111-1111-1111-111111111111",
    account_label: "Privat",
    platform: "native" as const,
    nonce: crypto.randomUUID(),
    exp: Date.now() - 1_000,
  };
  const state = await signState(payload, "test-secret");
  await assertRejects(() => verifyState(state, "test-secret"), "expired state should be rejected");
});

Deno.test("verifyState rejects malformed state", async () => {
  await assertRejects(() => verifyState("not-a-real-state", "test-secret"), "malformed state should be rejected");
});
