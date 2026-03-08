import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView } from "expo-camera";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import * as Speech from "expo-speech";

import { useApp } from "../context/AppContext";
import { askRealtimeWithImageAndVoice, extractPricesFromInput } from "../gemini";
import {
  getAllPricesForItem,
  getPriceForItemAtStore,
  insertPriceRow,
  initDb,
} from "../database";

const SCANNED_STORE = "Scanned";

function resolveVideoMimeType(uri) {
  const ext = (uri || "").split(".").pop()?.toLowerCase().split("?")[0];
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  if (ext === "3gp") return "video/3gpp";
  return "video/mp4";
}

export default function RealtimeAskScreen({ navigation }) {
  const { locationLabel } = useApp();
  const cameraRef = useRef(null);
  const recordingPromiseRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const startRecording = useCallback(async () => {
    try {
      const { status: perm } = await Audio.requestPermissionsAsync();
      if (perm !== "granted") {
        Alert.alert("Microphone access", "Allow microphone to ask questions by voice.");
        return;
      }
      if (!cameraRef.current || !cameraReady) return;

      setRecording(true);
      setStatus("Recording video… ask your question aloud, then tap Stop.");
      recordingPromiseRef.current = cameraRef.current.recordAsync({
        maxDuration: 20,
      });
    } catch (e) {
      Alert.alert("Recording failed", e?.message ?? "Could not start recording.");
      setRecording(false);
      recordingPromiseRef.current = null;
    }
  }, [cameraReady]);

  const stopAndAsk = useCallback(async () => {
    if (!recording) return;
    setBusy(true);
    setStatus("Processing…");
    try {
      cameraRef.current?.stopRecording();
      const video = await recordingPromiseRef.current;
      recordingPromiseRef.current = null;
      setRecording(false);

      const videoUri = video?.uri;
      let videoBase64 = null;
      let mimeType = "video/mp4";
      if (videoUri) {
        videoBase64 = await FileSystem.readAsStringAsync(videoUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        mimeType = resolveVideoMimeType(videoUri);
      }

      if (!videoBase64) {
        setStatus("Record a short video and ask your question, then try again.");
        setBusy(false);
        return;
      }

      await initDb();

      const parts = [{ type: "video", base64: videoBase64, mimeType }];

      let dbRows = [];
      let extractedItems = [];
      try {
        extractedItems = await extractPricesFromInput(
          [{ type: "video", base64: videoBase64, mimeType }],
          SCANNED_STORE
        );
        for (const it of extractedItems) {
          const rows = await getAllPricesForItem(it.item);
          dbRows.push(...rows);
        }
      } catch (e) {
        console.warn("Extract prices from video failed", e);
      }

      const answerText = await askRealtimeWithImageAndVoice(parts, dbRows);
      setStatus("");

      if (extractedItems.length > 0) {
        for (const it of extractedItems) {
          const existing = await getPriceForItemAtStore(it.item, SCANNED_STORE);
          if (!existing && it.item && Number.isFinite(it.price)) {
            try {
              await insertPriceRow({
                item: it.item,
                brand: it.brand || "",
                price: it.price,
                weight: it.weight || "",
                storeName: SCANNED_STORE,
              });
            } catch (e) {
              console.warn("Insert scanned item failed", e);
            }
          }
        }
      }

      Speech.speak(answerText, {
        language: "en-US",
        pitch: 1,
        rate: 0.95,
      });
    } catch (e) {
      Alert.alert("Error", e?.message ?? "Something went wrong.");
      setStatus("");
      setRecording(false);
      recordingPromiseRef.current = null;
    } finally {
      setBusy(false);
    }
  }, [recording]);

  const cancelRecording = useCallback(async () => {
    if (recording) {
      try {
        cameraRef.current?.stopRecording();
        await recordingPromiseRef.current;
      } catch (_) {}
      recordingPromiseRef.current = null;
      setRecording(false);
      setStatus("");
    }
  }, [recording]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Ask about any item</Text>
        <Text style={styles.subtitle}>
          Record a short video of the product and ask aloud (e.g. “Is there a nearby store where this is cheaper?”).
        </Text>
      </View>

      <View style={styles.cameraWrap}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="video"
          animateShutter={false}
          onCameraReady={() => setCameraReady(true)}
        />
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <View style={styles.controls}>
        {!recording ? (
          <Pressable
            style={[styles.mainBtn, (busy || !cameraReady) && styles.mainBtnDisabled]}
            onPress={startRecording}
            disabled={busy || !cameraReady}
          >
            <Text style={styles.mainBtnText}>Start video & ask</Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              style={[styles.mainBtn, styles.stopBtn]}
              onPress={stopAndAsk}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.mainBtnText}>Stop & get answer</Text>
              )}
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={cancelRecording}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0B0C" },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  backBtn: { marginBottom: 8 },
  backText: { color: "#2B6CFF", fontSize: 16 },
  title: { color: "#FFF", fontSize: 22, fontWeight: "700", marginBottom: 4 },
  subtitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    lineHeight: 20,
  },
  cameraWrap: {
    flex: 1,
    minHeight: 280,
    marginHorizontal: 20,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#111",
  },
  status: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
    textAlign: "center",
    marginTop: 12,
    paddingHorizontal: 20,
  },
  controls: {
    padding: 20,
    paddingBottom: 32,
    gap: 12,
  },
  mainBtn: {
    backgroundColor: "#2B6CFF",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  mainBtnDisabled: { opacity: 0.6 },
  mainBtnText: { color: "#FFF", fontSize: 17, fontWeight: "700" },
  stopBtn: { backgroundColor: "#c0392b" },
  cancelBtn: {
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelBtnText: { color: "rgba(255,255,255,0.7)", fontSize: 16 },
});
