import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";

import { extractPricesFromInput } from "../gemini";
import { extractReceipt } from "../apiClient";
import { initDb, insertManyPriceRows } from "../database";

const storeNameFallback = "User submitted";

// iOS often returns null or "image/jpeg" as mimeType for video files.
// Derive the true mime type from the URI extension instead.
function resolveVideoMimeType(uri, pickerMimeType) {
  const ext = (uri || "").split(".").pop().toLowerCase().split("?")[0];
  const extMap = { mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", "3gp": "video/3gpp", webm: "video/webm" };
  if (extMap[ext]) return extMap[ext];
  if (pickerMimeType && pickerMimeType.startsWith("video/")) return pickerMimeType;
  return "video/mp4";
}

// Check if an asset is a video by URI extension or type field, not just mimeType
// (iOS image picker returns wrong mimeType for videos)
function assetIsVideo(asset) {
  const uri = asset.uri || "";
  const ext = uri.split(".").pop().toLowerCase().split("?")[0];
  const videoExts = ["mp4", "mov", "m4v", "3gp", "webm", "avi"];
  if (videoExts.includes(ext)) return true;
  if (asset.type === "video") return true;
  if (asset.mimeType && asset.mimeType.startsWith("video/")) return true;
  return false;
}

// Read the FULL video file from URI as base64.
// Never use a.base64 for videos — the picker returns a thumbnail frame, not video bytes.
async function readVideoAsBase64(uri) {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

export default function AddPricesScreen({ navigation }) {
  const [storeName, setStoreName] = useState("");
  const [textInput, setTextInput] = useState("");
  const [parts, setParts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [thankYou, setThankYou] = useState(false);

  // Receipt scanning state
  const [receiptMode, setReceiptMode] = useState(false);
  const [receiptMedia, setReceiptMedia] = useState(null);   // { base64, uri, mimeType }
  const [receiptData, setReceiptData] = useState(null);   // parsed receipt from backend
  const [editingItems, setEditingItems] = useState([]);    // editable items list
  const [receiptStoreName, setReceiptStoreName] = useState("");

  /* ───────── Original manual input helpers ───────── */
  const addPart = useCallback((part) => {
    setParts((prev) => [...prev, part]);
  }, []);

  const pickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access to attach images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const a = result.assets[0];
    addPart({ type: "image", base64: a.base64, mimeType: a.mimeType || "image/jpeg" });
  }, [addPart]);

  const takePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow camera access to take a photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const a = result.assets[0];
    addPart({ type: "image", base64: a.base64, mimeType: a.mimeType || "image/jpeg" });
  }, [addPart]);

  const pickVideo = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access to attach videos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: 60,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    if (!a.uri) return;
    try {
      const base64 = await readVideoAsBase64(a.uri);
      const mime = resolveVideoMimeType(a.uri, a.mimeType);
      addPart({ type: "video", base64, mimeType: mime });
    } catch (e) {
      Alert.alert("Error", "Could not read video file. Try a shorter clip.");
    }
  }, [addPart]);

  const recordAudio = useCallback(async () => {
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow microphone access to record audio.");
      return;
    }
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      Alert.alert(
        "Recording",
        "Tap OK when you're done describing items and prices.",
        [
          {
            text: "Stop & send",
            onPress: async () => {
              await recording.stopAndUnloadAsync();
              const uri = recording.getURI();
              if (uri) {
                try {
                  const b64 = await FileSystem.readAsStringAsync(uri, {
                    encoding: FileSystem.EncodingType.Base64,
                  });
                  addPart({ type: "audio", base64: b64, mimeType: "audio/mpeg" });
                } catch (e) {
                  Alert.alert("Error", "Could not read audio file.");
                }
              }
            },
          },
        ]
      );
    } catch (e) {
      Alert.alert("Recording failed", e?.message ?? "Could not start recording.");
    }
  }, [addPart]);

  const removePart = useCallback((index) => {
    setParts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const send = useCallback(async () => {
    const hasText = textInput.trim().length > 0;
    if (!hasText && parts.length === 0) {
      Alert.alert("Add content", "Type a message or attach an image, video, or audio.");
      return;
    }
    const store = storeName.trim() || storeNameFallback;
    setBusy(true);
    setThankYou(false);
    try {
      await initDb();
      const buildParts = [];
      if (hasText) buildParts.push({ type: "text", value: textInput.trim() });
      buildParts.push(...parts);
      const extracted = await extractPricesFromInput(buildParts, store);
      if (extracted.length > 0) {
        await insertManyPriceRows(extracted, store);
      }
      setThankYou(true);
      setTextInput("");
      setParts([]);
    } catch (e) {
      Alert.alert("Error", e?.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, [textInput, parts, storeName]);

  /* ───────── Receipt scanning flow ───────── */
  const scanReceiptFromCamera = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow camera access to scan receipts.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All, // Allow images and videos
      base64: true,
      quality: 0.85,
      videoMaxDuration: 10, // Limit video length to prevent 200MB+ base64 payloads
      videoQuality: 0, // 0 = Lowest quality to shrink size fast
    });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const isVideo = assetIsVideo(a);
    const mime = isVideo
      ? resolveVideoMimeType(a.uri, a.mimeType)
      : (a.mimeType || "image/jpeg");
    let base64;
    if (isVideo) {
      if (!a.uri) return;
      try {
        base64 = await readVideoAsBase64(a.uri);
      } catch (e) {
        Alert.alert("Error", "Could not read video file.");
        return;
      }
    } else {
      base64 = a.base64;
    }
    if (!base64) return;
    setReceiptMedia({ base64, uri: a.uri, mimeType: mime });
    setReceiptMode(true);
    await processReceiptMedia(base64, mime);
  }, []);

  const scanReceiptFromGallery = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access to pick receipts.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All, // Allow images and videos
      base64: true,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const isVideo = assetIsVideo(a);
    const mime = isVideo
      ? resolveVideoMimeType(a.uri, a.mimeType)
      : (a.mimeType || "image/jpeg");
    let base64;
    if (isVideo) {
      if (!a.uri) return;
      try {
        base64 = await readVideoAsBase64(a.uri);
      } catch (e) {
        Alert.alert("Error", "Could not read video file. Try a shorter clip.");
        return;
      }
    } else {
      base64 = a.base64;
    }
    if (!base64) return;

    // Size safeguard for extremely large gallery videos
    if (isVideo && base64.length > 50_000_000) {
      Alert.alert("Too large", "This video is too large to process. Please select a shorter snippet (under 10s).");
      return;
    }

    setReceiptMedia({ base64, uri: a.uri, mimeType: mime });
    setReceiptMode(true);
    await processReceiptMedia(base64, mime);
  }, []);

  const processReceiptMedia = async (base64, mimeType) => {
    setBusy(true);
    try {
      const data = await extractReceipt(base64, mimeType);
      setReceiptData(data);
      setReceiptStoreName(data.storeName || "");
      setEditingItems(
        (data.items || []).map((item, i) => ({ ...item, _key: `${i}_${Date.now()}` }))
      );
    } catch (e) {
      Alert.alert("Extraction Error", e?.message ?? "Could not extract receipt data. Try again.");
      setReceiptMode(false);
      setReceiptMedia(null);
    } finally {
      setBusy(false);
    }
  };

  const updateItem = (index, field, value) => {
    setEditingItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, [field]: field === "price" || field === "quantity" ? Number(value) || 0 : value } : item
      )
    );
  };

  const removeItem = (index) => {
    setEditingItems((prev) => prev.filter((_, i) => i !== index));
  };

  const confirmReceipt = useCallback(async () => {
    const validItems = editingItems.filter((item) => item.name.trim() && item.price > 0);
    if (validItems.length === 0) {
      Alert.alert("No items", "Add at least one item with a name and price.");
      return;
    }
    const store = receiptStoreName.trim() || storeNameFallback;
    setBusy(true);
    try {
      await initDb();
      const rows = validItems.map((item) => ({
        item: item.name,
        brand: item.brand || "",
        price: item.price,
        weight: item.weight || "",
      }));
      await insertManyPriceRows(rows, store);
      setThankYou(true);
      setReceiptMode(false);
      setReceiptMedia(null);
      setReceiptData(null);
      setEditingItems([]);
    } catch (e) {
      Alert.alert("Error", e?.message ?? "Could not save receipt data.");
    } finally {
      setBusy(false);
    }
  }, [editingItems, receiptStoreName]);

  const cancelReceipt = () => {
    setReceiptMode(false);
    setReceiptMedia(null);
    setReceiptData(null);
    setEditingItems([]);
    setReceiptStoreName("");
  };

  /* ───────── Thank You screen ───────── */
  if (thankYou) {
    return (
      <View style={styles.safe}>
        <View style={styles.thankYou}>
          <Text style={styles.thankYouEmoji}>✓</Text>
          <Text style={styles.thankYouTitle}>Thank you</Text>
          <Text style={styles.thankYouText}>Your prices have been saved. You can add more or go back.</Text>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            onPress={() => setThankYou(false)}
          >
            <Text style={styles.buttonText}>Add more</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.buttonOutline, pressed && styles.pressed]}
            onPress={() => { setThankYou(false); navigation.goBack(); }}
          >
            <Text style={styles.buttonTextOutline}>Back to home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  /* ───────── Receipt review screen ───────── */
  if (receiptMode) {
    return (
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable onPress={cancelReceipt} style={styles.backBtn}>
            <Text style={styles.backText}>← Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Review extraction</Text>

          {/* Media preview */}
          {receiptMedia?.uri && (
            receiptMedia.mimeType.includes("video") ? (
              <View style={[styles.receiptPreview, styles.videoPreviewBox]}>
                <Text style={{ fontSize: 40, marginBottom: 8 }}>🎬</Text>
                <Text style={{ color: "#FFF", fontSize: 16 }}>Video processing</Text>
              </View>
            ) : (
              <Image source={{ uri: receiptMedia.uri }} style={styles.receiptPreview} resizeMode="contain" />
            )
          )}

          {busy && !receiptData ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#2B6CFF" />
              <Text style={styles.loadingText}>Analyzing receipt with AI…</Text>
              <Text style={styles.loadingSubtext}>This may take a few seconds</Text>
            </View>
          ) : receiptData ? (
            <>
              {/* Store name */}
              <Text style={styles.label}>Store name</Text>
              <TextInput
                value={receiptStoreName}
                onChangeText={setReceiptStoreName}
                placeholder="Store name"
                placeholderTextColor="#8A8A8A"
                style={styles.input}
              />

              {/* Receipt summary */}
              {(receiptData.date || receiptData.total != null) && (
                <View style={styles.receiptSummary}>
                  {receiptData.date ? (
                    <Text style={styles.summaryText}>📅 {receiptData.date}</Text>
                  ) : null}
                  {receiptData.subtotal != null ? (
                    <Text style={styles.summaryText}>Subtotal: ${receiptData.subtotal.toFixed(2)}</Text>
                  ) : null}
                  {receiptData.tax != null ? (
                    <Text style={styles.summaryText}>Tax: ${receiptData.tax.toFixed(2)}</Text>
                  ) : null}
                  {receiptData.total != null ? (
                    <Text style={[styles.summaryText, styles.summaryTotal]}>
                      Total: ${receiptData.total.toFixed(2)}
                    </Text>
                  ) : null}
                </View>
              )}

              {/* Items list */}
              <Text style={styles.sectionTitle}>
                Items ({editingItems.length})
              </Text>
              {editingItems.map((item, index) => (
                <View key={item._key} style={styles.itemCard}>
                  <View style={styles.itemHeader}>
                    <View style={styles.categoryBadge}>
                      <Text style={styles.categoryText}>{item.category || "Other"}</Text>
                    </View>
                    <Pressable onPress={() => removeItem(index)} style={styles.removeBtn}>
                      <Text style={styles.removeBtnText}>✕</Text>
                    </Pressable>
                  </View>
                  <TextInput
                    value={item.name}
                    onChangeText={(v) => updateItem(index, "name", v)}
                    placeholder="Item name"
                    placeholderTextColor="#8A8A8A"
                    style={styles.itemInput}
                  />
                  <View style={styles.itemRow}>
                    <View style={styles.itemField}>
                      <Text style={styles.itemFieldLabel}>Price</Text>
                      <TextInput
                        value={String(item.price || "")}
                        onChangeText={(v) => updateItem(index, "price", v)}
                        placeholder="0.00"
                        placeholderTextColor="#8A8A8A"
                        style={styles.itemInputSmall}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={styles.itemField}>
                      <Text style={styles.itemFieldLabel}>Qty</Text>
                      <TextInput
                        value={String(item.quantity || "")}
                        onChangeText={(v) => updateItem(index, "quantity", v)}
                        placeholder="1"
                        placeholderTextColor="#8A8A8A"
                        style={styles.itemInputSmall}
                        keyboardType="number-pad"
                      />
                    </View>
                    <View style={styles.itemField}>
                      <Text style={styles.itemFieldLabel}>Weight</Text>
                      <TextInput
                        value={item.weight || ""}
                        onChangeText={(v) => updateItem(index, "weight", v)}
                        placeholder="e.g. 16 oz"
                        placeholderTextColor="#8A8A8A"
                        style={styles.itemInputSmall}
                      />
                    </View>
                  </View>
                </View>
              ))}

              {/* Confirm button */}
              <Pressable
                style={[styles.sendBtn, busy && styles.sendBtnDisabled]}
                onPress={confirmReceipt}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.sendBtnText}>
                    Save {editingItems.length} item{editingItems.length !== 1 ? "s" : ""}
                  </Text>
                )}
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  /* ───────── Main screen ───────── */
  return (
    <KeyboardAvoidingView
      style={styles.safe}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Add new prices</Text>

        {/* ── Scan Receipt section ── */}
        <View style={styles.receiptSection}>
          <Text style={styles.receiptSectionTitle}>📸 Scan a receipt</Text>
          <Text style={styles.receiptSectionDesc}>
            Take a photo or pick an image of your receipt — AI will extract all items and prices automatically.
          </Text>
          <View style={styles.receiptBtnRow}>
            <Pressable
              style={({ pressed }) => [styles.receiptBtn, pressed && styles.pressed]}
              onPress={scanReceiptFromCamera}
              disabled={busy}
            >
              <Text style={styles.receiptBtnText}>📷 Camera</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.receiptBtn, pressed && styles.pressed]}
              onPress={scanReceiptFromGallery}
              disabled={busy}
            >
              <Text style={styles.receiptBtnText}>🖼 Gallery</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Divider ── */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or add manually</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* ── Manual input section (existing) ── */}
        <Text style={styles.label}>Store / branch (optional)</Text>
        <TextInput
          value={storeName}
          onChangeText={setStoreName}
          placeholder="e.g. Walmart"
          placeholderTextColor="#8A8A8A"
          style={styles.input}
          editable={!busy}
        />
        <Text style={styles.label}>Describe or attach</Text>
        <TextInput
          value={textInput}
          onChangeText={setTextInput}
          placeholder="Paste receipt text, or describe items and prices..."
          placeholderTextColor="#8A8A8A"
          style={[styles.input, styles.textArea]}
          multiline
          numberOfLines={3}
          editable={!busy}
        />
        <View style={styles.attachRow}>
          <Pressable style={styles.attachBtn} onPress={takePhoto} disabled={busy}>
            <Text style={styles.attachLabel}>📷 Photo</Text>
          </Pressable>
          <Pressable style={styles.attachBtn} onPress={pickImage} disabled={busy}>
            <Text style={styles.attachLabel}>🖼 Image</Text>
          </Pressable>
          <Pressable style={styles.attachBtn} onPress={pickVideo} disabled={busy}>
            <Text style={styles.attachLabel}>🎬 Video</Text>
          </Pressable>
          <Pressable style={styles.attachBtn} onPress={recordAudio} disabled={busy}>
            <Text style={styles.attachLabel}>🎤 Audio</Text>
          </Pressable>
        </View>
        {parts.length > 0 && (
          <View style={styles.partsRow}>
            {parts.map((p, i) => (
              <Pressable
                key={i}
                style={styles.partChip}
                onPress={() => removePart(i)}
              >
                <Text style={styles.partChipText}>
                  {p.type === "text" ? "Text" : p.type.charAt(0).toUpperCase() + p.type.slice(1)}
                </Text>
                <Text style={styles.partChipX}> ×</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Pressable
          style={[styles.sendBtn, busy && styles.sendBtnDisabled]}
          onPress={send}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.sendBtnText}>Extract & save prices</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0B0C" },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  backBtn: { marginBottom: 8 },
  backText: { color: "#2B6CFF", fontSize: 16 },
  title: { color: "#FFF", fontSize: 24, fontWeight: "700", marginBottom: 16 },

  /* ── Receipt section ── */
  receiptSection: {
    backgroundColor: "#111114",
    borderColor: "rgba(43,108,255,0.3)",
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  receiptSectionTitle: { color: "#FFF", fontSize: 18, fontWeight: "700", marginBottom: 6 },
  receiptSectionDesc: { color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 20, marginBottom: 14 },
  receiptBtnRow: { flexDirection: "row", gap: 12 },
  receiptBtn: {
    flex: 1,
    backgroundColor: "#2B6CFF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  receiptBtnText: { color: "#FFF", fontSize: 15, fontWeight: "600" },

  /* ── Divider ── */
  divider: { flexDirection: "row", alignItems: "center", marginBottom: 20, gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.1)" },
  dividerText: { color: "rgba(255,255,255,0.4)", fontSize: 13 },

  /* ── Receipt review ── */
  receiptPreview: {
    width: "100%",
    height: 200,
    borderRadius: 12,
    backgroundColor: "#141416",
    marginBottom: 16,
  },
  videoPreviewBox: {
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  loadingContainer: { alignItems: "center", paddingVertical: 40, gap: 10 },
  loadingText: { color: "#FFF", fontSize: 17, fontWeight: "600" },
  loadingSubtext: { color: "rgba(255,255,255,0.5)", fontSize: 14 },
  receiptSummary: {
    backgroundColor: "#141416",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    gap: 4,
  },
  summaryText: { color: "rgba(255,255,255,0.8)", fontSize: 14 },
  summaryTotal: { fontWeight: "700", color: "#FFF", fontSize: 16, marginTop: 4 },
  sectionTitle: { color: "#FFF", fontSize: 17, fontWeight: "700", marginBottom: 12 },
  itemCard: {
    backgroundColor: "#141416",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  itemHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  categoryBadge: {
    backgroundColor: "rgba(43,108,255,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryText: { color: "#5B9AFF", fontSize: 12, fontWeight: "600" },
  removeBtn: { padding: 4 },
  removeBtnText: { color: "rgba(255,255,255,0.4)", fontSize: 18 },
  itemInput: {
    backgroundColor: "#1a1a1c",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#FFF",
    fontSize: 15,
    marginBottom: 8,
  },
  itemRow: { flexDirection: "row", gap: 8 },
  itemField: { flex: 1 },
  itemFieldLabel: { color: "rgba(255,255,255,0.5)", fontSize: 11, marginBottom: 4 },
  itemInputSmall: {
    backgroundColor: "#1a1a1c",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#FFF",
    fontSize: 14,
  },

  /* ── Existing styles ── */
  label: { color: "rgba(255,255,255,0.8)", fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: "#141416",
    borderColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#FFF",
    fontSize: 16,
    marginBottom: 16,
  },
  textArea: { minHeight: 100, textAlignVertical: "top" },
  attachRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  attachBtn: {
    backgroundColor: "#1a1a1c",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  attachLabel: { color: "#FFF", fontSize: 14 },
  partsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  partChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e3a5f",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  partChipText: { color: "#FFF", fontSize: 12 },
  partChipX: { color: "rgba(255,255,255,0.8)", fontSize: 12 },
  sendBtn: {
    backgroundColor: "#2B6CFF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  sendBtnDisabled: { opacity: 0.6 },
  sendBtnText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  pressed: { opacity: 0.9 },
  thankYou: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  thankYouEmoji: { fontSize: 64, marginBottom: 16 },
  thankYouTitle: { color: "#FFF", fontSize: 28, fontWeight: "700", marginBottom: 8 },
  thankYouText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 24,
  },
  button: {
    backgroundColor: "#2B6CFF",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginBottom: 12,
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  buttonText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
  buttonTextOutline: { color: "rgba(255,255,255,0.9)", fontSize: 16 },
});
