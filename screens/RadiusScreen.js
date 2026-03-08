import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useApp } from "../context/AppContext";

const RADIUS_OPTIONS = [
  { label: "0.5 – 2 miles", value: 2 },
  { label: "2 – 5 miles", value: 5 },
  { label: "5 – 10 miles", value: 10 },
  { label: "10+ miles", value: 25 },
];

export default function RadiusScreen({ navigation }) {
  const { setRadius, locationLabel } = useApp();

  const onSelect = useCallback(
    (miles) => {
      setRadius(miles);
      navigation.navigate("Home");
    },
    [navigation, setRadius]
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
      </View>
      <View style={styles.container}>
        <Text style={styles.title}>How far will you shop?</Text>
        <Text style={styles.subtitle}>
          How much radius from your current location are you willing to shop?
        </Text>
        {locationLabel ? (
          <Text style={styles.locationLabel}>Location: {locationLabel}</Text>
        ) : null}
        <View style={styles.options}>
          {RADIUS_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
              onPress={() => onSelect(opt.value)}
            >
              <Text style={styles.optionText}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0B0C" },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  backBtn: { alignSelf: "flex-start" },
  backText: { color: "#2B6CFF", fontSize: 16 },
  container: { flex: 1, padding: 24, paddingTop: 16 },
  title: { color: "#FFFFFF", fontSize: 26, fontWeight: "800", textAlign: "center", marginBottom: 8 },
  subtitle: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 24,
  },
  locationLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 32,
  },
  options: { gap: 14 },
  option: {
    backgroundColor: "#141416",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  optionText: { color: "#FFF", fontSize: 17, fontWeight: "600", textAlign: "center" },
  pressed: { opacity: 0.9, backgroundColor: "#1a1a1c" },
});
