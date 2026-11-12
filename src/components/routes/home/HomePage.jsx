/*global google*/
import React from 'react';
import debounce from 'lodash/debounce';
import { GoogleLogin, GoogleLogout } from 'react-google-login';
import Button from 'components/ui/Button/Button';

import Paper from 'material-ui/Paper';
import Menu from 'material-ui/Menu';
import MenuItem from 'material-ui/MenuItem';
import SelectField from 'material-ui/SelectField';
import TextField from 'material-ui/TextField';
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
// goes here - this is a client-side-only Sign-In flow and never needs (or
// should ever be given) the matching client secret.
const GOOGLE_OAUTH_CLIENT_ID = '1048915032471-9q645get1onsk8lt5l847tceisqu7aq3.apps.googleusercontent.com';

// Public, browser-restricted (HTTP referrer) Maps JavaScript API key -
// restricted to this domain in Google Cloud Console, same as it ships today.
const GOOGLE_MAPS_API_KEY = 'AIzaSyBjBVO0J-a0PT30d-9lieKa9ygFnN8J1GA';

export default class HomePage extends React.Component {
  constructor() {
    super();

    this.storageService = new StorageService();
    this.apiService = new ApiService();
    this.locationProvider = new LocationProvider();
    this.geocoderService = null;

    this.state = {
      isLoaded: false,
      width: 0,
      height: 0,
      loaderVisible: false,
      loaderText: '',
      distance: 1000,
      currentUser: this.storageService.getData('user', 'current'),
      menuVisible: false,
      inputValueAddress: '',
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
      newPlaceName: '',
      // NOTE: inferred field for the "add a new place" flow
      // (createPlace / addPlace in Map.jsx); not reverse-engineered in full
      // this session.
      newPlaceSelectedTypes: [],
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
    this.upVote = this.upVote.bind(this);
    this.downVote = this.downVote.bind(this);
    this.loginGoogle = this.loginGoogle.bind(this);
    this.logoutGoogle = this.logoutGoogle.bind(this);
    this.errorGoogle = this.errorGoogle.bind(this);
    this.setPosition = this.setPosition.bind(this);
    this.retrievePlaces = this.retrievePlaces.bind(this);
    this.handleAddressKeyDown = this.handleAddressKeyDown.bind(this);
    this.handleUpdateAddressValue = this.handleUpdateAddressValue.bind(this);
  }

  componentDidMount() {
    this.updateWindowDimensions();
    window.HomePage = this;
    loadJS(`https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places&callback=HomePage.initMap`);
    window.addEventListener('resize', this.updateWindowDimensions);

    document.addEventListener('keydown', this.keyDownHandler, false);
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.updateWindowDimensions);
    document.removeEventListener('keydown', this.keyDownHandler, false);
  }

  toogleMenu() {
    this.setState({
      ...this.state,
      menuVisible: !this.state.menuVisible,
    });
  }

  // KNOWN ISSUE (under separate, live investigation as of 2026-11-12):
  // after a successful Google Sign-In, the menu still shows "Anonymous"
  // instead of the signed-in user's name. loginGoogle() is reconstructed
  // here faithfully to the best of our knowledge; the actual root cause
  // (e.g. a response-shape mismatch between the react-google-login version
  // in use and this code's `response.profileObj` assumption, or a stale
  // render) had not been pinned down yet when this branch was written.
  loginGoogle(response) {
    this.setState({
      ...this.state,
      currentUser: response,
    });
    this.storageService.setData('user', 'current', response);
  }

  errorGoogle(response) {
    console.log(response);
  }

  logoutGoogle() {
    this.setState({
      ...this.state,
      currentUser: null,
    });
    this.storageService.setData('user', 'current', null);
  }

  showOverlay(show, id) {
    this.setState({
      ...this.state,
      loaderVisible: show,
      loaderText: id,
    });
  }

  upVote() {
    this.setState({
      ...this.state,
      loaderVisible: false,
    });
  }

  downVote() {
    this.setState({
      ...this.state,
      loaderVisible: false,
    });
  }

  updateWindowDimensions() {
    this.setState({ ...this.state, width: window.innerWidth, height: window.innerHeight });
  }

  keyDownHandler(event) {
    if (event.keyCode === 27) {
      this.showOverlay(false);
    }
  }

  initMap() {
    this.geocoderService = new google.maps.Geocoder();
    this.map.initialize();
    this.locationProvider.getPosition()
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

  setPosition(position) {
    // NOTE: inferred - HomePage now owns `position` in its own state and
    // hands it down to <Map position={...} />, which reacts to the prop
    // change in componentWillReceiveProps. The exact method body (e.g.
    // whether it also re-centers synchronously) was not confirmed from the
    // minified bundle beyond "it updates state.position".
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

  handleChange = (event, index, selectedTypes) => {
    this.setState({ ...this.state, selectedTypes }, () => {
      this.retrievePlaces();
    });
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
            this.setPosition(results[0].geometry.location);
            this.retrievePlaces();
          } else {
            alert('Geocode was not successful for the following reason: ' + status);
          }
        },
      );
    }
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

    const myProfilePlaceholder = this.state.currentUser ?
      (
        <MenuItem
          ref={(elem) => { this.placeholderProfile = elem; }}
          primaryText={this.state.currentUser.profileObj.name}
          leftIcon={<Account />}
        />
      ) :
      (
        <MenuItem ref={(elem) => { this.placeholderProfile = elem; }} primaryText="Anonymous" leftIcon={<Account />} />
      );

    const loginPlaceholder = !this.state.currentUser ?
      (
        <MenuItem
          className="login"
          ref={(elem) => { this.placeholderLoginGoogle = elem; }}
          primaryText={<GoogleLogin
            clientId={GOOGLE_OAUTH_CLIENT_ID}
            buttonText="Login"
            onSuccess={this.loginGoogle}
            onFailure={this.errorGoogle}
          />}
          leftIcon={<Login />}
        />
      ) : null;

    const logoutPlaceholder = this.state.currentUser ?
      (
        <MenuItem
          className="logout"
          ref={(elem) => { this.placeholderLogoutGoogle = elem; }}
          primaryText={<GoogleLogout
            buttonText="Logout"
            onLogoutSuccess={this.logoutGoogle}
          />}
          leftIcon={<Logout />}
        />
      ) : null;

    const placesCategory = (
      <SelectField
        className="places-category"
        floatingLabelText="Choose places category"
        value={this.state.selectedTypes}
        onChange={this.handleChange}
      >
        {this.menuItems()}
      </SelectField>
    );

    const mainMenu = (
      <Paper className="main-menu-paper">
        <Menu className="main-menu">
          {myProfilePlaceholder}
          {loginPlaceholder}
          {logoutPlaceholder}
          {placesCategory}
          <MenuItem primaryText={sliderDistance} />
          {menuGeocoder}
          <MenuItem primaryText="Help &amp; feedback" />
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
            <i className="material-icons">dehaze</i>
          </div>
          {this.state.menuVisible ? mainMenu : null}
        </div>
      );

    const loaderContent =
      (
        <div className="the-choice-overlay">
          <div className="text">
            Fix the karma of
          </div>
          <div className="name" dangerouslySetInnerHTML={{ __html: this.state.loaderText }} />
          <div className="buttons">
            <Button onClick={() => { this.upVote(); }} theme="green"><i className="material-icons">thumb_up</i></Button>
            <Button onClick={() => { this.downVote(); }} theme="red"><i className="material-icons">thumb_down</i></Button>
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

    const result = (
      <Loader show={this.state.loaderVisible} message={loaderContent}>
        <div>
          {menu}
          <Map
            ref={(elem) => { this.map = elem; }}
            height={this.state.height}
            places={this.state.places}
            placesVersion={this.state.placesVersion}
            position={this.state.position}
            distance={this.state.distance}
            setPosition={this.setPosition}
            showOverlay={this.showOverlay}
          />
        </div>
      </Loader>
    );

    return result;
  }
}
