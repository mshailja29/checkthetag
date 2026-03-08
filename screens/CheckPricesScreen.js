import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { queryPricesWithAi } from "../gemini";
import { searchPrices } from "../database";

const FOLLOW_UPS = {
  cheaper: "From the data below, list items that have a cheaper price at another store. For each item show: item name, current price, cheaper price, and store name. Format clearly.",
  stores: "From the data below, list all unique stores (storeName) we have, and for each store list the items and prices we have. Format as a clear list.",
  brand: "From the data below, filter and show only items from the brand the user asked for. If no brand was specified, list all unique brands in the data and ask the user to pick one. Format as a clear list.",
};

export default function CheckPricesScreen({ navigation }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState("");
  const [dataSet, setDataSet] = useState([]);
  const [busy, setBusy] = useState(false);
  const [followUp, setFollowUp] = useState(null);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    setBusy(true);
    setResults("");
    setFollowUp(null);
    try {
      const rows = await searchPrices(q);
      setDataSet(rows);
      if (rows.length === 0) {
        setResults("No prices in the database yet. Add prices from the home screen to see results here.");
        return;
      }
      const question = q
        ? `The user searched for: "${q}". Show relevant products from the database (item, brand, price, weight, store). Be concise.`
        : "Show all products in the database (item, brand, price, weight, store). Be concise.";
      const answer = await queryPricesWithAi(question, rows);
      setResults(answer);
    } catch (e) {
      Alert.alert("Error", e?.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, [query]);

  const runFollowUp = useCallback(async (key) => {
    if (dataSet.length === 0) {
      setResults("No data to search. Run a search first.");
      return;
    }
    setFollowUp(key);
    setBusy(true);
    try {
      let question = FOLLOW_UPS[key];
      if (key === "brand") {
        const brandQuery = query.trim();
        question = brandQuery
          ? `From the data below, filter and show only items from the brand "${brandQuery}". Format as a clear list. If that brand is not in the data, list similar brands we have.`
          : "From the data below, list all unique brands we have. Then suggest the user to type a brand name in the search box and tap this again.";
      }
      const answer = await queryPricesWithAi(question, dataSet);
      setResults(answer);
    } catch (e) {
      Alert.alert("Error", e?.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
      setFollowUp(null);
    }
  }, [dataSet, query]);

  const runCheaper = useCallback(() => runFollowUp("cheaper"), [runFollowUp]);
  const runStores = useCallback(() => runFollowUp("stores"), [runFollowUp]);
  const runBrand = useCallback(() => runFollowUp("brand"), [runFollowUp]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
          <Text style={styles.title}>Check latest prices</Text>
        </View>

        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search product, store, or brand..."
            placeholderTextColor="#8A8A8A"
            style={styles.input}
            editable={!busy}
            onSubmitEditing={runSearch}
            returnKeyType="search"
          />
          <Pressable
            style={[styles.searchBtn, busy && styles.searchBtnDisabled]}
            onPress={runSearch}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.searchBtnText}>Search</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {results ? (
            <View style={styles.resultBox}>
              <Text style={styles.resultLabel}>Results</Text>
              <Text style={styles.resultText}>{results}</Text>
            </View>
          ) : null}

          {dataSet.length > 0 && !busy && (
            <View style={styles.followUpSection}>
              <Text style={styles.followUpTitle}>What next?</Text>
              <Pressable
                style={({ pressed }) => [styles.followUpBtn, pressed && styles.pressed]}
                onPress={runCheaper}
              >
                <Text style={styles.followUpBtnText}>Show cheaper items</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.followUpBtn, pressed && styles.pressed]}
                onPress={runStores}
              >
                <Text style={styles.followUpBtnText}>Find stores in database</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.followUpBtn, pressed && styles.pressed]}
                onPress={runBrand}
              >
                <Text style={styles.followUpBtnText}>Search by brand</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0B0C" },
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  backBtn: { marginBottom: 8 },
  backText: { color: "#2B6CFF", fontSize: 16 },
  title: { color: "#FFF", fontSize: 24, fontWeight: "700" },
  searchRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    backgroundColor: "#141416",
    borderColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#FFF",
    fontSize: 16,
  },
  searchBtn: {
    backgroundColor: "#2B6CFF",
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: "center",
    minWidth: 80,
  },
  searchBtnDisabled: { opacity: 0.6 },
  searchBtnText: { color: "#FFF", fontWeight: "700" },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  resultBox: {
    backgroundColor: "#141416",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  resultLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginBottom: 8 },
  resultText: { color: "#FFF", fontSize: 15, lineHeight: 22 },
  followUpSection: { gap: 10 },
  followUpTitle: { color: "rgba(255,255,255,0.9)", fontSize: 16, fontWeight: "600", marginBottom: 4 },
  followUpBtn: {
    backgroundColor: "#1a1a1c",
    borderColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  followUpBtnText: { color: "#FFF", fontSize: 15 },
  pressed: { opacity: 0.9 },
});
