import axios from 'axios';

// Talks to the karmameter Node API (proxied under /api by nginx; see api/routes.js).
export default class ApiService {
  getNearbyPlaces({ location, radius, type }) {
    return axios.get('/api/nearbySearch', {
      params: {
        lat: location.lat(),
        lng: location.lng(),
        radius,
        type,
      },
    }).then(response => response.data);
  }

  updatePlaceRating(placeId, data) {
    return axios.put(`/api/places/${placeId}`, data)
      .then(response => response.data);
  }

  createPlace(place) {
    return axios.post('/api/places', place)
      .then(response => response.data);
  }
}
