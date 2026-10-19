import { useEffect, useRef, useState } from "react";
import { native } from "./native";

/** Copy feedback shared by catalogue rows and item details. */
export function useCopyCode() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async (code: string) => {
    if (timer.current) clearTimeout(timer.current);
    setError(false);
    try {
      const Clipboard = native<typeof import("expo-clipboard")>(() => require("expo-clipboard"));
      const success = await Clipboard.setStringAsync(code);
      setCopied(success);
      setError(!success);
    } catch {
      setCopied(false);
      setError(true);
    }
    timer.current = setTimeout(() => { setCopied(false); setError(false); }, 1800);
  };
  return { copy, copied, error };
}
