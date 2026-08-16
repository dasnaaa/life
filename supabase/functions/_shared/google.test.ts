import { classifyEmail, parseFrom } from "./google.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("classifyEmail: List-Unsubscribe -> newsletter", () => {
  assertEquals(
    classifyEmail({ listUnsubscribe: "<mailto:unsub@example.com>", from: "Some Shop <shop@example.com>" }),
    "newsletter",
    "should be newsletter when List-Unsubscribe present"
  );
});

Deno.test("classifyEmail: no-reply sender without List-Unsubscribe -> automatisch", () => {
  assertEquals(
    classifyEmail({ listUnsubscribe: null, from: "GitHub <notifications@github.com>" }),
    "automatisch",
    "should be automatisch for notifications@ sender"
  );
  assertEquals(
    classifyEmail({ listUnsubscribe: null, from: "No Reply <no-reply@service.com>" }),
    "automatisch",
    "should be automatisch for no-reply sender"
  );
});

Deno.test("classifyEmail: regular sender -> persoenlich", () => {
  assertEquals(
    classifyEmail({ listUnsubscribe: null, from: "Maria Muster <maria@privat.at>" }),
    "persoenlich",
    "should be persoenlich for a normal human sender"
  );
});

Deno.test("parseFrom: name + email", () => {
  const result = parseFrom('"Maria Muster" <maria@privat.at>');
  assertEquals(result.name, "Maria Muster", "name should be extracted without quotes");
  assertEquals(result.email, "maria@privat.at", "email should be extracted");
});

Deno.test("parseFrom: bare email without display name", () => {
  const result = parseFrom("maria@privat.at");
  assertEquals(result.name, "maria@privat.at", "name falls back to email");
  assertEquals(result.email, "maria@privat.at", "email stays the same");
});
