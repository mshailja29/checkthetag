import React, { useCallback, useEffect, useRef, useState } from "react";
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

import AppHeader from "../components/AppHeader";
import { askRealtimeWithImageAndVoiceStream } from "../gemini";
import { theme } from "../theme";

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
  const queuedSpeechCountRef = useRef(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const ensurePlaybackAudioMode = useCallback(async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (_) {
      // Do not block speech if audio mode reset fails.
    }
  }, []);

  const speakNext = useCallback(async () => {
    if (isSpeakingRef.current) return;
    const next = speechQueueRef.current.shift();
    if (!next) return;

    isSpeakingRef.current = true;
    await ensurePlaybackAudioMode();
    Speech.speak(next, {
      language: "en-US",
      pitch: 1,
      rate: 1.08,
      onDone: () => {
        isSpeakingRef.current = false;
        void speakNext();
      },
      onStopped: () => {
        isSpeakingRef.current = false;
        void speakNext();
      },
      onError: () => {
        isSpeakingRef.current = false;
        void speakNext();
      },
    });
  }, [ensurePlaybackAudioMode]);

  const queueSpeech = useCallback(
    (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      queuedSpeechCountRef.current += 1;
      speechQueueRef.current.push(trimmed);
      void speakNext();
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

  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);

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
      queuedSpeechCountRef.current = 0;
      setStatus("Answering…");

      const answerText = await askRealtimeWithImageAndVoiceStream(parts, (chunk, fullText) => {
        pendingSpeechBufferRef.current += chunk;
        flushSpeakableText(false);
        setStatus(fullText.trim());
      });

      await ensurePlaybackAudioMode();
      flushSpeakableText(true);
      if (queuedSpeechCountRef.current === 0 && answerText.trim()) {
        queueSpeech(answerText);
      }
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
      queuedSpeechCountRef.current = 0;
      recordingPromiseRef.current = null;
      setRecording(false);
      setStatus("");
    }
  }, [recording]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <AppHeader
          title="Ask about any item"
          subtitle="Record a short video of the product and ask aloud to get spoken answers and cheaper nearby options."
          onBack={() => navigation.goBack()}
        />
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

      {status ? (
        <View style={styles.statusCard}>
          <Text style={styles.status}>{status}</Text>
        </View>
      ) : null}

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
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10 },
  cameraWrap: {
    flex: 1,
    minHeight: 280,
    marginHorizontal: 20,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: theme.colors.surface,
    borderWidth: 3,
    borderColor: "rgba(255,248,240,0.7)",
    ...theme.shadow,
  },
  statusCard: {
    marginTop: 14,
    marginHorizontal: 20,
    backgroundColor: theme.colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...theme.softShadow,
  },
  status: {
    color: theme.colors.text,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  controls: {
    padding: 20,
    paddingBottom: 32,
    gap: 12,
  },
  mainBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
    ...theme.softShadow,
  },
  mainBtnDisabled: { opacity: 0.6 },
  mainBtnText: { color: theme.colors.white, fontSize: 17, fontWeight: "800" },
  stopBtn: { backgroundColor: theme.colors.danger },
  cancelBtn: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
    ...theme.softShadow,
  },
  cancelBtnText: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
});
