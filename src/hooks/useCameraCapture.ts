"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Rear-camera capture for reading the ORIGINAL SUPPLIER LABEL on a tyre.
 *
 * Notes that matter in practice:
 *   * `facingMode: "environment"` requests the rear camera, which is the one
 *     pointed at the product. It is a hint, not a guarantee, so we don't fail
 *     if a device only has one camera.
 *   * getUserMedia requires a secure context (https, or localhost). On plain
 *     http over a LAN the API is simply absent — that is reported as
 *     CAMERA_UNAVAILABLE rather than silently doing nothing.
 *   * The stream is always stopped on unmount; leaving it running keeps the
 *     phone's camera light on and drains the battery.
 */

export type CameraError = "CAMERA_UNAVAILABLE" | "CAMERA_DENIED" | null;

export function useCameraCapture() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<CameraError>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("CAMERA_UNAVAILABLE");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // iOS needs playsInline (set on the element) plus an explicit play().
        await videoRef.current.play().catch(() => undefined);
      }
      setActive(true);
      return true;
    } catch (cause) {
      const name = (cause as { name?: string })?.name;
      setError(name === "NotAllowedError" || name === "SecurityError" ? "CAMERA_DENIED" : "CAMERA_UNAVAILABLE");
      return false;
    }
  }, []);

  /**
   * Grabs the current frame as a JPEG data URL. Downscaled to at most 1600px on
   * the long edge: label text stays legible, and the upload stays small enough
   * to send over a warehouse's patchy connection.
   */
  const capture = useCallback((maxEdge = 1600): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;

    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", 0.85);
  }, []);

  useEffect(() => stop, [stop]);

  return { videoRef, active, error, start, stop, capture };
}
