const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://192.168.1.158:8080";
let authToken = null;

function buildHeaders(extraHeaders = {}) {
  return {
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...extraHeaders,
  };
}

export function setAuthToken(token) {
  authToken = token || null;
}

async function parseApiResponse(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error (${res.status})`);
  }
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "API request failed");
  return json;
}

async function fetchApi(endpoint, body, options = {}) {
  const { method = "POST", headers = {} } = options;
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: buildHeaders(headers),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return parseApiResponse(res);
}

async function fetchGet(endpoint) {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: buildHeaders(),
  });
  return parseApiResponse(res);
}

// AUTH ENDPOINTS

export async function signupApi({ name, email, password }) {
  const json = await fetchApi("/api/auth/signup", { name, email, password });
  return json;
}

export async function loginApi({ email, password }) {
  const json = await fetchApi("/api/auth/login", { email, password });
  return json;
}

export async function getCurrentUserApi() {
  const json = await fetchApi("/api/auth/me", undefined, { method: "GET" });
  return json;
}

// AI ENDPOINTS

export async function extractReceipt(base64Image, mimeType = "image/jpeg") {
  const json = await fetchApi("/api/extract-receipt", { image: base64Image, mimeType });
  return json.data;
}

export async function extractPricesFromInputApi(parts, storeName, { userId, storeId, saveToCloud } = {}) {
  const json = await fetchApi("/api/gemini/extract-prices", {
    parts, storeName, userId, storeId, saveToCloud,
  });
  return json.data;
}

export async function queryPricesWithAiApi(question, dbRows) {
  const json = await fetchApi("/api/gemini/query-prices", { question, dbRows });
  return json.answer;
}

export async function askRealtimeWithImageAndVoiceApi(parts, dbRows = [], { latitude, longitude, radius } = {}) {
  const json = await fetchApi("/api/gemini/realtime-ask", {
    parts, dbRows, latitude, longitude, radius,
  });
  return json.answer;
}

export async function askRealtimeWithImageAndVoiceStreamApi(parts, onChunk, dbRows = [], { latitude, longitude } = {}) {
  const res = await fetch(`${API_BASE_URL}/api/gemini/realtime-ask-stream`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ parts, dbRows, latitude, longitude }),
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

// CLOUD ENDPOINTS - Users

export async function createUser({ name, email, latitude, longitude, address }) {
  const json = await fetchApi("/api/users", { name, email, latitude, longitude, address });
  return json.userId;
}

export async function getUser(userId) {
  const json = await fetchGet(`/api/users/${userId}`);
  return json.data;
}

export async function updateUserLocation(userId, { latitude, longitude, address }) {
  await fetchApi(`/api/users/${userId}/location`, { latitude, longitude, address }, { method: "PUT" });
}

// CLOUD ENDPOINTS - Stores

export async function createStore({ name, chain, address, latitude, longitude, city, state, zip, storeType }) {
  const json = await fetchApi("/api/stores", { name, chain, address, latitude, longitude, city, state, zip, storeType });
  return json.storeId;
}

export async function getStoresNearby(latitude, longitude, radius = 3) {
  const json = await fetchGet(`/api/stores/nearby?lat=${latitude}&lng=${longitude}&radius=${radius}`);
  return json.data;
}

export async function getAllStores() {
  const json = await fetchGet("/api/stores");
  return json.data;
}

export async function searchStore(name) {
  const json = await fetchGet(`/api/stores/search?name=${encodeURIComponent(name)}`);
  return json.data;
}

// CLOUD ENDPOINTS - Prices

export async function savePricesBatch({ items, storeName, storeId, storeLatitude, storeLongitude, userId, scanSource, scanId }) {
  const json = await fetchApi("/api/prices/batch", {
    items, storeName, storeId, storeLatitude, storeLongitude, userId, scanSource, scanId,
  });
  return json;
}

export async function searchCloudPrices(query) {
  const json = await fetchGet(`/api/prices/search?q=${encodeURIComponent(query || "")}`);
  return json.data;
}

export async function getPricesForProduct(productName) {
  const json = await fetchGet(`/api/prices/product/${encodeURIComponent(productName)}`);
  return json.data;
}

export async function getPricesNearby(product, latitude, longitude, radius = 3) {
  const json = await fetchGet(`/api/prices/nearby?product=${encodeURIComponent(product)}&lat=${latitude}&lng=${longitude}&radius=${radius}`);
  return json.data;
}

export async function comparePrices(product, latitude, longitude, radius = 3) {
  const json = await fetchGet(`/api/prices/compare?product=${encodeURIComponent(product)}&lat=${latitude}&lng=${longitude}&radius=${radius}`);
  return json.data;
}

// CLOUD ENDPOINTS - Scans

export async function saveScan({ userId, image, mimeType, scanType, storeName, storeId, latitude, longitude, extractedData }) {
  const json = await fetchApi("/api/scans", {
    userId, image, mimeType, scanType, storeName, storeId, latitude, longitude, extractedData,
  });
  return json;
}

export async function getUserScans(userId) {
  const json = await fetchGet(`/api/scans/user/${userId}`);
  return json.data;
}
