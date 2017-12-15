import React from 'react';
import { GoogleLogin, GoogleLogout } from 'react-google-login';
import Button from 'components/ui/Button/Button';

import Paper from 'material-ui/Paper';
import Menu from 'material-ui/Menu';
import MenuItem from 'material-ui/MenuItem';
import SelectField from 'material-ui/SelectField';
import Loader from 'react-loader-advanced';

import Login from 'material-ui/svg-icons/action/flight-land';
import Logout from 'material-ui/svg-icons/action/flight-takeoff';
import Account from 'material-ui/svg-icons/action/account-box';
import ArrowDropRight from 'material-ui/svg-icons/navigation-arrow-drop-right';

import Slider from 'material-ui/Slider';

import StorageService from '../../../tools/storage-service';
import Map from '../../../tools/map';
import loadJS from '../../../tools/load-js';

import './HomePage.scss';

export default class HomePage extends React.Component {
  constructor(props) {
    super(props);

    this.storageService = new StorageService();

    this.state = {
      width: 0,
      height: 0,
      loaderVisible: false,
      loaderText: '',
      distance: 2000,
      currentUser: this.storageService.currentUser,
      menuVisible: false,
      names: [
        'accounting',
        'airport',
        'amusement_park',
        'aquarium',
        'art_gallery',
        'atm',
        'bakery',
        'bank',
        'bar',
        'beauty_salon',
        'bicycle_store',
        'book_store',
        'bowling_alley',
        'bus_station',
        'cafe',
        'campground',
        'car_dealer',
        'car_rental',
        'car_repair',
        'car_wash',
        'casino',
        'cemetery',
        'church',
        'city_hall',
        'clothing_store',
        'convenience_store',
        'courthouse',
        'dentist',
        'department_store',
        'doctor',
        'electrician',
        'electronics_store',
        'embassy',
        'fire_station',
        'florist',
        'funeral_home',
        'furniture_store',
        'gas_station',
        'gym',
        'hair_care',
        'hardware_store',
        'hindu_temple',
        'home_goods_store',
        'hospital',
        'insurance_agency',
        'jewelry_store',
        'laundry',
        'lawyer',
        'library',
        'liquor_store',
        'local_government_office',
        'locksmith',
        'lodging',
        'meal_delivery',
        'meal_takeaway',
        'mosque',
        'movie_rental',
        'movie_theater',
        'moving_company',
        'museum',
        'night_club',
        'painter',
        'park',
        'parking',
        'pet_store',
        'pharmacy',
        'physiotherapist',
        'plumber',
        'police',
        'post_office',
        'real_estate_agency',
        'restaurant',
        'roofing_contractor',
        'rv_park',
        'school',
        'shoe_store',
        'shopping_mall',
        'spa',
        'stadium',
        'storage',
        'store',
        'subway_station',
        'synagogue',
        'taxi_stand',
        'train_station',
        'transit_station',
        'travel_agency',
        'university',
        'veterinary_care',
        'zoo',
      ],
      values: ['restaurant'],
    };

    this.map = new Map();
    this.mapElem = null;
    this.service = null;
    this.infowindow = null;

    this.placeholderLoginGoogle = null;
    this.placeholderLogoutGoogle = null;
    this.placeholderProfile = null;

    this.updateWindowDimensions = this.updateWindowDimensions.bind(this);
    this.keyDownHandler = this.keyDownHandler.bind(this);

    this.showOverlay = this.showOverlay.bind(this);
    this.upVote = this.upVote.bind(this);
    this.downVote = this.downVote.bind(this);
    this.loginGoogle = this.loginGoogle.bind(this);
    this.logoutGoogle = this.logoutGoogle.bind(this);
    this.errorGoogle = this.errorGoogle.bind(this);
  }

  componentDidMount() {
    this.updateWindowDimensions();
    window.HomePage = this;
    //    window.initMap = window.HomePage.initMap;
    loadJS('https://maps.googleapis.com/maps/api/js?key=AIzaSyDtTQcbBh4TJUoJJZQMZMxHeRWGxjUVJ30&libraries=places&callback=HomePage.initMap');
    window.addEventListener('resize', this.updateWindowDimensions);

    document.addEventListener('keydown', this.keyDownHandler, false);
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.updateWindowDimensions);
    document.removeEventListener('keydown', this.keyDownHandler, false);
  }

  get currentUser() {
    return this.state.currentUser;
  }

  set currentUser(userData) {
    this.setState({
      ...this.state,
      currentUser: userData,
    });
    this.storageService.setData('user', 'current', userData);
  }

  toogleMenu() {
    this.setState({
      ...this.state,
      menuVisible: !this.state.menuVisible,
    });
  }

  loginGoogle(response) {
    console.log(this);
    this.currentUser = response;
    console.log(response);
  }

  errorGoogle(response) {
    console.log(response);
  }

  logoutGoogle() {
    this.currentUser = null;
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
    this.map.initialize(this.mapElem);
  }

  handleDistanceSlider = (event, value) => {
    this.setState({ ...this.state, distance: value });
    this.map.fillMarkers(this.state.distance);
  };

  handleChange = (event, index, values) => {
    this.setState({ ...this.state, values });
    this.map.selectedTypes = values;
    this.map.fillMarkers(this.state.distance);
  }

  menuItems(values) {
    return this.state.names.map((name) => (
      <MenuItem
        key={name}
        insetChildren
        checked={values && values.indexOf(name) > -1}
        value={name}
        primaryText={name}
      />
    ));
  }

  render() {
    const style = {
      display: 'inline-block',
      margin: '16px 32px 16px 0',
    };

    const SliderExampleSimple = (
      <div>
        <div style={{ fontSize: '0.8em', lineHeight: 1, color: 'lightgrey' }}>Distance: {this.state.distance} m.</div>
        <Slider
          min={1000}
          max={50000}
          step={1000}
          value={this.state.distance}
          onChange={this.handleDistanceSlider}
        />
      </div>
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
          ref={(elem) => { this.placeholderLoginGoogle = elem; }}
          primaryText={<GoogleLogin
            clientId="19471878870-td25jvej2kq8jn7n622ttutvat4lbkvm.apps.googleusercontent.com"
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
          ref={(elem) => { this.placeholderLogoutGoogle = elem; }}
          primaryText={<GoogleLogout
            buttonText="Logout"
            onLogoutSuccess={this.logoutGoogle}
          />}
          leftIcon={<Logout />}
        />
      ) : null;

    const { values } = this.state;
    const multiSelectSample = (
      <SelectField
        className="multiselect"
        multiple
        floatingLabelText="Choose places types"
        hintText="Select a name"
        value={values}
        onChange={this.handleChange}
      >
        {this.menuItems(values)}
      </SelectField>
    );

    const MainMenu = (
      <div style={{ marginTop: '-30px' }}>
        <Paper style={style}>
          <Menu>
            {myProfilePlaceholder}
            {loginPlaceholder}
            {logoutPlaceholder}

            {multiSelectSample}
            <MenuItem primaryText={SliderExampleSimple} />
            <MenuItem primaryText="Help &amp; feedback" />
            <MenuItem
              primaryText="Settings"
              rightIcon={<ArrowDropRight />}
              menuItems={[
                <MenuItem
                  primaryText="Show"
                  rightIcon={<ArrowDropRight />}
                  menuItems={[
                    <MenuItem primaryText="Show Level 2" />,
                    <MenuItem primaryText="Grid lines" checked />,
                    <MenuItem primaryText="Page breaks" insetChildren />,
                    <MenuItem primaryText="Rules" checked />,
                  ]}
                />,
              ]}
            />
          </Menu>
        </Paper>
      </div>
    );

    const menu =
      (
        <div className="menu">
          <div
            role="link"
            tabIndex={0}
            className="link"
            onClick={() => this.toogleMenu()}
            onKeyPress={(event) => {
              if (event.keyCode === 32) { this.toogleMenu(); }
            }}
          >
            <i className="material-icons">dehaze</i>
          </div>
          {this.state.menuVisible ? MainMenu : null}
        </div>
      );

    const loaderContent =
      (
        <div className="the-choice">
          <div className="text">
            Fix the karma of
          </div>
          <div className="name" dangerouslySetInnerHTML={{ __html: this.state.loaderText }}></div>
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
          <div
            ref={(elem) => { this.mapElem = elem; }}
            className="map"
            style={{ height: this.state.height }}
          />

        </div>
      </Loader>
    );

    return result;
  }
}

