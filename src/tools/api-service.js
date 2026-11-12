const API_BASE = '/api';

// Talks to the karmameter Node API (proxied under /api by nginx; see
// api/routes.js). Confirmed to use plain `fetch` with relative URLs, not
// axios - production builds the full absolute URL (https://karmameter.net/api/...)
// since it was written as a standalone script, but a relative base works
// identically from any origin serving this bundle and works in local dev too.
export default class ApiService {
  getNearbyPlaces({ location, radius, type }) {
    const url = `${API_BASE}/nearbySearch?lat=${encodeURIComponent(location.lat())}` +
      `&lng=${encodeURIComponent(location.lng())}&radius=${radius}&type=${type}`;
    return fetch(url).then(r => r.json());
  }

  // Mutates place.karmameter_reviews locally (pushes the new vote) and PUTs
  // the whole place document back - PUT /places/:id just `$set`s whatever
  // document it's given, there's no server-side "append a vote" endpoint.
  // Weight is 2: one internal vote counts as 2x a single imported Google
  // review, not the original 10x (lowered this session).
  async updatePlaceRating(place, isUpvote) {
    place.karmameter_reviews.push({ rating: isUpvote ? 5 : 1, weight: 2 });
    try {
      await fetch(`${API_BASE}/places/${place.place_id}`, {
        method: 'PUT',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(place),
      });
    } catch (e) {
      // swallowed, matching production
    }
  }

  async createPlace(place) {
    try {
      await fetch(`${API_BASE}/places`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(place),
      });
    } catch (e) {
      // swallowed, matching production
    }
  }
}
