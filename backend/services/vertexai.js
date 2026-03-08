const { VertexAI } = require("@google-cloud/vertexai");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "gcloud-hackathon-me2chuk6yxck5";
const REGION = process.env.GCP_REGION || "us-central1";
const MODEL = "gemini-2.5-flash";

const vertexAI = new VertexAI({ project: PROJECT_ID, location: REGION });

const RECEIPT_PROMPT = `You are a precise receipt/bill parser. Analyze the uploaded receipt, bill, or video and extract ALL details into structured JSON. If the input is a video, watch the ENTIRE video and extract items from all frames shown (e.g. user may pan across a shelf or receipt).

Return ONLY a valid JSON object with this exact structure:
{
  "storeName": "string — store/restaurant/business name from the receipt",
  "storeAddress": "string — full address if visible, or empty string",
  "date": "string — purchase date in YYYY-MM-DD format if visible, or empty string",
  "items": [
    {
      "name": "string — item name exactly as printed",
      "brand": "string — brand if identifiable, or empty string",
      "price": number,
      "quantity": number,
      "weight": "string — weight/size if shown (e.g. '16 oz', '1 lb'), or empty string",
      "category": "string — one of: Produce, Dairy, Meat, Bakery, Beverages, Snacks, Frozen, Household, Personal Care, Other"
    }
  ],
  "subtotal": number or null,
  "tax": number or null,
  "total": number or null,
  "paymentMethod": "string — e.g. 'Visa ending 1234', 'Cash', or empty string"
}

Rules:
- Extract EVERY line item. Do not skip any.
- If an item has a quantity > 1, set quantity accordingly and set price as the unit price.
- If you cannot determine a field, use empty string for strings, null for numbers.
- Do NOT wrap the JSON in markdown code fences.
- Return ONLY the JSON object, nothing else.`;

/**
 * Extract structured receipt data from an image using Vertex AI Gemini.
 * @param {string} base64Image - Base64-encoded image data
 * @param {string} mimeType - Image MIME type (e.g., "image/jpeg")
 * @returns {Promise<Object>} Parsed receipt data
 */
async function extractReceiptFromImage(base64Image, mimeType) {
    const model = vertexAI.getGenerativeModel({ model: MODEL });

    const request = {
        contents: [
            {
                role: "user",
                parts: [
                    { text: RECEIPT_PROMPT },
                    {
                        inlineData: {
                            mimeType: mimeType || "image/jpeg",
                            data: base64Image,
                        },
                    },
                ],
            },
        ],
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
        },
    };

    const result = await model.generateContent(request);
    const response = result.response;
    const text =
        response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    return parseReceiptJson(text);
}

/**
 * Parse the AI response text into a structured receipt object.
 */
function parseReceiptJson(text) {
    let cleaned = text.trim();
    // Strip markdown code fences if present
    cleaned = cleaned.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();

    // Find the JSON object
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
        throw new Error("Could not parse receipt data from AI response");
    }

    const parsed = JSON.parse(cleaned.slice(start, end + 1));

    // Validate and clean the structure
    return {
        storeName: typeof parsed.storeName === "string" ? parsed.storeName.trim() : "",
        storeAddress: typeof parsed.storeAddress === "string" ? parsed.storeAddress.trim() : "",
        date: typeof parsed.date === "string" ? parsed.date.trim() : "",
        items: Array.isArray(parsed.items)
            ? parsed.items
                .map((item) => ({
                    name: typeof item.name === "string" ? item.name.trim() : "",
                    brand: typeof item.brand === "string" ? item.brand.trim() : "",
                    price: typeof item.price === "number" && isFinite(item.price) ? item.price : 0,
                    quantity: typeof item.quantity === "number" && isFinite(item.quantity) ? item.quantity : 1,
                    weight: typeof item.weight === "string" ? item.weight.trim() : "",
                    category: typeof item.category === "string" ? item.category.trim() : "Other",
                }))
                .filter((item) => item.name.length > 0)
            : [],
        subtotal: typeof parsed.subtotal === "number" ? parsed.subtotal : null,
        tax: typeof parsed.tax === "number" ? parsed.tax : null,
        total: typeof parsed.total === "number" ? parsed.total : null,
        paymentMethod: typeof parsed.paymentMethod === "string" ? parsed.paymentMethod.trim() : "",
    };
}

module.exports = { extractReceiptFromImage };
