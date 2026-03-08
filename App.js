import React, { useEffect } from "react";
import { Alert } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { AppProvider } from "./context/AppContext";
import { initDb } from "./database";
import HomeScreen from "./screens/HomeScreen";
import LocationScreen from "./screens/LocationScreen";
import RadiusScreen from "./screens/RadiusScreen";
import AddPricesScreen from "./screens/AddPricesScreen";
import CheckPricesScreen from "./screens/CheckPricesScreen";
import RealtimeAskScreen from "./screens/RealtimeAskScreen";

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
    <AppProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Location"
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#0B0B0C" },
            animation: "slide_from_right",
          }}
        >
          <Stack.Screen name="Location" component={LocationScreen} />
          <Stack.Screen name="Radius" component={RadiusScreen} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="AddPrices" component={AddPricesScreen} />
          <Stack.Screen name="CheckPrices" component={CheckPricesScreen} />
          <Stack.Screen name="RealtimeAsk" component={RealtimeAskScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </AppProvider>
  );
}
