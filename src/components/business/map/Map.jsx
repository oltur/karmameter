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
    closeMenu: PropTypes.func,
    currentUser: PropTypes.object,
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
      // Street View is a separately-billed Maps Platform SKU with zero
      // friction for an anonymous visitor to trigger (just drag the Pegman)
      // - gate it behind sign-in rather than removing it outright.
      if (this.props.currentUser !== nextProps.currentUser && this.googleMap) {
        this.googleMap.setOptions({ streetViewControl: !!nextProps.currentUser });
      }
    } catch (e) {
      // see note above
    }
  }

  onMapClick(event) {
    // Closing the main hamburger menu on any map click is a deliberate UX
    // fix (menu previously had no way to close except re-clicking the
    // hamburger) - do this regardless of whether the click also opens the
    // "add place" popup below.
    this.props.closeMenu && this.props.closeMenu();

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
      // Anonymous by default (see componentWillReceiveProps for the toggle
      // on sign-in/sign-out) - Street View panorama loads are a separately
      // billed SKU with no friction for a visitor to trigger.
      streetViewControl: !!this.props.currentUser,
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

    this.addLocateMeControl();

    google.maps.event.addListener(this.googleMap, 'click', (event) => {
      this.onMapClick(event);
    });

    this.infowindow = new google.maps.InfoWindow({
      content: '',
    });

    this.setMapPosition();
    this.fillMarkers();
  }

  // Custom "go to current location" control - the map has no built-in
  // My Location button, so this one calls back into HomePage to re-run
  // geolocation and recenter.
  addLocateMeControl() {
    const button = document.createElement('div');
    button.title = 'Go to current location';
    button.style.cssText = 'background:#fff;border-radius:2px;box-shadow:0 1px 4px rgba(0,0,0,.3);' +
      'cursor:pointer;margin:10px;width:40px;height:40px;display:flex;align-items:center;justify-content:center';
    button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="#555">' +
      '<path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06' +
      'C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06z' +
      'M12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>';
    button.addEventListener('click', () => {
      button.style.opacity = '0.4';
      setTimeout(() => { button.style.opacity = '1'; }, 600);
      if (window.HomePage && window.HomePage.recenterToCurrentLocation) {
        try {
          window.HomePage.recenterToCurrentLocation();
        } catch (err) {
          console.log('recenterToCurrentLocation threw:', err);
        }
      }
    });
    this.googleMap.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(button);
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

    const photoUrl = place.photos && place.photos[0] && place.photos[0].photo_reference
      ? Helpers.getPhotoUrl(place.photos[0].photo_reference, 220)
      : null;

    // The whole tooltip (minus the Maps link, which stops propagation so it
    // navigates instead) is clickable to open the up/down-vote flow - a
    // quicker path than requiring the user to click the marker pin itself.
    const content = '<div style="max-width:220px;cursor:pointer" ' +
      `onclick="window.HomePage.voteFromMarker('${place.place_id}'); return false;">` +
      (photoUrl ? `<img src="${photoUrl}" style="width:100%;border-radius:4px;margin-bottom:4px;display:block"/>` : '') +
      `<div>${place.displayText}</div>` +
      (place.url ? `<a href="${place.url}" target="_blank" rel="noopener" style="font-size:12px" onclick="event.stopPropagation()">View on Google Maps</a>` : '') +
      '</div>';

    google.maps.event.addListener(marker, 'mouseover', () => {
      this.infowindow.setContent(content);
      this.infowindow.open(this.googleMap, marker);
    });

    google.maps.event.addListener(marker, 'click', () => {
      this.props.showOverlay(true, `${place.name}<br/>(${typeText})`, place);
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
