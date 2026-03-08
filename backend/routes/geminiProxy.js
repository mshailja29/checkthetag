const express = require("express");
const { VertexAI } = require("@google-cloud/vertexai");

const firestore = require("../services/firestore");


const router = express.Router();

const PROJECT_ID = process.env.GCP_PROJECT_ID || "gcloud-hackathon-vi0ysib4ateve";
const REGION = process.env.GCP_REGION || "us-central1";
const MODEL = "gemini-2.5-flash";

const vertexAI = new VertexAI({ project: PROJECT_ID, location: REGION });

/* --- Helper functions --- */
const EXTRACT_PROMPT =
    'From this input (image, video, audio, or text), identify grocery items and their prices. If the input is a VIDEO, analyze the ENTIRE video - watch all frames from start to end and extract items shown at any point. Do NOT use only a single frame. Output ONLY a JSON array of objects: [{"item": "string", "brand": "string", "price": number, "weight": "string"}]. If you cannot find any items, return [].';

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

const REALTIME_SYSTEM_PROMPT = `You are a helpful shopping assistant. The user will show you an image or video of a product and ask a question (via voice or text). If it is a video, analyze the ENTIRE video, not just a single frame.

You can:
1. Answer general questions: alternatives, healthier options, what the product is, ingredients, etc.
2. Answer price questions: "Is there a nearby store where this is cheaper?" Use ONLY the database JSON provided. If the database is empty or has no entry for this item, say so and suggest they add prices from the app.

Rules:
- Reply in short, natural spoken language (1-3 sentences). No bullet points, no markdown. Imagine you are speaking to the user.
- If database is provided and the user asks about cheaper prices or nearby stores, base your answer only on that data. Name the store and price when relevant.
- If the user did not ask about prices, ignore the database and answer from the image and general knowledge.`;

function buildRealtimePrompt(dbRows = []) {
    if (!Array.isArray(dbRows) || dbRows.length === 0) {
        return `${REALTIME_SYSTEM_PROMPT}\n\nNo price database was provided for this request, so answer only from the uploaded media and general knowledge.`;
    }
    return `${REALTIME_SYSTEM_PROMPT}\n\nDatabase of known prices for this or similar items (use only if user asks about price or cheaper store):\n${JSON.stringify(dbRows)}`;
}

function extractResponseText(responseLike) {
    const parts = responseLike?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return "";
    return parts.map((part) => part?.text || "").join("");
}

function buildVertexParts(parts) {
    const vertexParts = [];
    for (const p of parts) {
        if (p.type === "text" && p.value?.trim()) {
            vertexParts.push({ text: p.value.trim() });
        } else if ((p.type === "image" || p.type === "video" || p.type === "audio") && p.base64) {
            const mimeType = p.mimeType || (p.type === "image" ? "image/jpeg" : p.type === "video" ? "video/mp4" : "audio/mpeg");
            const sizeKB = Math.round(p.base64.length / 1024);
            console.log(`[buildVertexParts] type=${p.type} mimeType=${mimeType} size=${sizeKB}KB`);
            vertexParts.push({
                inlineData: {
                    mimeType,
                    data: p.base64,
                },
            });
        }
    }
    return vertexParts;
}

/* --- API ENDPOINTS --- */

// POST /api/gemini/extract-prices
router.post("/extract-prices", async (req, res) => {
    try {
        const { parts, storeName, userId, storeId, latitude, longitude, saveToCloud } = req.body;
        if (!Array.isArray(parts)) return res.status(400).json({ error: "parts must be an array" });

        const model = vertexAI.getGenerativeModel({ model: MODEL });
        const geminiParts = [{ text: EXTRACT_PROMPT }, ...buildVertexParts(parts)];

        const result = await model.generateContent({
            contents: [{ role: "user", parts: geminiParts }],
            generationConfig: { temperature: 0.1 },
        });

        const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const rawJson = stripToJsonArray(text);
        const cleaned = coerceAiItems(rawJson);

        // Save to Firestore if requested
        let savedCount = 0;
        if (saveToCloud && cleaned.length > 0) {
            try {
                let storeLatitude = null, storeLongitude = null;
                let resolvedStoreId = storeId || "";
                if (resolvedStoreId) {
                    const store = await firestore.getStore(resolvedStoreId);
                    if (store) { storeLatitude = store.latitude; storeLongitude = store.longitude; }
                }
                const priceIds = await firestore.saveExtractedItems({
                    items: cleaned,
                    storeName: storeName || "Unknown Store",
                    storeId: resolvedStoreId,
                    storeLatitude,
                    storeLongitude,
                    userId: userId || "anonymous",
                    scanSource: "manual",
                });
                savedCount = priceIds.length;
                console.log(`[extract-prices] Saved ${savedCount} prices to Firestore`);
            } catch (saveErr) {
                console.warn("[extract-prices] Firestore save failed:", saveErr.message);
            }
        }

        res.json({ success: true, data: cleaned, savedToCloud: savedCount });
    } catch (err) {
        console.error("[extract-prices]", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/gemini/query-prices
router.post("/query-prices", async (req, res) => {
    try {
        const { question, dbRows } = req.body;

        const dataJson = JSON.stringify(dbRows || [], null, 0);
        const prompt = `You are a helpful assistant. The user has a local database of grocery prices. Here is the data (JSON array of objects with item, brand, price, weight, storeName):

${dataJson}

User request: ${question}

Answer concisely and helpfully. If the data is empty, say so. Format lists clearly (e.g. item, price, store).`;

        const model = vertexAI.getGenerativeModel({ model: MODEL });
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "No response.";
        res.json({ success: true, answer: text });
    } catch (err) {
        console.error("[query-prices]", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/gemini/realtime-ask
router.post("/realtime-ask", async (req, res) => {
    try {
        const { parts, dbRows, latitude, longitude, radius } = req.body;
        if (!Array.isArray(parts)) return res.status(400).json({ error: "parts must be an array" });

        // Combine local dbRows with Firestore data if location is provided
        let allPriceData = dbRows || [];

        if (latitude && longitude) {
            try {
                // First extract items from the video/image to know what to search for
                const extractModel = vertexAI.getGenerativeModel({ model: MODEL });
                const extractParts = [{ text: EXTRACT_PROMPT }, ...buildVertexParts(parts)];
                const extractResult = await extractModel.generateContent({
                    contents: [{ role: "user", parts: extractParts }],
                    generationConfig: { temperature: 0.1 },
                });
                const extractText = extractResult?.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                const extractedItems = coerceAiItems(stripToJsonArray(extractText));

                // Search Firestore for each extracted item nearby
                for (const item of extractedItems) {
                    const nearbyPrices = await firestore.findPricesNearby(
                        item.item, latitude, longitude, radius || 3
                    );
                    for (const np of nearbyPrices) {
                        allPriceData.push({
                            item: np.displayProductName || np.productName,
                            brand: np.brand || "",
                            price: np.price,
                            weight: np.weight || "",
                            storeName: np.storeName || "",
                            distance: np.distance ? `${np.distance} mi` : "",
                        });
                    }
                }
                console.log(`[realtime-ask] Found ${allPriceData.length} price entries (${(dbRows || []).length} local + ${allPriceData.length - (dbRows || []).length} Firestore)`);
            } catch (fsErr) {
                console.warn("[realtime-ask] Firestore lookup failed, using local data only:", fsErr.message);
            }
        }

        const prompt = allPriceData.length > 0
            ? `${REALTIME_SYSTEM_PROMPT}\n\nDatabase of known prices for this or similar items (use only if user asks about price or cheaper store):\n${JSON.stringify(allPriceData)}`
            : buildRealtimePrompt([]);

        const geminiParts = [{ text: prompt }, ...buildVertexParts(parts)];
        const model = vertexAI.getGenerativeModel({ model: MODEL });

        const result = await model.generateContent({
            contents: [{ role: "user", parts: geminiParts }],
        });

        let text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        text = text.trim() || "I couldn't generate an answer. Try again.";

        res.json({ success: true, answer: text });
    } catch (err) {
        console.error("[realtime-ask]", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/gemini/realtime-ask-stream
router.post("/realtime-ask-stream", async (req, res) => {
    try {
        const { parts, dbRows } = req.body;
        if (!Array.isArray(parts)) return res.status(400).json({ error: "parts must be an array" });

        const prompt = buildRealtimePrompt(dbRows);
        const geminiParts = [{ text: prompt }, ...buildVertexParts(parts)];
        const model = vertexAI.getGenerativeModel({ model: MODEL });

        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");

        const streamingResult = await model.generateContentStream({
            contents: [{ role: "user", parts: geminiParts }],
        });

        let sentAnyText = false;

        for await (const chunk of streamingResult.stream) {
            const text = extractResponseText(chunk);
            if (!text) continue;
            sentAnyText = true;
            res.write(`${JSON.stringify({ text })}\n`);
        }

        if (!sentAnyText) {
            const aggregated = await streamingResult.response;
            const text = extractResponseText(aggregated).trim() || "I couldn't generate an answer. Try again.";
            res.write(`${JSON.stringify({ text })}\n`);
        }

        res.write(`${JSON.stringify({ done: true })}\n`);
        res.end();
    } catch (err) {
        console.error("[realtime-ask-stream]", err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.write(`${JSON.stringify({ error: err.message || "Realtime stream failed" })}\n`);
        res.end();
    }
});

module.exports = router;
