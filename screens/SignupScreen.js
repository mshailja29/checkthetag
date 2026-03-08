import React, { useState } from "react";
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

import AppHeader from "../components/AppHeader";
import { useApp } from "../context/AppContext";
import { theme } from "../theme";

export default function SignupScreen({ navigation }) {
  const { signup } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedName || !normalizedEmail || !password.trim()) {
      Alert.alert("Missing details", "Enter your name, email, and password to create an account.");
      return;
    }

    setBusy(true);
    try {
      await signup(normalizedName, normalizedEmail, password);
    } catch (e) {
      Alert.alert("Signup failed", e?.message ?? "Could not create your account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <AppHeader
            title="Create account"
            subtitle="Sign up once, keep your saved setup, and use the app with the same grocery-style interface."
            onBack={() => navigation.goBack()}
          />

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Signup</Text>

            <Text style={styles.label}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
              editable={!busy}
            />

            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              editable={!busy}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              placeholderTextColor={theme.colors.textMuted}
              secureTextEntry
              style={styles.input}
              editable={!busy}
              onSubmitEditing={submit}
            />

            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
              onPress={submit}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.white} />
              ) : (
                <Text style={styles.primaryBtnText}>Sign up</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 22,
    ...theme.shadow,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 18,
  },
  label: {
    color: theme.colors.textSoft,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  input: {
    backgroundColor: theme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: theme.colors.text,
    fontSize: 16,
    marginBottom: 14,
  },
  primaryBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 6,
    ...theme.softShadow,
  },
  primaryBtnText: {
    color: theme.colors.white,
    fontSize: 16,
    fontWeight: "800",
  },
  pressed: { opacity: 0.92 },
});
