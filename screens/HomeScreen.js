import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AppHeader from "../components/AppHeader";
import { theme } from "../theme";

export default function HomeScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.container}>
        <AppHeader
          title="Check the Tag"
          subtitle="Compare prices and ask about any item in real time."
          onBack={() => navigation.goBack()}
        />

        <Pressable
          style={({ pressed }) => [styles.card, styles.cardPrimary, pressed && styles.pressed]}
          onPress={() => navigation.navigate("AddPrices")}
        >
          <Text style={styles.cardEyebrow}>Quick add</Text>
          <Text style={styles.cardTitle}>Add a product price</Text>
          <Text style={styles.cardDesc}>
            Send receipt or tag via text, image, video, or audio to save prices.
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, styles.cardSecondary, pressed && styles.pressed]}
          onPress={() => navigation.navigate("RealtimeAsk")}
        >
          <Text style={styles.cardEyebrow}>Live help</Text>
          <Text style={styles.cardTitle}>Ask questions realtime about any item</Text>
          <Text style={styles.cardDesc}>
            Scan an item with your camera, ask aloud, and get spoken answers, alternatives,
            or cheaper nearby prices.
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  container: { flex: 1, padding: 24, paddingTop: 20, justifyContent: "center", gap: 18 },
  card: {
    borderRadius: theme.radius.xl,
    padding: 24,
    borderWidth: 1,
    minHeight: 178,
    justifyContent: "space-between",
    ...theme.shadow,
  },
  cardPrimary: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  },
  cardSecondary: {
    backgroundColor: theme.colors.surfaceStrong,
    borderColor: theme.colors.border,
  },
  cardEyebrow: {
    color: theme.colors.accentDark,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  pressed: { opacity: 0.92 },
  cardTitle: { color: theme.colors.text, fontSize: 24, fontWeight: "800", marginBottom: 10 },
  cardDesc: { color: theme.colors.textSoft, fontSize: 15, lineHeight: 22 },
});
