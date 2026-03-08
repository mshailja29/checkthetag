import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "../theme";

export default function AppHeader({
  title,
  subtitle,
  onBack,
  backLabel = "Back",
}) {
  return (
    <View style={styles.wrapper}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
        >
          <Text style={styles.backArrow}>‹</Text>
          <Text style={styles.backText}>{backLabel}</Text>
        </Pressable>
      ) : null}

      <View style={styles.titleWrap}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 20,
  },
  backBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 18,
    ...theme.softShadow,
  },
  backBtnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  backArrow: {
    color: theme.colors.text,
    fontSize: 20,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: -1,
  },
  backText: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  titleWrap: {
    gap: 8,
  },
  title: {
    color: theme.colors.white,
    fontSize: 31,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  subtitle: {
    color: "rgba(255,248,240,0.9)",
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 440,
  },
});
