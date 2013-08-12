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

// Represents a single testcase file

'use strict';
var fs           = require('fs'),
    comments     = require('./util/commentsParser'),
    pathHelper   = require('./util/pathHelper'),
    logger       = require('./util/logger'),
    i18n         = require('./util/i18n'),
    constants    = require('./constants'),
    pathm        = require('path'),
    CONFIG       = require('./config').CONFIG,
    fstools      = require('fs-tools'),
    stringUtil   = require('./util/stringUtil'),
    mkdirp       = require('mkdirp'),
    Instrumenter = require('istanbul').Instrumenter,
    annotation   = {
      VENUS_FIXTURE: 'venus-fixture',
      VENUS_INCLUDE: 'venus-include',
      VENUS_POST: 'venus-post',
      VENUS_PRE: 'venus-pre',
      VENUS_INCLUDE_GROUP: 'venus-include-group',
      VENUS_LIBRARY: 'venus-library',
      VENUS_TEMPLATE: 'venus-template',
      VENUS_TYPE: 'venus-type'
    };

// Constructor for TestCase
function TestCase(conf) {
  this.config = conf || CONFIG;
  //logger.info(JSON.stringify(this.config));
}

// Initialize
TestCase.prototype.init = function(path, id, runUrl, instrumentCodeCoverage) {

  this.additionalPathsForWatching = [];

  var testData  = this.parseTestFile(path);

  this.src                    = testData.src;
  this.path                   = testData.path;
  this.directory              = testData.directory;
  this.hasAnnotations         = Object.keys(testData.annotations).length > 0;
  this.annotations            = this.resolveAnnotations(testData.annotations);
  this.id                     = id;
  this.url                    = { run: runUrl };
  this.instrumentCodeCoverage = instrumentCodeCoverage;

  this.harnessTemplate        = this.loadHarnessTemplate(this.annotations);
  this.url.includes           = this.copyFilesToHttpPath(
                                  this.prepareIncludes(this.annotations)
                                ).urls;
};

// Resolve annotations
// Use default values for missing annotations
TestCase.prototype.resolveAnnotations = function(annotations) {
  var config  =  this.config,
      library = annotations[annotation.VENUS_LIBRARY],
      include = annotations[annotation.VENUS_INCLUDE],
      groups = annotations[annotation.VENUS_INCLUDE_GROUP],
      fixture = annotations[annotation.VENUS_FIXTURE];

  if ( !library ) {
    library = config.default.library;
    if (!library) {
      throw {
        name: 'LibraryException',
        message: 'The default library is not defined in .venus/config'
      };
    }
  } else if ( Array.isArray(library) ) {
    library = library[0];
  }

  annotations[annotation.VENUS_LIBRARY] = library;

  if ( !include ) {
    include = [];
  } else if ( !Array.isArray(include) ) {
    include = [include];
  }

  annotations[annotation.VENUS_INCLUDE] = include;

  if ( !groups ) {
    groups = [];
  } else if ( !Array.isArray(groups) ) {
    groups = [groups];
  }

  annotations[annotation.VENUS_INCLUDE_GROUP] = groups;

  // If the fixture is not HTML, attempt to load the file:
  // 1. Look for file at path relative to path of testcase file
  // 2. If this fails, try to load as template from config directory
  // 3. If this fails, use an empty string
  if (!fixture) {
    fixture = '';
  } else {
    if (!stringUtil.hasHtml(fixture)) {
      var fixturePath = pathm.resolve( this.directory, fixture );

      //try {
        fixture = fs.readFileSync(fixturePath).toString();
      /*} catch(e) {
        fixture = config.loadTemplate(fixture);
      }*/

      //fixture = config.loadTemplate(fixture);
      if (!fixture || !fixture.length) {
        fixture = '';
      }
    }
  }

  annotations[annotation.VENUS_FIXTURE] = fixture;

  return annotations;
};

/**
 * Get the path on the filesystem for the temporary folder for this test includes
 * @param {Number} testId the id of this testcase
 */
TestCase.prototype.getHttpRoot = function (testId) {
  /* groverv: modified this method so that tests do not refer to temp folder */
  //return pathm.resolve(constants.userHome, '.venus_temp', 'test', testId.toString());
  //console.log("httproot:", pathm.resolve(process.cwd(), 'venus-test', testId.toString()).replace(/\\/g, "/"));
  return pathm.resolve(process.cwd(), 'venus-test', testId.toString()).replace(/\\/g, "/");
};

// Prepare testcase includes - there are the files
// to be included on the test fixture page in the browser
TestCase.prototype.prepareIncludes = function (annotations) {
  var library = annotations[annotation.VENUS_LIBRARY],
      testId = this.id,
      config  = this.config,
      libraryFile,
      adaptorFile,
      httpRoot,
      httpResourceUrls,
      libDest,
      group,
      adaptorDest,
      includes = [],
      fileMappings = [],
      includeFiles = annotations[annotation.VENUS_INCLUDE],
      includeGroups = annotations[annotation.VENUS_INCLUDE_GROUP];

  httpRoot = this.getHttpRoot(testId);
  httpResourceUrls = [];

  // Add library files
  includes = config.libraries[library].includes;

  //logger.info("includes1:", includes);
  //process.exit(1);

  // Add default includes
  if (config.includes && config.includes.default) {
    includes = includes.concat(config.includes.default);
  }

  // Add include group files
  includeGroups.forEach(function (groupName) {
    group = config.includes[groupName];
    if (group) {
      includes = includes.concat(group);
    }
  }, this);

  if (!includes) {
    includes = [];
  }

  if (!Array.isArray(includes)) {
    includes = [includes];
  }

  //logger.info("includes2:", includes);

  includes = includes.map(function (include) {
    /* groverv: the logical path should match the real path */
    var matches=include.match(/^.*\.venus\/(.*)\/.*$/), prepend = (matches && matches.length>1) ? matches[1]+"/": '';

    //console.log("include ", include)
	//console.log("include matches", matches)
	return { path: include, httpDir: 'venus-lib', prepend: prepend };
    //return { path: include, httpDir: ".venus/"+include, prepend: '' };
  });

  //logger.info("includes3:", includes);

  includes.forEach(function (include) {
    var filePath       = include.path,
      httpDir        = include.httpDir,
      destination    = (httpRoot + '/' + httpDir + '/' + include.prepend + pathHelper(filePath).file),
    /* groverv: modified this to use venus-test logical path instead of temp */
    //httpUrl        = '/' + destination.substr(destination.indexOf('temp/test/' + testId)),
      httpUrl        = '/' + destination.substr(destination.indexOf('venus-test/' + testId)),
      instrumentable = include.instrumentable;

    // Add to list of file mappings
    //  fs   = original file path on disk
    //  http = relative http path to file on server
    fileMappings.push({
      fs: filePath,
      http: destination,
      url: httpUrl,
      instrumentable: instrumentable
    });
  });

  var _myself = this;

  // Add files specified with @venus-include annotations
  includeFiles.forEach(function (filePath) {
    var filename = pathHelper(filePath).file,
        prepend  = '',
        parts,
        basePath;

    var absolutePathForMapping = pathm.resolve(process.cwd(), filePath).replace(/\\/g, '/');
    var destination;

    if(!fs.existsSync(absolutePathForMapping)) {

        logger.verbose("file inclusion of " + filename + " did not resolve relative to " + process.cwd());
        logger.verbose("now attempting to resolve this relative to "+ pathHelper(this.path.replace(/\\/g, '/')).up().path);

        absolutePathForMapping = pathm.resolve(pathHelper(this.path.replace(/\\/g, '/')).up().path, filePath).replace(/\\/g, '/');
        logger.verbose("path for mapping: " + absolutePathForMapping);

        if(!fs.existsSync(absolutePathForMapping)) {

            logger.error("incorrect file inclusion specified in " + pathHelper(this.path.replace(/\\/g, '/')).file);
            logger.error("inclusion of file " + filePath + " failed");
            logger.error("the path was resolved as: " + absolutePathForMapping);
            return;
        }
    }

    _myself.additionalPathsForWatching.push(absolutePathForMapping);

    destination = (httpRoot + '/' + 'includes' + '/' + pathm.relative(process.cwd(), absolutePathForMapping).replace(/\\/g, '/'));

    fileMappings.push({
      fs: filePath,
      http: destination,
      url: destination.substr(destination.indexOf('venus-test/'+ testId)),
      instrumentable: true
    });
  }, this);
  
  //console.log("====================================");
  //console.log(fileMappings);

  // Add the testcase file
  //includes.push({ path: this.path, httpDir: 'test', prepend: '' });

  var destination = pathm.resolve(httpRoot + '/' + 'includes' + '/' + pathm.relative(process.cwd(), this.path));

    fileMappings.push({
    fs: this.path,
    http: destination,
    url: '/' + destination.substr(destination.replace(/\\/g, '/').indexOf('venus-test/' + testId)),
    instrumentable: true
  });

  return fileMappings;
};

// Copy dependencies to http root
TestCase.prototype.copyFilesToHttpPath = function (files) {
    var urls = [], instrumenter;

    files.forEach(function (path) {
      urls.push(path.url);
    }, this);

    return { urls: urls};
};

// Load test harness template
TestCase.prototype.loadHarnessTemplate = function(annotations) {
  var harnessName = annotations[annotation.VENUS_TEMPLATE];
  /*var config = this.config,
      src;*/

  // If harness is specified in config, then get that harness
  // file
  /*if (harnessName) {
    return config.loadTemplate(harnessName);
  } else {
    return config.loadTemplate('sandbox');
  }*/
  harnessName = (harnessName || 'sandbox') + '.tl'
  return fs.readFileSync( pathm.resolve(__dirname, '..', '.venus/templates/', harnessName)).toString();
};

// Parse a test case file
TestCase.prototype.parseTestFile = function(file) {
  var fileContents = fs.readFileSync(file).toString();

  return {
    path     : file,
    directory: pathm.resolve( file.split(pathm.sep).slice(0, -1).join(pathm.sep) ),
    src      : fileContents,
    annotations : comments.parseStr(fileContents)
  };
};

// Create a new TestCase object
function create(path, id, runUrl, instrumentCodeCoverage) {
  var instance = new TestCase();
  instance.init(path, id, runUrl, instrumentCodeCoverage);
  return instance;
};

module.exports.TestCase = TestCase;
module.exports.create = create;
module.exports.annotation = annotation;
Object.seal(module.exports);
