"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { DEFAULT_DESTINATION, getDestination, type CountryCode } from "@/lib/destinations";

type State = { countryCode: CountryCode; cityId: string };
type Value = State & {
  country: ReturnType<typeof getDestination>["country"];
  city: ReturnType<typeof getDestination>["city"];
  calculationReady: boolean;
  setDestination: (countryCode: CountryCode, cityId?: string) => void;
};

const STORAGE_KEY = "tl-auto-destination-v1";
const Context = createContext<Value | null>(null);

function readState(): State {
  const params = new URLSearchParams(window.location.search);
  const countryCode = params.get("country") as CountryCode | null;
  const cityId = params.get("city");
  if (countryCode && cityId) return { countryCode, cityId };
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as State | null;
    if (stored?.countryCode && stored.cityId) return stored;
  } catch {
    // Use the default when storage is unavailable or invalid.
  }
  return DEFAULT_DESTINATION;
}

export function DestinationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>(() => typeof window === "undefined" ? DEFAULT_DESTINATION : readState());

  const value = useMemo<Value>(() => {
    const resolved = getDestination(state.countryCode, state.cityId);
    return {
      ...state,
      country: resolved.country,
      city: resolved.city,
      calculationReady: state.countryCode === "RU" && resolved.city.id === "vladivostok",
      setDestination: (countryCode, cityId) => {
        const resolvedNext = getDestination(countryCode, cityId);
        const next = { countryCode: resolvedNext.country.countryCode, cityId: resolvedNext.city.id };
        setState(next);
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* optional persistence */ }
        const url = new URL(window.location.href);
        url.searchParams.set("country", next.countryCode);
        url.searchParams.set("city", next.cityId);
        window.history.replaceState({}, "", url);
      },
    };
  }, [state]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDestination() {
  const value = useContext(Context);
  if (!value) throw new Error("useDestination must be used inside DestinationProvider");
  return value;
}
