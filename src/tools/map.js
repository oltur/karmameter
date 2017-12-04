import LocationProvider from './location-provider';
// import HomePage from '../components/routes/home/HomePage'

import StorageService from '../tools/storage-service';

export default class Map {
  constructor() {

    this.storageService = new StorageService();
    this.map;
    this.service;
    this.infowindow;
    this.locationProvider = new LocationProvider();

    this.position;
    this.elem;

    this.markersArray = [];

    this.callbackPlaceDetails = this.callbackPlaceDetails.bind(this);
    this.callbackNearbySearch = this.callbackNearbySearch.bind(this);
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
    this.service.nearbySearch(request, this.callbackNearbySearch);
  }

  callbackNearbySearch(results, status) {
    if (status === google.maps.places.PlacesServiceStatus.OK) {
      for (let i = 0; i < results.length; i++) {
        const protoPlace = results[i];

        if (this.storageService.hasData('google_place', protoPlace.place_id)) {
          const place = this.storageService.getData('google_place', protoPlace.place_id);
          this.createMarker(place);
        } else {
          const request = {
            placeId: protoPlace.place_id,
          };
          this.service.getDetails(request, this.callbackPlaceDetails);
        }
      }
    }
  }

  callbackPlaceDetails(place, status) {
    //console.log(status);
    if (status === google.maps.places.PlacesServiceStatus.OK) {
      place.average_rating = place.reviews && place.reviews.length ?
        place.reviews.reduce((total, num) => (total || 0) + parseFloat(num.rating), 0) / place.reviews.length :
        -1;
      this.storageService.setData('google_place', place.place_id, place);
      this.createMarker(place);
    }
  }

  createMarker(place) {
    const placeLoc = place.geometry.location;
    const marker = new google.maps.Marker({
      map: this.map,
      position: placeLoc,
    });

    this.markersArray.push(marker);

    const ratingText = place.average_rating === -1 ? 'NA' : `${place.average_rating}/5`
    place.displayText = `${place.name.replace(/'/g, "'")}: ${ratingText}`;
    const content = `<span onclick="window.HomePage.showOverlay(true,'${place.displayText}'); return false;" >${place.displayText}</span>`;

    google.maps.event.addListener(marker, 'mouseover', () => {
      this.infowindow.setContent(content);
      this.infowindow.open(this.map, marker);
      //HomePage.Instance.showOverlay(true);
    });

    google.maps.event.addListener(marker, 'click', () => {
      window.HomePage.showOverlay(true, place.displayText);
    });
  }

  clearOverlays() {
    for (let i = 0; i < this.markersArray.length; i++) {
      this.markersArray[i].setMap(null);
    }
    this.markersArray.length = 0;
  }
}