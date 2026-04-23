// ═══════════════════════════════════════════════════════════════
// SOSphere — Contextual Avatar Edit Sheet
// ───────────────────────────────────────────────────────────────
// Opens from ANYWHERE the user's avatar is shown (Home header,
// Profile screen, Family Circle self card). Writes through
// civilian-store so every other screen updates instantly.
//
// On Android/Capacitor: uses @capacitor/camera plugin for native
// camera + gallery pickers. On web: falls back to <input type="file">.
// Uploaded photos are resized to 256x256 before storage.
// ═══════════════════════════════════════════════════════════════

import { useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Camera, Image as ImageIcon, Type, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { useProfile } from "./civilian-store";

interface AvatarEditSheetProps {
  open: boolean;
  onClose: () => void;
}

// ── Resize helper (canvas → 256x256 center-crop → data URL) ──
function resizeImageToDataUrl(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image"));
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("Canvas not supported"));
          const srcSize = Math.min(img.width, img.height);
          const sx = (img.width - srcSize) / 2;
          const sy = (img.height - srcSize) / 2;
          ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, size, size);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        } catch (e) { reject(e); }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function resizeDataUrl(src: string, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Invalid image"));
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas not supported"));
        const srcSize = Math.min(img.width, img.height);
        const sx = (img.width - srcSize) / 2;
        const sy = (img.height - srcSize) / 2;
        ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch (e) { reject(e); }
    };
    img.src = src;
  });
}

function isNativeCapacitor(): boolean {
  try {
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    return typeof window !== "undefined" && !!w.Capacitor?.isNativePlatform?.();
  } catch { return false; }
}

export function AvatarEditSheet({ open, onClose }: AvatarEditSheetProps) {
  const [profile, actions] = useProfile();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      actions.updateAvatar(dataUrl);
      toast.success("Photo updated");
      onClose();
    } catch {
      toast.error("Couldn't process this image");
    } finally {
      setBusy(false);
    }
  };

  const openPicker = async (source: "camera" | "gallery") => {
    if (!isNativeCapacitor()) {
      // Web fallback — trigger the hidden HTML input
      if (source === "camera") cameraRef.current?.click();
      else galleryRef.current?.click();
      return;
    }
    setBusy(true);
    try {
      const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
        quality: 85,
        allowEditing: false,
        width: 512,
        height: 512,
      });
      if (photo.dataUrl) {
        const cropped = await resizeDataUrl(photo.dataUrl);
        actions.updateAvatar(cropped);
        toast.success("Photo updated");
        onClose();
      }
    } catch (e) {
      const msg = String((e as { message?: string })?.message || e);
      if (!/cancel/i.test(msg)) toast.error("Couldn't open " + source);
    } finally {
      setBusy(false);
    }
  };

  const handleInitialsOnly = () => {
    actions.removeAvatar();
    toast.success("Using initials");
    onClose();
  };

  const handleRemove = () => {
    actions.removeAvatar();
    toast.success("Photo removed");
    onClose();
  };

  const initials = profile.avatarInitials || (profile.name ? profile.name.trim()[0].toUpperCase() : "");

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="avatar-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50"
            style={{ background: "rgba(0,0,0,0.8)" }}
          />

          <motion.div
            key="avatar-sheet"
            initial={{ y: "100%", opacity: 0.5 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="fixed bottom-0 left-0 right-0 z-[51] px-5 pt-5"
            style={{
              borderRadius: "28px 28px 0 0",
              background: "rgba(10,18,32,0.99)",
              boxShadow: "inset 0 1px 0 rgba(0,200,224,0.12), 0 -8px 32px rgba(0,0,0,0.5)",
              paddingBottom: "calc(env(safe-area-inset-bottom) + 32px)",
              overflowX: "hidden",
              touchAction: "pan-y",
            }}
          >
            <div className="flex justify-center mb-4">
              <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.1)" }} />
            </div>

            <div className="flex items-center justify-between mb-5">
              <p className="text-white" style={{ fontSize: 17, fontWeight: 700 }}>Profile photo</p>
              <button
                onClick={onClose}
                aria-label="Close"
                className="size-9 rounded-[11px] flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <X className="size-[16px]" style={{ color: "rgba(255,255,255,0.5)" }} />
              </button>
            </div>

            <div className="flex justify-center mb-6">
              <div
                className="size-[96px] rounded-[28px] overflow-hidden flex items-center justify-center"
                style={{
                  background: profile.avatarUrl
                    ? "transparent"
                    : "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,153,179,0.08))",
                  boxShadow: "inset 0 0 0 1.5px rgba(0,200,224,0.25)",
                }}
              >
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                ) : initials ? (
                  <span className="text-white" style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-1px" }}>
                    {initials}
                  </span>
                ) : (
                  <User className="size-[40px]" style={{ color: "rgba(255,255,255,0.3)" }} />
                )}
              </div>
            </div>

            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />

            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => openPicker("camera")}
                className="flex flex-col items-center justify-center gap-1.5 py-4 rounded-[14px] disabled:opacity-40"
                style={{
                  background: "rgba(0,200,224,0.14)",
                  boxShadow: "inset 0 0 0 1px rgba(0,200,224,0.35)",
                }}
              >
                <Camera className="size-[20px]" style={{ color: "#00C8E0" }} strokeWidth={2.2} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>Take photo</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => openPicker("gallery")}
                className="flex flex-col items-center justify-center gap-1.5 py-4 rounded-[14px] disabled:opacity-40"
                style={{
                  background: "rgba(0,122,255,0.14)",
                  boxShadow: "inset 0 0 0 1px rgba(0,122,255,0.35)",
                }}
              >
                <ImageIcon className="size-[20px]" style={{ color: "#007AFF" }} strokeWidth={2.2} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#007AFF" }}>From gallery</span>
              </button>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={handleInitialsOnly}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[14px] mb-2 disabled:opacity-40"
              style={{
                background: "rgba(255,255,255,0.03)",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
              }}
            >
              <Type className="size-[15px]" style={{ color: "rgba(255,255,255,0.55)" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>Use initials only</span>
            </button>

            {profile.avatarUrl && (
              <button
                type="button"
                disabled={busy}
                onClick={handleRemove}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[14px] disabled:opacity-40"
                style={{
                  background: "rgba(255,45,85,0.06)",
                  boxShadow: "inset 0 0 0 1px rgba(255,45,85,0.15)",
                }}
              >
                <Trash2 className="size-[15px]" style={{ color: "#FF2D55" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#FF2D55" }}>Remove photo</span>
              </button>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
