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

// Test executor that is responsible for serving test content and instantiating clients to run tests

'use strict';
var PORT         = 2020,
    express      = require('express'),
    http         = require('http'),
    path         = require('path'),
    i18n         = require('./util/i18n'),
    logger       = require('./util/logger'),
    consolidate  = require('consolidate'),
    portscanner  = require('portscanner'),
    fs           = require('fs'),
    pathm        = require('path'),
    ioserver     = require('socket.io'),
    testcase     = require('./testcase'),
    testrun      = require('./testrun'),
    phantom      = require('./uac/phantom'),
    _            = require('underscore'),
    _s           = require('underscore.string'),
    dust         = require('dustjs-linkedin'),
    configHelper = require('./config'),
    fstools      = require('fs-tools'),
    ua           = require('useragent-parser'),
    coverage     = require('./coverage'),
    constants    = require('./constants');

/* groverv: require glob and watchr */
var glob = require("glob");
var watchr = require("watchr");


// Constructor for Executor
function Executor(config) {
  // events.EventEmitter.call(this);
  this.testId       = 1;
  this.runners      = [];
  this.reportData   = [];
  this.port         = null;
  this.socket       = null;
  this.urlNamespace = '/venus-core';
  this.sandboxNamespace = '/venus-test';
  this.logNamespace = '/venus-log';
  //this.config       = config || configHelper.instance();
  this.config       = config || configHelper.CONFIG;
  this.hostname     = constants.hostname;

  this.TDDMode = false;

  this.watchPattern = process.cwd();
}

// util.inherits(Executor, events.EventEmitter);
// Initialize
Executor.prototype.init = function(options, onStart) {
  var testgroup,
      staticContent,
      runners = this.runners, _myself=this;

  // set hostname if desired
  if (options.hostname) {
    this.hostname = options.hostname;
  }

  // set code coverage flag
  if (options.coverage) {
    this.enableCodeCoverage = true;
  }

  // set require annotations flag
  if (options.requireAnnotations) {
    this.requireTestAnnotations = true;
  }

  this.initEnvironment(options);

  this.parsedTestPaths = this.getTestPaths(options.test);

  this.initTestGroup(options);
  this.initRunners(options);
  this.initRoutes();
  this.start(this.port, onStart);

  if(this.isTDDMode()) {
    //setTimeout(function(){_myself.watchFS()}, 2000);
    this.watchFS()
  }

  this.rerunTests();
};

var _watchers=[];

Executor.prototype.watchFS = function() {
    if(_watchers.length>0) {
        for(var i=0, len=_watchers.length; i<len; i++) {
            _watchers[i].close();
        }
        _watchers=[];
    }
    var filepaths = this.parsedTestPaths;
    var allTests = this.testgroup.testArray;
    var _myself = this;
    allTests.map(function(test){
        filepaths = filepaths.concat(test.additionalPathsForWatching);
    });
    watchr.watch({
        paths: filepaths
        ,listeners: {
            error: function(err){
                logger.error('an error occured:', err);
            }
            ,watching: function(err,watcherInstance,isWatching){
                if (err) {
                    logger.error("watching the path " + watcherInstance.path + " failed with error", err);
                } else {
                    //logger.verbose("watching the path " + watcherInstance.path + " completed");
                }
            }
            ,change: function(changeType,filePath,fileCurrentStat,filePreviousStat){
                logger.verbose('a change event occured:',arguments);
                _myself.rerunTests();
                setTimeout(function(){_myself.watchFS();},250);
            }
        }
        ,next: function(err, watchers) {
            if (err) {
                console.log("watching filesystem failed with error", err);
            } else {
                //logger.info('watching everything completed', watchers.length);
                _watchers = watchers;
                //_myself.initEnvironment(options);

                //_myself.rerunTests();
            }
        }
    });
    //logger.info("number of files being watched: ", filepaths.length);
}

Executor.prototype.initTestGroup = function(options) {
    // Parse the list of relative paths specified in the command line arguments
    // in to an array of testcase objects.
    var testgroup = this.testgroup = testrun.create(this.parseTests(options.test));

    // If no tests were selected to run, there is nothing to do.
    // log an error and return.
    // TODO: we may want to change this to throw an exception.
    if(testgroup.testCount === 0) {
        logger.warn( i18n('No tests specified to run - exiting') );
		    process.exit(0);
        //return false;
    }

    // Print test URLs
    testgroup.urls.forEach(function(url) {
        logger.info('Serving test: ' + url.run.yellow);
    });
}

Executor.prototype.initRunners = function(options) {
    // If phantomjs is selected, start the browsers.
    if(options.phantom) {
        logger.verbose( i18n('Creating phantom runners') );
        this.runners = [].concat(this.createPhantomRunners(options));
    }
}

Executor.prototype.rerunTests = function() {
  this.runners.done = 0;
  process.nextTick(function() {
    this.runTests();
  }.bind(this));
}

// Copy static content to temp folder
Executor.prototype.prepStaticContent = function(paths) {
    var fspath, httpRoot, httpPath;

    httpRoot = pathm.resolve(constants.userFolder, '.venus_temp', 'static');

    Object.keys(paths).forEach(function(key) {
      fspath = pathm.resolve(path.dirname(paths.src) + '/' + paths[key]);
      httpPath = pathm.resolve(httpRoot + '/' + key);

      // copy the file
      fstools.copy(fspath, httpPath, function(err) {
        if(err) {
          logger.error( i18n('error copying test file %s. exception: %s', httpPath, err) );
        }
      });
    });
};

// Start test runners!
Executor.prototype.runTests = function() {
  this.runners.forEach(function(runner) {
    runner.runTest();
  });
};

// Create phantom runners for a test run
Executor.prototype.createPhantomRunners = function( options ) {
  var phantomPath, runners = [], test;

  logger.verbose( i18n('Creating phantom runners') );

  // resolve path to phantom binary
  phantomPath = options.phantom;

  if( phantomPath === true ){
    phantomPath = undefined;
  }

  if( !phantomPath ){
    phantomPath = this.config.binaries.phantomjs;
  }

  if (!fs.existsSync(phantomPath)) {
    phantomPath = null;
  }

  logger.verbose( i18n('Creating phantomjs UACs') );

  if( phantomPath ){
    logger.verbose( i18n('Using phantomjs binary at %s', phantomPath) );
  }

  for(var i = 0; i < this.testgroup.testArray.length; i++) {
    test = this.testgroup.testArray[i];
    if(!test.annotations['venus-type'] || test.annotations['venus-type'] !== 'casperjs') {
      runners.push(phantom.create(test.url.run, phantomPath));
    }
  }
  return runners;
};

/* groverv: refactored the process of resolving the test paths into this method (needed for TDD) */
Executor.prototype.getTestNames = function(tests){
  var testPaths   = [], testNames=[];
  tests = (!tests || tests=='**')? '' : tests;
  tests = (tests.indexOf(',')>-1)? tests.split(',') : [tests];

  tests.map(function(test){
      if(!test) {
          test = '**/src/**/*.spec.js';
      }
      if(!test.match(/^.*\.js$/)){
         test = '**/src/**/*' + test + '*/**/*.spec.js';
     }
     var names = glob.sync(test, {nounique: true, nocase:true});
     logger.verbose(names.join("\n"));
     logger.info("tests found for pattern " + test + " are: " + names.length);
     testNames = testNames.concat(glob.sync("**/"+test, {nounique: true, nocase:true}));
  });
  return testNames;
}

/* groverv: callback for resolving the relative test paths into absolute paths (needed for TDD) */
Executor.prototype.resolveToAbsoluteFilePaths = function(relativeTestPath){
  var cwd = process.cwd();
  if( relativeTestPath[0] === '/' ){
    return relativeTestPath;
  }

  return pathm.join(cwd, relativeTestPath);
}

/* groverv: and this is the method that gets invoked by the file watcher (needed for TDD) */
Executor.prototype.getTestPaths = function(tests){
  var testNames = this.getTestNames(tests);
  return testNames.map(this.resolveToAbsoluteFilePaths);
}

// Create an array of test case objects from a string of testcase names
Executor.prototype.parseTests = function(tests) {
  /*if( !(typeof tests === 'string' || (typeof tests !== 'undefined' && Array.isArray(tests))) ) {
    return {};
  }*/
  
  var testPaths = this.parsedTestPaths;

  return this.parseTestPaths(testPaths);
};

// Take a list of absolute paths to testcase files and return array of TestCase objects
Executor.prototype.parseTestPaths = function(testPaths, testObjects) {
  var testObjects = testObjects || {},
      hostname = this.hostname;

  testPaths.forEach(function (path) {
  var stat,
        dirContents,
        test,
        testId;

   try {
     stat = fs.statSync(path);

       // create test case
       testId = this.getNextTestId();

       test = testcase.create(
         path,
         testId,
         'http://' + hostname + ':' + this.port + this.urlNamespace + '/' + testId,
         this.enableCodeCoverage
       );

       if(!this.requireTestAnnotations || test.hasAnnotations) {
         testObjects[testId] = test;
       } else {
         logger.warn( i18n('no annotations -- skipping test file %s', path) );
       }

   } catch(e) {
     logger.error( i18n('Cannot parse %s, %s', path, e ) );
     throw e;
   }
  }, this);

  return testObjects;
};

// Get a new test id
Executor.prototype.getNextTestId = function() {
  return this.testId++;
};

// Set up application environment
Executor.prototype.initEnvironment = function(config) {
  //logger.info("initializing environment");
  var app        = this.app = express(),
      homeFolder = this.homeFolder = config.homeFolder;

  // express config
  app.engine('tl', consolidate.dust);
  app.set('view engine', 'tl');
  app.set('views', homeFolder + '/views');
  app.set('views');
  app.set('view options', { layout: null });

  app.use (function(req, res, next) {
    //console.log("request url", req.url);
    var data='';
    req.setEncoding('utf8');
    req.on('data', function(chunk) {
       data += chunk;
    });

    req.on('end', function() {
        req.body = data;
        next();
    });
  });

  // static resources
  app.use('/js', express.static(pathm.resolve(homeFolder, 'js')));
  app.use('/css', express.static(pathm.resolve(homeFolder, 'css')));
  app.use('/img', express.static(pathm.resolve(homeFolder, 'img')));
  
  /* groverv: we do not want to map the temp folder; instead map the venus-test folder back to userHome */
  //app.use('/temp', express.static(pathm.resolve(constants.userHome, '.venus_temp')));
  app.use('/venus-test', express.static(pathm.resolve(homeFolder)));

  // port
  this.port = config.port || PORT;
};

/**
 * Prepend fixtures to body if they exist for current test
 * @param {Object} test Test object
 * @param {String} testId The testId to be used in the DOM id
 * @param {String} harnessTemplate An HTML string
 * @returns {String} String representing the harness template HTML
 */
Executor.prototype.loadFixtures = function(test, testId, harnessTemplate) {
  var fixtureContent = test.annotations[testcase.annotation.VENUS_FIXTURE],
      fixtureId = 'fixture_' + testId,
      fixturePartialReference;

  if (fixtureContent) {
    dust.loadSource(dust.compile(fixtureContent, fixtureId));
    fixturePartialReference = '<body><div id="venus-fixture-sandbox">{>' + fixtureId + '/}</div>';

    return harnessTemplate.replace(/<body>/, fixturePartialReference);
  }

  return false;
};

/**
 * Responds to /sandbox/:testid route
 * @param {Object} request Request object
 * @param {Object} response Response object
 */
Executor.prototype.handleSandboxPage = function(request, response) {
  var tests = this.testgroup.tests,
      testId = request.params.testid,
      test  = tests[testId],
      fixtureContent,
      templateData,
      harnessTemplate,
      harnessTemplateId;

  // Check if testid is valid and in the currently loaded testgroup
  if (!test || !test.harnessTemplate) {
    return response.status(404).json(
      { error: 'TestId ' + testId + ' does not exist' }
    );
  }

  fixtureContent = this.loadFixtures(test,  testId, test.harnessTemplate);

  harnessTemplate = fixtureContent ? fixtureContent : test.harnessTemplate;

  // Set template data, and render the Dust template
  harnessTemplateId = 'harness_template_' + testId;

  dust.loadSource(dust.compile(harnessTemplate, harnessTemplateId));
  
  //console.log("test object", test);
  //console.log("scriptIncludes", test.url.includes.slice(0, -1));

  templateData = {
    scriptIncludes     : test.url.includes.slice(0, -1),
    testcaseFile       : _.last(test.url.includes),
    testId             : testId,
    host               : this.hostname,
    port               : this.port
  };

  dust.render(harnessTemplateId, templateData, function(err, out) {
    if(err) {
      response.status(500).json(
        { error: 'Harness template for test ' + testId + ' failed to render' }
      );
    }
    response.send(out);
  });
};

/**
 * Responds to /sandbox/:testid/venus-lib/:type/:fileName route
 * @param {Object} request Request object
 * @param {Object} response Response object
 */
Executor.prototype.handleSandboxLibraries = function(request, response) {
  var libType = request.params.type,
      fileName = request.params.fileName;

  fs.readFile(pathm.resolve(__dirname, '..', ".venus", libType, fileName), function(err, data) {
    if (err) {
      throw err;
    }
    response.send(data);
  });
}

/**
 * Responds to /sandbox/:testid/includes/:fileName route
 * @param {Object} request Request object
 * @param {Object} response Response object
 */
Executor.prototype.handleSandboxIncludes = function(request, response) {
  //var fileName = request.params.fileName;
  var relativeFilePath = request.params[0];

  fs.readFile(pathm.resolve(process.cwd(), relativeFilePath), function(err, data) {
    if (err) {
      throw err;
    }
    response.send(data);
  });
}

/**
 * Responds to /sandbox/:testid/test/:fileName route
 * @param {Object} request Request object
 * @param {Object} response Response object
 */
Executor.prototype.handleSandboxTestCase = function(request, response) {
  var fileName = request.params.fileName;

  fs.readFile(pathm.resolve(process.cwd(), fileName), function(err, data) {
    if (err) {
      throw err;
    }
    response.send(data);
  });
}

/**
 * Responds to /:testid route
 * @param {Object} request Request object
 * @param {Object} response Response object
 */
Executor.prototype.handleNamespacePage = function(request, response) {
  var tests = this.testgroup.tests,
  testId = request.params.testid,
  test  = tests[testId],
  harnessTemplate,
  harnessTemplateId,
  templateData;

  // Check if testid is valid and in the currently loaded testgroup
  if (!test) {
    return response.status(404).json(
      { error: 'TestId ' + testId + ' does not exist' }
    );
  }

  // Set template data, and render the Dust template
  templateData = {
    postTestResultsUrl: this.urlNamespace + '/results/' + testId,
    testSandboxUrl: this.urlNamespace + '/sandbox/' + testId,
    testId: testId
  };

  //harnessTemplate = this.config.loadTemplate('default');
  harnessTemplate = fs.readFileSync( pathm.resolve(__dirname, '../.venus/templates/default.tl')).toString();
  harnessTemplateId = 'harness-' + testId;

  dust.loadSource(dust.compile(harnessTemplate, harnessTemplateId));

  dust.render(harnessTemplateId, templateData, function(err, out) {
    if (err) {
      response.status(500).json({
        error: 'Cannot render harness for test ' + testId
      });
    }
    response.send(out);
  });
};

/**
 * Responds to /:testid route
 * @param {Object} request Request object
 * @param {Object} response Response object
 */
Executor.prototype.handleLogFile = function(next) {
    var harnessTemplate,
        harnessTemplateId;
    harnessTemplate = fs.readFileSync( pathm.resolve(__dirname, '../.venus/templates/log.tl')).toString();
    harnessTemplateId = 'logTemplate';
    dust.loadSource(dust.compile(harnessTemplate, harnessTemplateId));
    dust.render(harnessTemplateId, this.reportData, function(err, out) {
        fs.writeFile(__dirname + '/../logs/venus.html', out, function (err) {
            next();
            if(err){
                return console.log(err);
            }
        });
    });
};

/**
 * Responds to /results/:testid route
 * @param {Object} request Request object
 * @param {Object} response Response object
 */
Executor.prototype.handleResultsPage = function(request, response) {
  var testId = request.params.testid,
    test = tests[testId];

  // Check if testid is valid and in the currently loaded testgroup
  if(!test) {
    return response.status(404).json(
      { error: 'TestId ' + testId + ' does not exist' }
    );
  }

  // Print test results
  //console.log('\nTEST FILE: '.cyan + test.path.cyan);
  this.printResults(JSON.parse(request.body));

  process.exit(1);
};

/**
 * Responds to / route
 * @param {Object} request Request object
 * @param {Object} response Response object
 */
Executor.prototype.handleIndexPage = function(request, response) {
  var data  = { tests: [] },
      tests = this.testgroup.tests;

  Object.keys(tests).forEach(function (key) {
    data.tests.push(tests[key]);
  });
  response.render( 'executor/index', data );
};

/**
 * Processes routes
 * @param {Object} request Request object
 * @param {Object} response Response object
 */
Executor.prototype.processRoute = function (routeFile) {
  return function (request, response) {
    fs.readFile(routeFile, function(err, data) {
      if (err) {
        throw err;
      }
      response.send(data);
    });
  };
};

/**
 * Sets up the routes
 */


Executor.prototype.initRoutes = function() {
  var routes = this.config.routes,
      app  = this.app,
      routeKey;

  /** Index **/
  app.get('/', this.handleIndexPage.bind(this));

  // Set up routes explicitly defined in the config.
  if (routes) {
    for (var routeKey in routes) {
      app.get('/' + routeKey, this.processRoute(routes[routeKey]));
    }
  }

  //logger.info("route info: ", this.urlNamespace);
  /** Serves the sandbox page **/
  app.get(this.urlNamespace + '/sandbox/:testid', this.handleSandboxPage.bind(this));

  // Serves the library dependencies requested by the sandbox page
  app.get(this.sandboxNamespace + '/:testid/venus-lib/:type/:fileName', this.handleSandboxLibraries.bind(this));

  // Serves the source dependencies requested by the sandbox page
  app.get(new RegExp('^.*\\/\\d+\\/includes\\/(.*)$'), this.handleSandboxIncludes.bind(this));

  // Serves the test requested by the sandbox page
  app.get(this.sandboxNamespace + '/:testid/test/:fileName', this.handleSandboxTestCase.bind(this));

  // Serves the page that will render the sandbox in an iframe
  app.get(this.urlNamespace + '/:testid', this.handleNamespacePage.bind(this));

  /** Receive results for a test **/
  app.post(this.urlNamespace + '/results/:testid', this.handleResultsPage);
};


/**
 * Friendly browser name
 */
Executor.prototype.getFriendlyBrowserName = function( uaString ){
  var uaData  = ua.parse_user_agent( uaString ),
      phantom = uaString.match( /PhantomJS\W*[\d|\.]*/ );

  if( phantom ) {
    return phantom[0];
  }

  return uaData.family + ' ' + uaData.major;
};

/**
 * Print test results from client
 */
Executor.prototype.printResults = function(result) {
  if(!result.tests || !result.done) return false;

  console.log( '\n--------------------------------------------------------' );
  console.log( '\n' );
  console.log( this.getFriendlyBrowserName( result.userAgent ).yellow );

  result.tests.forEach(function(test) {
    console.log('\n   ' + test.name);
    //console.log(test);

    if (test.status === 'PASSED') {
      console.log('\r     ✓'.green + ' ' + test.message.green);
    } else {
      console.log('\r     x'.red + ' ' + test.message.red);
    }

    if (test.stackTrace && test.stackTrace.stack) {
      console.log('\r   ' + test.stackTrace.stack.red);
    };

    console.log('\r');
  });

  if (result.done.failed === 0) {
    var content = result.done.passed === 1 ? ' test completed' : ' tests completed',
    message = '\n✓' + ' ' + result.done.passed.toString() + content +
      ' (' + result.done.runtime.toString()  + 'ms)';

    console.log(message.green);
  } else {
    var content = result.done.failed === 1 ? ' test failed' : ' tests failed',
    message = '\nx' + ' ' + result.done.failed.toString() + ' of ' + result.done.total.toString() + content +
      ' (' + result.done.runtime.toString()  + 'ms)';

    console.log(message.red);
  }

  console.log('\r');
  return true;
};

Executor.prototype.printCodeCoverage = function(data) {
  var metrics;

  if (!data) return;

  function getColor(num) {
    var color = 'green';

    if (num < .5) {
      color = 'red';
    } else if (num < .8) {
      color = 'yellow';
    }

    return color;
  }

  metrics = coverage.parse(data);


  logger.info(i18n('Code Coverage').yellow);
  logger.info('---------------------------------------------------');
  logger.debug(JSON.stringify(data));

  Object.keys(metrics).forEach(function (file) {
    var keys = ['statements', 'functions', 'branches'];
    logger.info(file);

    keys.forEach(function (key) {
      var percent    = metrics[file][key].percent,
          percentStr = (percent * 100).toFixed(2) + '%',
          label      = '(' + key + ')';

      logger.info('  ' + percentStr[getColor(percent)] + '  ' + label.grey);
    });

    logger.info('\n');
  });
};




Executor.prototype.onResults = function(data, done) {
  var results,
      dataString;

  done = done || function() {};

  if(data) {
    results = this.printResults(data);
    this.printCodeCoverage(data.codeCoverageData);
    this.reportData.push(data);
    logger.transports.file.log(JSON.stringify(data));
  }

  if(!results) {
    done({ status: 'error' });
  } else {
    done({ status: 'ok' });
  }

  this.runners.done++;

  if(data && data.done && data.done.failed > 0) {
    this.hasFailures = true;
  }

  if(!this.isTDDMode() && this.runners.length > 0 && this.runners.done == this.runners.length ){
    var me = this  ;
    process.nextTick(function () {
        me.handleLogFile(function(){
          me.runners.forEach( function( runner ){
              if( runner.shutdown ){
                  runner.shutdown();
              }
          });
          if( me.hasFailures ){
              process.exit(1);
          }else{
              process.exit(0);
          }
        });
    }.bind(this));
  }
};

/**
 * Start server
 */
Executor.prototype.start = function(port, onStart) {
  var app   = this.app,
      self  = this,
      server,
      io,
      hook,
      hostname = this.hostname,
      onStart = onStart || function() {};
	 
  portscanner.checkPortStatus(port, 'localhost', function(error, status) {
	  if(status === "open"){
	    logger.error( i18n(port+" is not available") );
		process.exit(0);
	  }	
  });	 

  portscanner.findAPortNotInUse(port, port + 1000, 'localhost', function(err, port) {

    // Try to start the HTTP server with the given port.  If the port is
    // occupied (can happen with a suspended process), call start() again
    // with 'port' incremented.  When the server is started successfully,
    // output a logging statement.
    server = http.createServer(app);
    server.on('listening', function() {
      logger.info('executor started on ' + hostname + ':' + port);

      // Start socket.io server
      io = ioserver.listen(hook, { 'log level': 0 });
      io.sockets.on('connection', function(socket) {
        socket.on('ping', function(fn) {
          fn({ time: Date.now(), port: port });
        });

        socket.on('results', _.bind(self.onResults, self));

        socket.on('error', function(){
            console.log("error");
        });

        socket.on('console.log', function(data, done) {
          done = done || function() {};
          if(!data) {
            done({ status: 'error' });
          } else {
            //logger.info( 'console: ' + data.yellow );
            done({ status: 'ok' });
          }
        });
      });

      onStart();
    });

    server.on('error',_.bind(function(e) {
      if ( e && (e.code === 'EADDRINUSE')) {
        this.start( port + 1 );
      }
    }, self));

    hook = server.listen(port);
  });
};

Executor.prototype.setTDDMode = function(flag) {
  this.TDDMode = flag;
}

Executor.prototype.isTDDMode = function(){
  return this.TDDMode;
}

Executor.prototype.setWatchPattern = function(pattern) {
    this.watchPattern = '**/*'+pattern+'*/**/*.js';
}

Executor.prototype.getWatchPattern = function() {
    return this.watchPattern;
}

// Start a new Executor
function start(config) {
  var instance = new Executor();
  instance.init(config);
  return instance;
}

module.exports.Executor = Executor;
module.exports.start = start;
Object.seal(module.exports);
