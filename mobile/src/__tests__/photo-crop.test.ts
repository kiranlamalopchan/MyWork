import { cropRectangle } from "@/ui/photo-crop";
test("crop coordinates follow the original image dimensions", () => {
  expect(cropRectangle(1000, 2000, { left: .1, top: .2, right: .15, bottom: .1 })).toEqual({ originX:100, originY:400, width:750, height:1400 });
});
test("an untrimmed photo keeps its full resolution", () => {
  expect(cropRectangle(1200, 900, { left:0, top:0, right:0, bottom:0 })).toEqual({ originX:0, originY:0, width:1200, height:900 });
});
