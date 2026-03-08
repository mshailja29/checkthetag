import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";

import {
  getUserBootstrapState,
  getUserSettingKey,
  initDb,
  setSetting,
} from "../database";
import {
  getCurrentUserApi,
  loginApi,
  setAuthToken,
  signupApi,
} from "../apiClient";

const AppContext = createContext(null);
const TOKEN_KEY = "check-the-tag-auth-token";

export function AppProvider({ children }) {
  const [location, setLocationState] = useState(null);
  const [locationLabel, setLocationLabel] = useState(null);
  const [radiusMiles, setRadiusMilesState] = useState(null);
  const [locationCompleted, setLocationCompleted] = useState(false);
  const [radiusCompleted, setRadiusCompleted] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [authToken, setAuthTokenState] = useState(null);
  const [user, setUser] = useState(null);
  const [bootstrapped, setBootstrapped] = useState(false);

  const applyOnboardingState = useCallback((state) => {
    setLocationState(state.location ?? null);
    setLocationLabel(state.locationLabel ?? null);
    setRadiusMilesState(state.radiusMiles ?? null);
    setLocationCompleted(Boolean(state.locationCompleted));
    setRadiusCompleted(Boolean(state.radiusCompleted));
    setOnboardingComplete(Boolean(state.onboardingComplete));
  }, []);

  const resetOnboardingState = useCallback(() => {
    setLocationState(null);
    setLocationLabel(null);
    setRadiusMilesState(null);
    setLocationCompleted(false);
    setRadiusCompleted(false);
    setOnboardingComplete(false);
  }, []);

  const hydrateUserOnboarding = useCallback(
    async (userId) => {
      const state = await getUserBootstrapState(userId);
      applyOnboardingState(state);
      return state;
    },
    [applyOnboardingState]
  );

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        await initDb();
        const storedToken = await SecureStore.getItemAsync(TOKEN_KEY);

        if (!active) return;
        resetOnboardingState();

        if (storedToken) {
          try {
            setAuthToken(storedToken);
            const me = await getCurrentUserApi();
            if (!active) return;
            setAuthTokenState(storedToken);
            setUser(me.user ?? null);
            await hydrateUserOnboarding(me.user?.id);
          } catch {
            setAuthToken(null);
            await SecureStore.deleteItemAsync(TOKEN_KEY);
            if (!active) return;
            setAuthTokenState(null);
            setUser(null);
            resetOnboardingState();
          }
        }
      } finally {
        if (active) setBootstrapped(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [hydrateUserOnboarding, resetOnboardingState]);

  const setLocation = useCallback(async (coords, label) => {
    if (!user?.id) throw new Error("You must be logged in to save a location.");
    const nextLabel =
      label ?? (coords ? `${coords.latitude?.toFixed(4)}, ${coords.longitude?.toFixed(4)}` : null);
    setLocationState(coords);
    setLocationLabel(nextLabel);
    setLocationCompleted(true);
    await Promise.all([
      setSetting(getUserSettingKey(user.id, "location"), coords ?? null),
      setSetting(getUserSettingKey(user.id, "locationLabel"), nextLabel ?? null),
      setSetting(getUserSettingKey(user.id, "locationCompleted"), true),
    ]);
  }, [user]);

  const setRadius = useCallback(async (miles) => {
    if (!user?.id) throw new Error("You must be logged in to save a radius.");
    setRadiusMilesState(miles);
    setRadiusCompleted(true);
    setOnboardingComplete(true);
    await Promise.all([
      setSetting(getUserSettingKey(user.id, "radiusMiles"), miles),
      setSetting(getUserSettingKey(user.id, "radiusCompleted"), true),
      setSetting(getUserSettingKey(user.id, "onboardingComplete"), true),
    ]);
  }, [user]);

  const setLocationFlowDone = useCallback(async () => {
    setLocationCompleted(true);
    if (user?.id) {
      await setSetting(getUserSettingKey(user.id, "locationCompleted"), true);
    }
  }, [user]);

  const completeAuth = useCallback(async (authResponse) => {
    const token = authResponse?.token;
    const nextUser = authResponse?.user ?? null;
    if (!token) throw new Error("Missing auth token.");

    setAuthToken(token);
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setAuthTokenState(token);
    setUser(nextUser);
    await hydrateUserOnboarding(nextUser?.id);
  }, []);

  const login = useCallback(
    async (email, password) => {
      const authResponse = await loginApi({ email, password });
      await completeAuth(authResponse);
      return authResponse;
    },
    [completeAuth]
  );

  const signup = useCallback(
    async (name, email, password) => {
      const authResponse = await signupApi({ name, email, password });
      await completeAuth(authResponse);
      return authResponse;
    },
    [completeAuth]
  );

  const logout = useCallback(async () => {
    setAuthToken(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setAuthTokenState(null);
    setUser(null);
    resetOnboardingState();
  }, [resetOnboardingState]);

  const resetOnboarding = useCallback(async () => {
    resetOnboardingState();
    if (user?.id) {
      await Promise.all([
        setSetting(getUserSettingKey(user.id, "location"), null),
        setSetting(getUserSettingKey(user.id, "locationLabel"), null),
        setSetting(getUserSettingKey(user.id, "radiusMiles"), null),
        setSetting(getUserSettingKey(user.id, "locationCompleted"), false),
        setSetting(getUserSettingKey(user.id, "radiusCompleted"), false),
        setSetting(getUserSettingKey(user.id, "onboardingComplete"), false),
      ]);
    }
  }, [resetOnboardingState, user]);

  const value = useMemo(
    () => ({
      location,
      locationLabel,
      radiusMiles,
      locationCompleted,
      radiusCompleted,
      onboardingComplete,
      authToken,
      user,
      isAuthenticated: Boolean(authToken && user),
      bootstrapped,
      setLocation,
      setLocationLabel,
      setRadius,
      setLocationFlowDone,
      login,
      signup,
      logout,
      resetOnboarding,
    }),
    [
      location,
      locationLabel,
      radiusMiles,
      locationCompleted,
      radiusCompleted,
      onboardingComplete,
      authToken,
      user,
      bootstrapped,
      setLocation,
      setRadius,
      setLocationFlowDone,
      login,
      signup,
      logout,
      resetOnboarding,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
