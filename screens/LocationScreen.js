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

import AppHeader from "../components/AppHeader";
import { useApp } from "../context/AppContext";
import { theme } from "../theme";

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
          <AppHeader
            title="Use your location"
            subtitle="We use your precise location to show prices and stores near you."
          />

          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>Fresh prices nearby</Text>
            </View>
            <Text style={styles.heroTitle}>Find the best deals around you faster.</Text>
            <Text style={styles.heroText}>
              Allow location access or enter an address manually. Your shopping flow stays
              exactly the same.
            </Text>

            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
              onPress={requestLocation}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={theme.colors.white} />
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
        <AppHeader
          title="Search your address"
          subtitle="Start typing any address, city, or place name to find it."
          onBack={() => {
            setStep("request");
            setManualInput("");
            setSuggestions([]);
          }}
        />

        <View style={styles.manualCard}>
          <View style={styles.searchPill}>
            <Text style={styles.searchPillText}>Address lookup</Text>
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              value={manualInput}
              onChangeText={setManualInput}
              placeholder="e.g. 123 Main St, Tokyo, London..."
              placeholderTextColor={theme.colors.textMuted}
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

          {suggestionsLoading && manualInput.trim().length > 0 && (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={theme.colors.accentDark} size="small" />
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
              <ActivityIndicator color={theme.colors.white} />
            ) : (
              <Text style={styles.primaryBtnText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
    justifyContent: "center",
  },
  heroCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 14,
    ...theme.shadow,
  },
  heroBadge: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  heroBadgeText: {
    color: theme.colors.accentDark,
    fontSize: 12,
    fontWeight: "700",
  },
  heroTitle: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 33,
  },
  heroText: {
    color: theme.colors.textSoft,
    fontSize: 15,
    lineHeight: 22,
  },
  manualCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },
  searchPill: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
  },
  searchPillText: {
    color: theme.colors.textSoft,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surfaceStrong,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  searchIcon: {
    fontSize: 18,
    marginRight: 8,
    color: theme.colors.textSoft,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    color: theme.colors.text,
    fontSize: 16,
  },
  clearBtn: {
    padding: 6,
  },
  clearBtnText: {
    color: theme.colors.textMuted,
    fontSize: 16,
  },
  suggestionsList: {
    maxHeight: 260,
    borderRadius: 22,
    backgroundColor: theme.colors.surfaceStrong,
    borderColor: theme.colors.border,
    borderWidth: 1,
    marginBottom: 16,
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderBottomColor: "#F6DDCF",
    borderBottomWidth: 1,
  },
  suggestionPressed: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  suggestionIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  suggestionText: {
    color: theme.colors.text,
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
    color: theme.colors.textSoft,
    fontSize: 14,
  },
  noResults: {
    color: theme.colors.textSoft,
    fontSize: 14,
    textAlign: "center",
    paddingTop: 6,
    paddingBottom: 16,
  },
  primaryBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
    ...theme.softShadow,
  },
  primaryBtnText: { color: theme.colors.white, fontSize: 17, fontWeight: "800" },
  disabledBtn: {
    opacity: 0.4,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceStrong,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
  },
  secondaryBtnText: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  pressed: { opacity: 0.9 },
});
