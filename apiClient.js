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

export async function askRealtimeWithImageAndVoiceStreamApi(parts, onChunk, dbRows = []) {
    const res = await fetch(`${API_BASE_URL}/api/gemini/realtime-ask-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts, dbRows }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error (${res.status})`);
    }

    if (!res.body?.getReader) {
        return askRealtimeWithImageAndVoiceApi(parts, dbRows);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (!line.trim()) continue;
            const json = JSON.parse(line);
            if (json.error) throw new Error(json.error);
            if (json.text) {
                fullText += json.text;
                if (onChunk) onChunk(json.text, fullText);
            }
            if (json.done) {
                return fullText.trim() || "I couldn't generate an answer. Try again.";
            }
        }
    }

    if (buffer.trim()) {
        const json = JSON.parse(buffer);
        if (json.error) throw new Error(json.error);
        if (json.text) {
            fullText += json.text;
            if (onChunk) onChunk(json.text, fullText);
        }
    }

    return fullText.trim() || "I couldn't generate an answer. Try again.";
}
