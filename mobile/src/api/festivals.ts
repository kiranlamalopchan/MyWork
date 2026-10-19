import { api, formWith, type FilePart } from "./client";
import type { Festival } from "./types";

export type FestivalSettings = {
  theme: string; greeting: string; description: string; banner_url: string | null; preview: Festival | null;
  choices: { value: string; label: string; preview: Festival | null }[];
};
export type FestivalChanges = { theme: string; greeting: string; description: string; remove_banner: boolean };

export const festivals = {
  settings: () => api<FestivalSettings>("admin/festival-banner/"),
  save: (changes: FestivalChanges, image?: FilePart) => {
    if (!image) return api<FestivalSettings>("admin/festival-banner/", { method: "PATCH", body: changes });
    const form = formWith({ theme: changes.theme, remove_banner: changes.remove_banner ? "true" : "false", banner: image });
    // Empty text explicitly restores the standard copy, including during an upload.
    form.append("greeting", changes.greeting);
    form.append("description", changes.description);
    return api<FestivalSettings>("admin/festival-banner/", { method: "PATCH", form });
  },
};
