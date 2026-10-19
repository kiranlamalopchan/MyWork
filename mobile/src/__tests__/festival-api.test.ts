import { festivals } from "@/api/festivals";
import { api } from "@/api/client";
jest.mock("@/api/client", () => ({
  api: jest.fn(),
  formWith: (fields: Record<string, any>) => ({ fields, append: jest.fn() }),
}));

test("plain settings use an authenticated PATCH", () => {
  const changes = { theme: "off", greeting: "", description: "", remove_banner: false };
  festivals.save(changes);
  expect(api).toHaveBeenLastCalledWith("admin/festival-banner/", { method: "PATCH", body: changes });
});

test("image uploads explicitly send empty text to restore default copy", () => {
  festivals.save({ theme: "tihar", greeting: "", description: "", remove_banner: false }, { uri: "file://banner.png", name: "banner.png", type: "image/png" });
  const args = (api as jest.Mock).mock.calls.at(-1);
  expect(args[1].method).toBe("PATCH");
  expect(args[1].form.append).toHaveBeenCalledWith("greeting", "");
  expect(args[1].form.append).toHaveBeenCalledWith("description", "");
  expect(args[1].form.fields.remove_banner).toBe("false");
  expect(args[1].form.fields.banner.uri).toBe("file://banner.png");
});
