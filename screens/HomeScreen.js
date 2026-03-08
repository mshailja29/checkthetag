import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function HomeScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
      </View>
      <View style={styles.container}>
        <Text style={styles.title}>Check the Tag</Text>
        <Text style={styles.subtitle}>Compare prices and ask about any item in real time</Text>

        <Pressable
          style={({ pressed }) => [styles.card, styles.cardPrimary, pressed && styles.pressed]}
          onPress={() => navigation.navigate("AddPrices")}
        >
          <Text style={styles.cardTitle}>Add a product price</Text>
          <Text style={styles.cardDesc}>Send receipt or tag via text, image, video, or audio to save prices</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, styles.cardSecondary, pressed && styles.pressed]}
          onPress={() => navigation.navigate("RealtimeAsk")}
        >
          <Text style={styles.cardTitle}>Ask questions realtime about any item</Text>
          <Text style={styles.cardDesc}>Scan an item with your camera, ask aloud—get spoken answers, alternatives, or cheaper nearby prices</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0B0C" },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  backBtn: { alignSelf: "flex-start", marginBottom: 8 },
  backText: { color: "#2B6CFF", fontSize: 16 },
  container: { flex: 1, padding: 24, justifyContent: "center", gap: 20 },
  title: { color: "#FFFFFF", fontSize: 32, fontWeight: "800", textAlign: "center", marginBottom: 4 },
  subtitle: { color: "rgba(255,255,255,0.65)", fontSize: 16, textAlign: "center", marginBottom: 32 },
  card: {
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
  },
  cardPrimary: {
    backgroundColor: "#2B6CFF",
    borderColor: "rgba(255,255,255,0.2)",
  },
  cardSecondary: {
    backgroundColor: "#141416",
    borderColor: "rgba(255,255,255,0.12)",
  },
  pressed: { opacity: 0.9 },
  cardTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "700", marginBottom: 8 },
  cardDesc: { color: "rgba(255,255,255,0.85)", fontSize: 14, lineHeight: 20 },
});
