import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { catalogue, useCatalogueSearch, type CatalogueSearch } from "@/api/catalogue";

jest.mock("@/auth/session", () => ({ useSession: () => ({ me: { username: "alice" } }) }));
jest.mock("@/api/client", () => ({ api: jest.fn(), formWith: jest.fn() }));

function response(id: number, title: string): CatalogueSearch {
  return {
    count: 1, next: null, page: 1, pages: 1, total: 1, samples: [],
    results: [{ id, catalogue_id: id, title, description: "", code: "001", fields: {} }],
    catalogue: null, catalogues: [],
  };
}

it("keeps a delayed search from the previous catalogue out of the selected results", async () => {
  let groceries: (data: CatalogueSearch) => void = () => {};
  let meat: (data: CatalogueSearch) => void = () => {};
  const search = jest.spyOn(catalogue, "search").mockImplementation((_q, _page, id) =>
    new Promise((resolve) => { if (id === 1) groceries = resolve; else meat = resolve; }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, rerender, unmount } = await renderHook(({ id }: { id: number }) => useCatalogueSearch("001", id), { initialProps: { id: 1 }, wrapper });
  await waitFor(() => expect(search).toHaveBeenCalledWith("001", 1, 1));
  await rerender({ id: 2 });
  await waitFor(() => expect(search).toHaveBeenCalledWith("001", 1, 2));
  await act(async () => { meat(response(2, "Beef mince")); });
  await waitFor(() => expect(result.current.data?.pages[0].results[0].title).toBe("Beef mince"));
  await act(async () => { groceries(response(1, "Apple")); });
  expect(result.current.data?.pages[0].results[0].title).toBe("Beef mince");
  await unmount();
  client.clear();
  search.mockRestore();
});
