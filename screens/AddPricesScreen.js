import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { initDb, insertManyPriceRows } from "../database";

const storeNameFallback = "User submitted";

export default function AddPricesScreen({ navigation }) {
  const [storeName, setStoreName] = useState("");
  const [textInput, setTextInput] = useState("");
  const [parts, setParts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [thankYou, setThankYou] = useState(false);

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
      base64: true,
      videoMaxDuration: 60,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const a = result.assets[0];
    addPart({ type: "video", base64: a.base64, mimeType: a.mimeType || "video/mp4" });
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
        playsInSilentModeIOS: false,
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
        <Text style={styles.title}>Add new prices</Text>
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
  title: { color: "#FFF", fontSize: 24, fontWeight: "700", marginBottom: 16 },
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
