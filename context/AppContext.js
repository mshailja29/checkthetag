import React, { createContext, useContext, useState, useCallback } from "react";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [location, setLocationState] = useState(null);
  const [locationLabel, setLocationLabel] = useState(null);
  const [radiusMiles, setRadiusMilesState] = useState(null);
  const [locationCompleted, setLocationCompleted] = useState(false);
  const [radiusCompleted, setRadiusCompleted] = useState(false);

  const setLocation = useCallback((coords, label) => {
    setLocationState(coords);
    setLocationLabel(label ?? (coords ? `${coords.latitude?.toFixed(4)}, ${coords.longitude?.toFixed(4)}` : null));
  }, []);

  const setRadius = useCallback((miles) => {
    setRadiusMilesState(miles);
    setRadiusCompleted(true);
  }, []);

  const setLocationFlowDone = useCallback(() => {
    setLocationCompleted(true);
  }, []);

  const value = {
    location,
    locationLabel,
    radiusMiles,
    locationCompleted,
    radiusCompleted,
    setLocation,
    setLocationLabel,
    setRadius,
    setLocationFlowDone,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
