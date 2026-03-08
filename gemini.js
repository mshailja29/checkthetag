import { GoogleGenerativeAI } from "@google/generative-ai";

const EXTRACT_PROMPT =
  'From this input (image, video, audio, or text), identify grocery items and their prices. Output ONLY a JSON array of objects: [{"item": "string", "brand": "string", "price": number, "weight": "string"}]. If you cannot find any items, return [].';

function getApiKey() {
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing EXPO_PUBLIC_GEMINI_API_KEY. Add it to your Expo env and restart the dev server."
    );
  }
  return apiKey;
}

function stripToJsonArray(text) {
  if (typeof text !== "string") throw new Error("AI response was not text");
  let t = text.trim();
  t = t.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return [];
  }
}

function coerceAiItems(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = [];
  for (const entry of raw) {
    const item = typeof entry?.item === "string" ? entry.item.trim() : "";
    const brand = typeof entry?.brand === "string" ? entry.brand.trim() : "";
    const weight = typeof entry?.weight === "string" ? entry.weight.trim() : "";
    const price = Number(entry?.price);
    if (!item || !Number.isFinite(price)) continue;
    cleaned.push({ item, brand, price, weight });
  }
  return cleaned;
}

/**
 * Build Gemini parts from multimodal input.
 * Each part: { type: 'text', value } | { type: 'image'|'video'|'audio', base64, mimeType }
 */
export async function extractPricesFromInput(parts, storeName) {
  const apiKey = getApiKey();
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const geminiParts = [{ text: EXTRACT_PROMPT }];
  for (const p of parts) {
    if (p.type === "text" && p.value?.trim()) {
      geminiParts.push({ text: p.value.trim() });
    } else if (
      (p.type === "image" || p.type === "video" || p.type === "audio") &&
      p.base64
    ) {
      geminiParts.push({
        inlineData: {
          mimeType: p.mimeType || (p.type === "image" ? "image/jpeg" : p.type === "video" ? "video/mp4" : "audio/mpeg"),
          data: p.base64,
        },
      });
    }
  }

  const result = await model.generateContent([
    { role: "user", parts: geminiParts },
  ]);
  const text = result?.response?.text?.() ?? "";
  const rawJson = stripToJsonArray(text);
  return coerceAiItems(rawJson);
}

/**
 * Ask AI a question about the given price data (e.g. cheaper items, stores, brand).
 * dbRows: array of { item, brand, price, weight, storeName }
 */
export async function queryPricesWithAi(question, dbRows) {
  const apiKey = getApiKey();
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const dataJson = JSON.stringify(dbRows, null, 0);
  const prompt = `You are a helpful assistant. The user has a local database of grocery prices. Here is the data (JSON array of objects with item, brand, price, weight, storeName):

${dataJson}

User request: ${question}

Answer concisely and helpfully. If the data is empty, say so. Format lists clearly (e.g. item, price, store).`;

  const result = await model.generateContent([{ role: "user", parts: [{ text: prompt }] }]);
  return result?.response?.text?.() ?? "No response.";
}
