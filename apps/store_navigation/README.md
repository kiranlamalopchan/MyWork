# Store navigation API

The website has a **Store Navigation** card on Home and a **Store map** tab
under Items. Open `/store-navigation/` to choose a store, search products and
view the walking route on its SVG floorplan. The page uses the existing
website login and shows setup guidance until stores are configured. Products
are paginated at six per page for every store, with Previous/Next controls.
Paging preserves search, selected product and manual starting point. A new
search resets to the first page. On phones the Products / Store map shortcuts
jump between sections; browsing leads with products and a selected route leads
with the map. Inputs use phone-friendly text sizes and controls have larger
touch targets.

For a ready-to-try sample store, run `python manage.py seed_navigation_demo`.
It installs the converted reference floorplan, eight sample products and
two-way walking paths. Repeat runs rebuild only the demo store’s graph and
locations. Real stores are left intact. Sample product positions are illustrative.
The SVG embeds a PNG; it provides SVG coordinates without claiming to trace
the original shelves into vector paths. The cleaned PNG is also in `data/`.

Run `python manage.py migrate` after installing the project's requirements.
In Django Admin create a store and its SVG, products, map nodes, directed edges,
and product locations. Coordinates use the SVG viewBox coordinate system.
The store ID in URLs and responses is the numeric Store primary key; `slug`
is a separate unique human-readable identifier.

Both endpoints use the project's DRF authentication and require a signed-in
user (`Authorization: Token <token>`). Store navigation data is shared among
signed-in users. Example requests:

```sh
curl -H 'Authorization: Token <token>' 'http://localhost:8000/api/stores/1/products/search/?q=olive'
curl -H 'Authorization: Token <token>' 'http://localhost:8000/api/stores/1/navigate/?sku=OIL_1L'
```

Search requires a nonblank `q`, matches title or SKU case-insensitively, and
returns the project's paginated response (`count`, `next`, `previous`,
`results`). Each result contains `sku`, `title`, `image_url`, `aisle_name`,
`bay_number`, and `map_node: [x, y]`.

Navigation requires `sku`. Optional `start_node_id` is a store-local node ID,
not a database primary key. Without it, `ENTRANCE_MAIN` is preferred among
entrance nodes; otherwise the first entrance by node ID is used. A supplied
start can be any walkable node. The response follows the requested route
shape and also includes `total_distance`, the sum of edge costs. Floorplan
URLs are storage URLs (normally `/media/floorplans/...`); configure media
serving on the production host for floorplans.

Edges are directed: create a reverse edge for a two-way walkway. Blank weights
are calculated on save. Explicit weights, including zero, are preserved.
Clearing a weight in admin recalculates it; moving a node does not change
previously stored weights. Null weights inserted in bulk are calculated at
route time. Euclidean A* uses a scale bounded by the smallest cost/distance
ratio so custom cheap edges cannot make the heuristic overestimate. Costs
and coordinates should use compatible units; physical distance is returned
when all weights equal geometric lengths.

Invalid/missing query parameters and invalid graph data return HTTP 400.
Missing stores, products, start nodes, entrances, and unreachable routes return
HTTP 404. Model validation rejects cross-store edges and locations. Django
bulk writes bypass model validation; the routing service checks graph data
again before routing. Store floorplans should describe walkways accurately:
the engine follows edges and does not infer obstacles from SVG artwork.

Run the focused tests with:

```sh
python manage.py test apps.store_navigation
```


## Position and walking directions

Choose **I’m here — set my position**, then tap a blue walkway point (or use
the dropdown). The page recalculates the route and keeps `start_node_id` when
searching for another product. **Start from entrance** clears the chosen start.
Walking instructions describe directions relative to the displayed map, not
compass headings or metres, because the map has no geographic calibration.
Position changes are manual. There is no GPS-to-floorplan mapping, automatic
phone tracking, simulated movement, or positioning hardware integration.


## 3D walking guide

Selected routes lazy-load a locally vendored Three.js 0.186.1 renderer (MIT
license in `static/vendor/three/LICENSE`). A procedural 3D humanoid uses jointed
limbs, knee bending, a stance/swing cycle, ground-plane projection and route
heading changes. It is a stylised guide, not a motion-captured human model or
an exact reconstruction of the user's facial geometry. Animation is a route
preview; it does not indicate the phone's measured location.

The session-authenticated `/store-navigation/face/` endpoint reads only the
current account's profile photo. OpenCV detects the largest face, crops it to
an oval texture without shoulders/clothing, and caches the derived bytes on
the server for an hour. Responses are private and non-cacheable by the browser.
No portrait is sent to an external provider. Multiple faces use the largest;
a clear single-person portrait gives the best result. A missing/undetectable
face uses a neutral 3D face with guidance to update the profile photo.

Install updated `requirements.txt` before deployment (OpenCV headless), run
`collectstatic`, then reload the app. WebGL support is required for the guide;
the SVG route remains usable if 3D cannot load. Rendering stops offscreen,
when the tab is hidden, when paused and when reduced motion is requested.

## Warehouse picking

Open **Warehouse Navigation → Customer pick lists**, or `/store-navigation/picking/`.
Create a customer/order reference, choose the warehouse, search products and add requested quantities.
The pick page shows a numbered nearest-reachable-stop route through the remaining items. It is a
practical greedy route, not a guaranteed globally shortest multi-stop tour. Individual stops open
existing animated walking guidance. Confirmed scans set the next route's starting point to the
last collected location. Unreachable products remain visible with a warning.

Configure `zone`, `rack`, `shelf`, and `bin` on each ProductLocation. Users with the
`change_productlocation` permission get **Edit storage location** links on product cards; the
same fields are available in Django admin. Legacy bin codes remain stored for compatibility; they are not required for picking.
Existing aisle/bay values remain a fallback for locations not yet configured. The additive data
migration assigns clearly labelled demo bin codes only to the sample warehouse; real locations
must be configured using the workplace's own layout and labels.

Set each Product's `barcode` in admin, or scan the SKU printed on your own product label. Codes
are strings, preserving leading zeros. Scan the product barcode, enter the collected quantity,
and confirm. USB/Bluetooth scanners that type into fields work; Enter advances to the next field.
Manual entry also works. Optional camera scanning uses the browser's BarcodeDetector API, requires
camera permission and HTTPS (localhost also works), and falls back to manual/scanner entry when
unavailable. Camera streams stop on cancellation, navigation, closed scan panels and hidden tabs.
See [browser barcode support](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector).
Camera scanning decodes locally and does not upload video.

Each pick list is private to its creator. All writes require login and CSRF, validate warehouse
membership, and run in a transaction with a parent-order lock on databases supporting row locks.
Wrong product codes, zero/negative/excess quantities, and changes to completed lists are rejected.
Partial picks are supported. All collected units mark the order ready for the customer. These
features record collections only: they do not reserve/deduct stock, create sales, or provide live
indoor positioning. Limits: 100 different products per list and 10,000 units per product; the
product selector searches the catalogue and shows at most 50 matching products at a time.

After pulling these changes, run `python manage.py migrate`, `python manage.py collectstatic`
and restart the deployed application. Existing map data is preserved.

### Add products from the website

**Warehouse Navigation → Add product** opens `/store-navigation/products/add/`.
Users need both `add_product` and `add_productlocation` permissions (administrators already have
these). Choose the warehouse first, scan or type the product barcode, enter its name and
zone/rack/shelf/bin. Choose a walking destination
from the selector or tap a blue point on the map. Saving creates the product and location in one
transaction, generates an internal SKU, and opens the product's route. Duplicate barcodes are
rejected without overwriting existing products. Barcode strings retain leading zeros. The same
camera support and manual-entry fallback used for picking apply here. The screen supports existing
warehouse map points; adding new rack geometry remains an administrator task.

### Camera barcode search

**Warehouse Navigation → Scan barcode** appears below the search input. Capturing a code submits
an exact product barcode/SKU lookup within the selected warehouse and opens a unique match's
storage details and route. Unrecognised codes show an empty result; they are never matched using
partial product names. Ordinary typed searches still work with Enter. Search cards include SKU
and saved barcode values.

Search camera decoding prefers BarcodeDetector and otherwise lazy-loads the locally vendored
`@zxing/browser` 0.2.1 bundle in `static/vendor/zxing/` (MIT, bundled library Apache-2.0 notices
included). This adds software decoding for browsers without native barcode detection. Camera
access still requires HTTPS (or localhost) and the user's permission; frames stay on the device.

### Picking workspace design

The pick-list overview provides private list counts, All/Open/Ready filters, reference/warehouse
search, progress cards, and pagination (12 lists per page; query and status are preserved).
Creation is in an expandable panel. Inside a list, a next-stop card highlights the product,
location and remaining quantity; collected lines are grouped separately. Route and product-entry
panels expand when requested, or automatically for relevant errors, searches and empty lists.
The existing POST actions, barcode validation and order ownership checks are unchanged.

`static/js/pick-workspace.js` lazy-loads the locally vendored GSAP 3.15.0 core from
`static/vendor/gsap/`. It adds short card entrances, progress fills and disclosure transitions.
Native forms/details remain functional if the library fails. Reduced-motion preferences disable
animations, changes to that preference revert current animations, and page disposal removes
listeners and reverts the GSAP context. The original GSAP copyright/license header and source
notice are retained alongside the bundle.
