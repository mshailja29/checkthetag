const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://192.168.1.158:8080";

async function fetchApi(endpoint, body) {
    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error (${res.status})`);
    }
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "API request failed");
    return json;
}

/**
 * Extract structured receipt data from a base64-encoded image.
 * @param {string} base64Image - Base64 image data (no data: prefix)
 * @param {string} mimeType - e.g. "image/jpeg"
 * @returns {Promise<Object>} { storeName, storeAddress, date, items, subtotal, tax, total, paymentMethod }
 */
export async function extractReceipt(base64Image, mimeType = "image/jpeg") {
    const json = await fetchApi("/api/extract-receipt", { image: base64Image, mimeType });
    return json.data;
}

/**
 * Build Gemini parts from multimodal input and extract prices (legacy scan logic).
 */
export async function extractPricesFromInputApi(parts, storeName) {
    const json = await fetchApi("/api/gemini/extract-prices", { parts, storeName });
    return json.data;
}

/**
 * Ask AI a question about the given price data.
 */
export async function queryPricesWithAiApi(question, dbRows) {
    const json = await fetchApi("/api/gemini/query-prices", { question, dbRows });
    return json.answer;
}

/**
 * Realtime Q&A: image + optional audio. Returns answer text for TTS.
 */
export async function askRealtimeWithImageAndVoiceApi(parts, dbRows = []) {
    const json = await fetchApi("/api/gemini/realtime-ask", { parts, dbRows });
    return json.answer;
}
