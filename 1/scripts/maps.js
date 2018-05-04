export default class Maps {
  Map() {
    this.map;
    this.service;
    this.infowindow;
  }

  initialize() {
    let pyrmont = new google.maps.LatLng(-33.8665433, 151.1956316);

    this.map = new google.maps.Map(document.getElementById('map'), {
      center: pyrmont,
      zoom: 15,
    });

    const request = {
      location: pyrmont,
      radius: '500',
      type: ['restaurant'],
    };

    this.service = new google.maps.places.PlacesService(this.map);
    this.service.nearbySearch(request, this.callback);
  }

  callback(results, status) {
    if (status == google.maps.places.PlacesServiceStatus.OK) {
      for (let i = 0; i < results.length; i++) {
        let place = results[i];
        createMarker(results[i]);
      }
    }
  }
}
