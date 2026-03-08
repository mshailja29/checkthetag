import {
  extractPricesFromInputApi,
  queryPricesWithAiApi,
  askRealtimeWithImageAndVoiceApi,
  askRealtimeWithImageAndVoiceStreamApi,
} from "./apiClient";

/**
 * Extract prices from multimodal input (legacy scan logic) using Backend
 */
export async function extractPricesFromInput(parts, storeName) {
  try {
    return await extractPricesFromInputApi(parts, storeName);
  } catch (error) {
    console.warn("Backend extract API failed:", error);
    throw error;
  }
}

/**
 * Ask AI a question about price data using Backend
 */
export async function queryPricesWithAi(question, dbRows) {
  try {
    return await queryPricesWithAiApi(question, dbRows);
  } catch (error) {
    console.warn("Backend query API failed:", error);
    return "No response.";
  }
}

/**
 * Realtime Q&A using Backend — with location for tool-based search
 */
export async function askRealtimeWithImageAndVoice(parts, dbRows = [], { latitude, longitude, radius } = {}) {
  try {
    return await askRealtimeWithImageAndVoiceApi(parts, dbRows, { latitude, longitude, radius });
  } catch (error) {
    console.warn("Backend realtime API failed:", error);
    return "I couldn't generate an answer. Try again.";
  }
}

export async function askRealtimeWithImageAndVoiceStream(parts, onChunk, dbRows = [], { latitude, longitude } = {}) {
  try {
    return await askRealtimeWithImageAndVoiceStreamApi(parts, onChunk, dbRows, { latitude, longitude });
  } catch (error) {
    console.warn("Backend realtime stream API failed:", error);
    return "I couldn't generate an answer. Try again.";
  }
}
