/*global google*/
import React from 'react';
import PropTypes from 'prop-types';
import Popover from 'material-ui/Popover';
import Menu from 'material-ui/Menu';
import MenuItem from 'material-ui/MenuItem';

import Helpers from '../../../tools/helpers';

import imageMyLocation from '../../../images/my-location.png';

// REQUIRED - not optional. AdvancedMarkerElement (used for every marker on
// the 2D map) only renders on a map initialized with a Map ID, so blanking
// this makes all markers silently disappear. It also enables the vector
// renderer the "3D Buildings" tilt view needs to actually extrude buildings.
// Created at console.cloud.google.com -> Google Maps Platform -> Map
// Management -> Create Map ID (type "JavaScript", renderer "Vector"); it
// costs nothing extra versus a normal map load.
const MAP_ID = '31cb9021a132e7b13954ff29';

// The standard map tilts itself once you're zoomed in far enough for
// building geometry to actually be worth showing - replacing what used to be
// a manual "3D buildings" mode nobody needed to pick. Google's vector tiles
// only carry extruded buildings from roughly this zoom anyway, so tilting
// earlier just skews a flat map.
const AUTO_TILT_MIN_ZOOM = 17;
const AUTO_TILT_DEGREES = 45;

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
    mapViewMode: PropTypes.oneOf(['flat', 'photorealistic']),
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
    // null until the first zoom evaluation; then true/false for "currently
    // tilted by the auto rule" - see syncAutoTilt.
    this.autoTiltApplied = null;
    // Screen coords of the last native click on the 3D map, recorded so the
    // popup menu can be anchored where the user actually clicked (the
    // library's gmp-click carries a ground position, not pixel coords).
    this.lastPointerScreen = null;
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

  // Everything here is an imperative call into the Google Maps objects,
  // which live outside React's tree - so this belongs after the commit, not
  // in the deprecated componentWillReceiveProps it used to sit in (React
  // warns about that lifecycle and drops the un-prefixed name in React 18).
  // Running post-commit is also marginally more correct: the DOM the map
  // measures itself against has settled by then.
  //
  // Still wrapped defensively: in production this has run before
  // this.googleMap / this.radiusCircle exist yet (e.g. a stray re-render
  // before initialize() has finished), so a bare property access must not
  // take down the whole render.
  componentDidUpdate(prevProps) {
    try {
      if (prevProps.position !== this.props.position) {
        this.setMapPosition(this.props.position);
        // Only re-centers the 3D camera - never touches tilt/range, so
        // "go to current location" pans there without resetting whatever
        // angle/zoom the user had set (see the gmp-map-3d ref callback in
        // render() for why tilt/range/center aren't reactive JSX props).
        if (this.map3dElem) {
          const lat = Map.readCoord(this.props.position || {}, 'lat', null);
          const lng = Map.readCoord(this.props.position || {}, 'lng', null);
          if (lat !== null && lng !== null) {
            this.map3dElem.center = { lat, lng, altitude: 200 };
          }
        }
      }
      if (prevProps.distance !== this.props.distance && this.radiusCircle) {
        this.radiusCircle.setRadius(this.props.distance);
      }
      // Street View is a separately-billed Maps Platform SKU with zero
      // friction for an anonymous visitor to trigger (just drag the Pegman)
      // - gate it behind sign-in rather than removing it outright.
      if (prevProps.currentUser !== this.props.currentUser && this.googleMap) {
        this.googleMap.setOptions({ streetViewControl: !!this.props.currentUser });
      }
      if (prevProps.mapViewMode !== this.props.mapViewMode) {
        this.applyViewMode(this.props.mapViewMode);
      }
    } catch (e) {
      // see note above
    }
  }

  // 'flat' is the ordinary 2D google.maps.Map (which tilts itself by zoom -
  // see syncAutoTilt); 'photorealistic' swaps to the separate <gmp-map-3d>
  // element instead, lazily loading the maps3d library the first time it's
  // selected.
  applyViewMode(mode) {
    if (mode === 'photorealistic') {
      this.showPhotorealistic3D();
      return;
    }
    this.hidePhotorealistic3D();
    // Forget the last decision so returning to the flat map re-evaluates the
    // current zoom rather than assuming the tilt state we left it in.
    this.autoTiltApplied = null;
    this.syncAutoTilt();
  }

  // Tilts the standard map in and out automatically as you cross the zoom
  // threshold. Deliberately only acts ON a crossing (autoTiltApplied tracks
  // the last decision) rather than on every zoom event, so a tilt the user
  // set themselves - vector maps allow ctrl+drag - isn't immediately
  // overridden while they stay at the same zoom level.
  syncAutoTilt() {
    if (!this.googleMap || this.props.mapViewMode === 'photorealistic') {
      return;
    }
    const shouldTilt = this.googleMap.getZoom() >= AUTO_TILT_MIN_ZOOM;
    if (shouldTilt === this.autoTiltApplied) {
      return;
    }
    this.autoTiltApplied = shouldTilt;
    this.googleMap.setTilt(shouldTilt ? AUTO_TILT_DEGREES : 0);
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
  // AdvancedMarkerElement only attaches to a 2D google.maps.Map, so
  // <gmp-map-3d> needs its own marker type (Marker3DInteractiveElement) from
  // the maps3d library, appended as real DOM children of the map element.
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
      // altitudeMode defaults to CLAMP_TO_GROUND, which ignores altitude -
      // no need to set one.
      position: {
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
      },
    });

    // Marker3DElement has no `glyph` property (that's AdvancedMarkerElement's
    // API, a different class) - a custom visual has to go through this
    // element's default slot instead: an <img>/<svg> wrapped in a <template>
    // child. Setting `.glyph` directly (as in an earlier version of this
    // code) was a silent no-op - the library ignores unknown properties, so
    // markers rendered with no visible content at all.
    const template = document.createElement('template');
    const glyphImg = document.createElement('img');
    glyphImg.src = this.getScaleImage(place.average_rating);
    glyphImg.width = 28;
    glyphImg.height = 28;
    template.content.appendChild(glyphImg);
    marker.appendChild(template);

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

  // Map3DElement's own gmp-click hands back the ground position under the
  // cursor (LocationClickEvent.position), so "Set position"/"Add place"
  // land on the actual clicked point here, same as the 2D view. The screen
  // coordinates for anchoring the popup menu come from the native click
  // recorded just before this (see the ref callback in render()) - the
  // library's synthetic event carries the location, not pixel coordinates.
  onMap3dClick(event) {
    this.props.closeMenu && this.props.closeMenu();

    // A marker's own gmp-click opens the vote overlay - don't also open the
    // "add place" menu if that event reaches the map element too.
    if (event.target && this.markers3dArray.indexOf(event.target) !== -1) {
      return;
    }

    const position = event && event.position;
    if (!position) {
      // Click didn't land on the globe (empty sky, etc.)
      return;
    }
    const lat = Map.readCoord(position, 'lat', null);
    const lng = Map.readCoord(position, 'lng', null);
    if (lat === null || lng === null) {
      return;
    }

    const screen = this.lastPointerScreen || { x: 0, y: 0 };
    this.setState({
      ...this.state,
      popUpMenuOpen: true,
      popUpMenuLeft: screen.x,
      popUpMenuTop: screen.y,
      lastClickLocation: { lat, lng },
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

  // AdvancedMarkerElement anchors the BOTTOM-CENTER of its content at the
  // marker's position, whereas the google.maps.Marker this replaced centered
  // its icon on the point (anchor: Point(size/2, size/2)). Nudging the image
  // down by half its own height restores that - done with a plain CSS
  // transform on our own element rather than the anchorTop/anchorLeft
  // options, so the offset is unambiguous.
  static buildMarkerImage(src, size) {
    const img = document.createElement('img');
    img.src = src;
    img.width = size;
    img.height = size;
    img.style.transform = 'translateY(50%)';
    return img;
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
      // Anonymous by default (see componentDidUpdate for the toggle
      // on sign-in/sign-out) - Street View panorama loads are a separately
      // billed SKU with no friction for a visitor to trigger.
      streetViewControl: !!this.props.currentUser,
      mapTypeControlOptions: {
        style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
        position: google.maps.ControlPosition.LEFT_BOTTOM,
      },
    };
    // Still guarded because an empty mapId is itself invalid, but MAP_ID is
    // required now (see its comment above) - warn loudly rather than let
    // every marker vanish with no explanation.
    if (MAP_ID) {
      mapOptions.mapId = MAP_ID;
    } else {
      console.log('MAP_ID is empty - AdvancedMarkerElement needs a Map ID, so no markers will render.');
    }
    this.googleMap = new google.maps.Map(this.mapElem, mapOptions);
    google.maps.event.addListener(this.googleMap, 'zoom_changed', () => this.syncAutoTilt());
    this.syncAutoTilt();

    this.locationMarker = new google.maps.marker.AdvancedMarkerElement({
      position: this.getPosition(),
      map: this.googleMap,
    });
    this.locationMarker.appendChild(Map.buildMarkerImage(imageMyLocation, 32));

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
    // AdvancedMarkerElement has no setPosition() - `position` is a settable
    // property instead.
    this.locationMarker.position = position;
    if (this.radiusCircle) {
      this.radiusCircle.setCenter(position);
    }
    // Functional updater that bails when the menu is already closed. This is
    // now reached from componentDidUpdate, where an unconditional setState
    // would schedule a second render pass on every recenter; returning the
    // same state object lets React skip it. (It cannot loop either way - the
    // caller is guarded on a prop change, and this touches only state.)
    this.setState((prevState) => (prevState.popUpMenuOpen ? { ...prevState, popUpMenuOpen: false } : prevState));
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
    const marker = new google.maps.marker.AdvancedMarkerElement({
      map: this.googleMap,
      position: placeLoc,
      // Required for gmp-click to fire at all - unlike google.maps.Marker,
      // AdvancedMarkerElement is inert by default.
      gmpClickable: true,
    });
    const markerImage = Map.buildMarkerImage(this.getScaleImage(place.average_rating), 34);
    marker.appendChild(markerImage);

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

    // AdvancedMarkerElement is a real HTMLElement, so hover is a plain DOM
    // event on it rather than a google.maps.event listener. As before, the
    // tooltip stays up until another marker replaces it.
    marker.addEventListener('mouseenter', () => {
      this.infowindow.setContent(content);
      this.infowindow.open(this.googleMap, marker);
    });

    marker.addEventListener('gmp-click', () => {
      this.props.showOverlay(true, `${place.name}<br/>(${typeText})`, place);
    });
  }

  clearOverlays() {
    for (let i = 0; i < this.markersArray.length; i++) {
      // AdvancedMarkerElement has no setMap() - detach by nulling `map`.
      this.markersArray[i].map = null;
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
            // Everything here runs exactly once (guarded), not on every
            // render - center/tilt/range/mode are properties the library
            // actively keeps synced to whatever's set, so passing them as
            // reactive JSX props re-applied the same initial framing on
            // every re-render (e.g. the radius slider triggering a
            // places refetch), snapping back any pan/tilt/zoom the user
            // had done. Set once here instead; componentDidUpdate
            // re-centers (only) when position changes, e.g. via "go to
            // current location".
            if (elem && !elem.dataset.karmaInitDone) {
              elem.dataset.karmaInitDone = 'true';
              elem.center = { lat, lng, altitude: 200 };
              elem.tilt = 65;
              elem.range = 1200;
              // MapMode enum name, uppercase - the property validates against
              // the enum's constant names and rejects anything else (a
              // lowercase 'hybrid' threw InvalidValueError and left the
              // element on its default, MapMode.ROADMAP, so this view showed
              // a tilted street map instead of photorealistic imagery).
              elem.mode = 'HYBRID';
              // Native click only records where on screen the user clicked,
              // for anchoring the popup menu; gmp-click (the library's own
              // event) is what carries the clicked ground position.
              elem.addEventListener('click', (event) => {
                this.lastPointerScreen = { x: event.clientX, y: event.clientY };
              });
              elem.addEventListener('gmp-click', (event) => this.onMap3dClick(event));
            }
          }}
          className="map"
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
