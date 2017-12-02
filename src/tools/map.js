import LocationProvider from './location-provider'
import HomePage from '../components/routes/home/HomePage'

export default class Map {

    constructor() {
        this.map;
        this.service;
        this.infowindow;
        this.locationProvider = new LocationProvider();

        this.position;
        this.elem;
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
            zoom: 15
        });

        var request = {
            location: this.position,
            radius: '2000',
            type: ['restaurant']
        };

        this.service = new google.maps.places.PlacesService(this.map);
        this.service.nearbySearch(request, this.callback.bind(this));
        this.infowindow = new google.maps.InfoWindow({
            content: ""
        });
    }

    callback(results, status) {
        if (status == google.maps.places.PlacesServiceStatus.OK) {
            for (var i = 0; i < results.length; i++) {
                var place = results[i];
                this.createMarker(results[i]);
            }
        }
    }

    createMarker(place) {
        var placeLoc = place.geometry.location;
        var marker = new google.maps.Marker({
            map: this.map,
            position: place.geometry.location,
        });

        const content = `<button onclick="window.HomePage.showOverlay(true,'${place.name.replace(/\'/g, "\\\'")}')" >${place.name}</button>`;

        google.maps.event.addListener(marker, 'click', () => {
            this.infowindow.setContent(content);
            this.infowindow.open(this.map, marker);
            //HomePage.Instance.showOverlay(true);
        });
    }
}