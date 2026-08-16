"use client";

import { useEffect, useRef, useState } from "react";

export function AutoPlayInspectionVideo({
  poster,
  src,
}: {
  poster: string | null;
  src: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setActivated(true);
        observer.disconnect();
      },
      { rootMargin: "240px 0px", threshold: 0.1 },
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activated) return;
    video.play().catch(() => {
      // Mobile browsers may still require an explicit user gesture.
    });
  }, [activated]);

  return (
    <video
      className="h-full w-full object-cover"
      loop
      muted
      playsInline
      poster={activated ? (poster ?? undefined) : undefined}
      preload="none"
      ref={videoRef}
      src={activated ? src : undefined}
    />
  );
}
