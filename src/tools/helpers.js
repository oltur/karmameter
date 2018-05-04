export default class Helpers {
  static toTitleCase(str) {
    return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
  }

  static decodeGoogleLocationName(name) {
    return Helpers.toTitleCase(name.replace(/_/g, ' '));
  }
}
