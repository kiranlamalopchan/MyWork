import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/auth/session";
import { api, formWith, type FilePart } from "./client";
import type { Page } from "./types";

export type CatalogueItem = { id: number; catalogue_id: number; title: string; description: string; code: string; fields: Record<string, string> };
export type CatalogueMapping = { name: string; title_column: string; description_column: string; code_column: string; search_columns: string[]; catalogue_id?: number };
export type CatalogueConfig = CatalogueMapping & { id: number; headers: string[] };
export type CatalogueDetails = CatalogueConfig & { count: number };
export type CataloguePreview = { upload_id: string; headers: string[]; sample: Record<string, string>[]; count: number; defaults: CatalogueMapping };
export type CatalogueSearch = Page<CatalogueItem> & { total: number; samples: CatalogueItem[]; catalogue: CatalogueConfig | null; catalogues: { id: number; name: string; count: number }[] };

export const catalogue = {
  search: (q: string, page = 1, catalogueId?: number) => api<CatalogueSearch>("items/search/", { query: { q, page, catalogue: catalogueId } }),
  one: (id: number) => api<CatalogueItem>(`items/${id}/`),
  details: (id: number) => api<CatalogueDetails>(`catalogues/${id}/`),
  update: (id: number, settings: { name: string; search_columns: string[] }) => api<CatalogueDetails>(`catalogues/${id}/`, { method: "PATCH", body: settings }),
  remove: (id: number) => api<void>(`catalogues/${id}/`, { method: "DELETE" }),
  preview: (file: FilePart, onProgress?: (sent: number) => void) => api<CataloguePreview>("items/preview/", { method: "POST", form: formWith({ file }), onProgress }),
  save: (upload_id: string, mapping: CatalogueMapping) => api<{ catalogue_id: number; name: string; total: number; skipped: number; message: string }>("items/import/", { method: "POST", body: { upload_id, ...mapping } }),
};

export function useCatalogueIdle(catalogueId?: number) {
  const { me } = useSession();
  return useQuery({ queryKey: ["catalogue", me?.username, "idle", catalogueId], queryFn: () => catalogue.search("", 1, catalogueId), enabled: !!me, staleTime: 60_000 });
}
export function useCatalogueSearch(q: string, catalogueId?: number, page = 1) {
  const { me } = useSession();
  return useQuery({ queryKey: ["catalogue", me?.username, "search", catalogueId, q, page], queryFn: () => catalogue.search(q, page, catalogueId), enabled: !!me && !!q });
}
export function useCatalogueChanged() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ["catalogue"] });
    client.invalidateQueries({ queryKey: ["plu"] });
    client.invalidateQueries({ queryKey: ["plu-idle"] });
    client.invalidateQueries({ queryKey: ["plu-item"] });
    client.invalidateQueries({ queryKey: ["plu-importable"] });
  };
}
