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

import { askRealtimeWithImageAndVoiceStream } from "../gemini";

function resolveVideoMimeType(uri) {
  const ext = (uri || "").split(".").pop()?.toLowerCase().split("?")[0];
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  if (ext === "3gp") return "video/3gpp";
  return "video/mp4";
}

export default function RealtimeAskScreen({ navigation }) {
  const cameraRef = useRef(null);
  const recordingPromiseRef = useRef(null);
  const speechQueueRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const pendingSpeechBufferRef = useRef("");
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const speakNext = useCallback(() => {
    if (isSpeakingRef.current) return;
    const next = speechQueueRef.current.shift();
    if (!next) return;

    isSpeakingRef.current = true;
    Speech.speak(next, {
      language: "en-US",
      pitch: 1,
      rate: 1.08,
      onDone: () => {
        isSpeakingRef.current = false;
        speakNext();
      },
      onStopped: () => {
        isSpeakingRef.current = false;
        speakNext();
      },
      onError: () => {
        isSpeakingRef.current = false;
        speakNext();
      },
    });
  }, []);

  const queueSpeech = useCallback(
    (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      speechQueueRef.current.push(trimmed);
      speakNext();
    },
    [speakNext]
  );

  const flushSpeakableText = useCallback(
    (force = false) => {
      let buffer = pendingSpeechBufferRef.current;
      let match = buffer.match(/^([\s\S]*?[.!?])(\s|$)/);

      while (match) {
        queueSpeech(match[1]);
        buffer = buffer.slice(match[0].length);
        match = buffer.match(/^([\s\S]*?[.!?])(\s|$)/);
      }

      if (force && buffer.trim()) {
        queueSpeech(buffer);
        buffer = "";
      }

      pendingSpeechBufferRef.current = buffer;
    },
    [queueSpeech]
  );

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

      const parts = [{ type: "video", base64: videoBase64, mimeType }];

      Speech.stop();
      speechQueueRef.current = [];
      isSpeakingRef.current = false;
      pendingSpeechBufferRef.current = "";
      setStatus("Answering…");

      const answerText = await askRealtimeWithImageAndVoiceStream(parts, (chunk, fullText) => {
        pendingSpeechBufferRef.current += chunk;
        flushSpeakableText(false);
        setStatus(fullText.trim());
      });

      pendingSpeechBufferRef.current += "";
      flushSpeakableText(true);
      setStatus(answerText);
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
      Speech.stop();
      speechQueueRef.current = [];
      isSpeakingRef.current = false;
      pendingSpeechBufferRef.current = "";
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
