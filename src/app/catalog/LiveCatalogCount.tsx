"use client";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { IDENTITY_KEYS, useCatalogFilterDraft } from "./CatalogFilterDraft";
import { catalogRead } from "@/lib/catalog-client-read";
export function LiveCatalogCount({ initialCount, mobile = false }: { initialCount: number; mobile?: boolean }) {
 const buttonRef=useRef<HTMLButtonElement>(null);
 const draft=useCatalogFilterDraft();
 const [formQuery,setFormQuery]=useState<string|null>(null);
 const [resolved,setResolved]=useState<{query:string;count:number}|null>(null);
 const [failed,setFailed]=useState<string|null>(null);
 const identity=draft?.identity;
 const query=new URLSearchParams(formQuery ?? draft?.parameters ?? "");
 if(identity) for(const key of IDENTITY_KEYS){query.delete(key);if(identity[key])query.set(key,identity[key]!);}
 query.delete("sort");
 const text=query.toString();
 useEffect(()=>{
  const form=buttonRef.current?.form;if(!form)return;
  const update=()=>{const p=new URLSearchParams(new FormData(form) as never);setFormQuery(p.toString());draft?.setParameters(p.toString());};
  update();form.addEventListener("input",update);form.addEventListener("change",update);
  return()=>{form.removeEventListener("input",update);form.removeEventListener("change",update);};
 // Context identity changes do not replace the form's parameter subscription.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{
  const controller=new AbortController();
  const timer=setTimeout(async()=>{try{
   const payload=await catalogRead<{count:number}>(`/api/catalog/count?${text}`);if(typeof payload.count!=="number")throw new Error("count");
   if(!controller.signal.aborted){setResolved({query:text,count:payload.count});setFailed(null);}
  }catch{if(!controller.signal.aborted)setFailed(text);}},200);
  return()=>{clearTimeout(timer);controller.abort();};
 },[text]);
 const loading=resolved?.query!==text;
 return <>
 {identity ? IDENTITY_KEYS.map(key=><input key={key} name={key} type="hidden" value={identity[key]??""} />) : null}
 <button ref={buttonRef} disabled={loading||failed===text} className={mobile?"flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#c7a55a] text-sm font-semibold text-[#15130f] disabled:opacity-60":"inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#c7a55a] px-6 text-sm font-semibold text-[#15130f] disabled:opacity-60"} type="submit"><Search size={17}/>{failed===text?"Не удалось пересчитать":loading?"Пересчитываем…":`Показать ${resolved?.count??initialCount}${mobile?" автомобилей":""}`}</button>
 </>;
}
