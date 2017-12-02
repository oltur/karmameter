import React from 'react';
import Button from 'components/ui/Button/Button';

import $ from 'jquery';

import Map from '../../../tools/map';
// import loadJS from '../../../tools/load-js'

import Loader from 'react-loader-advanced';

import './HomePage.scss';

export default class HomePage extends React.Component {
  constructor(props) {
    super(props);

    this.state = { width: 0, height: 0, loaderVisible: false, loaderText: '' };

    this.map = new Map();
    this.mapElem;
    this.service;
    this.infowindow

    this.updateWindowDimensions = this.updateWindowDimensions.bind(this);

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

  componentDidMount() {
    this.updateWindowDimensions();
    window.HomePage = this;
    //    window.initMap = window.HomePage.initMap;
    this.loadJS('https://maps.googleapis.com/maps/api/js?key=AIzaSyBjBVO0J-a0PT30d-9lieKa9ygFnN8J1GA&libraries=places&callback=HomePage.initMap');
    window.addEventListener('resize', this.updateWindowDimensions);
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.updateWindowDimensions);
  }

  updateWindowDimensions() {
    this.setState({ ...this.state, width: window.innerWidth, height: window.innerHeight });
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

  render() {

    const content =
      (
        <div>
          {this.state.loaderText}
          <br />
          <Button onClick={() => { this.upVote() }} theme="blue">Yes</Button>
          <Button onClick={() => { this.downVote() }} theme="white">No</Button>
        </div>
      );


    return (
      <Loader show={this.state.loaderVisible} message={content}>
        <div>
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

