import React from 'react';
import test from 'tape';
import { shallow, configure } from 'enzyme';

import Adapter from 'enzyme-adapter-react-16';

import Button from './Button';

configure({ adapter: new Adapter() });

test('Button', (t) => {
  let clickTestValue = 0;
  const wrapper = shallow(<Button onClick={() => { clickTestValue += 1; }}>Hello</Button>);
  wrapper.simulate('click');

  t.equals(
    wrapper.text(),
    'Hello',
    'renders content from children'
  );

  t.equals(
    clickTestValue,
    1,
    'handles onClick events'
  );

  t.end();
});
