// Läuft ausschliesslich innerhalb von Supabase Edge Functions (Deno-Runtime).
// GEMINI_API_KEY wird nie an den Client (Expo App) ausgeliefert.
import { GoogleGenerativeAI } from "npm:@google/generative-ai@^0.24.1";

const genAI = new GoogleGenerativeAI(Deno.env.get("GEMINI_API_KEY") ?? "");

export const geminiFlash = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
export const geminiPro = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

const RATE_LIMIT_RETRY_DELAY_MS = 60_000;

export async function summarize(prompt: string, fallback: string): Promise<string> {
  try {
    const result = await geminiFlash.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    if (isRateLimitError(error)) {
      console.warn("Gemini rate limit hit, retrying once in 60s:", error);
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS));
      try {
        const retryResult = await geminiFlash.generateContent(prompt);
        return retryResult.response.text();
      } catch (retryError) {
        console.error("Gemini API error after retry, using fallback:", retryError);
        return fallback;
      }
    }
    console.error("Gemini API error, using fallback:", error);
    return fallback;
  }
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("429");
}
