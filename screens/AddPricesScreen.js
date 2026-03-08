import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
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

import AppHeader from "../components/AppHeader";
import { useApp } from "../context/AppContext";
import { extractPricesFromInput } from "../gemini";
import { extractReceipt, saveScan } from "../apiClient";
import { initDb, insertManyPriceRows } from "../database";
import { theme } from "../theme";

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
  const { user, location, locationLabel } = useApp();
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

  const ensurePermission = useCallback(async ({
    getPermission,
    requestPermission,
    permissionLabel,
  }) => {
    const currentPermission = await getPermission();
    if (currentPermission?.granted || currentPermission?.status === "granted") {
      return true;
    }

    if (currentPermission?.canAskAgain === false) {
      Alert.alert(
        "Permission required",
        `Please accept ${permissionLabel} permission in Settings to continue.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]
      );
      return false;
    }

    const requestedPermission = await requestPermission();
    if (requestedPermission?.granted || requestedPermission?.status === "granted") {
      return true;
    }

    if (requestedPermission?.canAskAgain === false) {
      Alert.alert(
        "Permission required",
        `Please accept ${permissionLabel} permission in Settings to continue.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]
      );
      return false;
    }

    Alert.alert(
      "Permission required",
      `Please accept ${permissionLabel} permission to continue.`
    );
    return false;
  }, []);

  const pickImage = useCallback(async () => {
    const allowed = await ensurePermission({
      getPermission: ImagePicker.getMediaLibraryPermissionsAsync,
      requestPermission: ImagePicker.requestMediaLibraryPermissionsAsync,
      permissionLabel: "gallery",
    });
    if (!allowed) {
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
  }, [addPart, ensurePermission]);

  const takePhoto = useCallback(async () => {
    const allowed = await ensurePermission({
      getPermission: ImagePicker.getCameraPermissionsAsync,
      requestPermission: ImagePicker.requestCameraPermissionsAsync,
      permissionLabel: "camera",
    });
    if (!allowed) {
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
  }, [addPart, ensurePermission]);

  const pickVideo = useCallback(async () => {
    const allowed = await ensurePermission({
      getPermission: ImagePicker.getMediaLibraryPermissionsAsync,
      requestPermission: ImagePicker.requestMediaLibraryPermissionsAsync,
      permissionLabel: "gallery",
    });
    if (!allowed) {
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
  }, [addPart, ensurePermission]);

  const recordAudio = useCallback(async () => {
    const allowed = await ensurePermission({
      getPermission: Audio.getPermissionsAsync,
      requestPermission: Audio.requestPermissionsAsync,
      permissionLabel: "microphone",
    });
    if (!allowed) {
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
  }, [addPart, ensurePermission]);

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
      const primaryMedia = buildParts.find((part) => part.base64);

      if (user?.id) {
        await saveScan({
          userId: user.id,
          image: primaryMedia?.base64,
          mimeType: primaryMedia?.mimeType,
          scanType: "manual-multimodal",
          storeName: store,
          latitude: location?.latitude,
          longitude: location?.longitude,
          extractedData: extracted,
          parts: buildParts,
          locationLabel,
          user: {
            id: user.id,
            name: user.name || "",
            email: user.email || "",
          },
          storeContext: {
            enteredStoreName: store,
            source: "manual-add-prices",
          },
        });
      }

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
  }, [location?.latitude, location?.longitude, locationLabel, parts, storeName, textInput, user]);

  /* ───────── Receipt scanning flow ───────── */
  const scanReceiptFromCamera = useCallback(async () => {
    const allowed = await ensurePermission({
      getPermission: ImagePicker.getCameraPermissionsAsync,
      requestPermission: ImagePicker.requestCameraPermissionsAsync,
      permissionLabel: "camera",
    });
    if (!allowed) {
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
  }, [ensurePermission]);

  const scanReceiptFromGallery = useCallback(async () => {
    const allowed = await ensurePermission({
      getPermission: ImagePicker.getMediaLibraryPermissionsAsync,
      requestPermission: ImagePicker.requestMediaLibraryPermissionsAsync,
      permissionLabel: "gallery",
    });
    if (!allowed) {
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
  }, [ensurePermission]);

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

      if (user?.id) {
        await saveScan({
          userId: user.id,
          image: receiptMedia?.base64,
          mimeType: receiptMedia?.mimeType,
          scanType: "receipt-review",
          storeName: store,
          latitude: location?.latitude,
          longitude: location?.longitude,
          extractedData: rows,
          parts: receiptMedia?.base64
            ? [{ type: receiptMedia.mimeType?.includes("video") ? "video" : "image", base64: receiptMedia.base64, mimeType: receiptMedia.mimeType }]
            : [],
          locationLabel,
          user: {
            id: user.id,
            name: user.name || "",
            email: user.email || "",
          },
          storeContext: {
            enteredStoreName: store,
            detectedStoreName: receiptData?.storeName || "",
            detectedStoreAddress: receiptData?.storeAddress || "",
            receiptDate: receiptData?.date || "",
            receiptTotal: receiptData?.total ?? null,
            source: "receipt-review",
          },
        });
      }

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
  }, [
    editingItems,
    location?.latitude,
    location?.longitude,
    locationLabel,
    receiptData?.date,
    receiptData?.storeAddress,
    receiptData?.storeName,
    receiptData?.total,
    receiptMedia?.base64,
    receiptMedia?.mimeType,
    receiptStoreName,
    user,
  ]);

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
          <View style={styles.thankYouCard}>
            <Text style={styles.thankYouEmoji}>✓</Text>
            <Text style={styles.thankYouTitle}>Thank you</Text>
            <Text style={styles.thankYouText}>
              Your prices have been saved. You can add more or go back.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              onPress={() => setThankYou(false)}
            >
              <Text style={styles.buttonText}>Add more</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.buttonOutline, pressed && styles.pressed]}
              onPress={() => {
                setThankYou(false);
                navigation.goBack();
              }}
            >
              <Text style={styles.buttonTextOutline}>Back to home</Text>
            </Pressable>
          </View>
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
          <AppHeader
            title="Review extraction"
            subtitle="Check the detected items and save the same receipt data flow as before."
            onBack={cancelReceipt}
            backLabel="Cancel"
          />

          {/* Media preview */}
          {receiptMedia?.uri && (
            receiptMedia.mimeType.includes("video") ? (
              <View style={[styles.receiptPreview, styles.videoPreviewBox]}>
                <Text style={styles.videoEmoji}>🎬</Text>
                <Text style={styles.videoPreviewText}>Video processing</Text>
              </View>
            ) : (
              <Image source={{ uri: receiptMedia.uri }} style={styles.receiptPreview} resizeMode="contain" />
            )
          )}

          {busy && !receiptData ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.white} />
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
        <AppHeader
          title="Add new prices"
          subtitle="Scan a receipt or add price details manually without changing how anything works."
          onBack={() => navigation.goBack()}
        />

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
  safe: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingTop: 20, paddingBottom: 40 },
  receiptSection: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.xl,
    padding: 20,
    marginBottom: 20,
    ...theme.shadow,
  },
  receiptSectionTitle: { color: theme.colors.text, fontSize: 22, fontWeight: "800", marginBottom: 8 },
  receiptSectionDesc: { color: theme.colors.textSoft, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  receiptBtnRow: { flexDirection: "row", gap: 12 },
  receiptBtn: {
    flex: 1,
    backgroundColor: theme.colors.accent,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
    ...theme.softShadow,
  },
  receiptBtnText: { color: theme.colors.white, fontSize: 15, fontWeight: "800" },
  divider: { flexDirection: "row", alignItems: "center", marginBottom: 20, gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "rgba(255,248,240,0.45)" },
  dividerText: { color: "rgba(255,248,240,0.88)", fontSize: 13, fontWeight: "700" },
  receiptPreview: {
    width: "100%",
    height: 200,
    borderRadius: 22,
    backgroundColor: theme.colors.surfaceStrong,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  videoPreviewBox: {
    justifyContent: "center",
    alignItems: "center",
    ...theme.softShadow,
  },
  videoEmoji: { fontSize: 40, marginBottom: 8 },
  videoPreviewText: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  loadingContainer: { alignItems: "center", paddingVertical: 40, gap: 10 },
  loadingText: { color: theme.colors.white, fontSize: 17, fontWeight: "700" },
  loadingSubtext: { color: "rgba(255,248,240,0.84)", fontSize: 14 },
  receiptSummary: {
    backgroundColor: theme.colors.surface,
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.softShadow,
  },
  summaryText: { color: theme.colors.textSoft, fontSize: 14 },
  summaryTotal: { fontWeight: "800", color: theme.colors.text, fontSize: 16, marginTop: 4 },
  sectionTitle: { color: theme.colors.white, fontSize: 18, fontWeight: "800", marginBottom: 12 },
  itemCard: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 22,
    padding: 14,
    marginBottom: 10,
    ...theme.softShadow,
  },
  itemHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  categoryBadge: {
    backgroundColor: theme.colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  categoryText: { color: theme.colors.accentDark, fontSize: 12, fontWeight: "700" },
  removeBtn: { padding: 4 },
  removeBtnText: { color: theme.colors.textMuted, fontSize: 18 },
  itemInput: {
    backgroundColor: theme.colors.surfaceStrong,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
    fontSize: 15,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  itemRow: { flexDirection: "row", gap: 8 },
  itemField: { flex: 1 },
  itemFieldLabel: { color: theme.colors.textSoft, fontSize: 11, marginBottom: 4, fontWeight: "700" },
  itemInputSmall: {
    backgroundColor: theme.colors.surfaceStrong,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: theme.colors.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  label: { color: theme.colors.white, fontSize: 13, fontWeight: "700", marginBottom: 6 },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.colors.text,
    fontSize: 16,
    marginBottom: 16,
    ...theme.softShadow,
  },
  textArea: { minHeight: 100, textAlignVertical: "top" },
  attachRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  attachBtn: {
    backgroundColor: theme.colors.surface,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.softShadow,
  },
  attachLabel: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  partsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  partChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.accentSoft,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  partChipText: { color: theme.colors.accentDark, fontSize: 12, fontWeight: "700" },
  partChipX: { color: theme.colors.accentDark, fontSize: 12 },
  sendBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
    ...theme.softShadow,
  },
  sendBtnDisabled: { opacity: 0.6 },
  sendBtnText: { color: theme.colors.white, fontSize: 16, fontWeight: "800" },
  pressed: { opacity: 0.9 },
  thankYou: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  thankYouCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 28,
    alignItems: "center",
    ...theme.shadow,
  },
  thankYouEmoji: { fontSize: 64, marginBottom: 16 },
  thankYouTitle: { color: theme.colors.text, fontSize: 28, fontWeight: "800", marginBottom: 8 },
  thankYouText: {
    color: theme.colors.textSoft,
    fontSize: 16,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  button: {
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 18,
    marginBottom: 12,
    minWidth: 190,
    alignItems: "center",
    ...theme.softShadow,
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceStrong,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 18,
    minWidth: 190,
    alignItems: "center",
  },
  buttonText: { color: theme.colors.white, fontSize: 16, fontWeight: "800" },
  buttonTextOutline: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
});
