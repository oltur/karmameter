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

### Known issue (as of this branch)

Google Sign-In completes, but the menu still shows "Anonymous" afterward
(`currentUser` not reflecting post-login). This was still being actively
investigated live against production when this branch was written; the
`loginGoogle()` reconstruction here reflects the best current understanding,
not a confirmed fix. Check current `master`/later branches or production
before assuming this is resolved.

## Explicitly out of scope: `/api2` (.NET)

Production also proxies `/api2` to a .NET app (`WebApplication1.dll` under
`dotnet.karmameter.net`). It was investigated and found to be unrelated to
karmameter: generic ASP.NET template boilerplate (default `appsettings.json`,
generic `web.config`, placeholder project GUID), with zero references
anywhere in the karmameter frontend bundle, served as its own separate
subdomain. A Go rewrite was considered and intentionally skipped - there is
nothing karmameter-specific there to port.
