import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Keyboard,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";

import { useApp } from "../context/AppContext";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export default function LocationScreen({ navigation }) {
  const { setLocation } = useApp();
  const [step, setStep] = useState("request");
  const [loading, setLoading] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const debounceRef = useRef(null);

  /* ───────── Helper: fetch position & navigate ───────── */
  const fetchAndNavigate = useCallback(async () => {
    let coords = null;
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (loc?.coords) {
        coords = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
      }
    } catch {
      // Position fetch failed — proceed with null coords
    }
    setLocation(coords, coords ? "Current location" : "Approximate location");
    setLoading(false);
    navigation.navigate("Radius");
  }, [navigation, setLocation]);

  /* ───────── Listen for return from Settings ───────── */
  const waitingForSettings = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener("change", async (state) => {
      if (state === "active" && waitingForSettings.current) {
        waitingForSettings.current = false;
        // Re-check permission after returning from Settings
        try {
          const perm = await Location.getForegroundPermissionsAsync();
          if (perm.granted) {
            setLoading(true);
            await fetchAndNavigate();
          }
        } catch {
          // ignore
        }
      }
    });
    return () => sub.remove();
  }, [fetchAndNavigate]);

  /* ───────── Allow: request precise location ───────── */
  const requestLocation = useCallback(async () => {
    setLoading(true);

    try {
      const perm = await Location.requestForegroundPermissionsAsync();

      if (perm.granted) {
        // Permission granted → get position → navigate to Radius
        await fetchAndNavigate();
        return;
      }

      // Permission denied and can't ask again → open Settings
      if (!perm.canAskAgain) {
        setLoading(false);
        Alert.alert(
          "Location Access Required",
          "Location permission was previously denied. Please enable it in Settings to continue.",
          [
            { text: "Enter Address Instead", style: "cancel", onPress: () => setStep("denied") },
            {
              text: "Open Settings",
              onPress: () => {
                waitingForSettings.current = true;
                Linking.openSettings();
              },
            },
          ],
        );
        return;
      }

      // Permission denied but can ask again → go to manual entry
      setLoading(false);
      setStep("denied");
    } catch {
      setLoading(false);
      setStep("denied");
    }
  }, [fetchAndNavigate]);

  /* ───────── Nominatim autocomplete ───────── */
  useEffect(() => {
    if (step !== "denied") return;

    const query = manualInput.trim();
    if (query.length < 1) {
      setSuggestions([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setSuggestionsLoading(true);
      try {
        const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=6`;
        const res = await fetch(url, {
          headers: { "User-Agent": "CheckTheTag/1.0" },
        });
        const data = await res.json();
        setSuggestions(Array.isArray(data) ? data : []);
      } catch {
        setSuggestions([]);
      } finally {
        setSuggestionsLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [manualInput, step]);

  /* ───────── Select a suggestion ───────── */
  const pickSuggestion = useCallback(
    (item) => {
      Keyboard.dismiss();
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      const coords =
        !isNaN(lat) && !isNaN(lon) ? { latitude: lat, longitude: lon } : null;
      const label = item.display_name ?? "Selected location";
      setLocation(coords, label);
      navigation.navigate("Radius");
    },
    [navigation, setLocation],
  );

  /* ───────── Submit typed text (fallback) ───────── */
  const submitManual = useCallback(async () => {
    const value = manualInput.trim();
    if (!value) return;
    setLoading(true);
    try {
      // Geocode the typed address via Nominatim
      const url = `${NOMINATIM_URL}?q=${encodeURIComponent(value)}&format=json&limit=1`;
      const res = await fetch(url, {
        headers: { "User-Agent": "CheckTheTag/1.0" },
      });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const first = data[0];
        const lat = parseFloat(first.lat);
        const lon = parseFloat(first.lon);
        const coords =
          !isNaN(lat) && !isNaN(lon)
            ? { latitude: lat, longitude: lon }
            : null;
        setLocation(coords, first.display_name ?? value);
      } else {
        setLocation(null, value);
      }
      navigation.navigate("Radius");
    } catch {
      setLocation(null, value);
      navigation.navigate("Radius");
    } finally {
      setLoading(false);
    }
  }, [manualInput, navigation, setLocation]);

  /* ───────── Render: permission request ───────── */
  if (step === "request") {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.container}>
          <Text style={styles.title}>Use your location</Text>
          <Text style={styles.subtitle}>
            We use your precise location to show prices and stores near you.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
            onPress={requestLocation}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Allow</Text>
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
            onPress={() => setStep("denied")}
            disabled={loading}
          >
            <Text style={styles.secondaryBtnText}>Deny</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  /* ───────── Render: manual entry with autocomplete ───────── */
  const renderSuggestion = ({ item }) => (
    <Pressable
      style={({ pressed }) => [styles.suggestionRow, pressed && styles.suggestionPressed]}
      onPress={() => pickSuggestion(item)}
    >
      <Text style={styles.suggestionIcon}>📍</Text>
      <Text style={styles.suggestionText} numberOfLines={2}>
        {item.display_name}
      </Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.container}>
        <Text style={styles.title}>Search your address</Text>
        <Text style={styles.subtitle}>
          Start typing any address, city, or place name to find it.
        </Text>

        <View style={styles.inputWrapper}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            value={manualInput}
            onChangeText={setManualInput}
            placeholder="e.g. 123 Main St, Tokyo, London..."
            placeholderTextColor="#8A8A8A"
            style={styles.input}
            editable={!loading}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={submitManual}
          />
          {manualInput.length > 0 && (
            <Pressable
              onPress={() => {
                setManualInput("");
                setSuggestions([]);
              }}
              style={styles.clearBtn}
            >
              <Text style={styles.clearBtnText}>✕</Text>
            </Pressable>
          )}
        </View>

        {/* Suggestions list */}
        {suggestionsLoading && manualInput.trim().length > 0 && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#2B6CFF" size="small" />
            <Text style={styles.loadingText}>Searching…</Text>
          </View>
        )}

        {suggestions.length > 0 && (
          <FlatList
            data={suggestions}
            keyExtractor={(item, i) => item.place_id?.toString() ?? String(i)}
            renderItem={renderSuggestion}
            style={styles.suggestionsList}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {manualInput.trim().length > 0 &&
          !suggestionsLoading &&
          suggestions.length === 0 &&
          manualInput.trim().length >= 2 && (
            <Text style={styles.noResults}>No results found. Try a different search.</Text>
          )}

        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            !manualInput.trim() && styles.disabledBtn,
            pressed && styles.pressed,
          ]}
          onPress={submitManual}
          disabled={loading || !manualInput.trim()}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Continue</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0B0C" },
  container: { flex: 1, padding: 24, justifyContent: "center", gap: 14 },
  title: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 4,
  },
  subtitle: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 8,
  },

  /* ── Input ── */
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#141416",
    borderColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchIcon: { fontSize: 16, marginRight: 6 },
  input: {
    flex: 1,
    paddingVertical: 14,
    color: "#FFF",
    fontSize: 16,
  },
  clearBtn: {
    padding: 6,
  },
  clearBtnText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 16,
  },

  /* ── Suggestions ── */
  suggestionsList: {
    maxHeight: 260,
    borderRadius: 12,
    backgroundColor: "#141416",
    borderColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderBottomColor: "rgba(255,255,255,0.07)",
    borderBottomWidth: 1,
  },
  suggestionPressed: {
    backgroundColor: "rgba(43,108,255,0.15)",
  },
  suggestionIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  suggestionText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 15,
    flex: 1,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
  },
  loadingText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
  },
  noResults: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 8,
  },

  /* ── Buttons ── */
  primaryBtn: {
    backgroundColor: "#2B6CFF",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryBtnText: { color: "#FFF", fontSize: 17, fontWeight: "700" },
  disabledBtn: {
    opacity: 0.4,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  secondaryBtnText: { color: "rgba(255,255,255,0.9)", fontSize: 16 },
  pressed: { opacity: 0.9 },
});
