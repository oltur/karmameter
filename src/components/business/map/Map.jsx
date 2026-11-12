/*global google*/
import React from 'react';
import PropTypes from 'prop-types';
import Popover from 'material-ui/Popover';
import Menu from 'material-ui/Menu';
import MenuItem from 'material-ui/MenuItem';

import Helpers from '../../../tools/helpers';

import imageMyLocation from '../../../images/my-location.png';

// NOTE: this component no longer queries google.maps.places.PlacesService
// client-side. Place data (already enriched with our own ratings) is fetched
// by HomePage via ApiService and handed down as the `places` prop; this
// component is only responsible for rendering the map, the radius circle and
// the place markers.
export default class Map extends React.Component {
  static propTypes = {
    height: PropTypes.number.isRequired,
    places: PropTypes.array,
    placesVersion: PropTypes.number,
    position: PropTypes.object,
    distance: PropTypes.number,
    setPosition: PropTypes.func,
    showOverlay: PropTypes.func,
  }

  constructor(props) {
    super(props);

    this.googleMap = null;
    this.infowindow = null;
    this.locationMarker = null;
    this.radiusCircle = null;

    this.mapElem = null;
    this.markersArray = [];

    this.menuAnchor = null;
    this.state = {
      popUpMenuOpen: false,
      popUpMenuLeft: 0,
      popUpMenuTop: 0,
      lastClickLocation: null,
    };

    this.handleRequestClose = this.handleRequestClose.bind(this);
  }

  // componentWillReceiveProps is wrapped defensively: in production this has
  // run before this.googleMap / this.radiusCircle exist yet (e.g. a stray
  // re-render before initialize() has finished), so a bare property access
  // must not take down the whole render.
  componentWillReceiveProps(nextProps) {
    try {
      if (this.props.position !== nextProps.position) {
        this.setMapPosition(nextProps.position);
      }
      if (this.props.distance !== nextProps.distance && this.radiusCircle) {
        this.radiusCircle.setRadius(nextProps.distance);
      }
    } catch (e) {
      // see note above
    }
  }

  onMapClick(event) {
    if (!event.pixel) {
      return;
    }

    this.setState({
      ...this.state,
      popUpMenuOpen: true,
      popUpMenuLeft: event.pixel.x,
      popUpMenuTop: event.pixel.y,
      lastClickLocation: event.latLng,
    });
  }

  // Renders a rating badge as an inline SVG data URI instead of the old
  // static scale-N.png assets, colored with the app's status palette
  // (good/warning/serious/critical, plus neutral gray for "no rating").
  getScaleImage(rating) {
    const rounded = Math.round(rating);
    const colors = {
      1: '#d03b3b',
      2: '#ec835a',
      3: '#fab219',
      4: '#0ca30c',
      5: '#0ca30c',
    };
    const fill = colors[rounded] || '#898781';
    const textColor = rounded === 3 ? '#0b0b0b' : '#ffffff';
    const label = (rating === -1 || !colors[rounded]) ? '–' : String(rounded);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34'>` +
      `<circle cx='17' cy='17' r='15' fill='${fill}' stroke='#ffffff' stroke-width='2'/>` +
      `<text x='17' y='22' font-family='system-ui,-apple-system,Segoe UI,sans-serif' ` +
      `font-size='13' font-weight='700' fill='${textColor}' text-anchor='middle'>${label}</text>` +
      `</svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  getPosition() {
    return this.props.position || new google.maps.LatLng(31, 35);
  }

  setupMap() {
    this.googleMap = new google.maps.Map(this.mapElem, {
      center: this.getPosition(),
      zoom: 15,
      mapTypeControl: true,
      mapTypeControlOptions: {
        style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
        position: google.maps.ControlPosition.LEFT_BOTTOM,
      },
    });

    this.locationMarker = new google.maps.Marker({
      position: this.getPosition(),
      map: this.googleMap,
      icon: {
        url: imageMyLocation,
        scaledSize: new google.maps.Size(32, 32),
        anchor: new google.maps.Point(16, 16),
      },
    });

    // Light circle showing the currently selected search radius.
    this.radiusCircle = new google.maps.Circle({
      map: this.googleMap,
      center: this.getPosition(),
      radius: this.props.distance || 1000,
      fillColor: '#2a78d6',
      fillOpacity: 0.08,
      strokeColor: '#2a78d6',
      strokeOpacity: 0.35,
      strokeWeight: 1,
      clickable: false,
    });

    google.maps.event.addListener(this.googleMap, 'click', (event) => {
      this.onMapClick(event);
    });

    this.infowindow = new google.maps.InfoWindow({
      content: '',
    });

    this.setMapPosition();
    this.fillMarkers();
  }

  setPositionByLastClickLocation() {
    this.props.setPosition(this.state.lastClickLocation);
  }

  setMapPosition(position = null) {
    if (!position) {
      position = this.getPosition();
    }
    this.googleMap.setCenter(position);
    this.locationMarker.setPosition(position);
    if (this.radiusCircle) {
      this.radiusCircle.setCenter(position);
    }
    this.setState({
      ...this.state,
      popUpMenuOpen: false,
    });
  }

  initialize() {
    this.setupMap();
  }

  fillMarkers(places = null) {
    if (!places) {
      places = this.props.places;
    }
    this.clearOverlays();
    for (let i = 0; i < places.length; i++) {
      this.createMarker(this.props.places[i]);
    }
  }

  createMarker(place) {
    if (!place) {
      return;
    }
    const placeLoc = place.geometry.location;
    const marker = new google.maps.Marker({
      map: this.googleMap,
      position: placeLoc,
      icon: {
        url: this.getScaleImage(place.average_rating),
        scaledSize: new google.maps.Size(34, 34),
        anchor: new google.maps.Point(17, 17),
      },
    });

    this.markersArray.push(marker);

    const ratingText = place.average_rating === -1 ? 'NA' : `${Math.round(place.average_rating * 10) / 10} / 5`;
    const typeText = Helpers.decodeGoogleLocationName(place.types[0]);
    place.displayText = `${place.name.replace(/'/g, '&#39;')}<br/>${ratingText}</br/>(${typeText})`;
    const content = `<span onclick="window.HomePage.showOverlay(true,'${place.name}<br/>(${typeText})'); return false;" >${place.displayText}</span>`;

    google.maps.event.addListener(marker, 'mouseover', () => {
      this.infowindow.setContent(content);
      this.infowindow.open(this.googleMap, marker);
    });

    google.maps.event.addListener(marker, 'click', () => {
      this.props.showOverlay(true, `${place.name}<br/>(${typeText})`);
    });
  }

  clearOverlays() {
    for (let i = 0; i < this.markersArray.length; i++) {
      this.markersArray[i].setMap(null);
    }
    this.markersArray.length = 0;
  }

  addPlace() {
    // NOTE: inferred from the pre-2026 version of this component; the exact
    // current "add a new place" flow (which now presumably goes through
    // ApiService.createPlace) was not reverse-engineered this session.
    new google.maps.Marker({
      position: this.state.lastClickLocation,
      map: this.googleMap,
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
