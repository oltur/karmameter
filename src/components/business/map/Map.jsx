/*global google*/
import React from 'react';
import PropTypes from 'prop-types';
import Popover from 'material-ui/Popover';
import Menu from 'material-ui/Menu';
import MenuItem from 'material-ui/MenuItem';

import Helpers from '../../../tools/helpers';

import imageMyLocation from '../../../images/my-location.png';

// Optional vector Map ID for the free "3D Buildings" tilt view. Create one
// at console.cloud.google.com -> Google Maps Platform -> Map Management ->
// Create Map ID (map type "JavaScript", renderer "Vector") and paste it
// here - it costs nothing extra versus a normal map load. Left blank, the
// "3D Buildings" view still tilts the camera (setTilt(45)) but won't show
// extruded building geometry, since that requires the vector renderer a
// Map ID turns on.
const MAP_ID = '';

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
    mapViewMode: PropTypes.oneOf(['flat', 'tilted', 'photorealistic']),
    openAddPlaceForm: PropTypes.func,
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
    this.map3dElem = null;
    this.markers3dArray = [];
    // undefined until importLibrary('maps3d') resolves/rejects the first
    // time the "Photorealistic 3D" view is selected - avoids loading that
    // (separately billed) library's tiles before it's actually asked for.
    this.map3dLoadPromise = null;
    this.state = {
      popUpMenuOpen: false,
      popUpMenuLeft: 0,
      popUpMenuTop: 0,
      lastClickLocation: null,
      map3dError: null,
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
      if (this.props.mapViewMode !== nextProps.mapViewMode) {
        this.applyViewMode(nextProps.mapViewMode);
      }
    } catch (e) {
      // see note above
    }
  }

  // Switches between the three comparison views. 'flat'/'tilted' both use
  // the regular 2D google.maps.Map (just a tilt difference); 'photorealistic'
  // swaps to the separate <gmp-map-3d> element instead, lazily loading the
  // maps3d library the first time it's selected.
  applyViewMode(mode) {
    if (mode === 'photorealistic') {
      this.showPhotorealistic3D();
      return;
    }
    this.hidePhotorealistic3D();
    if (this.googleMap) {
      this.googleMap.setTilt(mode === 'tilted' ? 45 : 0);
    }
  }

  showPhotorealistic3D() {
    if (this.mapElem) {
      this.mapElem.style.display = 'none';
    }
    if (this.map3dElem) {
      this.map3dElem.style.display = 'block';
    }
    if (!this.map3dLoadPromise) {
      this.map3dLoadPromise = google.maps.importLibrary('maps3d')
        .then(() => {
          this.setState({ ...this.state, map3dError: null });
          this.render3dMarkers(this.props.places);
        })
        .catch((err) => {
          // Most likely cause: the Map Tiles API isn't enabled (or billing
          // isn't set up) for this project in Cloud Console - that's a
          // separate, billed product from the base Maps JavaScript API.
          console.log('Photorealistic 3D Tiles failed to load:', err);
          this.setState({
            ...this.state,
            map3dError: 'Photorealistic 3D Tiles unavailable - enable the "Map Tiles API" (and billing) for this project in Google Cloud Console.',
          });
        });
    } else {
      // Already loaded once before (switching back from flat/tilted) -
      // markers were kept in the DOM, but re-sync in case places changed
      // while this view was hidden.
      this.render3dMarkers(this.props.places);
    }
  }

  hidePhotorealistic3D() {
    if (this.mapElem) {
      this.mapElem.style.display = 'block';
    }
    if (this.map3dElem) {
      this.map3dElem.style.display = 'none';
    }
  }

  // Mirrors fillMarkers()/createMarker() for the Photorealistic 3D view -
  // google.maps.Marker only attaches to a 2D google.maps.Map, so <gmp-map-3d>
  // needs its own marker type (Marker3DInteractiveElement) from the same
  // maps3d library, appended as real DOM children of the map element.
  render3dMarkers(places) {
    if (!this.map3dElem || !(google.maps && google.maps.maps3d) || !places) {
      return;
    }
    this.clear3dMarkers();
    for (let i = 0; i < places.length; i++) {
      this.create3dMarker(places[i]);
    }
  }

  clear3dMarkers() {
    for (let i = 0; i < this.markers3dArray.length; i++) {
      const marker = this.markers3dArray[i];
      if (marker.parentNode) {
        marker.parentNode.removeChild(marker);
      }
    }
    this.markers3dArray.length = 0;
  }

  create3dMarker(place) {
    if (!place || !place.geometry || !place.geometry.location) {
      return;
    }
    const { Marker3DInteractiveElement } = google.maps.maps3d;
    const marker = new Marker3DInteractiveElement({
      position: {
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
        altitude: 0,
      },
    });

    // Same rating-colored SVG badge as the 2D markers (getScaleImage), set
    // as the marker's glyph instead of a google.maps.Marker icon.
    const glyphImg = document.createElement('img');
    glyphImg.src = this.getScaleImage(place.average_rating);
    glyphImg.style.width = '28px';
    glyphImg.style.height = '28px';
    marker.glyph = glyphImg;

    const typeText = Helpers.decodeGoogleLocationName(place.types[0]);
    marker.title = `${place.name} (${typeText})`;

    // Marker3DInteractiveElement (unlike the plain, non-interactive
    // Marker3DElement) fires gmp-click - same up/down-vote overlay as a 2D
    // marker click.
    marker.addEventListener('gmp-click', () => {
      this.props.showOverlay(true, `${place.name}<br/>(${typeText})`, place);
    });

    this.map3dElem.appendChild(marker);
    this.markers3dArray.push(marker);
  }

  // The Photorealistic 3D Tiles viewer has no pixel-to-ground unprojection
  // exposed the way the 2D map's click event hands back event.latLng/
  // event.pixel - so "Set position"/"Add place" here target the current
  // camera center rather than the exact point clicked. Good enough for
  // comparison purposes; flagged clearly so it's not mistaken for the 2D
  // view's precise click-to-location behavior.
  onMap3dClick(event) {
    this.props.closeMenu && this.props.closeMenu();
    const center = this.map3dElem && this.map3dElem.center;
    if (!center) {
      return;
    }
    this.setState({
      ...this.state,
      popUpMenuOpen: true,
      popUpMenuLeft: event.clientX,
      popUpMenuTop: event.clientY,
      lastClickLocation: { lat: center.lat, lng: center.lng },
    });
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

  // A coordinate from google.maps.LatLng is a method (lat()) that needs its
  // `this` bound to the LatLng instance; one from a plain {lat, lng}
  // literal (e.g. a LatLngAltitude from the 3D view) is just a number - both
  // show up as `position`/`lastClickLocation`, so call via `source[key]`
  // rather than extracting the function first (which would drop `this`).
  static readCoord(source, key, fallback) {
    const value = source[key];
    if (typeof value === 'function') {
      return value.call(source);
    }
    return typeof value === 'number' ? value : fallback;
  }

  setupMap() {
    const mapOptions = {
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
    };
    // Only set when a vector Map ID has actually been created (see MAP_ID
    // above) - an empty mapId is invalid, so this must stay conditional.
    if (MAP_ID) {
      mapOptions.mapId = MAP_ID;
    }
    this.googleMap = new google.maps.Map(this.mapElem, mapOptions);
    if (this.props.mapViewMode === 'tilted') {
      this.googleMap.setTilt(45);
    }

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
    if (this.props.mapViewMode === 'photorealistic') {
      this.showPhotorealistic3D();
    }
  }

  fillMarkers(places = null) {
    if (!places) {
      places = this.props.places;
    }
    this.clearOverlays();
    for (let i = 0; i < places.length; i++) {
      this.createMarker(this.props.places[i]);
    }
    // Keeps the Photorealistic 3D view's markers in sync too, regardless of
    // which view is currently visible - no-ops until that view has been
    // selected at least once (guarded on google.maps.maps3d being loaded).
    this.render3dMarkers(places);
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
    this.setState({
      ...this.state,
      popUpMenuOpen: false,
    });
    // Opens HomePage's "Add a new place" dialog (name + category, including
    // a free-typed custom category like "Home") instead of just dropping an
    // unlabeled, unsaved marker - see HomePage.openAddPlaceForm/submitNewPlace.
    if (this.props.openAddPlaceForm) {
      this.props.openAddPlaceForm(this.state.lastClickLocation);
    }
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

    // NOTE: deliberately not this.getPosition() here - that constructs a
    // google.maps.LatLng, and `google` isn't defined yet on the very first
    // render (the Maps JS script is still loading). Default matches
    // getPosition()'s own fallback (31, 35).
    const rawPosition = this.props.position || {};
    const lat = Map.readCoord(rawPosition, 'lat', 31);
    const lng = Map.readCoord(rawPosition, 'lng', 35);

    return (
      <div style={{ position: 'relative' }}>
        <div
          ref={(elem) => { this.mapElem = elem; }}
          className="map"
          style={
            {
              height: this.props.height,
            }
          }
        />
        {/* Photorealistic 3D Tiles - a separate element from google.maps.Map,
            not just a mode switch on it. Hidden unless "photorealistic" is
            selected (see showPhotorealistic3D/hidePhotorealistic3D above);
            its geometry only loads (and only bills) once the maps3d library
            has been imported and the element is visible. */}
        <gmp-map-3d
          ref={(elem) => {
            this.map3dElem = elem;
            // Plain native DOM listener, not a React onClick - gmp-map-3d is
            // an unmanaged custom element - and guarded so the ref callback
            // (which React can invoke more than once) only binds it once.
            if (elem && !elem.dataset.karmaClickBound) {
              elem.dataset.karmaClickBound = 'true';
              elem.addEventListener('click', (event) => this.onMap3dClick(event));
            }
          }}
          className="map"
          center={`${lat},${lng},200`}
          tilt="65"
          range="1200"
          mode="hybrid"
          style={
            {
              height: this.props.height,
              display: 'none',
            }
          }
        />
        {this.props.mapViewMode === 'photorealistic' && (
          <button
            type="button"
            title="Go to current location"
            style={
              {
                position: 'absolute',
                right: 10,
                bottom: 10,
                background: '#fff',
                border: 'none',
                borderRadius: 2,
                boxShadow: '0 1px 4px rgba(0,0,0,.3)',
                cursor: 'pointer',
                width: 40,
                height: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 5,
              }
            }
            onClick={() => {
              if (window.HomePage && window.HomePage.recenterToCurrentLocation) {
                window.HomePage.recenterToCurrentLocation();
              }
            }}
            dangerouslySetInnerHTML={
              {
                __html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="#555">' +
                  '<path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06' +
                  'C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06z' +
                  'M12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>',
              }
            }
          />
        )}
        {this.state.map3dError && (
          <div
            style={
              {
                position: 'absolute',
                top: 8,
                left: 8,
                right: 8,
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.95)',
                border: '1px solid #d03b3b',
                borderRadius: 4,
                color: '#d03b3b',
                fontSize: 13,
                zIndex: 10,
              }
            }
          >
            {this.state.map3dError}
          </div>
        )}
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
