import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function HomeScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.container}>
        <Text style={styles.title}>Check the Tag</Text>
        <Text style={styles.subtitle}>Compare prices and add new ones</Text>

        <Pressable
          style={({ pressed }) => [styles.card, styles.cardPrimary, pressed && styles.pressed]}
          onPress={() => navigation.navigate("CheckPrices")}
        >
          <Text style={styles.cardTitle}>Check latest prices</Text>
          <Text style={styles.cardDesc}>Search by product, store, or brand and see AI-powered results</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, styles.cardSecondary, pressed && styles.pressed]}
          onPress={() => navigation.navigate("AddPrices")}
        >
          <Text style={styles.cardTitle}>Add new prices</Text>
          <Text style={styles.cardDesc}>Send receipt or tag via text, image, video, or audio</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0B0C" },
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
