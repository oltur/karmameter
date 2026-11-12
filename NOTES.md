# prod-sync-2026-11-12

This branch syncs the repo with the state of production (karmameter.net) as of
2026-11-12. The previous `master` had drifted a long way from what was
actually deployed - this branch exists to close that gap and make the app
deployable from source again. It is **not** merged into `master`; review and
merge (or don't) as you see fit.

## `api/` - exact production source

Everything under `api/` was pulled directly from the running server
(`/var/www/html/karmameter.net.api/` on turevskiy.com) and is real, current
source - not reconstructed. Notable changes since the old `master`:

- `mongodb` bumped from `2.2.33` (2017) to `^3.6.12`. The old driver spoke a
  wire protocol version MongoDB Atlas has since stopped accepting
  (`UnsupportedOpQueryCommand` on every `aggregate()` call), which silently
  broke `/nearbySearch` and `/places`. `index.js`'s connect call was updated
  to match the new driver's API (`client.db()` instead of getting a `Db`
  directly from the connect callback).
- Added `@googlemaps/google-maps-services-js` and `axios` (server-side Google
  Places/Elevation lookups used to backfill the `places` collection).
- `routes.js`:
  - `addGeospatial()` now guards for a missing `place.geometry`/`location` -
    it used to throw on any partial update (e.g. a thumbs up/down vote,
    which only sends `{ karmameter_reviews: [...] }`, not a full Google
    Place object), which could crash the whole process.
  - `updatePlace()` wraps the now-guarded call in try/catch.
  - `/nearbySearch` wraps its entire body in try/catch so a Mongo or Google
    API failure always sends a response, instead of leaving the request
    hanging forever (restify doesn't catch rejections thrown by an `async`
    route handler on its own).

### The restify 444 bug and `patch-package`

Separately from the above, every `PUT`/`POST` request was coming back with a
non-standard HTTP 444 status (nginx's "close without response" code) -
**even on success**, body and all. Root cause: `restify@6.3.4` (this app's
version, from ~2018) listens for the request's `'close'` event to detect a
client disconnect and force-overrides the response status to 444 if it
fires. On Node 13+, `'close'` on an `http.IncomingMessage` also fires once the
request body has been fully read - which happens almost immediately for a
small JSON `PUT`/`POST` body - long before an `async` handler's DB write
finishes and calls `res.send()`. Restify then "sees" the (already long gone,
in its stale bookkeeping) close event and assumes the client vanished.

Since `node_modules` isn't committed, this fix is captured as a
[patch-package](https://github.com/ds300/patch-package) patch:
`api/patches/restify+6.3.4.patch`, applied automatically via the `postinstall`
script in `api/package.json`. It simply removes the `req.once('close', ...)`
registration (the real abort signal, `'aborted'`, is left intact) - see the
patch and its inline comment for the exact change.

## `src/` - best-effort reconstructed frontend

This is the part that **could not** be synced from real source: the `src/`
tree on `master` is the original ~2018 implementation, and production had
drifted to a meaningfully different architecture by the time this branch was
written. There is no source control anywhere for that drift - only the
compiled, minified `bundle.js` actually running in production. `src/` on this
branch is a best-effort reconstruction of that bundle's behavior, written by
reading the minified code; it is **not guaranteed to be 100% behaviorally
identical** to what's deployed, especially anywhere marked `NOTE:` in the
code as inferred rather than confirmed (most of the "add a new place" /
`createPlace` flow in particular).

Confirmed architecture changes from the old `master`:

- `HomePage` now owns `distance` / `position` / `selectedTypes` / `places` /
  `placesVersion` in its own state (`Map` no longer tracks any of this
  itself), fetches places via a new `ApiService.getNearbyPlaces(...)` call
  against the backend (`/api/nearbySearch`) and hands the results down to
  `<Map places={...} />`. `Map` no longer talks to
  `google.maps.places.PlacesService` directly at all.
- `selectedTypes` is a single string (one `SelectField`), not the 2018
  multi-select array.
- `Map`'s internal field for the `google.maps.Map` instance is `googleMap`
  (not `map`); it also keeps `locationMarker`, `radiusCircle`, and
  `markersArray`. Its props are
  `height, places, placesVersion, position, distance, setPosition, showOverlay`.

Changes made this session, all included here:

- **Marker redesign**: `getScaleImage()` generates an inline SVG data-URI
  badge (34x34 circle, white ring, rating number centered) instead of the old
  static `scale-N.png` images, colored 1→red, 2→orange, 3→yellow (dark text),
  4-5→green, anything else/no rating→gray with a "–". The marker's `label`
  option is gone (the text is baked into the SVG); icon gets an explicit
  `scaledSize`/`anchor` so it renders as a centered badge, not Google's
  default pin silhouette.
- **Radius circle**: a light blue (`#2a78d6`, low-opacity) `google.maps.Circle`
  showing the currently selected search distance, created in `setupMap()`
  and kept in sync with both position and distance changes.
- **Geolocation UX**: a failed/denied geolocation request used to fail
  completely silently (map just sat on a hardcoded `(31, 35)` fallback
  forever with zero indication why). Now shows a clear `alert()` - a
  permission-specific message when denied, a generic one otherwise.
- **OAuth client ID**: the original Google Cloud OAuth client
  (`19471878870-...`) was deleted on Google's side at some point, breaking
  Sign-In with `Error 401: deleted_client`. Replaced with a freshly created
  client ID. **No client secret is or should ever be in this repo** - this
  Sign-In flow is client-side only and never needs one.

### "Anonymous after login" - resolved 2026-11-13

The issue noted above (Sign-In completed but `currentUser` never reflected
it) turned out to be the Sign-In approach itself, not a small bug - see the
2026-11-13 section below for the full story and the OAuth popup flow that
replaced it.

## 2026-11-13 - everything since the previous sync

A large number of additional changes were made live against production
between 2026-11-12 and 2026-11-13, all hand-patched directly into the
deployed `bundle.js`/`routes.js` (no source was touched in prod - this repo
is the first place any of this exists as real source). This section brings
`api/` and `src/` up to that state.

### `api/` - exact source, re-pulled

- New route: `GET /places/photo` - proxies Google's Place Photo REST
  endpoint using the server's own `GOOGLE_MAPS_API_KEY`. The browser-side
  Maps JavaScript API key is restricted to Maps JS only and returns 403 on
  direct Photo API calls from the browser (confirmed directly) - the
  frontend now always fetches photos through this proxy instead.
- **Route ordering matters here**: `/places/photo` is registered *before*
  the existing `GET /places/:id` no-op placeholder. Restify matches routes
  in registration order, so with the old ordering `/places/photo` would
  have matched `/places/:id` first (`id` = `"photo"`), hit a handler that
  never sends a response, and every photo request would hang until the
  client gave up. Hit and fixed live - do not reorder these two routes.
- `env.example` / `README.md` added, documenting the required environment
  variables (none of this changes runtime behavior, just makes `api/`
  actually runnable by someone who isn't the original deployer).

### `src/` - reconstructed, matching confirmed live behavior

- **Markers, radius circle, geolocation alert**: as already documented
  above, no change since the last sync.
- **Marker tooltip**: now shows a photo (via the new proxy) and a
  "View on Google Maps" link (`place.url`), and the tooltip itself is
  click-to-vote (routes through a new `HomePage.voteFromMarker(placeId)`,
  looked up from `state.places` - not a global registry, that was only
  needed for live-patching compiled code safely).
- **Vote overlay**: gained the same photo + Maps link, click-anywhere-to-
  dismiss, and a real fix to an actual shipped bug - the photo was
  originally sized `width:'100%'` with only a `maxHeight`, which stretched
  it to the full viewport width before crushing it down to a thin strip.
  Now properly capped at `maxWidth:360px`.
- **`ApiService`**: the previous reconstruction's guess (axios, a
  `updatePlaceRating(placeId, data)` signature) was wrong. Pulled the real
  implementation directly from the live bundle: plain `fetch`,
  `updatePlaceRating(place, isUpvote)` mutates `place.karmameter_reviews`
  locally and PUTs the whole document back (there's no server-side "append
  a vote" endpoint - `PUT /places/:id` just `$set`s whatever it's given).
  Vote weight was also intentionally lowered this session, from 10 to 2 -
  one internal vote now counts as 2x a single imported Google review, not
  10x.
- **Authentication - full rewrite, two prior approaches abandoned in
  order**:
  1. `react-google-login` (legacy `gapi.auth2`) - broke when its OAuth
     client was deleted server-side (`Error 401: deleted_client`).
  2. Google Identity Services' ID-token button (`google.accounts.id.
     initialize` + `renderButton`) - replaced (1), but never reliably
     rendered: the button lives inside `MenuItem.primaryText`, and the ref
     needed to call `renderButton` into the right DOM node raced the GIS
     script's own async load in a way this old Material-UI's handling of
     element (vs string) `primaryText` never resolved cleanly. This is the
     root cause of the "Anonymous after login" issue from the previous
     sync - Sign-In never actually completed because there was often no
     real button to click.
  3. **Current**: the OAuth 2.0 popup token-client flow
     (`google.accounts.oauth2.initTokenClient` + `requestAccessToken()`),
     with a plain "Log in" text trigger - no Google-branded widget to
     render at all, so nothing to race. `handleOauthToken` exchanges the
     access token for profile info via Google's `userinfo` endpoint. This
     is confirmed working in production. The signed-in user's photo
     (`profileObj.imageUrl`) now also shows next to their name in the menu.
  `currentUser` is confirmed to start `null` on every load and is never
  persisted to `storageService` - a prior guess assumed it was.
- **Geolocation timeout**: `locationProvider.getPosition()` had no timeout
  anywhere, so a permission prompt that never got answered (slow user, or
  an automated/embedded browser context with nobody to click it) left the
  lookup pending forever. Both call sites now pass
  `{ timeout: 10000, maximumAge: 60000 }`.
- **"Go to current location" button**: new custom map control
  (`Map.setupMap()`'s `addLocateMeControl()`), calls a new
  `HomePage.recenterToCurrentLocation()` that mirrors `initMap()`'s
  geolocation success/failure handling.
- **Logo / favicon / hamburger icon**: the old favicon (tiny "KARMA" text
  inside a thin circle) was illegible at real favicon sizes. Replaced with
  a bold blue circle + white "K" (confirmed legible at actual 16x16),
  generated from `favicon.png` at the repo root via the existing
  `favicons-webpack-plugin` pipeline - just the one source image changed,
  nothing else. The same mark replaced the generic Material "dehaze"
  hamburger icon as inline SVG. Its `marginTop:'15px'` is load-bearing: the
  parent `.menu` rule in `HomePage.scss` has `top:-15px`, tuned for the old
  font icon's own line-height padding, and clips a plain SVG div without
  the compensating margin.
- **Menu auto-close**: previously the only way to close the main hamburger
  menu was to re-click the hamburger. A new `HomePage.closeMenu()` is now
  called on: a map click (via a new `closeMenu` prop passed down to
  `<Map>`), Escape, selecting a places category, and a successful address
  search.
- **Help & Feedback**: went from doing nothing, to a bare `mailto:` link
  (quick first pass), to its current form - an in-app overlay (`state.
  helpVisible`) describing the app's features with a contact email link,
  closable via an × or by clicking the backdrop.

### Local run - verified 2026-11-13

Both `api/` and the frontend were installed and run locally against the
**real** production MongoDB Atlas database and Google Maps key (read
verification only - see below for the one write-path exception), to
confirm this reconstruction is actually functional, not just plausible.

**Toolchain friction, all worked around, none of it changes behavior:**
- `npm install` in the root needs `--legacy-peer-deps` (expected for a
  2018-era dependency tree under a modern npm's stricter resolver).
- `node-sass` (a `devDependency` of the root `package.json`) cannot be
  built on any system with only Python 3 available - its pinned
  `node-gyp` predates Python 3 support entirely, and there is no fix short
  of a major version bump. It was replaced with `sass` (Dart Sass, a
  compatible drop-in for this era's SCSS) in `package.json`. The pinned
  `sass-loader@6.0.6` hardcodes `require('node-sass')` with no
  configurable implementation, though - so a **local, uncommitted**
  `node_modules/node-sass/index.js` shim (`module.exports = require('sass')`)
  is also required; it doesn't survive a fresh `npm install` and needs to
  be recreated by hand (or `sass-loader` upgraded, which risks its own
  breakage against this repo's webpack 3 setup - not attempted here to
  keep the change minimal).
- The bundled `fsevents`/`chokidar` version crashes `webpack-dev-server`
  outright on this Node/macOS combination (native ABI mismatch).
  `scripts/start.js` now sets `watchOptions: { poll: 1000 }` to avoid
  native file watching entirely.
- `scripts/start.js`'s dev server had no `/api` proxy at all; added one
  (`http://localhost:3000`, prefix stripped) so the frontend can actually
  reach a locally running `api/` the same way nginx does in production.

**Verified working, with real data:**
- `api/`: `GET /places`, `GET /nearbySearch`, and `GET /places/photo`
  (given a current-format photo reference - see below) all returned real
  data from the live database via `curl`. The `patch-package` restify fix
  applied automatically on `npm install` and is confirmed necessary - `PUT`/
  `POST` return correct 200/204 statuses with it.
- Write path: `POST /places` → `PUT /places/:id` (the vote endpoint,
  including the new weight-2 contract) → cleanup, all exercised against a
  single throwaway document (`place_id: "test_local_verify_delete_me"`)
  and confirmed removed afterward.
- Frontend: `npm start` builds and serves successfully; the compiled
  bundle was inspected directly and confirmed to contain every feature
  listed above (`recenterToCurrentLocation`, `voteFromMarker`,
  `tokenClient`, `closeMenu`, `helpVisible`, `getPhotoUrl`) and confirmed
  to **not** contain `GoogleLogin` (the old, removed library).
- The regenerated favicon pipeline was verified pixel-by-pixel (not just
  "it built") - the served 32x32 PNG's circle body is exactly `#2a78d6`
  with a white glyph at center, not a stale cached asset.

**Not verified - browser automation was unavailable this session** (the
same browser tool was independently confirmed broken against production
earlier the same day - this isn't specific to localhost): the map
rendering, marker styling, hover tooltips, the vote overlay, and the Login
button's actual click behavior were not visually confirmed, only confirmed
present in the compiled output and structurally correct by inspection. If
this matters, it still needs an actual browser pass.

**Newly discovered while testing - not fixed, out of scope for this
pass**: `DELETE /places/:id` queries `{ _id: req.params.id }`, comparing
the route's string param against MongoDB's `_id` ObjectId field. This can
never match, so the route always returns 204 "success" while silently
deleting nothing. Found while cleaning up the throwaway test document
above (had to delete it directly via the driver instead). Pre-existing,
not touched by anything this session - flagging it here since it's a real,
confirmed bug a future pass should fix (likely intended to query
`{ place_id: req.params.id }`, matching how every other route identifies a
place).

## Explicitly out of scope: `/api2` (.NET)

Production also proxies `/api2` to a .NET app (`WebApplication1.dll` under
`dotnet.karmameter.net`). It was investigated and found to be unrelated to
karmameter: generic ASP.NET template boilerplate (default `appsettings.json`,
generic `web.config`, placeholder project GUID), with zero references
anywhere in the karmameter frontend bundle, served as its own separate
subdomain. A Go rewrite was considered and intentionally skipped - there is
nothing karmameter-specific there to port.
