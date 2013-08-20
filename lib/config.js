/*
 * Venus
 * Copyright 2013 LinkedIn
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 *     Unless required by applicable law or agreed to in writing,
 *     software distributed under the License is distributed on an "AS
 *     IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 *     express or implied.   See the License for the specific language
 *     governing permissions and limitations under the License.
 **/

// Define configs for Venus application

var pathm      = require('path');

function _resolve(path) {
	return pathm.resolve(__dirname, '..', ".venus", path).replace(/\\/g, '/');
}
	
// Configuration file for Venus
// All paths can be relative (to the location of this config file) or absolute
var CONFIG = {
  libraries: {
    mocha: {
      includes: [
        _resolve('libraries/mocha.js'),
        _resolve('libraries/expect.js'),
        _resolve('helpers/venus-fixture.js'),
        _resolve('adaptors/adaptor-template.js'),
        _resolve('adaptors/mocha-venus.js'),
        _resolve('libraries/sinon-1.5.0.js')
      ]
    },
    qunit: {
      includes: [
        _resolve('libraries/qunit.js'),
        _resolve('helpers/venus-fixture.js'),
        _resolve('adaptors/adaptor-template.js'),
        _resolve('adaptors/qunit-venus.js')
      ]
    },
    jasmine: {
      includes: [
        _resolve('libraries/jasmine.js'),
        _resolve('helpers/venus-fixture.js'),
        _resolve('adaptors/adaptor-template.js'),
        _resolve('adaptors/jasmine-venus.js'),
        _resolve('helpers/jasmine-html.js'),
        _resolve('libraries/jquery.js'),
        _resolve('helpers/jquery.mockjax.js')
      ]
    }
  },

  // Default settings
  default: {
    library: 'jasmine'
  },

  // Binaries
  binaries: {
    phantomjs: '../bin/phantomjs'
  }

  // Serve static content
  //static: {
  //  sample: '../test/data'
  //}
}

module.exports.CONFIG = CONFIG;

Object.seal(module.exports);
