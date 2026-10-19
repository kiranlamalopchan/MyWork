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
  await waitFor(() => expect(result.current.data?.results[0].title).toBe("Beef mince"));
  await act(async () => { groceries(response(1, "Apple")); });
  expect(result.current.data?.results[0].title).toBe("Beef mince");
  await unmount();
  client.clear();
  search.mockRestore();
});

 it("requests only the selected page and replaces its results", async () => {
  const search = jest.spyOn(catalogue, "search").mockImplementation(async (_q, page) => ({ ...response(page!, `Item ${page}`), count: 11, page: page!, pages: 3, next: page === 3 ? null : page! + 1 }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, rerender, unmount } = await renderHook(({ page }: { page: number }) => useCatalogueSearch("beef", 5, page), { initialProps: { page: 1 }, wrapper });
  await waitFor(() => expect(result.current.data?.results[0].title).toBe("Item 1"));
  expect(search).toHaveBeenCalledTimes(1);
  await rerender({ page: 2 });
  await waitFor(() => expect(result.current.data?.results[0].title).toBe("Item 2"));
  expect(search).toHaveBeenLastCalledWith("beef", 2, 5);
  expect(result.current.data?.results).toHaveLength(1);
  await unmount(); client.clear(); search.mockRestore();
});
