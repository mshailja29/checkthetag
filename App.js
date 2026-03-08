import React, { useEffect } from "react";
import { Alert } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { initDb } from "./database";
import HomeScreen from "./screens/HomeScreen";
import AddPricesScreen from "./screens/AddPricesScreen";
import CheckPricesScreen from "./screens/CheckPricesScreen";

const Stack = createNativeStackNavigator();

export default function App() {
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await initDb();
      } catch (e) {
        if (mounted) Alert.alert("Database error", e?.message ?? String(e));
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#0B0B0C" },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="AddPrices" component={AddPricesScreen} />
        <Stack.Screen name="CheckPrices" component={CheckPricesScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
