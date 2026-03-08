/**
 * Firestore CRUD operations for all collections.
 */
const { db, FieldValue } = require("./firebase");
const { encodeGeohash, haversineDistance, geohashQueryBounds } = require("./geolocation");

// ═══════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════

async function createUser({ name, email, latitude, longitude, address }) {
    const ref = db.collection("users").doc();
    const geohash = latitude && longitude ? encodeGeohash(latitude, longitude) : null;
    await ref.set({
        name, email, latitude: latitude || null, longitude: longitude || null,
        address: address || null, geohash,
        createdAt: FieldValue.serverTimestamp(),
    });
    return ref.id;
}

async function getUser(userId) {
    const snap = await db.collection("users").doc(userId).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function updateUserLocation(userId, { latitude, longitude, address }) {
    const geohash = encodeGeohash(latitude, longitude);
    await db.collection("users").doc(userId).update({ latitude, longitude, address, geohash });
}

// ═══════════════════════════════════════════
// STORES
// ═══════════════════════════════════════════

async function createStore({ name, chain, address, latitude, longitude, city, state, zip, storeType }) {
    const geohash = latitude && longitude ? encodeGeohash(latitude, longitude) : null;
    const ref = db.collection("stores").doc();
    await ref.set({
        name, chain: chain || null, address: address || null,
        latitude: latitude || null, longitude: longitude || null,
        city: city || null, state: state || null, zip: zip || null,
        storeType: storeType || "grocery", geohash,
        createdAt: FieldValue.serverTimestamp(),
    });
    return ref.id;
}

async function getStore(storeId) {
    const snap = await db.collection("stores").doc(storeId).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function getAllStores() {
    const snap = await db.collection("stores").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function findStoreByName(name) {
    const snap = await db.collection("stores")
        .where("name", "==", name).limit(1).get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
}

async function findStoresNearby(lat, lng, radiusMiles = 3) {
    const bounds = geohashQueryBounds(lat, lng, radiusMiles);
    const results = [];
    for (const [start, end] of bounds) {
        const snap = await db.collection("stores")
            .where("geohash", ">=", start)
            .where("geohash", "<=", end)
            .get();
        for (const d of snap.docs) {
            const data = d.data();
            const dist = haversineDistance(lat, lng, data.latitude, data.longitude);
            if (dist <= radiusMiles) {
                results.push({ id: d.id, ...data, distance: Math.round(dist * 100) / 100 });
            }
        }
    }
    return results.sort((a, b) => a.distance - b.distance);
}

// ═══════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════

async function createProduct({ name, category, brand }) {
    const ref = db.collection("products").doc();
    const normalizedName = name.toLowerCase().trim();
    await ref.set({
        name, normalizedName, category: category || null,
        brand: brand || null, createdAt: FieldValue.serverTimestamp(),
    });
    return ref.id;
}

async function findProductByName(name) {
    const normalizedName = name.toLowerCase().trim();
    const snap = await db.collection("products")
        .where("normalizedName", "==", normalizedName).limit(1).get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
}

// ═══════════════════════════════════════════
// PRICES
// ═══════════════════════════════════════════

async function createPrice({ productId, productName, brand, weight, price, storeName, storeId, storeLatitude, storeLongitude, userId, scanSource, scanId }) {
    const storeGeohash = storeLatitude && storeLongitude
        ? encodeGeohash(storeLatitude, storeLongitude) : null;
    const ref = db.collection("prices").doc();
    await ref.set({
        productId: productId || null, productName, brand: brand || null,
        weight: weight || null, price,
        storeName: storeName || null, storeId: storeId || null,
        storeLatitude: storeLatitude || null, storeLongitude: storeLongitude || null,
        storeGeohash, userId: userId || null,
        scanSource: scanSource || null, scanId: scanId || null,
        createdAt: FieldValue.serverTimestamp(),
    });
    return ref.id;
}

async function findPricesForProduct(productName) {
    const snap = await db.collection("prices")
        .where("productName", "==", productName)
        .orderBy("price")
        .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function findPricesNearby(productName, lat, lng, radiusMiles = 3) {
    const bounds = geohashQueryBounds(lat, lng, radiusMiles);
    const results = [];
    for (const [start, end] of bounds) {
        const snap = await db.collection("prices")
            .where("productName", "==", productName)
            .where("storeGeohash", ">=", start)
            .where("storeGeohash", "<=", end)
            .get();
        for (const d of snap.docs) {
            const data = d.data();
            if (!data.storeLatitude || !data.storeLongitude) continue;
            const dist = haversineDistance(lat, lng, data.storeLatitude, data.storeLongitude);
            if (dist <= radiusMiles) {
                results.push({ id: d.id, ...data, distance: Math.round(dist * 100) / 100 });
            }
        }
    }
    return results.sort((a, b) => a.price - b.price);
}

async function searchPrices(searchTerm, limit = 500) {
    let query;
    if (searchTerm) {
        const end = searchTerm + "\uf8ff";
        query = db.collection("prices")
            .where("productName", ">=", searchTerm)
            .where("productName", "<=", end)
            .limit(limit);
    } else {
        query = db.collection("prices").limit(limit);
    }
    const snap = await query.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function findPricesByStore(storeId) {
    const snap = await db.collection("prices")
        .where("storeId", "==", storeId)
        .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ═══════════════════════════════════════════
// SCANS
// ═══════════════════════════════════════════

async function createScan({
    userId,
    mediaUrl,
    mediaPath,
    mimeType,
    scanType,
    storeName,
    storeId,
    latitude,
    longitude,
    extractedData,
    mediaItems,
    textInputs,
    locationLabel,
    userSnapshot,
    storeContext,
    extractedSummary,
}) {
    const geohash = latitude && longitude ? encodeGeohash(latitude, longitude) : null;
    const ref = db.collection("scans").doc();
    await ref.set({
        userId, mediaUrl: mediaUrl || null, mediaPath: mediaPath || null,
        mimeType: mimeType || null, scanType: scanType || "receipt",
        storeName: storeName || null, storeId: storeId || null,
        latitude: latitude || null, longitude: longitude || null, geohash,
        locationLabel: locationLabel || null,
        userSnapshot: userSnapshot || null,
        storeContext: storeContext || null,
        mediaItems: Array.isArray(mediaItems) ? mediaItems : [],
        textInputs: Array.isArray(textInputs) ? textInputs : [],
        extractedData: extractedData || null, itemCount: Array.isArray(extractedData) ? extractedData.length : 0,
        extractedSummary: extractedSummary || null,
        createdAt: FieldValue.serverTimestamp(),
    });
    return ref.id;
}

async function getUserScans(userId) {
    const snap = await db.collection("scans")
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ═══════════════════════════════════════════
// LIVE SESSIONS
// ═══════════════════════════════════════════

async function createLiveSession({ userId, latitude, longitude }) {
    const ref = db.collection("liveSessions").doc();
    await ref.set({
        userId, latitude: latitude || null, longitude: longitude || null,
        messages: [], createdAt: FieldValue.serverTimestamp(),
    });
    return ref.id;
}

async function addSessionMessage(sessionId, message) {
    await db.collection("liveSessions").doc(sessionId).update({
        messages: FieldValue.arrayUnion(message),
    });
}

// ═══════════════════════════════════════════
// HELPERS — Save extracted items
// ═══════════════════════════════════════════

async function saveExtractedItems({ items, storeName, storeId, storeLatitude, storeLongitude, userId, scanSource, scanId }) {
    const priceIds = [];
    for (const item of items) {
        // Find or create product
        let product = await findProductByName(item.item);
        if (!product) {
            const productId = await createProduct({ name: item.item, brand: item.brand });
            product = { id: productId };
        }

        const priceId = await createPrice({
            productId: product.id,
            productName: item.item,
            brand: item.brand || null,
            weight: item.weight || null,
            price: item.price,
            storeName,
            storeId: storeId || null,
            storeLatitude: storeLatitude || null,
            storeLongitude: storeLongitude || null,
            userId,
            scanSource,
            scanId: scanId || null,
        });
        priceIds.push(priceId);
    }
    return priceIds;
}

module.exports = {
    createUser, getUser, updateUserLocation,
    createStore, getStore, getAllStores, findStoreByName, findStoresNearby,
    createProduct, findProductByName,
    createPrice, findPricesForProduct, findPricesNearby, searchPrices, findPricesByStore,
    createScan, getUserScans,
    createLiveSession, addSessionMessage,
    saveExtractedItems,
};
