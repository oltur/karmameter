import React from 'react';
import ReactDOM from 'react-dom';
import { GoogleLogin, GoogleLogout } from 'react-google-login';
import Button from 'components/ui/Button/Button';

import Paper from 'material-ui/Paper';
import Menu from 'material-ui/Menu';
import MenuItem from 'material-ui/MenuItem';

import $ from 'jquery';

import Map from '../../../tools/map';
// import loadJS from '../../../tools/load-js'

import Loader from 'react-loader-advanced';

import './HomePage.scss';

import RemoveRedEye from 'material-ui/svg-icons/image/remove-red-eye';
import ArrowDropRight from 'material-ui/svg-icons/navigation-arrow-drop-right';

import Slider from 'material-ui/Slider';

export default class HomePage extends React.Component {
  constructor(props) {
    super(props);

    this.state = { width: 0, height: 0, loaderVisible: false, loaderText: '', distance: 2000 };

    this.map = new Map();
    this.mapElem;
    this.service;
    this.infowindow

    this.updateWindowDimensions = this.updateWindowDimensions.bind(this);
    this.keyDownHandler = this.keyDownHandler.bind(this);

    this.showOverlay = this.showOverlay.bind(this);
    this.upVote = this.upVote.bind(this);
    this.downVote = this.downVote.bind(this);

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

  showOverlay(show, id) {
    this.setState({
      ...this.state,
      loaderVisible: show,
      loaderText: id,
    })
  }

  responseGoogle(response) {
    console.log(response);
  }

  logoutGoogle(response) {
    console.log(response);
  }

  componentDidMount() {
    this.updateWindowDimensions();
    window.HomePage = this;
    //    window.initMap = window.HomePage.initMap;
    this.loadJS('https://maps.googleapis.com/maps/api/js?key=AIzaSyDtTQcbBh4TJUoJJZQMZMxHeRWGxjUVJ30&libraries=places&callback=HomePage.initMap');
    window.addEventListener('resize', this.updateWindowDimensions);

    document.addEventListener("keydown", this.keyDownHandler, false);
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.updateWindowDimensions);
    document.removeEventListener("keydown", this.keyDownHandler, false);
  }

  updateWindowDimensions() {
    this.setState({ ...this.state, width: window.innerWidth, height: window.innerHeight });
  }

  keyDownHandler(event) {
    if (event.keyCode === 27) {
      this.showOverlay(false);
    }
  }

  loadJS(src) {
    var ref = window.document.getElementsByTagName("script")[0];
    var script = window.document.createElement("script");
    script.src = src;
    script.async = true;
    ref.parentNode.insertBefore(script, ref);
  }

  initMap() {
    this.map.initialize(this.mapElem);
  }

  handleDistanceSlider = (event, value) => {
    this.setState({ ...this.state, distance: value });
    this.map.fillMarkers(value);
  };

  render() {

    const style = {
      display: 'inline-block',
      margin: '16px 32px 16px 0',
    };

    const SliderExampleSimple = (
      <div>
        <Slider
          min={100}
          max={50000}
          step={100}
          value={this.state.distance}
          onChange={this.handleDistanceSlider}
        />
        <div>{this.state.distance}</div>
      </div>
    );

    const MenuExampleSimple = (
      <div>
        <Paper style={style}>
          <Menu>
            <MenuItem primaryText="Refresh" leftIcon={<RemoveRedEye />} />
            <MenuItem primaryText="Help &amp; feedback" />
            <MenuItem primaryText="Settings" rightIcon={<ArrowDropRight />}
              menuItems={[
                <MenuItem
                  primaryText="Show"
                  rightIcon={<ArrowDropRight />}
                  menuItems={[
                    <MenuItem primaryText="Show Level 2" />,
                    <MenuItem primaryText="Grid lines" checked={true} />,
                    <MenuItem primaryText="Page breaks" insetChildren={true} />,
                    <MenuItem primaryText="Rules" checked={true} />,
                  ]}
                />
              ]}
            />
            <MenuItem primaryText="Sign out" />
          </Menu>
        </Paper>
      </div>
    );


    const googleLoginButton =
      (
        <GoogleLogin
          clientId="19471878870-td25jvej2kq8jn7n622ttutvat4lbkvm.apps.googleusercontent.com"
          buttonText="Login"
          onSuccess={this.responseGoogle}
          onFailure={this.responseGoogle}
        />
      );

    const googleLogoutButton =
      (
        <GoogleLogout
          buttonText="Logout"
          onLogoutSuccess={this.logoutGoogle}
        >
        </GoogleLogout>
      );

    const menu =
      (
        <div className="menu">
          <a href="#"><i className="material-icons">dehaze</i></a>
          {googleLoginButton}
          {googleLogoutButton}
          {MenuExampleSimple}
          {SliderExampleSimple}
        </div>
      );

    const content =
      (
        <div className="the-choice">
          <div className="text">
            Fix the karma of
          </div>
          <div className="name">{this.state.loaderText}</div>
          <div className="buttons">
            <Button onClick={() => { this.upVote() }} theme="green"><i className="material-icons">thumb_up</i></Button>
            <Button onClick={() => { this.downVote() }} theme="red"><i className="material-icons">thumb_down</i></Button>
          </div>
          <div className="links">
            <a onClick={() => { this.showOverlay(false); return false; }} href={'#'}>Maybe next time</a>
          </div>
        </div>
      );


    return (
      <Loader show={this.state.loaderVisible} message={content}>
        <div>
          {menu}
          <div
            ref={(elem) => { this.mapElem = elem; }}
            className="map"
            style={{ height: this.state.height }}
          ></div>

        </div>
      </Loader>
    );
  }
}

