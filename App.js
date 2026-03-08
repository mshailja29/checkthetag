import React from "react";
import { ActivityIndicator, StatusBar, StyleSheet, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { AppProvider, useApp } from "./context/AppContext";
import HomeScreen from "./screens/HomeScreen";
import LocationScreen from "./screens/LocationScreen";
import RadiusScreen from "./screens/RadiusScreen";
import AddPricesScreen from "./screens/AddPricesScreen";
import CheckPricesScreen from "./screens/CheckPricesScreen";
import RealtimeAskScreen from "./screens/RealtimeAskScreen";
import LoginScreen from "./screens/LoginScreen";
import SignupScreen from "./screens/SignupScreen";
import { theme } from "./theme";

const Stack = createNativeStackNavigator();

function AppNavigator() {
  const { bootstrapped, isAuthenticated, locationCompleted, radiusCompleted } = useApp();

  if (!bootstrapped) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={theme.colors.white} />
      </View>
    );
  }

  const initialRouteName = !isAuthenticated
    ? "Login"
    : !locationCompleted
      ? "Location"
      : !radiusCompleted
        ? "Radius"
        : "Home";

  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.background} />
      <Stack.Navigator
        key={`${isAuthenticated}-${locationCompleted}-${radiusCompleted}`}
        initialRouteName={initialRouteName}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: "slide_from_right",
        }}
      >
        {!isAuthenticated ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Signup" component={SignupScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Location" component={LocationScreen} />
            <Stack.Screen name="Radius" component={RadiusScreen} />
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="AddPrices" component={AddPricesScreen} />
            <Stack.Screen name="CheckPrices" component={CheckPricesScreen} />
            <Stack.Screen name="RealtimeAsk" component={RealtimeAskScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppNavigator />
    </AppProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
});
