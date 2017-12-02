import React from 'react';
import Button from 'components/ui/Button/Button';

import $ from 'jquery';

import Map from '../../../tools/map';
// import loadJS from '../../../tools/load-js'

import './HomePage.scss';

export default class HomePage extends React.Component {
  constructor(props) {
    super(props);

    this.map = new Map();
    this.mapElem;
    this.service;
    this.infowindow


    HomePage.Instance = this;
  }

    componentDidMount() {
    window.initMap = HomePage.initMapStatic;
    this.loadJS('https://maps.googleapis.com/maps/api/js?key=AIzaSyBjBVO0J-a0PT30d-9lieKa9ygFnN8J1GA&libraries=places&callback=initMap');
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
    return (
      <div>
        <h1 style={{ fontSize: 50, fontWeigth: 'bold', textAlign: 'center' }}>
          React Pages Boilerplate
      </h1>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Button theme="blue">Click me!!</Button>
        </div>

        <div 
        ref={(elem) => { this.mapElem = elem; }} 
        className="map"></div>

      </div>
    );
  }
}

HomePage.initMapStatic = function() {
  HomePage.Instance.initMap();
}

