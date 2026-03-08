const express = require("express");
const { VertexAI } = require("@google-cloud/vertexai");

const firestore = require("../services/firestore");

const router = express.Router();

const PROJECT_ID = process.env.GCP_PROJECT_ID || "gcloud-hackathon-vi0ysib4ateve";
const REGION = process.env.GCP_REGION || "us-central1";
const MODEL = "gemini-2.5-flash";

const vertexAI = new VertexAI({ project: PROJECT_ID, location: REGION });

/* ═══════════════════════════════════════════
   TOOL DECLARATIONS (Firestore function calling)
   ═══════════════════════════════════════════ */

const FIRESTORE_TOOLS = [
    {
        functionDeclarations: [
            {
                name: "search_prices_nearby",
                description:
                    "Search for prices of a grocery product at stores near the user's location. Returns a list of prices with store names and distances.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        productName: {
                            type: "STRING",
                            description: "Name of the grocery product to search for (e.g. 'milk', 'eggs', 'bread')",
                        },
                        latitude: { type: "NUMBER", description: "User latitude" },
                        longitude: { type: "NUMBER", description: "User longitude" },
                        radiusMiles: {
                            type: "NUMBER",
                            description: "Search radius in miles (default 3)",
                        },
                    },
                    required: ["productName", "latitude", "longitude"],
                },
            },
            {
                name: "find_stores_nearby",
                description: "Find grocery stores near a given location. Returns store names, addresses, and distances.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        latitude: { type: "NUMBER", description: "Latitude" },
                        longitude: { type: "NUMBER", description: "Longitude" },
                        radiusMiles: {
                            type: "NUMBER",
                            description: "Search radius in miles (default 3)",
                        },
                    },
                    required: ["latitude", "longitude"],
                },
            },
            {
                name: "search_prices",
                description:
                    "Search the price database for a product by name. Returns all known prices across stores.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        searchTerm: {
                            type: "STRING",
                            description: "Product name to search (e.g. 'organic milk', 'cheerios')",
                        },
                    },
                    required: ["searchTerm"],
                },
            },
            {
                name: "compare_prices",
                description:
                    "Get all recorded prices for a specific product across every store to compare.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        productName: {
                            type: "STRING",
                            description: "Exact product name to compare prices for",
                        },
                    },
                    required: ["productName"],
                },
            },
        ],
    },
];

const GROUNDING_TOOL = { googleSearch: {} };

/* ═══════════════════════════════════════════
   EXECUTE TOOL CALLS
   ═══════════════════════════════════════════ */

async function executeToolCall(name, args) {
    console.log(`[executeToolCall] ${name}`, JSON.stringify(args));
    try {
        switch (name) {
            case "search_prices_nearby":
                return await firestore.findPricesNearby(
                    args.productName,
                    args.latitude,
                    args.longitude,
                    args.radiusMiles || 3
                );
            case "find_stores_nearby":
                return await firestore.findStoresNearby(
                    args.latitude,
                    args.longitude,
                    args.radiusMiles || 3
                );
            case "search_prices":
                return await firestore.searchPrices(args.searchTerm, 50);
            case "compare_prices":
                return await firestore.findPricesForProduct(args.productName);
            default:
                return { error: `Unknown function: ${name}` };
        }
    } catch (err) {
        console.error(`[executeToolCall] ${name} failed:`, err.message);
        return { error: err.message };
    }
}

/* ═══════════════════════════════════════════
   AGENTIC LOOP — runs function calls until text answer
   ═══════════════════════════════════════════ */

/**
 * Phase 1: Agentic loop with Firestore function calling only.
 * Returns { dbResults, conversationSoFar } — the collected tool data.
 */
async function firestoreAgenticLoop(model, initialContents) {
    const MAX_TURNS = 6;
    const contents = [...initialContents];
    const allDbResults = [];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        const result = await model.generateContent({
            contents,
            tools: FIRESTORE_TOOLS,
        });

        const candidate = result?.response?.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        const functionCalls = parts.filter((p) => p.functionCall);

        if (functionCalls.length === 0) {
            // Model decided it has enough data — return what we collected
            const text = parts.map((p) => p.text || "").join("");
            return { dbResults: allDbResults, intermediateText: text };
        }

        console.log(`[firestoreLoop] Turn ${turn + 1}: ${functionCalls.length} tool call(s)`);
        contents.push({ role: "model", parts });

        const responseParts = [];
        for (const fc of functionCalls) {
            const fnResult = await executeToolCall(fc.functionCall.name, fc.functionCall.args);
            allDbResults.push({ tool: fc.functionCall.name, args: fc.functionCall.args, result: fnResult });
            responseParts.push({
                functionResponse: {
                    name: fc.functionCall.name,
                    response: { result: JSON.stringify(fnResult) },
                },
            });
        }
        contents.push({ role: "user", parts: responseParts });
    }

    return { dbResults: allDbResults, intermediateText: "" };
}

/**
 * Phase 2: Final answer — tries Google Search grounding (text-only),
 * falls back to plain generation if grounding fails.
 */
async function groundedGenerate(model, originalPromptParts, dbResults) {
    const dbContext = dbResults.length > 0
        ? `\n\nPriceScout database results:\n${JSON.stringify(dbResults.map(r => ({ tool: r.tool, data: r.result })), null, 0)}`
        : "\n\nNo results were found in the PriceScout database.";

    // Separate text parts from media parts (grounding only works with text)
    const textParts = originalPromptParts.filter((p) => p.text);
    const mediaParts = originalPromptParts.filter((p) => p.inlineData);

    const answerInstruction = `${dbContext}\n\nNow answer the user's question using the database results above AND your knowledge of current market prices, product info, or alternatives. Be concise (1-3 sentences, spoken style).`;

    // When media is present, answer directly from the attached image/audio/video.
    // Text-only grounding would drop the actual camera or voice context.
    if (mediaParts.length > 0) {
        const allParts = [...originalPromptParts, { text: answerInstruction }];
        const result = await model.generateContent({
            contents: [{ role: "user", parts: allParts }],
        });
        const candidate = result?.response?.candidates?.[0];
        const text = (candidate?.content?.parts || []).map((p) => p.text || "").join("");
        return { text, groundingMetadata: null };
    }

    // Try grounding with text-only parts first
    try {
        const groundedTextParts = [...textParts, { text: answerInstruction }];
        const result = await model.generateContent({
            contents: [{ role: "user", parts: groundedTextParts }],
            tools: [GROUNDING_TOOL],
        });
        const candidate = result?.response?.candidates?.[0];
        const text = (candidate?.content?.parts || []).map((p) => p.text || "").join("");
        if (text.trim()) {
            console.log("[groundedGenerate] Google Search grounding succeeded");
            return { text, groundingMetadata: candidate?.groundingMetadata || null };
        }
    } catch (groundErr) {
        console.warn("[groundedGenerate] Grounding failed, falling back to plain generation:", groundErr.message);
    }

    // Fallback: plain generation with all parts (including media)
    const allParts = [...originalPromptParts, { text: answerInstruction }];
    const result = await model.generateContent({
        contents: [{ role: "user", parts: allParts }],
    });
    const candidate = result?.response?.candidates?.[0];
    const text = (candidate?.content?.parts || []).map((p) => p.text || "").join("");
    return { text, groundingMetadata: null };
}

/* ═══════════════════════════════════════════
   HELPER FUNCTIONS
   ═══════════════════════════════════════════ */

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

const REALTIME_SYSTEM_PROMPT = `You are PriceScout AI, a smart shopping assistant. The user will show you an image or video of a product and ask a question (via voice or text). If it is a video, analyze the ENTIRE video, not just a single frame.

You have access to TWO powerful data sources:
1. **PriceScout Database** — Use the search_prices_nearby, find_stores_nearby, search_prices, and compare_prices tools to look up real price data from stores in the user's area.
2. **Google Search** — You can also search the web for current market prices, product info, reviews, nutritional facts, and alternatives.

How to answer:
- For price/store questions: ALWAYS call the database tools first. If you find results, report them. Then optionally supplement with web search for context (e.g. average market price).
- For general product questions (ingredients, healthier options, reviews, recipes): Use Google Search and your knowledge.
- For "is this a good deal?": Look up database prices AND web prices, then compare.

Rules:
- Reply in short, natural spoken language (1-3 sentences). No bullet points, no markdown. Imagine you are speaking to the user.
- Name the store and price when relevant.
- If no database results are found, say so and use web search data instead. Be transparent about the source.`;

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
            const mimeType =
                p.mimeType ||
                (p.type === "image" ? "image/jpeg" : p.type === "video" ? "video/mp4" : "audio/mpeg");
            const sizeKB = Math.round(p.base64.length / 1024);
            console.log(`[buildVertexParts] type=${p.type} mimeType=${mimeType} size=${sizeKB}KB`);
            vertexParts.push({
                inlineData: { mimeType, data: p.base64 },
            });
        }
    }
    return vertexParts;
}

function splitPromptParts(parts) {
    const allParts = buildVertexParts(parts);
    return {
        allParts,
        textParts: allParts.filter((part) => part.text),
        mediaParts: allParts.filter((part) => part.inlineData),
    };
}


/* ═══════════════════════════════════════════
   API ENDPOINTS
   ═══════════════════════════════════════════ */

// POST /api/gemini/extract-prices  (no grounding/tools needed — structured extraction)
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

        let savedCount = 0;
        if (saveToCloud && cleaned.length > 0) {
            try {
                let storeLatitude = null,
                    storeLongitude = null;
                let resolvedStoreId = storeId || "";
                if (resolvedStoreId) {
                    const store = await firestore.getStore(resolvedStoreId);
                    if (store) {
                        storeLatitude = store.latitude;
                        storeLongitude = store.longitude;
                    }
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

// POST /api/gemini/query-prices  (Phase 1: Firestore tools, Phase 2: Google Search grounding)
router.post("/query-prices", async (req, res) => {
    try {
        const { question, dbRows, latitude, longitude } = req.body;

        const localData = JSON.stringify(dbRows || [], null, 0);
        const locationCtx =
            latitude && longitude
                ? `\nThe user's current location is latitude=${latitude}, longitude=${longitude}. Use this when calling location-based tools.`
                : "";

        const prompt = `You are PriceScout AI. Search the database for relevant price data to answer this question.

Local data (may be empty): ${localData}
${locationCtx}

User question: ${question}

Use your tools to find data. After gathering data, summarize what you found.`;

        const model = vertexAI.getGenerativeModel({ model: MODEL });

        // Phase 1: Firestore function calling
        const { dbResults } = await firestoreAgenticLoop(
            model,
            [{ role: "user", parts: [{ text: prompt }] }]
        );

        // Phase 2: Google Search grounded final answer
        const { text } = await groundedGenerate(
            model,
            [{ text: `User question: ${question}\nLocal data: ${localData}${locationCtx}` }],
            dbResults
        );

        res.json({ success: true, answer: text || "No response." });
    } catch (err) {
        console.error("[query-prices]", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/gemini/realtime-ask  (Phase 1: Firestore tools, Phase 2: Google Search grounding)
router.post("/realtime-ask", async (req, res) => {
    try {
        const { parts, dbRows, latitude, longitude, radius } = req.body;
        if (!Array.isArray(parts)) return res.status(400).json({ error: "parts must be an array" });

        const locationCtx =
            latitude && longitude
                ? `\nUser's current location: latitude=${latitude}, longitude=${longitude}. Use this with search_prices_nearby and find_stores_nearby.`
                : "";

        const localDataCtx =
            Array.isArray(dbRows) && dbRows.length > 0
                ? `\nLocal price data already available:\n${JSON.stringify(dbRows)}`
                : "";

        const toolPrompt = `${REALTIME_SYSTEM_PROMPT}${locationCtx}${localDataCtx}\n\nFirst, use your database tools to look up relevant price data for the product shown.`;
        const geminiParts = [{ text: toolPrompt }, ...buildVertexParts(parts)];
        const model = vertexAI.getGenerativeModel({ model: MODEL });

        // Phase 1: Firestore function calling
        const { dbResults } = await firestoreAgenticLoop(
            model,
            [{ role: "user", parts: geminiParts }]
        );
        console.log(`[realtime-ask] Phase 1 done: ${dbResults.length} tool call(s) made`);

        // Phase 2: Google Search grounded final answer (with original media)
        const groundedParts = [
            { text: `${REALTIME_SYSTEM_PROMPT}${locationCtx}${localDataCtx}` },
            ...buildVertexParts(parts),
        ];
        const { text } = await groundedGenerate(model, groundedParts, dbResults);

        const answer = (text || "").trim() || "I couldn't generate an answer. Try again.";
        res.json({ success: true, answer });
    } catch (err) {
        console.error("[realtime-ask]", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/gemini/realtime-ask-stream  (Phase 1: Firestore tools, Phase 2: stream with Google Search)
router.post("/realtime-ask-stream", async (req, res) => {
    try {
        const { parts, dbRows, latitude, longitude } = req.body;
        if (!Array.isArray(parts)) return res.status(400).json({ error: "parts must be an array" });

        const locationCtx =
            latitude && longitude
                ? `\nUser's current location: latitude=${latitude}, longitude=${longitude}. Use this with search_prices_nearby and find_stores_nearby.`
                : "";

        const localDataCtx =
            Array.isArray(dbRows) && dbRows.length > 0
                ? `\nLocal price data already available:\n${JSON.stringify(dbRows)}`
                : "";

        const model = vertexAI.getGenerativeModel({ model: MODEL });
        const { allParts: originalParts, textParts: originalTextParts, mediaParts } = splitPromptParts(parts);

        // Phase 1: Firestore function calling (non-streaming)
        const toolPrompt = `${REALTIME_SYSTEM_PROMPT}${locationCtx}${localDataCtx}\n\nFirst, use your database tools to look up relevant price data for the product shown.`;
        const toolParts = [{ text: toolPrompt }, ...originalParts];

        const { dbResults } = await firestoreAgenticLoop(
            model,
            [{ role: "user", parts: toolParts }]
        );
        console.log(`[realtime-ask-stream] Phase 1 done: ${dbResults.length} tool call(s) made`);

        // Phase 2: Stream final answer
        const dbContext = dbResults.length > 0
            ? `\n\nPriceScout database results:\n${JSON.stringify(dbResults.map(r => ({ tool: r.tool, data: r.result })), null, 0)}`
            : "\n\nNo results were found in the PriceScout database.";

        const answerInstruction = `${dbContext}\n\nNow answer the user's question using the database results above AND your knowledge of current market prices, product info, or alternatives. Be concise (1-3 sentences, spoken style).`;

        const textOnlyParts = [
            { text: `${REALTIME_SYSTEM_PROMPT}${locationCtx}${localDataCtx}` },
            ...originalTextParts,
            { text: answerInstruction },
        ];
        const allParts = [
            { text: `${REALTIME_SYSTEM_PROMPT}${locationCtx}${localDataCtx}` },
            ...originalParts,
            { text: answerInstruction },
        ];

        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");

        // If media is attached, prioritize answering from the actual image/audio/video.
        // Google Search grounding only supports text, so using it here would drop the camera/voice context.
        let streamingResult;
        if (mediaParts.length > 0) {
            streamingResult = await model.generateContentStream({
                contents: [{ role: "user", parts: allParts }],
            });
            console.log("[realtime-ask-stream] Phase 2: media-aware stream started");
        } else {
            try {
                streamingResult = await model.generateContentStream({
                    contents: [{ role: "user", parts: textOnlyParts }],
                    tools: [GROUNDING_TOOL],
                });
                console.log("[realtime-ask-stream] Phase 2: Google Search grounding stream started");
            } catch (groundErr) {
                console.warn("[realtime-ask-stream] Grounding failed, falling back:", groundErr.message);
                streamingResult = await model.generateContentStream({
                    contents: [{ role: "user", parts: allParts }],
                });
            }
        }

        let sentAnyText = false;
        for await (const chunk of streamingResult.stream) {
            const text = extractResponseText(chunk);
            if (!text) continue;
            sentAnyText = true;
            res.write(`${JSON.stringify({ text })}\n`);
        }

        if (!sentAnyText) {
            const aggregated = await streamingResult.response;
            const text =
                extractResponseText(aggregated).trim() || "I couldn't generate an answer. Try again.";
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
