"use client";

import Image, { type ImageProps } from "next/image";
import { useState, type ReactNode, type SyntheticEvent } from "react";

type RemoteImageProps = ImageProps & { fallback?: ReactNode };

/** Serve source-hosted vehicle photos directly and avoid Vercel transformations. */
export function RemoteImage({ alt, fallback, onError, ...props }: RemoteImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#e9edf3] px-3 text-center text-xs font-medium text-[#647084]">
        {fallback ?? "Фото временно недоступно"}
      </div>
    );
  }

  return (
    <Image
      {...props}
      alt={alt}
      unoptimized
      onError={(event: SyntheticEvent<HTMLImageElement, Event>) => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );
}
