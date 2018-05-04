import 'babel-polyfill';
import 'styles';


import React from 'react';
import ReactDOM from 'react-dom';
import MuiThemeProvider from 'material-ui/styles/MuiThemeProvider';
import { render } from 'react-dom';
import { Provider } from 'react-redux';
import { AppContainer } from 'react-hot-loader';

import configureStore from './store/configureStore';
import App from './components/App';

const store = configureStore();
const rootElement = document.getElementById('app');

render(
  <MuiThemeProvider>
    <AppContainer>
      <Provider store={store}>
        <App />
      </Provider>
    </AppContainer>
  </MuiThemeProvider>,
  rootElement
);

// Enable hot updates with react-hot-loader@3, this will be cut out in production
if (module.hot) {
  module.hot.accept('./components/App', () => {
    const NextApp = require('./components/App').default;

    render(
      <MuiThemeProvider>
        <AppContainer>
          <Provider store={store}>
            <NextApp />
          </Provider>
        </AppContainer>
      </MuiThemeProvider>,
      rootElement
    );
  });
}
