import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView } from "expo-camera";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import * as Speech from "expo-speech";
import * as Location from "expo-location";

import AppHeader from "../components/AppHeader";
import { askRealtimeWithImageAndVoiceStream } from "../gemini";
import { theme } from "../theme";

// Silence detection config
const SILENCE_THRESHOLD_DB = -35; // dBFS — below this = silence
const SILENCE_DURATION_MS = 1800; // 1.8s of silence = done talking
const MIN_RECORDING_MS = 800;     // minimum recording length

export default function RealtimeAskScreen({ navigation }) {
  const cameraRef = useRef(null);
  const audioRecordingRef = useRef(null);
  const speechQueueRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const pendingSpeechBufferRef = useRef("");
  const queuedSpeechCountRef = useRef(0);
  const lastAiSpeechRef = useRef("");
  const flatListRef = useRef(null);
  const conversationHistoryRef = useRef([]);
  const silenceTimerRef = useRef(null);
  const recordingStartTimeRef = useRef(0);
  const conversationModeRef = useRef(false);
  const busyRef = useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const [cameraReady, setCameraReady] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const [textInput, setTextInput] = useState("");
  const [sessionActive, setSessionActive] = useState(true);
  const [conversationMode, setConversationMode] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState(""); // "Listening...", "Thinking...", "Speaking..."
  const locationRef = useRef(null);

  // Keep busyRef in sync
  useEffect(() => { busyRef.current = busy; }, [busy]);

  // Fetch location on mount
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          locationRef.current = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        }
      } catch (_) {}
    })();
  }, []);

  // Pulse animation for conversation mode
  useEffect(() => {
    if (conversationMode) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [conversationMode]);

  // ─── Audio mode helpers ───

  const ensureRecordingAudioMode = useCallback(async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (_) {}
  }, []);

  const ensurePlaybackAudioMode = useCallback(async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (_) {}
  }, []);

  const speakText = useCallback(async (text) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return false;

    const trySpeak = (iosUsesAppSession) => new Promise((resolve) => {
      let settled = false;
      const finish = (started) => {
        if (settled) return;
        settled = true;
        resolve(started);
      };

      const timeoutId = setTimeout(() => finish(false), 1200);

      try {
        Speech.speak(trimmed, {
          language: "en-US",
          pitch: 1,
          rate: 1.0,
          volume: 1,
          ...(Platform.OS === "ios" ? { useApplicationAudioSession: iosUsesAppSession } : {}),
          onStart: () => {
            clearTimeout(timeoutId);
            finish(true);
          },
          onDone: () => {
            clearTimeout(timeoutId);
            isSpeakingRef.current = false;
            void speakNext();
          },
          onStopped: () => {
            clearTimeout(timeoutId);
            isSpeakingRef.current = false;
            void speakNext();
          },
          onError: () => {
            clearTimeout(timeoutId);
            isSpeakingRef.current = false;
            void speakNext();
            finish(false);
          },
        });
      } catch (_) {
        clearTimeout(timeoutId);
        finish(false);
      }
    });

    await ensurePlaybackAudioMode();

    const startedWithAppSession = await trySpeak(true);
    if (startedWithAppSession || Platform.OS !== "ios") {
      return startedWithAppSession;
    }

    // iOS fallback: let the system speech session manage playback.
    return trySpeak(false);
  }, [ensurePlaybackAudioMode]);

  // ─── Speech queue (TTS) with auto-restart listening ───

  const autoRestartListening = useCallback(() => {
    // Called when TTS finishes and we're in conversation mode
    if (conversationModeRef.current && !busyRef.current) {
      setTimeout(() => {
        if (conversationModeRef.current && !busyRef.current) {
          startListeningInternal();
        }
      }, 400);
    }
  }, []);

  const speakNext = useCallback(async () => {
    if (isSpeakingRef.current) return;
    const next = speechQueueRef.current.shift();
    if (!next) {
      // All speech done — auto-restart listening in conversation mode
      setVoiceStatus(conversationModeRef.current ? "Listening..." : "");
      autoRestartListening();
      return;
    }

    isSpeakingRef.current = true;
    setVoiceStatus("Speaking...");
    lastAiSpeechRef.current = next;
    const started = await speakText(next);
    if (!started) {
      isSpeakingRef.current = false;
      setVoiceStatus("Audio unavailable");
      setTimeout(() => {
        setVoiceStatus(conversationModeRef.current ? "Listening..." : "");
      }, 1200);
      autoRestartListening();
    }
  }, [speakText, autoRestartListening]);

  const queueSpeech = useCallback((text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    queuedSpeechCountRef.current += 1;
    speechQueueRef.current.push(trimmed);
    void speakNext();
  }, [speakNext]);

  const flushSpeakableText = useCallback((force = false) => {
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
  }, [queueSpeech]);

  const stopAllSpeech = useCallback(() => {
    Speech.stop();
    speechQueueRef.current = [];
    isSpeakingRef.current = false;
    pendingSpeechBufferRef.current = "";
    queuedSpeechCountRef.current = 0;
  }, []);

  const replayLastAnswer = useCallback(async () => {
    const latest = lastAiSpeechRef.current.trim();
    if (!latest || busyRef.current) return;
    stopAllSpeech();
    speechQueueRef.current = [latest];
    queuedSpeechCountRef.current = 1;
    await speakNext();
  }, [speakNext, stopAllSpeech]);

  // ─── Cleanup ───

  const cleanupRecording = useCallback(async () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (audioRecordingRef.current) {
      try {
        const status = await audioRecordingRef.current.getStatusAsync();
        if (status.isRecording || status.canRecord) {
          await audioRecordingRef.current.stopAndUnloadAsync();
        }
      } catch (_) {}
      audioRecordingRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      conversationModeRef.current = false;
      stopAllSpeech();
      cleanupRecording();
    };
  }, []);

  // ─── Add message to conversation ───

  const addMessage = useCallback((role, text) => {
    const msg = { id: Date.now().toString() + Math.random(), role, text, time: new Date() };
    setMessages(prev => [...prev, msg]);
    conversationHistoryRef.current.push({ role, text });
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    return msg;
  }, []);

  const updateLastAiMessage = useCallback((text) => {
    lastAiSpeechRef.current = text?.trim?.() || "";
    setMessages(prev => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === "ai") {
          copy[i] = { ...copy[i], text };
          break;
        }
      }
      return copy;
    });
    const hist = conversationHistoryRef.current;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i].role === "ai") { hist[i].text = text; break; }
    }
  }, []);

  // ─── Capture snapshot from camera ───

  const captureSnapshot = useCallback(async () => {
    if (!cameraRef.current || !cameraReady) return null;
    try {
      return await cameraRef.current.takePictureAsync({
        quality: 0.6, base64: true, skipProcessing: true,
      });
    } catch (e) {
      console.warn("Snapshot failed:", e?.message);
      return null;
    }
  }, [cameraReady]);

  // ─── Process voice + image and send to AI ───

  const processVoiceInput = useCallback(async (audioUri) => {
    setBusy(true);
    setVoiceStatus("Thinking...");
    stopAllSpeech();

    try {
      const snapshot = await captureSnapshot();

      let audioBase64 = null;
      if (audioUri) {
        audioBase64 = await FileSystem.readAsStringAsync(audioUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      const parts = [];
      if (snapshot?.base64) {
        parts.push({ type: "image", base64: snapshot.base64, mimeType: "image/jpeg" });
      }
      if (audioBase64) {
        parts.push({ type: "audio", base64: audioBase64, mimeType: "audio/m4a" });
      }
      parts.push({
        type: "text",
        value: "The user asked a question via voice (audio attached). Also see the camera image of what they're looking at. Answer their question.",
      });

      addMessage("user", "Voice question");
      addMessage("ai", "Thinking...");

      // Add conversation context
      const history = conversationHistoryRef.current;
      if (history.length > 2) {
        const prevExchanges = history.slice(0, -2).slice(-6);
        const contextText = "Previous conversation:\n" +
          prevExchanges.map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n") +
          "\n\nNow the user asks a new voice question (audio attached):";
        parts.push({ type: "text", value: contextText });
      }

      let fullAnswer = "";
      const loc = locationRef.current || {};
      const answerText = await askRealtimeWithImageAndVoiceStream(parts, (chunk, fullText) => {
        pendingSpeechBufferRef.current += chunk;
        flushSpeakableText(false);
        fullAnswer = fullText.trim();
        updateLastAiMessage(fullAnswer);
      }, [], { latitude: loc.latitude, longitude: loc.longitude });

      fullAnswer = answerText?.trim() || fullAnswer;
      updateLastAiMessage(fullAnswer);

      await ensurePlaybackAudioMode();
      setVoiceStatus("Speaking...");
      flushSpeakableText(true);
      if (queuedSpeechCountRef.current === 0 && fullAnswer) {
        queueSpeech(fullAnswer);
      }
    } catch (e) {
      updateLastAiMessage("Sorry, something went wrong. Try again.");
      setVoiceStatus("");
      autoRestartListening();
    } finally {
      setBusy(false);
    }
  }, [captureSnapshot, addMessage, updateLastAiMessage, stopAllSpeech, flushSpeakableText, queueSpeech, ensurePlaybackAudioMode, autoRestartListening]);

  // ─── Start listening (internal — used by conversation mode) ───

  const startListeningInternal = useCallback(async () => {
    if (busyRef.current || audioRecordingRef.current) return;

    try {
      await cleanupRecording();
      await ensureRecordingAudioMode();

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });

      // Silence detection via metering
      let silenceStart = null;
      recording.setOnRecordingStatusUpdate((status) => {
        if (!status.isRecording) return;
        const db = status.metering ?? -160;
        const elapsed = Date.now() - recordingStartTimeRef.current;

        if (db < SILENCE_THRESHOLD_DB) {
          if (!silenceStart) silenceStart = Date.now();
          const silenceDuration = Date.now() - silenceStart;
          if (silenceDuration >= SILENCE_DURATION_MS && elapsed >= MIN_RECORDING_MS) {
            // Silence detected — auto-stop
            console.log("[Voice] Silence detected, auto-stopping");
            silenceStart = null;
            void handleAutoStop(recording);
          }
        } else {
          silenceStart = null;
        }
      });
      recording.setProgressUpdateInterval(200);

      await recording.startAsync();
      recordingStartTimeRef.current = Date.now();
      audioRecordingRef.current = recording;
      setIsListening(true);
      setVoiceStatus("Listening...");
    } catch (e) {
      audioRecordingRef.current = null;
      setIsListening(false);
      console.warn("[Voice] Start failed:", e?.message);
    }
  }, [cleanupRecording, ensureRecordingAudioMode]);

  // Auto-stop handler (called by silence detection)
  const handleAutoStop = useCallback(async (recording) => {
    if (!recording) return;
    audioRecordingRef.current = null;
    setIsListening(false);

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (uri) {
        void processVoiceInput(uri);
      }
    } catch (e) {
      console.warn("[Voice] Auto-stop failed:", e?.message);
      setVoiceStatus("");
    }
  }, [processVoiceInput]);

  // ─── Manual stop (user taps button while listening) ───

  const manualStopAndAsk = useCallback(async () => {
    if (!audioRecordingRef.current) {
      setIsListening(false);
      return;
    }
    const recording = audioRecordingRef.current;
    audioRecordingRef.current = null;
    setIsListening(false);

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (uri) {
        void processVoiceInput(uri);
      }
    } catch (e) {
      console.warn("[Voice] Manual stop failed:", e?.message);
      setVoiceStatus("");
    }
  }, [processVoiceInput]);

  // ─── Toggle conversation mode ───

  const toggleConversationMode = useCallback(async () => {
    if (conversationMode) {
      // Exit conversation mode
      conversationModeRef.current = false;
      setConversationMode(false);
      setVoiceStatus("");
      stopAllSpeech();
      await cleanupRecording();
      setIsListening(false);
    } else {
      // Enter conversation mode
      const { status: perm } = await Audio.requestPermissionsAsync();
      if (perm !== "granted") {
        Alert.alert("Microphone access", "Allow microphone to ask questions by voice.");
        return;
      }
      conversationModeRef.current = true;
      setConversationMode(true);
      stopAllSpeech();
      startListeningInternal();
    }
  }, [conversationMode, stopAllSpeech, cleanupRecording, startListeningInternal]);

  // ─── Send text question (with snapshot) ───

  const sendToAI = useCallback(async (questionText, imageBase64) => {
    setBusy(true);
    setVoiceStatus("Thinking...");
    stopAllSpeech();

    addMessage("user", questionText || "What is this?");
    addMessage("ai", "Thinking...");

    try {
      const parts = [];
      if (imageBase64) {
        parts.push({ type: "image", base64: imageBase64, mimeType: "image/jpeg" });
      }

      const history = conversationHistoryRef.current;
      let contextPrompt = "";
      if (history.length > 2) {
        const prevExchanges = history.slice(0, -2).slice(-6);
        contextPrompt = "Previous conversation:\n" +
          prevExchanges.map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n") +
          "\n\nNew question: ";
      }

      const userQuestion = contextPrompt + (questionText || "What can you tell me about this item?");
      parts.push({ type: "text", value: userQuestion });

      let fullAnswer = "";
      const loc = locationRef.current || {};
      const answerText = await askRealtimeWithImageAndVoiceStream(parts, (chunk, fullText) => {
        pendingSpeechBufferRef.current += chunk;
        flushSpeakableText(false);
        fullAnswer = fullText.trim();
        updateLastAiMessage(fullAnswer);
      }, [], { latitude: loc.latitude, longitude: loc.longitude });

      fullAnswer = answerText?.trim() || fullAnswer;
      updateLastAiMessage(fullAnswer);

      await ensurePlaybackAudioMode();
      setVoiceStatus(conversationModeRef.current ? "Speaking..." : "");
      flushSpeakableText(true);
      if (queuedSpeechCountRef.current === 0 && fullAnswer) {
        queueSpeech(fullAnswer);
      }
    } catch (e) {
      updateLastAiMessage("Sorry, something went wrong. Try again.");
      setVoiceStatus("");
    } finally {
      setBusy(false);
    }
  }, [addMessage, updateLastAiMessage, stopAllSpeech, flushSpeakableText, queueSpeech, ensurePlaybackAudioMode]);

  const sendTextQuestion = useCallback(async () => {
    const q = textInput.trim();
    if (!q) return;
    setTextInput("");
    const snapshot = await captureSnapshot();
    await sendToAI(q, snapshot?.base64 || null);
  }, [textInput, captureSnapshot, sendToAI]);

  const quickAsk = useCallback(async () => {
    if (busy) return;
    const snapshot = await captureSnapshot();
    await sendToAI("What is this item? Tell me about it and if you know the price.", snapshot?.base64 || null);
  }, [busy, captureSnapshot, sendToAI]);

  // ─── End session ───

  const endSession = useCallback(() => {
    conversationModeRef.current = false;
    setConversationMode(false);
    stopAllSpeech();
    cleanupRecording();
    setSessionActive(false);
    navigation.goBack();
  }, [stopAllSpeech, cleanupRecording, navigation]);

  // ─── Render message bubble ───

  const renderMessage = useCallback(({ item }) => {
    const isUser = item.role === "user";
    return (
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
        <Text style={[styles.bubbleLabel, isUser && styles.userLabel]}>
          {isUser ? "You" : "AI"}
        </Text>
        <Text style={[styles.bubbleText, isUser && styles.userBubbleText]}>
          {item.text}
        </Text>
      </View>
    );
  }, []);

  if (!sessionActive) return null;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <AppHeader
          title="Live Assistant"
          subtitle={conversationMode
            ? "Conversation mode active — just speak naturally!"
            : "Tap the mic to start a conversation, or type below."}
          onBack={endSession}
        />
      </View>

      {/* Camera preview — always live */}
      <Pressable style={styles.cameraWrap} onPress={!busy ? quickAsk : undefined}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          animateShutter={false}
          onCameraReady={() => setCameraReady(true)}
        />
        {!cameraReady && (
          <View style={styles.cameraOverlay}>
            <ActivityIndicator color={theme.colors.accent} size="large" />
          </View>
        )}
        {/* Live indicator */}
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
        {/* Voice status badge */}
        {voiceStatus ? (
          <View style={[
            styles.statusBadge,
            voiceStatus === "Listening..." && styles.statusListening,
            voiceStatus === "Thinking..." && styles.statusThinking,
            voiceStatus === "Speaking..." && styles.statusSpeaking,
          ]}>
            <Text style={styles.statusText}>{voiceStatus}</Text>
          </View>
        ) : null}
        {/* Tap hint */}
        {messages.length === 0 && cameraReady && !conversationMode && (
          <View style={styles.tapHint}>
            <Text style={styles.tapHintText}>Tap to ask about this item</Text>
          </View>
        )}
      </Pressable>

      {/* Conversation messages */}
      <View style={styles.chatArea}>
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.chatContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />
      </View>

      {/* Input controls */}
      <View style={styles.inputBar}>
        {/* Big conversation mode mic button */}
        <Animated.View style={{ transform: [{ scale: conversationMode ? pulseAnim : 1 }] }}>
          <Pressable
            style={[
              styles.micBtn,
              conversationMode && styles.micBtnConversation,
              isListening && styles.micBtnListening,
              busy && !conversationMode && styles.btnDisabled,
            ]}
            onPress={conversationMode
              ? (isListening ? manualStopAndAsk : toggleConversationMode)
              : toggleConversationMode}
            disabled={busy && !conversationMode}
          >
            <Text style={[
              styles.micIcon,
              conversationMode && { color: "#fff" },
            ]}>
              {conversationMode
                ? (isListening ? "..." : (busy ? "AI" : "ON"))
                : "MIC"}
            </Text>
          </Pressable>
        </Animated.View>

        {/* Text input */}
        <TextInput
          style={styles.textInput}
          placeholder="Type a question..."
          placeholderTextColor={theme.colors.textMuted}
          value={textInput}
          onChangeText={setTextInput}
          onSubmitEditing={sendTextQuestion}
          editable={!busy}
          returnKeyType="send"
        />

        {/* Send button */}
        <Pressable
          style={[styles.sendBtn, (!textInput.trim() || busy) && styles.btnDisabled]}
          onPress={sendTextQuestion}
          disabled={!textInput.trim() || busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendIcon}>GO</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.secondaryBar}>
        <Pressable
          style={[styles.replayBtn, (!lastAiSpeechRef.current || busy) && styles.btnDisabled]}
          onPress={replayLastAnswer}
          disabled={!lastAiSpeechRef.current || busy}
        >
          <Text style={styles.replayBtnText}>Replay Answer</Text>
        </Pressable>
      </View>

      {/* End session button */}
      <Pressable style={styles.endBtn} onPress={endSession}>
        <Text style={styles.endBtnText}>
          {conversationMode ? "Stop Conversation" : "End Session"}
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  cameraWrap: {
    height: 200,
    marginHorizontal: 16,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: theme.colors.surface,
    borderWidth: 2,
    borderColor: "rgba(255,248,240,0.7)",
    ...theme.shadow,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  liveIndicator: {
    position: "absolute",
    top: 10,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF3B30",
    marginRight: 5,
  },
  liveText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  statusBadge: {
    position: "absolute",
    top: 10,
    right: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  statusListening: {
    backgroundColor: "rgba(255,59,48,0.85)",
  },
  statusThinking: {
    backgroundColor: "rgba(255,149,0,0.85)",
  },
  statusSpeaking: {
    backgroundColor: "rgba(52,199,89,0.85)",
  },
  statusText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  tapHint: {
    position: "absolute",
    bottom: 12,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  tapHintText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    overflow: "hidden",
  },
  chatArea: {
    flex: 1,
    marginTop: 8,
    marginHorizontal: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.softShadow,
  },
  chatContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bubble: {
    maxWidth: "85%",
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: theme.colors.accent,
  },
  aiBubble: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.surfaceMuted,
  },
  bubbleLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: theme.colors.textSoft,
    marginBottom: 2,
    textTransform: "uppercase",
  },
  userLabel: {
    color: "rgba(255,255,255,0.7)",
  },
  bubbleText: {
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
  },
  userBubbleText: {
    color: "#fff",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
  },
  secondaryBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  micBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.surface,
    borderWidth: 2,
    borderColor: theme.colors.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  micBtnConversation: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accentDark,
  },
  micBtnListening: {
    backgroundColor: theme.colors.danger,
    borderColor: theme.colors.danger,
  },
  micIcon: {
    fontSize: 13,
    fontWeight: "900",
    color: theme.colors.accent,
  },
  textInput: {
    flex: 1,
    height: 48,
    backgroundColor: theme.colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 16,
    fontSize: 15,
    color: theme.colors.text,
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.accent,
    justifyContent: "center",
    alignItems: "center",
  },
  sendIcon: {
    fontSize: 14,
    fontWeight: "900",
    color: "#fff",
  },
  replayBtn: {
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: "center",
  },
  replayBtnText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  btnDisabled: { opacity: 0.5 },
  endBtn: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  endBtnText: {
    color: theme.colors.danger,
    fontSize: 15,
    fontWeight: "700",
  },
});
