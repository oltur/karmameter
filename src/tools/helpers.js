export default class Helpers {
  static toTitleCase(str) {
    return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
  }

  static decodeGoogleLocationName(name) {
    return Helpers.toTitleCase(name.replace(/_/g, ' '));
  }

  // Backend proxy for Google's Place Photo API - the browser-restricted Maps
  // JavaScript API key used client-side is not authorized for the Places
  // Photo REST endpoint (confirmed: direct calls return 403), so photos are
  // fetched through our own API using its server-side key instead.
  static getPhotoUrl(photoReference, maxwidth = 220) {
    return `/api/places/photo?maxwidth=${maxwidth}&ref=${encodeURIComponent(photoReference)}`;
  }
}
