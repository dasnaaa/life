// Läuft ausschliesslich innerhalb von Supabase Edge Functions (Deno-Runtime).
// GEMINI_API_KEY wird nie an den Client (Expo App) ausgeliefert.
import { GoogleGenerativeAI } from "npm:@google/generative-ai@^0.24.1";

const genAI = new GoogleGenerativeAI(Deno.env.get("GEMINI_API_KEY") ?? "");

export const geminiFlash = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
export const geminiPro = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

const RATE_LIMIT_RETRY_DELAY_MS = 60_000;

async function callGeminiWithRetry<T>(prompt: string, transform: (text: string) => T, fallback: T): Promise<T> {
  try {
    const result = await geminiFlash.generateContent(prompt);
    return transform(result.response.text());
  } catch (error) {
    if (isRateLimitError(error)) {
      console.warn("Gemini rate limit hit, retrying once in 60s:", error);
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS));
      try {
        const retryResult = await geminiFlash.generateContent(prompt);
        return transform(retryResult.response.text());
      } catch (retryError) {
        console.error("Gemini API error after retry, using fallback:", retryError);
        return fallback;
      }
    }
    console.error("Gemini API error, using fallback:", error);
    return fallback;
  }
}

export async function summarize(prompt: string, fallback: string): Promise<string> {
  return callGeminiWithRetry(prompt, (text) => text, fallback);
}

// Fuer Prompts, die strukturiertes JSON zurueckgeben sollen (Kurs-Erkennung,
// Brief-Generierung, ...). Bei Rate-Limit ODER nicht-parsebarer Antwort wird
// der Fallback verwendet - nie eine Exception nach aussen geben.
export async function generateJson<T>(prompt: string, fallback: T): Promise<T> {
  const jsonPrompt = `${prompt}\n\nAntworte AUSSCHLIESSLICH mit validem JSON, ohne Markdown-Codeblock, ohne zusaetzlichen Text.`;
  return callGeminiWithRetry(jsonPrompt, (text) => parseJsonResponse(text, fallback), fallback);
}

function parseJsonResponse<T>(text: string, fallback: T): T {
  try {
    const cleaned = text
      .trim()
      .replace(/^```(json)?/i, "")
      .replace(/```$/, "")
      .trim();
    return JSON.parse(cleaned) as T;
  } catch (error) {
    console.error("Gemini JSON-Antwort konnte nicht geparst werden, nutze Fallback:", error, text);
    return fallback;
  }
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("429");
}
