const API_BASE = '/api';

// Google access token for the signed-in user. Every call below sends it as a
// Bearer header; the API verifies it against Google and looks the address up
// in its own `users` collection, so the allow-list is enforced there rather
// than here. Nothing in this file is a security control - a determined caller
// can edit the bundle - it only keeps the UI honest about what the server
// will actually accept.
let authToken = null;

// Thrown for 401/403 so HomePage can drop straight back to the welcome
// screen instead of rendering an error into the map.
export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export default class ApiService {
  static setAuthToken(token) {
    authToken = token || null;
  }

  static hasAuthToken() {
    return !!authToken;
  }

  static authHeaders(extra = {}) {
    const headers = { Accept: 'application/json', ...extra };
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    return headers;
  }

  static async request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: ApiService.authHeaders(options.headers || {}),
    });
    if (response.status === 401 || response.status === 403) {
      let message = 'Not authorized.';
      try {
        const body = await response.json();
        message = body.message || message;
      } catch (e) {
        // non-JSON body - keep the default
      }
      throw new AuthError(response.status, message);
    }
    if (!response.ok) {
      throw new Error(`${options.method || 'GET'} ${path} failed (${response.status})`);
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  // Returns { email, isAdmin } for the signed-in account, or throws
  // AuthError if the token is bad or the address isn't on the list.
  getMe() {
    return ApiService.request('/me');
  }

  getNearbyPlaces({ location, radius, type }) {
    const query = `lat=${encodeURIComponent(location.lat())}` +
      `&lng=${encodeURIComponent(location.lng())}&radius=${radius}&type=${type}`;
    return ApiService.request(`/nearbySearch?${query}`);
  }

  // Mutates place.karmameter_reviews locally (pushes the new vote) and PUTs
  // the whole place document back - PUT /places/:id just `$set`s whatever
  // document it's given, there's no server-side "append a vote" endpoint.
  // Weight is 2: one internal vote counts as 2x a single imported Google
  // review, not the original 10x (lowered this session).
  updatePlaceRating(place, isUpvote) {
    place.karmameter_reviews.push({ rating: isUpvote ? 5 : 1, weight: 2 });
    return ApiService.request(`/places/${place.place_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(place),
    });
  }

  createPlace(place) {
    return ApiService.request('/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(place),
    });
  }

  // --- Account management (admin only, enforced server-side) -------------
  listUsers() {
    return ApiService.request('/users');
  }

  addUser(email, isAdmin) {
    return ApiService.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, isAdmin: !!isAdmin }),
    });
  }

  setUserAdmin(email, isAdmin) {
    return ApiService.request(`/users/${encodeURIComponent(email)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isAdmin: !!isAdmin }),
    });
  }

  removeUser(email) {
    return ApiService.request(`/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
  }
}
