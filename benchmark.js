const fs = require('fs');

// Mock Google Apps Script Environment
class MockProperties {
    constructor() {
        this.store = {};
    }
    getProperty(key) {
        // Simulate GAS API latency (e.g. 5ms per call)
        const start = Date.now();
        while(Date.now() - start < 5) {}
        return this.store[key] !== undefined ? this.store[key] : null;
    }
    getProperties() {
        // Simulate GAS API latency (e.g. 10ms per call)
        const start = Date.now();
        while(Date.now() - start < 10) {}
        return Object.assign({}, this.store);
    }
}

global.PropertiesService = {
    getDocumentProperties: () => new MockProperties(),
    getScriptProperties: () => new MockProperties()
};

// Load CONFIG_DEFAULTS
const code = fs.readFileSync('Code.gs', 'utf8');
const CONFIG_DEFAULTS_MATCH = code.match(/var CONFIG_DEFAULTS = ({[\s\S]*?});/);
if (CONFIG_DEFAULTS_MATCH) {
    eval(CONFIG_DEFAULTS_MATCH[0]);
    global.CONFIG_DEFAULTS = CONFIG_DEFAULTS;
} else {
    console.error("Could not find CONFIG_DEFAULTS");
    process.exit(1);
}

// Old approach
function getConfigInternal_old() {
  var props = PropertiesService.getDocumentProperties();
  var scriptProps = PropertiesService.getScriptProperties();
  var config = {};
  for (var key in CONFIG_DEFAULTS) {
    var val = props.getProperty(key);
    config[key] = val !== null ? val : CONFIG_DEFAULTS[key];
  }
  var apiKey = scriptProps.getProperty('apiKey');
  if (apiKey) {
    config.apiKey = apiKey;
  }
  return config;
}

// New approach
function getConfigInternal_new() {
  var props = PropertiesService.getDocumentProperties();
  var scriptProps = PropertiesService.getScriptProperties();
  var config = {};
  var allProps = props.getProperties();
  for (var key in CONFIG_DEFAULTS) {
    var val = allProps[key];
    config[key] = (val !== undefined && val !== null) ? val : CONFIG_DEFAULTS[key];
  }
  var apiKey = scriptProps.getProperty('apiKey');
  if (apiKey) {
    config.apiKey = apiKey;
  }
  return config;
}

function runBenchmark(name, fn) {
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
        fn();
    }
    const end = Date.now();
    console.log(`${name}: ${end - start}ms`);
    return end - start;
}

console.log("Running benchmarks (10 iterations each)...");
const oldTime = runBenchmark("Old method (N+1 getProperty)", getConfigInternal_old);
const newTime = runBenchmark("New method (1 getProperties)", getConfigInternal_new);

console.log(`Improvement: ${((oldTime - newTime) / oldTime * 100).toFixed(2)}% faster`);
