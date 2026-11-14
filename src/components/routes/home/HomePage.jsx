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
import SettingsIcon from 'material-ui/svg-icons/action/settings';
import HelpIcon from 'material-ui/svg-icons/action/help-outline';

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

// Language choices offered in the menu, for Google Maps' labels, place names
// and its own controls ("Map"/"Satellite" etc). 'default' deliberately sends
// no `language` parameter at all, which is what makes Maps fall back to the
// visitor's own browser language.
// Other Maps-supported codes can be added here - see
// https://developers.google.com/maps/faq#languagesupport
const MAP_LANGUAGES = [
  { value: 'default', label: 'Default (browser language)' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'uk', label: 'Українська' },
];

// There is deliberately no manual "3D buildings" option: the standard map
// is permanently on a 45-degree projection (see MAP_TILT_DEGREES in
// Map.jsx), so it was a mode nobody needed to choose. What's left is the
// genuine either/or - the ordinary vector map, or Google's separately-billed
// Photorealistic 3D Tiles.
const MAP_VIEW_MODES = [
  {
    value: 'flat',
    label: 'Standard',
    hint: '45° tilted view, with 3D buildings once you zoom in. No extra cost.',
  },
  {
    value: 'photorealistic',
    label: 'Photorealistic 3D',
    hint: 'Google\'s 3D Tiles imagery. Billed separately - needs the Map Tiles API enabled in Cloud Console.',
  },
];

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

// Where the last map position is remembered between visits, so reopening the
// page returns to wherever you left off instead of re-running geolocation.
// Deliberately its own small {lat, lng} entry rather than reusing the
// whole-state blob written in componentDidUpdate - that one carries the
// entire places array and is never read back.
const STORAGE_PREFIX = 'map';
const POSITION_STORAGE_KEY = 'lastPosition';
// Everything the Settings overlay and the menu's search controls own, in one
// entry. Position stays separate because it changes constantly (every pan
// and address lookup) while these change rarely.
const PREFS_STORAGE_KEY = 'prefs';

const MIN_DISTANCE = 100;
const MAX_DISTANCE = 50000;

// The Google place types offered in the category dropdown. Custom categories
// typed into the Add Place dialog (e.g. "Home") are appended to a copy of
// this at runtime - see the constructor and submitNewPlace.
const DEFAULT_CATEGORY_NAMES = [
  'Accounting', 'Airport', 'Amusement Park', 'Aquarium', 'Art Gallery', 'Atm', 'Bakery', 'Bank', 'Bar', 'Beauty Salon', 'Bicycle Store', 'Book Store', 'Bowling Alley', 'Bus Station', 'Cafe', 'Campground', 'Car Dealer', 'Car Rental', 'Car Repair', 'Car Wash', 'Casino', 'Cemetery', 'Church', 'City Hall', 'Clothing Store', 'Convenience Store', 'Courthouse', 'Dentist', 'Department Store', 'Doctor', 'Electrician', 'Electronics Store', 'Embassy', 'Fire Station', 'Florist', 'Funeral Home', 'Furniture Store', 'Gas Station', 'Gym', 'Hair Care', 'Hardware Store', 'Hindu Temple', 'Home Goods Store', 'Hospital', 'Insurance Agency', 'Jewelry Store', 'Laundry', 'Lawyer', 'Library', 'Liquor Store', 'Local Government Office', 'Locksmith', 'Lodging', 'Meal Delivery', 'Meal Takeaway', 'Mosque', 'Movie Rental', 'Movie Theater', 'Moving Company', 'Museum', 'Night Club', 'Painter', 'Park', 'Parking', 'Pet Store', 'Pharmacy', 'Physiotherapist', 'Plumber', 'Police', 'Post Office', 'Real Estate Agency', 'Restaurant', 'Roofing Contractor', 'Rv Park', 'School', 'Shoe Store', 'Shopping Mall', 'Spa', 'Stadium', 'Storage', 'Store', 'Subway Station', 'Synagogue', 'Taxi Stand', 'Train Station', 'Transit Station', 'Travel Agency', 'University', 'Veterinary Care', 'Zoo',
];

// Every field is validated against what the app actually accepts rather than
// trusted: this entry is user-editable (devtools, a stale build from before
// an option was renamed), and a bad value would otherwise reach the Maps API
// or leave a SelectField bound to an option that doesn't exist. Anything
// unrecognised - including the retired 'tilted' view mode - falls back to its
// default instead of being passed through.
function readStoredPrefs(storageService) {
  const defaults = {
    language: 'default', distance: null, selectedTypes: null, mapViewMode: 'flat',
  };
  try {
    const saved = storageService.getData(STORAGE_PREFIX, PREFS_STORAGE_KEY) || {};
    return {
      language: MAP_LANGUAGES.some((lang) => lang.value === saved.language)
        ? saved.language : defaults.language,
      mapViewMode: MAP_VIEW_MODES.some((mode) => mode.value === saved.mapViewMode)
        ? saved.mapViewMode : defaults.mapViewMode,
      distance: (typeof saved.distance === 'number' &&
        saved.distance >= MIN_DISTANCE && saved.distance <= MAX_DISTANCE)
        ? saved.distance : defaults.distance,
      selectedTypes: (typeof saved.selectedTypes === 'string' && saved.selectedTypes)
        ? saved.selectedTypes : defaults.selectedTypes,
    };
  } catch (e) {
    return defaults;
  }
}

export default class HomePage extends React.Component {
  constructor() {
    super();

    this.storageService = new StorageService();
    this.apiService = new ApiService();
    this.locationProvider = new LocationProvider();
    this.geocoderService = null;
    this.tokenClient = null;

    // Restored here rather than in componentDidMount so the very first
    // render and the first retrievePlaces() already use them - otherwise
    // changing the map language (which reloads the page) would visibly
    // reset the category and radius on every switch.
    const prefs = readStoredPrefs(this.storageService);
    // Authoritative copy, read before the Maps script URL is built in
    // componentDidMount - the state field below only exists to bind the UI.
    this.mapLanguage = prefs.language;

    // A restored category may be a custom one typed into Add Place ("Home"),
    // which isn't in the built-in list - append it, or the SelectField would
    // have a value matching none of its options and render blank.
    const selectedTypes = prefs.selectedTypes || 'Restaurant';
    const names = DEFAULT_CATEGORY_NAMES.slice();
    if (!names.includes(selectedTypes)) {
      names.push(selectedTypes);
    }

    this.state = {
      isLoaded: false,
      width: 0,
      height: 0,
      loaderVisible: false,
      loaderVoteText: '',
      loaderPlace: null,
      helpVisible: false,
      settingsVisible: false,
      distance: prefs.distance || 1000,
      // Mirrors this.mapLanguage so the UI has something to bind to; the
      // authoritative copy is the instance field above.
      mapLanguage: this.mapLanguage,
      // Confirmed: not read from storageService - every page load starts
      // signed out, regardless of a previous session.
      currentUser: null,
      menuVisible: false,
      inputValueAddress: '',
      // 'flat' (the ordinary vector map, which tilts itself as you zoom in)
      // or 'photorealistic' (separately billed 3D Tiles, needs the Map Tiles
      // API enabled in Cloud Console). See MAP_VIEW_MODES.
      mapViewMode: prefs.mapViewMode,
      names,
      // NOTE: production reads `this.state.selectedTypes.toLowerCase()` (a
      // single string, not the 2018 multi-select array) when calling
      // getNearbyPlaces - the menu is a single SelectField, not multi-select.
      selectedTypes,
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
    // 'default' omits the parameter entirely, which is what makes Maps fall
    // back to the visitor's browser language.
    const languageParam = this.mapLanguage === 'default' ? '' : `&language=${this.mapLanguage}`;
    loadJS(`https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,maps3d,marker&v=beta&loading=async${languageParam}&callback=HomePage.initMap`);
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
    // Remember the map position for the next visit. Hooked here rather than
    // in setPosition() because position is also set directly by the address
    // search, which bypasses setPosition entirely.
    if (this.state.position !== prevState.position) {
      this.savePosition(this.state.position);
    }
    // Persisted so the page reload that applies a map-language change (see
    // handleMapLanguageChange) doesn't throw away everything else.
    if (
      this.state.distance !== prevState.distance ||
      this.state.selectedTypes !== prevState.selectedTypes ||
      this.state.mapViewMode !== prevState.mapViewMode
    ) {
      this.savePrefs();
    }
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
      // Escape previously left the Help overlay open, which was its own
      // small bug - both overlays now dismiss with it.
      this.setState((prevState) => (
        (prevState.helpVisible || prevState.settingsVisible)
          ? { ...prevState, helpVisible: false, settingsVisible: false }
          : prevState
      ));
    }
  }

  // Restores the map to wherever it was left last time. Returns true when a
  // saved position was found and applied, so the caller knows to skip the
  // geolocation lookup (which would otherwise immediately override it - and
  // would also re-prompt for location permission on every single visit).
  restoreSavedPosition() {
    try {
      const saved = this.storageService.getData(STORAGE_PREFIX, POSITION_STORAGE_KEY);
      if (!saved || typeof saved.lat !== 'number' || typeof saved.lng !== 'number') {
        return false;
      }
      // setPosition alone is enough - componentDidUpdate sees the changed
      // position and runs retrievePlaces() itself.
      this.setPosition(new google.maps.LatLng(saved.lat, saved.lng));
      return true;
    } catch (e) {
      // Corrupt/unreadable entry (hand-edited, quota-cleared, private mode)
      // - fall through to geolocation as if there were nothing saved.
      return false;
    }
  }

  savePrefs(overrides = {}) {
    try {
      this.storageService.setData(STORAGE_PREFIX, PREFS_STORAGE_KEY, {
        distance: this.state.distance,
        selectedTypes: this.state.selectedTypes,
        mapViewMode: this.state.mapViewMode,
        language: this.mapLanguage,
        ...overrides,
      });
      return true;
    } catch (e) {
      // localStorage can throw (Safari private mode, quota) - never let
      // persistence failure break the map itself.
      return false;
    }
  }

  // Google Maps bakes `language` in when its script loads and offers no
  // runtime setter for the 2D map; it also refuses to load twice on one
  // page. So applying a new choice means reloading - which is seamless
  // because position and the rest of the prefs are persisted.
  handleMapLanguageChange = (mapLanguage) => {
    if (mapLanguage === this.state.mapLanguage) {
      return;
    }
    if (!this.savePrefs({ language: mapLanguage })) {
      // Can't persist it, so a reload would silently revert - tell the user
      // instead of appearing to do nothing.
      alert('Could not save the language setting (browser storage is unavailable).');
      return;
    }
    window.location.reload();
  }

  savePosition(position) {
    if (!position) {
      return;
    }
    try {
      const lat = typeof position.lat === 'function' ? position.lat() : position.lat;
      const lng = typeof position.lng === 'function' ? position.lng() : position.lng;
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return;
      }
      this.storageService.setData(STORAGE_PREFIX, POSITION_STORAGE_KEY, { lat, lng });
    } catch (e) {
      // localStorage can throw (Safari private mode, quota) - never let
      // persistence failure break the map itself.
    }
  }

  initMap() {
    this.geocoderService = new google.maps.Geocoder();
    this.map.initialize();

    // A remembered location wins over geolocation on startup - otherwise the
    // lookup below would snap the map straight back to where you physically
    // are, which is exactly what "remember where I left off" has to avoid.
    // The map's "go to current location" button is still there on demand.
    if (this.restoreSavedPosition()) {
      return;
    }

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

  handleMapViewModeChange = (mapViewMode) => {
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
    this.setState((prevState) => ({ ...prevState, helpVisible: false }));
  }

  openSettings = () => {
    this.setState((prevState) => ({ ...prevState, menuVisible: false, settingsVisible: true }));
  }

  closeSettings = () => {
    this.setState((prevState) => ({ ...prevState, settingsVisible: false }));
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
    const distanceLabel = this.state.distance >= 1000
      ? `${(this.state.distance / 1000).toFixed(this.state.distance % 1000 === 0 ? 0 : 1)} km`
      : `${this.state.distance} m`;

    const sliderDistance = (
      <div className="slider">
        <div className="slider-label">
          <span>Distance</span>
          <span className="slider-value">{distanceLabel}</span>
        </div>
        <Slider
          className="slider-inner"
          min={MIN_DISTANCE}
          max={MAX_DISTANCE}
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
        floatingLabelText="Find an address"
        hintText="Type an address, press Enter"
        floatingLabelFixed
        fullWidth
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
        floatingLabelText="Category"
        value={this.state.selectedTypes}
        onChange={this.handleTypesChange}
        fullWidth
      >
        {this.menuItems()}
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
        {/* disableAutoFocus is REQUIRED here, not cosmetic. Without it,
            Menu.componentWillReceiveProps resets focusIndex to 0 on every
            prop change; Menu then marks child 0 as focusState="focused",
            and MenuItem.componentDidUpdate -> applyFocusState() calls
            buttonEl.focus() on it. Since every keystroke in the address
            field re-renders HomePage (and so re-renders this Menu), the
            first menu item stole focus back after every single character.
            disableAutoFocus pins focusIndex to -1, so no child is ever
            marked focused and nothing grabs focus. This menu is a settings
            panel containing real inputs, not a dropdown list, so it should
            never have been auto-focusing its first row anyway. */}
        {/* autoWidth={false} matters too: Menu otherwise measures its
            children and writes an inline px width, which fought the width
            declared in HomePage.scss and clipped the right-hand end of the
            distance row. Width is CSS's job here. */}
        <Menu className="main-menu" disableAutoFocus autoWidth={false}>
          {myProfilePlaceholder}
          {loginPlaceholder}
          {logoutPlaceholder}
          <div className="menu-divider" />
          <div className="menu-section">
            {menuGeocoder}
            {placesCategory}
            {sliderDistance}
          </div>
          <div className="menu-divider" />
          <MenuItem
            className="menu-link"
            primaryText="Settings"
            leftIcon={<SettingsIcon />}
            onClick={this.openSettings}
          />
          <MenuItem
            className="menu-link"
            primaryText="Help &amp; feedback"
            leftIcon={<HelpIcon />}
            onClick={this.openHelp}
          />
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

    // Both overlays share .overlay-backdrop / .overlay-card (see
    // HomePage.scss) instead of the inline-style blocks these used to carry,
    // so Help and Settings stay visually identical by construction.
    const overlayCard = (title, onClose, body) => (
      <div className="overlay-backdrop" onClick={onClose}>
        <div className="overlay-card" onClick={(e) => e.stopPropagation()}>
          <div className="overlay-head">
            <h2>{title}</h2>
            <button type="button" className="overlay-close" aria-label="Close" onClick={onClose}>
              &times;
            </button>
          </div>
          {body}
        </div>
      </div>
    );

    const helpOverlay = this.state.helpVisible && overlayCard('About Karma Meter', this.closeHelp, (
      <div className="overlay-body">
        <p>
          Karma Meter shows nearby places on the map, color-coded by their community rating, and lets you weigh in on them.
        </p>
        <ul>
          <li>Markers are colored by rating: red (bad) through green (good), gray for no rating yet.</li>
          <li>Hover a marker for a preview photo and a link to view it on Google Maps.</li>
          <li>Click a marker to fix its karma &mdash; vote it up or down.</li>
          <li>Use the category dropdown and distance slider to change what shows up nearby.</li>
          <li>Type an address and press Enter to search a different location.</li>
          <li>Tap the target button on the map to jump back to your current location.</li>
          <li>The map sits at a 45&deg; angle &mdash; zoom in to see buildings in 3D.</li>
          <li>Sign in with Google so your votes are attributed to your name.</li>
        </ul>
        <p>
          Questions or feedback?{' '}
          <a href="mailto:olturua@gmail.com?subject=Karma%20Meter%20feedback">
            olturua@gmail.com
          </a>
        </p>
      </div>
    ));

    const settingsOverlay = this.state.settingsVisible && overlayCard('Settings', this.closeSettings, (
      <div className="overlay-body settings">
        <h3>Map</h3>

        <div className="setting">
          <div className="setting-label">View</div>
          {MAP_VIEW_MODES.map((mode) => (
            <label className="choice" key={mode.value}>
              <input
                type="radio"
                name="mapViewMode"
                value={mode.value}
                checked={this.state.mapViewMode === mode.value}
                onChange={() => this.handleMapViewModeChange(mode.value)}
              />
              <span className="choice-text">
                <span className="choice-label">{mode.label}</span>
                <span className="choice-hint">{mode.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="setting">
          <div className="setting-label" id="map-language-label">Language</div>
          <select
            className="setting-select"
            aria-labelledby="map-language-label"
            value={this.state.mapLanguage}
            onChange={(e) => this.handleMapLanguageChange(e.target.value)}
          >
            {MAP_LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>{lang.label}</option>
            ))}
          </select>
          <div className="setting-hint">
            Changing this reloads the page &mdash; Google Maps only reads the
            language when it first loads. Your location and search settings are kept.
          </div>
        </div>
      </div>
    ));

    const addPlaceDialogActions = [
      <Button key="cancel" onClick={this.closeAddPlaceForm}>Cancel</Button>,
      <Button key="save" onClick={this.submitNewPlace} theme="green">Save</Button>,
    ];

    // Mounted ONLY while open, never kept in the tree closed. material-ui
    // 0.x's Dialog hands its RenderToLayer a hardcoded `open: true`
    // (Dialog.js:493) regardless of the Dialog's own open prop, so a mounted
    // dialog keeps a <div> on document.body and re-renders its entire
    // subtree through unstable_renderSubtreeIntoContainer on every parent
    // render. That stole focus from the address field on every keystroke.
    const addPlaceDialog = !this.state.addPlaceDialogOpen ? null : (
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
          {settingsOverlay}
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
