import LocationProvider from './location-provider';
// import HomePage from '../components/routes/home/HomePage'

export default class Map {

  constructor() {
    this.map;
    this.service;
    this.infowindow;
    this.locationProvider = new LocationProvider();

    this.position;
    this.elem;

    this.markersArray = [];
  }

  initialize(elem) {
    this.elem = elem;
    this.locationProvider.getPosition()
      .then((position) => {
        this.position = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);
        this.setupMap();
      })
      .catch((err) => {
        console.error(err.message);
        this.position = new google.maps.LatLng(31, 35);
        this.setupMap();
      });
  }

  setupMap() {
    this.map = new google.maps.Map(this.elem, {
      center: this.position,
      zoom: 15,
      mapTypeControl: true,
      mapTypeControlOptions: {
        style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
        position: google.maps.ControlPosition.LEFT_BOTTOM,
      },
    });

    this.infowindow = new google.maps.InfoWindow({
      content: '',
    });

    this.fillMarkers();
  }

  fillMarkers(distance = 2000) {
    const request = {
      location: this.position,
      radius: distance,
      type: ['restaurant'],
    };

    this.clearOverlays();

    this.service = new google.maps.places.PlacesService(this.map);
    this.service.nearbySearch(request, this.callback.bind(this));
  }

  callback(results, status) {
    if (status == google.maps.places.PlacesServiceStatus.OK) {
      for (let i = 0; i < results.length; i++) {
        let place = results[i];
        this.createMarker(results[i]);
      }
    }
  }

  createMarker(place) {
    const placeLoc = place.geometry.location;
    const marker = new google.maps.Marker({
      map: this.map,
      position: placeLoc,
    });

    this.markersArray.push(marker);

    const content = `<span onclick="window.HomePage.showOverlay(true,'${place.name.replace(/'/g, "'")}'); return false;" >${place.name}</span>`;

    google.maps.event.addListener(marker, 'mouseover', () => {
      this.infowindow.setContent(content);
      this.infowindow.open(this.map, marker);
      //HomePage.Instance.showOverlay(true);
    });

    google.maps.event.addListener(marker, 'click', () => {
      window.HomePage.showOverlay(true, place.name.replace(/'/g, "'"));
    });
  }

  clearOverlays() {
    for (let i = 0; i < this.markersArray.length; i++) {
      this.markersArray[i].setMap(null);
    }
    this.markersArray.length = 0;
  }
}
