/*global google*/
import React from 'react';
import debounce from 'lodash/debounce';
import Button from 'components/ui/Button/Button';

import Paper from 'material-ui/Paper';
import Menu from 'material-ui/Menu';
import MenuItem from 'material-ui/MenuItem';
import SelectField from 'material-ui/SelectField';
import TextField from 'material-ui/TextField';
import AutoComplete from 'material-ui/AutoComplete';
import Dialog from 'material-ui/Dialog';
import Loader from 'react-loader-advanced';

import Login from 'material-ui/svg-icons/action/flight-land';
import Logout from 'material-ui/svg-icons/action/flight-takeoff';
import Account from 'material-ui/svg-icons/action/account-box';

import Slider from 'material-ui/Slider';

import StorageService from '../../../tools/storage-service';
import Helpers from '../../../tools/helpers';
import ApiService from '../../../tools/api-service';
import LocationProvider from '../../../tools/location-provider';
import Map from '../../business/map/Map';
import loadJS from '../../../tools/load-js';

import './HomePage.scss';

// The Google Cloud OAuth client originally wired up here
// (19471878870-td25jvej2kq8jn7n622ttutvat4lbkvm.apps.googleusercontent.com)
// was deleted on Google's side at some point ("Error 401: deleted_client").
// Recreated 2026-11-12 as a fresh Web application OAuth client restricted to
// https://karmameter.net / https://www.karmameter.net. Only the Client ID
// goes here - this is a client-side-only flow and never needs (or should
// ever be given) the matching client secret.
const GOOGLE_OAUTH_CLIENT_ID = '1048915032471-9q645get1onsk8lt5l847tceisqu7aq3.apps.googleusercontent.com';

// Public, browser-restricted (HTTP referrer) Maps JavaScript API key -
// restricted to this domain in Google Cloud Console, same as it ships today.
const GOOGLE_MAPS_API_KEY = 'AIzaSyBjBVO0J-a0PT30d-9lieKa9ygFnN8J1GA';

// Only these Google accounts may actually sign in - anyone else's token is
// fetched successfully (OAuth itself succeeds) but rejected client-side
// before setCurrentUser ever runs.
const ALLOWED_EMAILS = ['olturua@gmail.com', 'banderhelen@gmail.com'];

// Geolocation options shared by the initial-load and "go to current
// location" lookups. No timeout was set here originally, which meant a
// permission prompt that never got answered (slow user, or an automated/
// embedded browser context with no one to click it) left the lookup pending
// forever instead of failing gracefully.
const GEOLOCATION_OPTIONS = { timeout: 10000, maximumAge: 60000 };

export default class HomePage extends React.Component {
  constructor() {
    super();

    this.storageService = new StorageService();
    this.apiService = new ApiService();
    this.locationProvider = new LocationProvider();
    this.geocoderService = null;
    this.tokenClient = null;

    this.state = {
      isLoaded: false,
      width: 0,
      height: 0,
      loaderVisible: false,
      loaderVoteText: '',
      loaderPlace: null,
      helpVisible: false,
      distance: 1000,
      // Confirmed: not read from storageService - every page load starts
      // signed out, regardless of a previous session.
      currentUser: null,
      menuVisible: false,
      inputValueAddress: '',
      // 'flat' (default, no extra cost) - 'tilted' (free 3D-buildings tilt,
      // needs a vector Map ID - see MAP_ID in Map.jsx) - 'photorealistic'
      // (separately billed Photorealistic 3D Tiles, needs the Map Tiles API
      // enabled in Cloud Console).
      mapViewMode: 'flat',
      names: [
        'Accounting', 'Airport', 'Amusement Park', 'Aquarium', 'Art Gallery', 'Atm', 'Bakery', 'Bank', 'Bar', 'Beauty Salon', 'Bicycle Store', 'Book Store', 'Bowling Alley', 'Bus Station', 'Cafe', 'Campground', 'Car Dealer', 'Car Rental', 'Car Repair', 'Car Wash', 'Casino', 'Cemetery', 'Church', 'City Hall', 'Clothing Store', 'Convenience Store', 'Courthouse', 'Dentist', 'Department Store', 'Doctor', 'Electrician', 'Electronics Store', 'Embassy', 'Fire Station', 'Florist', 'Funeral Home', 'Furniture Store', 'Gas Station', 'Gym', 'Hair Care', 'Hardware Store', 'Hindu Temple', 'Home Goods Store', 'Hospital', 'Insurance Agency', 'Jewelry Store', 'Laundry', 'Lawyer', 'Library', 'Liquor Store', 'Local Government Office', 'Locksmith', 'Lodging', 'Meal Delivery', 'Meal Takeaway', 'Mosque', 'Movie Rental', 'Movie Theater', 'Moving Company', 'Museum', 'Night Club', 'Painter', 'Park', 'Parking', 'Pet Store', 'Pharmacy', 'Physiotherapist', 'Plumber', 'Police', 'Post Office', 'Real Estate Agency', 'Restaurant', 'Roofing Contractor', 'Rv Park', 'School', 'Shoe Store', 'Shopping Mall', 'Spa', 'Stadium', 'Storage', 'Store', 'Subway Station', 'Synagogue', 'Taxi Stand', 'Train Station', 'Transit Station', 'Travel Agency', 'University', 'Veterinary Care', 'Zoo',
      ],
      // NOTE: production reads `this.state.selectedTypes.toLowerCase()` (a
      // single string, not the 2018 multi-select array) when calling
      // getNearbyPlaces - the menu is a single SelectField, not multi-select.
      selectedTypes: 'Restaurant',
      places: [],
      placesVersion: 0,
      position: null,
      // "Add a new place" dialog, opened via Map.jsx's addPlace() (the map's
      // right-click/tap "Add place" menu item). newPlaceCategory is free
      // text, not restricted to `names` above - typing e.g. "Home" both
      // saves the place under that category and adds it to `names` so it
      // becomes a real, selectable search category afterwards.
      addPlaceDialogOpen: false,
      newPlaceName: '',
      newPlaceCategory: '',
      newPlaceLocation: null,
    };

    this.map = null;

    this.placeholderLoginGoogle = null;
    this.placeholderLogoutGoogle = null;
    this.placeholderProfile = null;
    this.textFieldAddress = null;

    this.updateWindowDimensions = this.updateWindowDimensions.bind(this);
    this.keyDownHandler = this.keyDownHandler.bind(this);

    this.showOverlay = this.showOverlay.bind(this);
    this.closeMenu = this.closeMenu.bind(this);
    this.upVote = this.upVote.bind(this);
    this.downVote = this.downVote.bind(this);
    this.logoutGoogle = this.logoutGoogle.bind(this);
    this.handleOauthToken = this.handleOauthToken.bind(this);
    this.voteFromMarker = this.voteFromMarker.bind(this);
    this.recenterToCurrentLocation = this.recenterToCurrentLocation.bind(this);
    this.setPosition = this.setPosition.bind(this);
    this.retrievePlaces = this.retrievePlaces.bind(this);
    this.openAddPlaceForm = this.openAddPlaceForm.bind(this);
    this.closeAddPlaceForm = this.closeAddPlaceForm.bind(this);
    this.submitNewPlace = this.submitNewPlace.bind(this);
    this.handleAddressKeyDown = this.handleAddressKeyDown.bind(this);
    this.handleUpdateAddressValue = this.handleUpdateAddressValue.bind(this);
  }

  componentDidMount() {
    this.updateWindowDimensions();
    window.HomePage = this;
    // v=beta + the maps3d library are required to make the Photorealistic
    // 3D Tiles element (<gmp-map-3d>) available at all - harmless to load
    // even when the "Photorealistic 3D" view is never selected, it only
    // bills when that view actually renders tiles.
    // loading=async is Google's recommended loading pattern (the API logs a
    // performance warning without it); the callback still fires as before.
    loadJS(`https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,maps3d,marker&v=beta&loading=async&callback=HomePage.initMap`);
    window.addEventListener('resize', this.updateWindowDimensions);
    document.addEventListener('keydown', this.keyDownHandler, false);
    this.loadGoogleIdentityServices();
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.updateWindowDimensions);
    document.removeEventListener('keydown', this.keyDownHandler, false);
  }

  // Confirmed from production: every state update is persisted (debug/
  // crash-recovery trail, nothing currently reads it back on mount), and a
  // change to distance/position/selectedTypes re-triggers retrievePlaces()
  // here too, on top of whichever setState callback already did so above -
  // redundant but harmless, matching the live behavior exactly.
  componentDidUpdate(prevProps, prevState) {
    this.storageService.setData('state', 'current', this.state);
    if (
      this.state.distance !== prevState.distance ||
      this.state.position !== prevState.position ||
      this.state.selectedTypes !== prevState.selectedTypes
    ) {
      try {
        this.retrievePlaces();
      } catch (e) {
        // matches production - swallowed
      }
    }
  }

  // Sign-In went through two prior approaches this session before landing
  // here, in order:
  //   1. react-google-login (legacy gapi.auth2) - the OAuth client it used
  //      was deleted on Google's side ("Error 401: deleted_client").
  //   2. Google Identity Services' ID-token button (google.accounts.id.
  //      initialize + renderButton) - worked in principle, but the branded
  //      button rendered into a plain MenuItem.primaryText element via a
  //      ref, and that ref reliably failed to fire at the right time through
  //      this old Material-UI version's handling of element (vs string)
  //      primaryText - the button silently never appeared on a real, fresh
  //      page load, only when manually retried.
  // The OAuth 2.0 popup token-client flow below sidesteps all of that: no
  // iframe/button widget to render at all, just a plain "Log in" click that
  // opens Google's real popup directly.
  loadGoogleIdentityServices() {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      try {
        this.tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_OAUTH_CLIENT_ID,
          scope: 'openid profile email',
          callback: (tokenResponse) => this.handleOauthToken(tokenResponse),
        });
        this.setState({ ...this.state, gisReady: true });
      } catch (e) {
        console.log('GIS init failed', e);
      }
    };
    document.head.appendChild(script);
  }

  handleOauthToken(tokenResponse) {
    if (!tokenResponse || !tokenResponse.access_token) {
      return;
    }
    fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
    })
      .then(r => r.json())
      .then((info) => {
        if (!info.email || !ALLOWED_EMAILS.includes(info.email.toLowerCase())) {
          alert('This Google account is not authorized to sign in to Karma Meter.');
          if (window.google && window.google.accounts && window.google.accounts.oauth2) {
            window.google.accounts.oauth2.revoke(tokenResponse.access_token, () => {});
          }
          return;
        }
        this.setCurrentUser({
          profileObj: {
            googleId: info.sub,
            imageUrl: info.picture,
            email: info.email,
            name: info.name,
            givenName: info.given_name,
            familyName: info.family_name,
          },
        });
      })
      .catch(e => console.log('userinfo fetch failed', e));
  }

  toogleMenu() {
    this.setState({
      ...this.state,
      menuVisible: !this.state.menuVisible,
    });
  }

  closeMenu() {
    // Must use the functional updater, not a `{...this.state, ...}` copy taken
    // at call time: this is frequently called right after another setState
    // in the same handler (e.g. handleTypesChange), and React batches both
    // calls together. A stale-snapshot copy here would silently stomp
    // whatever the preceding call just set back to its old value - this
    // exact bug shipped and broke the category dropdown in production.
    this.setState((prevState) => (prevState.menuVisible ? { ...prevState, menuVisible: false } : prevState));
  }

  setCurrentUser(userData) {
    // Confirmed: no storageService persistence - signing in only affects
    // this render, a refresh always starts signed out again.
    this.setState({
      ...this.state,
      currentUser: userData,
    });
  }

  logoutGoogle() {
    this.setCurrentUser(null);
  }

  showOverlay(show, voteText = '', place = null) {
    this.setState({
      ...this.state,
      loaderVisible: show,
      loaderVoteText: voteText,
      loaderPlace: place,
    });
  }

  // Opens the "Add a new place" dialog - triggered from Map.jsx's addPlace()
  // (the "Add place" item on the map's click popup menu, in all three
  // views).
  openAddPlaceForm(location) {
    this.setState({
      ...this.state,
      addPlaceDialogOpen: true,
      newPlaceName: '',
      newPlaceCategory: '',
      newPlaceLocation: location,
    });
  }

  closeAddPlaceForm() {
    this.setState({ ...this.state, addPlaceDialogOpen: false });
  }

  submitNewPlace() {
    const { newPlaceName, newPlaceCategory, newPlaceLocation } = this.state;
    const name = newPlaceName.trim();
    const category = newPlaceCategory.trim();
    if (!name || !category || !newPlaceLocation) {
      return;
    }

    // newPlaceLocation is a real google.maps.LatLng (lat()/lng() methods)
    // when it came from a 2D/tilted map click, or a plain {lat, lng} object
    // when it came from the Photorealistic 3D view's gmp-click position
    // (see Map.jsx's onMap3dClick) - handle both.
    const lat = typeof newPlaceLocation.lat === 'function' ? newPlaceLocation.lat() : newPlaceLocation.lat;
    const lng = typeof newPlaceLocation.lng === 'function' ? newPlaceLocation.lng() : newPlaceLocation.lng;

    // Custom categories aren't restricted to the Google place types list -
    // "Home" becomes types: ['home'], same shape nearbySearch already
    // expects for Google-sourced types, just user-defined instead.
    const typeKey = category.toLowerCase().replace(/\s+/g, '_');
    const place = {
      place_id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`,
      name,
      types: [typeKey],
      geometry: {
        location: { lat, lng },
      },
    };

    this.apiService.createPlace(place).then(() => {
      this.setState((prevState) => ({
        ...prevState,
        addPlaceDialogOpen: false,
        // Make the custom category immediately searchable/selectable, same
        // as any built-in one, and switch to it so the new place shows up
        // on the map right away without an extra manual step.
        names: prevState.names.includes(category) ? prevState.names : [...prevState.names, category],
        selectedTypes: category,
      }), () => {
        this.retrievePlaces();
      });
    });
  }

  // Invoked from the raw HTML onclick inside a marker's hover tooltip
  // (google.maps.InfoWindow content isn't part of the React tree, so it
  // can only call back in through window.HomePage) - looks the place up by
  // id from state rather than relying on any global registry.
  voteFromMarker(placeId) {
    const place = this.state.places.find(p => p.place_id === placeId);
    if (!place) {
      return;
    }
    const typeText = Helpers.decodeGoogleLocationName(place.types[0]);
    this.showOverlay(true, `${place.name}<br/>(${typeText})`, place);
  }

  upVote(place) {
    this.apiService.updatePlaceRating(place, true);
    this.setState({
      ...this.state,
      loaderVisible: false,
      loaderVoteText: '',
    }, () => {
      this.retrievePlaces();
    });
  }

  downVote(place) {
    this.apiService.updatePlaceRating(place, false);
    this.setState({
      ...this.state,
      loaderVisible: false,
      loaderVoteText: '',
    }, () => {
      this.retrievePlaces();
    });
  }

  updateWindowDimensions() {
    this.setState({ ...this.state, width: window.innerWidth, height: window.innerHeight });
  }

  keyDownHandler(event) {
    if (event.keyCode === 27) {
      this.showOverlay(false);
      this.closeMenu();
    }
  }

  initMap() {
    this.geocoderService = new google.maps.Geocoder();
    this.map.initialize();
    this.locationProvider.getPosition(GEOLOCATION_OPTIONS)
      .then((position) => {
        this.setPosition(new google.maps.LatLng(position.coords.latitude, position.coords.longitude));
        this.retrievePlaces();
      })
      .catch((err) => {
        // Previously an empty catch - the map silently stayed on the
        // hardcoded (31, 35) fallback with zero indication why. Now at
        // least tells the user what happened and what to do about it.
        if (err.code === 1) {
          alert(
            "Karma Meter needs your location to show nearby places. Please allow location " +
            "access for this site in your browser's settings, then reload the page.",
          );
        } else {
          alert(`Could not get your location (${err && err.message || 'unknown error'}). Showing a default location instead.`);
        }
      });
  }

  // Same geolocation success/failure handling as initMap(), triggered by
  // the map's "go to current location" button instead of the initial load.
  recenterToCurrentLocation() {
    this.locationProvider.getPosition(GEOLOCATION_OPTIONS)
      .then((position) => {
        this.setPosition(new google.maps.LatLng(position.coords.latitude, position.coords.longitude));
        this.retrievePlaces();
      })
      .catch((err) => {
        if (err.code === 1) {
          alert(
            "Karma Meter needs your location to show nearby places. Please allow location " +
            "access for this site in your browser's settings, then reload the page.",
          );
        } else {
          alert(`Could not get your location (${err && err.message || 'unknown error'}). Showing a default location instead.`);
        }
      });
  }

  setPosition(position) {
    this.setState({
      ...this.state,
      position,
    });
  }

  retrievePlaces() {
    const request = {
      location: this.state.position,
      radius: this.state.distance,
      type: this.state.selectedTypes.toLowerCase().replace(/\s/g, '_'),
    };

    this.apiService.getNearbyPlaces(request).then((places) => {
      this.setState({
        ...this.state,
        places,
        placesVersion: this.state.placesVersion + 1,
      }, () => {
        this.map.fillMarkers();
      });
    }, (err) => {
      this.setState({ ...this.state, isLoaded: true, error: err });
    });
  }

  handleDistanceSlider = (event, value) => {
    this.setState({ ...this.state, distance: value }, () => {
      this.retrievePlaces();
    });
  };

  handleTypesChange = (event, index, selectedTypes) => {
    this.setState({ ...this.state, selectedTypes }, () => {
      this.retrievePlaces();
    });
    this.closeMenu();
  }

  handleMapViewModeChange = (event, index, mapViewMode) => {
    // Functional updater - see the comment on closeMenu() for why a plain
    // {...this.state} snapshot here would risk stomping another setState
    // queued in the same batch.
    this.setState(prevState => ({ ...prevState, mapViewMode }));
  }

  handleUpdateAddressValue(evt) {
    this.setState({
      ...this.state,
      inputValueAddress: evt.target.value,
    });
  }

  handleAddressKeyDown = (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      this.geocoderService.geocode(
        {
          address: this.state.inputValueAddress,
        },
        (results, status) => {
          if (status === 'OK') {
            this.setState({ ...this.state, position: results[0].geometry.location, menuVisible: false });
            this.retrievePlaces();
          } else {
            alert('Geocode was not successful for the following reason: ' + status);
          }
        },
      );
    }
  }

  openHelp = () => {
    // One atomic update, not closeMenu() + a separate setState - two
    // chained stale-snapshot setState calls in the same handler stomp each
    // other (see the comment on closeMenu above).
    this.setState((prevState) => ({ ...prevState, menuVisible: false, helpVisible: true }));
  }

  closeHelp = () => {
    this.setState({ ...this.state, helpVisible: false });
  }

  menuItems() {
    return this.state.names.map((name) => (
      <MenuItem
        key={name.toLowerCase().replace(/\s/g, '_')}
        value={name}
        primaryText={Helpers.decodeGoogleLocationName(name)}
      />
    ));
  }

  render() {
    const sliderDistance = (
      <div className="slider">
        <div className="slider-label">Distance: {this.state.distance} m.</div>
        <Slider
          className="slider-inner"
          min={100}
          max={50000}
          step={100}
          value={this.state.distance}
          onChange={debounce(this.handleDistanceSlider, 300)}
        />
      </div>
    );

    const menuGeocoder = (
      <TextField
        className="geocoder"
        ref={(elem) => { this.textFieldAddress = elem; }}
        floatingLabelText="Enter an address to look for"
        floatingLabelFixed
        onKeyDown={(event) => this.handleAddressKeyDown(event)}
        value={this.state.inputValueAddress}
        onChange={evt => this.handleUpdateAddressValue(evt)}
      />
    );

    const profileIcon = (this.state.currentUser && this.state.currentUser.profileObj.imageUrl)
      ? <img src={this.state.currentUser.profileObj.imageUrl} style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
      : <Account />;

    const myProfilePlaceholder = this.state.currentUser ?
      (
        <MenuItem
          ref={(elem) => { this.placeholderProfile = elem; }}
          primaryText={this.state.currentUser.profileObj.name}
          leftIcon={profileIcon}
        />
      ) :
      (
        <MenuItem ref={(elem) => { this.placeholderProfile = elem; }} primaryText="Anonymous" leftIcon={<Account />} />
      );

    // Explicitly a plain text trigger, not Google's branded Sign-In button -
    // see the comment on loadGoogleIdentityServices() for why.
    const loginPlaceholder = !this.state.currentUser ?
      (
        <MenuItem
          className="login"
          ref={(elem) => { this.placeholderLoginGoogle = elem; }}
          primaryText={(
            <div
              onClick={() => this.tokenClient && this.tokenClient.requestAccessToken()}
              style={{ cursor: 'pointer' }}
            >
              Log in
            </div>
          )}
          leftIcon={<Login />}
        />
      ) : null;

    const logoutPlaceholder = this.state.currentUser ?
      (
        <MenuItem
          className="logout"
          ref={(elem) => { this.placeholderLogoutGoogle = elem; }}
          primaryText={(
            <div onClick={() => this.logoutGoogle()} style={{ cursor: 'pointer' }}>
              Logout
            </div>
          )}
          leftIcon={<Logout />}
        />
      ) : null;

    const placesCategory = (
      <SelectField
        className="places-category"
        floatingLabelText="Choose places category"
        value={this.state.selectedTypes}
        onChange={this.handleTypesChange}
      >
        {this.menuItems()}
      </SelectField>
    );

    // Lets you compare the two 3D options side by side: the free vector-tilt
    // "3D Buildings" view (needs a Map ID - see MAP_ID in Map.jsx, otherwise
    // it just tilts the camera over whatever imagery is loaded) versus the
    // separately-billed Photorealistic 3D Tiles view (needs the Map Tiles
    // API enabled in Cloud Console - see Map.jsx for details).
    const mapViewSelector = (
      <SelectField
        className="map-view-mode"
        floatingLabelText="Map view (3D comparison)"
        value={this.state.mapViewMode}
        onChange={this.handleMapViewModeChange}
      >
        <MenuItem value="flat" primaryText="Standard (2D)" />
        <MenuItem value="tilted" primaryText="3D Buildings (free)" />
        <MenuItem value="photorealistic" primaryText="Photorealistic 3D (billed)" />
      </SelectField>
    );

    // Replaced the generic Material "dehaze" hamburger glyph with the app's
    // own logo mark (a bold blue-circle "K", same as the favicon - the old
    // tiny "KARMA" wordmark was illegible at real favicon sizes). The
    // marginTop compensates for `.menu { top: -15px }` in HomePage.scss,
    // which was tuned for the old font-icon's own line-height padding and
    // clips a plain SVG div without it.
    const hamburgerIcon = (
      <div
        style={{ marginTop: '15px', display: 'inline-block' }}
        dangerouslySetInnerHTML={{
          __html: '<svg width="40" height="40" viewBox="0 0 40 40">' +
            '<circle cx="20" cy="20" r="19" fill="#2a78d6"/>' +
            '<text x="20" y="27.5" font-family="Arial,Helvetica,sans-serif" font-weight="900" ' +
            'font-size="23" fill="#fff" text-anchor="middle">K</text></svg>',
        }}
      />
    );

    const mainMenu = (
      <Paper className="main-menu-paper">
        <Menu className="main-menu">
          {myProfilePlaceholder}
          {loginPlaceholder}
          {logoutPlaceholder}
          {placesCategory}
          {mapViewSelector}
          <MenuItem primaryText={sliderDistance} />
          {menuGeocoder}
          <MenuItem primaryText="Help &amp; feedback" onClick={this.openHelp} />
        </Menu>
      </Paper>
    );

    const menu =
      (
        <div className="menu">
          <div
            role="link"
            tabIndex={0}
            className="hamburger-link"
            onClick={() => this.toogleMenu()}
            onKeyPress={(event) => {
              if (event.keyCode === 32) { this.toogleMenu(); }
            }}
          >
            {hamburgerIcon}
          </div>
          {this.state.menuVisible ? mainMenu : null}
        </div>
      );

    const placePhotoUrl = (this.state.loaderPlace && this.state.loaderPlace.photos && this.state.loaderPlace.photos[0])
      ? Helpers.getPhotoUrl(this.state.loaderPlace.photos[0].photo_reference, 360)
      : null;

    const loaderContent =
      (
        // Click-anywhere-to-dismiss - deliberately only on this branch, not
        // the "add new place" form below, so a stray click can't silently
        // discard whatever the user was typing there.
        <div className="the-choice-overlay" onClick={() => this.showOverlay(false)}>
          <div className="text">
            Fix the karma of
          </div>
          <div className="name" dangerouslySetInnerHTML={{ __html: this.state.loaderVoteText }} />
          {placePhotoUrl && (
            <img
              src={placePhotoUrl}
              onError={(e) => { e.target.style.display = 'none'; }}
              style={{
                display: 'block', margin: '0 auto 16px auto', width: '100%',
                maxWidth: '360px', height: '220px', objectFit: 'cover', borderRadius: '8px',
              }}
            />
          )}
          {this.state.loaderPlace && this.state.loaderPlace.url && (
            <a
              href={this.state.loaderPlace.url}
              target="_blank"
              rel="noopener"
              style={{ display: 'block', marginBottom: '8px', fontSize: '13px' }}
            >
              View on Google Maps
            </a>
          )}
          <div className="buttons">
            <Button onClick={() => { this.upVote(this.state.loaderPlace); }} theme="green"><i className="material-icons">thumb_up</i></Button>
            <Button onClick={() => { this.downVote(this.state.loaderPlace); }} theme="red"><i className="material-icons">thumb_down</i></Button>
          </div>
          <div className="links">
            <div
              role="link"
              tabIndex={0}
              onKeyPress={(event) => {
                if (event.keyCode === 32) { this.showOverlay(false); }
              }}
              onClick={() => { this.showOverlay(false); return false; }}
            >
              Maybe next time
            </div>
          </div>
        </div>
      );

    const helpOverlay = this.state.helpVisible && (
      <div
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,.5)',
          zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        onClick={this.closeHelp}
      >
        <div
          style={{
            background: '#fff', maxWidth: 420, width: '90%', borderRadius: 8, padding: 24,
            boxShadow: '0 4px 24px rgba(0,0,0,.3)', fontFamily: 'system-ui,-apple-system,Segoe UI,sans-serif',
            color: '#222', maxHeight: '85vh', overflow: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>About Karma Meter</h2>
            <span
              role="button"
              tabIndex={0}
              onClick={this.closeHelp}
              style={{ cursor: 'pointer', fontSize: 22, lineHeight: 1, color: '#888', padding: '0 4px' }}
            >
              &times;
            </span>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.5 }}>
            Karma Meter shows nearby places on the map, color-coded by their community rating, and lets you weigh in on them.
          </p>
          <ul style={{ margin: '0 0 16px', paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>
            <li>Markers are colored by rating: red (bad) through green (good), gray for no rating yet.</li>
            <li>Hover a marker for a preview photo and a link to view it on Google Maps.</li>
            <li>Click a marker to fix its karma &mdash; vote it up or down.</li>
            <li>Use the category dropdown and distance slider to change what shows up nearby.</li>
            <li>Type an address and press Enter to search a different location.</li>
            <li>Tap the target button on the map to jump back to your current location.</li>
            <li>Sign in with Google so your votes are attributed to your name.</li>
          </ul>
          <p style={{ margin: 0, fontSize: 14 }}>
            Questions or feedback?{' '}
            <a href="mailto:olturua@gmail.com?subject=Karma%20Meter%20feedback" style={{ color: '#2a78d6' }}>
              olturua@gmail.com
            </a>
          </p>
        </div>
      </div>
    );

    const addPlaceDialogActions = [
      <Button key="cancel" onClick={this.closeAddPlaceForm}>Cancel</Button>,
      <Button key="save" onClick={this.submitNewPlace} theme="green">Save</Button>,
    ];

    const addPlaceDialog = (
      <Dialog
        title="Add a new place"
        open={this.state.addPlaceDialogOpen}
        onRequestClose={this.closeAddPlaceForm}
        actions={addPlaceDialogActions}
        autoScrollBodyContent
      >
        <TextField
          floatingLabelText="Place name"
          fullWidth
          value={this.state.newPlaceName}
          onChange={(evt) => this.setState({ ...this.state, newPlaceName: evt.target.value })}
        />
        <AutoComplete
          floatingLabelText="Category - pick one or type your own (e.g. Home)"
          fullWidth
          openOnFocus
          filter={AutoComplete.caseInsensitiveFilter}
          dataSource={this.state.names}
          searchText={this.state.newPlaceCategory}
          onUpdateInput={(value) => this.setState({ ...this.state, newPlaceCategory: value })}
          onNewRequest={(value) => this.setState({ ...this.state, newPlaceCategory: value })}
        />
      </Dialog>
    );

    const result = (
      <Loader show={this.state.loaderVisible} message={loaderContent}>
        <div>
          {menu}
          {helpOverlay}
          {addPlaceDialog}
          <Map
            ref={(elem) => { this.map = elem; }}
            height={this.state.height}
            places={this.state.places}
            placesVersion={this.state.placesVersion}
            position={this.state.position}
            distance={this.state.distance}
            setPosition={this.setPosition}
            showOverlay={this.showOverlay}
            closeMenu={this.closeMenu}
            currentUser={this.state.currentUser}
            mapViewMode={this.state.mapViewMode}
            openAddPlaceForm={this.openAddPlaceForm}
          />
        </div>
      </Loader>
    );

    return result;
  }
}
