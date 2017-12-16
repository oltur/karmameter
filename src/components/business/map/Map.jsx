/*global google*/
import React from 'react';
import PropTypes from 'prop-types';
import Popover from 'material-ui/Popover';
import Menu from 'material-ui/Menu';
import MenuItem from 'material-ui/MenuItem';

import LocationProvider from '../../../tools/location-provider';
// import HomePage from '../components/routes/home/HomePage'
import Helpers from '../../../tools/helpers';

import StorageService from '../../../tools/storage-service';

import imgScale1 from '../../../images/scale-1.png';
import imgScale2 from '../../../images/scale-2.png';
import imgScale3 from '../../../images/scale-3.png';
import imgScale4 from '../../../images/scale-4.png';
import imgScale5 from '../../../images/scale-5.png';
import imgScaleMinus1 from '../../../images/scale--1.png';
import imageMyLocation from '../../../images/my-location.png';

export default class Map extends React.Component {
  static propTypes = {
    height: PropTypes.number.isRequired,
  }

  constructor(props) {
    super(props);

    this.storageService = new StorageService();
    this.map = null;
    this.infowindow = null;
    this.locationProvider = new LocationProvider();

    this.position = null;
    this.mapElem = null;
    this.locationMarker = null;

    this.selectedTypes = ['restaurant'];
    this.markersArray = [];
    this.distance = 2000;

    this.menuAnchor = null;
    this.state = {
      popUpMenuOpen: false,
      popUpMenuLeft: 0,
      popUpMenuTop: 0,
      lastClickLocation: null,
    };

    this.callbackPlaceDetails = this.callbackPlaceDetails.bind(this);
    this.callbackNearbySearch = this.callbackNearbySearch.bind(this);
    this.handleRequestClose = this.handleRequestClose.bind(this);

    this.placesService = null;
  }

  onMapClick(event) {
    if (!event.pixel) {
      return;
    }
    //console.log(event);
    // This prevents ghost click.
    //event.preventDefault();

    this.setState({
      ...this.state,
      popUpMenuOpen: true,
      popUpMenuLeft: event.pixel.x,
      popUpMenuTop: event.pixel.y,
      lastClickLocation: event.latLng,
    });
  }

  getScaleImage(value) {
    let result = imgScaleMinus1;
    switch (Math.round(value)) {
      case 1:
        result = imgScale1;
        break;
      case 2:
        result = imgScale2;
        break;
      case 3:
        result = imgScale3;
        break;
      case 4:
        result = imgScale4;
        break;
      case 5:
        result = imgScale5;
        break;
      default:
        result = imgScaleMinus1;
        break;
    }

    return result;
  }

  setupMap() {
    this.map = new google.maps.Map(this.mapElem, {
      center: this.position,
      zoom: 15,
      mapTypeControl: true,
      mapTypeControlOptions: {
        style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
        position: google.maps.ControlPosition.LEFT_BOTTOM,
      },
    });

    this.placesService = new google.maps.places.PlacesService(this.map);
    this.locationMarker = new google.maps.Marker({
      position: this.position,
      map: this.map,
      icon: {
        url: imageMyLocation,
        scaledSize: new google.maps.Size(32, 32),
        // origin: new google.maps.Point(16, 16),
        anchor: new google.maps.Point(16, 16),
      },
    });

    google.maps.event.addListener(this.map, 'click', (event) => {
      this.onMapClick(event);
    });


    this.infowindow = new google.maps.InfoWindow({
      content: '',
    });

    this.fillMarkers();
  }

  setPositionByLastClickLocation() {
    this.position = this.state.lastClickLocation;
    this.setPosition();
  }

  setPosition() {
    this.map.setCenter(this.position);
    this.locationMarker.setPosition(this.position);
    this.fillMarkers();
    this.setState({
      ...this.state,
      popUpMenuOpen: false,
    });
  }

  initialize() {
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

  fillMarkers() {
    const request = {
      location: this.position,
      radius: this.distance,
      type: this.selectedTypes,
    };

    this.clearOverlays();

    this.placesService.nearbySearch(request, this.callbackNearbySearch);
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
          this.placesService.getDetails(request, this.callbackPlaceDetails);
        }
      }
    }
  }

  callbackPlaceDetails(place, status) {
    //console.log(status);
    if (status === google.maps.places.PlacesServiceStatus.OK) {
      place.average_rating = place.reviews && place.reviews.length ?
        place.reviews.reduce((total, num) =>
          (total || 0) + parseFloat(num.rating), 0) / place.reviews.length :
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
      icon: {
        url: this.getScaleImage(place.average_rating),
        labelOrigin: new google.maps.Point(15, 10),
      },
      label: {
        text: `${place.average_rating === -1 ? '-' : Math.round(place.average_rating)}`,
        fontSize: '12px',
      },
    });

    this.markersArray.push(marker);

    // console.log(place);

    const ratingText = place.average_rating === -1 ? 'NA' : `${Math.round(place.average_rating * 10) / 10} / 5`;
    const typeText = Helpers.decodeGoogleLocationName(place.types[0]);
    place.displayText = `${place.name.replace(/'/g, "'")}<br/>${ratingText}</br/>(${typeText})`;
    const content = `<span onclick="window.HomePage.showOverlay(true,'${place.name}<br/>(${typeText})'); return false;" >${place.displayText}</span>`;

    google.maps.event.addListener(marker, 'mouseover', () => {
      this.infowindow.setContent(content);
      this.infowindow.open(this.map, marker);
      //HomePage.Instance.showOverlay(true);
    });

    google.maps.event.addListener(marker, 'click', () => {
      window.HomePage.showOverlay(true, `${place.name}<br/>(${typeText})`);
    });
  }

  clearOverlays() {
    for (let i = 0; i < this.markersArray.length; i++) {
      this.markersArray[i].setMap(null);
    }
    this.markersArray.length = 0;
  }

  addPlace() {
    const marker = new google.maps.Marker({
      position: this.state.lastClickLocation,
      map: this.map,
    });

    this.setState({
      ...this.state,
      popUpMenuOpen: false,
    });
  }

  handleRequestClose() {
    this.setState({
      ...this.state,
      popUpMenuOpen: false,
    });
  }

  render() {
    const popUpMenu = (
      <Popover
        open={this.state.popUpMenuOpen}
        anchorEl={this.menuAnchor}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
        targetOrigin={{ horizontal: 'left', vertical: 'top' }}
        onRequestClose={this.handleRequestClose}
      >
        <Menu>
          <MenuItem primaryText="Set position" onClick={() => this.setPositionByLastClickLocation()} />
          <MenuItem primaryText="Add place" onClick={() => this.addPlace()} />
        </Menu>
      </Popover>
    );

    return (
      <div>
        <div
          ref={(elem) => { this.mapElem = elem; }}
          className="map"
          style={
            {
              height: this.props.height,
            }
          }
        />
        <div
          ref={(elem) => { this.menuAnchor = elem; }}
          style={
            {
              position: 'fixed',
              left: this.state.popUpMenuLeft,
              top: this.state.popUpMenuTop,
              height: '1px',
              width: '1px',
            }
          }
        />
        {popUpMenu}
      </div>
    );
  }
}
