import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AppHeader from "../components/AppHeader";
import { useApp } from "../context/AppContext";
import { theme } from "../theme";

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
      <View style={styles.container}>
        <AppHeader
          title="How far will you shop?"
          subtitle="How much radius from your current location are you willing to shop?"
          onBack={() => navigation.goBack()}
        />

        <View style={styles.panel}>
          {locationLabel ? (
            <View style={styles.locationPill}>
              <Text style={styles.locationLabel}>Location: {locationLabel}</Text>
            </View>
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  container: { flex: 1, padding: 24, paddingTop: 20 },
  panel: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 22,
    ...theme.shadow,
  },
  locationPill: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginBottom: 22,
  },
  locationLabel: {
    color: theme.colors.textSoft,
    fontSize: 13,
    fontWeight: "700",
  },
  options: { gap: 14 },
  option: {
    backgroundColor: theme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 20,
    ...theme.softShadow,
  },
  optionText: { color: theme.colors.text, fontSize: 17, fontWeight: "800", textAlign: "center" },
  pressed: { opacity: 0.92, backgroundColor: theme.colors.surfaceMuted },
});
