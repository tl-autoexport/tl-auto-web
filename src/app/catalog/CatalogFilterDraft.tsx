"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
export const IDENTITY_KEYS = ["brand", "model", "generation", "modification", "trim"] as const;
export type IdentitySelection = Partial<Record<typeof IDENTITY_KEYS[number], string>>;
const Context = createContext<{ identity: IdentitySelection; setIdentity: (value: IdentitySelection) => void; parameters: string; setParameters: (value: string) => void } | null>(null);
export function CatalogFilterDraft({ currentQuery, children }: { currentQuery: string; children: ReactNode }) {
 const params = new URLSearchParams(currentQuery);
 const [identity,setIdentity] = useState<IdentitySelection>(()=>Object.fromEntries(IDENTITY_KEYS.map(key=>[key,params.get(key)||undefined])));
 const [parameters,setParameters] = useState(currentQuery);
 return <Context.Provider value={{identity,setIdentity,parameters,setParameters}}>{children}</Context.Provider>;
}
export function useCatalogFilterDraft(){return useContext(Context);}
