(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
/*
 * Copyright 2018 Uber Technologies, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @module geojson2h3
 */

var h3 = require('h3-js');

var FEATURE = 'Feature';
var FEATURE_COLLECTION = 'FeatureCollection';
var POLYGON = 'Polygon';
var MULTI_POLYGON = 'MultiPolygon';

// ----------------------------------------------------------------------------
// Private utilities

/**
 * Utility for efficient flattening of arrays. This mutates input,
 * flattening into the first array in the list.
 * @private
 * @param {String[][]} arrays Arrays to flatten
 * @return {String} Single array with all values from all input arrays
 */
function flatten(arrays) {
    var out = null;
    for (var i = 0; i < arrays.length; i++) {
        if (out !== null) {
            for (var j = 0; j < arrays[i].length; j++) {
                out.push(arrays[i][j]);
            }
        } else {
            out = arrays[i];
        }
    }
    return Array.from(new Set(out));
}

/**
 * Utility to compute the centroid of a polygon, based on @turf/centroid
 * @private
 * @param {Number[][][]} polygon     Polygon, as an array of loops
 * @return {Number[]} lngLat         Lng/lat centroid
 */
function centroid(polygon) {
    var lngSum = 0;
    var latSum = 0;
    var count = 0;
    var loop = polygon[0];
    for (var i = 0; i < loop.length; i++) {
        lngSum += loop[i][0];
        latSum += loop[i][1];
        count++;
    }
    return [lngSum / count, latSum / count];
}

/**
 * Convert a GeoJSON feature collection to a set of hexagons. Only hexagons whose centers
 * fall within the features will be included.
 * @private
 * @param  {Object} feature     GeoJSON FeatureCollection
 * @param  {Number} resolution  Resolution of hexagons, between 0 and 15
 * @return {String[]}           H3 indexes
 */
function featureCollectionToH3Set(featureCollection, resolution) {
    var features = featureCollection.features;
    if (!features) {
        throw new Error('No features found');
    }
    return flatten(features.map(function (feature) { return featureToH3Set(feature, resolution); }));
}

// ----------------------------------------------------------------------------
// Public API functions

/**
 * Convert a GeoJSON feature to a set of hexagons. *Only hexagons whose centers
 * fall within the feature will be included.* Note that conversion from GeoJSON
 * is lossy; the resulting hexagon set only approximately describes the original
 * shape, at a level of precision determined by the hexagon resolution.
 *
 * If the polygon is small in comparison with the chosen resolution, there may be
 * no cell whose center lies within it, resulting in an empty set. To fall back
 * to a single H3 cell representing the centroid of the polygon in this case, use
 * the `ensureOutput` option.
 *
 * ![featureToH3Set](./doc-files/featureToH3Set.png)
 * @static
 * @param  {Object} feature     Input GeoJSON: type must be either `Feature` or
 *                              `FeatureCollection`, and geometry type must be
 *                              either `Polygon` or `MultiPolygon`
 * @param  {Number} resolution  Resolution of hexagons, between 0 and 15
 * @param  {Object} [options]   Options
 * @param  {Boolean} [options.ensureOutput] Whether to ensure that at least one
 *                              cell is returned in the set
 * @return {String[]}           H3 indexes
 */
function featureToH3Set(feature, resolution, options) {
    if ( options === void 0 ) options = {};

    var type = feature.type;
    var geometry = feature.geometry;
    var geometryType = geometry && geometry.type;

    if (type === FEATURE_COLLECTION) {
        return featureCollectionToH3Set(feature, resolution);
    }

    if (type !== FEATURE) {
        throw new Error(("Unhandled type: " + type));
    }
    if (geometryType !== POLYGON && geometryType !== MULTI_POLYGON) {
        throw new Error(("Unhandled geometry type: " + geometryType));
    }

    // Normalize to MultiPolygon
    var polygons = geometryType === POLYGON ? [geometry.coordinates] : geometry.coordinates;

    // Polyfill each polygon and flatten the results
    return flatten(
        polygons.map(function (polygon) {
            var result = h3.polyfill(polygon, resolution, true);
            if (result.length || !options.ensureOutput) {
                return result;
            }
            // If we got no results, index the centroid
            var ref = centroid(polygon);
            var lng = ref[0];
            var lat = ref[1];
            return [h3.geoToH3(lat, lng, resolution)];
        })
    );
}

/**
 * Convert a single H3 hexagon to a `Polygon` feature
 * @static
 * @param  {String} hexAddress   Hexagon address
 * @param  {Object} [properties] Optional feature properties
 * @return {Feature}             GeoJSON Feature object
 */
function h3ToFeature(h3Index, properties) {
    if ( properties === void 0 ) properties = {};

    // Wrap in an array for a single-loop polygon
    var coordinates = [h3.h3ToGeoBoundary(h3Index, true)];
    return {
        type: FEATURE,
        id: h3Index,
        properties: properties,
        geometry: {
            type: POLYGON,
            coordinates: coordinates
        }
    };
}

/**
 * Convert a set of hexagons to a GeoJSON `Feature` with the set outline(s). The
 * feature's geometry type will be either `Polygon` or `MultiPolygon` depending on
 * the number of outlines required for the set.
 *
 * ![h3SetToFeature](./doc-files/h3SetToFeature.png)
 * @static
 * @param  {String[]} hexagons   Hexagon addresses
 * @param  {Object} [properties] Optional feature properties
 * @return {Feature}             GeoJSON Feature object
 */
function h3SetToFeature(hexagons, properties) {
    if ( properties === void 0 ) properties = {};

    var polygons = h3.h3SetToMultiPolygon(hexagons, true);
    // See if we can unwrap to a simple Polygon.
    var isMultiPolygon = polygons.length > 1;
    var type = isMultiPolygon ? MULTI_POLYGON : POLYGON;
    // MultiPolygon, single polygon, or empty array for an empty hex set
    var coordinates = isMultiPolygon ? polygons : polygons[0] || [];
    return {
        type: FEATURE,
        properties: properties,
        geometry: {
            type: type,
            coordinates: coordinates
        }
    };
}

/**
 * Convert a set of hexagons to a GeoJSON `MultiPolygon` feature with the
 * outlines of each individual hexagon.
 *
 * ![h3SetToMultiPolygonFeature](./doc-files/h3SetToFeatureCollection.png)
 * @static
 * @param  {String[]} hexagons   Hexagon addresses
 * @param  {Object} [properties] Optional feature properties
 * @return {Feature}             GeoJSON Feature object
 */
function h3SetToMultiPolygonFeature(hexagons, properties) {
    if ( properties === void 0 ) properties = {};

    var coordinates = hexagons.map(function (h3Index) { return [h3.h3ToGeoBoundary(h3Index, {geoJson: true})]; }
    );
    return {
        type: FEATURE,
        properties: properties,
        geometry: {
            type: MULTI_POLYGON,
            coordinates: coordinates
        }
    };
}

/**
 * Convert a set of hexagons to a GeoJSON `FeatureCollection` with each hexagon
 * in a separate `Polygon` feature with optional properties.
 *
 * ![h3SetToFeatureCollection](./doc-files/h3SetToFeatureCollection.png)
 * @static
 * @param  {String[]} hexagons  Hexagon addresses
 * @param  {Function} [getProperties] Optional function returning properties
 *                                    for a hexagon: f(h3Index) => Object
 * @return {FeatureCollection}        GeoJSON FeatureCollection object
 */
function h3SetToFeatureCollection(hexagons, getProperties) {
    var features = [];
    for (var i = 0; i < hexagons.length; i++) {
        var h3Index = hexagons[i];
        var properties = getProperties ? getProperties(h3Index) : {};
        features.push(h3ToFeature(h3Index, properties));
    }
    return {
        type: FEATURE_COLLECTION,
        features: features
    };
}

module.exports = {
    featureToH3Set: featureToH3Set,
    h3ToFeature: h3ToFeature,
    h3SetToFeature: h3SetToFeature,
    h3SetToMultiPolygonFeature: h3SetToMultiPolygonFeature,
    h3SetToFeatureCollection: h3SetToFeatureCollection
};

},{"h3-js":3}],2:[function(require,module,exports){
/*
 * Copyright 2018 Uber Technologies, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

module.exports = require('./dist/src/geojson2h3');

},{"./dist/src/geojson2h3":1}],3:[function(require,module,exports){
var libh3 = function (libh3) {
  libh3 = libh3 || {};
  var Module = typeof libh3 !== "undefined" ? libh3 : {};
  var moduleOverrides = {};
  var key;

  for (key in Module) {
    if (Module.hasOwnProperty(key)) {
      moduleOverrides[key] = Module[key];
    }
  }

  var arguments_ = [];
  var scriptDirectory = "";

  function locateFile(path) {
    if (Module["locateFile"]) {
      return Module["locateFile"](path, scriptDirectory);
    }

    return scriptDirectory + path;
  }

  var readAsync;

  {
    if (document.currentScript) {
      scriptDirectory = document.currentScript.src;
    }

    if (scriptDirectory.indexOf("blob:") !== 0) {
      scriptDirectory = scriptDirectory.substr(0, scriptDirectory.lastIndexOf("/") + 1);
    } else {
      scriptDirectory = "";
    }

    readAsync = function readAsync(url, onload, onerror) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "arraybuffer";

      xhr.onload = function xhr_onload() {
        if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
          onload(xhr.response);
          return;
        }

        var data = tryParseAsDataURI(url);

        if (data) {
          onload(data.buffer);
          return;
        }

        onerror();
      };

      xhr.onerror = onerror;
      xhr.send(null);
    };
  }

  var out = Module["print"] || console.log.bind(console);
  var err = Module["printErr"] || console.warn.bind(console);

  for (key in moduleOverrides) {
    if (moduleOverrides.hasOwnProperty(key)) {
      Module[key] = moduleOverrides[key];
    }
  }

  moduleOverrides = null;
  if (Module["arguments"]) { arguments_ = Module["arguments"]; }

  var tempRet0 = 0;

  var setTempRet0 = function (value) {
    tempRet0 = value;
  };

  var getTempRet0 = function () {
    return tempRet0;
  };

  var GLOBAL_BASE = 8;

  function setValue(ptr, value, type, noSafe) {
    type = type || "i8";
    if (type.charAt(type.length - 1) === "*") { type = "i32"; }

    switch (type) {
      case "i1":
        HEAP8[ptr >> 0] = value;
        break;

      case "i8":
        HEAP8[ptr >> 0] = value;
        break;

      case "i16":
        HEAP16[ptr >> 1] = value;
        break;

      case "i32":
        HEAP32[ptr >> 2] = value;
        break;

      case "i64":
        tempI64 = [value >>> 0, (tempDouble = value, +Math_abs(tempDouble) >= +1 ? tempDouble > +0 ? (Math_min(+Math_floor(tempDouble / +4294967296), +4294967295) | 0) >>> 0 : ~~+Math_ceil((tempDouble - +(~~tempDouble >>> 0)) / +4294967296) >>> 0 : 0)], HEAP32[ptr >> 2] = tempI64[0], HEAP32[ptr + 4 >> 2] = tempI64[1];
        break;

      case "float":
        HEAPF32[ptr >> 2] = value;
        break;

      case "double":
        HEAPF64[ptr >> 3] = value;
        break;

      default:
        abort("invalid type for setValue: " + type);
    }
  }

  function getValue(ptr, type, noSafe) {
    type = type || "i8";
    if (type.charAt(type.length - 1) === "*") { type = "i32"; }

    switch (type) {
      case "i1":
        return HEAP8[ptr >> 0];

      case "i8":
        return HEAP8[ptr >> 0];

      case "i16":
        return HEAP16[ptr >> 1];

      case "i32":
        return HEAP32[ptr >> 2];

      case "i64":
        return HEAP32[ptr >> 2];

      case "float":
        return HEAPF32[ptr >> 2];

      case "double":
        return HEAPF64[ptr >> 3];

      default:
        abort("invalid type for getValue: " + type);
    }

    return null;
  }

  var ABORT = false;

  function assert(condition, text) {
    if (!condition) {
      abort("Assertion failed: " + text);
    }
  }

  function getCFunc(ident) {
    var func = Module["_" + ident];
    assert(func, "Cannot call unknown function " + ident + ", make sure it is exported");
    return func;
  }

  function ccall(ident, returnType, argTypes, args, opts) {
    var toC = {
      "string": function (str) {
        var ret = 0;

        if (str !== null && str !== undefined && str !== 0) {
          var len = (str.length << 2) + 1;
          ret = stackAlloc(len);
          stringToUTF8(str, ret, len);
        }

        return ret;
      },
      "array": function (arr) {
        var ret = stackAlloc(arr.length);
        writeArrayToMemory(arr, ret);
        return ret;
      }
    };

    function convertReturnValue(ret) {
      if (returnType === "string") { return UTF8ToString(ret); }
      if (returnType === "boolean") { return Boolean(ret); }
      return ret;
    }

    var func = getCFunc(ident);
    var cArgs = [];
    var stack = 0;

    if (args) {
      for (var i = 0; i < args.length; i++) {
        var converter = toC[argTypes[i]];

        if (converter) {
          if (stack === 0) { stack = stackSave(); }
          cArgs[i] = converter(args[i]);
        } else {
          cArgs[i] = args[i];
        }
      }
    }

    var ret = func.apply(null, cArgs);
    ret = convertReturnValue(ret);
    if (stack !== 0) { stackRestore(stack); }
    return ret;
  }

  function cwrap(ident, returnType, argTypes, opts) {
    argTypes = argTypes || [];
    var numericArgs = argTypes.every(function (type) {
      return type === "number";
    });
    var numericRet = returnType !== "string";

    if (numericRet && numericArgs && !opts) {
      return getCFunc(ident);
    }

    return function () {
      return ccall(ident, returnType, argTypes, arguments, opts);
    };
  }
  var UTF8Decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf8") : undefined;

  function UTF8ArrayToString(u8Array, idx, maxBytesToRead) {
    var endIdx = idx + maxBytesToRead;
    var endPtr = idx;

    while (u8Array[endPtr] && !(endPtr >= endIdx)) { ++endPtr; }

    if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
      return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
    } else {
      var str = "";

      while (idx < endPtr) {
        var u0 = u8Array[idx++];

        if (!(u0 & 128)) {
          str += String.fromCharCode(u0);
          continue;
        }

        var u1 = u8Array[idx++] & 63;

        if ((u0 & 224) == 192) {
          str += String.fromCharCode((u0 & 31) << 6 | u1);
          continue;
        }

        var u2 = u8Array[idx++] & 63;

        if ((u0 & 240) == 224) {
          u0 = (u0 & 15) << 12 | u1 << 6 | u2;
        } else {
          u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | u8Array[idx++] & 63;
        }

        if (u0 < 65536) {
          str += String.fromCharCode(u0);
        } else {
          var ch = u0 - 65536;
          str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
        }
      }
    }

    return str;
  }

  function UTF8ToString(ptr, maxBytesToRead) {
    return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
  }

  function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
    if (!(maxBytesToWrite > 0)) { return 0; }
    var startIdx = outIdx;
    var endIdx = outIdx + maxBytesToWrite - 1;

    for (var i = 0; i < str.length; ++i) {
      var u = str.charCodeAt(i);

      if (u >= 55296 && u <= 57343) {
        var u1 = str.charCodeAt(++i);
        u = 65536 + ((u & 1023) << 10) | u1 & 1023;
      }

      if (u <= 127) {
        if (outIdx >= endIdx) { break; }
        outU8Array[outIdx++] = u;
      } else if (u <= 2047) {
        if (outIdx + 1 >= endIdx) { break; }
        outU8Array[outIdx++] = 192 | u >> 6;
        outU8Array[outIdx++] = 128 | u & 63;
      } else if (u <= 65535) {
        if (outIdx + 2 >= endIdx) { break; }
        outU8Array[outIdx++] = 224 | u >> 12;
        outU8Array[outIdx++] = 128 | u >> 6 & 63;
        outU8Array[outIdx++] = 128 | u & 63;
      } else {
        if (outIdx + 3 >= endIdx) { break; }
        outU8Array[outIdx++] = 240 | u >> 18;
        outU8Array[outIdx++] = 128 | u >> 12 & 63;
        outU8Array[outIdx++] = 128 | u >> 6 & 63;
        outU8Array[outIdx++] = 128 | u & 63;
      }
    }

    outU8Array[outIdx] = 0;
    return outIdx - startIdx;
  }

  function stringToUTF8(str, outPtr, maxBytesToWrite) {
    return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
  }

  var UTF16Decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-16le") : undefined;

  function writeArrayToMemory(array, buffer) {
    HEAP8.set(array, buffer);
  }

  function alignUp(x, multiple) {
    if (x % multiple > 0) {
      x += multiple - x % multiple;
    }

    return x;
  }

  var buffer, HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;

  function updateGlobalBufferAndViews(buf) {
    buffer = buf;
    Module["HEAP8"] = HEAP8 = new Int8Array(buf);
    Module["HEAP16"] = HEAP16 = new Int16Array(buf);
    Module["HEAP32"] = HEAP32 = new Int32Array(buf);
    Module["HEAPU8"] = HEAPU8 = new Uint8Array(buf);
    Module["HEAPU16"] = HEAPU16 = new Uint16Array(buf);
    Module["HEAPU32"] = HEAPU32 = new Uint32Array(buf);
    Module["HEAPF32"] = HEAPF32 = new Float32Array(buf);
    Module["HEAPF64"] = HEAPF64 = new Float64Array(buf);
  }

  var DYNAMIC_BASE = 5266928,
      DYNAMICTOP_PTR = 24016;
  var INITIAL_TOTAL_MEMORY = Module["TOTAL_MEMORY"] || 33554432;

  if (Module["buffer"]) {
    buffer = Module["buffer"];
  } else {
    buffer = new ArrayBuffer(INITIAL_TOTAL_MEMORY);
  }

  INITIAL_TOTAL_MEMORY = buffer.byteLength;
  updateGlobalBufferAndViews(buffer);
  HEAP32[DYNAMICTOP_PTR >> 2] = DYNAMIC_BASE;

  function callRuntimeCallbacks(callbacks) {
    while (callbacks.length > 0) {
      var callback = callbacks.shift();

      if (typeof callback == "function") {
        callback();
        continue;
      }

      var func = callback.func;

      if (typeof func === "number") {
        if (callback.arg === undefined) {
          Module["dynCall_v"](func);
        } else {
          Module["dynCall_vi"](func, callback.arg);
        }
      } else {
        func(callback.arg === undefined ? null : callback.arg);
      }
    }
  }

  var __ATPRERUN__ = [];
  var __ATINIT__ = [];
  var __ATMAIN__ = [];
  var __ATPOSTRUN__ = [];

  function preRun() {
    if (Module["preRun"]) {
      if (typeof Module["preRun"] == "function") { Module["preRun"] = [Module["preRun"]]; }

      while (Module["preRun"].length) {
        addOnPreRun(Module["preRun"].shift());
      }
    }

    callRuntimeCallbacks(__ATPRERUN__);
  }

  function initRuntime() {
    callRuntimeCallbacks(__ATINIT__);
  }

  function preMain() {
    callRuntimeCallbacks(__ATMAIN__);
  }

  function postRun() {
    if (Module["postRun"]) {
      if (typeof Module["postRun"] == "function") { Module["postRun"] = [Module["postRun"]]; }

      while (Module["postRun"].length) {
        addOnPostRun(Module["postRun"].shift());
      }
    }

    callRuntimeCallbacks(__ATPOSTRUN__);
  }

  function addOnPreRun(cb) {
    __ATPRERUN__.unshift(cb);
  }

  function addOnPostRun(cb) {
    __ATPOSTRUN__.unshift(cb);
  }

  var Math_abs = Math.abs;
  var Math_ceil = Math.ceil;
  var Math_floor = Math.floor;
  var Math_min = Math.min;
  var runDependencies = 0;
  var runDependencyWatcher = null;
  var dependenciesFulfilled = null;

  function addRunDependency(id) {
    runDependencies++;

    if (Module["monitorRunDependencies"]) {
      Module["monitorRunDependencies"](runDependencies);
    }
  }

  function removeRunDependency(id) {
    runDependencies--;

    if (Module["monitorRunDependencies"]) {
      Module["monitorRunDependencies"](runDependencies);
    }

    if (runDependencies == 0) {
      if (runDependencyWatcher !== null) {
        clearInterval(runDependencyWatcher);
        runDependencyWatcher = null;
      }

      if (dependenciesFulfilled) {
        var callback = dependenciesFulfilled;
        dependenciesFulfilled = null;
        callback();
      }
    }
  }

  Module["preloadedImages"] = {};
  Module["preloadedAudios"] = {};
  var memoryInitializer = null;
  var dataURIPrefix = "data:application/octet-stream;base64,";

  function isDataURI(filename) {
    return String.prototype.startsWith ? filename.startsWith(dataURIPrefix) : filename.indexOf(dataURIPrefix) === 0;
  }

  var tempDouble;
  var tempI64;
  memoryInitializer = "data:application/octet-stream;base64,AAAAAAAAAAACAAAAAwAAAAEAAAAFAAAABAAAAAYAAAAAAAAAAAAAAAAAAAABAAAAAgAAAAMAAAAEAAAABQAAAAYAAAABAAAABAAAAAMAAAAGAAAABQAAAAIAAAAAAAAAAgAAAAMAAAABAAAABAAAAAYAAAAAAAAABQAAAAMAAAAGAAAABAAAAAUAAAAAAAAAAQAAAAIAAAAEAAAABQAAAAYAAAAAAAAAAgAAAAMAAAABAAAABQAAAAIAAAAAAAAAAQAAAAMAAAAGAAAABAAAAAYAAAAAAAAABQAAAAIAAAABAAAABAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAgAAAAMAAAAAAAAAAAAAAAIAAAAAAAAAAQAAAAMAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAEAAAABgAAAAAAAAAFAAAAAAAAAAAAAAAEAAAABQAAAAAAAAAAAAAAAAAAAAIAAAAAAAAABgAAAAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAACAAAAAwAAAAQAAAAFAAAABgAAAAEAAAACAAAAAwAAAAQAAAAFAAAABgAAAAAAAAACAAAAAwAAAAQAAAAFAAAABgAAAAAAAAABAAAAAwAAAAQAAAAFAAAABgAAAAAAAAABAAAAAgAAAAQAAAAFAAAABgAAAAAAAAABAAAAAgAAAAMAAAAFAAAABgAAAAAAAAABAAAAAgAAAAMAAAAEAAAABgAAAAAAAAABAAAAAgAAAAMAAAAEAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAADAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAACAAAAAgAAAAAAAAAAAAAABgAAAAAAAAADAAAAAgAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAUAAAAEAAAAAAAAAAEAAAAAAAAAAAAAAAUAAAAFAAAAAAAAAAAAAAAAAAAABgAAAAAAAAAEAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAUAAAACAAAABAAAAAMAAAAIAAAAAQAAAAcAAAAGAAAACQAAAAAAAAADAAAAAgAAAAIAAAAGAAAACgAAAAsAAAAAAAAAAQAAAAUAAAADAAAADQAAAAEAAAAHAAAABAAAAAwAAAAAAAAABAAAAH8AAAAPAAAACAAAAAMAAAAAAAAADAAAAAUAAAACAAAAEgAAAAoAAAAIAAAAAAAAABAAAAAGAAAADgAAAAsAAAARAAAAAQAAAAkAAAACAAAABwAAABUAAAAJAAAAEwAAAAMAAAANAAAAAQAAAAgAAAAFAAAAFgAAABAAAAAEAAAAAAAAAA8AAAAJAAAAEwAAAA4AAAAUAAAAAQAAAAcAAAAGAAAACgAAAAsAAAAYAAAAFwAAAAUAAAACAAAAEgAAAAsAAAARAAAAFwAAABkAAAACAAAABgAAAAoAAAAMAAAAHAAAAA0AAAAaAAAABAAAAA8AAAADAAAADQAAABoAAAAVAAAAHQAAAAMAAAAMAAAABwAAAA4AAAB/AAAAEQAAABsAAAAJAAAAFAAAAAYAAAAPAAAAFgAAABwAAAAfAAAABAAAAAgAAAAMAAAAEAAAABIAAAAhAAAAHgAAAAgAAAAFAAAAFgAAABEAAAALAAAADgAAAAYAAAAjAAAAGQAAABsAAAASAAAAGAAAAB4AAAAgAAAABQAAAAoAAAAQAAAAEwAAACIAAAAUAAAAJAAAAAcAAAAVAAAACQAAABQAAAAOAAAAEwAAAAkAAAAoAAAAGwAAACQAAAAVAAAAJgAAABMAAAAiAAAADQAAAB0AAAAHAAAAFgAAABAAAAApAAAAIQAAAA8AAAAIAAAAHwAAABcAAAAYAAAACwAAAAoAAAAnAAAAJQAAABkAAAAYAAAAfwAAACAAAAAlAAAACgAAABcAAAASAAAAGQAAABcAAAARAAAACwAAAC0AAAAnAAAAIwAAABoAAAAqAAAAHQAAACsAAAAMAAAAHAAAAA0AAAAbAAAAKAAAACMAAAAuAAAADgAAABQAAAARAAAAHAAAAB8AAAAqAAAALAAAAAwAAAAPAAAAGgAAAB0AAAArAAAAJgAAAC8AAAANAAAAGgAAABUAAAAeAAAAIAAAADAAAAAyAAAAEAAAABIAAAAhAAAAHwAAACkAAAAsAAAANQAAAA8AAAAWAAAAHAAAACAAAAAeAAAAGAAAABIAAAA0AAAAMgAAACUAAAAhAAAAHgAAADEAAAAwAAAAFgAAABAAAAApAAAAIgAAABMAAAAmAAAAFQAAADYAAAAkAAAAMwAAACMAAAAuAAAALQAAADgAAAARAAAAGwAAABkAAAAkAAAAFAAAACIAAAATAAAANwAAACgAAAA2AAAAJQAAACcAAAA0AAAAOQAAABgAAAAXAAAAIAAAACYAAAB/AAAAIgAAADMAAAAdAAAALwAAABUAAAAnAAAAJQAAABkAAAAXAAAAOwAAADkAAAAtAAAAKAAAABsAAAAkAAAAFAAAADwAAAAuAAAANwAAACkAAAAxAAAANQAAAD0AAAAWAAAAIQAAAB8AAAAqAAAAOgAAACsAAAA+AAAAHAAAACwAAAAaAAAAKwAAAD4AAAAvAAAAQAAAABoAAAAqAAAAHQAAACwAAAA1AAAAOgAAAEEAAAAcAAAAHwAAACoAAAAtAAAAJwAAACMAAAAZAAAAPwAAADsAAAA4AAAALgAAADwAAAA4AAAARAAAABsAAAAoAAAAIwAAAC8AAAAmAAAAKwAAAB0AAABFAAAAMwAAAEAAAAAwAAAAMQAAAB4AAAAhAAAAQwAAAEIAAAAyAAAAMQAAAH8AAAA9AAAAQgAAACEAAAAwAAAAKQAAADIAAAAwAAAAIAAAAB4AAABGAAAAQwAAADQAAAAzAAAARQAAADYAAABHAAAAJgAAAC8AAAAiAAAANAAAADkAAABGAAAASgAAACAAAAAlAAAAMgAAADUAAAA9AAAAQQAAAEsAAAAfAAAAKQAAACwAAAA2AAAARwAAADcAAABJAAAAIgAAADMAAAAkAAAANwAAACgAAAA2AAAAJAAAAEgAAAA8AAAASQAAADgAAABEAAAAPwAAAE0AAAAjAAAALgAAAC0AAAA5AAAAOwAAAEoAAABOAAAAJQAAACcAAAA0AAAAOgAAAH8AAAA+AAAATAAAACwAAABBAAAAKgAAADsAAAA/AAAATgAAAE8AAAAnAAAALQAAADkAAAA8AAAASAAAAEQAAABQAAAAKAAAADcAAAAuAAAAPQAAADUAAAAxAAAAKQAAAFEAAABLAAAAQgAAAD4AAAArAAAAOgAAACoAAABSAAAAQAAAAEwAAAA/AAAAfwAAADgAAAAtAAAATwAAADsAAABNAAAAQAAAAC8AAAA+AAAAKwAAAFQAAABFAAAAUgAAAEEAAAA6AAAANQAAACwAAABWAAAATAAAAEsAAABCAAAAQwAAAFEAAABVAAAAMQAAADAAAAA9AAAAQwAAAEIAAAAyAAAAMAAAAFcAAABVAAAARgAAAEQAAAA4AAAAPAAAAC4AAABaAAAATQAAAFAAAABFAAAAMwAAAEAAAAAvAAAAWQAAAEcAAABUAAAARgAAAEMAAAA0AAAAMgAAAFMAAABXAAAASgAAAEcAAABZAAAASQAAAFsAAAAzAAAARQAAADYAAABIAAAAfwAAAEkAAAA3AAAAUAAAADwAAABYAAAASQAAAFsAAABIAAAAWAAAADYAAABHAAAANwAAAEoAAABOAAAAUwAAAFwAAAA0AAAAOQAAAEYAAABLAAAAQQAAAD0AAAA1AAAAXgAAAFYAAABRAAAATAAAAFYAAABSAAAAYAAAADoAAABBAAAAPgAAAE0AAAA/AAAARAAAADgAAABdAAAATwAAAFoAAABOAAAASgAAADsAAAA5AAAAXwAAAFwAAABPAAAATwAAAE4AAAA/AAAAOwAAAF0AAABfAAAATQAAAFAAAABEAAAASAAAADwAAABjAAAAWgAAAFgAAABRAAAAVQAAAF4AAABlAAAAPQAAAEIAAABLAAAAUgAAAGAAAABUAAAAYgAAAD4AAABMAAAAQAAAAFMAAAB/AAAASgAAAEYAAABkAAAAVwAAAFwAAABUAAAARQAAAFIAAABAAAAAYQAAAFkAAABiAAAAVQAAAFcAAABlAAAAZgAAAEIAAABDAAAAUQAAAFYAAABMAAAASwAAAEEAAABoAAAAYAAAAF4AAABXAAAAUwAAAGYAAABkAAAAQwAAAEYAAABVAAAAWAAAAEgAAABbAAAASQAAAGMAAABQAAAAaQAAAFkAAABhAAAAWwAAAGcAAABFAAAAVAAAAEcAAABaAAAATQAAAFAAAABEAAAAagAAAF0AAABjAAAAWwAAAEkAAABZAAAARwAAAGkAAABYAAAAZwAAAFwAAABTAAAATgAAAEoAAABsAAAAZAAAAF8AAABdAAAATwAAAFoAAABNAAAAbQAAAF8AAABqAAAAXgAAAFYAAABRAAAASwAAAGsAAABoAAAAZQAAAF8AAABcAAAATwAAAE4AAABtAAAAbAAAAF0AAABgAAAAaAAAAGIAAABuAAAATAAAAFYAAABSAAAAYQAAAH8AAABiAAAAVAAAAGcAAABZAAAAbwAAAGIAAABuAAAAYQAAAG8AAABSAAAAYAAAAFQAAABjAAAAUAAAAGkAAABYAAAAagAAAFoAAABxAAAAZAAAAGYAAABTAAAAVwAAAGwAAAByAAAAXAAAAGUAAABmAAAAawAAAHAAAABRAAAAVQAAAF4AAABmAAAAZQAAAFcAAABVAAAAcgAAAHAAAABkAAAAZwAAAFsAAABhAAAAWQAAAHQAAABpAAAAbwAAAGgAAABrAAAAbgAAAHMAAABWAAAAXgAAAGAAAABpAAAAWAAAAGcAAABbAAAAcQAAAGMAAAB0AAAAagAAAF0AAABjAAAAWgAAAHUAAABtAAAAcQAAAGsAAAB/AAAAZQAAAF4AAABzAAAAaAAAAHAAAABsAAAAZAAAAF8AAABcAAAAdgAAAHIAAABtAAAAbQAAAGwAAABdAAAAXwAAAHUAAAB2AAAAagAAAG4AAABiAAAAaAAAAGAAAAB3AAAAbwAAAHMAAABvAAAAYQAAAG4AAABiAAAAdAAAAGcAAAB3AAAAcAAAAGsAAABmAAAAZQAAAHgAAABzAAAAcgAAAHEAAABjAAAAdAAAAGkAAAB1AAAAagAAAHkAAAByAAAAcAAAAGQAAABmAAAAdgAAAHgAAABsAAAAcwAAAG4AAABrAAAAaAAAAHgAAAB3AAAAcAAAAHQAAABnAAAAdwAAAG8AAABxAAAAaQAAAHkAAAB1AAAAfwAAAG0AAAB2AAAAcQAAAHkAAABqAAAAdgAAAHgAAABsAAAAcgAAAHUAAAB5AAAAbQAAAHcAAABvAAAAcwAAAG4AAAB5AAAAdAAAAHgAAAB4AAAAcwAAAHIAAABwAAAAeQAAAHcAAAB2AAAAeQAAAHQAAAB4AAAAdwAAAHUAAABxAAAAdgAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAEAAAAFAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAIAAAAFAAAAAQAAAAAAAAD/////AQAAAAAAAAADAAAABAAAAAIAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAwAAAAUAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAUAAAABAAAAAAAAAAAAAAABAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAQAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAMAAAAFAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAEAAAAAAAAA/////wMAAAAAAAAABQAAAAIAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAQAAAAFAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAwAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAUAAAAFAAAAAAAAAAAAAAADAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAUAAAAFAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAEAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAMAAAAAAAAAAAAAAP////8DAAAAAAAAAAUAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAADAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAEAAAADAAAAAAAAAAAAAAABAAAAAAAAAAMAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAwAAAAAAAAADAAAAAAAAAAAAAAABAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAADAAAAAwAAAAMAAAADAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAAAAAAAAwAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAMAAAAAAAAA/////wMAAAAAAAAABQAAAAIAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAADAAAAAAAAAAAAAAADAAAAAAAAAAAAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAADAAAABQAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAUAAAAFAAAAAAAAAAAAAAADAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAADAAAAAAAAAAAAAAABAAAAAAAAAAAAAAADAAAAAAAAAAAAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAADAAAAAwAAAAAAAAADAAAAAAAAAAAAAAD/////AwAAAAAAAAAFAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAADAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAADAAAAAwAAAAAAAAAAAAAAAwAAAAAAAAADAAAAAAAAAAMAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAMAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAMAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAADAAAAAAAAAAAAAAD/////AwAAAAAAAAAFAAAAAgAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAwAAAAMAAAAAAAAAAAAAAAMAAAADAAAAAwAAAAMAAAADAAAAAAAAAAAAAAADAAAAAwAAAAMAAAADAAAAAAAAAAMAAAAAAAAAAwAAAAMAAAADAAAAAwAAAAAAAAADAAAAAAAAAP////8DAAAAAAAAAAUAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAADAAAAAwAAAAAAAAADAAAAAAAAAAAAAAADAAAAAwAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAMAAAAAAAAAAAAAAP////8DAAAAAAAAAAUAAAACAAAAAAAAAAAAAAADAAAAAwAAAAMAAAAAAAAAAAAAAAMAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAUAAAAAAAAAAAAAAAMAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAMAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAEAAAADAAAAAQAAAAAAAAABAAAAAAAAAAAAAAADAAAAAAAAAAMAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAAAAAADAAAAAAAAAAMAAAAAAAAA/////wMAAAAAAAAABQAAAAIAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAMAAAAAAAAAAAAAAAMAAAADAAAAAwAAAAMAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAABQAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAADAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAUAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAUAAAAFAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAADAAAAAAAAAAAAAAD/////AwAAAAAAAAAFAAAAAgAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAADAAAAAAAAAAUAAAAAAAAAAAAAAAUAAAAFAAAAAAAAAAAAAAAAAAAAAQAAAAMAAAABAAAAAAAAAAEAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAADAAAAAAAAAAMAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAMAAAABAAAAAAAAAAEAAAAAAAAAAwAAAAMAAAADAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAADAAAABQAAAAEAAAAAAAAA/////wMAAAAAAAAABQAAAAIAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAUAAAAFAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAEAAAABQAAAAEAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAgAAAAUAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAQAAAAMAAAABAAAAAAAAAAEAAAAAAAAABQAAAAAAAAAAAAAABQAAAAUAAAAAAAAAAAAAAP////8BAAAAAAAAAAMAAAAEAAAAAgAAAAAAAAAAAAAAAQAAAAAAAAAAAAAABQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAUAAAAAAAAAAAAAAAUAAAAFAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAABQAAAAEAAAAAAAAAAAAAAAEAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAQAAAP//////////AQAAAAEAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAMAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAACwAAAAIAAAAAAAAAAAAAAAEAAAACAAAABgAAAAQAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAEAAAABAAAAAAAAAAAAAAAAAAAABwAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAoAAAACAAAAAAAAAAAAAAABAAAAAQAAAAUAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAACwAAAAEAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAIAAAAAAAAAAAAAAAEAAAADAAAABwAAAAYAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAHAAAAAQAAAAAAAAABAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAEAAAABAAAAAAAAAAAAAAAAAAAABAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAOAAAAAgAAAAAAAAAAAAAAAQAAAAAAAAAJAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAwAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACwAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANAAAAAgAAAAAAAAAAAAAAAQAAAAQAAAAIAAAACgAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAsAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAJAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAACAAAAAAAAAAAAAAABAAAACwAAAA8AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAA4AAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAgAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAFAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAAAACAAAAAAAAAAAAAAABAAAADAAAABAAAAAMAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAACgAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAA8AAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAPAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAABAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAANAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAIAAAAAAAAAAAAAAAEAAAAKAAAAEwAAAAgAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAARAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARAAAAAAAAAAEAAAABAAAAAAAAAAAAAAAAAAAADwAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAABAAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAJAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAgAAAAAAAAAAAAAAAQAAAA0AAAARAAAADQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAABEAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAATAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAADgAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAABMAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAARAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAADQAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAABEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAIAAAAAAAAAAAAAAAEAAAAOAAAAEgAAAA8AAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAPAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEgAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAAAABIAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAATAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAEQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAEgAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAABMAAAACAAAAAAAAAAAAAAABAAAA//////////8TAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABMAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAASAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABIAAAAAAAAAGAAAAAAAAAAhAAAAAAAAAB4AAAAAAAAAIAAAAAMAAAAxAAAAAQAAADAAAAADAAAAMgAAAAMAAAAIAAAAAAAAAAUAAAAFAAAACgAAAAUAAAAWAAAAAAAAABAAAAAAAAAAEgAAAAAAAAApAAAAAQAAACEAAAAAAAAAHgAAAAAAAAAEAAAAAAAAAAAAAAAFAAAAAgAAAAUAAAAPAAAAAQAAAAgAAAAAAAAABQAAAAUAAAAfAAAAAQAAABYAAAAAAAAAEAAAAAAAAAACAAAAAAAAAAYAAAAAAAAADgAAAAAAAAAKAAAAAAAAAAsAAAAAAAAAEQAAAAMAAAAYAAAAAQAAABcAAAADAAAAGQAAAAMAAAAAAAAAAAAAAAEAAAAFAAAACQAAAAUAAAAFAAAAAAAAAAIAAAAAAAAABgAAAAAAAAASAAAAAQAAAAoAAAAAAAAACwAAAAAAAAAEAAAAAQAAAAMAAAAFAAAABwAAAAUAAAAIAAAAAQAAAAAAAAAAAAAAAQAAAAUAAAAQAAAAAQAAAAUAAAAAAAAAAgAAAAAAAAAHAAAAAAAAABUAAAAAAAAAJgAAAAAAAAAJAAAAAAAAABMAAAAAAAAAIgAAAAMAAAAOAAAAAQAAABQAAAADAAAAJAAAAAMAAAADAAAAAAAAAA0AAAAFAAAAHQAAAAUAAAABAAAAAAAAAAcAAAAAAAAAFQAAAAAAAAAGAAAAAQAAAAkAAAAAAAAAEwAAAAAAAAAEAAAAAgAAAAwAAAAFAAAAGgAAAAUAAAAAAAAAAQAAAAMAAAAAAAAADQAAAAUAAAACAAAAAQAAAAEAAAAAAAAABwAAAAAAAAAaAAAAAAAAACoAAAAAAAAAOgAAAAAAAAAdAAAAAAAAACsAAAAAAAAAPgAAAAMAAAAmAAAAAQAAAC8AAAADAAAAQAAAAAMAAAAMAAAAAAAAABwAAAAFAAAALAAAAAUAAAANAAAAAAAAABoAAAAAAAAAKgAAAAAAAAAVAAAAAQAAAB0AAAAAAAAAKwAAAAAAAAAEAAAAAwAAAA8AAAAFAAAAHwAAAAUAAAADAAAAAQAAAAwAAAAAAAAAHAAAAAUAAAAHAAAAAQAAAA0AAAAAAAAAGgAAAAAAAAAfAAAAAAAAACkAAAAAAAAAMQAAAAAAAAAsAAAAAAAAADUAAAAAAAAAPQAAAAMAAAA6AAAAAQAAAEEAAAADAAAASwAAAAMAAAAPAAAAAAAAABYAAAAFAAAAIQAAAAUAAAAcAAAAAAAAAB8AAAAAAAAAKQAAAAAAAAAqAAAAAQAAACwAAAAAAAAANQAAAAAAAAAEAAAABAAAAAgAAAAFAAAAEAAAAAUAAAAMAAAAAQAAAA8AAAAAAAAAFgAAAAUAAAAaAAAAAQAAABwAAAAAAAAAHwAAAAAAAAAyAAAAAAAAADAAAAAAAAAAMQAAAAMAAAAgAAAAAAAAAB4AAAADAAAAIQAAAAMAAAAYAAAAAwAAABIAAAADAAAAEAAAAAMAAABGAAAAAAAAAEMAAAAAAAAAQgAAAAMAAAA0AAAAAwAAADIAAAAAAAAAMAAAAAAAAAAlAAAAAwAAACAAAAAAAAAAHgAAAAMAAABTAAAAAAAAAFcAAAADAAAAVQAAAAMAAABKAAAAAwAAAEYAAAAAAAAAQwAAAAAAAAA5AAAAAQAAADQAAAADAAAAMgAAAAAAAAAZAAAAAAAAABcAAAAAAAAAGAAAAAMAAAARAAAAAAAAAAsAAAADAAAACgAAAAMAAAAOAAAAAwAAAAYAAAADAAAAAgAAAAMAAAAtAAAAAAAAACcAAAAAAAAAJQAAAAMAAAAjAAAAAwAAABkAAAAAAAAAFwAAAAAAAAAbAAAAAwAAABEAAAAAAAAACwAAAAMAAAA/AAAAAAAAADsAAAADAAAAOQAAAAMAAAA4AAAAAwAAAC0AAAAAAAAAJwAAAAAAAAAuAAAAAwAAACMAAAADAAAAGQAAAAAAAAAkAAAAAAAAABQAAAAAAAAADgAAAAMAAAAiAAAAAAAAABMAAAADAAAACQAAAAMAAAAmAAAAAwAAABUAAAADAAAABwAAAAMAAAA3AAAAAAAAACgAAAAAAAAAGwAAAAMAAAA2AAAAAwAAACQAAAAAAAAAFAAAAAAAAAAzAAAAAwAAACIAAAAAAAAAEwAAAAMAAABIAAAAAAAAADwAAAADAAAALgAAAAMAAABJAAAAAwAAADcAAAAAAAAAKAAAAAAAAABHAAAAAwAAADYAAAADAAAAJAAAAAAAAABAAAAAAAAAAC8AAAAAAAAAJgAAAAMAAAA+AAAAAAAAACsAAAADAAAAHQAAAAMAAAA6AAAAAwAAACoAAAADAAAAGgAAAAMAAABUAAAAAAAAAEUAAAAAAAAAMwAAAAMAAABSAAAAAwAAAEAAAAAAAAAALwAAAAAAAABMAAAAAwAAAD4AAAAAAAAAKwAAAAMAAABhAAAAAAAAAFkAAAADAAAARwAAAAMAAABiAAAAAwAAAFQAAAAAAAAARQAAAAAAAABgAAAAAwAAAFIAAAADAAAAQAAAAAAAAABLAAAAAAAAAEEAAAAAAAAAOgAAAAMAAAA9AAAAAAAAADUAAAADAAAALAAAAAMAAAAxAAAAAwAAACkAAAADAAAAHwAAAAMAAABeAAAAAAAAAFYAAAAAAAAATAAAAAMAAABRAAAAAwAAAEsAAAAAAAAAQQAAAAAAAABCAAAAAwAAAD0AAAAAAAAANQAAAAMAAABrAAAAAAAAAGgAAAADAAAAYAAAAAMAAABlAAAAAwAAAF4AAAAAAAAAVgAAAAAAAABVAAAAAwAAAFEAAAADAAAASwAAAAAAAAA5AAAAAAAAADsAAAAAAAAAPwAAAAMAAABKAAAAAAAAAE4AAAADAAAATwAAAAMAAABTAAAAAwAAAFwAAAADAAAAXwAAAAMAAAAlAAAAAAAAACcAAAADAAAALQAAAAMAAAA0AAAAAAAAADkAAAAAAAAAOwAAAAAAAABGAAAAAwAAAEoAAAAAAAAATgAAAAMAAAAYAAAAAAAAABcAAAADAAAAGQAAAAMAAAAgAAAAAwAAACUAAAAAAAAAJwAAAAMAAAAyAAAAAwAAADQAAAAAAAAAOQAAAAAAAAAuAAAAAAAAADwAAAAAAAAASAAAAAMAAAA4AAAAAAAAAEQAAAADAAAAUAAAAAMAAAA/AAAAAwAAAE0AAAADAAAAWgAAAAMAAAAbAAAAAAAAACgAAAADAAAANwAAAAMAAAAjAAAAAAAAAC4AAAAAAAAAPAAAAAAAAAAtAAAAAwAAADgAAAAAAAAARAAAAAMAAAAOAAAAAAAAABQAAAADAAAAJAAAAAMAAAARAAAAAwAAABsAAAAAAAAAKAAAAAMAAAAZAAAAAwAAACMAAAAAAAAALgAAAAAAAABHAAAAAAAAAFkAAAAAAAAAYQAAAAMAAABJAAAAAAAAAFsAAAADAAAAZwAAAAMAAABIAAAAAwAAAFgAAAADAAAAaQAAAAMAAAAzAAAAAAAAAEUAAAADAAAAVAAAAAMAAAA2AAAAAAAAAEcAAAAAAAAAWQAAAAAAAAA3AAAAAwAAAEkAAAAAAAAAWwAAAAMAAAAmAAAAAAAAAC8AAAADAAAAQAAAAAMAAAAiAAAAAwAAADMAAAAAAAAARQAAAAMAAAAkAAAAAwAAADYAAAAAAAAARwAAAAAAAABgAAAAAAAAAGgAAAAAAAAAawAAAAMAAABiAAAAAAAAAG4AAAADAAAAcwAAAAMAAABhAAAAAwAAAG8AAAADAAAAdwAAAAMAAABMAAAAAAAAAFYAAAADAAAAXgAAAAMAAABSAAAAAAAAAGAAAAAAAAAAaAAAAAAAAABUAAAAAwAAAGIAAAAAAAAAbgAAAAMAAAA6AAAAAAAAAEEAAAADAAAASwAAAAMAAAA+AAAAAwAAAEwAAAAAAAAAVgAAAAMAAABAAAAAAwAAAFIAAAAAAAAAYAAAAAAAAABVAAAAAAAAAFcAAAAAAAAAUwAAAAMAAABlAAAAAAAAAGYAAAADAAAAZAAAAAMAAABrAAAAAwAAAHAAAAADAAAAcgAAAAMAAABCAAAAAAAAAEMAAAADAAAARgAAAAMAAABRAAAAAAAAAFUAAAAAAAAAVwAAAAAAAABeAAAAAwAAAGUAAAAAAAAAZgAAAAMAAAAxAAAAAAAAADAAAAADAAAAMgAAAAMAAAA9AAAAAwAAAEIAAAAAAAAAQwAAAAMAAABLAAAAAwAAAFEAAAAAAAAAVQAAAAAAAABfAAAAAAAAAFwAAAAAAAAAUwAAAAAAAABPAAAAAAAAAE4AAAAAAAAASgAAAAMAAAA/AAAAAQAAADsAAAADAAAAOQAAAAMAAABtAAAAAAAAAGwAAAAAAAAAZAAAAAUAAABdAAAAAQAAAF8AAAAAAAAAXAAAAAAAAABNAAAAAQAAAE8AAAAAAAAATgAAAAAAAAB1AAAABAAAAHYAAAAFAAAAcgAAAAUAAABqAAAAAQAAAG0AAAAAAAAAbAAAAAAAAABaAAAAAQAAAF0AAAABAAAAXwAAAAAAAABaAAAAAAAAAE0AAAAAAAAAPwAAAAAAAABQAAAAAAAAAEQAAAAAAAAAOAAAAAMAAABIAAAAAQAAADwAAAADAAAALgAAAAMAAABqAAAAAAAAAF0AAAAAAAAATwAAAAUAAABjAAAAAQAAAFoAAAAAAAAATQAAAAAAAABYAAAAAQAAAFAAAAAAAAAARAAAAAAAAAB1AAAAAwAAAG0AAAAFAAAAXwAAAAUAAABxAAAAAQAAAGoAAAAAAAAAXQAAAAAAAABpAAAAAQAAAGMAAAABAAAAWgAAAAAAAABpAAAAAAAAAFgAAAAAAAAASAAAAAAAAABnAAAAAAAAAFsAAAAAAAAASQAAAAMAAABhAAAAAQAAAFkAAAADAAAARwAAAAMAAABxAAAAAAAAAGMAAAAAAAAAUAAAAAUAAAB0AAAAAQAAAGkAAAAAAAAAWAAAAAAAAABvAAAAAQAAAGcAAAAAAAAAWwAAAAAAAAB1AAAAAgAAAGoAAAAFAAAAWgAAAAUAAAB5AAAAAQAAAHEAAAAAAAAAYwAAAAAAAAB3AAAAAQAAAHQAAAABAAAAaQAAAAAAAAB3AAAAAAAAAG8AAAAAAAAAYQAAAAAAAABzAAAAAAAAAG4AAAAAAAAAYgAAAAMAAABrAAAAAQAAAGgAAAADAAAAYAAAAAMAAAB5AAAAAAAAAHQAAAAAAAAAZwAAAAUAAAB4AAAAAQAAAHcAAAAAAAAAbwAAAAAAAABwAAAAAQAAAHMAAAAAAAAAbgAAAAAAAAB1AAAAAQAAAHEAAAAFAAAAaQAAAAUAAAB2AAAAAQAAAHkAAAAAAAAAdAAAAAAAAAByAAAAAQAAAHgAAAABAAAAdwAAAAAAAAByAAAAAAAAAHAAAAAAAAAAawAAAAAAAABkAAAAAAAAAGYAAAAAAAAAZQAAAAMAAABTAAAAAQAAAFcAAAADAAAAVQAAAAMAAAB2AAAAAAAAAHgAAAAAAAAAcwAAAAUAAABsAAAAAQAAAHIAAAAAAAAAcAAAAAAAAABcAAAAAQAAAGQAAAAAAAAAZgAAAAAAAAB1AAAAAAAAAHkAAAAFAAAAdwAAAAUAAABtAAAAAQAAAHYAAAAAAAAAeAAAAAAAAABfAAAAAQAAAGwAAAABAAAAcgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAQAAAAEAAAABAAAAAAAAAAAAAAABAAAAAAAAAAEAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAB+ogX28rbpPxqumpJv+fM/165tC4ns9D+XaEnTqUsEQFrOtNlC4PA/3U+0XG6P9b9TdUUBxTTjP4PUp8ex1ty/B1rD/EN43z+lcDi6LLrZP/a45NWEHMY/oJ5ijLDZ+j/xw3rjxWPjP2B8A46ioQdAotff3wla2z+FMSpA1jj+v6b5Y1mtPbS/cIu8K0F457/2esiyJpDNv98k5Ts2NeA/pvljWa09tD88ClUJ60MDQPZ6yLImkM0/4ONKxa0UBcD2uOTVhBzGv5G7JRxGave/8cN648Vj47+HCwtkjAXIv6LX398JWtu/qyheaCAL9D9TdUUBxTTjv4gyTxslhwVAB1rD/EN4378EH/28teoFwH6iBfbytum/F6ztFYdK/r/Xrm0Liez0vwcS6wNGWeO/Ws602ULg8L9TCtRLiLT8P8pi5RexJsw/BlIKPVwR5T95Wyu0/QjnP5PjoT7YYcu/mBhKZ6zrwj8wRYS7NebuP3qW6geh+Ls/SLrixebL3r+pcyymN9XrPwmkNHp7xec/GWNMZVAA17+82s+x2BLiPwn2ytbJ9ek/LgEH1sMS1j8yp/2LhTfeP+SnWwtQBbu/d38gkp5X7z8ytsuHaADGPzUYObdf1+m/7IauECWhwz+cjSACjzniP76Z+wUhN9K/1+GEKzup67+/GYr/04baPw6idWOvsuc/ZedTWsRa5b/EJQOuRzi0v/OncYhHPes/h49PixY53j+i8wWfC03Nvw2idWOvsue/ZedTWsRa5T/EJQOuRzi0P/KncYhHPeu/iY9PixY53r+i8wWfC03NP9anWwtQBbs/d38gkp5X778ytsuHaADGvzUYObdf1+k/74auECWhw7+cjSACjzniv8CZ+wUhN9I/1uGEKzup6z+/GYr/04bavwmkNHp7xee/F2NMZVAA1z+82s+x2BLivwr2ytbJ9em/KwEH1sMS1r8yp/2LhTfev81i5RexJsy/BlIKPVwR5b95Wyu0/Qjnv5DjoT7YYcs/nBhKZ6zrwr8wRYS7Nebuv3OW6geh+Lu/SLrixebL3j+pcyymN9Xrv8rHIFfWehZAMBwUdlo0DECTUc17EOb2PxpVB1SWChdAzjbhb9pTDUDQhmdvECX5P9FlMKCC9+g/IIAzjELgE0DajDngMv8GQFhWDmDPjNs/y1guLh96EkAxPi8k7DIEQJCc4URlhRhA3eLKKLwkEECqpNAyTBD/P6xpjXcDiwVAFtl//cQm4z+Ibt3XKiYTQM7mCLUb3QdAoM1t8yVv7D8aLZv2Nk8UQEAJPV5nQwxAtSsfTCoE9z9TPjXLXIIWQBVanC5W9AtAYM3d7Adm9j++5mQz1FoWQBUThyaVBghAwH5muQsV7T89Q1qv82MUQJoWGOfNuBdAzrkClkmwDkDQjKq77t37Py+g0dtitsE/ZwAMTwVPEUBojepluNwBQGYbtuW+t9w/HNWIJs6MEkDTNuQUSlgEQKxktPP5TcQ/ixbLB8JjEUCwuWjXMQYCQAS/R09FkRdAowpiZjhhDkB7LmlczD/7P01iQmhhsAVAnrtTwDy84z/Z6jfQ2TgTQChOCXMnWwpAhrW3daoz8z/HYJvVPI4VQLT3ik5FcA5Angi7LOZd+z+NNVzDy5gXQBXdvVTFUA1AYNMgOeYe+T8+qHXGCwkXQKQTOKwa5AJA8gFVoEMW0T+FwzJyttIRQAEAAAD/////BwAAAP////8xAAAA/////1cBAAD/////YQkAAP////+nQQAA/////5HLAQD/////95AMAP/////B9lcAAAAAAAAAAAAAAAAAAgAAAP////8OAAAA/////2IAAAD/////rgIAAP/////CEgAA/////06DAAD/////IpcDAP/////uIRkA/////4LtrwAAAAAAAAAAAAAAAAAAAAAAAgAAAP//////////AQAAAAMAAAD//////////////////////////////////////////////////////////////////////////wEAAAAAAAAAAgAAAP///////////////wMAAAD//////////////////////////////////////////////////////////////////////////wEAAAAAAAAAAgAAAP///////////////wMAAAD//////////////////////////////////////////////////////////////////////////wEAAAAAAAAAAgAAAP///////////////wMAAAD//////////////////////////////////////////////////////////wIAAAD//////////wEAAAAAAAAA/////////////////////wMAAAD/////////////////////////////////////////////////////AwAAAP////////////////////8AAAAA/////////////////////wEAAAD///////////////8CAAAA////////////////////////////////AwAAAP////////////////////8AAAAA////////////////AgAAAAEAAAD/////////////////////////////////////////////////////AwAAAP////////////////////8AAAAA////////////////AgAAAAEAAAD/////////////////////////////////////////////////////AwAAAP////////////////////8AAAAA////////////////AgAAAAEAAAD/////////////////////////////////////////////////////AwAAAP////////////////////8AAAAA////////////////AgAAAAEAAAD/////////////////////////////////////////////////////AQAAAAIAAAD///////////////8AAAAA/////////////////////wMAAAD/////////////////////////////////////////////////////AQAAAAIAAAD///////////////8AAAAA/////////////////////wMAAAD/////////////////////////////////////////////////////AQAAAAIAAAD///////////////8AAAAA/////////////////////wMAAAD/////////////////////////////////////////////////////AQAAAAIAAAD///////////////8AAAAA/////////////////////wMAAAD///////////////////////////////8CAAAA////////////////AQAAAP////////////////////8AAAAA/////////////////////wMAAAD/////////////////////////////////////////////////////AwAAAP////////////////////8AAAAAAQAAAP//////////AgAAAP//////////////////////////////////////////////////////////AwAAAP///////////////wIAAAAAAAAAAQAAAP//////////////////////////////////////////////////////////////////////////AwAAAP///////////////wIAAAAAAAAAAQAAAP//////////////////////////////////////////////////////////////////////////AwAAAP///////////////wIAAAAAAAAAAQAAAP//////////////////////////////////////////////////////////////////////////AwAAAAEAAAD//////////wIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAgAAAAAAAAACAAAAAQAAAAEAAAACAAAAAgAAAAAAAAAFAAAABQAAAAAAAAACAAAAAgAAAAMAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAIAAAABAAAAAgAAAAIAAAACAAAAAAAAAAUAAAAGAAAAAAAAAAIAAAACAAAAAwAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAIAAAAAAAAAAgAAAAEAAAADAAAAAgAAAAIAAAAAAAAABQAAAAcAAAAAAAAAAgAAAAIAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAgAAAAAAAAACAAAAAQAAAAQAAAACAAAAAgAAAAAAAAAFAAAACAAAAAAAAAACAAAAAgAAAAMAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAACAAAAAAAAAAIAAAABAAAAAAAAAAIAAAACAAAAAAAAAAUAAAAJAAAAAAAAAAIAAAACAAAAAwAAAAUAAAAAAAAAAAAAAAAAAAAAAAAACgAAAAIAAAACAAAAAAAAAAMAAAAOAAAAAgAAAAAAAAACAAAAAwAAAAAAAAAAAAAAAgAAAAIAAAADAAAABgAAAAAAAAAAAAAAAAAAAAAAAAALAAAAAgAAAAIAAAAAAAAAAwAAAAoAAAACAAAAAAAAAAIAAAADAAAAAQAAAAAAAAACAAAAAgAAAAMAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAACAAAAAgAAAAAAAAADAAAACwAAAAIAAAAAAAAAAgAAAAMAAAACAAAAAAAAAAIAAAACAAAAAwAAAAgAAAAAAAAAAAAAAAAAAAAAAAAADQAAAAIAAAACAAAAAAAAAAMAAAAMAAAAAgAAAAAAAAACAAAAAwAAAAMAAAAAAAAAAgAAAAIAAAADAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAgAAAAIAAAAAAAAAAwAAAA0AAAACAAAAAAAAAAIAAAADAAAABAAAAAAAAAACAAAAAgAAAAMAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAACAAAAAgAAAAAAAAADAAAABgAAAAIAAAAAAAAAAgAAAAMAAAAPAAAAAAAAAAIAAAACAAAAAwAAAAsAAAAAAAAAAAAAAAAAAAAAAAAABgAAAAIAAAACAAAAAAAAAAMAAAAHAAAAAgAAAAAAAAACAAAAAwAAABAAAAAAAAAAAgAAAAIAAAADAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAgAAAAIAAAAAAAAAAwAAAAgAAAACAAAAAAAAAAIAAAADAAAAEQAAAAAAAAACAAAAAgAAAAMAAAANAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAACAAAAAgAAAAAAAAADAAAACQAAAAIAAAAAAAAAAgAAAAMAAAASAAAAAAAAAAIAAAACAAAAAwAAAA4AAAAAAAAAAAAAAAAAAAAAAAAACQAAAAIAAAACAAAAAAAAAAMAAAAFAAAAAgAAAAAAAAACAAAAAwAAABMAAAAAAAAAAgAAAAIAAAADAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAgAAAAAAAAACAAAAAQAAABMAAAACAAAAAgAAAAAAAAAFAAAACgAAAAAAAAACAAAAAgAAAAMAAAAQAAAAAAAAAAAAAAAAAAAAAAAAABEAAAACAAAAAAAAAAIAAAABAAAADwAAAAIAAAACAAAAAAAAAAUAAAALAAAAAAAAAAIAAAACAAAAAwAAABEAAAAAAAAAAAAAAAAAAAAAAAAAEgAAAAIAAAAAAAAAAgAAAAEAAAAQAAAAAgAAAAIAAAAAAAAABQAAAAwAAAAAAAAAAgAAAAIAAAADAAAAEgAAAAAAAAAAAAAAAAAAAAAAAAATAAAAAgAAAAAAAAACAAAAAQAAABEAAAACAAAAAgAAAAAAAAAFAAAADQAAAAAAAAACAAAAAgAAAAMAAAATAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAACAAAAAAAAAAIAAAABAAAAEgAAAAIAAAACAAAAAAAAAAUAAAAOAAAAAAAAAAIAAAACAAAAAwAAAAIAAAABAAAAAAAAAAEAAAACAAAAAAAAAAAAAAACAAAAAQAAAAAAAAABAAAAAgAAAAEAAAAAAAAAAgAAAAAAAAAFAAAABAAAAAAAAAABAAAABQAAAAAAAAAAAAAABQAAAAQAAAAAAAAAAQAAAAUAAAAEAAAAAAAAAAUAAAAAAAAAAgAAAAEAAAAAAAAAAQAAAAIAAAAAAAAAAAAAAAIAAAABAAAAAAAAAAEAAAACAAAAAQAAAAAAAAACAAAAAgAAAAAAAAABAAAAAAAAAAAAAAAFAAAABAAAAAAAAAABAAAABQAAAAAAAAAAAAAABQAAAAQAAAAAAAAAAQAAAAUAAAAEAAAAAAAAAAUAAAAFAAAAAAAAAAEAAAAAAAAAAAAAAMuhRbbsNlBBYqHW9OmHIkF9XBuqnS31QAK37uYhNMhAOSo3UUupm0DC+6pc6JxvQHV9eseEEEJAzURsCyqlFEB8BQ4NMJjnPyy3tBoS97o/xawXQznRjj89J2K2CZxhP6vX43RIIDQ/S8isgygEBz+LvFHQkmzaPjFFFO7wMq4+AADMLkTtjkIAAOgkJqxhQgAAU7B0MjRCAADwpBcVB0IAAACYP2HaQQAAAIn/Ja5BzczM4Eg6gUHNzMxMU7BTQTMzMzNfgCZBAAAAAEi3+UAAAAAAwGPNQDMzMzMzy6BAmpmZmZkxc0AzMzMzM/NFQDMzMzMzMxlAzczMzMzM7D+ygXSx2U6RQKimJOvQKnpA23hmONTHY0A/AGcxyudNQNb3K647mzZA+S56rrwWIUAm4kUQ+9UJQKre9hGzh/M/BLvoy9WG3T+LmqMf8VHGP2m3nYNV37A/gbFHcyeCmT+cBPWBckiDP61tZACjKW0/q2RbYVUYVj8uDypVyLNAP6jGS5cA5zBBwcqhBdCNGUEGEhQ/JVEDQT6WPnRbNO1AB/AWSJgT1kDfUWNCNLDAQNk+5C33OqlAchWL34QSk0DKvtDIrNV8QNF0G3kFzGVASSeWhBl6UED+/0mNGuk4QGjA/dm/1CJALPLPMql6DEDSHoDrwpP1P2jouzWST+A/egAAAAAAAABKAwAAAAAAAPoWAAAAAAAAyqAAAAAAAAB6ZQQAAAAAAErGHgAAAAAA+mvXAAAAAADK8+MFAAAAAHqqOykAAAAASqmhIAEAAAD6oGvkBwAAAMpm8T43AAAAes+ZuIIBAABKrDQMkwoAAPq1cFUFSgAAyvkUViUGAgAAAAAAAwAAAAYAAAACAAAABQAAAAEAAAAEAAAAAAAAAAAAAAAFAAAAAwAAAAEAAAAGAAAABAAAAAIAAAAAAAAAAAAAAP////8AAAAAAAAAAAAAAAAAAAAAAAAAAP////////////////////////////////////8AAAAA/////wAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAP////8AAAAAAAAAAAEAAAABAAAAAAAAAAAAAAD/////AAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAA/////wUAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAP////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////////////////////////////////////AAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////////////////////////////////////wAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAUAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP////////////////////////////////////8AAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAABAAAAAAAAAAAAAAABAAAAAQAAAAEAAAAAAAAAAQAAAAAAAAAFAAAAAQAAAAEAAAAAAAAAAAAAAAEAAAABAAAAAAAAAAEAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEBAAAAAAABAAEAAAEBAAAAAAABAAAAAQAAAAEAAQAAAAAAAAAAAAAAAAAAAAAEAAAABAAAAAAAAAACAAAAAQAAAAMAAAAOAAAABgAAAAsAAAACAAAABwAAAAEAAAAYAAAABQAAAAoAAAABAAAABgAAAAAAAAAmAAAABwAAAAwAAAADAAAACAAAAAIAAAAxAAAACQAAAA4AAAAAAAAABQAAAAQAAAA6AAAACAAAAA0AAAAEAAAACQAAAAMAAAA/AAAACwAAAAYAAAAPAAAACgAAABAAAABIAAAADAAAAAcAAAAQAAAACwAAABEAAABTAAAACgAAAAUAAAATAAAADgAAAA8AAABhAAAADQAAAAgAAAARAAAADAAAABIAAABrAAAADgAAAAkAAAASAAAADQAAABMAAAB1AAAADwAAABMAAAARAAAAEgAAABAAAAAHAAAABwAAAAEAAAACAAAABAAAAAMAAAAAAAAAAAAAAAcAAAADAAAAAQAAAAIAAAAFAAAABAAAAAAAAAAAAAAAYWxnb3MuYwBfcG9seWZpbGxJbnRlcm5hbABhZGphY2VudEZhY2VEaXJbdG1wRmlqay5mYWNlXVtmaWprLmZhY2VdID09IEtJAGZhY2VpamsuYwBfZmFjZUlqa1BlbnRUb0dlb0JvdW5kYXJ5AGFkamFjZW50RmFjZURpcltjZW50ZXJJSksuZmFjZV1bZmFjZTJdID09IEtJAF9mYWNlSWprVG9HZW9Cb3VuZGFyeQBwb2x5Z29uLT5uZXh0ID09IE5VTEwAbGlua2VkR2VvLmMAYWRkTmV3TGlua2VkUG9seWdvbgBuZXh0ICE9IE5VTEwAbG9vcCAhPSBOVUxMAGFkZE5ld0xpbmtlZExvb3AAcG9seWdvbi0+Zmlyc3QgPT0gTlVMTABhZGRMaW5rZWRMb29wAGNvb3JkICE9IE5VTEwAYWRkTGlua2VkQ29vcmQAbG9vcC0+Zmlyc3QgPT0gTlVMTABpbm5lckxvb3BzICE9IE5VTEwAbm9ybWFsaXplTXVsdGlQb2x5Z29uAGJib3hlcyAhPSBOVUxMAGNhbmRpZGF0ZXMgIT0gTlVMTABmaW5kUG9seWdvbkZvckhvbGUAY2FuZGlkYXRlQkJveGVzICE9IE5VTEwAcmV2RGlyICE9IElOVkFMSURfRElHSVQAbG9jYWxpai5jAGgzVG9Mb2NhbElqawBiYXNlQ2VsbCAhPSBvcmlnaW5CYXNlQ2VsbAAhKG9yaWdpbk9uUGVudCAmJiBpbmRleE9uUGVudCkAcGVudGFnb25Sb3RhdGlvbnMgPj0gMABkaXJlY3Rpb25Sb3RhdGlvbnMgPj0gMABiYXNlQ2VsbCA9PSBvcmlnaW5CYXNlQ2VsbABiYXNlQ2VsbCAhPSBJTlZBTElEX0JBU0VfQ0VMTABsb2NhbElqa1RvSDMAIV9pc0Jhc2VDZWxsUGVudGFnb24oYmFzZUNlbGwpAGJhc2VDZWxsUm90YXRpb25zID49IDAAd2l0aGluUGVudGFnb25Sb3RhdGlvbnMgPj0gMABncmFwaC0+YnVja2V0cyAhPSBOVUxMAHZlcnRleEdyYXBoLmMAaW5pdFZlcnRleEdyYXBoAG5vZGUgIT0gTlVMTABhZGRWZXJ0ZXhOb2Rl";
  var tempDoublePtr = 24032;

  function demangle(func) {
    return func;
  }

  function demangleAll(text) {
    var regex = /\b__Z[\w\d_]+/g;
    return text.replace(regex, function (x) {
      var y = demangle(x);
      return x === y ? x : y + " [" + x + "]";
    });
  }

  function jsStackTrace() {
    var err = new Error();

    if (!err.stack) {
      try {
        throw new Error(0);
      } catch (e) {
        err = e;
      }

      if (!err.stack) {
        return "(no stack trace available)";
      }
    }

    return err.stack.toString();
  }

  function stackTrace() {
    var js = jsStackTrace();
    if (Module["extraStackTrace"]) { js += "\n" + Module["extraStackTrace"](); }
    return demangleAll(js);
  }

  function ___assert_fail(condition, filename, line, func) {
    abort("Assertion failed: " + UTF8ToString(condition) + ", at: " + [filename ? UTF8ToString(filename) : "unknown filename", line, func ? UTF8ToString(func) : "unknown function"]);
  }

  function _emscripten_get_heap_size() {
    return HEAP8.length;
  }

  function _emscripten_memcpy_big(dest, src, num) {
    HEAPU8.set(HEAPU8.subarray(src, src + num), dest);
  }

  function ___setErrNo(value) {
    if (Module["___errno_location"]) { HEAP32[Module["___errno_location"]() >> 2] = value; }
    return value;
  }

  function abortOnCannotGrowMemory(requestedSize) {
    abort("OOM");
  }

  function emscripten_realloc_buffer(size) {
    try {
      var newBuffer = new ArrayBuffer(size);
      if (newBuffer.byteLength != size) { return; }
      new Int8Array(newBuffer).set(HEAP8);

      _emscripten_replace_memory(newBuffer);

      updateGlobalBufferAndViews(newBuffer);
      return 1;
    } catch (e) {}
  }

  function _emscripten_resize_heap(requestedSize) {
    var oldSize = _emscripten_get_heap_size();

    var PAGE_MULTIPLE = 16777216;
    var LIMIT = 2147483648 - PAGE_MULTIPLE;

    if (requestedSize > LIMIT) {
      return false;
    }

    var MIN_TOTAL_MEMORY = 16777216;
    var newSize = Math.max(oldSize, MIN_TOTAL_MEMORY);

    while (newSize < requestedSize) {
      if (newSize <= 536870912) {
        newSize = alignUp(2 * newSize, PAGE_MULTIPLE);
      } else {
        newSize = Math.min(alignUp((3 * newSize + 2147483648) / 4, PAGE_MULTIPLE), LIMIT);
      }
    }

    var replacement = emscripten_realloc_buffer(newSize);

    if (!replacement) {
      return false;
    }

    return true;
  }

  var decodeBase64 = typeof atob === "function" ? atob : function (input) {
    var keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var output = "";
    var chr1, chr2, chr3;
    var enc1, enc2, enc3, enc4;
    var i = 0;
    input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");

    do {
      enc1 = keyStr.indexOf(input.charAt(i++));
      enc2 = keyStr.indexOf(input.charAt(i++));
      enc3 = keyStr.indexOf(input.charAt(i++));
      enc4 = keyStr.indexOf(input.charAt(i++));
      chr1 = enc1 << 2 | enc2 >> 4;
      chr2 = (enc2 & 15) << 4 | enc3 >> 2;
      chr3 = (enc3 & 3) << 6 | enc4;
      output = output + String.fromCharCode(chr1);

      if (enc3 !== 64) {
        output = output + String.fromCharCode(chr2);
      }

      if (enc4 !== 64) {
        output = output + String.fromCharCode(chr3);
      }
    } while (i < input.length);

    return output;
  };

  function intArrayFromBase64(s) {
    try {
      var decoded = decodeBase64(s);
      var bytes = new Uint8Array(decoded.length);

      for (var i = 0; i < decoded.length; ++i) {
        bytes[i] = decoded.charCodeAt(i);
      }

      return bytes;
    } catch (_) {
      throw new Error("Converting base64 string to bytes failed.");
    }
  }

  function tryParseAsDataURI(filename) {
    if (!isDataURI(filename)) {
      return;
    }

    return intArrayFromBase64(filename.slice(dataURIPrefix.length));
  }

  var asmGlobalArg = {
    "Math": Math,
    "Int8Array": Int8Array,
    "Int32Array": Int32Array,
    "Uint8Array": Uint8Array,
    "Float32Array": Float32Array,
    "Float64Array": Float64Array
  };
  var asmLibraryArg = {
    "a": abort,
    "b": setTempRet0,
    "c": getTempRet0,
    "d": ___assert_fail,
    "e": ___setErrNo,
    "f": _emscripten_get_heap_size,
    "g": _emscripten_memcpy_big,
    "h": _emscripten_resize_heap,
    "i": abortOnCannotGrowMemory,
    "j": demangle,
    "k": demangleAll,
    "l": emscripten_realloc_buffer,
    "m": jsStackTrace,
    "n": stackTrace,
    "o": tempDoublePtr,
    "p": DYNAMICTOP_PTR
  }; // EMSCRIPTEN_START_ASM

  var asm =
  /** @suppress {uselessCode} */
  function (global, env, buffer) {
    "almost asm";

    var a = new global.Int8Array(buffer),
        b = new global.Int32Array(buffer),
        c = new global.Uint8Array(buffer),
        d = new global.Float32Array(buffer),
        e = new global.Float64Array(buffer),
        g = env.p | 0,
        p = global.Math.floor,
        q = global.Math.abs,
        r = global.Math.sqrt,
        s = global.Math.pow,
        t = global.Math.cos,
        u = global.Math.sin,
        v = global.Math.tan,
        w = global.Math.acos,
        x = global.Math.asin,
        y = global.Math.atan,
        z = global.Math.atan2,
        A = global.Math.ceil,
        B = global.Math.imul,
        C = global.Math.min,
        D = global.Math.clz32,
        F = env.b,
        G = env.c,
        H = env.d,
        I = env.e,
        J = env.f,
        K = env.g,
        L = env.h,
        M = env.i,
        S = 24048;

    function V(newBuffer) {
      a = new Int8Array(newBuffer);
      c = new Uint8Array(newBuffer);
      b = new Int32Array(newBuffer);
      d = new Float32Array(newBuffer);
      e = new Float64Array(newBuffer);
      buffer = newBuffer;
      return true;
    } // EMSCRIPTEN_START_FUNCS


    function W(a) {
      a = a | 0;
      var b = 0;
      b = S;
      S = S + a | 0;
      S = S + 15 & -16;
      return b | 0;
    }

    function X() {
      return S | 0;
    }

    function Y(a) {
      a = a | 0;
      S = a;
    }

    function Z(a, b) {
      a = a | 0;
      b = b | 0;
      S = a;
    }

    function _(a) {
      a = a | 0;
      return (B(a * 3 | 0, a + 1 | 0) | 0) + 1 | 0;
    }

    function $(a, b, c, d) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0;
      if (!(ba(a, b, c, d, 0) | 0)) { return; }
      f = (B(c * 3 | 0, c + 1 | 0) | 0) + 1 | 0;
      hd(d | 0, 0, f << 3 | 0) | 0;
      e = Yc(f, 4) | 0;
      if (!e) { return; }
      ca(a, b, c, d, e, f, 0);
      Xc(e);
      return;
    }

    function aa(a, b, c, d, e) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0;
      if (!(ba(a, b, c, d, e) | 0)) { return; }
      f = (B(c * 3 | 0, c + 1 | 0) | 0) + 1 | 0;
      hd(d | 0, 0, f << 3 | 0) | 0;

      if (e | 0) {
        hd(e | 0, 0, f << 2 | 0) | 0;
        ca(a, b, c, d, e, f, 0);
        return;
      }

      e = Yc(f, 4) | 0;
      if (!e) { return; }
      ca(a, b, c, d, e, f, 0);
      Xc(e);
      return;
    }

    function ba(a, c, d, e, f) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      f = f | 0;
      var g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0;
      o = S;
      S = S + 16 | 0;
      n = o;
      g = e;
      b[g >> 2] = a;
      b[g + 4 >> 2] = c;
      g = (f | 0) != 0;
      if (g) { b[f >> 2] = 0; }

      if (Fb(a, c) | 0) {
        n = 1;
        S = o;
        return n | 0;
      }

      b[n >> 2] = 0;

      a: do { if ((d | 0) >= 1) {
        if (g) {
          k = 0;
          l = 1;
          m = 1;
          h = 0;
          g = a;

          while (1) {
            if (!(h | k)) {
              g = da(g, c, 4, n) | 0;
              c = G() | 0;

              if ((g | 0) == 0 & (c | 0) == 0) {
                g = 2;
                break a;
              }

              if (Fb(g, c) | 0) {
                g = 1;
                break a;
              }
            }

            g = da(g, c, b[16 + (k << 2) >> 2] | 0, n) | 0;
            c = G() | 0;

            if ((g | 0) == 0 & (c | 0) == 0) {
              g = 2;
              break a;
            }

            a = e + (m << 3) | 0;
            b[a >> 2] = g;
            b[a + 4 >> 2] = c;
            b[f + (m << 2) >> 2] = l;
            h = h + 1 | 0;
            a = (h | 0) == (l | 0);
            i = k + 1 | 0;
            j = (i | 0) == 6;

            if (Fb(g, c) | 0) {
              g = 1;
              break a;
            }

            l = l + (j & a & 1) | 0;

            if ((l | 0) > (d | 0)) {
              g = 0;
              break;
            } else {
              k = a ? j ? 0 : i : k;
              m = m + 1 | 0;
              h = a ? 0 : h;
            }
          }
        } else {
          k = 0;
          l = 1;
          m = 1;
          h = 0;
          g = a;

          while (1) {
            if (!(h | k)) {
              g = da(g, c, 4, n) | 0;
              c = G() | 0;

              if ((g | 0) == 0 & (c | 0) == 0) {
                g = 2;
                break a;
              }

              if (Fb(g, c) | 0) {
                g = 1;
                break a;
              }
            }

            g = da(g, c, b[16 + (k << 2) >> 2] | 0, n) | 0;
            c = G() | 0;

            if ((g | 0) == 0 & (c | 0) == 0) {
              g = 2;
              break a;
            }

            a = e + (m << 3) | 0;
            b[a >> 2] = g;
            b[a + 4 >> 2] = c;
            h = h + 1 | 0;
            a = (h | 0) == (l | 0);
            i = k + 1 | 0;
            j = (i | 0) == 6;

            if (Fb(g, c) | 0) {
              g = 1;
              break a;
            }

            l = l + (j & a & 1) | 0;

            if ((l | 0) > (d | 0)) {
              g = 0;
              break;
            } else {
              k = a ? j ? 0 : i : k;
              m = m + 1 | 0;
              h = a ? 0 : h;
            }
          }
        }
      } else { g = 0; } } while (0);

      n = g;
      S = o;
      return n | 0;
    }

    function ca(a, c, d, e, f, g, h) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      f = f | 0;
      g = g | 0;
      h = h | 0;
      var i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0;
      m = S;
      S = S + 16 | 0;
      l = m;

      if ((a | 0) == 0 & (c | 0) == 0) {
        S = m;
        return;
      }

      i = bd(a | 0, c | 0, g | 0, ((g | 0) < 0) << 31 >> 31 | 0) | 0;
      G() | 0;
      j = e + (i << 3) | 0;
      n = j;
      o = b[n >> 2] | 0;
      n = b[n + 4 >> 2] | 0;
      k = (o | 0) == (a | 0) & (n | 0) == (c | 0);
      if (!((o | 0) == 0 & (n | 0) == 0 | k)) { do {
        i = (i + 1 | 0) % (g | 0) | 0;
        j = e + (i << 3) | 0;
        o = j;
        n = b[o >> 2] | 0;
        o = b[o + 4 >> 2] | 0;
        k = (n | 0) == (a | 0) & (o | 0) == (c | 0);
      } while (!((n | 0) == 0 & (o | 0) == 0 | k)); }
      i = f + (i << 2) | 0;

      if (k ? (b[i >> 2] | 0) <= (h | 0) : 0) {
        S = m;
        return;
      }

      o = j;
      b[o >> 2] = a;
      b[o + 4 >> 2] = c;
      b[i >> 2] = h;

      if ((h | 0) >= (d | 0)) {
        S = m;
        return;
      }

      o = h + 1 | 0;
      b[l >> 2] = 0;
      n = da(a, c, 2, l) | 0;
      ca(n, G() | 0, d, e, f, g, o);
      b[l >> 2] = 0;
      n = da(a, c, 3, l) | 0;
      ca(n, G() | 0, d, e, f, g, o);
      b[l >> 2] = 0;
      n = da(a, c, 1, l) | 0;
      ca(n, G() | 0, d, e, f, g, o);
      b[l >> 2] = 0;
      n = da(a, c, 5, l) | 0;
      ca(n, G() | 0, d, e, f, g, o);
      b[l >> 2] = 0;
      n = da(a, c, 4, l) | 0;
      ca(n, G() | 0, d, e, f, g, o);
      b[l >> 2] = 0;
      n = da(a, c, 6, l) | 0;
      ca(n, G() | 0, d, e, f, g, o);
      S = m;
      return;
    }

    function da(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0;

      if ((b[e >> 2] | 0) > 0) {
        f = 0;

        do {
          d = Pa(d) | 0;
          f = f + 1 | 0;
        } while ((f | 0) < (b[e >> 2] | 0));
      }

      i = cd(a | 0, c | 0, 45) | 0;
      G() | 0;
      j = i & 127;
      g = Lb(a, c) | 0;
      f = cd(a | 0, c | 0, 52) | 0;
      G() | 0;
      f = f & 15;

      a: do { if (!f) { h = 6; }else { while (1) {
        m = (15 - f | 0) * 3 | 0;
        n = cd(a | 0, c | 0, m | 0) | 0;
        G() | 0;
        n = n & 7;
        o = (Rb(f) | 0) == 0;
        f = f + -1 | 0;
        l = dd(7, 0, m | 0) | 0;
        c = c & ~(G() | 0);
        m = dd(b[(o ? 464 : 48) + (n * 28 | 0) + (d << 2) >> 2] | 0, 0, m | 0) | 0;
        k = G() | 0;
        d = b[(o ? 672 : 256) + (n * 28 | 0) + (d << 2) >> 2] | 0;
        a = m | a & ~l;
        c = k | c;

        if (!d) {
          d = 0;
          break a;
        }

        if (!f) {
          h = 6;
          break;
        }
      } } } while (0);

      if ((h | 0) == 6) {
        o = b[880 + (j * 28 | 0) + (d << 2) >> 2] | 0;
        n = dd(o | 0, 0, 45) | 0;
        a = n | a;
        c = G() | 0 | c & -1040385;
        d = b[4304 + (j * 28 | 0) + (d << 2) >> 2] | 0;

        if ((o & 127 | 0) == 127) {
          o = dd(b[880 + (j * 28 | 0) + 20 >> 2] | 0, 0, 45) | 0;
          c = G() | 0 | c & -1040385;
          d = b[4304 + (j * 28 | 0) + 20 >> 2] | 0;
          a = Nb(o | a, c) | 0;
          c = G() | 0;
          b[e >> 2] = (b[e >> 2] | 0) + 1;
        }
      }

      h = cd(a | 0, c | 0, 45) | 0;
      G() | 0;
      h = h & 127;

      b: do { if (!(la(h) | 0)) {
        if ((d | 0) > 0) {
          f = 0;

          do {
            a = Nb(a, c) | 0;
            c = G() | 0;
            f = f + 1 | 0;
          } while ((f | 0) != (d | 0));
        }
      } else {
        c: do { if ((Lb(a, c) | 0) == 1) {
          if ((j | 0) != (h | 0)) { if (ra(h, b[7728 + (j * 28 | 0) >> 2] | 0) | 0) {
            a = Pb(a, c) | 0;
            g = 1;
            c = G() | 0;
            break;
          } else {
            a = Nb(a, c) | 0;
            g = 1;
            c = G() | 0;
            break;
          } }

          switch (g | 0) {
            case 5:
              {
                a = Pb(a, c) | 0;
                c = G() | 0;
                b[e >> 2] = (b[e >> 2] | 0) + 5;
                g = 0;
                break c;
              }

            case 3:
              {
                a = Nb(a, c) | 0;
                c = G() | 0;
                b[e >> 2] = (b[e >> 2] | 0) + 1;
                g = 0;
                break c;
              }

            default:
              {
                n = 0;
                o = 0;
                F(n | 0);
                return o | 0;
              }
          }
        } else { g = 0; } } while (0);

        if ((d | 0) > 0) {
          f = 0;

          do {
            a = Mb(a, c) | 0;
            c = G() | 0;
            f = f + 1 | 0;
          } while ((f | 0) != (d | 0));
        }

        if ((j | 0) != (h | 0)) {
          if (!(ma(h) | 0)) {
            if ((g | 0) != 0 | (Lb(a, c) | 0) != 5) { break; }
            b[e >> 2] = (b[e >> 2] | 0) + 1;
            break;
          }

          switch (i & 127) {
            case 8:
            case 118:
              break b;

            default:

          }

          if ((Lb(a, c) | 0) != 3) { b[e >> 2] = (b[e >> 2] | 0) + 1; }
        }
      } } while (0);

      b[e >> 2] = ((b[e >> 2] | 0) + d | 0) % 6 | 0;
      n = c;
      o = a;
      F(n | 0);
      return o | 0;
    }

    function ea(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0;
      m = S;
      S = S + 16 | 0;
      l = m;

      if (!d) {
        l = e;
        b[l >> 2] = a;
        b[l + 4 >> 2] = c;
        l = 0;
        S = m;
        return l | 0;
      }

      b[l >> 2] = 0;

      a: do { if (!(Fb(a, c) | 0)) {
        g = (d | 0) > 0;

        if (g) {
          f = 0;
          k = a;

          do {
            k = da(k, c, 4, l) | 0;
            c = G() | 0;

            if ((k | 0) == 0 & (c | 0) == 0) {
              a = 2;
              break a;
            }

            f = f + 1 | 0;

            if (Fb(k, c) | 0) {
              a = 1;
              break a;
            }
          } while ((f | 0) < (d | 0));

          j = e;
          b[j >> 2] = k;
          b[j + 4 >> 2] = c;
          j = d + -1 | 0;

          if (g) {
            g = 0;
            h = 1;
            f = k;
            a = c;

            do {
              f = da(f, a, 2, l) | 0;
              a = G() | 0;

              if ((f | 0) == 0 & (a | 0) == 0) {
                a = 2;
                break a;
              }

              i = e + (h << 3) | 0;
              b[i >> 2] = f;
              b[i + 4 >> 2] = a;
              h = h + 1 | 0;

              if (Fb(f, a) | 0) {
                a = 1;
                break a;
              }

              g = g + 1 | 0;
            } while ((g | 0) < (d | 0));

            i = 0;
            g = h;

            do {
              f = da(f, a, 3, l) | 0;
              a = G() | 0;

              if ((f | 0) == 0 & (a | 0) == 0) {
                a = 2;
                break a;
              }

              h = e + (g << 3) | 0;
              b[h >> 2] = f;
              b[h + 4 >> 2] = a;
              g = g + 1 | 0;

              if (Fb(f, a) | 0) {
                a = 1;
                break a;
              }

              i = i + 1 | 0;
            } while ((i | 0) < (d | 0));

            h = 0;

            do {
              f = da(f, a, 1, l) | 0;
              a = G() | 0;

              if ((f | 0) == 0 & (a | 0) == 0) {
                a = 2;
                break a;
              }

              i = e + (g << 3) | 0;
              b[i >> 2] = f;
              b[i + 4 >> 2] = a;
              g = g + 1 | 0;

              if (Fb(f, a) | 0) {
                a = 1;
                break a;
              }

              h = h + 1 | 0;
            } while ((h | 0) < (d | 0));

            h = 0;

            do {
              f = da(f, a, 5, l) | 0;
              a = G() | 0;

              if ((f | 0) == 0 & (a | 0) == 0) {
                a = 2;
                break a;
              }

              i = e + (g << 3) | 0;
              b[i >> 2] = f;
              b[i + 4 >> 2] = a;
              g = g + 1 | 0;

              if (Fb(f, a) | 0) {
                a = 1;
                break a;
              }

              h = h + 1 | 0;
            } while ((h | 0) < (d | 0));

            h = 0;

            do {
              f = da(f, a, 4, l) | 0;
              a = G() | 0;

              if ((f | 0) == 0 & (a | 0) == 0) {
                a = 2;
                break a;
              }

              i = e + (g << 3) | 0;
              b[i >> 2] = f;
              b[i + 4 >> 2] = a;
              g = g + 1 | 0;

              if (Fb(f, a) | 0) {
                a = 1;
                break a;
              }

              h = h + 1 | 0;
            } while ((h | 0) < (d | 0));

            h = 0;

            while (1) {
              f = da(f, a, 6, l) | 0;
              a = G() | 0;

              if ((f | 0) == 0 & (a | 0) == 0) {
                a = 2;
                break a;
              }

              if ((h | 0) != (j | 0)) {
                i = e + (g << 3) | 0;
                b[i >> 2] = f;
                b[i + 4 >> 2] = a;
                if (!(Fb(f, a) | 0)) { g = g + 1 | 0; }else {
                  a = 1;
                  break a;
                }
              }

              h = h + 1 | 0;

              if ((h | 0) >= (d | 0)) {
                h = k;
                g = c;
                break;
              }
            }
          } else {
            h = k;
            f = k;
            g = c;
            a = c;
          }
        } else {
          h = e;
          b[h >> 2] = a;
          b[h + 4 >> 2] = c;
          h = a;
          f = a;
          g = c;
          a = c;
        }

        a = ((h | 0) != (f | 0) | (g | 0) != (a | 0)) & 1;
      } else { a = 1; } } while (0);

      l = a;
      S = m;
      return l | 0;
    }

    function fa(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      g = S;
      S = S + 48 | 0;
      f = g + 8 | 0;
      e = g;
      i = a;
      h = b[i + 4 >> 2] | 0;
      d = e;
      b[d >> 2] = b[i >> 2];
      b[d + 4 >> 2] = h;
      vc(e, f);
      f = ya(f, c) | 0;
      c = b[e >> 2] | 0;
      e = b[a + 8 >> 2] | 0;

      if ((e | 0) <= 0) {
        i = c;
        h = (f | 0) < (i | 0);
        i = h ? i : f;
        i = i + 12 | 0;
        S = g;
        return i | 0;
      }

      d = b[a + 12 >> 2] | 0;
      a = 0;

      do {
        c = (b[d + (a << 3) >> 2] | 0) + c | 0;
        a = a + 1 | 0;
      } while ((a | 0) < (e | 0));

      i = (f | 0) < (c | 0);
      i = i ? c : f;
      i = i + 12 | 0;
      S = g;
      return i | 0;
    }

    function ga(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0;
      i = S;
      S = S + 48 | 0;
      e = i + 8 | 0;
      f = i;

      if (!(ha(a, c, d) | 0)) {
        S = i;
        return;
      }

      j = a;
      g = b[j + 4 >> 2] | 0;
      h = f;
      b[h >> 2] = b[j >> 2];
      b[h + 4 >> 2] = g;
      vc(f, e);
      h = ya(e, c) | 0;
      c = b[f >> 2] | 0;
      g = b[a + 8 >> 2] | 0;

      if ((g | 0) > 0) {
        f = b[a + 12 >> 2] | 0;
        e = 0;

        do {
          c = (b[f + (e << 3) >> 2] | 0) + c | 0;
          e = e + 1 | 0;
        } while ((e | 0) != (g | 0));
      }

      c = (h | 0) < (c | 0) ? c : h;

      if ((c | 0) <= -12) {
        S = i;
        return;
      }

      j = c + 11 | 0;
      hd(d | 0, 0, (((j | 0) > 0 ? j : 0) << 3) + 8 | 0) | 0;
      S = i;
      return;
    }

    function ha(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0,
          x = 0,
          y = 0,
          z = 0,
          A = 0,
          B = 0,
          C = 0,
          D = 0,
          E = 0,
          F = 0,
          I = 0,
          J = 0;
      J = S;
      S = S + 112 | 0;
      D = J + 80 | 0;
      j = J + 72 | 0;
      E = J;
      F = J + 56 | 0;
      k = a + 8 | 0;
      I = Wc((b[k >> 2] << 5) + 32 | 0) | 0;
      if (!I) { H(22848, 22448, 800, 22456); }
      wc(a, I);
      g = a;
      e = b[g + 4 >> 2] | 0;
      i = j;
      b[i >> 2] = b[g >> 2];
      b[i + 4 >> 2] = e;
      vc(j, D);
      i = ya(D, c) | 0;
      e = b[j >> 2] | 0;
      g = b[k >> 2] | 0;

      if ((g | 0) > 0) {
        h = b[a + 12 >> 2] | 0;
        f = 0;

        do {
          e = (b[h + (f << 3) >> 2] | 0) + e | 0;
          f = f + 1 | 0;
        } while ((f | 0) != (g | 0));
      }

      i = (i | 0) < (e | 0) ? e : i;
      C = i + 12 | 0;
      f = Yc(C, 8) | 0;
      l = Yc(C, 8) | 0;
      b[D >> 2] = 0;
      A = a;
      B = b[A + 4 >> 2] | 0;
      e = j;
      b[e >> 2] = b[A >> 2];
      b[e + 4 >> 2] = B;
      e = ia(j, C, c, D, f, l) | 0;

      if (e | 0) {
        Xc(f);
        Xc(l);
        Xc(I);
        I = e;
        S = J;
        return I | 0;
      }

      a: do { if ((b[k >> 2] | 0) > 0) {
        g = a + 12 | 0;
        e = 0;

        while (1) {
          h = ia((b[g >> 2] | 0) + (e << 3) | 0, C, c, D, f, l) | 0;
          e = e + 1 | 0;
          if (h | 0) { break; }
          if ((e | 0) >= (b[k >> 2] | 0)) { break a; }
        }

        Xc(f);
        Xc(l);
        Xc(I);
        I = h;
        S = J;
        return I | 0;
      } } while (0);

      if ((i | 0) > -12) { hd(l | 0, 0, ((C | 0) > 1 ? C : 1) << 3 | 0) | 0; }

      b: do { if ((b[D >> 2] | 0) > 0) {
        B = ((C | 0) < 0) << 31 >> 31;
        v = f;
        w = l;
        x = f;
        y = f;
        z = l;
        A = f;
        e = f;
        r = f;
        s = l;
        t = l;
        u = l;
        f = l;

        c: while (1) {
          q = b[D >> 2] | 0;
          o = 0;
          p = 0;
          g = 0;

          while (1) {
            h = E;
            i = h + 56 | 0;

            do {
              b[h >> 2] = 0;
              h = h + 4 | 0;
            } while ((h | 0) < (i | 0));

            c = v + (o << 3) | 0;
            j = b[c >> 2] | 0;
            c = b[c + 4 >> 2] | 0;

            if (ba(j, c, 1, E, 0) | 0) {
              h = E;
              i = h + 56 | 0;

              do {
                b[h >> 2] = 0;
                h = h + 4 | 0;
              } while ((h | 0) < (i | 0));

              h = Yc(7, 4) | 0;

              if (h | 0) {
                ca(j, c, 1, E, h, 7, 0);
                Xc(h);
              }
            }

            n = 0;

            do {
              m = E + (n << 3) | 0;
              l = b[m >> 2] | 0;
              m = b[m + 4 >> 2] | 0;

              d: do { if (!((l | 0) == 0 & (m | 0) == 0)) {
                j = bd(l | 0, m | 0, C | 0, B | 0) | 0;
                G() | 0;
                h = d + (j << 3) | 0;
                i = h;
                c = b[i >> 2] | 0;
                i = b[i + 4 >> 2] | 0;

                if (!((c | 0) == 0 & (i | 0) == 0)) {
                  k = 0;

                  while (1) {
                    if ((k | 0) > (C | 0)) { break c; }
                    if ((c | 0) == (l | 0) & (i | 0) == (m | 0)) { break d; }
                    j = (j + 1 | 0) % (C | 0) | 0;
                    h = d + (j << 3) | 0;
                    i = h;
                    c = b[i >> 2] | 0;
                    i = b[i + 4 >> 2] | 0;
                    if ((c | 0) == 0 & (i | 0) == 0) { break; }else { k = k + 1 | 0; }
                  }
                }

                if (!((l | 0) == 0 & (m | 0) == 0)) {
                  Vb(l, m, F);

                  if (xc(a, I, F) | 0) {
                    k = h;
                    b[k >> 2] = l;
                    b[k + 4 >> 2] = m;
                    k = w + (g << 3) | 0;
                    b[k >> 2] = l;
                    b[k + 4 >> 2] = m;
                    g = g + 1 | 0;
                  }
                }
              } } while (0);

              n = n + 1 | 0;
            } while (n >>> 0 < 7);

            p = p + 1 | 0;
            if ((p | 0) >= (q | 0)) { break; }else { o = o + 1 | 0; }
          }

          if ((q | 0) > 0) { hd(x | 0, 0, q << 3 | 0) | 0; }
          b[D >> 2] = g;

          if ((g | 0) > 0) {
            l = f;
            m = u;
            n = A;
            o = t;
            p = s;
            q = w;
            f = r;
            u = e;
            t = y;
            s = x;
            r = l;
            e = m;
            A = z;
            z = n;
            y = o;
            x = p;
            w = v;
            v = q;
          } else { break b; }
        }

        Xc(y);
        Xc(z);
        Xc(I);
        I = -1;
        S = J;
        return I | 0;
      } else { e = l; } } while (0);

      Xc(I);
      Xc(f);
      Xc(e);
      I = 0;
      S = J;
      return I | 0;
    }

    function ia(a, c, d, f, g, h) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      f = f | 0;
      g = g | 0;
      h = h | 0;
      var i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0.0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0,
          x = 0,
          y = 0,
          z = 0,
          A = 0,
          B = 0,
          C = 0,
          D = 0.0,
          E = 0.0;
      C = S;
      S = S + 48 | 0;
      y = C + 32 | 0;
      z = C + 16 | 0;
      A = C;
      i = b[a >> 2] | 0;

      if ((i | 0) <= 0) {
        B = 0;
        S = C;
        return B | 0;
      }

      t = a + 4 | 0;
      u = y + 8 | 0;
      v = z + 8 | 0;
      w = A + 8 | 0;
      x = ((c | 0) < 0) << 31 >> 31;
      s = 0;

      a: while (1) {
        j = b[t >> 2] | 0;
        q = j + (s << 4) | 0;
        b[y >> 2] = b[q >> 2];
        b[y + 4 >> 2] = b[q + 4 >> 2];
        b[y + 8 >> 2] = b[q + 8 >> 2];
        b[y + 12 >> 2] = b[q + 12 >> 2];

        if ((s | 0) == (i + -1 | 0)) {
          b[z >> 2] = b[j >> 2];
          b[z + 4 >> 2] = b[j + 4 >> 2];
          b[z + 8 >> 2] = b[j + 8 >> 2];
          b[z + 12 >> 2] = b[j + 12 >> 2];
        } else {
          q = j + (s + 1 << 4) | 0;
          b[z >> 2] = b[q >> 2];
          b[z + 4 >> 2] = b[q + 4 >> 2];
          b[z + 8 >> 2] = b[q + 8 >> 2];
          b[z + 12 >> 2] = b[q + 12 >> 2];
        }

        q = za(y, z, d) | 0;

        b: do { if ((q | 0) > 0) {
          r = +(q | 0);
          p = 0;

          c: while (1) {
            E = +(q - p | 0);
            D = +(p | 0);
            e[A >> 3] = +e[y >> 3] * E / r + +e[z >> 3] * D / r;
            e[w >> 3] = +e[u >> 3] * E / r + +e[v >> 3] * D / r;
            n = Sb(A, d) | 0;
            o = G() | 0;
            j = bd(n | 0, o | 0, c | 0, x | 0) | 0;
            G() | 0;
            i = h + (j << 3) | 0;
            k = i;
            l = b[k >> 2] | 0;
            k = b[k + 4 >> 2] | 0;

            d: do { if ((l | 0) == 0 & (k | 0) == 0) { B = 14; }else {
              m = 0;

              while (1) {
                if ((m | 0) > (c | 0)) {
                  i = 1;
                  break d;
                }

                if ((l | 0) == (n | 0) & (k | 0) == (o | 0)) {
                  i = 7;
                  break d;
                }

                j = (j + 1 | 0) % (c | 0) | 0;
                i = h + (j << 3) | 0;
                k = i;
                l = b[k >> 2] | 0;
                k = b[k + 4 >> 2] | 0;

                if ((l | 0) == 0 & (k | 0) == 0) {
                  B = 14;
                  break;
                } else { m = m + 1 | 0; }
              }
            } } while (0);

            if ((B | 0) == 14) {
              B = 0;
              if ((n | 0) == 0 & (o | 0) == 0) { i = 7; }else {
                b[i >> 2] = n;
                b[i + 4 >> 2] = o;
                i = b[f >> 2] | 0;
                m = g + (i << 3) | 0;
                b[m >> 2] = n;
                b[m + 4 >> 2] = o;
                b[f >> 2] = i + 1;
                i = 0;
              }
            }

            switch (i & 7) {
              case 7:
              case 0:
                break;

              default:
                break c;
            }

            p = p + 1 | 0;

            if ((q | 0) <= (p | 0)) {
              B = 8;
              break b;
            }
          }

          if (i | 0) {
            i = -1;
            B = 20;
            break a;
          }
        } else { B = 8; } } while (0);

        if ((B | 0) == 8) { B = 0; }
        s = s + 1 | 0;
        i = b[a >> 2] | 0;

        if ((s | 0) >= (i | 0)) {
          i = 0;
          B = 20;
          break;
        }
      }

      if ((B | 0) == 20) {
        S = C;
        return i | 0;
      }

      return 0;
    }

    function ja(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0;
      k = S;
      S = S + 176 | 0;
      j = k;

      if ((c | 0) < 1) {
        Mc(d, 0, 0);
        S = k;
        return;
      }

      h = a;
      h = cd(b[h >> 2] | 0, b[h + 4 >> 2] | 0, 52) | 0;
      G() | 0;
      Mc(d, (c | 0) > 6 ? c : 6, h & 15);
      h = 0;

      do {
        e = a + (h << 3) | 0;
        Wb(b[e >> 2] | 0, b[e + 4 >> 2] | 0, j);
        e = b[j >> 2] | 0;

        if ((e | 0) > 0) {
          i = 0;

          do {
            g = j + 8 + (i << 4) | 0;
            i = i + 1 | 0;
            e = j + 8 + (((i | 0) % (e | 0) | 0) << 4) | 0;
            f = Rc(d, e, g) | 0;
            if (!f) { Qc(d, g, e) | 0; }else { Pc(d, f) | 0; }
            e = b[j >> 2] | 0;
          } while ((i | 0) < (e | 0));
        }

        h = h + 1 | 0;
      } while ((h | 0) != (c | 0));

      S = k;
      return;
    }

    function ka(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0;
      g = S;
      S = S + 32 | 0;
      e = g;
      f = g + 16 | 0;
      ja(a, c, f);
      b[d >> 2] = 0;
      b[d + 4 >> 2] = 0;
      b[d + 8 >> 2] = 0;
      a = Oc(f) | 0;

      if (!a) {
        kc(d) | 0;
        Nc(f);
        S = g;
        return;
      }

      do {
        c = hc(d) | 0;

        do {
          ic(c, a) | 0;
          h = a + 16 | 0;
          b[e >> 2] = b[h >> 2];
          b[e + 4 >> 2] = b[h + 4 >> 2];
          b[e + 8 >> 2] = b[h + 8 >> 2];
          b[e + 12 >> 2] = b[h + 12 >> 2];
          Pc(f, a) | 0;
          a = Sc(f, e) | 0;
        } while ((a | 0) != 0);

        a = Oc(f) | 0;
      } while ((a | 0) != 0);

      kc(d) | 0;
      Nc(f);
      S = g;
      return;
    }

    function la(a) {
      a = a | 0;
      return b[7728 + (a * 28 | 0) + 16 >> 2] | 0;
    }

    function ma(a) {
      a = a | 0;
      return (a | 0) == 4 | (a | 0) == 117 | 0;
    }

    function na(a) {
      a = a | 0;
      return b[11152 + ((b[a >> 2] | 0) * 216 | 0) + ((b[a + 4 >> 2] | 0) * 72 | 0) + ((b[a + 8 >> 2] | 0) * 24 | 0) + (b[a + 12 >> 2] << 3) >> 2] | 0;
    }

    function oa(a) {
      a = a | 0;
      return b[11152 + ((b[a >> 2] | 0) * 216 | 0) + ((b[a + 4 >> 2] | 0) * 72 | 0) + ((b[a + 8 >> 2] | 0) * 24 | 0) + (b[a + 12 >> 2] << 3) + 4 >> 2] | 0;
    }

    function pa(a, c) {
      a = a | 0;
      c = c | 0;
      a = 7728 + (a * 28 | 0) | 0;
      b[c >> 2] = b[a >> 2];
      b[c + 4 >> 2] = b[a + 4 >> 2];
      b[c + 8 >> 2] = b[a + 8 >> 2];
      b[c + 12 >> 2] = b[a + 12 >> 2];
      return;
    }

    function qa(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0;

      if (c >>> 0 > 20) {
        c = -1;
        return c | 0;
      }

      do { if ((b[11152 + (c * 216 | 0) >> 2] | 0) != (a | 0)) {
        if ((b[11152 + (c * 216 | 0) + 8 >> 2] | 0) != (a | 0)) {
          if ((b[11152 + (c * 216 | 0) + 16 >> 2] | 0) != (a | 0)) {
            if ((b[11152 + (c * 216 | 0) + 24 >> 2] | 0) != (a | 0)) {
              if ((b[11152 + (c * 216 | 0) + 32 >> 2] | 0) != (a | 0)) {
                if ((b[11152 + (c * 216 | 0) + 40 >> 2] | 0) != (a | 0)) {
                  if ((b[11152 + (c * 216 | 0) + 48 >> 2] | 0) != (a | 0)) {
                    if ((b[11152 + (c * 216 | 0) + 56 >> 2] | 0) != (a | 0)) {
                      if ((b[11152 + (c * 216 | 0) + 64 >> 2] | 0) != (a | 0)) {
                        if ((b[11152 + (c * 216 | 0) + 72 >> 2] | 0) != (a | 0)) {
                          if ((b[11152 + (c * 216 | 0) + 80 >> 2] | 0) != (a | 0)) {
                            if ((b[11152 + (c * 216 | 0) + 88 >> 2] | 0) != (a | 0)) {
                              if ((b[11152 + (c * 216 | 0) + 96 >> 2] | 0) != (a | 0)) {
                                if ((b[11152 + (c * 216 | 0) + 104 >> 2] | 0) != (a | 0)) {
                                  if ((b[11152 + (c * 216 | 0) + 112 >> 2] | 0) != (a | 0)) {
                                    if ((b[11152 + (c * 216 | 0) + 120 >> 2] | 0) != (a | 0)) {
                                      if ((b[11152 + (c * 216 | 0) + 128 >> 2] | 0) != (a | 0)) {
                                        if ((b[11152 + (c * 216 | 0) + 136 >> 2] | 0) == (a | 0)) {
                                          a = 2;
                                          d = 1;
                                          e = 2;
                                        } else {
                                          if ((b[11152 + (c * 216 | 0) + 144 >> 2] | 0) == (a | 0)) {
                                            a = 0;
                                            d = 2;
                                            e = 0;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 152 >> 2] | 0) == (a | 0)) {
                                            a = 0;
                                            d = 2;
                                            e = 1;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 160 >> 2] | 0) == (a | 0)) {
                                            a = 0;
                                            d = 2;
                                            e = 2;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 168 >> 2] | 0) == (a | 0)) {
                                            a = 1;
                                            d = 2;
                                            e = 0;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 176 >> 2] | 0) == (a | 0)) {
                                            a = 1;
                                            d = 2;
                                            e = 1;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 184 >> 2] | 0) == (a | 0)) {
                                            a = 1;
                                            d = 2;
                                            e = 2;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 192 >> 2] | 0) == (a | 0)) {
                                            a = 2;
                                            d = 2;
                                            e = 0;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 200 >> 2] | 0) == (a | 0)) {
                                            a = 2;
                                            d = 2;
                                            e = 1;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 208 >> 2] | 0) == (a | 0)) {
                                            a = 2;
                                            d = 2;
                                            e = 2;
                                            break;
                                          } else { a = -1; }

                                          return a | 0;
                                        }
                                      } else {
                                        a = 2;
                                        d = 1;
                                        e = 1;
                                      }
                                    } else {
                                      a = 2;
                                      d = 1;
                                      e = 0;
                                    }
                                  } else {
                                    a = 1;
                                    d = 1;
                                    e = 2;
                                  }
                                } else {
                                  a = 1;
                                  d = 1;
                                  e = 1;
                                }
                              } else {
                                a = 1;
                                d = 1;
                                e = 0;
                              }
                            } else {
                              a = 0;
                              d = 1;
                              e = 2;
                            }
                          } else {
                            a = 0;
                            d = 1;
                            e = 1;
                          }
                        } else {
                          a = 0;
                          d = 1;
                          e = 0;
                        }
                      } else {
                        a = 2;
                        d = 0;
                        e = 2;
                      }
                    } else {
                      a = 2;
                      d = 0;
                      e = 1;
                    }
                  } else {
                    a = 2;
                    d = 0;
                    e = 0;
                  }
                } else {
                  a = 1;
                  d = 0;
                  e = 2;
                }
              } else {
                a = 1;
                d = 0;
                e = 1;
              }
            } else {
              a = 1;
              d = 0;
              e = 0;
            }
          } else {
            a = 0;
            d = 0;
            e = 2;
          }
        } else {
          a = 0;
          d = 0;
          e = 1;
        }
      } else {
        a = 0;
        d = 0;
        e = 0;
      } } while (0);

      c = b[11152 + (c * 216 | 0) + (d * 72 | 0) + (a * 24 | 0) + (e << 3) + 4 >> 2] | 0;
      return c | 0;
    }

    function ra(a, c) {
      a = a | 0;
      c = c | 0;

      if ((b[7728 + (a * 28 | 0) + 20 >> 2] | 0) == (c | 0)) {
        c = 1;
        return c | 0;
      }

      c = (b[7728 + (a * 28 | 0) + 24 >> 2] | 0) == (c | 0);
      return c | 0;
    }

    function sa(a, c) {
      a = a | 0;
      c = c | 0;
      return b[880 + (a * 28 | 0) + (c << 2) >> 2] | 0;
    }

    function ta(a, c) {
      a = a | 0;
      c = c | 0;

      if ((b[880 + (a * 28 | 0) >> 2] | 0) == (c | 0)) {
        c = 0;
        return c | 0;
      }

      if ((b[880 + (a * 28 | 0) + 4 >> 2] | 0) == (c | 0)) {
        c = 1;
        return c | 0;
      }

      if ((b[880 + (a * 28 | 0) + 8 >> 2] | 0) == (c | 0)) {
        c = 2;
        return c | 0;
      }

      if ((b[880 + (a * 28 | 0) + 12 >> 2] | 0) == (c | 0)) {
        c = 3;
        return c | 0;
      }

      if ((b[880 + (a * 28 | 0) + 16 >> 2] | 0) == (c | 0)) {
        c = 4;
        return c | 0;
      }

      if ((b[880 + (a * 28 | 0) + 20 >> 2] | 0) == (c | 0)) {
        c = 5;
        return c | 0;
      } else { return ((b[880 + (a * 28 | 0) + 24 >> 2] | 0) == (c | 0) ? 6 : 7) | 0; }

      return 0;
    }

    function ua() {
      return 122;
    }

    function va(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0;
      c = 0;

      do {
        dd(c | 0, 0, 45) | 0;
        e = G() | 0 | 134225919;
        d = a + (c << 3) | 0;
        b[d >> 2] = -1;
        b[d + 4 >> 2] = e;
        c = c + 1 | 0;
      } while ((c | 0) != 122);

      return;
    }

    function wa(a) {
      a = a | 0;
      return +e[a + 16 >> 3] < +e[a + 24 >> 3] | 0;
    }

    function xa(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0.0,
          d = 0.0,
          f = 0.0;
      c = +e[b >> 3];

      if (!(c >= +e[a + 8 >> 3])) {
        b = 0;
        return b | 0;
      }

      if (!(c <= +e[a >> 3])) {
        b = 0;
        return b | 0;
      }

      d = +e[a + 16 >> 3];
      c = +e[a + 24 >> 3];
      f = +e[b + 8 >> 3];
      b = f >= c;
      a = f <= d & 1;

      if (d < c) {
        if (b) { a = 1; }
      } else if (!b) { a = 0; }

      b = (a | 0) != 0;
      return b | 0;
    }

    function ya(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0.0,
          l = 0.0;
      i = S;
      S = S + 288 | 0;
      d = i + 264 | 0;
      f = i + 96 | 0;
      g = i;
      h = g;
      j = h + 96 | 0;

      do {
        b[h >> 2] = 0;
        h = h + 4 | 0;
      } while ((h | 0) < (j | 0));

      _b(c, g);

      h = g;
      j = b[h >> 2] | 0;
      h = b[h + 4 >> 2] | 0;
      Vb(j, h, d);
      Wb(j, h, f);
      k = +jb(d, f + 8 | 0);
      e[d >> 3] = +e[a >> 3];
      h = d + 8 | 0;
      e[h >> 3] = +e[a + 16 >> 3];
      e[f >> 3] = +e[a + 8 >> 3];
      j = f + 8 | 0;
      e[j >> 3] = +e[a + 24 >> 3];
      l = +jb(d, f);
      j = ~~+A(+(l * l / +ed(+ +q(+((+e[h >> 3] - +e[j >> 3]) / (+e[d >> 3] - +e[f >> 3]))), 3.0) / (k * (k * 2.59807621135) * .8)));
      S = i;
      return ((j | 0) == 0 ? 1 : j) | 0;
    }

    function za(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0.0;
      i = S;
      S = S + 288 | 0;
      e = i + 264 | 0;
      f = i + 96 | 0;
      g = i;
      h = g;
      j = h + 96 | 0;

      do {
        b[h >> 2] = 0;
        h = h + 4 | 0;
      } while ((h | 0) < (j | 0));

      _b(d, g);

      j = g;
      h = b[j >> 2] | 0;
      j = b[j + 4 >> 2] | 0;
      Vb(h, j, e);
      Wb(h, j, f);
      k = +jb(e, f + 8 | 0);
      j = ~~+A(+(+jb(a, c) / (k * 2.0)));
      S = i;
      return ((j | 0) == 0 ? 1 : j) | 0;
    }

    function Aa(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      b[a >> 2] = c;
      b[a + 4 >> 2] = d;
      b[a + 8 >> 2] = e;
      return;
    }

    function Ba(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0.0,
          j = 0.0,
          k = 0.0,
          l = 0.0,
          m = 0,
          n = 0,
          o = 0.0;
      n = c + 8 | 0;
      b[n >> 2] = 0;
      k = +e[a >> 3];
      i = +q(+k);
      l = +e[a + 8 >> 3];
      j = +q(+l) / .8660254037844386;
      i = i + j * .5;
      d = ~~i;
      a = ~~j;
      i = i - +(d | 0);
      j = j - +(a | 0);

      do { if (i < .5) {
        if (i < .3333333333333333) {
          b[c >> 2] = d;

          if (j < (i + 1.0) * .5) {
            b[c + 4 >> 2] = a;
            break;
          } else {
            a = a + 1 | 0;
            b[c + 4 >> 2] = a;
            break;
          }
        } else {
          o = 1.0 - i;
          a = (!(j < o) & 1) + a | 0;
          b[c + 4 >> 2] = a;

          if (o <= j & j < i * 2.0) {
            d = d + 1 | 0;
            b[c >> 2] = d;
            break;
          } else {
            b[c >> 2] = d;
            break;
          }
        }
      } else {
        if (!(i < .6666666666666666)) {
          d = d + 1 | 0;
          b[c >> 2] = d;

          if (j < i * .5) {
            b[c + 4 >> 2] = a;
            break;
          } else {
            a = a + 1 | 0;
            b[c + 4 >> 2] = a;
            break;
          }
        }

        if (j < 1.0 - i) {
          b[c + 4 >> 2] = a;

          if (i * 2.0 + -1.0 < j) {
            b[c >> 2] = d;
            break;
          }
        } else {
          a = a + 1 | 0;
          b[c + 4 >> 2] = a;
        }

        d = d + 1 | 0;
        b[c >> 2] = d;
      } } while (0);

      do { if (k < 0.0) { if (!(a & 1)) {
        m = (a | 0) / 2 | 0;
        m = _c(d | 0, ((d | 0) < 0) << 31 >> 31 | 0, m | 0, ((m | 0) < 0) << 31 >> 31 | 0) | 0;
        d = ~~(+(d | 0) - (+(m >>> 0) + 4294967296.0 * +(G() | 0)) * 2.0);
        b[c >> 2] = d;
        break;
      } else {
        m = (a + 1 | 0) / 2 | 0;
        m = _c(d | 0, ((d | 0) < 0) << 31 >> 31 | 0, m | 0, ((m | 0) < 0) << 31 >> 31 | 0) | 0;
        d = ~~(+(d | 0) - ((+(m >>> 0) + 4294967296.0 * +(G() | 0)) * 2.0 + 1.0));
        b[c >> 2] = d;
        break;
      } } } while (0);

      m = c + 4 | 0;

      if (l < 0.0) {
        d = d - ((a << 1 | 1 | 0) / 2 | 0) | 0;
        b[c >> 2] = d;
        a = 0 - a | 0;
        b[m >> 2] = a;
      }

      f = a - d | 0;

      if ((d | 0) < 0) {
        g = 0 - d | 0;
        b[m >> 2] = f;
        b[n >> 2] = g;
        b[c >> 2] = 0;
        a = f;
        d = 0;
      } else { g = 0; }

      if ((a | 0) < 0) {
        d = d - a | 0;
        b[c >> 2] = d;
        g = g - a | 0;
        b[n >> 2] = g;
        b[m >> 2] = 0;
        a = 0;
      }

      h = d - g | 0;
      f = a - g | 0;

      if ((g | 0) < 0) {
        b[c >> 2] = h;
        b[m >> 2] = f;
        b[n >> 2] = 0;
        a = f;
        d = h;
        g = 0;
      }

      f = (a | 0) < (d | 0) ? a : d;
      f = (g | 0) < (f | 0) ? g : f;
      if ((f | 0) <= 0) { return; }
      b[c >> 2] = d - f;
      b[m >> 2] = a - f;
      b[n >> 2] = g - f;
      return;
    }

    function Ca(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0;
      c = b[a >> 2] | 0;
      h = a + 4 | 0;
      d = b[h >> 2] | 0;

      if ((c | 0) < 0) {
        d = d - c | 0;
        b[h >> 2] = d;
        g = a + 8 | 0;
        b[g >> 2] = (b[g >> 2] | 0) - c;
        b[a >> 2] = 0;
        c = 0;
      }

      if ((d | 0) < 0) {
        c = c - d | 0;
        b[a >> 2] = c;
        g = a + 8 | 0;
        f = (b[g >> 2] | 0) - d | 0;
        b[g >> 2] = f;
        b[h >> 2] = 0;
        d = 0;
      } else {
        f = a + 8 | 0;
        g = f;
        f = b[f >> 2] | 0;
      }

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[a >> 2] = c;
        d = d - f | 0;
        b[h >> 2] = d;
        b[g >> 2] = 0;
        f = 0;
      }

      e = (d | 0) < (c | 0) ? d : c;
      e = (f | 0) < (e | 0) ? f : e;
      if ((e | 0) <= 0) { return; }
      b[a >> 2] = c - e;
      b[h >> 2] = d - e;
      b[g >> 2] = f - e;
      return;
    }

    function Da(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          f = 0;
      f = b[a + 8 >> 2] | 0;
      d = +((b[a + 4 >> 2] | 0) - f | 0);
      e[c >> 3] = +((b[a >> 2] | 0) - f | 0) - d * .5;
      e[c + 8 >> 3] = d * .8660254037844386;
      return;
    }

    function Ea(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      b[d >> 2] = (b[c >> 2] | 0) + (b[a >> 2] | 0);
      b[d + 4 >> 2] = (b[c + 4 >> 2] | 0) + (b[a + 4 >> 2] | 0);
      b[d + 8 >> 2] = (b[c + 8 >> 2] | 0) + (b[a + 8 >> 2] | 0);
      return;
    }

    function Fa(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      b[d >> 2] = (b[a >> 2] | 0) - (b[c >> 2] | 0);
      b[d + 4 >> 2] = (b[a + 4 >> 2] | 0) - (b[c + 4 >> 2] | 0);
      b[d + 8 >> 2] = (b[a + 8 >> 2] | 0) - (b[c + 8 >> 2] | 0);
      return;
    }

    function Ga(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0;
      d = B(b[a >> 2] | 0, c) | 0;
      b[a >> 2] = d;
      d = a + 4 | 0;
      e = B(b[d >> 2] | 0, c) | 0;
      b[d >> 2] = e;
      a = a + 8 | 0;
      c = B(b[a >> 2] | 0, c) | 0;
      b[a >> 2] = c;
      return;
    }

    function Ha(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      h = b[a >> 2] | 0;
      i = (h | 0) < 0;
      e = (b[a + 4 >> 2] | 0) - (i ? h : 0) | 0;
      g = (e | 0) < 0;
      f = (g ? 0 - e | 0 : 0) + ((b[a + 8 >> 2] | 0) - (i ? h : 0)) | 0;
      d = (f | 0) < 0;
      a = d ? 0 : f;
      c = (g ? 0 : e) - (d ? f : 0) | 0;
      f = (i ? 0 : h) - (g ? e : 0) - (d ? f : 0) | 0;
      d = (c | 0) < (f | 0) ? c : f;
      d = (a | 0) < (d | 0) ? a : d;
      e = (d | 0) > 0;
      a = a - (e ? d : 0) | 0;
      c = c - (e ? d : 0) | 0;

      a: do { switch (f - (e ? d : 0) | 0) {
        case 0:
          switch (c | 0) {
            case 0:
              {
                i = (a | 0) == 0 ? 0 : (a | 0) == 1 ? 1 : 7;
                return i | 0;
              }

            case 1:
              {
                i = (a | 0) == 0 ? 2 : (a | 0) == 1 ? 3 : 7;
                return i | 0;
              }

            default:
              break a;
          }

        case 1:
          switch (c | 0) {
            case 0:
              {
                i = (a | 0) == 0 ? 4 : (a | 0) == 1 ? 5 : 7;
                return i | 0;
              }

            case 1:
              {
                if (!a) { a = 6; }else { break a; }
                return a | 0;
              }

            default:
              break a;
          }

        default:

      } } while (0);

      i = 7;
      return i | 0;
    }

    function Ia(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      h = a + 8 | 0;
      d = b[h >> 2] | 0;
      c = (b[a >> 2] | 0) - d | 0;
      i = a + 4 | 0;
      d = (b[i >> 2] | 0) - d | 0;
      e = Vc(+((c * 3 | 0) - d | 0) / 7.0) | 0;
      b[a >> 2] = e;
      c = Vc(+((d << 1) + c | 0) / 7.0) | 0;
      b[i >> 2] = c;
      b[h >> 2] = 0;
      d = c - e | 0;

      if ((e | 0) < 0) {
        g = 0 - e | 0;
        b[i >> 2] = d;
        b[h >> 2] = g;
        b[a >> 2] = 0;
        c = d;
        e = 0;
        d = g;
      } else { d = 0; }

      if ((c | 0) < 0) {
        e = e - c | 0;
        b[a >> 2] = e;
        d = d - c | 0;
        b[h >> 2] = d;
        b[i >> 2] = 0;
        c = 0;
      }

      g = e - d | 0;
      f = c - d | 0;

      if ((d | 0) < 0) {
        b[a >> 2] = g;
        b[i >> 2] = f;
        b[h >> 2] = 0;
        c = f;
        f = g;
        d = 0;
      } else { f = e; }

      e = (c | 0) < (f | 0) ? c : f;
      e = (d | 0) < (e | 0) ? d : e;
      if ((e | 0) <= 0) { return; }
      b[a >> 2] = f - e;
      b[i >> 2] = c - e;
      b[h >> 2] = d - e;
      return;
    }

    function Ja(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      h = a + 8 | 0;
      d = b[h >> 2] | 0;
      c = (b[a >> 2] | 0) - d | 0;
      i = a + 4 | 0;
      d = (b[i >> 2] | 0) - d | 0;
      e = Vc(+((c << 1) + d | 0) / 7.0) | 0;
      b[a >> 2] = e;
      c = Vc(+((d * 3 | 0) - c | 0) / 7.0) | 0;
      b[i >> 2] = c;
      b[h >> 2] = 0;
      d = c - e | 0;

      if ((e | 0) < 0) {
        g = 0 - e | 0;
        b[i >> 2] = d;
        b[h >> 2] = g;
        b[a >> 2] = 0;
        c = d;
        e = 0;
        d = g;
      } else { d = 0; }

      if ((c | 0) < 0) {
        e = e - c | 0;
        b[a >> 2] = e;
        d = d - c | 0;
        b[h >> 2] = d;
        b[i >> 2] = 0;
        c = 0;
      }

      g = e - d | 0;
      f = c - d | 0;

      if ((d | 0) < 0) {
        b[a >> 2] = g;
        b[i >> 2] = f;
        b[h >> 2] = 0;
        c = f;
        f = g;
        d = 0;
      } else { f = e; }

      e = (c | 0) < (f | 0) ? c : f;
      e = (d | 0) < (e | 0) ? d : e;
      if ((e | 0) <= 0) { return; }
      b[a >> 2] = f - e;
      b[i >> 2] = c - e;
      b[h >> 2] = d - e;
      return;
    }

    function Ka(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      c = b[a >> 2] | 0;
      h = a + 4 | 0;
      d = b[h >> 2] | 0;
      i = a + 8 | 0;
      e = b[i >> 2] | 0;
      f = d + (c * 3 | 0) | 0;
      b[a >> 2] = f;
      d = e + (d * 3 | 0) | 0;
      b[h >> 2] = d;
      c = (e * 3 | 0) + c | 0;
      b[i >> 2] = c;
      e = d - f | 0;

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[h >> 2] = e;
        b[i >> 2] = c;
        b[a >> 2] = 0;
        d = e;
        e = 0;
      } else { e = f; }

      if ((d | 0) < 0) {
        e = e - d | 0;
        b[a >> 2] = e;
        c = c - d | 0;
        b[i >> 2] = c;
        b[h >> 2] = 0;
        d = 0;
      }

      g = e - c | 0;
      f = d - c | 0;

      if ((c | 0) < 0) {
        b[a >> 2] = g;
        b[h >> 2] = f;
        b[i >> 2] = 0;
        e = g;
        c = 0;
      } else { f = d; }

      d = (f | 0) < (e | 0) ? f : e;
      d = (c | 0) < (d | 0) ? c : d;
      if ((d | 0) <= 0) { return; }
      b[a >> 2] = e - d;
      b[h >> 2] = f - d;
      b[i >> 2] = c - d;
      return;
    }

    function La(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      f = b[a >> 2] | 0;
      h = a + 4 | 0;
      c = b[h >> 2] | 0;
      i = a + 8 | 0;
      d = b[i >> 2] | 0;
      e = (c * 3 | 0) + f | 0;
      f = d + (f * 3 | 0) | 0;
      b[a >> 2] = f;
      b[h >> 2] = e;
      c = (d * 3 | 0) + c | 0;
      b[i >> 2] = c;
      d = e - f | 0;

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[h >> 2] = d;
        b[i >> 2] = c;
        b[a >> 2] = 0;
        f = 0;
      } else { d = e; }

      if ((d | 0) < 0) {
        f = f - d | 0;
        b[a >> 2] = f;
        c = c - d | 0;
        b[i >> 2] = c;
        b[h >> 2] = 0;
        d = 0;
      }

      g = f - c | 0;
      e = d - c | 0;

      if ((c | 0) < 0) {
        b[a >> 2] = g;
        b[h >> 2] = e;
        b[i >> 2] = 0;
        f = g;
        c = 0;
      } else { e = d; }

      d = (e | 0) < (f | 0) ? e : f;
      d = (c | 0) < (d | 0) ? c : d;
      if ((d | 0) <= 0) { return; }
      b[a >> 2] = f - d;
      b[h >> 2] = e - d;
      b[i >> 2] = c - d;
      return;
    }

    function Ma(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      if ((c + -1 | 0) >>> 0 >= 6) { return; }
      f = (b[15472 + (c * 12 | 0) >> 2] | 0) + (b[a >> 2] | 0) | 0;
      b[a >> 2] = f;
      i = a + 4 | 0;
      e = (b[15472 + (c * 12 | 0) + 4 >> 2] | 0) + (b[i >> 2] | 0) | 0;
      b[i >> 2] = e;
      h = a + 8 | 0;
      c = (b[15472 + (c * 12 | 0) + 8 >> 2] | 0) + (b[h >> 2] | 0) | 0;
      b[h >> 2] = c;
      d = e - f | 0;

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[i >> 2] = d;
        b[h >> 2] = c;
        b[a >> 2] = 0;
        e = 0;
      } else {
        d = e;
        e = f;
      }

      if ((d | 0) < 0) {
        e = e - d | 0;
        b[a >> 2] = e;
        c = c - d | 0;
        b[h >> 2] = c;
        b[i >> 2] = 0;
        d = 0;
      }

      g = e - c | 0;
      f = d - c | 0;

      if ((c | 0) < 0) {
        b[a >> 2] = g;
        b[i >> 2] = f;
        b[h >> 2] = 0;
        e = g;
        c = 0;
      } else { f = d; }

      d = (f | 0) < (e | 0) ? f : e;
      d = (c | 0) < (d | 0) ? c : d;
      if ((d | 0) <= 0) { return; }
      b[a >> 2] = e - d;
      b[i >> 2] = f - d;
      b[h >> 2] = c - d;
      return;
    }

    function Na(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      f = b[a >> 2] | 0;
      h = a + 4 | 0;
      c = b[h >> 2] | 0;
      i = a + 8 | 0;
      d = b[i >> 2] | 0;
      e = c + f | 0;
      f = d + f | 0;
      b[a >> 2] = f;
      b[h >> 2] = e;
      c = d + c | 0;
      b[i >> 2] = c;
      d = e - f | 0;

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[h >> 2] = d;
        b[i >> 2] = c;
        b[a >> 2] = 0;
        e = 0;
      } else {
        d = e;
        e = f;
      }

      if ((d | 0) < 0) {
        e = e - d | 0;
        b[a >> 2] = e;
        c = c - d | 0;
        b[i >> 2] = c;
        b[h >> 2] = 0;
        d = 0;
      }

      g = e - c | 0;
      f = d - c | 0;

      if ((c | 0) < 0) {
        b[a >> 2] = g;
        b[h >> 2] = f;
        b[i >> 2] = 0;
        e = g;
        c = 0;
      } else { f = d; }

      d = (f | 0) < (e | 0) ? f : e;
      d = (c | 0) < (d | 0) ? c : d;
      if ((d | 0) <= 0) { return; }
      b[a >> 2] = e - d;
      b[h >> 2] = f - d;
      b[i >> 2] = c - d;
      return;
    }

    function Oa(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      c = b[a >> 2] | 0;
      h = a + 4 | 0;
      e = b[h >> 2] | 0;
      i = a + 8 | 0;
      d = b[i >> 2] | 0;
      f = e + c | 0;
      b[a >> 2] = f;
      e = d + e | 0;
      b[h >> 2] = e;
      c = d + c | 0;
      b[i >> 2] = c;
      d = e - f | 0;

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[h >> 2] = d;
        b[i >> 2] = c;
        b[a >> 2] = 0;
        e = 0;
      } else {
        d = e;
        e = f;
      }

      if ((d | 0) < 0) {
        e = e - d | 0;
        b[a >> 2] = e;
        c = c - d | 0;
        b[i >> 2] = c;
        b[h >> 2] = 0;
        d = 0;
      }

      g = e - c | 0;
      f = d - c | 0;

      if ((c | 0) < 0) {
        b[a >> 2] = g;
        b[h >> 2] = f;
        b[i >> 2] = 0;
        e = g;
        c = 0;
      } else { f = d; }

      d = (f | 0) < (e | 0) ? f : e;
      d = (c | 0) < (d | 0) ? c : d;
      if ((d | 0) <= 0) { return; }
      b[a >> 2] = e - d;
      b[h >> 2] = f - d;
      b[i >> 2] = c - d;
      return;
    }

    function Pa(a) {
      a = a | 0;

      switch (a | 0) {
        case 1:
          {
            a = 5;
            break;
          }

        case 5:
          {
            a = 4;
            break;
          }

        case 4:
          {
            a = 6;
            break;
          }

        case 6:
          {
            a = 2;
            break;
          }

        case 2:
          {
            a = 3;
            break;
          }

        case 3:
          {
            a = 1;
            break;
          }

        default:

      }

      return a | 0;
    }

    function Qa(a) {
      a = a | 0;

      switch (a | 0) {
        case 1:
          {
            a = 3;
            break;
          }

        case 3:
          {
            a = 2;
            break;
          }

        case 2:
          {
            a = 6;
            break;
          }

        case 6:
          {
            a = 4;
            break;
          }

        case 4:
          {
            a = 5;
            break;
          }

        case 5:
          {
            a = 1;
            break;
          }

        default:

      }

      return a | 0;
    }

    function Ra(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      c = b[a >> 2] | 0;
      h = a + 4 | 0;
      d = b[h >> 2] | 0;
      i = a + 8 | 0;
      e = b[i >> 2] | 0;
      f = d + (c << 1) | 0;
      b[a >> 2] = f;
      d = e + (d << 1) | 0;
      b[h >> 2] = d;
      c = (e << 1) + c | 0;
      b[i >> 2] = c;
      e = d - f | 0;

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[h >> 2] = e;
        b[i >> 2] = c;
        b[a >> 2] = 0;
        d = e;
        e = 0;
      } else { e = f; }

      if ((d | 0) < 0) {
        e = e - d | 0;
        b[a >> 2] = e;
        c = c - d | 0;
        b[i >> 2] = c;
        b[h >> 2] = 0;
        d = 0;
      }

      g = e - c | 0;
      f = d - c | 0;

      if ((c | 0) < 0) {
        b[a >> 2] = g;
        b[h >> 2] = f;
        b[i >> 2] = 0;
        e = g;
        c = 0;
      } else { f = d; }

      d = (f | 0) < (e | 0) ? f : e;
      d = (c | 0) < (d | 0) ? c : d;
      if ((d | 0) <= 0) { return; }
      b[a >> 2] = e - d;
      b[h >> 2] = f - d;
      b[i >> 2] = c - d;
      return;
    }

    function Sa(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      f = b[a >> 2] | 0;
      h = a + 4 | 0;
      c = b[h >> 2] | 0;
      i = a + 8 | 0;
      d = b[i >> 2] | 0;
      e = (c << 1) + f | 0;
      f = d + (f << 1) | 0;
      b[a >> 2] = f;
      b[h >> 2] = e;
      c = (d << 1) + c | 0;
      b[i >> 2] = c;
      d = e - f | 0;

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[h >> 2] = d;
        b[i >> 2] = c;
        b[a >> 2] = 0;
        f = 0;
      } else { d = e; }

      if ((d | 0) < 0) {
        f = f - d | 0;
        b[a >> 2] = f;
        c = c - d | 0;
        b[i >> 2] = c;
        b[h >> 2] = 0;
        d = 0;
      }

      g = f - c | 0;
      e = d - c | 0;

      if ((c | 0) < 0) {
        b[a >> 2] = g;
        b[h >> 2] = e;
        b[i >> 2] = 0;
        f = g;
        c = 0;
      } else { e = d; }

      d = (e | 0) < (f | 0) ? e : f;
      d = (c | 0) < (d | 0) ? c : d;
      if ((d | 0) <= 0) { return; }
      b[a >> 2] = f - d;
      b[h >> 2] = e - d;
      b[i >> 2] = c - d;
      return;
    }

    function Ta(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      h = (b[a >> 2] | 0) - (b[c >> 2] | 0) | 0;
      i = (h | 0) < 0;
      e = (b[a + 4 >> 2] | 0) - (b[c + 4 >> 2] | 0) - (i ? h : 0) | 0;
      g = (e | 0) < 0;
      f = (i ? 0 - h | 0 : 0) + (b[a + 8 >> 2] | 0) - (b[c + 8 >> 2] | 0) + (g ? 0 - e | 0 : 0) | 0;
      a = (f | 0) < 0;
      c = a ? 0 : f;
      d = (g ? 0 : e) - (a ? f : 0) | 0;
      f = (i ? 0 : h) - (g ? e : 0) - (a ? f : 0) | 0;
      a = (d | 0) < (f | 0) ? d : f;
      a = (c | 0) < (a | 0) ? c : a;
      e = (a | 0) > 0;
      c = c - (e ? a : 0) | 0;
      d = d - (e ? a : 0) | 0;
      a = f - (e ? a : 0) | 0;
      a = (a | 0) > -1 ? a : 0 - a | 0;
      d = (d | 0) > -1 ? d : 0 - d | 0;
      c = (c | 0) > -1 ? c : 0 - c | 0;
      c = (d | 0) > (c | 0) ? d : c;
      return ((a | 0) > (c | 0) ? a : c) | 0;
    }

    function Ua(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0;
      d = b[a + 8 >> 2] | 0;
      b[c >> 2] = (b[a >> 2] | 0) - d;
      b[c + 4 >> 2] = (b[a + 4 >> 2] | 0) - d;
      return;
    }

    function Va(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      e = b[a >> 2] | 0;
      b[c >> 2] = e;
      a = b[a + 4 >> 2] | 0;
      h = c + 4 | 0;
      b[h >> 2] = a;
      i = c + 8 | 0;
      b[i >> 2] = 0;
      d = a - e | 0;

      if ((e | 0) < 0) {
        a = 0 - e | 0;
        b[h >> 2] = d;
        b[i >> 2] = a;
        b[c >> 2] = 0;
        e = 0;
      } else {
        d = a;
        a = 0;
      }

      if ((d | 0) < 0) {
        e = e - d | 0;
        b[c >> 2] = e;
        a = a - d | 0;
        b[i >> 2] = a;
        b[h >> 2] = 0;
        d = 0;
      }

      g = e - a | 0;
      f = d - a | 0;

      if ((a | 0) < 0) {
        b[c >> 2] = g;
        b[h >> 2] = f;
        b[i >> 2] = 0;
        d = f;
        f = g;
        a = 0;
      } else { f = e; }

      e = (d | 0) < (f | 0) ? d : f;
      e = (a | 0) < (e | 0) ? a : e;
      if ((e | 0) <= 0) { return; }
      b[c >> 2] = f - e;
      b[h >> 2] = d - e;
      b[i >> 2] = a - e;
      return;
    }

    function Wa(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0;
      c = a + 8 | 0;
      f = b[c >> 2] | 0;
      d = f - (b[a >> 2] | 0) | 0;
      b[a >> 2] = d;
      e = a + 4 | 0;
      a = (b[e >> 2] | 0) - f | 0;
      b[e >> 2] = a;
      b[c >> 2] = 0 - (a + d);
      return;
    }

    function Xa(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      d = b[a >> 2] | 0;
      c = 0 - d | 0;
      b[a >> 2] = c;
      h = a + 8 | 0;
      b[h >> 2] = 0;
      i = a + 4 | 0;
      e = b[i >> 2] | 0;
      f = e + d | 0;

      if ((d | 0) > 0) {
        b[i >> 2] = f;
        b[h >> 2] = d;
        b[a >> 2] = 0;
        c = 0;
        e = f;
      } else { d = 0; }

      if ((e | 0) < 0) {
        g = c - e | 0;
        b[a >> 2] = g;
        d = d - e | 0;
        b[h >> 2] = d;
        b[i >> 2] = 0;
        f = g - d | 0;
        c = 0 - d | 0;

        if ((d | 0) < 0) {
          b[a >> 2] = f;
          b[i >> 2] = c;
          b[h >> 2] = 0;
          e = c;
          d = 0;
        } else {
          e = 0;
          f = g;
        }
      } else { f = c; }

      c = (e | 0) < (f | 0) ? e : f;
      c = (d | 0) < (c | 0) ? d : c;
      if ((c | 0) <= 0) { return; }
      b[a >> 2] = f - c;
      b[i >> 2] = e - c;
      b[h >> 2] = d - c;
      return;
    }

    function Ya(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      var d = 0,
          e = 0;
      d = S;
      S = S + 16 | 0;
      e = d;
      Za(a, b, c, e);
      Ba(e, c + 4 | 0);
      S = d;
      return;
    }

    function Za(a, c, d, f) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      f = f | 0;
      var g = 0.0,
          h = 0,
          i = 0.0,
          j = 0.0,
          k = 0;
      k = S;
      S = S + 32 | 0;
      h = k;
      Jc(a, h);
      b[d >> 2] = 0;
      g = +Ic(15888, h);
      i = +Ic(15912, h);

      if (i < g) {
        b[d >> 2] = 1;
        g = i;
      }

      i = +Ic(15936, h);

      if (i < g) {
        b[d >> 2] = 2;
        g = i;
      }

      i = +Ic(15960, h);

      if (i < g) {
        b[d >> 2] = 3;
        g = i;
      }

      i = +Ic(15984, h);

      if (i < g) {
        b[d >> 2] = 4;
        g = i;
      }

      i = +Ic(16008, h);

      if (i < g) {
        b[d >> 2] = 5;
        g = i;
      }

      i = +Ic(16032, h);

      if (i < g) {
        b[d >> 2] = 6;
        g = i;
      }

      i = +Ic(16056, h);

      if (i < g) {
        b[d >> 2] = 7;
        g = i;
      }

      i = +Ic(16080, h);

      if (i < g) {
        b[d >> 2] = 8;
        g = i;
      }

      i = +Ic(16104, h);

      if (i < g) {
        b[d >> 2] = 9;
        g = i;
      }

      i = +Ic(16128, h);

      if (i < g) {
        b[d >> 2] = 10;
        g = i;
      }

      i = +Ic(16152, h);

      if (i < g) {
        b[d >> 2] = 11;
        g = i;
      }

      i = +Ic(16176, h);

      if (i < g) {
        b[d >> 2] = 12;
        g = i;
      }

      i = +Ic(16200, h);

      if (i < g) {
        b[d >> 2] = 13;
        g = i;
      }

      i = +Ic(16224, h);

      if (i < g) {
        b[d >> 2] = 14;
        g = i;
      }

      i = +Ic(16248, h);

      if (i < g) {
        b[d >> 2] = 15;
        g = i;
      }

      i = +Ic(16272, h);

      if (i < g) {
        b[d >> 2] = 16;
        g = i;
      }

      i = +Ic(16296, h);

      if (i < g) {
        b[d >> 2] = 17;
        g = i;
      }

      i = +Ic(16320, h);

      if (i < g) {
        b[d >> 2] = 18;
        g = i;
      }

      i = +Ic(16344, h);

      if (i < g) {
        b[d >> 2] = 19;
        g = i;
      }

      i = +w(+(1.0 - g * .5));

      if (i < 1.0e-16) {
        b[f >> 2] = 0;
        b[f + 4 >> 2] = 0;
        b[f + 8 >> 2] = 0;
        b[f + 12 >> 2] = 0;
        S = k;
        return;
      }

      d = b[d >> 2] | 0;
      g = +e[16368 + (d * 24 | 0) >> 3];
      g = +gb(g - +gb(+lb(15568 + (d << 4) | 0, a)));
      if (!(Rb(c) | 0)) { j = g; }else { j = +gb(g + -.3334731722518321); }
      g = +v(+i) / .381966011250105;

      if ((c | 0) > 0) {
        h = 0;

        do {
          g = g * 2.6457513110645907;
          h = h + 1 | 0;
        } while ((h | 0) != (c | 0));
      }

      i = +t(+j) * g;
      e[f >> 3] = i;
      j = +u(+j) * g;
      e[f + 8 >> 3] = j;
      S = k;
      return;
    }

    function _a(a, c, d, f, g) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      f = f | 0;
      g = g | 0;
      var h = 0.0,
          i = 0.0;
      h = +Fc(a);

      if (h < 1.0e-16) {
        c = 15568 + (c << 4) | 0;
        b[g >> 2] = b[c >> 2];
        b[g + 4 >> 2] = b[c + 4 >> 2];
        b[g + 8 >> 2] = b[c + 8 >> 2];
        b[g + 12 >> 2] = b[c + 12 >> 2];
        return;
      }

      i = +z(+ +e[a + 8 >> 3], + +e[a >> 3]);

      if ((d | 0) > 0) {
        a = 0;

        do {
          h = h / 2.6457513110645907;
          a = a + 1 | 0;
        } while ((a | 0) != (d | 0));
      }

      if (!f) {
        h = +y(+(h * .381966011250105));
        if (Rb(d) | 0) { i = +gb(i + .3334731722518321); }
      } else {
        h = h / 3.0;
        d = (Rb(d) | 0) == 0;
        h = +y(+((d ? h : h / 2.6457513110645907) * .381966011250105));
      }

      mb(15568 + (c << 4) | 0, +gb(+e[16368 + (c * 24 | 0) >> 3] - i), h, g);
      return;
    }

    function $a(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0;
      e = S;
      S = S + 16 | 0;
      f = e;
      Da(a + 4 | 0, f);

      _a(f, b[a >> 2] | 0, c, 0, d);

      S = e;
      return;
    }

    function ab(a, c, d, f, g) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      f = f | 0;
      g = g | 0;
      var h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0,
          x = 0,
          y = 0,
          z = 0,
          A = 0,
          B = 0,
          C = 0,
          D = 0,
          E = 0,
          F = 0,
          G = 0,
          I = 0.0,
          J = 0.0;
      G = S;
      S = S + 272 | 0;
      h = G + 256 | 0;
      u = G + 240 | 0;
      D = G;
      E = G + 224 | 0;
      F = G + 208 | 0;
      v = G + 176 | 0;
      w = G + 160 | 0;
      x = G + 192 | 0;
      y = G + 144 | 0;
      z = G + 128 | 0;
      A = G + 112 | 0;
      B = G + 96 | 0;
      C = G + 80 | 0;
      b[h >> 2] = c;
      b[u >> 2] = b[a >> 2];
      b[u + 4 >> 2] = b[a + 4 >> 2];
      b[u + 8 >> 2] = b[a + 8 >> 2];
      b[u + 12 >> 2] = b[a + 12 >> 2];
      bb(u, h, D);
      b[g >> 2] = 0;
      u = f + d + ((f | 0) == 5 & 1) | 0;

      if ((u | 0) <= (d | 0)) {
        S = G;
        return;
      }

      k = b[h >> 2] | 0;
      l = E + 4 | 0;
      m = v + 4 | 0;
      n = d + 5 | 0;
      o = 16848 + (k << 2) | 0;
      p = 16928 + (k << 2) | 0;
      q = z + 8 | 0;
      r = A + 8 | 0;
      s = B + 8 | 0;
      t = F + 4 | 0;
      j = d;

      a: while (1) {
        i = D + (((j | 0) % 5 | 0) << 4) | 0;
        b[F >> 2] = b[i >> 2];
        b[F + 4 >> 2] = b[i + 4 >> 2];
        b[F + 8 >> 2] = b[i + 8 >> 2];
        b[F + 12 >> 2] = b[i + 12 >> 2];

        do {} while ((cb(F, k, 0, 1) | 0) == 2);

        if ((j | 0) > (d | 0) & (Rb(c) | 0) != 0) {
          b[v >> 2] = b[F >> 2];
          b[v + 4 >> 2] = b[F + 4 >> 2];
          b[v + 8 >> 2] = b[F + 8 >> 2];
          b[v + 12 >> 2] = b[F + 12 >> 2];
          Da(l, w);
          f = b[v >> 2] | 0;
          h = b[17008 + (f * 80 | 0) + (b[E >> 2] << 2) >> 2] | 0;
          b[v >> 2] = b[18608 + (f * 80 | 0) + (h * 20 | 0) >> 2];
          i = b[18608 + (f * 80 | 0) + (h * 20 | 0) + 16 >> 2] | 0;

          if ((i | 0) > 0) {
            a = 0;

            do {
              Na(m);
              a = a + 1 | 0;
            } while ((a | 0) < (i | 0));
          }

          i = 18608 + (f * 80 | 0) + (h * 20 | 0) + 4 | 0;
          b[x >> 2] = b[i >> 2];
          b[x + 4 >> 2] = b[i + 4 >> 2];
          b[x + 8 >> 2] = b[i + 8 >> 2];
          Ga(x, (b[o >> 2] | 0) * 3 | 0);
          Ea(m, x, m);
          Ca(m);
          Da(m, y);
          I = +(b[p >> 2] | 0);
          e[z >> 3] = I * 3.0;
          e[q >> 3] = 0.0;
          J = I * -1.5;
          e[A >> 3] = J;
          e[r >> 3] = I * 2.598076211353316;
          e[B >> 3] = J;
          e[s >> 3] = I * -2.598076211353316;

          switch (b[17008 + ((b[v >> 2] | 0) * 80 | 0) + (b[F >> 2] << 2) >> 2] | 0) {
            case 1:
              {
                a = A;
                f = z;
                break;
              }

            case 3:
              {
                a = B;
                f = A;
                break;
              }

            case 2:
              {
                a = z;
                f = B;
                break;
              }

            default:
              {
                a = 12;
                break a;
              }
          }

          Gc(w, y, f, a, C);

          _a(C, b[v >> 2] | 0, k, 1, g + 8 + (b[g >> 2] << 4) | 0);

          b[g >> 2] = (b[g >> 2] | 0) + 1;
        }

        if ((j | 0) < (n | 0)) {
          Da(t, v);

          _a(v, b[F >> 2] | 0, k, 1, g + 8 + (b[g >> 2] << 4) | 0);

          b[g >> 2] = (b[g >> 2] | 0) + 1;
        }
        b[E >> 2] = b[F >> 2];
        b[E + 4 >> 2] = b[F + 4 >> 2];
        b[E + 8 >> 2] = b[F + 8 >> 2];
        b[E + 12 >> 2] = b[F + 12 >> 2];
        j = j + 1 | 0;

        if ((j | 0) >= (u | 0)) {
          a = 3;
          break;
        }
      }

      if ((a | 0) == 3) {
        S = G;
        return;
      } else if ((a | 0) == 12) { H(22474, 22521, 581, 22531); }
    }

    function bb(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0;
      j = S;
      S = S + 128 | 0;
      e = j + 64 | 0;
      f = j;
      g = e;
      h = 20208;
      i = g + 60 | 0;

      do {
        b[g >> 2] = b[h >> 2];
        g = g + 4 | 0;
        h = h + 4 | 0;
      } while ((g | 0) < (i | 0));

      g = f;
      h = 20272;
      i = g + 60 | 0;

      do {
        b[g >> 2] = b[h >> 2];
        g = g + 4 | 0;
        h = h + 4 | 0;
      } while ((g | 0) < (i | 0));

      i = (Rb(b[c >> 2] | 0) | 0) == 0;
      e = i ? e : f;
      f = a + 4 | 0;
      Ra(f);
      Sa(f);

      if (Rb(b[c >> 2] | 0) | 0) {
        La(f);
        b[c >> 2] = (b[c >> 2] | 0) + 1;
      }

      b[d >> 2] = b[a >> 2];
      c = d + 4 | 0;
      Ea(f, e, c);
      Ca(c);
      b[d + 16 >> 2] = b[a >> 2];
      c = d + 20 | 0;
      Ea(f, e + 12 | 0, c);
      Ca(c);
      b[d + 32 >> 2] = b[a >> 2];
      c = d + 36 | 0;
      Ea(f, e + 24 | 0, c);
      Ca(c);
      b[d + 48 >> 2] = b[a >> 2];
      c = d + 52 | 0;
      Ea(f, e + 36 | 0, c);
      Ca(c);
      b[d + 64 >> 2] = b[a >> 2];
      d = d + 68 | 0;
      Ea(f, e + 48 | 0, d);
      Ca(d);
      S = j;
      return;
    }

    function cb(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0;
      p = S;
      S = S + 32 | 0;
      n = p + 12 | 0;
      i = p;
      o = a + 4 | 0;
      m = b[16928 + (c << 2) >> 2] | 0;
      l = (e | 0) != 0;
      m = l ? m * 3 | 0 : m;
      f = b[o >> 2] | 0;
      k = a + 8 | 0;
      h = b[k >> 2] | 0;

      if (l) {
        g = a + 12 | 0;
        e = b[g >> 2] | 0;
        f = h + f + e | 0;

        if ((f | 0) == (m | 0)) {
          o = 1;
          S = p;
          return o | 0;
        } else { j = g; }
      } else {
        j = a + 12 | 0;
        e = b[j >> 2] | 0;
        f = h + f + e | 0;
      }

      if ((f | 0) <= (m | 0)) {
        o = 0;
        S = p;
        return o | 0;
      }

      do { if ((e | 0) > 0) {
        e = b[a >> 2] | 0;

        if ((h | 0) > 0) {
          g = 18608 + (e * 80 | 0) + 60 | 0;
          e = a;
          break;
        }

        e = 18608 + (e * 80 | 0) + 40 | 0;

        if (!d) {
          g = e;
          e = a;
        } else {
          Aa(n, m, 0, 0);
          Fa(o, n, i);
          Oa(i);
          Ea(i, n, o);
          g = e;
          e = a;
        }
      } else {
        g = 18608 + ((b[a >> 2] | 0) * 80 | 0) + 20 | 0;
        e = a;
      } } while (0);

      b[e >> 2] = b[g >> 2];
      f = g + 16 | 0;

      if ((b[f >> 2] | 0) > 0) {
        e = 0;

        do {
          Na(o);
          e = e + 1 | 0;
        } while ((e | 0) < (b[f >> 2] | 0));
      }

      a = g + 4 | 0;
      b[n >> 2] = b[a >> 2];
      b[n + 4 >> 2] = b[a + 4 >> 2];
      b[n + 8 >> 2] = b[a + 8 >> 2];
      c = b[16848 + (c << 2) >> 2] | 0;
      Ga(n, l ? c * 3 | 0 : c);
      Ea(o, n, o);
      Ca(o);
      if (l) { e = ((b[k >> 2] | 0) + (b[o >> 2] | 0) + (b[j >> 2] | 0) | 0) == (m | 0) ? 1 : 2; }else { e = 2; }
      o = e;
      S = p;
      return o | 0;
    }

    function db(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0;

      do { c = cb(a, b, 0, 1) | 0; } while ((c | 0) == 2);

      return c | 0;
    }

    function eb(a, c, d, f, g) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      f = f | 0;
      g = g | 0;
      var h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0,
          x = 0,
          y = 0,
          z = 0,
          A = 0,
          B = 0,
          C = 0.0,
          D = 0.0;
      B = S;
      S = S + 240 | 0;
      h = B + 224 | 0;
      x = B + 208 | 0;
      y = B;
      z = B + 192 | 0;
      A = B + 176 | 0;
      s = B + 160 | 0;
      t = B + 144 | 0;
      u = B + 128 | 0;
      v = B + 112 | 0;
      w = B + 96 | 0;
      b[h >> 2] = c;
      b[x >> 2] = b[a >> 2];
      b[x + 4 >> 2] = b[a + 4 >> 2];
      b[x + 8 >> 2] = b[a + 8 >> 2];
      b[x + 12 >> 2] = b[a + 12 >> 2];
      fb(x, h, y);
      b[g >> 2] = 0;
      r = f + d + ((f | 0) == 6 & 1) | 0;

      if ((r | 0) <= (d | 0)) {
        S = B;
        return;
      }

      k = b[h >> 2] | 0;
      l = d + 6 | 0;
      m = 16928 + (k << 2) | 0;
      n = t + 8 | 0;
      o = u + 8 | 0;
      p = v + 8 | 0;
      q = z + 4 | 0;
      i = 0;
      j = d;
      f = -1;

      a: while (1) {
        h = (j | 0) % 6 | 0;
        a = y + (h << 4) | 0;
        b[z >> 2] = b[a >> 2];
        b[z + 4 >> 2] = b[a + 4 >> 2];
        b[z + 8 >> 2] = b[a + 8 >> 2];
        b[z + 12 >> 2] = b[a + 12 >> 2];
        a = i;
        i = cb(z, k, 0, 1) | 0;

        if ((j | 0) > (d | 0) & (Rb(c) | 0) != 0 ? (a | 0) != 1 ? (b[z >> 2] | 0) != (f | 0) : 0 : 0) {
          Da(y + (((h + 5 | 0) % 6 | 0) << 4) + 4 | 0, A);
          Da(y + (h << 4) + 4 | 0, s);
          C = +(b[m >> 2] | 0);
          e[t >> 3] = C * 3.0;
          e[n >> 3] = 0.0;
          D = C * -1.5;
          e[u >> 3] = D;
          e[o >> 3] = C * 2.598076211353316;
          e[v >> 3] = D;
          e[p >> 3] = C * -2.598076211353316;
          h = b[x >> 2] | 0;

          switch (b[17008 + (h * 80 | 0) + (((f | 0) == (h | 0) ? b[z >> 2] | 0 : f) << 2) >> 2] | 0) {
            case 1:
              {
                a = u;
                f = t;
                break;
              }

            case 3:
              {
                a = v;
                f = u;
                break;
              }

            case 2:
              {
                a = t;
                f = v;
                break;
              }

            default:
              {
                a = 8;
                break a;
              }
          }

          Gc(A, s, f, a, w);

          if (!(Hc(A, w) | 0) ? !(Hc(s, w) | 0) : 0) {
            _a(w, b[x >> 2] | 0, k, 1, g + 8 + (b[g >> 2] << 4) | 0);

            b[g >> 2] = (b[g >> 2] | 0) + 1;
          }
        }

        if ((j | 0) < (l | 0)) {
          Da(q, A);

          _a(A, b[z >> 2] | 0, k, 1, g + 8 + (b[g >> 2] << 4) | 0);

          b[g >> 2] = (b[g >> 2] | 0) + 1;
        }

        j = j + 1 | 0;

        if ((j | 0) >= (r | 0)) {
          a = 3;
          break;
        } else { f = b[z >> 2] | 0; }
      }

      if ((a | 0) == 3) {
        S = B;
        return;
      } else if ((a | 0) == 8) { H(22557, 22521, 746, 22602); }
    }

    function fb(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0;
      j = S;
      S = S + 160 | 0;
      e = j + 80 | 0;
      f = j;
      g = e;
      h = 20336;
      i = g + 72 | 0;

      do {
        b[g >> 2] = b[h >> 2];
        g = g + 4 | 0;
        h = h + 4 | 0;
      } while ((g | 0) < (i | 0));

      g = f;
      h = 20416;
      i = g + 72 | 0;

      do {
        b[g >> 2] = b[h >> 2];
        g = g + 4 | 0;
        h = h + 4 | 0;
      } while ((g | 0) < (i | 0));

      i = (Rb(b[c >> 2] | 0) | 0) == 0;
      e = i ? e : f;
      f = a + 4 | 0;
      Ra(f);
      Sa(f);

      if (Rb(b[c >> 2] | 0) | 0) {
        La(f);
        b[c >> 2] = (b[c >> 2] | 0) + 1;
      }

      b[d >> 2] = b[a >> 2];
      c = d + 4 | 0;
      Ea(f, e, c);
      Ca(c);
      b[d + 16 >> 2] = b[a >> 2];
      c = d + 20 | 0;
      Ea(f, e + 12 | 0, c);
      Ca(c);
      b[d + 32 >> 2] = b[a >> 2];
      c = d + 36 | 0;
      Ea(f, e + 24 | 0, c);
      Ca(c);
      b[d + 48 >> 2] = b[a >> 2];
      c = d + 52 | 0;
      Ea(f, e + 36 | 0, c);
      Ca(c);
      b[d + 64 >> 2] = b[a >> 2];
      c = d + 68 | 0;
      Ea(f, e + 48 | 0, c);
      Ca(c);
      b[d + 80 >> 2] = b[a >> 2];
      d = d + 84 | 0;
      Ea(f, e + 60 | 0, d);
      Ca(d);
      S = j;
      return;
    }

    function gb(a) {
      a = +a;
      var b = 0.0;
      b = a < 0.0 ? a + 6.283185307179586 : a;
      return +(!(a >= 6.283185307179586) ? b : b + -6.283185307179586);
    }

    function hb(a, b) {
      a = a | 0;
      b = b | 0;

      if (!(+q(+(+e[a >> 3] - +e[b >> 3])) < 1.7453292519943298e-11)) {
        b = 0;
        return b | 0;
      }

      b = +q(+(+e[a + 8 >> 3] - +e[b + 8 >> 3])) < 1.7453292519943298e-11;
      return b | 0;
    }

    function ib(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0.0,
          d = 0.0,
          f = 0.0,
          g = 0.0;
      f = +e[b >> 3];
      d = +e[a >> 3];
      g = +u(+((f - d) * .5));
      c = +u(+((+e[b + 8 >> 3] - +e[a + 8 >> 3]) * .5));
      c = g * g + c * (+t(+f) * +t(+d) * c);
      return +(+z(+ +r(+c), + +r(+(1.0 - c))) * 2.0);
    }

    function jb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0.0,
          d = 0.0,
          f = 0.0,
          g = 0.0;
      f = +e[b >> 3];
      d = +e[a >> 3];
      g = +u(+((f - d) * .5));
      c = +u(+((+e[b + 8 >> 3] - +e[a + 8 >> 3]) * .5));
      c = g * g + c * (+t(+f) * +t(+d) * c);
      return +(+z(+ +r(+c), + +r(+(1.0 - c))) * 2.0 * 6371.007180918475);
    }

    function kb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0.0,
          d = 0.0,
          f = 0.0,
          g = 0.0;
      f = +e[b >> 3];
      d = +e[a >> 3];
      g = +u(+((f - d) * .5));
      c = +u(+((+e[b + 8 >> 3] - +e[a + 8 >> 3]) * .5));
      c = g * g + c * (+t(+f) * +t(+d) * c);
      return +(+z(+ +r(+c), + +r(+(1.0 - c))) * 2.0 * 6371.007180918475 * 1.0e3);
    }

    function lb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0.0,
          d = 0.0,
          f = 0.0,
          g = 0.0,
          h = 0.0;
      g = +e[b >> 3];
      d = +t(+g);
      f = +e[b + 8 >> 3] - +e[a + 8 >> 3];
      h = d * +u(+f);
      c = +e[a >> 3];
      return + +z(+h, +(+u(+g) * +t(+c) - +t(+f) * (d * +u(+c))));
    }

    function mb(a, c, d, f) {
      a = a | 0;
      c = +c;
      d = +d;
      f = f | 0;
      var g = 0,
          h = 0.0,
          i = 0.0,
          j = 0.0;

      if (d < 1.0e-16) {
        b[f >> 2] = b[a >> 2];
        b[f + 4 >> 2] = b[a + 4 >> 2];
        b[f + 8 >> 2] = b[a + 8 >> 2];
        b[f + 12 >> 2] = b[a + 12 >> 2];
        return;
      }

      h = c < 0.0 ? c + 6.283185307179586 : c;
      h = !(c >= 6.283185307179586) ? h : h + -6.283185307179586;

      do { if (h < 1.0e-16) {
        c = +e[a >> 3] + d;
        e[f >> 3] = c;
        g = f;
      } else {
        g = +q(+(h + -3.141592653589793)) < 1.0e-16;
        c = +e[a >> 3];

        if (g) {
          c = c - d;
          e[f >> 3] = c;
          g = f;
          break;
        }

        i = +t(+d);
        d = +u(+d);
        c = i * +u(+c) + +t(+h) * (d * +t(+c));
        c = c > 1.0 ? 1.0 : c;
        c = +x(+(c < -1.0 ? -1.0 : c));
        e[f >> 3] = c;

        if (+q(+(c + -1.5707963267948966)) < 1.0e-16) {
          e[f >> 3] = 1.5707963267948966;
          e[f + 8 >> 3] = 0.0;
          return;
        }

        if (+q(+(c + 1.5707963267948966)) < 1.0e-16) {
          e[f >> 3] = -1.5707963267948966;
          e[f + 8 >> 3] = 0.0;
          return;
        }

        j = +t(+c);
        h = d * +u(+h) / j;
        d = +e[a >> 3];
        c = (i - +u(+c) * +u(+d)) / +t(+d) / j;
        i = h > 1.0 ? 1.0 : h;
        c = c > 1.0 ? 1.0 : c;
        c = +e[a + 8 >> 3] + +z(+(i < -1.0 ? -1.0 : i), +(c < -1.0 ? -1.0 : c));
        if (c > 3.141592653589793) { do { c = c + -6.283185307179586; } while (c > 3.141592653589793); }
        if (c < -3.141592653589793) { do { c = c + 6.283185307179586; } while (c < -3.141592653589793); }
        e[f + 8 >> 3] = c;
        return;
      } } while (0);

      if (+q(+(c + -1.5707963267948966)) < 1.0e-16) {
        e[g >> 3] = 1.5707963267948966;
        e[f + 8 >> 3] = 0.0;
        return;
      }

      if (+q(+(c + 1.5707963267948966)) < 1.0e-16) {
        e[g >> 3] = -1.5707963267948966;
        e[f + 8 >> 3] = 0.0;
        return;
      }

      c = +e[a + 8 >> 3];
      if (c > 3.141592653589793) { do { c = c + -6.283185307179586; } while (c > 3.141592653589793); }
      if (c < -3.141592653589793) { do { c = c + 6.283185307179586; } while (c < -3.141592653589793); }
      e[f + 8 >> 3] = c;
      return;
    }

    function nb(a) {
      a = a | 0;
      return + +e[20496 + (a << 3) >> 3];
    }

    function ob(a) {
      a = a | 0;
      return + +e[20624 + (a << 3) >> 3];
    }

    function pb(a) {
      a = a | 0;
      return + +e[20752 + (a << 3) >> 3];
    }

    function qb(a) {
      a = a | 0;
      return + +e[20880 + (a << 3) >> 3];
    }

    function rb(a) {
      a = a | 0;
      var c = 0;
      c = 21008 + (a << 3) | 0;
      a = b[c >> 2] | 0;
      F(b[c + 4 >> 2] | 0);
      return a | 0;
    }

    function sb(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      var d = 0.0,
          f = 0.0,
          g = 0.0,
          h = 0.0,
          i = 0.0,
          j = 0.0,
          k = 0.0,
          l = 0.0,
          m = 0.0,
          n = 0.0;
      n = +e[b >> 3];
      l = +e[a >> 3];
      j = +u(+((n - l) * .5));
      g = +e[b + 8 >> 3];
      k = +e[a + 8 >> 3];
      h = +u(+((g - k) * .5));
      i = +t(+l);
      m = +t(+n);
      h = j * j + h * (m * i * h);
      h = +z(+ +r(+h), + +r(+(1.0 - h))) * 2.0;
      j = +e[c >> 3];
      n = +u(+((j - n) * .5));
      d = +e[c + 8 >> 3];
      g = +u(+((d - g) * .5));
      f = +t(+j);
      g = n * n + g * (m * f * g);
      g = +z(+ +r(+g), + +r(+(1.0 - g))) * 2.0;
      j = +u(+((l - j) * .5));
      d = +u(+((k - d) * .5));
      d = j * j + d * (i * f * d);
      d = +z(+ +r(+d), + +r(+(1.0 - d))) * 2.0;
      f = (h + g + d) * .5;
      return +(+y(+ +r(+(+v(+(f * .5)) * +v(+((f - h) * .5)) * +v(+((f - g) * .5)) * +v(+((f - d) * .5))))) * 4.0);
    }

    function tb(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          e = 0,
          f = 0,
          g = 0,
          h = 0;
      g = S;
      S = S + 192 | 0;
      e = g + 168 | 0;
      f = g;
      Vb(a, c, e);
      Wb(a, c, f);
      c = b[f >> 2] | 0;

      if ((c | 0) <= 0) {
        d = 0.0;
        S = g;
        return +d;
      }

      d = +sb(f + 8 | 0, f + 8 + (((c | 0) != 1 & 1) << 4) | 0, e) + 0.0;

      if ((c | 0) == 1) {
        S = g;
        return +d;
      }

      a = 1;

      do {
        h = a;
        a = a + 1 | 0;
        d = d + +sb(f + 8 + (h << 4) | 0, f + 8 + (((a | 0) % (c | 0) | 0) << 4) | 0, e);
      } while ((a | 0) < (c | 0));

      S = g;
      return +d;
    }

    function ub(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          e = 0,
          f = 0,
          g = 0,
          h = 0;
      g = S;
      S = S + 192 | 0;
      e = g + 168 | 0;
      f = g;
      Vb(a, c, e);
      Wb(a, c, f);
      c = b[f >> 2] | 0;

      if ((c | 0) > 0) {
        d = +sb(f + 8 | 0, f + 8 + (((c | 0) != 1 & 1) << 4) | 0, e) + 0.0;

        if ((c | 0) != 1) {
          a = 1;

          do {
            h = a;
            a = a + 1 | 0;
            d = d + +sb(f + 8 + (h << 4) | 0, f + 8 + (((a | 0) % (c | 0) | 0) << 4) | 0, e);
          } while ((a | 0) < (c | 0));
        }
      } else { d = 0.0; }

      S = g;
      return +(d * 6371.007180918475 * 6371.007180918475);
    }

    function vb(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          e = 0,
          f = 0,
          g = 0,
          h = 0;
      g = S;
      S = S + 192 | 0;
      e = g + 168 | 0;
      f = g;
      Vb(a, c, e);
      Wb(a, c, f);
      c = b[f >> 2] | 0;

      if ((c | 0) > 0) {
        d = +sb(f + 8 | 0, f + 8 + (((c | 0) != 1 & 1) << 4) | 0, e) + 0.0;

        if ((c | 0) != 1) {
          a = 1;

          do {
            h = a;
            a = a + 1 | 0;
            d = d + +sb(f + 8 + (h << 4) | 0, f + 8 + (((a | 0) % (c | 0) | 0) << 4) | 0, e);
          } while ((a | 0) < (c | 0));
        }
      } else { d = 0.0; }

      S = g;
      return +(d * 6371.007180918475 * 6371.007180918475 * 1.0e3 * 1.0e3);
    }

    function wb(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          f = 0.0,
          g = 0.0,
          h = 0,
          i = 0,
          j = 0.0,
          k = 0.0,
          l = 0.0;
      i = S;
      S = S + 176 | 0;
      h = i;
      gc(a, c, h);
      a = b[h >> 2] | 0;

      if ((a | 0) <= 1) {
        g = 0.0;
        S = i;
        return +g;
      }

      c = a + -1 | 0;
      a = 0;
      d = 0.0;
      f = +e[h + 8 >> 3];
      g = +e[h + 16 >> 3];

      do {
        a = a + 1 | 0;
        k = f;
        f = +e[h + 8 + (a << 4) >> 3];
        l = +u(+((f - k) * .5));
        j = g;
        g = +e[h + 8 + (a << 4) + 8 >> 3];
        j = +u(+((g - j) * .5));
        j = l * l + j * (+t(+f) * +t(+k) * j);
        d = d + +z(+ +r(+j), + +r(+(1.0 - j))) * 2.0;
      } while ((a | 0) < (c | 0));

      S = i;
      return +d;
    }

    function xb(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          f = 0.0,
          g = 0.0,
          h = 0,
          i = 0,
          j = 0.0,
          k = 0.0,
          l = 0.0;
      i = S;
      S = S + 176 | 0;
      h = i;
      gc(a, c, h);
      a = b[h >> 2] | 0;

      if ((a | 0) <= 1) {
        g = 0.0;
        S = i;
        return +g;
      }

      c = a + -1 | 0;
      a = 0;
      d = 0.0;
      f = +e[h + 8 >> 3];
      g = +e[h + 16 >> 3];

      do {
        a = a + 1 | 0;
        k = f;
        f = +e[h + 8 + (a << 4) >> 3];
        l = +u(+((f - k) * .5));
        j = g;
        g = +e[h + 8 + (a << 4) + 8 >> 3];
        j = +u(+((g - j) * .5));
        j = l * l + j * (+t(+k) * +t(+f) * j);
        d = d + +z(+ +r(+j), + +r(+(1.0 - j))) * 2.0;
      } while ((a | 0) != (c | 0));

      l = d * 6371.007180918475;
      S = i;
      return +l;
    }

    function yb(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          f = 0.0,
          g = 0.0,
          h = 0,
          i = 0,
          j = 0.0,
          k = 0.0,
          l = 0.0;
      i = S;
      S = S + 176 | 0;
      h = i;
      gc(a, c, h);
      a = b[h >> 2] | 0;

      if ((a | 0) <= 1) {
        g = 0.0;
        S = i;
        return +g;
      }

      c = a + -1 | 0;
      a = 0;
      d = 0.0;
      f = +e[h + 8 >> 3];
      g = +e[h + 16 >> 3];

      do {
        a = a + 1 | 0;
        k = f;
        f = +e[h + 8 + (a << 4) >> 3];
        l = +u(+((f - k) * .5));
        j = g;
        g = +e[h + 8 + (a << 4) + 8 >> 3];
        j = +u(+((g - j) * .5));
        j = l * l + j * (+t(+k) * +t(+f) * j);
        d = d + +z(+ +r(+j), + +r(+(1.0 - j))) * 2.0;
      } while ((a | 0) != (c | 0));

      l = d * 6371.007180918475 * 1.0e3;
      S = i;
      return +l;
    }

    function zb(a, b) {
      a = a | 0;
      b = b | 0;
      b = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      return b & 15 | 0;
    }

    function Ab(a, b) {
      a = a | 0;
      b = b | 0;
      b = cd(a | 0, b | 0, 45) | 0;
      G() | 0;
      return b & 127 | 0;
    }

    function Bb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0;

      if (!(0 == 0 & (b & -16777216 | 0) == 134217728)) {
        b = 0;
        return b | 0;
      }

      g = cd(a | 0, b | 0, 45) | 0;
      G() | 0;
      g = g & 127;

      if (g >>> 0 > 121) {
        b = 0;
        return b | 0;
      }

      c = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      c = c & 15;

      do { if (c | 0) {
        e = 1;
        d = 0;

        while (1) {
          f = cd(a | 0, b | 0, (15 - e | 0) * 3 | 0) | 0;
          G() | 0;
          f = f & 7;
          if ((f | 0) != 0 & (d ^ 1)) { if ((f | 0) == 1 & (la(g) | 0) != 0) {
            h = 0;
            d = 13;
            break;
          } else { d = 1; } }

          if ((f | 0) == 7) {
            h = 0;
            d = 13;
            break;
          }

          if (e >>> 0 < c >>> 0) { e = e + 1 | 0; }else {
            d = 9;
            break;
          }
        }

        if ((d | 0) == 9) {
          if ((c | 0) == 15) { h = 1; }else { break; }
          return h | 0;
        } else if ((d | 0) == 13) { return h | 0; }
      } } while (0);

      while (1) {
        h = cd(a | 0, b | 0, (14 - c | 0) * 3 | 0) | 0;
        G() | 0;

        if (!((h & 7 | 0) == 7 & 0 == 0)) {
          h = 0;
          d = 13;
          break;
        }

        if (c >>> 0 < 14) { c = c + 1 | 0; }else {
          h = 1;
          d = 13;
          break;
        }
      }

      if ((d | 0) == 13) { return h | 0; }
      return 0;
    }

    function Cb(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      var d = 0,
          e = 0;
      d = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      d = d & 15;

      if ((d | 0) >= (c | 0)) {
        if ((d | 0) != (c | 0)) { if (c >>> 0 <= 15) {
          e = dd(c | 0, 0, 52) | 0;
          a = e | a;
          b = G() | 0 | b & -15728641;
          if ((d | 0) > (c | 0)) { do {
            e = dd(7, 0, (14 - c | 0) * 3 | 0) | 0;
            c = c + 1 | 0;
            a = e | a;
            b = G() | 0 | b;
          } while ((c | 0) < (d | 0)); }
        } else {
          b = 0;
          a = 0;
        } }
      } else {
        b = 0;
        a = 0;
      }

      F(b | 0);
      return a | 0;
    }

    function Db(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      a = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      a = a & 15;

      if (!((c | 0) < 16 & (a | 0) <= (c | 0))) {
        c = 0;
        return c | 0;
      }

      c = tc(7, c - a | 0) | 0;
      return c | 0;
    }

    function Eb(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0;
      h = cd(a | 0, c | 0, 52) | 0;
      G() | 0;
      h = h & 15;
      if (!((d | 0) < 16 & (h | 0) <= (d | 0))) { return; }

      if ((h | 0) == (d | 0)) {
        d = e;
        b[d >> 2] = a;
        b[d + 4 >> 2] = c;
        return;
      }

      j = tc(7, d - h | 0) | 0;
      k = (j | 0) / 7 | 0;
      i = cd(a | 0, c | 0, 45) | 0;
      G() | 0;
      if (!(la(i & 127) | 0)) { g = 0; }else {
        a: do { if (!h) { f = 0; }else {
          g = 1;

          while (1) {
            f = cd(a | 0, c | 0, (15 - g | 0) * 3 | 0) | 0;
            G() | 0;
            f = f & 7;
            if (f | 0) { break a; }
            if (g >>> 0 < h >>> 0) { g = g + 1 | 0; }else {
              f = 0;
              break;
            }
          }
        } } while (0);

        g = (f | 0) == 0;
      }
      l = dd(h + 1 | 0, 0, 52) | 0;
      f = G() | 0 | c & -15728641;
      i = (14 - h | 0) * 3 | 0;
      c = dd(7, 0, i | 0) | 0;
      c = (l | a) & ~c;
      h = f & ~(G() | 0);
      Eb(c, h, d, e);
      f = e + (k << 3) | 0;

      if (!g) {
        l = dd(1, 0, i | 0) | 0;
        Eb(l | c, G() | 0 | h, d, f);
        l = f + (k << 3) | 0;
        j = dd(2, 0, i | 0) | 0;
        Eb(j | c, G() | 0 | h, d, l);
        l = l + (k << 3) | 0;
        j = dd(3, 0, i | 0) | 0;
        Eb(j | c, G() | 0 | h, d, l);
        l = l + (k << 3) | 0;
        j = dd(4, 0, i | 0) | 0;
        Eb(j | c, G() | 0 | h, d, l);
        l = l + (k << 3) | 0;
        j = dd(5, 0, i | 0) | 0;
        Eb(j | c, G() | 0 | h, d, l);
        j = dd(6, 0, i | 0) | 0;
        Eb(j | c, G() | 0 | h, d, l + (k << 3) | 0);
        return;
      }

      g = f + (k << 3) | 0;

      if ((j | 0) > 6) {
        j = f + 8 | 0;
        l = (g >>> 0 > j >>> 0 ? g : j) + -1 + (0 - f) | 0;
        hd(f | 0, 0, l + 8 & -8 | 0) | 0;
        f = j + (l >>> 3 << 3) | 0;
      }

      l = dd(2, 0, i | 0) | 0;
      Eb(l | c, G() | 0 | h, d, f);
      l = f + (k << 3) | 0;
      j = dd(3, 0, i | 0) | 0;
      Eb(j | c, G() | 0 | h, d, l);
      l = l + (k << 3) | 0;
      j = dd(4, 0, i | 0) | 0;
      Eb(j | c, G() | 0 | h, d, l);
      l = l + (k << 3) | 0;
      j = dd(5, 0, i | 0) | 0;
      Eb(j | c, G() | 0 | h, d, l);
      j = dd(6, 0, i | 0) | 0;
      Eb(j | c, G() | 0 | h, d, l + (k << 3) | 0);
      return;
    }

    function Fb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0;
      e = cd(a | 0, b | 0, 45) | 0;
      G() | 0;

      if (!(la(e & 127) | 0)) {
        e = 0;
        return e | 0;
      }

      e = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      e = e & 15;

      a: do { if (!e) { c = 0; }else {
        d = 1;

        while (1) {
          c = cd(a | 0, b | 0, (15 - d | 0) * 3 | 0) | 0;
          G() | 0;
          c = c & 7;
          if (c | 0) { break a; }
          if (d >>> 0 < e >>> 0) { d = d + 1 | 0; }else {
            c = 0;
            break;
          }
        }
      } } while (0);

      e = (c | 0) == 0 & 1;
      return e | 0;
    }

    function Gb(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      var d = 0,
          e = 0;
      d = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      d = d & 15;

      if ((c | 0) < 16 & (d | 0) <= (c | 0)) {
        if ((d | 0) != (c | 0)) {
          e = dd(c | 0, 0, 52) | 0;
          a = e | a;
          b = G() | 0 | b & -15728641;
          if ((d | 0) < (c | 0)) { do {
            e = dd(7, 0, (14 - d | 0) * 3 | 0) | 0;
            d = d + 1 | 0;
            a = a & ~e;
            b = b & ~(G() | 0);
          } while ((d | 0) < (c | 0)); }
        }
      } else {
        b = 0;
        a = 0;
      }

      F(b | 0);
      return a | 0;
    }

    function Hb(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0,
          x = 0,
          y = 0,
          z = 0;

      if (!d) {
        y = 0;
        return y | 0;
      }

      f = a;
      e = b[f >> 2] | 0;
      f = b[f + 4 >> 2] | 0;

      if (0 == 0 & (f & 15728640 | 0) == 0) {
        if ((d | 0) <= 0) {
          y = 0;
          return y | 0;
        }

        y = c;
        b[y >> 2] = e;
        b[y + 4 >> 2] = f;

        if ((d | 0) == 1) {
          y = 0;
          return y | 0;
        }

        e = 1;

        do {
          w = a + (e << 3) | 0;
          x = b[w + 4 >> 2] | 0;
          y = c + (e << 3) | 0;
          b[y >> 2] = b[w >> 2];
          b[y + 4 >> 2] = x;
          e = e + 1 | 0;
        } while ((e | 0) != (d | 0));

        e = 0;
        return e | 0;
      }

      w = d << 3;
      x = Wc(w) | 0;

      if (!x) {
        y = -3;
        return y | 0;
      }

      gd(x | 0, a | 0, w | 0) | 0;
      v = Yc(d, 8) | 0;

      if (!v) {
        Xc(x);
        y = -3;
        return y | 0;
      }

      e = d;

      a: while (1) {
        h = x;
        l = b[h >> 2] | 0;
        h = b[h + 4 >> 2] | 0;
        t = cd(l | 0, h | 0, 52) | 0;
        G() | 0;
        t = t & 15;
        u = t + -1 | 0;
        s = (e | 0) > 0;

        b: do { if (s) {
          r = ((e | 0) < 0) << 31 >> 31;
          p = dd(u | 0, 0, 52) | 0;
          q = G() | 0;

          if (u >>> 0 > 15) {
            f = 0;
            a = l;
            d = h;

            while (1) {
              if (!((a | 0) == 0 & (d | 0) == 0)) {
                g = cd(a | 0, d | 0, 52) | 0;
                G() | 0;
                g = g & 15;
                i = (g | 0) < (u | 0);
                g = (g | 0) == (u | 0);
                k = i ? 0 : g ? a : 0;
                a = i ? 0 : g ? d : 0;
                d = bd(k | 0, a | 0, e | 0, r | 0) | 0;
                G() | 0;
                g = v + (d << 3) | 0;
                i = g;
                j = b[i >> 2] | 0;
                i = b[i + 4 >> 2] | 0;
                if ((j | 0) == 0 & (i | 0) == 0) { d = k; }else {
                  p = 0;
                  o = d;
                  n = i;
                  d = k;

                  while (1) {
                    if ((p | 0) > (e | 0)) {
                      y = 41;
                      break a;
                    }

                    if ((j | 0) == (d | 0) & (n & -117440513 | 0) == (a | 0)) {
                      k = cd(j | 0, n | 0, 56) | 0;
                      G() | 0;
                      k = k & 7;
                      m = k + 1 | 0;
                      q = cd(j | 0, n | 0, 45) | 0;
                      G() | 0;

                      c: do { if (!(la(q & 127) | 0)) { i = 7; }else {
                        j = cd(j | 0, n | 0, 52) | 0;
                        G() | 0;
                        j = j & 15;

                        if (!j) {
                          i = 6;
                          break;
                        }

                        i = 1;

                        while (1) {
                          q = dd(7, 0, (15 - i | 0) * 3 | 0) | 0;

                          if (!((q & d | 0) == 0 & ((G() | 0) & a | 0) == 0)) {
                            i = 7;
                            break c;
                          }

                          if (i >>> 0 < j >>> 0) { i = i + 1 | 0; }else {
                            i = 6;
                            break;
                          }
                        }
                      } } while (0);

                      if ((k + 2 | 0) >>> 0 > i >>> 0) {
                        y = 51;
                        break a;
                      }

                      q = dd(m | 0, 0, 56) | 0;
                      a = G() | 0 | a & -117440513;
                      i = g;
                      b[i >> 2] = 0;
                      b[i + 4 >> 2] = 0;
                      i = o;
                      d = q | d;
                    } else { i = (o + 1 | 0) % (e | 0) | 0; }

                    g = v + (i << 3) | 0;
                    n = g;
                    j = b[n >> 2] | 0;
                    n = b[n + 4 >> 2] | 0;
                    if ((j | 0) == 0 & (n | 0) == 0) { break; }else {
                      p = p + 1 | 0;
                      o = i;
                    }
                  }
                }
                q = g;
                b[q >> 2] = d;
                b[q + 4 >> 2] = a;
              }

              f = f + 1 | 0;
              if ((f | 0) >= (e | 0)) { break b; }
              d = x + (f << 3) | 0;
              a = b[d >> 2] | 0;
              d = b[d + 4 >> 2] | 0;
            }
          }

          f = 0;
          a = l;
          d = h;

          while (1) {
            if (!((a | 0) == 0 & (d | 0) == 0)) {
              i = cd(a | 0, d | 0, 52) | 0;
              G() | 0;
              i = i & 15;

              if ((i | 0) >= (u | 0)) {
                if ((i | 0) != (u | 0)) {
                  a = a | p;
                  d = d & -15728641 | q;

                  if (i >>> 0 >= t >>> 0) {
                    g = u;

                    do {
                      o = dd(7, 0, (14 - g | 0) * 3 | 0) | 0;
                      g = g + 1 | 0;
                      a = o | a;
                      d = G() | 0 | d;
                    } while (g >>> 0 < i >>> 0);
                  }
                }
              } else {
                a = 0;
                d = 0;
              }

              i = bd(a | 0, d | 0, e | 0, r | 0) | 0;
              G() | 0;
              g = v + (i << 3) | 0;
              j = g;
              k = b[j >> 2] | 0;
              j = b[j + 4 >> 2] | 0;

              if (!((k | 0) == 0 & (j | 0) == 0)) {
                o = 0;

                while (1) {
                  if ((o | 0) > (e | 0)) {
                    y = 41;
                    break a;
                  }

                  if ((k | 0) == (a | 0) & (j & -117440513 | 0) == (d | 0)) {
                    m = cd(k | 0, j | 0, 56) | 0;
                    G() | 0;
                    m = m & 7;
                    n = m + 1 | 0;
                    z = cd(k | 0, j | 0, 45) | 0;
                    G() | 0;

                    d: do { if (!(la(z & 127) | 0)) { j = 7; }else {
                      k = cd(k | 0, j | 0, 52) | 0;
                      G() | 0;
                      k = k & 15;

                      if (!k) {
                        j = 6;
                        break;
                      }

                      j = 1;

                      while (1) {
                        z = dd(7, 0, (15 - j | 0) * 3 | 0) | 0;

                        if (!((z & a | 0) == 0 & ((G() | 0) & d | 0) == 0)) {
                          j = 7;
                          break d;
                        }

                        if (j >>> 0 < k >>> 0) { j = j + 1 | 0; }else {
                          j = 6;
                          break;
                        }
                      }
                    } } while (0);

                    if ((m + 2 | 0) >>> 0 > j >>> 0) {
                      y = 51;
                      break a;
                    }

                    z = dd(n | 0, 0, 56) | 0;
                    d = G() | 0 | d & -117440513;
                    n = g;
                    b[n >> 2] = 0;
                    b[n + 4 >> 2] = 0;
                    a = z | a;
                  } else { i = (i + 1 | 0) % (e | 0) | 0; }

                  g = v + (i << 3) | 0;
                  j = g;
                  k = b[j >> 2] | 0;
                  j = b[j + 4 >> 2] | 0;
                  if ((k | 0) == 0 & (j | 0) == 0) { break; }else { o = o + 1 | 0; }
                }
              }

              z = g;
              b[z >> 2] = a;
              b[z + 4 >> 2] = d;
            }

            f = f + 1 | 0;
            if ((f | 0) >= (e | 0)) { break b; }
            d = x + (f << 3) | 0;
            a = b[d >> 2] | 0;
            d = b[d + 4 >> 2] | 0;
          }
        } } while (0);

        if ((e + 5 | 0) >>> 0 < 11) {
          y = 99;
          break;
        }

        q = Yc((e | 0) / 6 | 0, 8) | 0;

        if (!q) {
          y = 58;
          break;
        }

        e: do { if (s) {
          o = 0;
          n = 0;

          do {
            i = v + (o << 3) | 0;
            a = i;
            f = b[a >> 2] | 0;
            a = b[a + 4 >> 2] | 0;

            if (!((f | 0) == 0 & (a | 0) == 0)) {
              j = cd(f | 0, a | 0, 56) | 0;
              G() | 0;
              j = j & 7;
              d = j + 1 | 0;
              k = a & -117440513;
              z = cd(f | 0, a | 0, 45) | 0;
              G() | 0;

              f: do { if (la(z & 127) | 0) {
                m = cd(f | 0, a | 0, 52) | 0;
                G() | 0;
                m = m & 15;

                if (m | 0) {
                  g = 1;

                  while (1) {
                    z = dd(7, 0, (15 - g | 0) * 3 | 0) | 0;
                    if (!((f & z | 0) == 0 & (k & (G() | 0) | 0) == 0)) { break f; }
                    if (g >>> 0 < m >>> 0) { g = g + 1 | 0; }else { break; }
                  }
                }

                a = dd(d | 0, 0, 56) | 0;
                f = a | f;
                a = G() | 0 | k;
                d = i;
                b[d >> 2] = f;
                b[d + 4 >> 2] = a;
                d = j + 2 | 0;
              } } while (0);

              if ((d | 0) == 7) {
                z = q + (n << 3) | 0;
                b[z >> 2] = f;
                b[z + 4 >> 2] = a & -117440513;
                n = n + 1 | 0;
              }
            }

            o = o + 1 | 0;
          } while ((o | 0) != (e | 0));

          if (s) {
            p = ((e | 0) < 0) << 31 >> 31;
            m = dd(u | 0, 0, 52) | 0;
            o = G() | 0;

            if (u >>> 0 > 15) {
              a = 0;
              f = 0;

              while (1) {
                do { if (!((l | 0) == 0 & (h | 0) == 0)) {
                  j = cd(l | 0, h | 0, 52) | 0;
                  G() | 0;
                  j = j & 15;
                  g = (j | 0) < (u | 0);
                  j = (j | 0) == (u | 0);
                  i = g ? 0 : j ? l : 0;
                  j = g ? 0 : j ? h : 0;
                  g = bd(i | 0, j | 0, e | 0, p | 0) | 0;
                  G() | 0;
                  d = 0;

                  while (1) {
                    if ((d | 0) > (e | 0)) {
                      y = 98;
                      break a;
                    }

                    z = v + (g << 3) | 0;
                    k = b[z + 4 >> 2] | 0;

                    if ((k & -117440513 | 0) == (j | 0) ? (b[z >> 2] | 0) == (i | 0) : 0) {
                      y = 70;
                      break;
                    }

                    g = (g + 1 | 0) % (e | 0) | 0;
                    z = v + (g << 3) | 0;
                    if ((b[z >> 2] | 0) == (i | 0) ? (b[z + 4 >> 2] | 0) == (j | 0) : 0) { break; }else { d = d + 1 | 0; }
                  }

                  if ((y | 0) == 70 ? (y = 0, 0 == 0 & (k & 117440512 | 0) == 100663296) : 0) { break; }
                  z = c + (f << 3) | 0;
                  b[z >> 2] = l;
                  b[z + 4 >> 2] = h;
                  f = f + 1 | 0;
                } } while (0);

                a = a + 1 | 0;

                if ((a | 0) >= (e | 0)) {
                  e = n;
                  break e;
                }

                h = x + (a << 3) | 0;
                l = b[h >> 2] | 0;
                h = b[h + 4 >> 2] | 0;
              }
            }

            a = 0;
            f = 0;

            while (1) {
              do { if (!((l | 0) == 0 & (h | 0) == 0)) {
                j = cd(l | 0, h | 0, 52) | 0;
                G() | 0;
                j = j & 15;
                if ((j | 0) >= (u | 0)) {
                  if ((j | 0) != (u | 0)) {
                    d = l | m;
                    g = h & -15728641 | o;
                    if (j >>> 0 < t >>> 0) { j = g; }else {
                      i = u;

                      do {
                        z = dd(7, 0, (14 - i | 0) * 3 | 0) | 0;
                        i = i + 1 | 0;
                        d = z | d;
                        g = G() | 0 | g;
                      } while (i >>> 0 < j >>> 0);

                      j = g;
                    }
                  } else {
                    d = l;
                    j = h;
                  }
                } else {
                  d = 0;
                  j = 0;
                }
                i = bd(d | 0, j | 0, e | 0, p | 0) | 0;
                G() | 0;
                g = 0;

                while (1) {
                  if ((g | 0) > (e | 0)) {
                    y = 98;
                    break a;
                  }

                  z = v + (i << 3) | 0;
                  k = b[z + 4 >> 2] | 0;

                  if ((k & -117440513 | 0) == (j | 0) ? (b[z >> 2] | 0) == (d | 0) : 0) {
                    y = 93;
                    break;
                  }

                  i = (i + 1 | 0) % (e | 0) | 0;
                  z = v + (i << 3) | 0;
                  if ((b[z >> 2] | 0) == (d | 0) ? (b[z + 4 >> 2] | 0) == (j | 0) : 0) { break; }else { g = g + 1 | 0; }
                }

                if ((y | 0) == 93 ? (y = 0, 0 == 0 & (k & 117440512 | 0) == 100663296) : 0) { break; }
                z = c + (f << 3) | 0;
                b[z >> 2] = l;
                b[z + 4 >> 2] = h;
                f = f + 1 | 0;
              } } while (0);

              a = a + 1 | 0;

              if ((a | 0) >= (e | 0)) {
                e = n;
                break e;
              }

              h = x + (a << 3) | 0;
              l = b[h >> 2] | 0;
              h = b[h + 4 >> 2] | 0;
            }
          } else {
            f = 0;
            e = n;
          }
        } else {
          f = 0;
          e = 0;
        } } while (0);

        hd(v | 0, 0, w | 0) | 0;
        gd(x | 0, q | 0, e << 3 | 0) | 0;
        Xc(q);
        if (!e) { break; }else { c = c + (f << 3) | 0; }
      }

      if ((y | 0) == 41) {
        Xc(x);
        Xc(v);
        z = -1;
        return z | 0;
      } else if ((y | 0) == 51) {
        Xc(x);
        Xc(v);
        z = -2;
        return z | 0;
      } else if ((y | 0) == 58) {
        Xc(x);
        Xc(v);
        z = -3;
        return z | 0;
      } else if ((y | 0) == 98) {
        Xc(q);
        Xc(x);
        Xc(v);
        z = -1;
        return z | 0;
      } else if ((y | 0) == 99) { gd(c | 0, x | 0, e << 3 | 0) | 0; }

      Xc(x);
      Xc(v);
      z = 0;
      return z | 0;
    }

    function Ib(a, c, d, e, f) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      f = f | 0;
      var g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0;

      if ((c | 0) <= 0) {
        f = 0;
        return f | 0;
      }

      if ((f | 0) >= 16) {
        g = 0;

        while (1) {
          l = a + (g << 3) | 0;

          if (!((b[l >> 2] | 0) == 0 & (b[l + 4 >> 2] | 0) == 0)) {
            g = 14;
            break;
          }

          g = g + 1 | 0;

          if ((g | 0) >= (c | 0)) {
            h = 0;
            g = 16;
            break;
          }
        }

        if ((g | 0) == 14) { return ((e | 0) > 0 ? -2 : -1) | 0; }else if ((g | 0) == 16) { return h | 0; }
      }

      g = 0;
      l = 0;

      a: while (1) {
        k = a + (l << 3) | 0;
        i = k;
        h = b[i >> 2] | 0;
        i = b[i + 4 >> 2] | 0;

        do { if (!((h | 0) == 0 & (i | 0) == 0)) {
          if ((g | 0) >= (e | 0)) {
            h = -1;
            g = 16;
            break a;
          }

          j = cd(h | 0, i | 0, 52) | 0;
          G() | 0;
          j = j & 15;

          if ((j | 0) > (f | 0)) {
            h = -2;
            g = 16;
            break a;
          }

          if ((j | 0) == (f | 0)) {
            k = d + (g << 3) | 0;
            b[k >> 2] = h;
            b[k + 4 >> 2] = i;
            g = g + 1 | 0;
            break;
          }

          h = (tc(7, f - j | 0) | 0) + g | 0;

          if ((h | 0) > (e | 0)) {
            h = -1;
            g = 16;
            break a;
          }

          Eb(b[k >> 2] | 0, b[k + 4 >> 2] | 0, f, d + (g << 3) | 0);
          g = h;
        } } while (0);

        l = l + 1 | 0;

        if ((l | 0) >= (c | 0)) {
          h = 0;
          g = 16;
          break;
        }
      }

      if ((g | 0) == 16) { return h | 0; }
      return 0;
    }

    function Jb(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0;

      if ((c | 0) <= 0) {
        d = 0;
        return d | 0;
      }

      if ((d | 0) >= 16) {
        e = 0;

        while (1) {
          h = a + (e << 3) | 0;

          if (!((b[h >> 2] | 0) == 0 & (b[h + 4 >> 2] | 0) == 0)) {
            e = -1;
            f = 13;
            break;
          }

          e = e + 1 | 0;

          if ((e | 0) >= (c | 0)) {
            e = 0;
            f = 13;
            break;
          }
        }

        if ((f | 0) == 13) { return e | 0; }
      }

      e = 0;
      h = 0;

      a: while (1) {
        f = a + (h << 3) | 0;
        g = b[f >> 2] | 0;
        f = b[f + 4 >> 2] | 0;

        do { if (!((g | 0) == 0 & (f | 0) == 0)) {
          f = cd(g | 0, f | 0, 52) | 0;
          G() | 0;
          f = f & 15;

          if ((f | 0) > (d | 0)) {
            e = -1;
            f = 13;
            break a;
          }

          if ((f | 0) == (d | 0)) {
            e = e + 1 | 0;
            break;
          } else {
            e = (tc(7, d - f | 0) | 0) + e | 0;
            break;
          }
        } } while (0);

        h = h + 1 | 0;

        if ((h | 0) >= (c | 0)) {
          f = 13;
          break;
        }
      }

      if ((f | 0) == 13) { return e | 0; }
      return 0;
    }

    function Kb(a, b) {
      a = a | 0;
      b = b | 0;
      b = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      return b & 1 | 0;
    }

    function Lb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0;
      e = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      e = e & 15;

      if (!e) {
        e = 0;
        return e | 0;
      }

      d = 1;

      while (1) {
        c = cd(a | 0, b | 0, (15 - d | 0) * 3 | 0) | 0;
        G() | 0;
        c = c & 7;

        if (c | 0) {
          d = 5;
          break;
        }

        if (d >>> 0 < e >>> 0) { d = d + 1 | 0; }else {
          c = 0;
          d = 5;
          break;
        }
      }

      if ((d | 0) == 5) { return c | 0; }
      return 0;
    }

    function Mb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      i = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      i = i & 15;

      if (!i) {
        h = b;
        i = a;
        F(h | 0);
        return i | 0;
      }

      h = 1;
      c = 0;

      while (1) {
        f = (15 - h | 0) * 3 | 0;
        d = dd(7, 0, f | 0) | 0;
        e = G() | 0;
        g = cd(a | 0, b | 0, f | 0) | 0;
        G() | 0;
        f = dd(Pa(g & 7) | 0, 0, f | 0) | 0;
        g = G() | 0;
        a = f | a & ~d;
        b = g | b & ~e;

        a: do { if (!c) { if (!((f & d | 0) == 0 & (g & e | 0) == 0)) {
          d = cd(a | 0, b | 0, 52) | 0;
          G() | 0;
          d = d & 15;
          if (!d) { c = 1; }else {
            c = 1;

            b: while (1) {
              g = cd(a | 0, b | 0, (15 - c | 0) * 3 | 0) | 0;
              G() | 0;

              switch (g & 7) {
                case 1:
                  break b;

                case 0:
                  break;

                default:
                  {
                    c = 1;
                    break a;
                  }
              }

              if (c >>> 0 < d >>> 0) { c = c + 1 | 0; }else {
                c = 1;
                break a;
              }
            }

            c = 1;

            while (1) {
              g = (15 - c | 0) * 3 | 0;
              e = cd(a | 0, b | 0, g | 0) | 0;
              G() | 0;
              f = dd(7, 0, g | 0) | 0;
              b = b & ~(G() | 0);
              g = dd(Pa(e & 7) | 0, 0, g | 0) | 0;
              a = a & ~f | g;
              b = b | (G() | 0);
              if (c >>> 0 < d >>> 0) { c = c + 1 | 0; }else {
                c = 1;
                break;
              }
            }
          }
        } else { c = 0; } } } while (0);

        if (h >>> 0 < i >>> 0) { h = h + 1 | 0; }else { break; }
      }

      F(b | 0);
      return a | 0;
    }

    function Nb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0;
      d = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      d = d & 15;

      if (!d) {
        c = b;
        d = a;
        F(c | 0);
        return d | 0;
      }

      c = 1;

      while (1) {
        f = (15 - c | 0) * 3 | 0;
        g = cd(a | 0, b | 0, f | 0) | 0;
        G() | 0;
        e = dd(7, 0, f | 0) | 0;
        b = b & ~(G() | 0);
        f = dd(Pa(g & 7) | 0, 0, f | 0) | 0;
        a = f | a & ~e;
        b = G() | 0 | b;
        if (c >>> 0 < d >>> 0) { c = c + 1 | 0; }else { break; }
      }

      F(b | 0);
      return a | 0;
    }

    function Ob(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      i = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      i = i & 15;

      if (!i) {
        h = b;
        i = a;
        F(h | 0);
        return i | 0;
      }

      h = 1;
      c = 0;

      while (1) {
        f = (15 - h | 0) * 3 | 0;
        d = dd(7, 0, f | 0) | 0;
        e = G() | 0;
        g = cd(a | 0, b | 0, f | 0) | 0;
        G() | 0;
        f = dd(Qa(g & 7) | 0, 0, f | 0) | 0;
        g = G() | 0;
        a = f | a & ~d;
        b = g | b & ~e;

        a: do { if (!c) { if (!((f & d | 0) == 0 & (g & e | 0) == 0)) {
          d = cd(a | 0, b | 0, 52) | 0;
          G() | 0;
          d = d & 15;
          if (!d) { c = 1; }else {
            c = 1;

            b: while (1) {
              g = cd(a | 0, b | 0, (15 - c | 0) * 3 | 0) | 0;
              G() | 0;

              switch (g & 7) {
                case 1:
                  break b;

                case 0:
                  break;

                default:
                  {
                    c = 1;
                    break a;
                  }
              }

              if (c >>> 0 < d >>> 0) { c = c + 1 | 0; }else {
                c = 1;
                break a;
              }
            }

            c = 1;

            while (1) {
              e = (15 - c | 0) * 3 | 0;
              f = dd(7, 0, e | 0) | 0;
              g = b & ~(G() | 0);
              b = cd(a | 0, b | 0, e | 0) | 0;
              G() | 0;
              b = dd(Qa(b & 7) | 0, 0, e | 0) | 0;
              a = a & ~f | b;
              b = g | (G() | 0);
              if (c >>> 0 < d >>> 0) { c = c + 1 | 0; }else {
                c = 1;
                break;
              }
            }
          }
        } else { c = 0; } } } while (0);

        if (h >>> 0 < i >>> 0) { h = h + 1 | 0; }else { break; }
      }

      F(b | 0);
      return a | 0;
    }

    function Pb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0;
      d = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      d = d & 15;

      if (!d) {
        c = b;
        d = a;
        F(c | 0);
        return d | 0;
      }

      c = 1;

      while (1) {
        g = (15 - c | 0) * 3 | 0;
        f = dd(7, 0, g | 0) | 0;
        e = b & ~(G() | 0);
        b = cd(a | 0, b | 0, g | 0) | 0;
        G() | 0;
        b = dd(Qa(b & 7) | 0, 0, g | 0) | 0;
        a = b | a & ~f;
        b = G() | 0 | e;
        if (c >>> 0 < d >>> 0) { c = c + 1 | 0; }else { break; }
      }

      F(b | 0);
      return a | 0;
    }

    function Qb(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0;
      j = S;
      S = S + 64 | 0;
      i = j + 40 | 0;
      e = j + 24 | 0;
      f = j + 12 | 0;
      g = j;
      dd(c | 0, 0, 52) | 0;
      d = G() | 0 | 134225919;

      if (!c) {
        if ((b[a + 4 >> 2] | 0) > 2) {
          h = 0;
          i = 0;
          F(h | 0);
          S = j;
          return i | 0;
        }

        if ((b[a + 8 >> 2] | 0) > 2) {
          h = 0;
          i = 0;
          F(h | 0);
          S = j;
          return i | 0;
        }

        if ((b[a + 12 >> 2] | 0) > 2) {
          h = 0;
          i = 0;
          F(h | 0);
          S = j;
          return i | 0;
        }

        dd(na(a) | 0, 0, 45) | 0;
        h = G() | 0 | d;
        i = -1;
        F(h | 0);
        S = j;
        return i | 0;
      }
      b[i >> 2] = b[a >> 2];
      b[i + 4 >> 2] = b[a + 4 >> 2];
      b[i + 8 >> 2] = b[a + 8 >> 2];
      b[i + 12 >> 2] = b[a + 12 >> 2];
      h = i + 4 | 0;

      if ((c | 0) > 0) {
        a = -1;

        while (1) {
          b[e >> 2] = b[h >> 2];
          b[e + 4 >> 2] = b[h + 4 >> 2];
          b[e + 8 >> 2] = b[h + 8 >> 2];

          if (!(c & 1)) {
            Ja(h);
            b[f >> 2] = b[h >> 2];
            b[f + 4 >> 2] = b[h + 4 >> 2];
            b[f + 8 >> 2] = b[h + 8 >> 2];
            La(f);
          } else {
            Ia(h);
            b[f >> 2] = b[h >> 2];
            b[f + 4 >> 2] = b[h + 4 >> 2];
            b[f + 8 >> 2] = b[h + 8 >> 2];
            Ka(f);
          }

          Fa(e, f, g);
          Ca(g);
          l = (15 - c | 0) * 3 | 0;
          k = dd(7, 0, l | 0) | 0;
          d = d & ~(G() | 0);
          l = dd(Ha(g) | 0, 0, l | 0) | 0;
          a = l | a & ~k;
          d = G() | 0 | d;
          if ((c | 0) > 1) { c = c + -1 | 0; }else { break; }
        }
      } else { a = -1; }

      a: do { if (((b[h >> 2] | 0) <= 2 ? (b[i + 8 >> 2] | 0) <= 2 : 0) ? (b[i + 12 >> 2] | 0) <= 2 : 0) {
        e = na(i) | 0;
        c = dd(e | 0, 0, 45) | 0;
        c = c | a;
        a = G() | 0 | d & -1040385;
        g = oa(i) | 0;

        if (!(la(e) | 0)) {
          if ((g | 0) <= 0) { break; }
          f = 0;

          while (1) {
            e = cd(c | 0, a | 0, 52) | 0;
            G() | 0;
            e = e & 15;

            if (e) {
              d = 1;

              while (1) {
                l = (15 - d | 0) * 3 | 0;
                i = cd(c | 0, a | 0, l | 0) | 0;
                G() | 0;
                k = dd(7, 0, l | 0) | 0;
                a = a & ~(G() | 0);
                l = dd(Pa(i & 7) | 0, 0, l | 0) | 0;
                c = c & ~k | l;
                a = a | (G() | 0);
                if (d >>> 0 < e >>> 0) { d = d + 1 | 0; }else { break; }
              }
            }

            f = f + 1 | 0;
            if ((f | 0) == (g | 0)) { break a; }
          }
        }

        f = cd(c | 0, a | 0, 52) | 0;
        G() | 0;
        f = f & 15;

        b: do { if (f) {
          d = 1;

          c: while (1) {
            l = cd(c | 0, a | 0, (15 - d | 0) * 3 | 0) | 0;
            G() | 0;

            switch (l & 7) {
              case 1:
                break c;

              case 0:
                break;

              default:
                break b;
            }

            if (d >>> 0 < f >>> 0) { d = d + 1 | 0; }else { break b; }
          }

          if (ra(e, b[i >> 2] | 0) | 0) {
            d = 1;

            while (1) {
              i = (15 - d | 0) * 3 | 0;
              k = dd(7, 0, i | 0) | 0;
              l = a & ~(G() | 0);
              a = cd(c | 0, a | 0, i | 0) | 0;
              G() | 0;
              a = dd(Qa(a & 7) | 0, 0, i | 0) | 0;
              c = c & ~k | a;
              a = l | (G() | 0);
              if (d >>> 0 < f >>> 0) { d = d + 1 | 0; }else { break; }
            }
          } else {
            d = 1;

            while (1) {
              l = (15 - d | 0) * 3 | 0;
              i = cd(c | 0, a | 0, l | 0) | 0;
              G() | 0;
              k = dd(7, 0, l | 0) | 0;
              a = a & ~(G() | 0);
              l = dd(Pa(i & 7) | 0, 0, l | 0) | 0;
              c = c & ~k | l;
              a = a | (G() | 0);
              if (d >>> 0 < f >>> 0) { d = d + 1 | 0; }else { break; }
            }
          }
        } } while (0);

        if ((g | 0) > 0) {
          d = 0;

          do {
            c = Mb(c, a) | 0;
            a = G() | 0;
            d = d + 1 | 0;
          } while ((d | 0) != (g | 0));
        }
      } else {
        c = 0;
        a = 0;
      } } while (0);

      k = a;
      l = c;
      F(k | 0);
      S = j;
      return l | 0;
    }

    function Rb(a) {
      a = a | 0;
      return (a | 0) % 2 | 0 | 0;
    }

    function Sb(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0;
      e = S;
      S = S + 16 | 0;
      d = e;

      if ((c >>> 0 <= 15 ? !((b[a + 4 >> 2] & 2146435072 | 0) == 2146435072) : 0) ? !((b[a + 8 + 4 >> 2] & 2146435072 | 0) == 2146435072) : 0) {
        Ya(a, c, d);
        c = Qb(d, c) | 0;
        a = G() | 0;
      } else {
        a = 0;
        c = 0;
      }

      F(a | 0);
      S = e;
      return c | 0;
    }

    function Tb(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0;
      f = d + 4 | 0;
      g = cd(a | 0, c | 0, 52) | 0;
      G() | 0;
      g = g & 15;
      h = cd(a | 0, c | 0, 45) | 0;
      G() | 0;
      e = (g | 0) == 0;

      if (!(la(h & 127) | 0)) {
        if (e) {
          h = 0;
          return h | 0;
        }

        if ((b[f >> 2] | 0) == 0 ? (b[d + 8 >> 2] | 0) == 0 : 0) { e = (b[d + 12 >> 2] | 0) != 0 & 1; }else { e = 1; }
      } else if (e) {
        h = 1;
        return h | 0;
      } else { e = 1; }

      d = 1;

      while (1) {
        if (!(d & 1)) { La(f); }else { Ka(f); }
        h = cd(a | 0, c | 0, (15 - d | 0) * 3 | 0) | 0;
        G() | 0;
        Ma(f, h & 7);
        if (d >>> 0 < g >>> 0) { d = d + 1 | 0; }else { break; }
      }

      return e | 0;
    }

    function Ub(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0;
      l = S;
      S = S + 16 | 0;
      j = l;
      k = cd(a | 0, c | 0, 45) | 0;
      G() | 0;
      k = k & 127;

      a: do { if ((la(k) | 0) != 0 ? (g = cd(a | 0, c | 0, 52) | 0, G() | 0, g = g & 15, (g | 0) != 0) : 0) {
        e = 1;

        b: while (1) {
          i = cd(a | 0, c | 0, (15 - e | 0) * 3 | 0) | 0;
          G() | 0;

          switch (i & 7) {
            case 5:
              break b;

            case 0:
              break;

            default:
              {
                e = c;
                break a;
              }
          }

          if (e >>> 0 < g >>> 0) { e = e + 1 | 0; }else {
            e = c;
            break a;
          }
        }

        f = 1;
        e = c;

        while (1) {
          c = (15 - f | 0) * 3 | 0;
          h = dd(7, 0, c | 0) | 0;
          i = e & ~(G() | 0);
          e = cd(a | 0, e | 0, c | 0) | 0;
          G() | 0;
          e = dd(Qa(e & 7) | 0, 0, c | 0) | 0;
          a = a & ~h | e;
          e = i | (G() | 0);
          if (f >>> 0 < g >>> 0) { f = f + 1 | 0; }else { break; }
        }
      } else { e = c; } } while (0);

      i = 7728 + (k * 28 | 0) | 0;
      b[d >> 2] = b[i >> 2];
      b[d + 4 >> 2] = b[i + 4 >> 2];
      b[d + 8 >> 2] = b[i + 8 >> 2];
      b[d + 12 >> 2] = b[i + 12 >> 2];

      if (!(Tb(a, e, d) | 0)) {
        S = l;
        return;
      }

      h = d + 4 | 0;
      b[j >> 2] = b[h >> 2];
      b[j + 4 >> 2] = b[h + 4 >> 2];
      b[j + 8 >> 2] = b[h + 8 >> 2];
      g = cd(a | 0, e | 0, 52) | 0;
      G() | 0;
      i = g & 15;
      if (!(g & 1)) { g = i; }else {
        La(h);
        g = i + 1 | 0;
      }
      if (!(la(k) | 0)) { e = 0; }else {
        c: do { if (!i) { e = 0; }else {
          c = 1;

          while (1) {
            f = cd(a | 0, e | 0, (15 - c | 0) * 3 | 0) | 0;
            G() | 0;
            f = f & 7;

            if (f | 0) {
              e = f;
              break c;
            }

            if (c >>> 0 < i >>> 0) { c = c + 1 | 0; }else {
              e = 0;
              break;
            }
          }
        } } while (0);

        e = (e | 0) == 4 & 1;
      }

      if (!(cb(d, g, e, 0) | 0)) {
        if ((g | 0) != (i | 0)) {
          b[h >> 2] = b[j >> 2];
          b[h + 4 >> 2] = b[j + 4 >> 2];
          b[h + 8 >> 2] = b[j + 8 >> 2];
        }
      } else {
        if (la(k) | 0) { do {} while ((cb(d, g, 0, 0) | 0) != 0); }
        if ((g | 0) != (i | 0)) { Ja(h); }
      }

      S = l;
      return;
    }

    function Vb(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      var d = 0,
          e = 0;
      d = S;
      S = S + 16 | 0;
      e = d;
      Ub(a, b, e);
      b = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      $a(e, b & 15, c);
      S = d;
      return;
    }

    function Wb(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0;
      g = S;
      S = S + 16 | 0;
      f = g;
      Ub(a, b, f);
      d = cd(a | 0, b | 0, 45) | 0;
      G() | 0;
      d = (la(d & 127) | 0) == 0;
      e = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      e = e & 15;

      a: do { if (!d) {
        if (e | 0) {
          d = 1;

          while (1) {
            h = dd(7, 0, (15 - d | 0) * 3 | 0) | 0;
            if (!((h & a | 0) == 0 & ((G() | 0) & b | 0) == 0)) { break a; }
            if (d >>> 0 < e >>> 0) { d = d + 1 | 0; }else { break; }
          }
        }

        ab(f, e, 0, 5, c);
        S = g;
        return;
      } } while (0);

      eb(f, e, 0, 6, c);
      S = g;
      return;
    }

    function Xb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0;
      d = cd(a | 0, b | 0, 45) | 0;
      G() | 0;

      if (!(la(d & 127) | 0)) {
        d = 2;
        return d | 0;
      }

      d = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      d = d & 15;

      if (!d) {
        d = 5;
        return d | 0;
      }

      c = 1;

      while (1) {
        e = dd(7, 0, (15 - c | 0) * 3 | 0) | 0;

        if (!((e & a | 0) == 0 & ((G() | 0) & b | 0) == 0)) {
          c = 2;
          a = 6;
          break;
        }

        if (c >>> 0 < d >>> 0) { c = c + 1 | 0; }else {
          c = 5;
          a = 6;
          break;
        }
      }

      if ((a | 0) == 6) { return c | 0; }
      return 0;
    }

    function Yb(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0;
      m = S;
      S = S + 128 | 0;
      k = m + 112 | 0;
      g = m + 96 | 0;
      l = m;
      f = cd(a | 0, c | 0, 52) | 0;
      G() | 0;
      i = f & 15;
      b[k >> 2] = i;
      h = cd(a | 0, c | 0, 45) | 0;
      G() | 0;
      h = h & 127;

      a: do { if (la(h) | 0) {
        if (i | 0) {
          e = 1;

          while (1) {
            j = dd(7, 0, (15 - e | 0) * 3 | 0) | 0;

            if (!((j & a | 0) == 0 & ((G() | 0) & c | 0) == 0)) {
              f = 0;
              break a;
            }

            if (e >>> 0 < i >>> 0) { e = e + 1 | 0; }else { break; }
          }
        }

        if (!(f & 1)) {
          j = dd(i + 1 | 0, 0, 52) | 0;
          l = G() | 0 | c & -15728641;
          k = dd(7, 0, (14 - i | 0) * 3 | 0) | 0;
          Yb((j | a) & ~k, l & ~(G() | 0), d);
          S = m;
          return;
        } else { f = 1; }
      } else { f = 0; } } while (0);

      Ub(a, c, g);

      if (f) {
        bb(g, k, l);
        j = 5;
      } else {
        fb(g, k, l);
        j = 6;
      }

      b: do { if (la(h) | 0) {
        if (!i) { e = 20; }else {
          e = 1;

          while (1) {
            h = dd(7, 0, (15 - e | 0) * 3 | 0) | 0;

            if (!((h & a | 0) == 0 & ((G() | 0) & c | 0) == 0)) {
              e = 8;
              break b;
            }

            if (e >>> 0 < i >>> 0) { e = e + 1 | 0; }else {
              e = 20;
              break;
            }
          }
        }
      } else { e = 8; } } while (0);

      hd(d | 0, -1, e | 0) | 0;

      if (f) {
        f = 0;

        do {
          g = l + (f << 4) | 0;
          db(g, b[k >> 2] | 0) | 0;
          g = b[g >> 2] | 0;
          e = 0;

          while (1) {
            h = d + (e << 2) | 0;
            i = b[h >> 2] | 0;
            if ((i | 0) == -1 | (i | 0) == (g | 0)) { break; }else { e = e + 1 | 0; }
          }

          b[h >> 2] = g;
          f = f + 1 | 0;
        } while ((f | 0) != (j | 0));
      } else {
        f = 0;

        do {
          g = l + (f << 4) | 0;
          cb(g, b[k >> 2] | 0, 0, 1) | 0;
          g = b[g >> 2] | 0;
          e = 0;

          while (1) {
            h = d + (e << 2) | 0;
            i = b[h >> 2] | 0;
            if ((i | 0) == -1 | (i | 0) == (g | 0)) { break; }else { e = e + 1 | 0; }
          }

          b[h >> 2] = g;
          f = f + 1 | 0;
        } while ((f | 0) != (j | 0));
      }

      S = m;
      return;
    }

    function Zb() {
      return 12;
    }

    function _b(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0;
      dd(a | 0, 0, 52) | 0;
      i = G() | 0 | 134225919;

      if ((a | 0) < 1) {
        e = 0;
        d = 0;

        do {
          if (la(e) | 0) {
            dd(e | 0, 0, 45) | 0;
            h = i | (G() | 0);
            a = c + (d << 3) | 0;
            b[a >> 2] = -1;
            b[a + 4 >> 2] = h;
            d = d + 1 | 0;
          }

          e = e + 1 | 0;
        } while ((e | 0) != 122);

        return;
      }

      h = 0;
      d = 0;

      do {
        if (la(h) | 0) {
          dd(h | 0, 0, 45) | 0;
          e = 1;
          f = -1;
          g = i | (G() | 0);

          while (1) {
            j = dd(7, 0, (15 - e | 0) * 3 | 0) | 0;
            f = f & ~j;
            g = g & ~(G() | 0);
            if ((e | 0) == (a | 0)) { break; }else { e = e + 1 | 0; }
          }

          j = c + (d << 3) | 0;
          b[j >> 2] = f;
          b[j + 4 >> 2] = g;
          d = d + 1 | 0;
        }

        h = h + 1 | 0;
      } while ((h | 0) != 122);

      return;
    }

    function $b(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0;
      i = S;
      S = S + 64 | 0;
      h = i;

      if ((a | 0) == (d | 0) & (c | 0) == (e | 0) | (0 != 0 | (c & 2013265920 | 0) != 134217728 | (0 != 0 | (e & 2013265920 | 0) != 134217728))) {
        h = 0;
        S = i;
        return h | 0;
      }

      f = cd(a | 0, c | 0, 52) | 0;
      G() | 0;
      f = f & 15;
      g = cd(d | 0, e | 0, 52) | 0;
      G() | 0;

      if ((f | 0) != (g & 15 | 0)) {
        h = 0;
        S = i;
        return h | 0;
      }

      g = f + -1 | 0;

      if (f >>> 0 > 1 ? (k = Cb(a, c, g) | 0, j = G() | 0, g = Cb(d, e, g) | 0, (k | 0) == (g | 0) & (j | 0) == (G() | 0)) : 0) {
        g = (f ^ 15) * 3 | 0;
        f = cd(a | 0, c | 0, g | 0) | 0;
        G() | 0;
        f = f & 7;
        g = cd(d | 0, e | 0, g | 0) | 0;
        G() | 0;
        g = g & 7;

        if ((f | 0) == 0 | (g | 0) == 0) {
          k = 1;
          S = i;
          return k | 0;
        }

        if ((b[21136 + (f << 2) >> 2] | 0) == (g | 0)) {
          k = 1;
          S = i;
          return k | 0;
        }

        if ((b[21168 + (f << 2) >> 2] | 0) == (g | 0)) {
          k = 1;
          S = i;
          return k | 0;
        }
      }

      f = h;
      g = f + 56 | 0;

      do {
        b[f >> 2] = 0;
        f = f + 4 | 0;
      } while ((f | 0) < (g | 0));

      $(a, c, 1, h);
      k = h;

      if (((((!((b[k >> 2] | 0) == (d | 0) ? (b[k + 4 >> 2] | 0) == (e | 0) : 0) ? (k = h + 8 | 0, !((b[k >> 2] | 0) == (d | 0) ? (b[k + 4 >> 2] | 0) == (e | 0) : 0)) : 0) ? (k = h + 16 | 0, !((b[k >> 2] | 0) == (d | 0) ? (b[k + 4 >> 2] | 0) == (e | 0) : 0)) : 0) ? (k = h + 24 | 0, !((b[k >> 2] | 0) == (d | 0) ? (b[k + 4 >> 2] | 0) == (e | 0) : 0)) : 0) ? (k = h + 32 | 0, !((b[k >> 2] | 0) == (d | 0) ? (b[k + 4 >> 2] | 0) == (e | 0) : 0)) : 0) ? (k = h + 40 | 0, !((b[k >> 2] | 0) == (d | 0) ? (b[k + 4 >> 2] | 0) == (e | 0) : 0)) : 0) {
        f = h + 48 | 0;
        f = ((b[f >> 2] | 0) == (d | 0) ? (b[f + 4 >> 2] | 0) == (e | 0) : 0) & 1;
      } else { f = 1; }

      k = f;
      S = i;
      return k | 0;
    }

    function ac(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0;
      k = S;
      S = S + 16 | 0;
      h = k;

      if (!($b(a, c, d, e) | 0)) {
        i = 0;
        j = 0;
        F(i | 0);
        S = k;
        return j | 0;
      }

      i = c & -2130706433;
      f = (Fb(a, c) | 0) == 0;
      f = f ? 1 : 2;

      while (1) {
        b[h >> 2] = 0;
        l = da(a, c, f, h) | 0;
        g = f + 1 | 0;
        if ((l | 0) == (d | 0) & (G() | 0) == (e | 0)) { break; }
        if (g >>> 0 < 7) { f = g; }else {
          f = 0;
          a = 0;
          j = 6;
          break;
        }
      }

      if ((j | 0) == 6) {
        F(f | 0);
        S = k;
        return a | 0;
      }

      l = dd(f | 0, 0, 56) | 0;
      j = i | (G() | 0) | 268435456;
      l = a | l;
      F(j | 0);
      S = k;
      return l | 0;
    }

    function bc(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0;
      c = 0 == 0 & (b & 2013265920 | 0) == 268435456;
      F((c ? b & -2130706433 | 134217728 : 0) | 0);
      return (c ? a : 0) | 0;
    }

    function cc(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0;
      e = S;
      S = S + 16 | 0;
      d = e;

      if (!(0 == 0 & (c & 2013265920 | 0) == 268435456)) {
        c = 0;
        d = 0;
        F(c | 0);
        S = e;
        return d | 0;
      }

      f = cd(a | 0, c | 0, 56) | 0;
      G() | 0;
      b[d >> 2] = 0;
      d = da(a, c & -2130706433 | 134217728, f & 7, d) | 0;
      c = G() | 0;
      F(c | 0);
      S = e;
      return d | 0;
    }

    function dc(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0;

      if (!(0 == 0 & (b & 2013265920 | 0) == 268435456)) {
        c = 0;
        return c | 0;
      }

      c = cd(a | 0, b | 0, 56) | 0;
      G() | 0;

      switch (c & 7) {
        case 0:
        case 7:
          {
            c = 0;
            return c | 0;
          }

        default:

      }

      c = b & -2130706433 | 134217728;

      if (0 == 0 & (b & 117440512 | 0) == 16777216 & (Fb(a, c) | 0) != 0) {
        c = 0;
        return c | 0;
      }

      c = Bb(a, c) | 0;
      return c | 0;
    }

    function ec(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      g = S;
      S = S + 16 | 0;
      e = g;
      h = 0 == 0 & (c & 2013265920 | 0) == 268435456;
      f = c & -2130706433 | 134217728;
      i = d;
      b[i >> 2] = h ? a : 0;
      b[i + 4 >> 2] = h ? f : 0;

      if (h) {
        c = cd(a | 0, c | 0, 56) | 0;
        G() | 0;
        b[e >> 2] = 0;
        a = da(a, f, c & 7, e) | 0;
        c = G() | 0;
      } else {
        a = 0;
        c = 0;
      }

      i = d + 8 | 0;
      b[i >> 2] = a;
      b[i + 4 >> 2] = c;
      S = g;
      return;
    }

    function fc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0;
      f = (Fb(a, c) | 0) == 0;
      c = c & -2130706433;
      e = d;
      b[e >> 2] = f ? a : 0;
      b[e + 4 >> 2] = f ? c | 285212672 : 0;
      e = d + 8 | 0;
      b[e >> 2] = a;
      b[e + 4 >> 2] = c | 301989888;
      e = d + 16 | 0;
      b[e >> 2] = a;
      b[e + 4 >> 2] = c | 318767104;
      e = d + 24 | 0;
      b[e >> 2] = a;
      b[e + 4 >> 2] = c | 335544320;
      e = d + 32 | 0;
      b[e >> 2] = a;
      b[e + 4 >> 2] = c | 352321536;
      d = d + 40 | 0;
      b[d >> 2] = a;
      b[d + 4 >> 2] = c | 369098752;
      return;
    }

    function gc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      h = S;
      S = S + 16 | 0;
      g = h;
      e = cd(a | 0, c | 0, 56) | 0;
      G() | 0;
      i = 0 == 0 & (c & 2013265920 | 0) == 268435456;
      f = i ? a : 0;
      a = i ? c & -2130706433 | 134217728 : 0;
      c = Lc(f, a, e & 7) | 0;

      if ((c | 0) == -1) {
        b[d >> 2] = 0;
        S = h;
        return;
      }

      Ub(f, a, g);
      e = cd(f | 0, a | 0, 52) | 0;
      G() | 0;
      e = e & 15;
      if (!(Fb(f, a) | 0)) { eb(g, e, c, 2, d); }else { ab(g, e, c, 2, d); }
      S = h;
      return;
    }

    function hc(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0;
      c = Yc(1, 12) | 0;
      if (!c) { H(22691, 22646, 49, 22704); }
      d = a + 4 | 0;
      e = b[d >> 2] | 0;

      if (e | 0) {
        e = e + 8 | 0;
        b[e >> 2] = c;
        b[d >> 2] = c;
        return c | 0;
      }

      if (b[a >> 2] | 0) { H(22721, 22646, 61, 22744); }
      e = a;
      b[e >> 2] = c;
      b[d >> 2] = c;
      return c | 0;
    }

    function ic(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0;
      e = Wc(24) | 0;
      if (!e) { H(22758, 22646, 78, 22772); }
      b[e >> 2] = b[c >> 2];
      b[e + 4 >> 2] = b[c + 4 >> 2];
      b[e + 8 >> 2] = b[c + 8 >> 2];
      b[e + 12 >> 2] = b[c + 12 >> 2];
      b[e + 16 >> 2] = 0;
      c = a + 4 | 0;
      d = b[c >> 2] | 0;

      if (d | 0) {
        b[d + 16 >> 2] = e;
        b[c >> 2] = e;
        return e | 0;
      }

      if (b[a >> 2] | 0) { H(22787, 22646, 82, 22772); }
      b[a >> 2] = e;
      b[c >> 2] = e;
      return e | 0;
    }

    function jc(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0;
      if (!a) { return; }
      e = 1;

      while (1) {
        c = b[a >> 2] | 0;
        if (c | 0) { do {
          d = b[c >> 2] | 0;
          if (d | 0) { do {
            f = d;
            d = b[d + 16 >> 2] | 0;
            Xc(f);
          } while ((d | 0) != 0); }
          f = c;
          c = b[c + 8 >> 2] | 0;
          Xc(f);
        } while ((c | 0) != 0); }
        c = a;
        a = b[a + 8 >> 2] | 0;
        if (!e) { Xc(c); }
        if (!a) { break; }else { e = 0; }
      }

      return;
    }

    function kc(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          f = 0,
          g = 0,
          h = 0.0,
          i = 0,
          j = 0.0,
          k = 0.0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          r = 0,
          s = 0.0,
          t = 0.0,
          u = 0.0,
          v = 0.0,
          w = 0.0,
          x = 0.0,
          y = 0,
          z = 0,
          A = 0,
          B = 0,
          C = 0,
          D = 0,
          E = 0,
          F = 0,
          G = 0,
          I = 0,
          J = 0,
          K = 0;
      g = a + 8 | 0;

      if (b[g >> 2] | 0) {
        K = 1;
        return K | 0;
      }

      f = b[a >> 2] | 0;

      if (!f) {
        K = 0;
        return K | 0;
      }

      c = f;
      d = 0;

      do {
        d = d + 1 | 0;
        c = b[c + 8 >> 2] | 0;
      } while ((c | 0) != 0);

      if (d >>> 0 < 2) {
        K = 0;
        return K | 0;
      }

      I = Wc(d << 2) | 0;
      if (!I) { H(22807, 22646, 317, 22826); }
      G = Wc(d << 5) | 0;
      if (!G) { H(22848, 22646, 321, 22826); }
      b[a >> 2] = 0;
      z = a + 4 | 0;
      b[z >> 2] = 0;
      b[g >> 2] = 0;
      d = 0;
      F = 0;
      y = 0;
      n = 0;

      a: while (1) {
        m = b[f >> 2] | 0;

        if (m) {
          h = 0.0;
          i = m;

          do {
            k = +e[i + 8 >> 3];
            c = i;
            i = b[i + 16 >> 2] | 0;
            l = (i | 0) == 0;
            g = l ? m : i;
            j = +e[g + 8 >> 3];

            if (+q(+(k - j)) > 3.141592653589793) {
              K = 14;
              break;
            }

            h = h + (j - k) * (+e[c >> 3] + +e[g >> 3]);
          } while (!l);

          if ((K | 0) == 14) {
            K = 0;
            h = 0.0;
            c = m;

            do {
              x = +e[c + 8 >> 3];
              E = c + 16 | 0;
              D = b[E >> 2] | 0;
              D = (D | 0) == 0 ? m : D;
              w = +e[D + 8 >> 3];
              h = h + (+e[c >> 3] + +e[D >> 3]) * ((w < 0.0 ? w + 6.283185307179586 : w) - (x < 0.0 ? x + 6.283185307179586 : x));
              c = b[((c | 0) == 0 ? f : E) >> 2] | 0;
            } while ((c | 0) != 0);
          }

          if (h > 0.0) {
            b[I + (F << 2) >> 2] = f;
            F = F + 1 | 0;
            g = y;
            c = n;
          } else { K = 19; }
        } else { K = 19; }

        if ((K | 0) == 19) {
          K = 0;

          do { if (!d) {
            if (!n) {
              if (!(b[a >> 2] | 0)) {
                g = z;
                i = a;
                c = f;
                d = a;
                break;
              } else {
                K = 27;
                break a;
              }
            } else {
              g = z;
              i = n + 8 | 0;
              c = f;
              d = a;
              break;
            }
          } else {
            c = d + 8 | 0;

            if (b[c >> 2] | 0) {
              K = 21;
              break a;
            }

            d = Yc(1, 12) | 0;

            if (!d) {
              K = 23;
              break a;
            }

            b[c >> 2] = d;
            g = d + 4 | 0;
            i = d;
            c = n;
          } } while (0);

          b[i >> 2] = f;
          b[g >> 2] = f;
          i = G + (y << 5) | 0;
          l = b[f >> 2] | 0;

          if (l) {
            m = G + (y << 5) + 8 | 0;
            e[m >> 3] = 1797693134862315708145274.0e284;
            n = G + (y << 5) + 24 | 0;
            e[n >> 3] = 1797693134862315708145274.0e284;
            e[i >> 3] = -1797693134862315708145274.0e284;
            o = G + (y << 5) + 16 | 0;
            e[o >> 3] = -1797693134862315708145274.0e284;
            u = 1797693134862315708145274.0e284;
            v = -1797693134862315708145274.0e284;
            g = 0;
            p = l;
            k = 1797693134862315708145274.0e284;
            s = 1797693134862315708145274.0e284;
            t = -1797693134862315708145274.0e284;
            j = -1797693134862315708145274.0e284;

            while (1) {
              h = +e[p >> 3];
              x = +e[p + 8 >> 3];
              p = b[p + 16 >> 2] | 0;
              r = (p | 0) == 0;
              w = +e[(r ? l : p) + 8 >> 3];

              if (h < k) {
                e[m >> 3] = h;
                k = h;
              }

              if (x < s) {
                e[n >> 3] = x;
                s = x;
              }

              if (h > t) { e[i >> 3] = h; }else { h = t; }

              if (x > j) {
                e[o >> 3] = x;
                j = x;
              }

              u = x > 0.0 & x < u ? x : u;
              v = x < 0.0 & x > v ? x : v;
              g = g | +q(+(x - w)) > 3.141592653589793;
              if (r) { break; }else { t = h; }
            }

            if (g) {
              e[o >> 3] = v;
              e[n >> 3] = u;
            }
          } else {
            b[i >> 2] = 0;
            b[i + 4 >> 2] = 0;
            b[i + 8 >> 2] = 0;
            b[i + 12 >> 2] = 0;
            b[i + 16 >> 2] = 0;
            b[i + 20 >> 2] = 0;
            b[i + 24 >> 2] = 0;
            b[i + 28 >> 2] = 0;
          }

          g = y + 1 | 0;
        }

        E = f + 8 | 0;
        f = b[E >> 2] | 0;
        b[E >> 2] = 0;

        if (!f) {
          K = 45;
          break;
        } else {
          y = g;
          n = c;
        }
      }

      if ((K | 0) == 21) { H(22624, 22646, 35, 22658); }else if ((K | 0) == 23) { H(22678, 22646, 37, 22658); }else if ((K | 0) == 27) { H(22721, 22646, 61, 22744); }else if ((K | 0) == 45) {
        b: do { if ((F | 0) > 0) {
          E = (g | 0) == 0;
          C = g << 2;
          D = (a | 0) == 0;
          B = 0;
          c = 0;

          while (1) {
            A = b[I + (B << 2) >> 2] | 0;

            if (!E) {
              y = Wc(C) | 0;

              if (!y) {
                K = 50;
                break;
              }

              z = Wc(C) | 0;

              if (!z) {
                K = 52;
                break;
              }

              c: do { if (!D) {
                g = 0;
                d = 0;
                i = a;

                while (1) {
                  f = G + (g << 5) | 0;

                  if (lc(b[i >> 2] | 0, f, b[A >> 2] | 0) | 0) {
                    b[y + (d << 2) >> 2] = i;
                    b[z + (d << 2) >> 2] = f;
                    r = d + 1 | 0;
                  } else { r = d; }

                  i = b[i + 8 >> 2] | 0;
                  if (!i) { break; }else {
                    g = g + 1 | 0;
                    d = r;
                  }
                }

                if ((r | 0) > 0) {
                  f = b[y >> 2] | 0;
                  if ((r | 0) == 1) { d = f; }else {
                    o = 0;
                    p = -1;
                    d = f;
                    n = f;

                    while (1) {
                      l = b[n >> 2] | 0;
                      f = 0;
                      i = 0;

                      while (1) {
                        g = b[b[y + (i << 2) >> 2] >> 2] | 0;
                        if ((g | 0) == (l | 0)) { m = f; }else { m = f + ((lc(g, b[z + (i << 2) >> 2] | 0, b[l >> 2] | 0) | 0) & 1) | 0; }
                        i = i + 1 | 0;
                        if ((i | 0) == (r | 0)) { break; }else { f = m; }
                      }

                      g = (m | 0) > (p | 0);
                      d = g ? n : d;
                      f = o + 1 | 0;
                      if ((f | 0) == (r | 0)) { break c; }
                      o = f;
                      p = g ? m : p;
                      n = b[y + (f << 2) >> 2] | 0;
                    }
                  }
                } else { d = 0; }
              } else { d = 0; } } while (0);

              Xc(y);
              Xc(z);

              if (d) {
                g = d + 4 | 0;
                f = b[g >> 2] | 0;

                if (!f) {
                  if (b[d >> 2] | 0) {
                    K = 70;
                    break;
                  }
                } else { d = f + 8 | 0; }

                b[d >> 2] = A;
                b[g >> 2] = A;
              } else { K = 73; }
            } else { K = 73; }

            if ((K | 0) == 73) {
              K = 0;
              c = b[A >> 2] | 0;
              if (c | 0) { do {
                z = c;
                c = b[c + 16 >> 2] | 0;
                Xc(z);
              } while ((c | 0) != 0); }
              Xc(A);
              c = 2;
            }

            B = B + 1 | 0;

            if ((B | 0) >= (F | 0)) {
              J = c;
              break b;
            }
          }

          if ((K | 0) == 50) { H(22863, 22646, 249, 22882); }else if ((K | 0) == 52) { H(22901, 22646, 252, 22882); }else if ((K | 0) == 70) { H(22721, 22646, 61, 22744); }
        } else { J = 0; } } while (0);

        Xc(I);
        Xc(G);
        K = J;
        return K | 0;
      }
      return 0;
    }

    function lc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var f = 0.0,
          g = 0.0,
          h = 0.0,
          i = 0.0,
          j = 0.0,
          k = 0.0,
          l = 0.0,
          m = 0;

      if (!(xa(c, d) | 0)) {
        a = 0;
        return a | 0;
      }

      c = wa(c) | 0;
      l = +e[d >> 3];
      f = +e[d + 8 >> 3];
      f = c & f < 0.0 ? f + 6.283185307179586 : f;
      a = b[a >> 2] | 0;

      if (!a) {
        a = 0;
        return a | 0;
      }

      if (c) {
        c = 0;
        d = a;

        a: while (1) {
          while (1) {
            i = +e[d >> 3];
            k = +e[d + 8 >> 3];
            d = d + 16 | 0;
            m = b[d >> 2] | 0;
            m = (m | 0) == 0 ? a : m;
            h = +e[m >> 3];
            g = +e[m + 8 >> 3];

            if (i > h) {
              j = i;
              i = k;
            } else {
              j = h;
              h = i;
              i = g;
              g = k;
            }

            if (!(l < h | l > j)) { break; }
            d = b[d >> 2] | 0;

            if (!d) {
              d = 22;
              break a;
            }
          }

          k = g < 0.0 ? g + 6.283185307179586 : g;
          i = i < 0.0 ? i + 6.283185307179586 : i;
          f = i == f | k == f ? f + -2.220446049250313e-16 : f;
          k = k + (l - h) / (j - h) * (i - k);
          if ((k < 0.0 ? k + 6.283185307179586 : k) > f) { c = c ^ 1; }
          d = b[d >> 2] | 0;

          if (!d) {
            d = 22;
            break;
          }
        }

        if ((d | 0) == 22) { return c | 0; }
      } else {
        c = 0;
        d = a;

        b: while (1) {
          while (1) {
            i = +e[d >> 3];
            k = +e[d + 8 >> 3];
            d = d + 16 | 0;
            m = b[d >> 2] | 0;
            m = (m | 0) == 0 ? a : m;
            h = +e[m >> 3];
            g = +e[m + 8 >> 3];

            if (i > h) {
              j = i;
              i = k;
            } else {
              j = h;
              h = i;
              i = g;
              g = k;
            }

            if (!(l < h | l > j)) { break; }
            d = b[d >> 2] | 0;

            if (!d) {
              d = 22;
              break b;
            }
          }

          f = i == f | g == f ? f + -2.220446049250313e-16 : f;
          if (g + (l - h) / (j - h) * (i - g) > f) { c = c ^ 1; }
          d = b[d >> 2] | 0;

          if (!d) {
            d = 22;
            break;
          }
        }

        if ((d | 0) == 22) { return c | 0; }
      }

      return 0;
    }

    function mc(c, d, e, f, g) {
      c = c | 0;
      d = d | 0;
      e = e | 0;
      f = f | 0;
      g = g | 0;
      var h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0,
          s = 0,
          t = 0,
          u = 0;
      u = S;
      S = S + 32 | 0;
      t = u + 16 | 0;
      s = u;
      h = cd(c | 0, d | 0, 52) | 0;
      G() | 0;
      h = h & 15;
      p = cd(e | 0, f | 0, 52) | 0;
      G() | 0;

      if ((h | 0) != (p & 15 | 0)) {
        t = 1;
        S = u;
        return t | 0;
      }

      l = cd(c | 0, d | 0, 45) | 0;
      G() | 0;
      l = l & 127;
      m = cd(e | 0, f | 0, 45) | 0;
      G() | 0;
      m = m & 127;
      p = (l | 0) != (m | 0);

      if (p) {
        j = ta(l, m) | 0;

        if ((j | 0) == 7) {
          t = 2;
          S = u;
          return t | 0;
        }

        k = ta(m, l) | 0;
        if ((k | 0) == 7) { H(22925, 22949, 151, 22959); }else {
          q = j;
          i = k;
        }
      } else {
        q = 0;
        i = 0;
      }

      n = la(l) | 0;
      o = la(m) | 0;
      b[t >> 2] = 0;
      b[t + 4 >> 2] = 0;
      b[t + 8 >> 2] = 0;
      b[t + 12 >> 2] = 0;

      do { if (!q) {
        Tb(e, f, t) | 0;

        if ((n | 0) != 0 & (o | 0) != 0) {
          if ((m | 0) != (l | 0)) { H(23077, 22949, 243, 22959); }
          i = Lb(c, d) | 0;
          h = Lb(e, f) | 0;

          if (!(a[22032 + (i * 7 | 0) + h >> 0] | 0)) {
            i = b[21200 + (i * 28 | 0) + (h << 2) >> 2] | 0;

            if ((i | 0) > 0) {
              j = t + 4 | 0;
              h = 0;

              do {
                Oa(j);
                h = h + 1 | 0;
              } while ((h | 0) != (i | 0));

              r = 50;
            } else { r = 50; }
          } else { h = 5; }
        } else { r = 50; }
      } else {
        m = b[4304 + (l * 28 | 0) + (q << 2) >> 2] | 0;
        j = (m | 0) > 0;
        if (!o) {
          if (j) {
            l = 0;
            k = e;
            j = f;

            do {
              k = Pb(k, j) | 0;
              j = G() | 0;
              i = Qa(i) | 0;
              l = l + 1 | 0;
            } while ((l | 0) != (m | 0));

            m = i;
            l = k;
            k = j;
          } else {
            m = i;
            l = e;
            k = f;
          }
        } else if (j) {
          l = 0;
          k = e;
          j = f;

          do {
            k = Ob(k, j) | 0;
            j = G() | 0;
            i = Qa(i) | 0;
            if ((i | 0) == 1) { i = Qa(1) | 0; }
            l = l + 1 | 0;
          } while ((l | 0) != (m | 0));

          m = i;
          l = k;
          k = j;
        } else {
          m = i;
          l = e;
          k = f;
        }
        Tb(l, k, t) | 0;
        if (!p) { H(22972, 22949, 181, 22959); }
        j = (n | 0) != 0;
        i = (o | 0) != 0;
        if (j & i) { H(22999, 22949, 182, 22959); }
        if (!j) {
          if (i) {
            i = Lb(l, k) | 0;

            if (a[22032 + (i * 7 | 0) + m >> 0] | 0) {
              h = 4;
              break;
            }

            l = 0;
            k = b[21200 + (m * 28 | 0) + (i << 2) >> 2] | 0;
            r = 26;
          } else { i = 0; }
        } else {
          i = Lb(c, d) | 0;

          if (a[22032 + (i * 7 | 0) + q >> 0] | 0) {
            h = 3;
            break;
          }

          k = b[21200 + (i * 28 | 0) + (q << 2) >> 2] | 0;
          l = k;
          r = 26;
        }

        if ((r | 0) == 26) {
          if ((k | 0) <= -1) { H(23030, 22949, 212, 22959); }
          if ((l | 0) <= -1) { H(23053, 22949, 213, 22959); }

          if ((k | 0) > 0) {
            j = t + 4 | 0;
            i = 0;

            do {
              Oa(j);
              i = i + 1 | 0;
            } while ((i | 0) != (k | 0));

            i = l;
          } else { i = l; }
        }
        b[s >> 2] = 0;
        b[s + 4 >> 2] = 0;
        b[s + 8 >> 2] = 0;
        Ma(s, q);
        if (h | 0) { while (1) {
          if (!(Rb(h) | 0)) { La(s); }else { Ka(s); }
          if ((h | 0) > 1) { h = h + -1 | 0; }else { break; }
        } }

        if ((i | 0) > 0) {
          h = 0;

          do {
            Oa(s);
            h = h + 1 | 0;
          } while ((h | 0) != (i | 0));
        }

        r = t + 4 | 0;
        Ea(r, s, r);
        Ca(r);
        r = 50;
      } } while (0);

      if ((r | 0) == 50) {
        h = t + 4 | 0;
        b[g >> 2] = b[h >> 2];
        b[g + 4 >> 2] = b[h + 4 >> 2];
        b[g + 8 >> 2] = b[h + 8 >> 2];
        h = 0;
      }

      t = h;
      S = u;
      return t | 0;
    }

    function nc(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0,
          s = 0,
          t = 0;
      p = S;
      S = S + 48 | 0;
      h = p + 36 | 0;
      i = p + 24 | 0;
      j = p + 12 | 0;
      k = p;
      g = cd(a | 0, c | 0, 52) | 0;
      G() | 0;
      g = g & 15;
      n = cd(a | 0, c | 0, 45) | 0;
      G() | 0;
      n = n & 127;
      l = la(n) | 0;
      dd(g | 0, 0, 52) | 0;
      r = G() | 0 | 134225919;
      q = e;
      b[q >> 2] = -1;
      b[q + 4 >> 2] = r;

      if (!g) {
        if ((b[d >> 2] | 0) > 1) {
          r = 1;
          S = p;
          return r | 0;
        }

        if ((b[d + 4 >> 2] | 0) > 1) {
          r = 1;
          S = p;
          return r | 0;
        }

        if ((b[d + 8 >> 2] | 0) > 1) {
          r = 1;
          S = p;
          return r | 0;
        }

        f = sa(n, Ha(d) | 0) | 0;

        if ((f | 0) == 127) {
          r = 1;
          S = p;
          return r | 0;
        }

        o = dd(f | 0, 0, 45) | 0;
        q = G() | 0;
        n = e;
        q = b[n + 4 >> 2] & -1040385 | q;
        r = e;
        b[r >> 2] = b[n >> 2] | o;
        b[r + 4 >> 2] = q;
        r = 0;
        S = p;
        return r | 0;
      }
      b[h >> 2] = b[d >> 2];
      b[h + 4 >> 2] = b[d + 4 >> 2];
      b[h + 8 >> 2] = b[d + 8 >> 2];

      while (1) {
        b[i >> 2] = b[h >> 2];
        b[i + 4 >> 2] = b[h + 4 >> 2];
        b[i + 8 >> 2] = b[h + 8 >> 2];

        if (!(Rb(g) | 0)) {
          Ja(h);
          b[j >> 2] = b[h >> 2];
          b[j + 4 >> 2] = b[h + 4 >> 2];
          b[j + 8 >> 2] = b[h + 8 >> 2];
          La(j);
        } else {
          Ia(h);
          b[j >> 2] = b[h >> 2];
          b[j + 4 >> 2] = b[h + 4 >> 2];
          b[j + 8 >> 2] = b[h + 8 >> 2];
          Ka(j);
        }

        Fa(i, j, k);
        Ca(k);
        q = e;
        s = b[q >> 2] | 0;
        q = b[q + 4 >> 2] | 0;
        t = (15 - g | 0) * 3 | 0;
        d = dd(7, 0, t | 0) | 0;
        q = q & ~(G() | 0);
        t = dd(Ha(k) | 0, 0, t | 0) | 0;
        q = G() | 0 | q;
        r = e;
        b[r >> 2] = t | s & ~d;
        b[r + 4 >> 2] = q;
        if ((g | 0) > 1) { g = g + -1 | 0; }else { break; }
      }

      a: do { if (((b[h >> 2] | 0) <= 1 ? (b[h + 4 >> 2] | 0) <= 1 : 0) ? (b[h + 8 >> 2] | 0) <= 1 : 0) {
        g = Ha(h) | 0;
        i = sa(n, g) | 0;
        if ((i | 0) == 127) { k = 0; }else { k = la(i) | 0; }

        b: do { if (!g) {
          if ((l | 0) != 0 & (k | 0) != 0) {
            t = Lb(a, c) | 0;
            g = e;
            g = 21408 + (t * 28 | 0) + ((Lb(b[g >> 2] | 0, b[g + 4 >> 2] | 0) | 0) << 2) | 0;
            g = b[g >> 2] | 0;
            if ((g | 0) <= -1) { H(23201, 22949, 433, 23134); }

            if (!g) {
              f = i;
              g = 55;
            } else {
              h = e;
              f = 0;
              d = b[h >> 2] | 0;
              h = b[h + 4 >> 2] | 0;

              do {
                d = Nb(d, h) | 0;
                h = G() | 0;
                t = e;
                b[t >> 2] = d;
                b[t + 4 >> 2] = h;
                f = f + 1 | 0;
              } while ((f | 0) < (g | 0));

              f = i;
              g = 54;
            }
          } else {
            f = i;
            g = 54;
          }
        } else {
          if (l) {
            h = 21408 + ((Lb(a, c) | 0) * 28 | 0) + (g << 2) | 0;
            h = b[h >> 2] | 0;

            if ((h | 0) > 0) {
              d = 0;

              do {
                g = Pa(g) | 0;
                d = d + 1 | 0;
              } while ((d | 0) != (h | 0));
            }

            if ((g | 0) == 1) {
              f = 3;
              break a;
            }

            d = sa(n, g) | 0;
            if ((d | 0) == 127) { H(23104, 22949, 376, 23134); }

            if (!(la(d) | 0)) {
              o = h;
              m = g;
              f = d;
            } else { H(23147, 22949, 377, 23134); }
          } else {
            o = 0;
            m = g;
            f = i;
          }

          j = b[4304 + (n * 28 | 0) + (m << 2) >> 2] | 0;
          if ((j | 0) <= -1) { H(23178, 22949, 384, 23134); }

          if (!k) {
            if ((o | 0) <= -1) { H(23030, 22949, 417, 23134); }

            if (o | 0) {
              h = e;
              g = 0;
              d = b[h >> 2] | 0;
              h = b[h + 4 >> 2] | 0;

              do {
                d = Nb(d, h) | 0;
                h = G() | 0;
                t = e;
                b[t >> 2] = d;
                b[t + 4 >> 2] = h;
                g = g + 1 | 0;
              } while ((g | 0) < (o | 0));
            }

            if ((j | 0) <= 0) {
              g = 54;
              break;
            }

            h = e;
            g = 0;
            d = b[h >> 2] | 0;
            h = b[h + 4 >> 2] | 0;

            while (1) {
              d = Nb(d, h) | 0;
              h = G() | 0;
              t = e;
              b[t >> 2] = d;
              b[t + 4 >> 2] = h;
              g = g + 1 | 0;

              if ((g | 0) == (j | 0)) {
                g = 54;
                break b;
              }
            }
          }

          i = ta(f, n) | 0;
          if ((i | 0) == 7) { H(22925, 22949, 393, 23134); }
          g = e;
          d = b[g >> 2] | 0;
          g = b[g + 4 >> 2] | 0;

          if ((j | 0) > 0) {
            h = 0;

            do {
              d = Nb(d, g) | 0;
              g = G() | 0;
              t = e;
              b[t >> 2] = d;
              b[t + 4 >> 2] = g;
              h = h + 1 | 0;
            } while ((h | 0) != (j | 0));
          }

          d = Lb(d, g) | 0;
          t = ma(f) | 0;
          d = b[(t ? 21824 : 21616) + (i * 28 | 0) + (d << 2) >> 2] | 0;
          if ((d | 0) <= -1) { H(23030, 22949, 412, 23134); }
          if (!d) { g = 54; }else {
            i = e;
            g = 0;
            h = b[i >> 2] | 0;
            i = b[i + 4 >> 2] | 0;

            do {
              h = Mb(h, i) | 0;
              i = G() | 0;
              t = e;
              b[t >> 2] = h;
              b[t + 4 >> 2] = i;
              g = g + 1 | 0;
            } while ((g | 0) < (d | 0));

            g = 54;
          }
        } } while (0);

        if ((g | 0) == 54) { if (k) { g = 55; } }

        if ((g | 0) == 55) {
          t = e;

          if ((Lb(b[t >> 2] | 0, b[t + 4 >> 2] | 0) | 0) == 1) {
            f = 4;
            break;
          }
        }

        t = e;
        r = b[t >> 2] | 0;
        t = b[t + 4 >> 2] & -1040385;
        s = dd(f | 0, 0, 45) | 0;
        t = t | (G() | 0);
        f = e;
        b[f >> 2] = r | s;
        b[f + 4 >> 2] = t;
        f = 0;
      } else { f = 2; } } while (0);

      t = f;
      S = p;
      return t | 0;
    }

    function oc(a, b, c, d, e) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0;
      g = S;
      S = S + 16 | 0;
      f = g;
      a = mc(a, b, c, d, f) | 0;

      if (!a) {
        Ua(f, e);
        a = 0;
      }

      S = g;
      return a | 0;
    }

    function pc(a, b, c, d) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0;
      e = S;
      S = S + 16 | 0;
      f = e;
      Va(c, f);
      d = nc(a, b, f, d) | 0;
      S = e;
      return d | 0;
    }

    function qc(a, b, c, d) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0;
      g = S;
      S = S + 32 | 0;
      e = g + 12 | 0;
      f = g;
      if ((mc(a, b, a, b, e) | 0) == 0 ? (mc(a, b, c, d, f) | 0) == 0 : 0) { a = Ta(e, f) | 0; }else { a = -1; }
      S = g;
      return a | 0;
    }

    function rc(a, b, c, d) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0;
      g = S;
      S = S + 32 | 0;
      e = g + 12 | 0;
      f = g;
      if ((mc(a, b, a, b, e) | 0) == 0 ? (mc(a, b, c, d, f) | 0) == 0 : 0) { a = Ta(e, f) | 0; }else { a = -1; }
      S = g;
      return (a >>> 31 ^ 1) + a | 0;
    }

    function sc(a, c, d, e, f) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      f = f | 0;
      var g = 0,
          h = 0,
          i = 0.0,
          j = 0.0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0.0,
          p = 0.0,
          r = 0.0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0,
          x = 0,
          y = 0.0;
      x = S;
      S = S + 48 | 0;
      g = x + 24 | 0;
      h = x + 12 | 0;
      w = x;

      if ((mc(a, c, a, c, g) | 0) == 0 ? (mc(a, c, d, e, h) | 0) == 0 : 0) {
        v = Ta(g, h) | 0;

        if ((v | 0) < 0) {
          w = v;
          S = x;
          return w | 0;
        }
        b[g >> 2] = 0;
        b[g + 4 >> 2] = 0;
        b[g + 8 >> 2] = 0;
        b[h >> 2] = 0;
        b[h + 4 >> 2] = 0;
        b[h + 8 >> 2] = 0;
        mc(a, c, a, c, g) | 0;
        mc(a, c, d, e, h) | 0;
        Wa(g);
        Wa(h);

        if (!v) {
          e = g + 4 | 0;
          n = g + 8 | 0;
          s = e;
          t = n;
          u = g;
          d = b[g >> 2] | 0;
          e = b[e >> 2] | 0;
          g = b[n >> 2] | 0;
          p = 0.0;
          r = 0.0;
          o = 0.0;
        } else {
          l = b[g >> 2] | 0;
          o = +(v | 0);
          s = g + 4 | 0;
          m = b[s >> 2] | 0;
          t = g + 8 | 0;
          n = b[t >> 2] | 0;
          u = g;
          d = l;
          e = m;
          g = n;
          p = +((b[h >> 2] | 0) - l | 0) / o;
          r = +((b[h + 4 >> 2] | 0) - m | 0) / o;
          o = +((b[h + 8 >> 2] | 0) - n | 0) / o;
        }

        b[w >> 2] = d;
        n = w + 4 | 0;
        b[n >> 2] = e;
        m = w + 8 | 0;
        b[m >> 2] = g;
        l = 0;

        while (1) {
          j = +(l | 0);
          y = p * j + +(d | 0);
          i = r * j + +(b[s >> 2] | 0);
          j = o * j + +(b[t >> 2] | 0);
          e = ~~+fd(+y);
          h = ~~+fd(+i);
          d = ~~+fd(+j);
          y = +q(+(+(e | 0) - y));
          i = +q(+(+(h | 0) - i));
          j = +q(+(+(d | 0) - j));

          do { if (!(y > i & y > j)) {
            k = 0 - e | 0;

            if (i > j) {
              g = k - d | 0;
              break;
            } else {
              g = h;
              d = k - h | 0;
              break;
            }
          } else {
            e = 0 - (h + d) | 0;
            g = h;
          } } while (0);

          b[w >> 2] = e;
          b[n >> 2] = g;
          b[m >> 2] = d;
          Xa(w);
          nc(a, c, w, f + (l << 3) | 0) | 0;
          if ((l | 0) == (v | 0)) { break; }
          l = l + 1 | 0;
          d = b[u >> 2] | 0;
        }

        w = 0;
        S = x;
        return w | 0;
      }

      w = -1;
      S = x;
      return w | 0;
    }

    function tc(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0;

      if (!b) {
        c = 1;
        return c | 0;
      }

      c = a;
      a = 1;

      do {
        a = B((b & 1 | 0) == 0 ? 1 : c, a) | 0;
        b = b >> 1;
        c = B(c, c) | 0;
      } while ((b | 0) != 0);

      return a | 0;
    }

    function uc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var f = 0.0,
          g = 0.0,
          h = 0.0,
          i = 0.0,
          j = 0.0,
          k = 0.0,
          l = 0,
          m = 0,
          n = 0,
          o = 0.0;

      if (!(xa(c, d) | 0)) {
        n = 0;
        return n | 0;
      }

      c = wa(c) | 0;
      o = +e[d >> 3];
      f = +e[d + 8 >> 3];
      f = c & f < 0.0 ? f + 6.283185307179586 : f;
      n = b[a >> 2] | 0;

      if ((n | 0) <= 0) {
        n = 0;
        return n | 0;
      }

      m = b[a + 4 >> 2] | 0;

      if (c) {
        c = 0;
        d = -1;
        a = 0;

        a: while (1) {
          l = a;

          while (1) {
            i = +e[m + (l << 4) >> 3];
            k = +e[m + (l << 4) + 8 >> 3];
            a = (d + 2 | 0) % (n | 0) | 0;
            h = +e[m + (a << 4) >> 3];
            g = +e[m + (a << 4) + 8 >> 3];

            if (i > h) {
              j = i;
              i = k;
            } else {
              j = h;
              h = i;
              i = g;
              g = k;
            }

            if (!(o < h | o > j)) { break; }
            d = l + 1 | 0;

            if ((d | 0) < (n | 0)) {
              a = l;
              l = d;
              d = a;
            } else {
              d = 22;
              break a;
            }
          }

          k = g < 0.0 ? g + 6.283185307179586 : g;
          i = i < 0.0 ? i + 6.283185307179586 : i;
          f = i == f | k == f ? f + -2.220446049250313e-16 : f;
          k = k + (o - h) / (j - h) * (i - k);
          if ((k < 0.0 ? k + 6.283185307179586 : k) > f) { c = c ^ 1; }
          a = l + 1 | 0;

          if ((a | 0) >= (n | 0)) {
            d = 22;
            break;
          } else { d = l; }
        }

        if ((d | 0) == 22) { return c | 0; }
      } else {
        c = 0;
        d = -1;
        a = 0;

        b: while (1) {
          l = a;

          while (1) {
            i = +e[m + (l << 4) >> 3];
            k = +e[m + (l << 4) + 8 >> 3];
            a = (d + 2 | 0) % (n | 0) | 0;
            h = +e[m + (a << 4) >> 3];
            g = +e[m + (a << 4) + 8 >> 3];

            if (i > h) {
              j = i;
              i = k;
            } else {
              j = h;
              h = i;
              i = g;
              g = k;
            }

            if (!(o < h | o > j)) { break; }
            d = l + 1 | 0;

            if ((d | 0) < (n | 0)) {
              a = l;
              l = d;
              d = a;
            } else {
              d = 22;
              break b;
            }
          }

          f = i == f | g == f ? f + -2.220446049250313e-16 : f;
          if (g + (o - h) / (j - h) * (i - g) > f) { c = c ^ 1; }
          a = l + 1 | 0;

          if ((a | 0) >= (n | 0)) {
            d = 22;
            break;
          } else { d = l; }
        }

        if ((d | 0) == 22) { return c | 0; }
      }

      return 0;
    }

    function vc(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          f = 0.0,
          g = 0.0,
          h = 0.0,
          i = 0.0,
          j = 0.0,
          k = 0.0,
          l = 0.0,
          m = 0.0,
          n = 0,
          o = 0,
          p = 0,
          r = 0,
          s = 0,
          t = 0,
          u = 0,
          v = 0;
      r = b[a >> 2] | 0;

      if (!r) {
        b[c >> 2] = 0;
        b[c + 4 >> 2] = 0;
        b[c + 8 >> 2] = 0;
        b[c + 12 >> 2] = 0;
        b[c + 16 >> 2] = 0;
        b[c + 20 >> 2] = 0;
        b[c + 24 >> 2] = 0;
        b[c + 28 >> 2] = 0;
        return;
      }

      s = c + 8 | 0;
      e[s >> 3] = 1797693134862315708145274.0e284;
      t = c + 24 | 0;
      e[t >> 3] = 1797693134862315708145274.0e284;
      e[c >> 3] = -1797693134862315708145274.0e284;
      u = c + 16 | 0;
      e[u >> 3] = -1797693134862315708145274.0e284;
      if ((r | 0) <= 0) { return; }
      o = b[a + 4 >> 2] | 0;
      l = 1797693134862315708145274.0e284;
      m = -1797693134862315708145274.0e284;
      n = 0;
      a = -1;
      h = 1797693134862315708145274.0e284;
      i = 1797693134862315708145274.0e284;
      k = -1797693134862315708145274.0e284;
      f = -1797693134862315708145274.0e284;
      p = 0;

      while (1) {
        d = +e[o + (p << 4) >> 3];
        j = +e[o + (p << 4) + 8 >> 3];
        a = a + 2 | 0;
        g = +e[o + (((a | 0) == (r | 0) ? 0 : a) << 4) + 8 >> 3];

        if (d < h) {
          e[s >> 3] = d;
          h = d;
        }

        if (j < i) {
          e[t >> 3] = j;
          i = j;
        }

        if (d > k) { e[c >> 3] = d; }else { d = k; }

        if (j > f) {
          e[u >> 3] = j;
          f = j;
        }

        l = j > 0.0 & j < l ? j : l;
        m = j < 0.0 & j > m ? j : m;
        n = n | +q(+(j - g)) > 3.141592653589793;
        a = p + 1 | 0;
        if ((a | 0) == (r | 0)) { break; }else {
          v = p;
          k = d;
          p = a;
          a = v;
        }
      }

      if (!n) { return; }
      e[u >> 3] = m;
      e[t >> 3] = l;
      return;
    }

    function wc(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          f = 0,
          g = 0,
          h = 0.0,
          i = 0.0,
          j = 0.0,
          k = 0.0,
          l = 0.0,
          m = 0.0,
          n = 0.0,
          o = 0.0,
          p = 0.0,
          r = 0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0,
          x = 0,
          y = 0,
          z = 0,
          A = 0;
      r = b[a >> 2] | 0;

      if (r) {
        s = c + 8 | 0;
        e[s >> 3] = 1797693134862315708145274.0e284;
        t = c + 24 | 0;
        e[t >> 3] = 1797693134862315708145274.0e284;
        e[c >> 3] = -1797693134862315708145274.0e284;
        u = c + 16 | 0;
        e[u >> 3] = -1797693134862315708145274.0e284;

        if ((r | 0) > 0) {
          g = b[a + 4 >> 2] | 0;
          o = 1797693134862315708145274.0e284;
          p = -1797693134862315708145274.0e284;
          f = 0;
          d = -1;
          k = 1797693134862315708145274.0e284;
          l = 1797693134862315708145274.0e284;
          n = -1797693134862315708145274.0e284;
          i = -1797693134862315708145274.0e284;
          v = 0;

          while (1) {
            h = +e[g + (v << 4) >> 3];
            m = +e[g + (v << 4) + 8 >> 3];
            z = d + 2 | 0;
            j = +e[g + (((z | 0) == (r | 0) ? 0 : z) << 4) + 8 >> 3];

            if (h < k) {
              e[s >> 3] = h;
              k = h;
            }

            if (m < l) {
              e[t >> 3] = m;
              l = m;
            }

            if (h > n) { e[c >> 3] = h; }else { h = n; }

            if (m > i) {
              e[u >> 3] = m;
              i = m;
            }

            o = m > 0.0 & m < o ? m : o;
            p = m < 0.0 & m > p ? m : p;
            f = f | +q(+(m - j)) > 3.141592653589793;
            d = v + 1 | 0;
            if ((d | 0) == (r | 0)) { break; }else {
              z = v;
              n = h;
              v = d;
              d = z;
            }
          }

          if (f) {
            e[u >> 3] = p;
            e[t >> 3] = o;
          }
        }
      } else {
        b[c >> 2] = 0;
        b[c + 4 >> 2] = 0;
        b[c + 8 >> 2] = 0;
        b[c + 12 >> 2] = 0;
        b[c + 16 >> 2] = 0;
        b[c + 20 >> 2] = 0;
        b[c + 24 >> 2] = 0;
        b[c + 28 >> 2] = 0;
      }

      z = a + 8 | 0;
      d = b[z >> 2] | 0;
      if ((d | 0) <= 0) { return; }
      y = a + 12 | 0;
      x = 0;

      do {
        g = b[y >> 2] | 0;
        f = x;
        x = x + 1 | 0;
        t = c + (x << 5) | 0;
        u = b[g + (f << 3) >> 2] | 0;

        if (u) {
          v = c + (x << 5) + 8 | 0;
          e[v >> 3] = 1797693134862315708145274.0e284;
          a = c + (x << 5) + 24 | 0;
          e[a >> 3] = 1797693134862315708145274.0e284;
          e[t >> 3] = -1797693134862315708145274.0e284;
          w = c + (x << 5) + 16 | 0;
          e[w >> 3] = -1797693134862315708145274.0e284;

          if ((u | 0) > 0) {
            r = b[g + (f << 3) + 4 >> 2] | 0;
            o = 1797693134862315708145274.0e284;
            p = -1797693134862315708145274.0e284;
            g = 0;
            f = -1;
            s = 0;
            k = 1797693134862315708145274.0e284;
            l = 1797693134862315708145274.0e284;
            m = -1797693134862315708145274.0e284;
            i = -1797693134862315708145274.0e284;

            while (1) {
              h = +e[r + (s << 4) >> 3];
              n = +e[r + (s << 4) + 8 >> 3];
              f = f + 2 | 0;
              j = +e[r + (((f | 0) == (u | 0) ? 0 : f) << 4) + 8 >> 3];

              if (h < k) {
                e[v >> 3] = h;
                k = h;
              }

              if (n < l) {
                e[a >> 3] = n;
                l = n;
              }

              if (h > m) { e[t >> 3] = h; }else { h = m; }

              if (n > i) {
                e[w >> 3] = n;
                i = n;
              }

              o = n > 0.0 & n < o ? n : o;
              p = n < 0.0 & n > p ? n : p;
              g = g | +q(+(n - j)) > 3.141592653589793;
              f = s + 1 | 0;
              if ((f | 0) == (u | 0)) { break; }else {
                A = s;
                s = f;
                m = h;
                f = A;
              }
            }

            if (g) {
              e[w >> 3] = p;
              e[a >> 3] = o;
            }
          }
        } else {
          b[t >> 2] = 0;
          b[t + 4 >> 2] = 0;
          b[t + 8 >> 2] = 0;
          b[t + 12 >> 2] = 0;
          b[t + 16 >> 2] = 0;
          b[t + 20 >> 2] = 0;
          b[t + 24 >> 2] = 0;
          b[t + 28 >> 2] = 0;
          d = b[z >> 2] | 0;
        }
      } while ((x | 0) < (d | 0));

      return;
    }

    function xc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0;

      if (!(uc(a, c, d) | 0)) {
        f = 0;
        return f | 0;
      }

      f = a + 8 | 0;

      if ((b[f >> 2] | 0) <= 0) {
        f = 1;
        return f | 0;
      }

      e = a + 12 | 0;
      a = 0;

      while (1) {
        g = a;
        a = a + 1 | 0;

        if (uc((b[e >> 2] | 0) + (g << 3) | 0, c + (a << 5) | 0, d) | 0) {
          a = 0;
          e = 6;
          break;
        }

        if ((a | 0) >= (b[f >> 2] | 0)) {
          a = 1;
          e = 6;
          break;
        }
      }

      if ((e | 0) == 6) { return a | 0; }
      return 0;
    }

    function yc() {
      return 8;
    }

    function zc() {
      return 16;
    }

    function Ac() {
      return 168;
    }

    function Bc() {
      return 8;
    }

    function Cc() {
      return 16;
    }

    function Dc() {
      return 12;
    }

    function Ec() {
      return 8;
    }

    function Fc(a) {
      a = a | 0;
      var b = 0.0,
          c = 0.0;
      c = +e[a >> 3];
      b = +e[a + 8 >> 3];
      return + +r(+(c * c + b * b));
    }

    function Gc(a, b, c, d, f) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      f = f | 0;
      var g = 0.0,
          h = 0.0,
          i = 0.0,
          j = 0.0,
          k = 0.0,
          l = 0.0,
          m = 0.0,
          n = 0.0;
      k = +e[a >> 3];
      j = +e[b >> 3] - k;
      i = +e[a + 8 >> 3];
      h = +e[b + 8 >> 3] - i;
      m = +e[c >> 3];
      g = +e[d >> 3] - m;
      n = +e[c + 8 >> 3];
      l = +e[d + 8 >> 3] - n;
      g = (g * (i - n) - (k - m) * l) / (j * l - h * g);
      e[f >> 3] = k + j * g;
      e[f + 8 >> 3] = i + h * g;
      return;
    }

    function Hc(a, b) {
      a = a | 0;
      b = b | 0;

      if (!(+e[a >> 3] == +e[b >> 3])) {
        b = 0;
        return b | 0;
      }

      b = +e[a + 8 >> 3] == +e[b + 8 >> 3];
      return b | 0;
    }

    function Ic(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0.0,
          d = 0.0,
          f = 0.0;
      f = +e[a >> 3] - +e[b >> 3];
      d = +e[a + 8 >> 3] - +e[b + 8 >> 3];
      c = +e[a + 16 >> 3] - +e[b + 16 >> 3];
      return +(f * f + d * d + c * c);
    }

    function Jc(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0.0,
          d = 0.0,
          f = 0.0;
      c = +e[a >> 3];
      d = +t(+c);
      c = +u(+c);
      e[b + 16 >> 3] = c;
      c = +e[a + 8 >> 3];
      f = d * +t(+c);
      e[b >> 3] = f;
      c = d * +u(+c);
      e[b + 8 >> 3] = c;
      return;
    }

    function Kc(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0;
      k = S;
      S = S + 32 | 0;
      f = k + 16 | 0;
      g = k;
      Ub(a, c, f);
      h = Ab(a, c) | 0;
      j = Lb(a, c) | 0;
      pa(h, g);
      c = qa(h, b[f >> 2] | 0) | 0;

      if (!(la(h) | 0)) {
        j = c;
        S = k;
        return j | 0;
      }

      do { switch (h | 0) {
        case 4:
          {
            a = 0;
            d = 14;
            break;
          }

        case 14:
          {
            a = 1;
            d = 14;
            break;
          }

        case 24:
          {
            a = 2;
            d = 14;
            break;
          }

        case 38:
          {
            a = 3;
            d = 14;
            break;
          }

        case 49:
          {
            a = 4;
            d = 14;
            break;
          }

        case 58:
          {
            a = 5;
            d = 14;
            break;
          }

        case 63:
          {
            a = 6;
            d = 14;
            break;
          }

        case 72:
          {
            a = 7;
            d = 14;
            break;
          }

        case 83:
          {
            a = 8;
            d = 14;
            break;
          }

        case 97:
          {
            a = 9;
            d = 14;
            break;
          }

        case 107:
          {
            a = 10;
            d = 14;
            break;
          }

        case 117:
          {
            a = 11;
            d = 14;
            break;
          }

        default:
          {
            i = 0;
            e = 0;
          }
      } } while (0);

      if ((d | 0) == 14) {
        i = b[22096 + (a * 24 | 0) + 8 >> 2] | 0;
        e = b[22096 + (a * 24 | 0) + 16 >> 2] | 0;
      }

      a = b[f >> 2] | 0;

      if ((a | 0) != (b[g >> 2] | 0)) {
        h = ma(h) | 0;
        a = b[f >> 2] | 0;
        if (h | (a | 0) == (e | 0)) { c = (c + 1 | 0) % 6 | 0; }
      }

      if ((j | 0) == 3 & (a | 0) == (e | 0)) {
        j = (c + 5 | 0) % 6 | 0;
        S = k;
        return j | 0;
      }

      if (!((j | 0) == 5 & (a | 0) == (i | 0))) {
        j = c;
        S = k;
        return j | 0;
      }

      j = (c + 1 | 0) % 6 | 0;
      S = k;
      return j | 0;
    }

    function Lc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0;
      e = Fb(a, c) | 0;

      if ((d + -1 | 0) >>> 0 > 5) {
        d = -1;
        return d | 0;
      }

      f = (e | 0) != 0;

      if ((d | 0) == 1 & f) {
        d = -1;
        return d | 0;
      }

      e = Kc(a, c) | 0;

      if (f) {
        d = (5 - e + (b[22384 + (d << 2) >> 2] | 0) | 0) % 5 | 0;
        return d | 0;
      } else {
        d = (6 - e + (b[22416 + (d << 2) >> 2] | 0) | 0) % 6 | 0;
        return d | 0;
      }

      return 0;
    }

    function Mc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0;

      if ((c | 0) > 0) {
        e = Yc(c, 4) | 0;
        b[a >> 2] = e;
        if (!e) { H(23230, 23253, 40, 23267); }
      } else { b[a >> 2] = 0; }

      b[a + 4 >> 2] = c;
      b[a + 8 >> 2] = 0;
      b[a + 12 >> 2] = d;
      return;
    }

    function Nc(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0;
      g = a + 4 | 0;
      h = a + 12 | 0;
      i = a + 8 | 0;

      a: while (1) {
        d = b[g >> 2] | 0;
        c = 0;

        while (1) {
          if ((c | 0) >= (d | 0)) { break a; }
          f = b[a >> 2] | 0;
          j = b[f + (c << 2) >> 2] | 0;
          if (!j) { c = c + 1 | 0; }else { break; }
        }

        c = f + (~~(+q(+(+s(10.0, + +(15 - (b[h >> 2] | 0) | 0)) * (+e[j >> 3] + +e[j + 8 >> 3]))) % +(d | 0)) >>> 0 << 2) | 0;
        d = b[c >> 2] | 0;

        b: do { if (d | 0) {
          f = j + 32 | 0;
          if ((d | 0) == (j | 0)) { b[c >> 2] = b[f >> 2]; }else {
            d = d + 32 | 0;
            c = b[d >> 2] | 0;
            if (!c) { break; }

            while (1) {
              if ((c | 0) == (j | 0)) { break; }
              d = c + 32 | 0;
              c = b[d >> 2] | 0;
              if (!c) { break b; }
            }

            b[d >> 2] = b[f >> 2];
          }
          Xc(j);
          b[i >> 2] = (b[i >> 2] | 0) + -1;
        } } while (0);
      }

      Xc(b[a >> 2] | 0);
      return;
    }

    function Oc(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0;
      e = b[a + 4 >> 2] | 0;
      d = 0;

      while (1) {
        if ((d | 0) >= (e | 0)) {
          c = 0;
          d = 4;
          break;
        }

        c = b[(b[a >> 2] | 0) + (d << 2) >> 2] | 0;
        if (!c) { d = d + 1 | 0; }else {
          d = 4;
          break;
        }
      }

      if ((d | 0) == 4) { return c | 0; }
      return 0;
    }

    function Pc(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          f = 0,
          g = 0,
          h = 0;
      d = ~~(+q(+(+s(10.0, + +(15 - (b[a + 12 >> 2] | 0) | 0)) * (+e[c >> 3] + +e[c + 8 >> 3]))) % +(b[a + 4 >> 2] | 0)) >>> 0;
      d = (b[a >> 2] | 0) + (d << 2) | 0;
      f = b[d >> 2] | 0;

      if (!f) {
        h = 1;
        return h | 0;
      }

      h = c + 32 | 0;

      do { if ((f | 0) != (c | 0)) {
        d = b[f + 32 >> 2] | 0;

        if (!d) {
          h = 1;
          return h | 0;
        }

        g = d;

        while (1) {
          if ((g | 0) == (c | 0)) {
            g = 8;
            break;
          }

          d = b[g + 32 >> 2] | 0;

          if (!d) {
            d = 1;
            g = 10;
            break;
          } else {
            f = g;
            g = d;
          }
        }

        if ((g | 0) == 8) {
          b[f + 32 >> 2] = b[h >> 2];
          break;
        } else if ((g | 0) == 10) { return d | 0; }
      } else { b[d >> 2] = b[h >> 2]; } } while (0);

      Xc(c);
      h = a + 8 | 0;
      b[h >> 2] = (b[h >> 2] | 0) + -1;
      h = 0;
      return h | 0;
    }

    function Qc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0;
      h = Wc(40) | 0;
      if (!h) { H(23283, 23253, 98, 23296); }
      b[h >> 2] = b[c >> 2];
      b[h + 4 >> 2] = b[c + 4 >> 2];
      b[h + 8 >> 2] = b[c + 8 >> 2];
      b[h + 12 >> 2] = b[c + 12 >> 2];
      g = h + 16 | 0;
      b[g >> 2] = b[d >> 2];
      b[g + 4 >> 2] = b[d + 4 >> 2];
      b[g + 8 >> 2] = b[d + 8 >> 2];
      b[g + 12 >> 2] = b[d + 12 >> 2];
      b[h + 32 >> 2] = 0;
      g = ~~(+q(+(+s(10.0, + +(15 - (b[a + 12 >> 2] | 0) | 0)) * (+e[c >> 3] + +e[c + 8 >> 3]))) % +(b[a + 4 >> 2] | 0)) >>> 0;
      g = (b[a >> 2] | 0) + (g << 2) | 0;
      f = b[g >> 2] | 0;

      do { if (!f) { b[g >> 2] = h; }else {
        while (1) {
          if (hb(f, c) | 0 ? hb(f + 16 | 0, d) | 0 : 0) { break; }
          g = b[f + 32 >> 2] | 0;
          f = (g | 0) == 0 ? f : g;

          if (!(b[f + 32 >> 2] | 0)) {
            i = 10;
            break;
          }
        }

        if ((i | 0) == 10) {
          b[f + 32 >> 2] = h;
          break;
        }

        Xc(h);
        i = f;
        return i | 0;
      } } while (0);

      i = a + 8 | 0;
      b[i >> 2] = (b[i >> 2] | 0) + 1;
      i = h;
      return i | 0;
    }

    function Rc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var f = 0,
          g = 0;
      g = ~~(+q(+(+s(10.0, + +(15 - (b[a + 12 >> 2] | 0) | 0)) * (+e[c >> 3] + +e[c + 8 >> 3]))) % +(b[a + 4 >> 2] | 0)) >>> 0;
      g = b[(b[a >> 2] | 0) + (g << 2) >> 2] | 0;

      if (!g) {
        d = 0;
        return d | 0;
      }

      if (!d) {
        a = g;

        while (1) {
          if (hb(a, c) | 0) {
            f = 10;
            break;
          }

          a = b[a + 32 >> 2] | 0;

          if (!a) {
            a = 0;
            f = 10;
            break;
          }
        }

        if ((f | 0) == 10) { return a | 0; }
      }

      a = g;

      while (1) {
        if (hb(a, c) | 0 ? hb(a + 16 | 0, d) | 0 : 0) {
          f = 10;
          break;
        }

        a = b[a + 32 >> 2] | 0;

        if (!a) {
          a = 0;
          f = 10;
          break;
        }
      }

      if ((f | 0) == 10) { return a | 0; }
      return 0;
    }

    function Sc(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0;
      d = ~~(+q(+(+s(10.0, + +(15 - (b[a + 12 >> 2] | 0) | 0)) * (+e[c >> 3] + +e[c + 8 >> 3]))) % +(b[a + 4 >> 2] | 0)) >>> 0;
      a = b[(b[a >> 2] | 0) + (d << 2) >> 2] | 0;

      if (!a) {
        d = 0;
        return d | 0;
      }

      while (1) {
        if (hb(a, c) | 0) {
          c = 5;
          break;
        }

        a = b[a + 32 >> 2] | 0;

        if (!a) {
          a = 0;
          c = 5;
          break;
        }
      }

      if ((c | 0) == 5) { return a | 0; }
      return 0;
    }

    function Tc() {
      return 23312;
    }

    function Uc(a) {
      a = +a;
      return + +id(+a);
    }

    function Vc(a) {
      a = +a;
      return ~~+Uc(a) | 0;
    }

    function Wc(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0;
      w = S;
      S = S + 16 | 0;
      n = w;

      do { if (a >>> 0 < 245) {
        k = a >>> 0 < 11 ? 16 : a + 11 & -8;
        a = k >>> 3;
        m = b[5829] | 0;
        d = m >>> a;

        if (d & 3 | 0) {
          c = (d & 1 ^ 1) + a | 0;
          a = 23356 + (c << 1 << 2) | 0;
          d = a + 8 | 0;
          e = b[d >> 2] | 0;
          f = e + 8 | 0;
          g = b[f >> 2] | 0;
          if ((g | 0) == (a | 0)) { b[5829] = m & ~(1 << c); }else {
            b[g + 12 >> 2] = a;
            b[d >> 2] = g;
          }
          v = c << 3;
          b[e + 4 >> 2] = v | 3;
          v = e + v + 4 | 0;
          b[v >> 2] = b[v >> 2] | 1;
          v = f;
          S = w;
          return v | 0;
        }

        l = b[5831] | 0;

        if (k >>> 0 > l >>> 0) {
          if (d | 0) {
            c = 2 << a;
            c = d << a & (c | 0 - c);
            c = (c & 0 - c) + -1 | 0;
            i = c >>> 12 & 16;
            c = c >>> i;
            d = c >>> 5 & 8;
            c = c >>> d;
            g = c >>> 2 & 4;
            c = c >>> g;
            a = c >>> 1 & 2;
            c = c >>> a;
            e = c >>> 1 & 1;
            e = (d | i | g | a | e) + (c >>> e) | 0;
            c = 23356 + (e << 1 << 2) | 0;
            a = c + 8 | 0;
            g = b[a >> 2] | 0;
            i = g + 8 | 0;
            d = b[i >> 2] | 0;

            if ((d | 0) == (c | 0)) {
              a = m & ~(1 << e);
              b[5829] = a;
            } else {
              b[d + 12 >> 2] = c;
              b[a >> 2] = d;
              a = m;
            }

            v = e << 3;
            h = v - k | 0;
            b[g + 4 >> 2] = k | 3;
            f = g + k | 0;
            b[f + 4 >> 2] = h | 1;
            b[g + v >> 2] = h;

            if (l | 0) {
              e = b[5834] | 0;
              c = l >>> 3;
              d = 23356 + (c << 1 << 2) | 0;
              c = 1 << c;

              if (!(a & c)) {
                b[5829] = a | c;
                c = d;
                a = d + 8 | 0;
              } else {
                a = d + 8 | 0;
                c = b[a >> 2] | 0;
              }

              b[a >> 2] = e;
              b[c + 12 >> 2] = e;
              b[e + 8 >> 2] = c;
              b[e + 12 >> 2] = d;
            }

            b[5831] = h;
            b[5834] = f;
            v = i;
            S = w;
            return v | 0;
          }

          g = b[5830] | 0;

          if (g) {
            d = (g & 0 - g) + -1 | 0;
            f = d >>> 12 & 16;
            d = d >>> f;
            e = d >>> 5 & 8;
            d = d >>> e;
            h = d >>> 2 & 4;
            d = d >>> h;
            i = d >>> 1 & 2;
            d = d >>> i;
            j = d >>> 1 & 1;
            j = b[23620 + ((e | f | h | i | j) + (d >>> j) << 2) >> 2] | 0;
            d = j;
            i = j;
            j = (b[j + 4 >> 2] & -8) - k | 0;

            while (1) {
              a = b[d + 16 >> 2] | 0;

              if (!a) {
                a = b[d + 20 >> 2] | 0;
                if (!a) { break; }
              }

              h = (b[a + 4 >> 2] & -8) - k | 0;
              f = h >>> 0 < j >>> 0;
              d = a;
              i = f ? a : i;
              j = f ? h : j;
            }

            h = i + k | 0;

            if (h >>> 0 > i >>> 0) {
              f = b[i + 24 >> 2] | 0;
              c = b[i + 12 >> 2] | 0;

              do { if ((c | 0) == (i | 0)) {
                a = i + 20 | 0;
                c = b[a >> 2] | 0;

                if (!c) {
                  a = i + 16 | 0;
                  c = b[a >> 2] | 0;

                  if (!c) {
                    d = 0;
                    break;
                  }
                }

                while (1) {
                  e = c + 20 | 0;
                  d = b[e >> 2] | 0;

                  if (!d) {
                    e = c + 16 | 0;
                    d = b[e >> 2] | 0;
                    if (!d) { break; }else {
                      c = d;
                      a = e;
                    }
                  } else {
                    c = d;
                    a = e;
                  }
                }

                b[a >> 2] = 0;
                d = c;
              } else {
                d = b[i + 8 >> 2] | 0;
                b[d + 12 >> 2] = c;
                b[c + 8 >> 2] = d;
                d = c;
              } } while (0);

              do { if (f | 0) {
                c = b[i + 28 >> 2] | 0;
                a = 23620 + (c << 2) | 0;

                if ((i | 0) == (b[a >> 2] | 0)) {
                  b[a >> 2] = d;

                  if (!d) {
                    b[5830] = g & ~(1 << c);
                    break;
                  }
                } else {
                  v = f + 16 | 0;
                  b[((b[v >> 2] | 0) == (i | 0) ? v : f + 20 | 0) >> 2] = d;
                  if (!d) { break; }
                }

                b[d + 24 >> 2] = f;
                c = b[i + 16 >> 2] | 0;

                if (c | 0) {
                  b[d + 16 >> 2] = c;
                  b[c + 24 >> 2] = d;
                }

                c = b[i + 20 >> 2] | 0;

                if (c | 0) {
                  b[d + 20 >> 2] = c;
                  b[c + 24 >> 2] = d;
                }
              } } while (0);

              if (j >>> 0 < 16) {
                v = j + k | 0;
                b[i + 4 >> 2] = v | 3;
                v = i + v + 4 | 0;
                b[v >> 2] = b[v >> 2] | 1;
              } else {
                b[i + 4 >> 2] = k | 3;
                b[h + 4 >> 2] = j | 1;
                b[h + j >> 2] = j;

                if (l | 0) {
                  e = b[5834] | 0;
                  c = l >>> 3;
                  d = 23356 + (c << 1 << 2) | 0;
                  c = 1 << c;

                  if (!(c & m)) {
                    b[5829] = c | m;
                    c = d;
                    a = d + 8 | 0;
                  } else {
                    a = d + 8 | 0;
                    c = b[a >> 2] | 0;
                  }

                  b[a >> 2] = e;
                  b[c + 12 >> 2] = e;
                  b[e + 8 >> 2] = c;
                  b[e + 12 >> 2] = d;
                }

                b[5831] = j;
                b[5834] = h;
              }

              v = i + 8 | 0;
              S = w;
              return v | 0;
            } else { m = k; }
          } else { m = k; }
        } else { m = k; }
      } else if (a >>> 0 <= 4294967231) {
        a = a + 11 | 0;
        k = a & -8;
        e = b[5830] | 0;

        if (e) {
          f = 0 - k | 0;
          a = a >>> 8;
          if (a) {
            if (k >>> 0 > 16777215) { j = 31; }else {
              m = (a + 1048320 | 0) >>> 16 & 8;
              q = a << m;
              i = (q + 520192 | 0) >>> 16 & 4;
              q = q << i;
              j = (q + 245760 | 0) >>> 16 & 2;
              j = 14 - (i | m | j) + (q << j >>> 15) | 0;
              j = k >>> (j + 7 | 0) & 1 | j << 1;
            }
          } else { j = 0; }
          d = b[23620 + (j << 2) >> 2] | 0;

          a: do { if (!d) {
            d = 0;
            a = 0;
            q = 61;
          } else {
            a = 0;
            i = k << ((j | 0) == 31 ? 0 : 25 - (j >>> 1) | 0);
            g = 0;

            while (1) {
              h = (b[d + 4 >> 2] & -8) - k | 0;
              if (h >>> 0 < f >>> 0) { if (!h) {
                a = d;
                f = 0;
                q = 65;
                break a;
              } else {
                a = d;
                f = h;
              } }
              q = b[d + 20 >> 2] | 0;
              d = b[d + 16 + (i >>> 31 << 2) >> 2] | 0;
              g = (q | 0) == 0 | (q | 0) == (d | 0) ? g : q;

              if (!d) {
                d = g;
                q = 61;
                break;
              } else { i = i << 1; }
            }
          } } while (0);

          if ((q | 0) == 61) {
            if ((d | 0) == 0 & (a | 0) == 0) {
              a = 2 << j;
              a = (a | 0 - a) & e;

              if (!a) {
                m = k;
                break;
              }

              m = (a & 0 - a) + -1 | 0;
              h = m >>> 12 & 16;
              m = m >>> h;
              g = m >>> 5 & 8;
              m = m >>> g;
              i = m >>> 2 & 4;
              m = m >>> i;
              j = m >>> 1 & 2;
              m = m >>> j;
              d = m >>> 1 & 1;
              a = 0;
              d = b[23620 + ((g | h | i | j | d) + (m >>> d) << 2) >> 2] | 0;
            }

            if (!d) {
              i = a;
              h = f;
            } else { q = 65; }
          }

          if ((q | 0) == 65) {
            g = d;

            while (1) {
              m = (b[g + 4 >> 2] & -8) - k | 0;
              d = m >>> 0 < f >>> 0;
              f = d ? m : f;
              a = d ? g : a;
              d = b[g + 16 >> 2] | 0;
              if (!d) { d = b[g + 20 >> 2] | 0; }

              if (!d) {
                i = a;
                h = f;
                break;
              } else { g = d; }
            }
          }

          if (((i | 0) != 0 ? h >>> 0 < ((b[5831] | 0) - k | 0) >>> 0 : 0) ? (l = i + k | 0, l >>> 0 > i >>> 0) : 0) {
            g = b[i + 24 >> 2] | 0;
            c = b[i + 12 >> 2] | 0;

            do { if ((c | 0) == (i | 0)) {
              a = i + 20 | 0;
              c = b[a >> 2] | 0;

              if (!c) {
                a = i + 16 | 0;
                c = b[a >> 2] | 0;

                if (!c) {
                  c = 0;
                  break;
                }
              }

              while (1) {
                f = c + 20 | 0;
                d = b[f >> 2] | 0;

                if (!d) {
                  f = c + 16 | 0;
                  d = b[f >> 2] | 0;
                  if (!d) { break; }else {
                    c = d;
                    a = f;
                  }
                } else {
                  c = d;
                  a = f;
                }
              }

              b[a >> 2] = 0;
            } else {
              v = b[i + 8 >> 2] | 0;
              b[v + 12 >> 2] = c;
              b[c + 8 >> 2] = v;
            } } while (0);

            do { if (g) {
              a = b[i + 28 >> 2] | 0;
              d = 23620 + (a << 2) | 0;

              if ((i | 0) == (b[d >> 2] | 0)) {
                b[d >> 2] = c;

                if (!c) {
                  e = e & ~(1 << a);
                  b[5830] = e;
                  break;
                }
              } else {
                v = g + 16 | 0;
                b[((b[v >> 2] | 0) == (i | 0) ? v : g + 20 | 0) >> 2] = c;
                if (!c) { break; }
              }

              b[c + 24 >> 2] = g;
              a = b[i + 16 >> 2] | 0;

              if (a | 0) {
                b[c + 16 >> 2] = a;
                b[a + 24 >> 2] = c;
              }

              a = b[i + 20 >> 2] | 0;

              if (a) {
                b[c + 20 >> 2] = a;
                b[a + 24 >> 2] = c;
              }
            } } while (0);

            b: do { if (h >>> 0 < 16) {
              v = h + k | 0;
              b[i + 4 >> 2] = v | 3;
              v = i + v + 4 | 0;
              b[v >> 2] = b[v >> 2] | 1;
            } else {
              b[i + 4 >> 2] = k | 3;
              b[l + 4 >> 2] = h | 1;
              b[l + h >> 2] = h;
              c = h >>> 3;

              if (h >>> 0 < 256) {
                d = 23356 + (c << 1 << 2) | 0;
                a = b[5829] | 0;
                c = 1 << c;

                if (!(a & c)) {
                  b[5829] = a | c;
                  c = d;
                  a = d + 8 | 0;
                } else {
                  a = d + 8 | 0;
                  c = b[a >> 2] | 0;
                }

                b[a >> 2] = l;
                b[c + 12 >> 2] = l;
                b[l + 8 >> 2] = c;
                b[l + 12 >> 2] = d;
                break;
              }

              c = h >>> 8;
              if (c) {
                if (h >>> 0 > 16777215) { d = 31; }else {
                  u = (c + 1048320 | 0) >>> 16 & 8;
                  v = c << u;
                  t = (v + 520192 | 0) >>> 16 & 4;
                  v = v << t;
                  d = (v + 245760 | 0) >>> 16 & 2;
                  d = 14 - (t | u | d) + (v << d >>> 15) | 0;
                  d = h >>> (d + 7 | 0) & 1 | d << 1;
                }
              } else { d = 0; }
              c = 23620 + (d << 2) | 0;
              b[l + 28 >> 2] = d;
              a = l + 16 | 0;
              b[a + 4 >> 2] = 0;
              b[a >> 2] = 0;
              a = 1 << d;

              if (!(e & a)) {
                b[5830] = e | a;
                b[c >> 2] = l;
                b[l + 24 >> 2] = c;
                b[l + 12 >> 2] = l;
                b[l + 8 >> 2] = l;
                break;
              }

              c = b[c >> 2] | 0;

              c: do { if ((b[c + 4 >> 2] & -8 | 0) != (h | 0)) {
                e = h << ((d | 0) == 31 ? 0 : 25 - (d >>> 1) | 0);

                while (1) {
                  d = c + 16 + (e >>> 31 << 2) | 0;
                  a = b[d >> 2] | 0;
                  if (!a) { break; }

                  if ((b[a + 4 >> 2] & -8 | 0) == (h | 0)) {
                    c = a;
                    break c;
                  } else {
                    e = e << 1;
                    c = a;
                  }
                }

                b[d >> 2] = l;
                b[l + 24 >> 2] = c;
                b[l + 12 >> 2] = l;
                b[l + 8 >> 2] = l;
                break b;
              } } while (0);

              u = c + 8 | 0;
              v = b[u >> 2] | 0;
              b[v + 12 >> 2] = l;
              b[u >> 2] = l;
              b[l + 8 >> 2] = v;
              b[l + 12 >> 2] = c;
              b[l + 24 >> 2] = 0;
            } } while (0);

            v = i + 8 | 0;
            S = w;
            return v | 0;
          } else { m = k; }
        } else { m = k; }
      } else { m = -1; } } while (0);

      d = b[5831] | 0;

      if (d >>> 0 >= m >>> 0) {
        c = d - m | 0;
        a = b[5834] | 0;

        if (c >>> 0 > 15) {
          v = a + m | 0;
          b[5834] = v;
          b[5831] = c;
          b[v + 4 >> 2] = c | 1;
          b[a + d >> 2] = c;
          b[a + 4 >> 2] = m | 3;
        } else {
          b[5831] = 0;
          b[5834] = 0;
          b[a + 4 >> 2] = d | 3;
          v = a + d + 4 | 0;
          b[v >> 2] = b[v >> 2] | 1;
        }

        v = a + 8 | 0;
        S = w;
        return v | 0;
      }

      h = b[5832] | 0;

      if (h >>> 0 > m >>> 0) {
        t = h - m | 0;
        b[5832] = t;
        v = b[5835] | 0;
        u = v + m | 0;
        b[5835] = u;
        b[u + 4 >> 2] = t | 1;
        b[v + 4 >> 2] = m | 3;
        v = v + 8 | 0;
        S = w;
        return v | 0;
      }

      if (!(b[5947] | 0)) {
        b[5949] = 4096;
        b[5948] = 4096;
        b[5950] = -1;
        b[5951] = -1;
        b[5952] = 0;
        b[5940] = 0;
        b[5947] = n & -16 ^ 1431655768;
        a = 4096;
      } else { a = b[5949] | 0; }

      i = m + 48 | 0;
      j = m + 47 | 0;
      g = a + j | 0;
      f = 0 - a | 0;
      k = g & f;

      if (k >>> 0 <= m >>> 0) {
        v = 0;
        S = w;
        return v | 0;
      }

      a = b[5939] | 0;

      if (a | 0 ? (l = b[5937] | 0, n = l + k | 0, n >>> 0 <= l >>> 0 | n >>> 0 > a >>> 0) : 0) {
        v = 0;
        S = w;
        return v | 0;
      }

      d: do { if (!(b[5940] & 4)) {
        d = b[5835] | 0;

        e: do { if (d) {
          e = 23764;

          while (1) {
            n = b[e >> 2] | 0;
            if (n >>> 0 <= d >>> 0 ? (n + (b[e + 4 >> 2] | 0) | 0) >>> 0 > d >>> 0 : 0) { break; }
            a = b[e + 8 >> 2] | 0;

            if (!a) {
              q = 128;
              break e;
            } else { e = a; }
          }

          c = g - h & f;

          if (c >>> 0 < 2147483647) {
            a = jd(c | 0) | 0;

            if ((a | 0) == ((b[e >> 2] | 0) + (b[e + 4 >> 2] | 0) | 0)) {
              if ((a | 0) != (-1 | 0)) {
                h = c;
                g = a;
                q = 145;
                break d;
              }
            } else {
              e = a;
              q = 136;
            }
          } else { c = 0; }
        } else { q = 128; } } while (0);

        do { if ((q | 0) == 128) {
          d = jd(0) | 0;

          if ((d | 0) != (-1 | 0) ? (c = d, o = b[5948] | 0, p = o + -1 | 0, c = ((p & c | 0) == 0 ? 0 : (p + c & 0 - o) - c | 0) + k | 0, o = b[5937] | 0, p = c + o | 0, c >>> 0 > m >>> 0 & c >>> 0 < 2147483647) : 0) {
            n = b[5939] | 0;

            if (n | 0 ? p >>> 0 <= o >>> 0 | p >>> 0 > n >>> 0 : 0) {
              c = 0;
              break;
            }

            a = jd(c | 0) | 0;

            if ((a | 0) == (d | 0)) {
              h = c;
              g = d;
              q = 145;
              break d;
            } else {
              e = a;
              q = 136;
            }
          } else { c = 0; }
        } } while (0);

        do { if ((q | 0) == 136) {
          d = 0 - c | 0;
          if (!(i >>> 0 > c >>> 0 & (c >>> 0 < 2147483647 & (e | 0) != (-1 | 0)))) { if ((e | 0) == (-1 | 0)) {
            c = 0;
            break;
          } else {
            h = c;
            g = e;
            q = 145;
            break d;
          } }
          a = b[5949] | 0;
          a = j - c + a & 0 - a;

          if (a >>> 0 >= 2147483647) {
            h = c;
            g = e;
            q = 145;
            break d;
          }

          if ((jd(a | 0) | 0) == (-1 | 0)) {
            jd(d | 0) | 0;
            c = 0;
            break;
          } else {
            h = a + c | 0;
            g = e;
            q = 145;
            break d;
          }
        } } while (0);

        b[5940] = b[5940] | 4;
        q = 143;
      } else {
        c = 0;
        q = 143;
      } } while (0);

      if (((q | 0) == 143 ? k >>> 0 < 2147483647 : 0) ? (t = jd(k | 0) | 0, p = jd(0) | 0, r = p - t | 0, s = r >>> 0 > (m + 40 | 0) >>> 0, !((t | 0) == (-1 | 0) | s ^ 1 | t >>> 0 < p >>> 0 & ((t | 0) != (-1 | 0) & (p | 0) != (-1 | 0)) ^ 1)) : 0) {
        h = s ? r : c;
        g = t;
        q = 145;
      }

      if ((q | 0) == 145) {
        c = (b[5937] | 0) + h | 0;
        b[5937] = c;
        if (c >>> 0 > (b[5938] | 0) >>> 0) { b[5938] = c; }
        j = b[5835] | 0;

        f: do { if (j) {
          c = 23764;

          while (1) {
            a = b[c >> 2] | 0;
            d = b[c + 4 >> 2] | 0;

            if ((g | 0) == (a + d | 0)) {
              q = 154;
              break;
            }

            e = b[c + 8 >> 2] | 0;
            if (!e) { break; }else { c = e; }
          }

          if (((q | 0) == 154 ? (u = c + 4 | 0, (b[c + 12 >> 2] & 8 | 0) == 0) : 0) ? g >>> 0 > j >>> 0 & a >>> 0 <= j >>> 0 : 0) {
            b[u >> 2] = d + h;
            v = (b[5832] | 0) + h | 0;
            t = j + 8 | 0;
            t = (t & 7 | 0) == 0 ? 0 : 0 - t & 7;
            u = j + t | 0;
            t = v - t | 0;
            b[5835] = u;
            b[5832] = t;
            b[u + 4 >> 2] = t | 1;
            b[j + v + 4 >> 2] = 40;
            b[5836] = b[5951];
            break;
          }

          if (g >>> 0 < (b[5833] | 0) >>> 0) { b[5833] = g; }
          d = g + h | 0;
          c = 23764;

          while (1) {
            if ((b[c >> 2] | 0) == (d | 0)) {
              q = 162;
              break;
            }

            a = b[c + 8 >> 2] | 0;
            if (!a) { break; }else { c = a; }
          }

          if ((q | 0) == 162 ? (b[c + 12 >> 2] & 8 | 0) == 0 : 0) {
            b[c >> 2] = g;
            l = c + 4 | 0;
            b[l >> 2] = (b[l >> 2] | 0) + h;
            l = g + 8 | 0;
            l = g + ((l & 7 | 0) == 0 ? 0 : 0 - l & 7) | 0;
            c = d + 8 | 0;
            c = d + ((c & 7 | 0) == 0 ? 0 : 0 - c & 7) | 0;
            k = l + m | 0;
            i = c - l - m | 0;
            b[l + 4 >> 2] = m | 3;

            g: do { if ((j | 0) == (c | 0)) {
              v = (b[5832] | 0) + i | 0;
              b[5832] = v;
              b[5835] = k;
              b[k + 4 >> 2] = v | 1;
            } else {
              if ((b[5834] | 0) == (c | 0)) {
                v = (b[5831] | 0) + i | 0;
                b[5831] = v;
                b[5834] = k;
                b[k + 4 >> 2] = v | 1;
                b[k + v >> 2] = v;
                break;
              }

              a = b[c + 4 >> 2] | 0;

              if ((a & 3 | 0) == 1) {
                h = a & -8;
                e = a >>> 3;

                h: do { if (a >>> 0 < 256) {
                  a = b[c + 8 >> 2] | 0;
                  d = b[c + 12 >> 2] | 0;

                  if ((d | 0) == (a | 0)) {
                    b[5829] = b[5829] & ~(1 << e);
                    break;
                  } else {
                    b[a + 12 >> 2] = d;
                    b[d + 8 >> 2] = a;
                    break;
                  }
                } else {
                  g = b[c + 24 >> 2] | 0;
                  a = b[c + 12 >> 2] | 0;

                  do { if ((a | 0) == (c | 0)) {
                    d = c + 16 | 0;
                    e = d + 4 | 0;
                    a = b[e >> 2] | 0;

                    if (!a) {
                      a = b[d >> 2] | 0;

                      if (!a) {
                        a = 0;
                        break;
                      }
                    } else { d = e; }

                    while (1) {
                      f = a + 20 | 0;
                      e = b[f >> 2] | 0;

                      if (!e) {
                        f = a + 16 | 0;
                        e = b[f >> 2] | 0;
                        if (!e) { break; }else {
                          a = e;
                          d = f;
                        }
                      } else {
                        a = e;
                        d = f;
                      }
                    }

                    b[d >> 2] = 0;
                  } else {
                    v = b[c + 8 >> 2] | 0;
                    b[v + 12 >> 2] = a;
                    b[a + 8 >> 2] = v;
                  } } while (0);

                  if (!g) { break; }
                  d = b[c + 28 >> 2] | 0;
                  e = 23620 + (d << 2) | 0;

                  do { if ((b[e >> 2] | 0) != (c | 0)) {
                    v = g + 16 | 0;
                    b[((b[v >> 2] | 0) == (c | 0) ? v : g + 20 | 0) >> 2] = a;
                    if (!a) { break h; }
                  } else {
                    b[e >> 2] = a;
                    if (a | 0) { break; }
                    b[5830] = b[5830] & ~(1 << d);
                    break h;
                  } } while (0);

                  b[a + 24 >> 2] = g;
                  d = c + 16 | 0;
                  e = b[d >> 2] | 0;

                  if (e | 0) {
                    b[a + 16 >> 2] = e;
                    b[e + 24 >> 2] = a;
                  }

                  d = b[d + 4 >> 2] | 0;
                  if (!d) { break; }
                  b[a + 20 >> 2] = d;
                  b[d + 24 >> 2] = a;
                } } while (0);

                c = c + h | 0;
                f = h + i | 0;
              } else { f = i; }

              c = c + 4 | 0;
              b[c >> 2] = b[c >> 2] & -2;
              b[k + 4 >> 2] = f | 1;
              b[k + f >> 2] = f;
              c = f >>> 3;

              if (f >>> 0 < 256) {
                d = 23356 + (c << 1 << 2) | 0;
                a = b[5829] | 0;
                c = 1 << c;

                if (!(a & c)) {
                  b[5829] = a | c;
                  c = d;
                  a = d + 8 | 0;
                } else {
                  a = d + 8 | 0;
                  c = b[a >> 2] | 0;
                }

                b[a >> 2] = k;
                b[c + 12 >> 2] = k;
                b[k + 8 >> 2] = c;
                b[k + 12 >> 2] = d;
                break;
              }

              c = f >>> 8;

              do { if (!c) { e = 0; }else {
                if (f >>> 0 > 16777215) {
                  e = 31;
                  break;
                }

                u = (c + 1048320 | 0) >>> 16 & 8;
                v = c << u;
                t = (v + 520192 | 0) >>> 16 & 4;
                v = v << t;
                e = (v + 245760 | 0) >>> 16 & 2;
                e = 14 - (t | u | e) + (v << e >>> 15) | 0;
                e = f >>> (e + 7 | 0) & 1 | e << 1;
              } } while (0);

              c = 23620 + (e << 2) | 0;
              b[k + 28 >> 2] = e;
              a = k + 16 | 0;
              b[a + 4 >> 2] = 0;
              b[a >> 2] = 0;
              a = b[5830] | 0;
              d = 1 << e;

              if (!(a & d)) {
                b[5830] = a | d;
                b[c >> 2] = k;
                b[k + 24 >> 2] = c;
                b[k + 12 >> 2] = k;
                b[k + 8 >> 2] = k;
                break;
              }

              c = b[c >> 2] | 0;

              i: do { if ((b[c + 4 >> 2] & -8 | 0) != (f | 0)) {
                e = f << ((e | 0) == 31 ? 0 : 25 - (e >>> 1) | 0);

                while (1) {
                  d = c + 16 + (e >>> 31 << 2) | 0;
                  a = b[d >> 2] | 0;
                  if (!a) { break; }

                  if ((b[a + 4 >> 2] & -8 | 0) == (f | 0)) {
                    c = a;
                    break i;
                  } else {
                    e = e << 1;
                    c = a;
                  }
                }

                b[d >> 2] = k;
                b[k + 24 >> 2] = c;
                b[k + 12 >> 2] = k;
                b[k + 8 >> 2] = k;
                break g;
              } } while (0);

              u = c + 8 | 0;
              v = b[u >> 2] | 0;
              b[v + 12 >> 2] = k;
              b[u >> 2] = k;
              b[k + 8 >> 2] = v;
              b[k + 12 >> 2] = c;
              b[k + 24 >> 2] = 0;
            } } while (0);

            v = l + 8 | 0;
            S = w;
            return v | 0;
          }

          c = 23764;

          while (1) {
            a = b[c >> 2] | 0;
            if (a >>> 0 <= j >>> 0 ? (v = a + (b[c + 4 >> 2] | 0) | 0, v >>> 0 > j >>> 0) : 0) { break; }
            c = b[c + 8 >> 2] | 0;
          }

          f = v + -47 | 0;
          a = f + 8 | 0;
          a = f + ((a & 7 | 0) == 0 ? 0 : 0 - a & 7) | 0;
          f = j + 16 | 0;
          a = a >>> 0 < f >>> 0 ? j : a;
          c = a + 8 | 0;
          d = h + -40 | 0;
          t = g + 8 | 0;
          t = (t & 7 | 0) == 0 ? 0 : 0 - t & 7;
          u = g + t | 0;
          t = d - t | 0;
          b[5835] = u;
          b[5832] = t;
          b[u + 4 >> 2] = t | 1;
          b[g + d + 4 >> 2] = 40;
          b[5836] = b[5951];
          d = a + 4 | 0;
          b[d >> 2] = 27;
          b[c >> 2] = b[5941];
          b[c + 4 >> 2] = b[5942];
          b[c + 8 >> 2] = b[5943];
          b[c + 12 >> 2] = b[5944];
          b[5941] = g;
          b[5942] = h;
          b[5944] = 0;
          b[5943] = c;
          c = a + 24 | 0;

          do {
            u = c;
            c = c + 4 | 0;
            b[c >> 2] = 7;
          } while ((u + 8 | 0) >>> 0 < v >>> 0);

          if ((a | 0) != (j | 0)) {
            g = a - j | 0;
            b[d >> 2] = b[d >> 2] & -2;
            b[j + 4 >> 2] = g | 1;
            b[a >> 2] = g;
            c = g >>> 3;

            if (g >>> 0 < 256) {
              d = 23356 + (c << 1 << 2) | 0;
              a = b[5829] | 0;
              c = 1 << c;

              if (!(a & c)) {
                b[5829] = a | c;
                c = d;
                a = d + 8 | 0;
              } else {
                a = d + 8 | 0;
                c = b[a >> 2] | 0;
              }

              b[a >> 2] = j;
              b[c + 12 >> 2] = j;
              b[j + 8 >> 2] = c;
              b[j + 12 >> 2] = d;
              break;
            }

            c = g >>> 8;
            if (c) {
              if (g >>> 0 > 16777215) { e = 31; }else {
                u = (c + 1048320 | 0) >>> 16 & 8;
                v = c << u;
                t = (v + 520192 | 0) >>> 16 & 4;
                v = v << t;
                e = (v + 245760 | 0) >>> 16 & 2;
                e = 14 - (t | u | e) + (v << e >>> 15) | 0;
                e = g >>> (e + 7 | 0) & 1 | e << 1;
              }
            } else { e = 0; }
            d = 23620 + (e << 2) | 0;
            b[j + 28 >> 2] = e;
            b[j + 20 >> 2] = 0;
            b[f >> 2] = 0;
            c = b[5830] | 0;
            a = 1 << e;

            if (!(c & a)) {
              b[5830] = c | a;
              b[d >> 2] = j;
              b[j + 24 >> 2] = d;
              b[j + 12 >> 2] = j;
              b[j + 8 >> 2] = j;
              break;
            }

            c = b[d >> 2] | 0;

            j: do { if ((b[c + 4 >> 2] & -8 | 0) != (g | 0)) {
              e = g << ((e | 0) == 31 ? 0 : 25 - (e >>> 1) | 0);

              while (1) {
                d = c + 16 + (e >>> 31 << 2) | 0;
                a = b[d >> 2] | 0;
                if (!a) { break; }

                if ((b[a + 4 >> 2] & -8 | 0) == (g | 0)) {
                  c = a;
                  break j;
                } else {
                  e = e << 1;
                  c = a;
                }
              }

              b[d >> 2] = j;
              b[j + 24 >> 2] = c;
              b[j + 12 >> 2] = j;
              b[j + 8 >> 2] = j;
              break f;
            } } while (0);

            u = c + 8 | 0;
            v = b[u >> 2] | 0;
            b[v + 12 >> 2] = j;
            b[u >> 2] = j;
            b[j + 8 >> 2] = v;
            b[j + 12 >> 2] = c;
            b[j + 24 >> 2] = 0;
          }
        } else {
          v = b[5833] | 0;
          if ((v | 0) == 0 | g >>> 0 < v >>> 0) { b[5833] = g; }
          b[5941] = g;
          b[5942] = h;
          b[5944] = 0;
          b[5838] = b[5947];
          b[5837] = -1;
          b[5842] = 23356;
          b[5841] = 23356;
          b[5844] = 23364;
          b[5843] = 23364;
          b[5846] = 23372;
          b[5845] = 23372;
          b[5848] = 23380;
          b[5847] = 23380;
          b[5850] = 23388;
          b[5849] = 23388;
          b[5852] = 23396;
          b[5851] = 23396;
          b[5854] = 23404;
          b[5853] = 23404;
          b[5856] = 23412;
          b[5855] = 23412;
          b[5858] = 23420;
          b[5857] = 23420;
          b[5860] = 23428;
          b[5859] = 23428;
          b[5862] = 23436;
          b[5861] = 23436;
          b[5864] = 23444;
          b[5863] = 23444;
          b[5866] = 23452;
          b[5865] = 23452;
          b[5868] = 23460;
          b[5867] = 23460;
          b[5870] = 23468;
          b[5869] = 23468;
          b[5872] = 23476;
          b[5871] = 23476;
          b[5874] = 23484;
          b[5873] = 23484;
          b[5876] = 23492;
          b[5875] = 23492;
          b[5878] = 23500;
          b[5877] = 23500;
          b[5880] = 23508;
          b[5879] = 23508;
          b[5882] = 23516;
          b[5881] = 23516;
          b[5884] = 23524;
          b[5883] = 23524;
          b[5886] = 23532;
          b[5885] = 23532;
          b[5888] = 23540;
          b[5887] = 23540;
          b[5890] = 23548;
          b[5889] = 23548;
          b[5892] = 23556;
          b[5891] = 23556;
          b[5894] = 23564;
          b[5893] = 23564;
          b[5896] = 23572;
          b[5895] = 23572;
          b[5898] = 23580;
          b[5897] = 23580;
          b[5900] = 23588;
          b[5899] = 23588;
          b[5902] = 23596;
          b[5901] = 23596;
          b[5904] = 23604;
          b[5903] = 23604;
          v = h + -40 | 0;
          t = g + 8 | 0;
          t = (t & 7 | 0) == 0 ? 0 : 0 - t & 7;
          u = g + t | 0;
          t = v - t | 0;
          b[5835] = u;
          b[5832] = t;
          b[u + 4 >> 2] = t | 1;
          b[g + v + 4 >> 2] = 40;
          b[5836] = b[5951];
        } } while (0);

        c = b[5832] | 0;

        if (c >>> 0 > m >>> 0) {
          t = c - m | 0;
          b[5832] = t;
          v = b[5835] | 0;
          u = v + m | 0;
          b[5835] = u;
          b[u + 4 >> 2] = t | 1;
          b[v + 4 >> 2] = m | 3;
          v = v + 8 | 0;
          S = w;
          return v | 0;
        }
      }

      v = Tc() | 0;
      b[v >> 2] = 12;
      v = 0;
      S = w;
      return v | 0;
    }

    function Xc(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0;
      if (!a) { return; }
      d = a + -8 | 0;
      f = b[5833] | 0;
      a = b[a + -4 >> 2] | 0;
      c = a & -8;
      j = d + c | 0;

      do { if (!(a & 1)) {
        e = b[d >> 2] | 0;
        if (!(a & 3)) { return; }
        h = d + (0 - e) | 0;
        g = e + c | 0;
        if (h >>> 0 < f >>> 0) { return; }

        if ((b[5834] | 0) == (h | 0)) {
          a = j + 4 | 0;
          c = b[a >> 2] | 0;

          if ((c & 3 | 0) != 3) {
            i = h;
            c = g;
            break;
          }

          b[5831] = g;
          b[a >> 2] = c & -2;
          b[h + 4 >> 2] = g | 1;
          b[h + g >> 2] = g;
          return;
        }

        d = e >>> 3;

        if (e >>> 0 < 256) {
          a = b[h + 8 >> 2] | 0;
          c = b[h + 12 >> 2] | 0;

          if ((c | 0) == (a | 0)) {
            b[5829] = b[5829] & ~(1 << d);
            i = h;
            c = g;
            break;
          } else {
            b[a + 12 >> 2] = c;
            b[c + 8 >> 2] = a;
            i = h;
            c = g;
            break;
          }
        }

        f = b[h + 24 >> 2] | 0;
        a = b[h + 12 >> 2] | 0;

        do { if ((a | 0) == (h | 0)) {
          c = h + 16 | 0;
          d = c + 4 | 0;
          a = b[d >> 2] | 0;

          if (!a) {
            a = b[c >> 2] | 0;

            if (!a) {
              a = 0;
              break;
            }
          } else { c = d; }

          while (1) {
            e = a + 20 | 0;
            d = b[e >> 2] | 0;

            if (!d) {
              e = a + 16 | 0;
              d = b[e >> 2] | 0;
              if (!d) { break; }else {
                a = d;
                c = e;
              }
            } else {
              a = d;
              c = e;
            }
          }

          b[c >> 2] = 0;
        } else {
          i = b[h + 8 >> 2] | 0;
          b[i + 12 >> 2] = a;
          b[a + 8 >> 2] = i;
        } } while (0);

        if (f) {
          c = b[h + 28 >> 2] | 0;
          d = 23620 + (c << 2) | 0;

          if ((b[d >> 2] | 0) == (h | 0)) {
            b[d >> 2] = a;

            if (!a) {
              b[5830] = b[5830] & ~(1 << c);
              i = h;
              c = g;
              break;
            }
          } else {
            i = f + 16 | 0;
            b[((b[i >> 2] | 0) == (h | 0) ? i : f + 20 | 0) >> 2] = a;

            if (!a) {
              i = h;
              c = g;
              break;
            }
          }

          b[a + 24 >> 2] = f;
          c = h + 16 | 0;
          d = b[c >> 2] | 0;

          if (d | 0) {
            b[a + 16 >> 2] = d;
            b[d + 24 >> 2] = a;
          }

          c = b[c + 4 >> 2] | 0;

          if (c) {
            b[a + 20 >> 2] = c;
            b[c + 24 >> 2] = a;
            i = h;
            c = g;
          } else {
            i = h;
            c = g;
          }
        } else {
          i = h;
          c = g;
        }
      } else {
        i = d;
        h = d;
      } } while (0);

      if (h >>> 0 >= j >>> 0) { return; }
      a = j + 4 | 0;
      e = b[a >> 2] | 0;
      if (!(e & 1)) { return; }

      if (!(e & 2)) {
        if ((b[5835] | 0) == (j | 0)) {
          j = (b[5832] | 0) + c | 0;
          b[5832] = j;
          b[5835] = i;
          b[i + 4 >> 2] = j | 1;
          if ((i | 0) != (b[5834] | 0)) { return; }
          b[5834] = 0;
          b[5831] = 0;
          return;
        }

        if ((b[5834] | 0) == (j | 0)) {
          j = (b[5831] | 0) + c | 0;
          b[5831] = j;
          b[5834] = h;
          b[i + 4 >> 2] = j | 1;
          b[h + j >> 2] = j;
          return;
        }

        f = (e & -8) + c | 0;
        d = e >>> 3;

        do { if (e >>> 0 < 256) {
          c = b[j + 8 >> 2] | 0;
          a = b[j + 12 >> 2] | 0;

          if ((a | 0) == (c | 0)) {
            b[5829] = b[5829] & ~(1 << d);
            break;
          } else {
            b[c + 12 >> 2] = a;
            b[a + 8 >> 2] = c;
            break;
          }
        } else {
          g = b[j + 24 >> 2] | 0;
          a = b[j + 12 >> 2] | 0;

          do { if ((a | 0) == (j | 0)) {
            c = j + 16 | 0;
            d = c + 4 | 0;
            a = b[d >> 2] | 0;

            if (!a) {
              a = b[c >> 2] | 0;

              if (!a) {
                d = 0;
                break;
              }
            } else { c = d; }

            while (1) {
              e = a + 20 | 0;
              d = b[e >> 2] | 0;

              if (!d) {
                e = a + 16 | 0;
                d = b[e >> 2] | 0;
                if (!d) { break; }else {
                  a = d;
                  c = e;
                }
              } else {
                a = d;
                c = e;
              }
            }

            b[c >> 2] = 0;
            d = a;
          } else {
            d = b[j + 8 >> 2] | 0;
            b[d + 12 >> 2] = a;
            b[a + 8 >> 2] = d;
            d = a;
          } } while (0);

          if (g | 0) {
            a = b[j + 28 >> 2] | 0;
            c = 23620 + (a << 2) | 0;

            if ((b[c >> 2] | 0) == (j | 0)) {
              b[c >> 2] = d;

              if (!d) {
                b[5830] = b[5830] & ~(1 << a);
                break;
              }
            } else {
              e = g + 16 | 0;
              b[((b[e >> 2] | 0) == (j | 0) ? e : g + 20 | 0) >> 2] = d;
              if (!d) { break; }
            }

            b[d + 24 >> 2] = g;
            a = j + 16 | 0;
            c = b[a >> 2] | 0;

            if (c | 0) {
              b[d + 16 >> 2] = c;
              b[c + 24 >> 2] = d;
            }

            a = b[a + 4 >> 2] | 0;

            if (a | 0) {
              b[d + 20 >> 2] = a;
              b[a + 24 >> 2] = d;
            }
          }
        } } while (0);

        b[i + 4 >> 2] = f | 1;
        b[h + f >> 2] = f;

        if ((i | 0) == (b[5834] | 0)) {
          b[5831] = f;
          return;
        }
      } else {
        b[a >> 2] = e & -2;
        b[i + 4 >> 2] = c | 1;
        b[h + c >> 2] = c;
        f = c;
      }

      a = f >>> 3;

      if (f >>> 0 < 256) {
        d = 23356 + (a << 1 << 2) | 0;
        c = b[5829] | 0;
        a = 1 << a;

        if (!(c & a)) {
          b[5829] = c | a;
          a = d;
          c = d + 8 | 0;
        } else {
          c = d + 8 | 0;
          a = b[c >> 2] | 0;
        }

        b[c >> 2] = i;
        b[a + 12 >> 2] = i;
        b[i + 8 >> 2] = a;
        b[i + 12 >> 2] = d;
        return;
      }

      a = f >>> 8;
      if (a) {
        if (f >>> 0 > 16777215) { e = 31; }else {
          h = (a + 1048320 | 0) >>> 16 & 8;
          j = a << h;
          g = (j + 520192 | 0) >>> 16 & 4;
          j = j << g;
          e = (j + 245760 | 0) >>> 16 & 2;
          e = 14 - (g | h | e) + (j << e >>> 15) | 0;
          e = f >>> (e + 7 | 0) & 1 | e << 1;
        }
      } else { e = 0; }
      a = 23620 + (e << 2) | 0;
      b[i + 28 >> 2] = e;
      b[i + 20 >> 2] = 0;
      b[i + 16 >> 2] = 0;
      c = b[5830] | 0;
      d = 1 << e;

      a: do { if (!(c & d)) {
        b[5830] = c | d;
        b[a >> 2] = i;
        b[i + 24 >> 2] = a;
        b[i + 12 >> 2] = i;
        b[i + 8 >> 2] = i;
      } else {
        a = b[a >> 2] | 0;

        b: do { if ((b[a + 4 >> 2] & -8 | 0) != (f | 0)) {
          e = f << ((e | 0) == 31 ? 0 : 25 - (e >>> 1) | 0);

          while (1) {
            d = a + 16 + (e >>> 31 << 2) | 0;
            c = b[d >> 2] | 0;
            if (!c) { break; }

            if ((b[c + 4 >> 2] & -8 | 0) == (f | 0)) {
              a = c;
              break b;
            } else {
              e = e << 1;
              a = c;
            }
          }

          b[d >> 2] = i;
          b[i + 24 >> 2] = a;
          b[i + 12 >> 2] = i;
          b[i + 8 >> 2] = i;
          break a;
        } } while (0);

        h = a + 8 | 0;
        j = b[h >> 2] | 0;
        b[j + 12 >> 2] = i;
        b[h >> 2] = i;
        b[i + 8 >> 2] = j;
        b[i + 12 >> 2] = a;
        b[i + 24 >> 2] = 0;
      } } while (0);

      j = (b[5837] | 0) + -1 | 0;
      b[5837] = j;
      if (j | 0) { return; }
      a = 23772;

      while (1) {
        a = b[a >> 2] | 0;
        if (!a) { break; }else { a = a + 8 | 0; }
      }

      b[5837] = -1;
      return;
    }

    function Yc(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0;

      if (a) {
        d = B(c, a) | 0;
        if ((c | a) >>> 0 > 65535) { d = ((d >>> 0) / (a >>> 0) | 0 | 0) == (c | 0) ? d : -1; }
      } else { d = 0; }

      a = Wc(d) | 0;
      if (!a) { return a | 0; }
      if (!(b[a + -4 >> 2] & 3)) { return a | 0; }
      hd(a | 0, 0, d | 0) | 0;
      return a | 0;
    }

    function Zc(a, b, c, d) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      c = a + c >>> 0;
      return (F(b + d + (c >>> 0 < a >>> 0 | 0) >>> 0 | 0), c | 0) | 0;
    }

    function _c(a, b, c, d) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      d = b - d - (c >>> 0 > a >>> 0 | 0) >>> 0;
      return (F(d | 0), a - c >>> 0 | 0) | 0;
    }

    function $c(a) {
      a = a | 0;
      return (a ? 31 - (D(a ^ a - 1) | 0) | 0 : 32) | 0;
    }

    function ad(a, c, d, e, f) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      f = f | 0;
      var g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0;
      l = a;
      j = c;
      k = j;
      h = d;
      n = e;
      i = n;

      if (!k) {
        g = (f | 0) != 0;

        if (!i) {
          if (g) {
            b[f >> 2] = (l >>> 0) % (h >>> 0);
            b[f + 4 >> 2] = 0;
          }

          n = 0;
          f = (l >>> 0) / (h >>> 0) >>> 0;
          return (F(n | 0), f) | 0;
        } else {
          if (!g) {
            n = 0;
            f = 0;
            return (F(n | 0), f) | 0;
          }

          b[f >> 2] = a | 0;
          b[f + 4 >> 2] = c & 0;
          n = 0;
          f = 0;
          return (F(n | 0), f) | 0;
        }
      }

      g = (i | 0) == 0;

      do { if (h) {
        if (!g) {
          g = (D(i | 0) | 0) - (D(k | 0) | 0) | 0;

          if (g >>> 0 <= 31) {
            m = g + 1 | 0;
            i = 31 - g | 0;
            c = g - 31 >> 31;
            h = m;
            a = l >>> (m >>> 0) & c | k << i;
            c = k >>> (m >>> 0) & c;
            g = 0;
            i = l << i;
            break;
          }

          if (!f) {
            n = 0;
            f = 0;
            return (F(n | 0), f) | 0;
          }

          b[f >> 2] = a | 0;
          b[f + 4 >> 2] = j | c & 0;
          n = 0;
          f = 0;
          return (F(n | 0), f) | 0;
        }

        g = h - 1 | 0;

        if (g & h | 0) {
          i = (D(h | 0) | 0) + 33 - (D(k | 0) | 0) | 0;
          p = 64 - i | 0;
          m = 32 - i | 0;
          j = m >> 31;
          o = i - 32 | 0;
          c = o >> 31;
          h = i;
          a = m - 1 >> 31 & k >>> (o >>> 0) | (k << m | l >>> (i >>> 0)) & c;
          c = c & k >>> (i >>> 0);
          g = l << p & j;
          i = (k << p | l >>> (o >>> 0)) & j | l << m & i - 33 >> 31;
          break;
        }

        if (f | 0) {
          b[f >> 2] = g & l;
          b[f + 4 >> 2] = 0;
        }

        if ((h | 0) == 1) {
          o = j | c & 0;
          p = a | 0 | 0;
          return (F(o | 0), p) | 0;
        } else {
          p = $c(h | 0) | 0;
          o = k >>> (p >>> 0) | 0;
          p = k << 32 - p | l >>> (p >>> 0) | 0;
          return (F(o | 0), p) | 0;
        }
      } else {
        if (g) {
          if (f | 0) {
            b[f >> 2] = (k >>> 0) % (h >>> 0);
            b[f + 4 >> 2] = 0;
          }

          o = 0;
          p = (k >>> 0) / (h >>> 0) >>> 0;
          return (F(o | 0), p) | 0;
        }

        if (!l) {
          if (f | 0) {
            b[f >> 2] = 0;
            b[f + 4 >> 2] = (k >>> 0) % (i >>> 0);
          }

          o = 0;
          p = (k >>> 0) / (i >>> 0) >>> 0;
          return (F(o | 0), p) | 0;
        }

        g = i - 1 | 0;

        if (!(g & i)) {
          if (f | 0) {
            b[f >> 2] = a | 0;
            b[f + 4 >> 2] = g & k | c & 0;
          }

          o = 0;
          p = k >>> (($c(i | 0) | 0) >>> 0);
          return (F(o | 0), p) | 0;
        }

        g = (D(i | 0) | 0) - (D(k | 0) | 0) | 0;

        if (g >>> 0 <= 30) {
          c = g + 1 | 0;
          i = 31 - g | 0;
          h = c;
          a = k << i | l >>> (c >>> 0);
          c = k >>> (c >>> 0);
          g = 0;
          i = l << i;
          break;
        }

        if (!f) {
          o = 0;
          p = 0;
          return (F(o | 0), p) | 0;
        }

        b[f >> 2] = a | 0;
        b[f + 4 >> 2] = j | c & 0;
        o = 0;
        p = 0;
        return (F(o | 0), p) | 0;
      } } while (0);

      if (!h) {
        k = i;
        j = 0;
        i = 0;
      } else {
        m = d | 0 | 0;
        l = n | e & 0;
        k = Zc(m | 0, l | 0, -1, -1) | 0;
        d = G() | 0;
        j = i;
        i = 0;

        do {
          e = j;
          j = g >>> 31 | j << 1;
          g = i | g << 1;
          e = a << 1 | e >>> 31 | 0;
          n = a >>> 31 | c << 1 | 0;
          _c(k | 0, d | 0, e | 0, n | 0) | 0;
          p = G() | 0;
          o = p >> 31 | ((p | 0) < 0 ? -1 : 0) << 1;
          i = o & 1;
          a = _c(e | 0, n | 0, o & m | 0, (((p | 0) < 0 ? -1 : 0) >> 31 | ((p | 0) < 0 ? -1 : 0) << 1) & l | 0) | 0;
          c = G() | 0;
          h = h - 1 | 0;
        } while ((h | 0) != 0);

        k = j;
        j = 0;
      }

      h = 0;

      if (f | 0) {
        b[f >> 2] = a;
        b[f + 4 >> 2] = c;
      }

      o = (g | 0) >>> 31 | (k | h) << 1 | (h << 1 | g >>> 31) & 0 | j;
      p = (g << 1 | 0 >>> 31) & -2 | i;
      return (F(o | 0), p) | 0;
    }

    function bd(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0;
      g = S;
      S = S + 16 | 0;
      f = g | 0;
      ad(a, c, d, e, f) | 0;
      S = g;
      return (F(b[f + 4 >> 2] | 0), b[f >> 2] | 0) | 0;
    }

    function cd(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;

      if ((c | 0) < 32) {
        F(b >>> c | 0);
        return a >>> c | (b & (1 << c) - 1) << 32 - c;
      }

      F(0);
      return b >>> c - 32 | 0;
    }

    function dd(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;

      if ((c | 0) < 32) {
        F(b << c | (a & (1 << c) - 1 << 32 - c) >>> 32 - c | 0);
        return a << c;
      }

      F(a << c - 32 | 0);
      return 0;
    }

    function ed(a, b) {
      a = +a;
      b = +b;
      if (a != a) { return +b; }
      if (b != b) { return +a; }
      return +C(+a, +b);
    }

    function fd(a) {
      a = +a;
      return a >= 0.0 ? +p(a + .5) : +A(a - .5);
    }

    function gd(c, d, e) {
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0;

      if ((e | 0) >= 8192) {
        K(c | 0, d | 0, e | 0) | 0;
        return c | 0;
      }

      h = c | 0;
      g = c + e | 0;

      if ((c & 3) == (d & 3)) {
        while (c & 3) {
          if (!e) { return h | 0; }
          a[c >> 0] = a[d >> 0] | 0;
          c = c + 1 | 0;
          d = d + 1 | 0;
          e = e - 1 | 0;
        }

        e = g & -4 | 0;
        f = e - 64 | 0;

        while ((c | 0) <= (f | 0)) {
          b[c >> 2] = b[d >> 2];
          b[c + 4 >> 2] = b[d + 4 >> 2];
          b[c + 8 >> 2] = b[d + 8 >> 2];
          b[c + 12 >> 2] = b[d + 12 >> 2];
          b[c + 16 >> 2] = b[d + 16 >> 2];
          b[c + 20 >> 2] = b[d + 20 >> 2];
          b[c + 24 >> 2] = b[d + 24 >> 2];
          b[c + 28 >> 2] = b[d + 28 >> 2];
          b[c + 32 >> 2] = b[d + 32 >> 2];
          b[c + 36 >> 2] = b[d + 36 >> 2];
          b[c + 40 >> 2] = b[d + 40 >> 2];
          b[c + 44 >> 2] = b[d + 44 >> 2];
          b[c + 48 >> 2] = b[d + 48 >> 2];
          b[c + 52 >> 2] = b[d + 52 >> 2];
          b[c + 56 >> 2] = b[d + 56 >> 2];
          b[c + 60 >> 2] = b[d + 60 >> 2];
          c = c + 64 | 0;
          d = d + 64 | 0;
        }

        while ((c | 0) < (e | 0)) {
          b[c >> 2] = b[d >> 2];
          c = c + 4 | 0;
          d = d + 4 | 0;
        }
      } else {
        e = g - 4 | 0;

        while ((c | 0) < (e | 0)) {
          a[c >> 0] = a[d >> 0] | 0;
          a[c + 1 >> 0] = a[d + 1 >> 0] | 0;
          a[c + 2 >> 0] = a[d + 2 >> 0] | 0;
          a[c + 3 >> 0] = a[d + 3 >> 0] | 0;
          c = c + 4 | 0;
          d = d + 4 | 0;
        }
      }

      while ((c | 0) < (g | 0)) {
        a[c >> 0] = a[d >> 0] | 0;
        c = c + 1 | 0;
        d = d + 1 | 0;
      }

      return h | 0;
    }

    function hd(c, d, e) {
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0;
      h = c + e | 0;
      d = d & 255;

      if ((e | 0) >= 67) {
        while (c & 3) {
          a[c >> 0] = d;
          c = c + 1 | 0;
        }

        f = h & -4 | 0;
        i = d | d << 8 | d << 16 | d << 24;
        g = f - 64 | 0;

        while ((c | 0) <= (g | 0)) {
          b[c >> 2] = i;
          b[c + 4 >> 2] = i;
          b[c + 8 >> 2] = i;
          b[c + 12 >> 2] = i;
          b[c + 16 >> 2] = i;
          b[c + 20 >> 2] = i;
          b[c + 24 >> 2] = i;
          b[c + 28 >> 2] = i;
          b[c + 32 >> 2] = i;
          b[c + 36 >> 2] = i;
          b[c + 40 >> 2] = i;
          b[c + 44 >> 2] = i;
          b[c + 48 >> 2] = i;
          b[c + 52 >> 2] = i;
          b[c + 56 >> 2] = i;
          b[c + 60 >> 2] = i;
          c = c + 64 | 0;
        }

        while ((c | 0) < (f | 0)) {
          b[c >> 2] = i;
          c = c + 4 | 0;
        }
      }

      while ((c | 0) < (h | 0)) {
        a[c >> 0] = d;
        c = c + 1 | 0;
      }

      return h - e | 0;
    }

    function id(a) {
      a = +a;
      return a >= 0.0 ? +p(a + .5) : +A(a - .5);
    }

    function jd(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0;
      e = J() | 0;
      d = b[g >> 2] | 0;
      c = d + a | 0;

      if ((a | 0) > 0 & (c | 0) < (d | 0) | (c | 0) < 0) {
        M(c | 0) | 0;
        I(12);
        return -1;
      }

      if ((c | 0) > (e | 0)) { if (!(L(c | 0) | 0)) {
        I(12);
        return -1;
      } }
      b[g >> 2] = c;
      return d | 0;
    } // EMSCRIPTEN_END_FUNCS


    return {
      ___uremdi3: bd,
      _bitshift64Lshr: cd,
      _bitshift64Shl: dd,
      _calloc: Yc,
      _cellAreaKm2: ub,
      _cellAreaM2: vb,
      _cellAreaRads2: tb,
      _compact: Hb,
      _destroyLinkedPolygon: jc,
      _edgeLengthKm: pb,
      _edgeLengthM: qb,
      _emscripten_replace_memory: V,
      _exactEdgeLengthKm: xb,
      _exactEdgeLengthM: yb,
      _exactEdgeLengthRads: wb,
      _experimentalH3ToLocalIj: oc,
      _experimentalLocalIjToH3: pc,
      _free: Xc,
      _geoToH3: Sb,
      _getDestinationH3IndexFromUnidirectionalEdge: cc,
      _getH3IndexesFromUnidirectionalEdge: ec,
      _getH3UnidirectionalEdge: ac,
      _getH3UnidirectionalEdgeBoundary: gc,
      _getH3UnidirectionalEdgesFromHexagon: fc,
      _getOriginH3IndexFromUnidirectionalEdge: bc,
      _getPentagonIndexes: _b,
      _getRes0Indexes: va,
      _h3Distance: qc,
      _h3GetBaseCell: Ab,
      _h3GetFaces: Yb,
      _h3GetResolution: zb,
      _h3IndexesAreNeighbors: $b,
      _h3IsPentagon: Fb,
      _h3IsResClassIII: Kb,
      _h3IsValid: Bb,
      _h3Line: sc,
      _h3LineSize: rc,
      _h3SetToLinkedGeo: ka,
      _h3ToCenterChild: Gb,
      _h3ToChildren: Eb,
      _h3ToGeo: Vb,
      _h3ToGeoBoundary: Wb,
      _h3ToParent: Cb,
      _h3UnidirectionalEdgeIsValid: dc,
      _hexAreaKm2: nb,
      _hexAreaM2: ob,
      _hexRing: ea,
      _i64Subtract: _c,
      _kRing: $,
      _kRingDistances: aa,
      _llvm_minnum_f64: ed,
      _llvm_round_f64: fd,
      _malloc: Wc,
      _maxFaceCount: Xb,
      _maxH3ToChildrenSize: Db,
      _maxKringSize: _,
      _maxPolyfillSize: fa,
      _maxUncompactSize: Jb,
      _memcpy: gd,
      _memset: hd,
      _numHexagons: rb,
      _pentagonIndexCount: Zb,
      _pointDistKm: jb,
      _pointDistM: kb,
      _pointDistRads: ib,
      _polyfill: ga,
      _res0IndexCount: ua,
      _round: id,
      _sbrk: jd,
      _sizeOfCoordIJ: Ec,
      _sizeOfGeoBoundary: Ac,
      _sizeOfGeoCoord: zc,
      _sizeOfGeoPolygon: Cc,
      _sizeOfGeofence: Bc,
      _sizeOfH3Index: yc,
      _sizeOfLinkedGeoPolygon: Dc,
      _uncompact: Ib,
      establishStackSpace: Z,
      stackAlloc: W,
      stackRestore: Y,
      stackSave: X
    };
  }( // EMSCRIPTEN_END_ASM
  asmGlobalArg, asmLibraryArg, buffer);

  var ___uremdi3 = Module["___uremdi3"] = asm["___uremdi3"];

  var _bitshift64Lshr = Module["_bitshift64Lshr"] = asm["_bitshift64Lshr"];

  var _bitshift64Shl = Module["_bitshift64Shl"] = asm["_bitshift64Shl"];

  var _calloc = Module["_calloc"] = asm["_calloc"];

  var _cellAreaKm2 = Module["_cellAreaKm2"] = asm["_cellAreaKm2"];

  var _cellAreaM2 = Module["_cellAreaM2"] = asm["_cellAreaM2"];

  var _cellAreaRads2 = Module["_cellAreaRads2"] = asm["_cellAreaRads2"];

  var _compact = Module["_compact"] = asm["_compact"];

  var _destroyLinkedPolygon = Module["_destroyLinkedPolygon"] = asm["_destroyLinkedPolygon"];

  var _edgeLengthKm = Module["_edgeLengthKm"] = asm["_edgeLengthKm"];

  var _edgeLengthM = Module["_edgeLengthM"] = asm["_edgeLengthM"];

  var _emscripten_replace_memory = Module["_emscripten_replace_memory"] = asm["_emscripten_replace_memory"];

  var _exactEdgeLengthKm = Module["_exactEdgeLengthKm"] = asm["_exactEdgeLengthKm"];

  var _exactEdgeLengthM = Module["_exactEdgeLengthM"] = asm["_exactEdgeLengthM"];

  var _exactEdgeLengthRads = Module["_exactEdgeLengthRads"] = asm["_exactEdgeLengthRads"];

  var _experimentalH3ToLocalIj = Module["_experimentalH3ToLocalIj"] = asm["_experimentalH3ToLocalIj"];

  var _experimentalLocalIjToH3 = Module["_experimentalLocalIjToH3"] = asm["_experimentalLocalIjToH3"];

  var _free = Module["_free"] = asm["_free"];

  var _geoToH3 = Module["_geoToH3"] = asm["_geoToH3"];

  var _getDestinationH3IndexFromUnidirectionalEdge = Module["_getDestinationH3IndexFromUnidirectionalEdge"] = asm["_getDestinationH3IndexFromUnidirectionalEdge"];

  var _getH3IndexesFromUnidirectionalEdge = Module["_getH3IndexesFromUnidirectionalEdge"] = asm["_getH3IndexesFromUnidirectionalEdge"];

  var _getH3UnidirectionalEdge = Module["_getH3UnidirectionalEdge"] = asm["_getH3UnidirectionalEdge"];

  var _getH3UnidirectionalEdgeBoundary = Module["_getH3UnidirectionalEdgeBoundary"] = asm["_getH3UnidirectionalEdgeBoundary"];

  var _getH3UnidirectionalEdgesFromHexagon = Module["_getH3UnidirectionalEdgesFromHexagon"] = asm["_getH3UnidirectionalEdgesFromHexagon"];

  var _getOriginH3IndexFromUnidirectionalEdge = Module["_getOriginH3IndexFromUnidirectionalEdge"] = asm["_getOriginH3IndexFromUnidirectionalEdge"];

  var _getPentagonIndexes = Module["_getPentagonIndexes"] = asm["_getPentagonIndexes"];

  var _getRes0Indexes = Module["_getRes0Indexes"] = asm["_getRes0Indexes"];

  var _h3Distance = Module["_h3Distance"] = asm["_h3Distance"];

  var _h3GetBaseCell = Module["_h3GetBaseCell"] = asm["_h3GetBaseCell"];

  var _h3GetFaces = Module["_h3GetFaces"] = asm["_h3GetFaces"];

  var _h3GetResolution = Module["_h3GetResolution"] = asm["_h3GetResolution"];

  var _h3IndexesAreNeighbors = Module["_h3IndexesAreNeighbors"] = asm["_h3IndexesAreNeighbors"];

  var _h3IsPentagon = Module["_h3IsPentagon"] = asm["_h3IsPentagon"];

  var _h3IsResClassIII = Module["_h3IsResClassIII"] = asm["_h3IsResClassIII"];

  var _h3IsValid = Module["_h3IsValid"] = asm["_h3IsValid"];

  var _h3Line = Module["_h3Line"] = asm["_h3Line"];

  var _h3LineSize = Module["_h3LineSize"] = asm["_h3LineSize"];

  var _h3SetToLinkedGeo = Module["_h3SetToLinkedGeo"] = asm["_h3SetToLinkedGeo"];

  var _h3ToCenterChild = Module["_h3ToCenterChild"] = asm["_h3ToCenterChild"];

  var _h3ToChildren = Module["_h3ToChildren"] = asm["_h3ToChildren"];

  var _h3ToGeo = Module["_h3ToGeo"] = asm["_h3ToGeo"];

  var _h3ToGeoBoundary = Module["_h3ToGeoBoundary"] = asm["_h3ToGeoBoundary"];

  var _h3ToParent = Module["_h3ToParent"] = asm["_h3ToParent"];

  var _h3UnidirectionalEdgeIsValid = Module["_h3UnidirectionalEdgeIsValid"] = asm["_h3UnidirectionalEdgeIsValid"];

  var _hexAreaKm2 = Module["_hexAreaKm2"] = asm["_hexAreaKm2"];

  var _hexAreaM2 = Module["_hexAreaM2"] = asm["_hexAreaM2"];

  var _hexRing = Module["_hexRing"] = asm["_hexRing"];

  var _i64Subtract = Module["_i64Subtract"] = asm["_i64Subtract"];

  var _kRing = Module["_kRing"] = asm["_kRing"];

  var _kRingDistances = Module["_kRingDistances"] = asm["_kRingDistances"];

  var _llvm_minnum_f64 = Module["_llvm_minnum_f64"] = asm["_llvm_minnum_f64"];

  var _llvm_round_f64 = Module["_llvm_round_f64"] = asm["_llvm_round_f64"];

  var _malloc = Module["_malloc"] = asm["_malloc"];

  var _maxFaceCount = Module["_maxFaceCount"] = asm["_maxFaceCount"];

  var _maxH3ToChildrenSize = Module["_maxH3ToChildrenSize"] = asm["_maxH3ToChildrenSize"];

  var _maxKringSize = Module["_maxKringSize"] = asm["_maxKringSize"];

  var _maxPolyfillSize = Module["_maxPolyfillSize"] = asm["_maxPolyfillSize"];

  var _maxUncompactSize = Module["_maxUncompactSize"] = asm["_maxUncompactSize"];

  var _memcpy = Module["_memcpy"] = asm["_memcpy"];

  var _memset = Module["_memset"] = asm["_memset"];

  var _numHexagons = Module["_numHexagons"] = asm["_numHexagons"];

  var _pentagonIndexCount = Module["_pentagonIndexCount"] = asm["_pentagonIndexCount"];

  var _pointDistKm = Module["_pointDistKm"] = asm["_pointDistKm"];

  var _pointDistM = Module["_pointDistM"] = asm["_pointDistM"];

  var _pointDistRads = Module["_pointDistRads"] = asm["_pointDistRads"];

  var _polyfill = Module["_polyfill"] = asm["_polyfill"];

  var _res0IndexCount = Module["_res0IndexCount"] = asm["_res0IndexCount"];

  var _round = Module["_round"] = asm["_round"];

  var _sbrk = Module["_sbrk"] = asm["_sbrk"];

  var _sizeOfCoordIJ = Module["_sizeOfCoordIJ"] = asm["_sizeOfCoordIJ"];

  var _sizeOfGeoBoundary = Module["_sizeOfGeoBoundary"] = asm["_sizeOfGeoBoundary"];

  var _sizeOfGeoCoord = Module["_sizeOfGeoCoord"] = asm["_sizeOfGeoCoord"];

  var _sizeOfGeoPolygon = Module["_sizeOfGeoPolygon"] = asm["_sizeOfGeoPolygon"];

  var _sizeOfGeofence = Module["_sizeOfGeofence"] = asm["_sizeOfGeofence"];

  var _sizeOfH3Index = Module["_sizeOfH3Index"] = asm["_sizeOfH3Index"];

  var _sizeOfLinkedGeoPolygon = Module["_sizeOfLinkedGeoPolygon"] = asm["_sizeOfLinkedGeoPolygon"];

  var _uncompact = Module["_uncompact"] = asm["_uncompact"];

  var establishStackSpace = Module["establishStackSpace"] = asm["establishStackSpace"];
  var stackAlloc = Module["stackAlloc"] = asm["stackAlloc"];
  var stackRestore = Module["stackRestore"] = asm["stackRestore"];
  var stackSave = Module["stackSave"] = asm["stackSave"];
  Module["asm"] = asm;
  Module["cwrap"] = cwrap;
  Module["setValue"] = setValue;
  Module["getValue"] = getValue;
  Module["getTempRet0"] = getTempRet0;

  if (memoryInitializer) {
    if (!isDataURI(memoryInitializer)) {
      memoryInitializer = locateFile(memoryInitializer);
    }

    {
      addRunDependency("memory initializer");

      var applyMemoryInitializer = function (data) {
        if (data.byteLength) { data = new Uint8Array(data); }
        HEAPU8.set(data, GLOBAL_BASE);
        if (Module["memoryInitializerRequest"]) { delete Module["memoryInitializerRequest"].response; }
        removeRunDependency("memory initializer");
      };

      var doBrowserLoad = function () {
        readAsync(memoryInitializer, applyMemoryInitializer, function () {
          throw "could not load memory initializer " + memoryInitializer;
        });
      };

      var memoryInitializerBytes = tryParseAsDataURI(memoryInitializer);

      if (memoryInitializerBytes) {
        applyMemoryInitializer(memoryInitializerBytes.buffer);
      } else if (Module["memoryInitializerRequest"]) {
        var useRequest = function () {
          var request = Module["memoryInitializerRequest"];
          var response = request.response;

          if (request.status !== 200 && request.status !== 0) {
            var data = tryParseAsDataURI(Module["memoryInitializerRequestURL"]);

            if (data) {
              response = data.buffer;
            } else {
              console.warn("a problem seems to have happened with Module.memoryInitializerRequest, status: " + request.status + ", retrying " + memoryInitializer);
              doBrowserLoad();
              return;
            }
          }

          applyMemoryInitializer(response);
        };

        if (Module["memoryInitializerRequest"].response) {
          setTimeout(useRequest, 0);
        } else {
          Module["memoryInitializerRequest"].addEventListener("load", useRequest);
        }
      } else {
        doBrowserLoad();
      }
    }
  }

  var calledRun;

  dependenciesFulfilled = function runCaller() {
    if (!calledRun) { run(); }
    if (!calledRun) { dependenciesFulfilled = runCaller; }
  };

  function run(args) {
    args = args || arguments_;

    if (runDependencies > 0) {
      return;
    }

    preRun();
    if (runDependencies > 0) { return; }

    function doRun() {
      if (calledRun) { return; }
      calledRun = true;
      if (ABORT) { return; }
      initRuntime();
      preMain();
      if (Module["onRuntimeInitialized"]) { Module["onRuntimeInitialized"](); }
      postRun();
    }

    if (Module["setStatus"]) {
      Module["setStatus"]("Running...");
      setTimeout(function () {
        setTimeout(function () {
          Module["setStatus"]("");
        }, 1);
        doRun();
      }, 1);
    } else {
      doRun();
    }
  }

  Module["run"] = run;

  function abort(what) {
    if (Module["onAbort"]) {
      Module["onAbort"](what);
    }

    what += "";
    out(what);
    err(what);
    ABORT = true;
    throw "abort(" + what + "). Build with -s ASSERTIONS=1 for more info.";
  }

  Module["abort"] = abort;

  if (Module["preInit"]) {
    if (typeof Module["preInit"] == "function") { Module["preInit"] = [Module["preInit"]]; }

    while (Module["preInit"].length > 0) {
      Module["preInit"].pop()();
    }
  }
  run();
  return libh3;
}(typeof libh3 === 'object' ? libh3 : {});

/*
 * Copyright 2018-2019 Uber Technologies, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// Define the C bindings for the h3 library
// Add some aliases to make the function definitions more intelligible
var NUMBER = 'number';
var BOOLEAN = NUMBER;
var H3_LOWER = NUMBER;
var H3_UPPER = NUMBER;
var RESOLUTION = NUMBER;
var POINTER = NUMBER; // Define the bindings to functions in the C lib. Functions are defined as
// [name, return type, [arg types]]. You must run `npm run build-emscripten`
// before new functions added here will be available.

var BINDINGS = [// The size functions are inserted via build/sizes.h
['sizeOfH3Index', NUMBER], ['sizeOfGeoCoord', NUMBER], ['sizeOfGeoBoundary', NUMBER], ['sizeOfGeoPolygon', NUMBER], ['sizeOfGeofence', NUMBER], ['sizeOfLinkedGeoPolygon', NUMBER], ['sizeOfCoordIJ', NUMBER], // The remaining functions are defined in the core lib in h3Api.h
['h3IsValid', BOOLEAN, [H3_LOWER, H3_UPPER]], ['geoToH3', H3_LOWER, [NUMBER, NUMBER, RESOLUTION]], ['h3ToGeo', null, [H3_LOWER, H3_UPPER, POINTER]], ['h3ToGeoBoundary', null, [H3_LOWER, H3_UPPER, POINTER]], ['maxKringSize', NUMBER, [NUMBER]], ['kRing', null, [H3_LOWER, H3_UPPER, NUMBER, POINTER]], ['kRingDistances', null, [H3_LOWER, H3_UPPER, NUMBER, POINTER, POINTER]], ['hexRing', null, [H3_LOWER, H3_UPPER, NUMBER, POINTER]], ['maxPolyfillSize', NUMBER, [POINTER, RESOLUTION]], ['polyfill', null, [POINTER, RESOLUTION, POINTER]], ['h3SetToLinkedGeo', null, [POINTER, NUMBER, POINTER]], ['destroyLinkedPolygon', null, [POINTER]], ['compact', NUMBER, [POINTER, POINTER, NUMBER]], ['uncompact', NUMBER, [POINTER, NUMBER, POINTER, NUMBER, RESOLUTION]], ['maxUncompactSize', NUMBER, [POINTER, NUMBER, RESOLUTION]], ['h3IsPentagon', BOOLEAN, [H3_LOWER, H3_UPPER]], ['h3IsResClassIII', BOOLEAN, [H3_LOWER, H3_UPPER]], ['h3GetBaseCell', NUMBER, [H3_LOWER, H3_UPPER]], ['h3GetResolution', NUMBER, [H3_LOWER, H3_UPPER]], ['maxFaceCount', NUMBER, [H3_LOWER, H3_UPPER]], ['h3GetFaces', null, [H3_LOWER, H3_UPPER, POINTER]], ['h3ToParent', H3_LOWER, [H3_LOWER, H3_UPPER, RESOLUTION]], ['h3ToChildren', null, [H3_LOWER, H3_UPPER, RESOLUTION, POINTER]], ['h3ToCenterChild', H3_LOWER, [H3_LOWER, H3_UPPER, RESOLUTION]], ['maxH3ToChildrenSize', NUMBER, [H3_LOWER, H3_UPPER, RESOLUTION]], ['h3IndexesAreNeighbors', BOOLEAN, [H3_LOWER, H3_UPPER, H3_LOWER, H3_UPPER]], ['getH3UnidirectionalEdge', H3_LOWER, [H3_LOWER, H3_UPPER, H3_LOWER, H3_UPPER]], ['getOriginH3IndexFromUnidirectionalEdge', H3_LOWER, [H3_LOWER, H3_UPPER]], ['getDestinationH3IndexFromUnidirectionalEdge', H3_LOWER, [H3_LOWER, H3_UPPER]], ['h3UnidirectionalEdgeIsValid', BOOLEAN, [H3_LOWER, H3_UPPER]], ['getH3IndexesFromUnidirectionalEdge', null, [H3_LOWER, H3_UPPER, POINTER]], ['getH3UnidirectionalEdgesFromHexagon', null, [H3_LOWER, H3_UPPER, POINTER]], ['getH3UnidirectionalEdgeBoundary', null, [H3_LOWER, H3_UPPER, POINTER]], ['h3Distance', NUMBER, [H3_LOWER, H3_UPPER, H3_LOWER, H3_UPPER]], ['h3Line', NUMBER, [H3_LOWER, H3_UPPER, H3_LOWER, H3_UPPER, POINTER]], ['h3LineSize', NUMBER, [H3_LOWER, H3_UPPER, H3_LOWER, H3_UPPER]], ['experimentalH3ToLocalIj', NUMBER, [H3_LOWER, H3_UPPER, H3_LOWER, H3_UPPER, POINTER]], ['experimentalLocalIjToH3', NUMBER, [H3_LOWER, H3_UPPER, POINTER, POINTER]], ['hexAreaM2', NUMBER, [RESOLUTION]], ['hexAreaKm2', NUMBER, [RESOLUTION]], ['edgeLengthM', NUMBER, [RESOLUTION]], ['edgeLengthKm', NUMBER, [RESOLUTION]], ['pointDistM', NUMBER, [POINTER, POINTER]], ['pointDistKm', NUMBER, [POINTER, POINTER]], ['pointDistRads', NUMBER, [POINTER, POINTER]], ['cellAreaM2', NUMBER, [H3_LOWER, H3_UPPER]], ['cellAreaKm2', NUMBER, [H3_LOWER, H3_UPPER]], ['cellAreaRads2', NUMBER, [H3_LOWER, H3_UPPER]], ['exactEdgeLengthM', NUMBER, [H3_LOWER, H3_UPPER]], ['exactEdgeLengthKm', NUMBER, [H3_LOWER, H3_UPPER]], ['exactEdgeLengthRads', NUMBER, [H3_LOWER, H3_UPPER]], ['numHexagons', NUMBER, [RESOLUTION]], ['getRes0Indexes', null, [POINTER]], ['res0IndexCount', NUMBER], ['getPentagonIndexes', null, [NUMBER, POINTER]], ['pentagonIndexCount', NUMBER]];

/*
 * Copyright 2018-2019 Uber Technologies, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var H3 = {}; // Create the bound functions themselves

BINDINGS.forEach(function bind(def) {
  H3[def[0]] = libh3.cwrap.apply(libh3, def);
}); // Alias the hexidecimal base for legibility

var BASE_16 = 16; // ----------------------------------------------------------------------------
// Byte size imports

var SZ_INT = 4;
var SZ_PTR = 4;
var SZ_DBL = 8;
var SZ_H3INDEX = H3.sizeOfH3Index();
var SZ_GEOCOORD = H3.sizeOfGeoCoord();
var SZ_GEOBOUNDARY = H3.sizeOfGeoBoundary();
var SZ_GEOPOLYGON = H3.sizeOfGeoPolygon();
var SZ_GEOFENCE = H3.sizeOfGeofence();
var SZ_LINKED_GEOPOLYGON = H3.sizeOfLinkedGeoPolygon();
var SZ_COORDIJ = H3.sizeOfCoordIJ(); // ----------------------------------------------------------------------------
// Custom types

/**
 * 64-bit hexidecimal string representation of an H3 index
 * @static
 * @typedef {string} H3Index
 */

/**
 * 64-bit hexidecimal string representation of an H3 index,
 * or two 32-bit integers in little endian order in an array.
 * @static
 * @typedef {string | number[]} H3IndexInput
 */

/**
 * Coordinates as an `{i, j}` pair
 * @static
 * @typedef CoordIJ
 * @type {Object}
 * @property {number} i
 * @property {number} j
 */
// ----------------------------------------------------------------------------
// Unit constants

/**
 * Length/Area units
 * @static
 * @typedef UNITS
 * @type {Object}
 * @property {string} m
 * @property {string} m2
 * @property {string} km
 * @property {string} km2
 * @property {string} rads
 * @property {string} rads2
 */

var UNITS = {
  m: 'm',
  m2: 'm2',
  km: 'km',
  km2: 'km2',
  rads: 'rads',
  rads2: 'rads2'
}; // ----------------------------------------------------------------------------
// Utilities and helpers

/**
 * Validate a resolution, throwing an error if invalid
 * @private
 * @param  {mixed} res Value to validate
 * @throws {Error}     Error if invalid
 */

function validateRes(res) {
  if (typeof res !== 'number' || res < 0 || res > 15 || Math.floor(res) !== res) {
    throw new Error(("Invalid resolution: " + res));
  }
}

var INVALID_HEXIDECIMAL_CHAR = /[^0-9a-fA-F]/;
/**
 * Convert an H3 index (64-bit hexidecimal string) into a "split long" - a pair of 32-bit ints
 * @private
 * @param  {H3IndexInput} h3Index  H3 index to check
 * @return {number[]}         A two-element array with 32 lower bits and 32 upper bits
 */

function h3IndexToSplitLong(h3Index) {
  if (Array.isArray(h3Index) && h3Index.length === 2 && Number.isInteger(h3Index[0]) && Number.isInteger(h3Index[1])) {
    return h3Index;
  }

  if (typeof h3Index !== 'string' || INVALID_HEXIDECIMAL_CHAR.test(h3Index)) {
    return [0, 0];
  }

  var upper = parseInt(h3Index.substring(0, h3Index.length - 8), BASE_16);
  var lower = parseInt(h3Index.substring(h3Index.length - 8), BASE_16);
  return [lower, upper];
}
/**
 * Convert a 32-bit int to a hexdecimal string
 * @private
 * @param  {number} num  Integer to convert
 * @return {H3Index}     Hexidecimal string
 */

function hexFrom32Bit(num) {
  if (num >= 0) {
    return num.toString(BASE_16);
  } // Handle negative numbers


  num = num & 0x7fffffff;
  var tempStr = zeroPad(8, num.toString(BASE_16));
  var topNum = (parseInt(tempStr[0], BASE_16) + 8).toString(BASE_16);
  tempStr = topNum + tempStr.substring(1);
  return tempStr;
}
/**
 * Get a H3 index from a split long (pair of 32-bit ints)
 * @private
 * @param  {number} lower Lower 32 bits
 * @param  {number} upper Upper 32 bits
 * @return {H3Index}       H3 index
 */


function splitLongToh3Index(lower, upper) {
  return hexFrom32Bit(upper) + zeroPad(8, hexFrom32Bit(lower));
}
/**
 * Zero-pad a string to a given length
 * @private
 * @param  {number} fullLen Target length
 * @param  {string} numStr  String to zero-pad
 * @return {string}         Zero-padded string
 */

function zeroPad(fullLen, numStr) {
  var numZeroes = fullLen - numStr.length;
  var outStr = '';

  for (var i = 0; i < numZeroes; i++) {
    outStr += '0';
  }

  outStr = outStr + numStr;
  return outStr;
}
/**
 * Populate a C-appropriate Geofence struct from a polygon array
 * @private
 * @param  {Array[]} polygonArray Polygon, as an array of coordinate pairs
 * @param  {number}  geofence     C pointer to a Geofence struct
 * @param  {boolean} isGeoJson    Whether coordinates are in [lng, lat] order per GeoJSON spec
 * @return {number}               C pointer to populated Geofence struct
 */


function polygonArrayToGeofence(polygonArray, geofence, isGeoJson) {
  var numVerts = polygonArray.length;

  var geoCoordArray = libh3._calloc(numVerts, SZ_GEOCOORD); // Support [lng, lat] pairs if GeoJSON is specified


  var latIndex = isGeoJson ? 1 : 0;
  var lngIndex = isGeoJson ? 0 : 1;

  for (var i = 0; i < numVerts * 2; i += 2) {
    libh3.HEAPF64.set([polygonArray[i / 2][latIndex], polygonArray[i / 2][lngIndex]].map(degsToRads), geoCoordArray / SZ_DBL + i);
  }

  libh3.HEAPU32.set([numVerts, geoCoordArray], geofence / SZ_INT);
  return geofence;
}
/**
 * Create a C-appropriate GeoPolygon struct from an array of polygons
 * @private
 * @param  {Array[]} coordinates  Array of polygons, each an array of coordinate pairs
 * @param  {boolean} isGeoJson    Whether coordinates are in [lng, lat] order per GeoJSON spec
 * @return {number}               C pointer to populated GeoPolygon struct
 */


function coordinatesToGeoPolygon(coordinates, isGeoJson) {
  // Any loops beyond the first loop are holes
  var numHoles = coordinates.length - 1;

  var geoPolygon = libh3._calloc(SZ_GEOPOLYGON); // Byte positions within the struct


  var geofenceOffset = 0;
  var numHolesOffset = geofenceOffset + SZ_GEOFENCE;
  var holesOffset = numHolesOffset + SZ_INT; // geofence is first part of struct

  polygonArrayToGeofence(coordinates[0], geoPolygon + geofenceOffset, isGeoJson);
  var holes;

  if (numHoles > 0) {
    holes = libh3._calloc(numHoles, SZ_GEOFENCE);

    for (var i = 0; i < numHoles; i++) {
      polygonArrayToGeofence(coordinates[i + 1], holes + SZ_GEOFENCE * i, isGeoJson);
    }
  }

  libh3.setValue(geoPolygon + numHolesOffset, numHoles, 'i32');
  libh3.setValue(geoPolygon + holesOffset, holes, 'i32');
  return geoPolygon;
}
/**
 * Free memory allocated for a GeoPolygon struct. It is an error to access the struct
 * after passing it to this method.
 * @private
 * @return {number} geoPolygon C pointer to populated GeoPolygon struct
 */


function destroyGeoPolygon(geoPolygon) {
  // Byte positions within the struct
  var geofenceOffset = 0;
  var numHolesOffset = geofenceOffset + SZ_GEOFENCE;
  var holesOffset = numHolesOffset + SZ_INT; // Offset of the geofence vertex array pointer within the Geofence struct

  var geofenceArrayOffset = SZ_INT; // Free the outer vertex array

  libh3._free(libh3.getValue(geoPolygon + geofenceOffset + geofenceArrayOffset, 'i8*')); // Free the vertex array for the holes, if any


  var numHoles = libh3.getValue(geoPolygon + numHolesOffset, 'i32');

  if (numHoles > 0) {
    var holes = libh3.getValue(geoPolygon + holesOffset, 'i32');

    for (var i = 0; i < numHoles; i++) {
      libh3._free(libh3.getValue(holes + SZ_GEOFENCE * i + geofenceArrayOffset, 'i8*'));
    }

    libh3._free(holes);
  }

  libh3._free(geoPolygon);
}
/**
 * Read a long value, returning the lower and upper portions as separate 32-bit integers.
 * Because the upper bits are returned via side effect, the argument to this function is
 * intended to be the invocation that caused the side effect, e.g. readLong(H3.getSomeLong())
 * @private
 * @param  {number} invocation Invoked function returning a long value. The actual return
 *                             value of these functions is a 32-bit integer.
 * @return {number}            Long value as a [lower, upper] pair
 */


function readLong(invocation) {
  // Upper 32-bits of the long set via side-effect
  var upper = libh3.getTempRet0();
  return [invocation, upper];
}
/**
 * Read an H3 index from a C return value. As with readLong, the argument to this function
 * is intended to be an invocation, e.g. readH3Index(H3.getSomeAddress()), to help ensure that
 * the temp value storing the upper bits of the long is still set.
 * @private
 * @param  {number} invocation  Invoked function returning a single H3 index
 * @return {H3Index}            H3 index, or null if index was invalid
 */


function readH3Index(invocation) {
  var ref = readLong(invocation);
  var lower = ref[0];
  var upper = ref[1]; // The lower bits are allowed to be 0s, but if the upper bits are 0
  // this represents an invalid H3 index

  return upper ? splitLongToh3Index(lower, upper) : null;
}
/**
 * Read an H3 index from a pointer to C memory.
 * @private
 * @param  {number} cAddress  Pointer to allocated C memory
 * @param {number} offset     Offset, in number of H3 indexes, in case we're
 *                            reading an array
 * @return {H3Index}          H3 index, or null if index was invalid
 */


function readH3IndexFromPointer(cAddress, offset) {
  if ( offset === void 0 ) offset = 0;

  var lower = libh3.getValue(cAddress + SZ_INT * offset * 2, 'i32');
  var upper = libh3.getValue(cAddress + SZ_INT * (offset * 2 + 1), 'i32'); // The lower bits are allowed to be 0s, but if the upper bits are 0
  // this represents an invalid H3 index

  return upper ? splitLongToh3Index(lower, upper) : null;
}
/**
 * Store an H3 index in C memory. Primarily used as an efficient way to
 * write sets of hexagons.
 * @private
 * @param  {H3IndexInput} h3Index  H3 index to store
 * @param  {number} cAddress  Pointer to allocated C memory
 * @param {number} offset     Offset, in number of H3 indexes from beginning
 *                            of the current array
 */


function storeH3Index(h3Index, cAddress, offset) {
  // HEAPU32 is a typed array projection on the index space
  // as unsigned 32-bit integers. This means the index needs
  // to be divided by SZ_INT (4) to access correctly. Also,
  // the H3 index is 64 bits, so we skip by twos as we're writing
  // to 32-bit integers in the proper order.
  libh3.HEAPU32.set(h3IndexToSplitLong(h3Index), cAddress / SZ_INT + 2 * offset);
}
/**
 * Read an array of 64-bit H3 indexes from C and convert to a JS array of
 * H3 index strings
 * @private
 * @param  {number} cAddress    Pointer to C ouput array
 * @param  {number} maxCount    Max number of hexagons in array. Hexagons with
 *                              the value 0 will be skipped, so this isn't
 *                              necessarily the length of the output array.
 * @return {H3Index[]}          Array of H3 indexes
 */


function readArrayOfHexagons(cAddress, maxCount) {
  var out = [];

  for (var i = 0; i < maxCount; i++) {
    var h3Index = readH3IndexFromPointer(cAddress, i);

    if (h3Index !== null) {
      out.push(h3Index);
    }
  }

  return out;
}
/**
 * Store an array of H3 index strings as a C array of 64-bit integers.
 * @private
 * @param  {number} cAddress    Pointer to C input array
 * @param  {H3IndexInput[]} hexagons H3 indexes to pass to the C lib
 */


function storeArrayOfHexagons(cAddress, hexagons) {
  // Assuming the cAddress points to an already appropriately
  // allocated space
  var count = hexagons.length;

  for (var i = 0; i < count; i++) {
    storeH3Index(hexagons[i], cAddress, i);
  }
}
/**
 * Populate a C-appropriate GeoCoord struct from a [lat, lng] array
 * @private
 * @param {number} lat     Coordinate latitude
 * @param {number} lng     Coordinate longitude
 * @return {number}        C pointer to populated GeoCoord struct
 */


function storeGeoCoord(lat, lng) {
  var geoCoord = libh3._calloc(1, SZ_GEOCOORD);

  libh3.HEAPF64.set([lat, lng].map(degsToRads), geoCoord / SZ_DBL);
  return geoCoord;
}

function readSingleCoord(cAddress) {
  return radsToDegs(libh3.getValue(cAddress, 'double'));
}
/**
 * Read a GeoCoord from C and return a [lat, lng] pair.
 * @private
 * @param  {number} cAddress    Pointer to C struct
 * @return {number[]}           [lat, lng] pair
 */


function readGeoCoord(cAddress) {
  return [readSingleCoord(cAddress), readSingleCoord(cAddress + SZ_DBL)];
}
/**
 * Read a GeoCoord from C and return a GeoJSON-style [lng, lat] pair.
 * @private
 * @param  {number} cAddress    Pointer to C struct
 * @return {number[]}           [lng, lat] pair
 */


function readGeoCoordGeoJson(cAddress) {
  return [readSingleCoord(cAddress + SZ_DBL), readSingleCoord(cAddress)];
}
/**
 * Read the GeoBoundary structure into a list of geo coordinate pairs
 * @private
 * @param {number}  geoBoundary     C pointer to GeoBoundary struct
 * @param {boolean} geoJsonCoords   Whether to provide GeoJSON coordinate order: [lng, lat]
 * @param {boolean} closedLoop      Whether to close the loop
 * @return {Array[]}                Array of geo coordinate pairs
 */


function readGeoBoundary(geoBoundary, geoJsonCoords, closedLoop) {
  var numVerts = libh3.getValue(geoBoundary, 'i32'); // Note that though numVerts is an int, the coordinate doubles have to be
  // aligned to 8 bytes, hence the 8-byte offset here

  var vertsPos = geoBoundary + SZ_DBL;
  var out = []; // Support [lng, lat] pairs if GeoJSON is specified

  var readCoord = geoJsonCoords ? readGeoCoordGeoJson : readGeoCoord;

  for (var i = 0; i < numVerts * 2; i += 2) {
    out.push(readCoord(vertsPos + SZ_DBL * i));
  }

  if (closedLoop) {
    // Close loop if GeoJSON is specified
    out.push(out[0]);
  }

  return out;
}
/**
 * Read the LinkedGeoPolygon structure into a nested array of MultiPolygon coordinates
 * @private
 * @param {number}  polygon         C pointer to LinkedGeoPolygon struct
 * @param {boolean} formatAsGeoJson Whether to provide GeoJSON output: [lng, lat], closed loops
 * @return {number[][][][]}         MultiPolygon-style output.
 */


function readMultiPolygon(polygon, formatAsGeoJson) {
  var output = [];
  var readCoord = formatAsGeoJson ? readGeoCoordGeoJson : readGeoCoord;
  var loops;
  var loop;
  var coords;
  var coord; // Loop through the linked structure, building the output

  while (polygon) {
    output.push(loops = []); // Follow ->first pointer

    loop = libh3.getValue(polygon, 'i8*');

    while (loop) {
      loops.push(coords = []); // Follow ->first pointer

      coord = libh3.getValue(loop, 'i8*');

      while (coord) {
        coords.push(readCoord(coord)); // Follow ->next pointer

        coord = libh3.getValue(coord + SZ_DBL * 2, 'i8*');
      }

      if (formatAsGeoJson) {
        // Close loop if GeoJSON is requested
        coords.push(coords[0]);
      } // Follow ->next pointer


      loop = libh3.getValue(loop + SZ_PTR * 2, 'i8*');
    } // Follow ->next pointer


    polygon = libh3.getValue(polygon + SZ_PTR * 2, 'i8*');
  }

  return output;
}
/**
 * Read a CoordIJ from C and return an {i, j} pair.
 * @private
 * @param  {number} cAddress    Pointer to C struct
 * @return {CoordIJ}            {i, j} pair
 */


function readCoordIJ(cAddress) {
  return {
    i: libh3.getValue(cAddress, 'i32'),
    j: libh3.getValue(cAddress + SZ_INT, 'i32')
  };
}
/**
 * Store an {i, j} pair to a C CoordIJ struct.
 * @private
 * @param  {number} cAddress    Pointer to C struct
 * @return {CoordIJ}            {i, j} pair
 */


function storeCoordIJ(cAddress, ref) {
  var i = ref.i;
  var j = ref.j;

  libh3.setValue(cAddress, i, 'i32');
  libh3.setValue(cAddress + SZ_INT, j, 'i32');
}
/**
 * Read an array of positive integers array from C. Negative
 * values are considered invalid and ignored in output.
 * @private
 * @param  {number} cAddress    Pointer to C array
 * @param  {number} count       Length of C array
 * @return {number[]}           Javascript integer array
 */


function readArrayOfPositiveIntegers(cAddress, count) {
  var out = [];

  for (var i = 0; i < count; i++) {
    var int = libh3.getValue(cAddress + SZ_INT * i, 'i32');

    if (int >= 0) {
      out.push(int);
    }
  }

  return out;
} // ----------------------------------------------------------------------------
// Public API functions: Core

/**
 * Whether a given string represents a valid H3 index
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to check
 * @return {boolean}          Whether the index is valid
 */


function h3IsValid(h3Index) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  return Boolean(H3.h3IsValid(lower, upper));
}
/**
 * Whether the given H3 index is a pentagon
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to check
 * @return {boolean}          isPentagon
 */

function h3IsPentagon(h3Index) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  return Boolean(H3.h3IsPentagon(lower, upper));
}
/**
 * Whether the given H3 index is in a Class III resolution (rotated versus
 * the icosahedron and subject to shape distortion adding extra points on
 * icosahedron edges, making them not true hexagons).
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to check
 * @return {boolean}          isResClassIII
 */

function h3IsResClassIII(h3Index) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  return Boolean(H3.h3IsResClassIII(lower, upper));
}
/**
 * Get the number of the base cell for a given H3 index
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to get the base cell for
 * @return {number}           Index of the base cell (0-121)
 */

function h3GetBaseCell(h3Index) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  return H3.h3GetBaseCell(lower, upper);
}
/**
 * Get the indices of all icosahedron faces intersected by a given H3 index
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to get faces for
 * @return {number[]}         Indices (0-19) of all intersected faces
 */

function h3GetFaces(h3Index) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  var count = H3.maxFaceCount(lower, upper);

  var faces = libh3._malloc(SZ_INT * count);

  H3.h3GetFaces(lower, upper, faces);
  var out = readArrayOfPositiveIntegers(faces, count);

  libh3._free(faces);

  return out;
}
/**
 * Returns the resolution of an H3 index
 * @static
 * @param  {H3IndexInput} h3Index H3 index to get resolution
 * @return {number}          The number (0-15) resolution, or -1 if invalid
 */

function h3GetResolution(h3Index) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];

  if (!H3.h3IsValid(lower, upper)) {
    // Compatability with stated API
    return -1;
  }

  return H3.h3GetResolution(lower, upper);
}
/**
 * Get the hexagon containing a lat,lon point
 * @static
 * @param  {number} lat Latitude of point
 * @param  {number} lng Longtitude of point
 * @param  {number} res Resolution of hexagons to return
 * @return {H3Index}    H3 index
 */

function geoToH3(lat, lng, res) {
  var latlng = libh3._malloc(SZ_GEOCOORD); // Slightly more efficient way to set the memory


  libh3.HEAPF64.set([lat, lng].map(degsToRads), latlng / SZ_DBL); // Read value as a split long

  var h3Index = readH3Index(H3.geoToH3(latlng, res));

  libh3._free(latlng);

  return h3Index;
}
/**
 * Get the lat,lon center of a given hexagon
 * @static
 * @param  {H3IndexInput} h3Index  H3 index
 * @return {number[]}         Point as a [lat, lng] pair
 */

function h3ToGeo(h3Index) {
  var latlng = libh3._malloc(SZ_GEOCOORD);

  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  H3.h3ToGeo(lower, upper, latlng);
  var out = readGeoCoord(latlng);

  libh3._free(latlng);

  return out;
}
/**
 * Get the vertices of a given hexagon (or pentagon), as an array of [lat, lng]
 * points. For pentagons and hexagons on the edge of an icosahedron face, this
 * function may return up to 10 vertices.
 * @static
 * @param  {H3Index} h3Index          H3 index
 * @param {boolean} [formatAsGeoJson] Whether to provide GeoJSON output: [lng, lat], closed loops
 * @return {number[][]}               Array of [lat, lng] pairs
 */

function h3ToGeoBoundary(h3Index, formatAsGeoJson) {
  var geoBoundary = libh3._malloc(SZ_GEOBOUNDARY);

  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  H3.h3ToGeoBoundary(lower, upper, geoBoundary);
  var out = readGeoBoundary(geoBoundary, formatAsGeoJson, formatAsGeoJson);

  libh3._free(geoBoundary);

  return out;
} // ----------------------------------------------------------------------------
// Public API functions: Algorithms

/**
 * Get the parent of the given hexagon at a particular resolution
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to get parent for
 * @param  {number} res       Resolution of hexagon to return
 * @return {H3Index}          H3 index of parent, or null for invalid input
 */

function h3ToParent(h3Index, res) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  return readH3Index(H3.h3ToParent(lower, upper, res));
}
/**
 * Get the children/descendents of the given hexagon at a particular resolution
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to get children for
 * @param  {number} res       Resolution of hexagons to return
 * @return {H3Index[]}        H3 indexes of children, or empty array for invalid input
 */

function h3ToChildren(h3Index, res) {
  // Bad input in this case can potentially result in high computation volume
  // using the current C algorithm. Validate and return an empty array on failure.
  if (!h3IsValid(h3Index)) {
    return [];
  }

  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  var maxCount = H3.maxH3ToChildrenSize(lower, upper, res);

  var hexagons = libh3._calloc(maxCount, SZ_H3INDEX);

  H3.h3ToChildren(lower, upper, res, hexagons);
  var out = readArrayOfHexagons(hexagons, maxCount);

  libh3._free(hexagons);

  return out;
}
/**
 * Get the center child of the given hexagon at a particular resolution
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to get center child for
 * @param  {number} res       Resolution of hexagon to return
 * @return {H3Index}          H3 index of child, or null for invalid input
 */

function h3ToCenterChild(h3Index, res) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  return readH3Index(H3.h3ToCenterChild(lower, upper, res));
}
/**
 * Get all hexagons in a k-ring around a given center. The order of the hexagons is undefined.
 * @static
 * @param  {H3IndexInput} h3Index  H3 index of center hexagon
 * @param  {number} ringSize  Radius of k-ring
 * @return {H3Index[]}        H3 indexes for all hexagons in ring
 */

function kRing(h3Index, ringSize) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  var maxCount = H3.maxKringSize(ringSize);

  var hexagons = libh3._calloc(maxCount, SZ_H3INDEX);

  H3.kRing(lower, upper, ringSize, hexagons);
  var out = readArrayOfHexagons(hexagons, maxCount);

  libh3._free(hexagons);

  return out;
}
/**
 * Get all hexagons in a k-ring around a given center, in an array of arrays
 * ordered by distance from the origin. The order of the hexagons within each ring is undefined.
 * @static
 * @param  {H3IndexInput} h3Index  H3 index of center hexagon
 * @param  {number} ringSize  Radius of k-ring
 * @return {H3Index[][]}      Array of arrays with H3 indexes for all hexagons each ring
 */

function kRingDistances(h3Index, ringSize) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  var maxCount = H3.maxKringSize(ringSize);

  var kRings = libh3._calloc(maxCount, SZ_H3INDEX);

  var distances = libh3._calloc(maxCount, SZ_INT);

  H3.kRingDistances(lower, upper, ringSize, kRings, distances); // Create an array of empty arrays to hold the output

  var out = [];

  for (var i = 0; i < ringSize + 1; i++) {
    out.push([]);
  } // Read the array of hexagons, putting them into the appropriate rings


  for (var i$1 = 0; i$1 < maxCount * 2; i$1 += 2) {
    var hexLower = libh3.getValue(kRings + SZ_INT * i$1, 'i32');
    var hexUpper = libh3.getValue(kRings + SZ_INT * (i$1 + 1), 'i32');
    var index = libh3.getValue(distances + SZ_INT * (i$1 / 2), 'i32');

    if (hexLower !== 0 || hexUpper !== 0) {
      out[index].push(splitLongToh3Index(hexLower, hexUpper));
    }
  }

  libh3._free(kRings);

  libh3._free(distances);

  return out;
}
/**
 * Get all hexagons in a hollow hexagonal ring centered at origin with sides of a given length.
 * Unlike kRing, this function will throw an error if there is a pentagon anywhere in the ring.
 * @static
 * @param  {H3IndexInput} h3Index  H3 index of center hexagon
 * @param  {number} ringSize  Radius of ring
 * @return {H3Index[]}        H3 indexes for all hexagons in ring
 * @throws {Error}            If the algorithm could not calculate the ring
 */

function hexRing(h3Index, ringSize) {
  var maxCount = ringSize === 0 ? 1 : 6 * ringSize;

  var hexagons = libh3._calloc(maxCount, SZ_H3INDEX);

  var retVal = H3.hexRing.apply(H3, h3IndexToSplitLong(h3Index).concat( [ringSize], [hexagons] ));

  if (retVal !== 0) {
    libh3._free(hexagons);

    throw new Error('Failed to get hexRing (encountered a pentagon?)');
  }

  var out = readArrayOfHexagons(hexagons, maxCount);

  libh3._free(hexagons);

  return out;
}
/**
 * Get all hexagons with centers contained in a given polygon. The polygon
 * is specified with GeoJson semantics as an array of loops. Each loop is
 * an array of [lat, lng] pairs (or [lng, lat] if isGeoJson is specified).
 * The first loop is the perimeter of the polygon, and subsequent loops are
 * expected to be holes.
 * @static
 * @param  {number[][] | number[][][]} coordinates
 *                                  Array of loops, or a single loop
 * @param  {number} res             Resolution of hexagons to return
 * @param  {boolean} [isGeoJson]    Whether to expect GeoJson-style [lng, lat]
 *                                  pairs instead of [lat, lng]
 * @return {H3Index[]}              H3 indexes for all hexagons in polygon
 */

function polyfill(coordinates, res, isGeoJson) {
  validateRes(res);
  isGeoJson = Boolean(isGeoJson); // Guard against empty input

  if (coordinates.length === 0 || coordinates[0].length === 0) {
    return [];
  } // Wrap to expected format if a single loop is provided


  if (typeof coordinates[0][0] === 'number') {
    coordinates = [coordinates];
  }

  var geoPolygon = coordinatesToGeoPolygon(coordinates, isGeoJson);
  var arrayLen = H3.maxPolyfillSize(geoPolygon, res);

  var hexagons = libh3._calloc(arrayLen, SZ_H3INDEX);

  H3.polyfill(geoPolygon, res, hexagons);
  var out = readArrayOfHexagons(hexagons, arrayLen);

  libh3._free(hexagons);

  destroyGeoPolygon(geoPolygon);
  return out;
}
/**
 * Get the outlines of a set of H3 hexagons, returned in GeoJSON MultiPolygon
 * format (an array of polygons, each with an array of loops, each an array of
 * coordinates). Coordinates are returned as [lat, lng] pairs unless GeoJSON
 * is requested.
 *
 * It is the responsibility of the caller to ensure that all hexagons in the
 * set have the same resolution and that the set contains no duplicates. Behavior
 * is undefined if duplicates or multiple resolutions are present, and the
 * algorithm may produce unexpected or invalid polygons.
 *
 * @static
 * @param {H3IndexInput[]} h3Indexes       H3 indexes to get outlines for
 * @param {boolean} [formatAsGeoJson] Whether to provide GeoJSON output:
 *                                    [lng, lat], closed loops
 * @return {number[][][][]}           MultiPolygon-style output.
 */

function h3SetToMultiPolygon(h3Indexes, formatAsGeoJson) {
  // Early exit on empty input
  if (!h3Indexes || !h3Indexes.length) {
    return [];
  } // Set up input set


  var indexCount = h3Indexes.length;

  var set = libh3._calloc(indexCount, SZ_H3INDEX);

  storeArrayOfHexagons(set, h3Indexes); // Allocate memory for output linked polygon

  var polygon = libh3._calloc(SZ_LINKED_GEOPOLYGON); // Store a reference to the first polygon - that's the one we need for
  // memory deallocation


  var originalPolygon = polygon;
  H3.h3SetToLinkedGeo(set, indexCount, polygon);
  var multiPolygon = readMultiPolygon(polygon, formatAsGeoJson); // Clean up

  H3.destroyLinkedPolygon(originalPolygon);

  libh3._free(originalPolygon);

  libh3._free(set);

  return multiPolygon;
}
/**
 * Compact a set of hexagons of the same resolution into a set of hexagons across
 * multiple levels that represents the same area.
 * @static
 * @param  {H3IndexInput[]} h3Set H3 indexes to compact
 * @return {H3Index[]}       Compacted H3 indexes
 * @throws {Error}           If the input is invalid (e.g. duplicate hexagons)
 */

function compact(h3Set) {
  if (!h3Set || !h3Set.length) {
    return [];
  } // Set up input set


  var count = h3Set.length;

  var set = libh3._calloc(count, SZ_H3INDEX);

  storeArrayOfHexagons(set, h3Set); // Allocate memory for compacted hexagons, worst-case is no compaction

  var compactedSet = libh3._calloc(count, SZ_H3INDEX);

  var retVal = H3.compact(set, compactedSet, count);

  if (retVal !== 0) {
    libh3._free(set);

    libh3._free(compactedSet);

    throw new Error('Failed to compact, malformed input data (duplicate hexagons?)');
  }

  var out = readArrayOfHexagons(compactedSet, count);

  libh3._free(set);

  libh3._free(compactedSet);

  return out;
}
/**
 * Uncompact a compacted set of hexagons to hexagons of the same resolution
 * @static
 * @param  {H3IndexInput[]} compactedSet H3 indexes to uncompact
 * @param  {number}    res          The resolution to uncompact to
 * @return {H3Index[]}              The uncompacted H3 indexes
 * @throws {Error}                  If the input is invalid (e.g. invalid resolution)
 */

function uncompact(compactedSet, res) {
  validateRes(res);

  if (!compactedSet || !compactedSet.length) {
    return [];
  } // Set up input set


  var count = compactedSet.length;

  var set = libh3._calloc(count, SZ_H3INDEX);

  storeArrayOfHexagons(set, compactedSet); // Estimate how many hexagons we need (always overestimates if in error)

  var maxUncompactedNum = H3.maxUncompactSize(set, count, res); // Allocate memory for uncompacted hexagons

  var uncompactedSet = libh3._calloc(maxUncompactedNum, SZ_H3INDEX);

  var retVal = H3.uncompact(set, count, uncompactedSet, maxUncompactedNum, res);

  if (retVal !== 0) {
    libh3._free(set);

    libh3._free(uncompactedSet);

    throw new Error('Failed to uncompact (bad resolution?)');
  }

  var out = readArrayOfHexagons(uncompactedSet, maxUncompactedNum);

  libh3._free(set);

  libh3._free(uncompactedSet);

  return out;
} // ----------------------------------------------------------------------------
// Public API functions: Unidirectional edges

/**
 * Whether two H3 indexes are neighbors (share an edge)
 * @static
 * @param  {H3IndexInput} origin      Origin hexagon index
 * @param  {H3IndexInput} destination Destination hexagon index
 * @return {boolean}             Whether the hexagons share an edge
 */

function h3IndexesAreNeighbors(origin, destination) {
  var ref = h3IndexToSplitLong(origin);
  var oLower = ref[0];
  var oUpper = ref[1];
  var ref$1 = h3IndexToSplitLong(destination);
  var dLower = ref$1[0];
  var dUpper = ref$1[1];
  return Boolean(H3.h3IndexesAreNeighbors(oLower, oUpper, dLower, dUpper));
}
/**
 * Get an H3 index representing a unidirectional edge for a given origin and destination
 * @static
 * @param  {H3IndexInput} origin      Origin hexagon index
 * @param  {H3IndexInput} destination Destination hexagon index
 * @return {H3Index}             H3 index of the edge, or null if no edge is shared
 */

function getH3UnidirectionalEdge(origin, destination) {
  var ref = h3IndexToSplitLong(origin);
  var oLower = ref[0];
  var oUpper = ref[1];
  var ref$1 = h3IndexToSplitLong(destination);
  var dLower = ref$1[0];
  var dUpper = ref$1[1];
  return readH3Index(H3.getH3UnidirectionalEdge(oLower, oUpper, dLower, dUpper));
}
/**
 * Get the origin hexagon from an H3 index representing a unidirectional edge
 * @static
 * @param  {H3IndexInput} edgeIndex H3 index of the edge
 * @return {H3Index}           H3 index of the edge origin
 */

function getOriginH3IndexFromUnidirectionalEdge(edgeIndex) {
  var ref = h3IndexToSplitLong(edgeIndex);
  var lower = ref[0];
  var upper = ref[1];
  return readH3Index(H3.getOriginH3IndexFromUnidirectionalEdge(lower, upper));
}
/**
 * Get the destination hexagon from an H3 index representing a unidirectional edge
 * @static
 * @param  {H3IndexInput} edgeIndex H3 index of the edge
 * @return {H3Index}           H3 index of the edge destination
 */

function getDestinationH3IndexFromUnidirectionalEdge(edgeIndex) {
  var ref = h3IndexToSplitLong(edgeIndex);
  var lower = ref[0];
  var upper = ref[1];
  return readH3Index(H3.getDestinationH3IndexFromUnidirectionalEdge(lower, upper));
}
/**
 * Whether the input is a valid unidirectional edge
 * @static
 * @param  {H3IndexInput} edgeIndex H3 index of the edge
 * @return {boolean}           Whether the index is valid
 */

function h3UnidirectionalEdgeIsValid(edgeIndex) {
  var ref = h3IndexToSplitLong(edgeIndex);
  var lower = ref[0];
  var upper = ref[1];
  return Boolean(H3.h3UnidirectionalEdgeIsValid(lower, upper));
}
/**
 * Get the [origin, destination] pair represented by a unidirectional edge
 * @static
 * @param  {H3IndexInput} edgeIndex H3 index of the edge
 * @return {H3Index[]}         [origin, destination] pair as H3 indexes
 */

function getH3IndexesFromUnidirectionalEdge(edgeIndex) {
  var ref = h3IndexToSplitLong(edgeIndex);
  var lower = ref[0];
  var upper = ref[1];
  var count = 2;

  var hexagons = libh3._calloc(count, SZ_H3INDEX);

  H3.getH3IndexesFromUnidirectionalEdge(lower, upper, hexagons);
  var out = readArrayOfHexagons(hexagons, count);

  libh3._free(hexagons);

  return out;
}
/**
 * Get all of the unidirectional edges with the given H3 index as the origin (i.e. an edge to
 * every neighbor)
 * @static
 * @param  {H3IndexInput} h3Index   H3 index of the origin hexagon
 * @return {H3Index[]}         List of unidirectional edges
 */

function getH3UnidirectionalEdgesFromHexagon(h3Index) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  var count = 6;

  var edges = libh3._calloc(count, SZ_H3INDEX);

  H3.getH3UnidirectionalEdgesFromHexagon(lower, upper, edges);
  var out = readArrayOfHexagons(edges, count);

  libh3._free(edges);

  return out;
}
/**
 * Get the vertices of a given edge as an array of [lat, lng] points. Note that for edges that
 * cross the edge of an icosahedron face, this may return 3 coordinates.
 * @static
 * @param  {H3IndexInput} edgeIndex        H3 index of the edge
 * @param {boolean} [formatAsGeoJson] Whether to provide GeoJSON output: [lng, lat]
 * @return {number[][]}               Array of geo coordinate pairs
 */

function getH3UnidirectionalEdgeBoundary(edgeIndex, formatAsGeoJson) {
  var geoBoundary = libh3._malloc(SZ_GEOBOUNDARY);

  var ref = h3IndexToSplitLong(edgeIndex);
  var lower = ref[0];
  var upper = ref[1];
  H3.getH3UnidirectionalEdgeBoundary(lower, upper, geoBoundary);
  var out = readGeoBoundary(geoBoundary, formatAsGeoJson);

  libh3._free(geoBoundary);

  return out;
}
/**
 * Get the grid distance between two hex indexes. This function may fail
 * to find the distance between two indexes if they are very far apart or
 * on opposite sides of a pentagon.
 * @static
 * @param  {H3IndexInput} origin      Origin hexagon index
 * @param  {H3IndexInput} destination Destination hexagon index
 * @return {number}              Distance between hexagons, or a negative
 *                               number if the distance could not be computed
 */

function h3Distance(origin, destination) {
  var ref = h3IndexToSplitLong(origin);
  var oLower = ref[0];
  var oUpper = ref[1];
  var ref$1 = h3IndexToSplitLong(destination);
  var dLower = ref$1[0];
  var dUpper = ref$1[1];
  return H3.h3Distance(oLower, oUpper, dLower, dUpper);
}
/**
 * Given two H3 indexes, return the line of indexes between them (inclusive).
 *
 * This function may fail to find the line between two indexes, for
 * example if they are very far apart. It may also fail when finding
 * distances for indexes on opposite sides of a pentagon.
 *
 * Notes:
 *
 *  - The specific output of this function should not be considered stable
 *    across library versions. The only guarantees the library provides are
 *    that the line length will be `h3Distance(start, end) + 1` and that
 *    every index in the line will be a neighbor of the preceding index.
 *  - Lines are drawn in grid space, and may not correspond exactly to either
 *    Cartesian lines or great arcs.
 *
 * @static
 * @param  {H3IndexInput} origin      Origin hexagon index
 * @param  {H3IndexInput} destination Destination hexagon index
 * @return {H3Index[]}           H3 indexes connecting origin and destination
 * @throws {Error}               If the line cannot be calculated
 */

function h3Line(origin, destination) {
  var ref = h3IndexToSplitLong(origin);
  var oLower = ref[0];
  var oUpper = ref[1];
  var ref$1 = h3IndexToSplitLong(destination);
  var dLower = ref$1[0];
  var dUpper = ref$1[1];
  var count = H3.h3LineSize(oLower, oUpper, dLower, dUpper);

  if (count < 0) {
    // We can't get the specific error code here - may be any of
    // the errors possible in experimentalH3ToLocalIj
    throw new Error('Line cannot be calculated');
  }

  var hexagons = libh3._calloc(count, SZ_H3INDEX);

  H3.h3Line(oLower, oUpper, dLower, dUpper, hexagons);
  var out = readArrayOfHexagons(hexagons, count);

  libh3._free(hexagons);

  return out;
}
/**
 * Produces IJ coordinates for an H3 index anchored by an origin.
 *
 * - The coordinate space used by this function may have deleted
 * regions or warping due to pentagonal distortion.
 * - Coordinates are only comparable if they come from the same
 * origin index.
 * - Failure may occur if the index is too far away from the origin
 * or if the index is on the other side of a pentagon.
 * - This function is experimental, and its output is not guaranteed
 * to be compatible across different versions of H3.
 * @static
 * @param  {H3IndexInput} origin      Origin H3 index
 * @param  {H3IndexInput} destination H3 index for which to find relative coordinates
 * @return {CoordIJ}             Coordinates as an `{i, j}` pair
 * @throws {Error}               If the IJ coordinates cannot be calculated
 */

function experimentalH3ToLocalIj(origin, destination) {
  var ij = libh3._malloc(SZ_COORDIJ);

  var retVal = H3.experimentalH3ToLocalIj.apply(H3, h3IndexToSplitLong(origin).concat( h3IndexToSplitLong(destination), [ij] ));
  var coords = readCoordIJ(ij);

  libh3._free(ij); // Return the pair, or throw if an error code was returned.
  // Switch statement and error codes cribbed from h3-java's implementation.


  switch (retVal) {
    case 0:
      return coords;

    case 1:
      throw new Error('Incompatible origin and index.');

    case 2:
    default:
      throw new Error('Local IJ coordinates undefined for this origin and index pair. ' + 'The index may be too far from the origin.');

    case 3:
    case 4:
    case 5:
      throw new Error('Encountered possible pentagon distortion');
  }
}
/**
 * Produces an H3 index for IJ coordinates anchored by an origin.
 *
 * - The coordinate space used by this function may have deleted
 * regions or warping due to pentagonal distortion.
 * - Coordinates are only comparable if they come from the same
 * origin index.
 * - Failure may occur if the index is too far away from the origin
 * or if the index is on the other side of a pentagon.
 * - This function is experimental, and its output is not guaranteed
 * to be compatible across different versions of H3.
 * @static
 * @param  {H3IndexInput} origin     Origin H3 index
 * @param  {CoordIJ} coords     Coordinates as an `{i, j}` pair
 * @return {H3Index}            H3 index at the relative coordinates
 * @throws {Error}              If the H3 index cannot be calculated
 */

function experimentalLocalIjToH3(origin, coords) {
  // Validate input coords
  if (!coords || typeof coords.i !== 'number' || typeof coords.j !== 'number') {
    throw new Error('Coordinates must be provided as an {i, j} object');
  } // Allocate memory for the CoordIJ struct and an H3 index to hold the return value


  var ij = libh3._malloc(SZ_COORDIJ);

  var out = libh3._malloc(SZ_H3INDEX);

  storeCoordIJ(ij, coords);
  var retVal = H3.experimentalLocalIjToH3.apply(H3, h3IndexToSplitLong(origin).concat( [ij], [out] ));
  var h3Index = readH3IndexFromPointer(out);

  libh3._free(ij);

  libh3._free(out);

  if (retVal !== 0) {
    throw new Error('Index not defined for this origin and IJ coordinates pair. ' + 'IJ coordinates may be too far from origin, or ' + 'a pentagon distortion was encountered.');
  }

  return h3Index;
} // ----------------------------------------------------------------------------
// Public API functions: Distance/area utilities

/**
 * Great circle distance between two geo points. This is not specific to H3,
 * but is implemented in the library and provided here as a convenience.
 * @static
 * @param  {number[]} latlng1 Origin coordinate as [lat, lng]
 * @param  {number[]} latlng2 Destination coordinate as [lat, lng]
 * @param  {string}   unit    Distance unit (either UNITS.m or UNITS.km)
 * @return {number}           Great circle distance
 * @throws {Error}            If the unit is invalid
 */

function pointDist(latlng1, latlng2, unit) {
  var coord1 = storeGeoCoord(latlng1[0], latlng1[1]);
  var coord2 = storeGeoCoord(latlng2[0], latlng2[1]);
  var result;

  switch (unit) {
    case UNITS.m:
      result = H3.pointDistM(coord1, coord2);
      break;

    case UNITS.km:
      result = H3.pointDistKm(coord1, coord2);
      break;

    case UNITS.rads:
      result = H3.pointDistRads(coord1, coord2);
      break;

    default:
      result = null;
  }

  libh3._free(coord1);

  libh3._free(coord2);

  if (result === null) {
    throw new Error(("Unknown unit: " + unit));
  }

  return result;
}
/**
 * Exact area of a given cell
 * @static
 * @param  {H3Index} h3Index  H3 index of the hexagon to measure
 * @param  {string}  unit     Distance unit (either UNITS.m2 or UNITS.km2)
 * @return {number}           Cell area
 * @throws {Error}            If the unit is invalid
 */

function cellArea(h3Index, unit) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];

  switch (unit) {
    case UNITS.m2:
      return H3.cellAreaM2(lower, upper);

    case UNITS.km2:
      return H3.cellAreaKm2(lower, upper);

    case UNITS.rads2:
      return H3.cellAreaRads2(lower, upper);

    default:
      throw new Error(("Unknown unit: " + unit));
  }
}
/**
 * Exact length of a given unidirectional edge
 * @static
 * @param  {H3Index} edge     H3 index of the edge to measure
 * @param  {string}  unit     Distance unit (either UNITS.m, UNITS.km, or UNITS.rads)
 * @return {number}           Cell area
 * @throws {Error}            If the unit is invalid
 */

function exactEdgeLength(edge, unit) {
  var ref = h3IndexToSplitLong(edge);
  var lower = ref[0];
  var upper = ref[1];

  switch (unit) {
    case UNITS.m:
      return H3.exactEdgeLengthM(lower, upper);

    case UNITS.km:
      return H3.exactEdgeLengthKm(lower, upper);

    case UNITS.rads:
      return H3.exactEdgeLengthRads(lower, upper);

    default:
      throw new Error(("Unknown unit: " + unit));
  }
}
/**
 * Average hexagon area at a given resolution
 * @static
 * @param  {number} res  Hexagon resolution
 * @param  {string} unit Area unit (either UNITS.m2, UNITS.km2, or UNITS.rads2)
 * @return {number}      Average area
 * @throws {Error}       If the unit is invalid
 */

function hexArea(res, unit) {
  validateRes(res);

  switch (unit) {
    case UNITS.m2:
      return H3.hexAreaM2(res);

    case UNITS.km2:
      return H3.hexAreaKm2(res);

    default:
      throw new Error(("Unknown unit: " + unit));
  }
}
/**
 * Average hexagon edge length at a given resolution
 * @static
 * @param  {number} res  Hexagon resolution
 * @param  {string} unit Distance unit (either UNITS.m, UNITS.km, or UNITS.rads)
 * @return {number}      Average edge length
 * @throws {Error}       If the unit is invalid
 */

function edgeLength(res, unit) {
  validateRes(res);

  switch (unit) {
    case UNITS.m:
      return H3.edgeLengthM(res);

    case UNITS.km:
      return H3.edgeLengthKm(res);

    default:
      throw new Error(("Unknown unit: " + unit));
  }
} // ----------------------------------------------------------------------------
// Public informational utilities

/**
 * The total count of hexagons in the world at a given resolution. Note that above
 * resolution 8 the exact count cannot be represented in a JavaScript 32-bit number,
 * so consumers should use caution when applying further operations to the output.
 * @static
 * @param  {number} res  Hexagon resolution
 * @return {number}      Count
 */

function numHexagons(res) {
  validateRes(res); // Get number as a long value

  var ref = readLong(H3.numHexagons(res));
  var lower = ref[0];
  var upper = ref[1]; // If we're using <= 32 bits we can use normal JS numbers

  if (!upper) {
    return lower;
  } // Above 32 bit, make a JS number that's correct in order of magnitude


  return upper * Math.pow(2, 32) + lower;
}
/**
 * Get all H3 indexes at resolution 0. As every index at every resolution > 0 is
 * the descendant of a res 0 index, this can be used with h3ToChildren to iterate
 * over H3 indexes at any resolution.
 * @static
 * @return {H3Index[]}  All H3 indexes at res 0
 */

function getRes0Indexes() {
  var count = H3.res0IndexCount();

  var hexagons = libh3._malloc(SZ_H3INDEX * count);

  H3.getRes0Indexes(hexagons);
  var out = readArrayOfHexagons(hexagons, count);

  libh3._free(hexagons);

  return out;
}
/**
 * Get the twelve pentagon indexes at a given resolution.
 * @static
 * @param  {number} res  Hexagon resolution
 * @return {H3Index[]}  All H3 pentagon indexes at res
 */

function getPentagonIndexes(res) {
  validateRes(res);
  var count = H3.pentagonIndexCount();

  var hexagons = libh3._malloc(SZ_H3INDEX * count);

  H3.getPentagonIndexes(res, hexagons);
  var out = readArrayOfHexagons(hexagons, count);

  libh3._free(hexagons);

  return out;
}
/**
 * Convert degrees to radians
 * @static
 * @param  {number} deg Value in degrees
 * @return {number}     Value in radians
 */

function degsToRads(deg) {
  return deg * Math.PI / 180;
}
/**
 * Convert radians to degrees
 * @static
 * @param  {number} rad Value in radians
 * @return {number}     Value in degrees
 */

function radsToDegs(rad) {
  return rad * 180 / Math.PI;
}

exports.UNITS = UNITS;
exports.h3IndexToSplitLong = h3IndexToSplitLong;
exports.splitLongToh3Index = splitLongToh3Index;
exports.h3IsValid = h3IsValid;
exports.h3IsPentagon = h3IsPentagon;
exports.h3IsResClassIII = h3IsResClassIII;
exports.h3GetBaseCell = h3GetBaseCell;
exports.h3GetFaces = h3GetFaces;
exports.h3GetResolution = h3GetResolution;
exports.geoToH3 = geoToH3;
exports.h3ToGeo = h3ToGeo;
exports.h3ToGeoBoundary = h3ToGeoBoundary;
exports.h3ToParent = h3ToParent;
exports.h3ToChildren = h3ToChildren;
exports.h3ToCenterChild = h3ToCenterChild;
exports.kRing = kRing;
exports.kRingDistances = kRingDistances;
exports.hexRing = hexRing;
exports.polyfill = polyfill;
exports.h3SetToMultiPolygon = h3SetToMultiPolygon;
exports.compact = compact;
exports.uncompact = uncompact;
exports.h3IndexesAreNeighbors = h3IndexesAreNeighbors;
exports.getH3UnidirectionalEdge = getH3UnidirectionalEdge;
exports.getOriginH3IndexFromUnidirectionalEdge = getOriginH3IndexFromUnidirectionalEdge;
exports.getDestinationH3IndexFromUnidirectionalEdge = getDestinationH3IndexFromUnidirectionalEdge;
exports.h3UnidirectionalEdgeIsValid = h3UnidirectionalEdgeIsValid;
exports.getH3IndexesFromUnidirectionalEdge = getH3IndexesFromUnidirectionalEdge;
exports.getH3UnidirectionalEdgesFromHexagon = getH3UnidirectionalEdgesFromHexagon;
exports.getH3UnidirectionalEdgeBoundary = getH3UnidirectionalEdgeBoundary;
exports.h3Distance = h3Distance;
exports.h3Line = h3Line;
exports.experimentalH3ToLocalIj = experimentalH3ToLocalIj;
exports.experimentalLocalIjToH3 = experimentalLocalIjToH3;
exports.pointDist = pointDist;
exports.cellArea = cellArea;
exports.exactEdgeLength = exactEdgeLength;
exports.hexArea = hexArea;
exports.edgeLength = edgeLength;
exports.numHexagons = numHexagons;
exports.getRes0Indexes = getRes0Indexes;
exports.getPentagonIndexes = getPentagonIndexes;
exports.degsToRads = degsToRads;
exports.radsToDegs = radsToDegs;


},{}],4:[function(require,module,exports){
(function (process){(function (){
/* Mapbox GL JS is Copyright © 2020 Mapbox and subject to the Mapbox Terms of Service ((https://www.mapbox.com/legal/tos/). */
(function (global, factory) {
typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
typeof define === 'function' && define.amd ? define(factory) :
(global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.mapboxgl = factory());
}(this, (function () { 'use strict';

/* eslint-disable */

var shared, worker, mapboxgl;
// define gets called three times: one for each chunk. we rely on the order
// they're imported to know which is which
function define(_, chunk) {
if (!shared) {
    shared = chunk;
} else if (!worker) {
    worker = chunk;
} else {
    var workerBundleString = "self.onerror = function() { console.error('An error occurred while parsing the WebWorker bundle. This is most likely due to improper transpilation by Babel; please see https://docs.mapbox.com/mapbox-gl-js/guides/install/#transpiling'); }; var sharedChunk = {}; (" + shared + ")(sharedChunk); (" + worker + ")(sharedChunk); self.onerror = null;"

    var sharedChunk = {};
    shared(sharedChunk);
    mapboxgl = chunk(sharedChunk);
    if (typeof window !== 'undefined' && window && window.URL && window.URL.createObjectURL) {
        mapboxgl.workerUrl = window.URL.createObjectURL(new Blob([workerBundleString], { type: 'text/javascript' }));
    }
}
}


define(["exports"],(function(t){"use strict";var e="2.7.0",r=n;function n(t,e,r,n){this.cx=3*t,this.bx=3*(r-t)-this.cx,this.ax=1-this.cx-this.bx,this.cy=3*e,this.by=3*(n-e)-this.cy,this.ay=1-this.cy-this.by,this.p1x=t,this.p1y=n,this.p2x=r,this.p2y=n;}n.prototype.sampleCurveX=function(t){return ((this.ax*t+this.bx)*t+this.cx)*t},n.prototype.sampleCurveY=function(t){return ((this.ay*t+this.by)*t+this.cy)*t},n.prototype.sampleCurveDerivativeX=function(t){return (3*this.ax*t+2*this.bx)*t+this.cx},n.prototype.solveCurveX=function(t,e){var r,n,i,s,a;for(void 0===e&&(e=1e-6),i=t,a=0;a<8;a++){if(s=this.sampleCurveX(i)-t,Math.abs(s)<e)return i;var o=this.sampleCurveDerivativeX(i);if(Math.abs(o)<1e-6)break;i-=s/o;}if((i=t)<(r=0))return r;if(i>(n=1))return n;for(;r<n;){if(s=this.sampleCurveX(i),Math.abs(s-t)<e)return i;t>s?r=i:n=i,i=.5*(n-r)+r;}return i},n.prototype.solve=function(t,e){return this.sampleCurveY(this.solveCurveX(t,e))};var i=s;function s(t,e){this.x=t,this.y=e;}s.prototype={clone:function(){return new s(this.x,this.y)},add:function(t){return this.clone()._add(t)},sub:function(t){return this.clone()._sub(t)},multByPoint:function(t){return this.clone()._multByPoint(t)},divByPoint:function(t){return this.clone()._divByPoint(t)},mult:function(t){return this.clone()._mult(t)},div:function(t){return this.clone()._div(t)},rotate:function(t){return this.clone()._rotate(t)},rotateAround:function(t,e){return this.clone()._rotateAround(t,e)},matMult:function(t){return this.clone()._matMult(t)},unit:function(){return this.clone()._unit()},perp:function(){return this.clone()._perp()},round:function(){return this.clone()._round()},mag:function(){return Math.sqrt(this.x*this.x+this.y*this.y)},equals:function(t){return this.x===t.x&&this.y===t.y},dist:function(t){return Math.sqrt(this.distSqr(t))},distSqr:function(t){var e=t.x-this.x,r=t.y-this.y;return e*e+r*r},angle:function(){return Math.atan2(this.y,this.x)},angleTo:function(t){return Math.atan2(this.y-t.y,this.x-t.x)},angleWith:function(t){return this.angleWithSep(t.x,t.y)},angleWithSep:function(t,e){return Math.atan2(this.x*e-this.y*t,this.x*t+this.y*e)},_matMult:function(t){var e=t[2]*this.x+t[3]*this.y;return this.x=t[0]*this.x+t[1]*this.y,this.y=e,this},_add:function(t){return this.x+=t.x,this.y+=t.y,this},_sub:function(t){return this.x-=t.x,this.y-=t.y,this},_mult:function(t){return this.x*=t,this.y*=t,this},_div:function(t){return this.x/=t,this.y/=t,this},_multByPoint:function(t){return this.x*=t.x,this.y*=t.y,this},_divByPoint:function(t){return this.x/=t.x,this.y/=t.y,this},_unit:function(){return this._div(this.mag()),this},_perp:function(){var t=this.y;return this.y=this.x,this.x=-t,this},_rotate:function(t){var e=Math.cos(t),r=Math.sin(t),n=r*this.x+e*this.y;return this.x=e*this.x-r*this.y,this.y=n,this},_rotateAround:function(t,e){var r=Math.cos(t),n=Math.sin(t),i=e.y+n*(this.x-e.x)+r*(this.y-e.y);return this.x=e.x+r*(this.x-e.x)-n*(this.y-e.y),this.y=i,this},_round:function(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}},s.convert=function(t){return t instanceof s?t:Array.isArray(t)?new s(t[0],t[1]):t};var a="undefined"!=typeof self?self:{},o=1e-6,l="undefined"!=typeof Float32Array?Float32Array:Array;function u(){var t=new l(9);return l!=Float32Array&&(t[1]=0,t[2]=0,t[3]=0,t[5]=0,t[6]=0,t[7]=0),t[0]=1,t[4]=1,t[8]=1,t}function c(t){return t[0]=1,t[1]=0,t[2]=0,t[3]=0,t[4]=0,t[5]=1,t[6]=0,t[7]=0,t[8]=0,t[9]=0,t[10]=1,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,t}function h(t,e,r){var n=e[0],i=e[1],s=e[2],a=e[3],o=e[4],l=e[5],u=e[6],c=e[7],h=e[8],p=e[9],d=e[10],f=e[11],y=e[12],m=e[13],g=e[14],x=e[15],v=r[0],b=r[1],w=r[2],_=r[3];return t[0]=v*n+b*o+w*h+_*y,t[1]=v*i+b*l+w*p+_*m,t[2]=v*s+b*u+w*d+_*g,t[3]=v*a+b*c+w*f+_*x,t[4]=(v=r[4])*n+(b=r[5])*o+(w=r[6])*h+(_=r[7])*y,t[5]=v*i+b*l+w*p+_*m,t[6]=v*s+b*u+w*d+_*g,t[7]=v*a+b*c+w*f+_*x,t[8]=(v=r[8])*n+(b=r[9])*o+(w=r[10])*h+(_=r[11])*y,t[9]=v*i+b*l+w*p+_*m,t[10]=v*s+b*u+w*d+_*g,t[11]=v*a+b*c+w*f+_*x,t[12]=(v=r[12])*n+(b=r[13])*o+(w=r[14])*h+(_=r[15])*y,t[13]=v*i+b*l+w*p+_*m,t[14]=v*s+b*u+w*d+_*g,t[15]=v*a+b*c+w*f+_*x,t}function p(t,e,r){var n,i,s,a,o,l,u,c,h,p,d,f,y=r[0],m=r[1],g=r[2];return e===t?(t[12]=e[0]*y+e[4]*m+e[8]*g+e[12],t[13]=e[1]*y+e[5]*m+e[9]*g+e[13],t[14]=e[2]*y+e[6]*m+e[10]*g+e[14],t[15]=e[3]*y+e[7]*m+e[11]*g+e[15]):(i=e[1],s=e[2],a=e[3],o=e[4],l=e[5],u=e[6],c=e[7],h=e[8],p=e[9],d=e[10],f=e[11],t[0]=n=e[0],t[1]=i,t[2]=s,t[3]=a,t[4]=o,t[5]=l,t[6]=u,t[7]=c,t[8]=h,t[9]=p,t[10]=d,t[11]=f,t[12]=n*y+o*m+h*g+e[12],t[13]=i*y+l*m+p*g+e[13],t[14]=s*y+u*m+d*g+e[14],t[15]=a*y+c*m+f*g+e[15]),t}function d(t,e,r){var n=r[0],i=r[1],s=r[2];return t[0]=e[0]*n,t[1]=e[1]*n,t[2]=e[2]*n,t[3]=e[3]*n,t[4]=e[4]*i,t[5]=e[5]*i,t[6]=e[6]*i,t[7]=e[7]*i,t[8]=e[8]*s,t[9]=e[9]*s,t[10]=e[10]*s,t[11]=e[11]*s,t[12]=e[12],t[13]=e[13],t[14]=e[14],t[15]=e[15],t}function f(t,e,r){var n=Math.sin(r),i=Math.cos(r),s=e[4],a=e[5],o=e[6],l=e[7],u=e[8],c=e[9],h=e[10],p=e[11];return e!==t&&(t[0]=e[0],t[1]=e[1],t[2]=e[2],t[3]=e[3],t[12]=e[12],t[13]=e[13],t[14]=e[14],t[15]=e[15]),t[4]=s*i+u*n,t[5]=a*i+c*n,t[6]=o*i+h*n,t[7]=l*i+p*n,t[8]=u*i-s*n,t[9]=c*i-a*n,t[10]=h*i-o*n,t[11]=p*i-l*n,t}function y(t,e,r){var n=Math.sin(r),i=Math.cos(r),s=e[0],a=e[1],o=e[2],l=e[3],u=e[8],c=e[9],h=e[10],p=e[11];return e!==t&&(t[4]=e[4],t[5]=e[5],t[6]=e[6],t[7]=e[7],t[12]=e[12],t[13]=e[13],t[14]=e[14],t[15]=e[15]),t[0]=s*i-u*n,t[1]=a*i-c*n,t[2]=o*i-h*n,t[3]=l*i-p*n,t[8]=s*n+u*i,t[9]=a*n+c*i,t[10]=o*n+h*i,t[11]=l*n+p*i,t}Math.hypot||(Math.hypot=function(){for(var t=0,e=arguments.length;e--;)t+=arguments[e]*arguments[e];return Math.sqrt(t)});var m=h;function g(){var t=new l(3);return l!=Float32Array&&(t[0]=0,t[1]=0,t[2]=0),t}function x(t){var e=new l(3);return e[0]=t[0],e[1]=t[1],e[2]=t[2],e}function v(t){return Math.hypot(t[0],t[1],t[2])}function b(t,e,r){var n=new l(3);return n[0]=t,n[1]=e,n[2]=r,n}function w(t,e,r){return t[0]=e[0]+r[0],t[1]=e[1]+r[1],t[2]=e[2]+r[2],t}function _(t,e,r){return t[0]=e[0]-r[0],t[1]=e[1]-r[1],t[2]=e[2]-r[2],t}function A(t,e,r){return t[0]=e[0]*r[0],t[1]=e[1]*r[1],t[2]=e[2]*r[2],t}function k(t,e,r){return t[0]=Math.max(e[0],r[0]),t[1]=Math.max(e[1],r[1]),t[2]=Math.max(e[2],r[2]),t}function S(t,e,r){return t[0]=e[0]*r,t[1]=e[1]*r,t[2]=e[2]*r,t}function I(t,e,r,n){return t[0]=e[0]+r[0]*n,t[1]=e[1]+r[1]*n,t[2]=e[2]+r[2]*n,t}function z(t,e){var r=e[0],n=e[1],i=e[2],s=r*r+n*n+i*i;return s>0&&(s=1/Math.sqrt(s)),t[0]=e[0]*s,t[1]=e[1]*s,t[2]=e[2]*s,t}function M(t,e){return t[0]*e[0]+t[1]*e[1]+t[2]*e[2]}function T(t,e,r){var n=e[0],i=e[1],s=e[2],a=r[0],o=r[1],l=r[2];return t[0]=i*l-s*o,t[1]=s*a-n*l,t[2]=n*o-i*a,t}function B(t,e,r){var n=e[0],i=e[1],s=e[2],a=r[3]*n+r[7]*i+r[11]*s+r[15];return t[0]=(r[0]*n+r[4]*i+r[8]*s+r[12])/(a=a||1),t[1]=(r[1]*n+r[5]*i+r[9]*s+r[13])/a,t[2]=(r[2]*n+r[6]*i+r[10]*s+r[14])/a,t}function C(t,e,r){var n=r[0],i=r[1],s=r[2],a=e[0],o=e[1],l=e[2],u=i*l-s*o,c=s*a-n*l,h=n*o-i*a,p=i*h-s*c,d=s*u-n*h,f=n*c-i*u,y=2*r[3];return c*=y,h*=y,d*=2,f*=2,t[0]=a+(u*=y)+(p*=2),t[1]=o+c+d,t[2]=l+h+f,t}var P,E=_,D=A,V=v;function F(t,e,r){var n=e[0],i=e[1],s=e[2],a=e[3];return t[0]=r[0]*n+r[4]*i+r[8]*s+r[12]*a,t[1]=r[1]*n+r[5]*i+r[9]*s+r[13]*a,t[2]=r[2]*n+r[6]*i+r[10]*s+r[14]*a,t[3]=r[3]*n+r[7]*i+r[11]*s+r[15]*a,t}function L(){var t=new l(4);return l!=Float32Array&&(t[0]=0,t[1]=0,t[2]=0),t[3]=1,t}function R(t){return t[0]=0,t[1]=0,t[2]=0,t[3]=1,t}function U(t,e,r){r*=.5;var n=e[0],i=e[1],s=e[2],a=e[3],o=Math.sin(r),l=Math.cos(r);return t[0]=n*l+a*o,t[1]=i*l+s*o,t[2]=s*l-i*o,t[3]=a*l-n*o,t}function $(t,e){return t[0]===e[0]&&t[1]===e[1]}g(),P=new l(4),l!=Float32Array&&(P[0]=0,P[1]=0,P[2]=0,P[3]=0),g(),b(1,0,0),b(0,1,0),L(),L(),u(),function(){var t;t=new l(2),l!=Float32Array&&(t[0]=0,t[1]=0);}();const O=Math.PI/180,j=180/Math.PI;function q(t){return t*O}function N(t){return t*j}const G=[[0,0],[1,0],[1,1],[0,1]];function Z(t){if(t<=0)return 0;if(t>=1)return 1;const e=t*t,r=e*t;return 4*(t<.5?r:3*(t-e)+r-.75)}function X(t,e,n,i){const s=new r(t,e,n,i);return function(t){return s.solve(t)}}const K=X(.25,.1,.25,1);function Y(t,e,r){return Math.min(r,Math.max(e,t))}function H(t,e,r){return (r=Y((r-t)/(e-t),0,1))*r*(3-2*r)}function J(t,e,r){const n=r-e,i=((t-e)%n+n)%n+e;return i===e?r:i}function W(t,e,r){if(!t.length)return r(null,[]);let n=t.length;const i=new Array(t.length);let s=null;t.forEach(((t,a)=>{e(t,((t,e)=>{t&&(s=t),i[a]=e,0==--n&&r(s,i);}));}));}function Q(t){const e=[];for(const r in t)e.push(t[r]);return e}function tt(t,...e){for(const r of e)for(const e in r)t[e]=r[e];return t}let et=1;function rt(){return et++}function nt(){return function t(e){return e?(e^16*Math.random()>>e/4).toString(16):([1e7]+-[1e3]+-4e3+-8e3+-1e11).replace(/[018]/g,t)}()}function it(t){return t<=1?1:Math.pow(2,Math.ceil(Math.log(t)/Math.LN2))}function st(t){return !!t&&/^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t)}function at(t,e){t.forEach((t=>{e[t]&&(e[t]=e[t].bind(e));}));}function ot(t,e){return -1!==t.indexOf(e,t.length-e.length)}function lt(t,e,r){const n={};for(const i in t)n[i]=e.call(r||this,t[i],i,t);return n}function ut(t,e,r){const n={};for(const i in t)e.call(r||this,t[i],i,t)&&(n[i]=t[i]);return n}function ct(t){return Array.isArray(t)?t.map(ct):"object"==typeof t&&t?lt(t,ct):t}const ht={};function pt(t){ht[t]||("undefined"!=typeof console&&console.warn(t),ht[t]=!0);}function dt(t,e,r){return (r.y-t.y)*(e.x-t.x)>(e.y-t.y)*(r.x-t.x)}function ft(t){let e=0;for(let r,n,i=0,s=t.length,a=s-1;i<s;a=i++)r=t[i],n=t[a],e+=(n.x-r.x)*(r.y+n.y);return e}function yt(){return "undefined"!=typeof WorkerGlobalScope&&"undefined"!=typeof self&&self instanceof WorkerGlobalScope}function mt(t){const e={};if(t.replace(/(?:^|(?:\s*\,\s*))([^\x00-\x20\(\)<>@\,;\:\\"\/\[\]\?\=\{\}\x7F]+)(?:\=(?:([^\x00-\x20\(\)<>@\,;\:\\"\/\[\]\?\=\{\}\x7F]+)|(?:\"((?:[^"\\]|\\.)*)\")))?/g,((t,r,n,i)=>{const s=n||i;return e[r]=!s||s.toLowerCase(),""})),e["max-age"]){const t=parseInt(e["max-age"],10);isNaN(t)?delete e["max-age"]:e["max-age"]=t;}return e}let gt,xt,vt,bt=null;function wt(t){if(null==bt){const e=t.navigator?t.navigator.userAgent:null;bt=!!t.safari||!(!e||!(/\b(iPad|iPhone|iPod)\b/.test(e)||e.match("Safari")&&!e.match("Chrome")));}return bt}function _t(t){try{const e=a[t];return e.setItem("_mapbox_test_",1),e.removeItem("_mapbox_test_"),!0}catch(t){return !1}}const At={now:()=>void 0!==vt?vt:a.performance.now(),setNow(t){vt=t;},restoreNow(){vt=void 0;},frame(t){const e=a.requestAnimationFrame(t);return {cancel:()=>a.cancelAnimationFrame(e)}},getImageData(t,e=0){const r=a.document.createElement("canvas"),n=r.getContext("2d");if(!n)throw new Error("failed to create canvas 2d context");return r.width=t.width,r.height=t.height,n.drawImage(t,0,0,t.width,t.height),n.getImageData(-e,-e,t.width+2*e,t.height+2*e)},resolveURL:t=>(gt||(gt=a.document.createElement("a")),gt.href=t,gt.href),get devicePixelRatio(){return a.devicePixelRatio},get prefersReducedMotion(){return !!a.matchMedia&&(null==xt&&(xt=a.matchMedia("(prefers-reduced-motion: reduce)")),xt.matches)}};let kt;const St={API_URL:"https://api.mapbox.com",get API_URL_REGEX(){if(null==kt){const t=/^((https?:)?\/\/)?([^\/]+\.)?mapbox\.c(n|om)(\/|\?|$)/i;try{kt=null!=process.env.API_URL_REGEX?new RegExp(process.env.API_URL_REGEX):t;}catch(e){kt=t;}}return kt},get EVENTS_URL(){return this.API_URL?0===this.API_URL.indexOf("https://api.mapbox.cn")?"https://events.mapbox.cn/events/v2":0===this.API_URL.indexOf("https://api.mapbox.com")?"https://events.mapbox.com/events/v2":null:null},SESSION_PATH:"/map-sessions/v1",FEEDBACK_URL:"https://apps.mapbox.com/feedback",TILE_URL_VERSION:"v4",RASTER_URL_PREFIX:"raster/v1",REQUIRE_ACCESS_TOKEN:!0,ACCESS_TOKEN:null,MAX_PARALLEL_IMAGE_REQUESTS:16},It={supported:!1,testSupport:function(t){!Tt&&Mt&&(Bt?Ct(t):zt=t);}};let zt,Mt,Tt=!1,Bt=!1;function Ct(t){const e=t.createTexture();t.bindTexture(t.TEXTURE_2D,e);try{if(t.texImage2D(t.TEXTURE_2D,0,t.RGBA,t.RGBA,t.UNSIGNED_BYTE,Mt),t.isContextLost())return;It.supported=!0;}catch(t){}t.deleteTexture(e),Tt=!0;}a.document&&(Mt=a.document.createElement("img"),Mt.onload=function(){zt&&Ct(zt),zt=null,Bt=!0;},Mt.onerror=function(){Tt=!0,zt=null;},Mt.src="data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAQAAAAfQ//73v/+BiOh/AAA=");const Pt="01",Et="NO_ACCESS_TOKEN";function Dt(t){return 0===t.indexOf("mapbox:")}function Vt(t){return St.API_URL_REGEX.test(t)}const Ft=/^(\w+):\/\/([^/?]*)(\/[^?]+)?\??(.+)?/;function Lt(t){const e=t.match(Ft);if(!e)throw new Error("Unable to parse URL object");return {protocol:e[1],authority:e[2],path:e[3]||"/",params:e[4]?e[4].split("&"):[]}}function Rt(t){const e=t.params.length?`?${t.params.join("&")}`:"";return `${t.protocol}://${t.authority}${t.path}${e}`}function Ut(t){if(!t)return null;const e=t.split(".");if(!e||3!==e.length)return null;try{return JSON.parse(decodeURIComponent(a.atob(e[1]).split("").map((t=>"%"+("00"+t.charCodeAt(0).toString(16)).slice(-2))).join("")))}catch(t){return null}}class $t{constructor(t){this.type=t,this.anonId=null,this.eventData={},this.queue=[],this.pendingRequest=null;}getStorageKey(t){const e=Ut(St.ACCESS_TOKEN);let r="";return r=e&&e.u?a.btoa(encodeURIComponent(e.u).replace(/%([0-9A-F]{2})/g,((t,e)=>String.fromCharCode(Number("0x"+e))))):St.ACCESS_TOKEN||"",t?`mapbox.eventData.${t}:${r}`:`mapbox.eventData:${r}`}fetchEventData(){const t=_t("localStorage"),e=this.getStorageKey(),r=this.getStorageKey("uuid");if(t)try{const t=a.localStorage.getItem(e);t&&(this.eventData=JSON.parse(t));const n=a.localStorage.getItem(r);n&&(this.anonId=n);}catch(t){pt("Unable to read from LocalStorage");}}saveEventData(){const t=_t("localStorage"),e=this.getStorageKey(),r=this.getStorageKey("uuid");if(t)try{a.localStorage.setItem(r,this.anonId),Object.keys(this.eventData).length>=1&&a.localStorage.setItem(e,JSON.stringify(this.eventData));}catch(t){pt("Unable to write to LocalStorage");}}processRequests(t){}postEvent(t,r,n,i){if(!St.EVENTS_URL)return;const s=Lt(St.EVENTS_URL);s.params.push(`access_token=${i||St.ACCESS_TOKEN||""}`);const a={event:this.type,created:new Date(t).toISOString(),sdkIdentifier:"mapbox-gl-js",sdkVersion:e,skuId:Pt,userId:this.anonId},o=r?tt(a,r):a,l={url:Rt(s),headers:{"Content-Type":"text/plain"},body:JSON.stringify([o])};this.pendingRequest=oe(l,(t=>{this.pendingRequest=null,n(t),this.saveEventData(),this.processRequests(i);}));}queueRequest(t,e){this.queue.push(t),this.processRequests(e);}}const Ot=new class extends $t{constructor(t){super("appUserTurnstile"),this._customAccessToken=t;}postTurnstileEvent(t,e){St.EVENTS_URL&&St.ACCESS_TOKEN&&Array.isArray(t)&&t.some((t=>Dt(t)||Vt(t)))&&this.queueRequest(Date.now(),e);}processRequests(t){if(this.pendingRequest||0===this.queue.length)return;this.anonId&&this.eventData.lastSuccess&&this.eventData.tokenU||this.fetchEventData();const e=Ut(St.ACCESS_TOKEN),r=e?e.u:St.ACCESS_TOKEN;let n=r!==this.eventData.tokenU;st(this.anonId)||(this.anonId=nt(),n=!0);const i=this.queue.shift();if(this.eventData.lastSuccess){const t=new Date(this.eventData.lastSuccess),e=new Date(i),r=(i-this.eventData.lastSuccess)/864e5;n=n||r>=1||r<-1||t.getDate()!==e.getDate();}else n=!0;if(!n)return this.processRequests();this.postEvent(i,{"enabled.telemetry":!1},(t=>{t||(this.eventData.lastSuccess=i,this.eventData.tokenU=r);}),t);}},jt=Ot.postTurnstileEvent.bind(Ot),qt=new class extends $t{constructor(){super("map.load"),this.success={},this.skuToken="";}postMapLoadEvent(t,e,r,n){this.skuToken=e,this.errorCb=n,St.EVENTS_URL&&(r||St.ACCESS_TOKEN?this.queueRequest({id:t,timestamp:Date.now()},r):this.errorCb(new Error(Et)));}processRequests(t){if(this.pendingRequest||0===this.queue.length)return;const{id:e,timestamp:r}=this.queue.shift();e&&this.success[e]||(this.anonId||this.fetchEventData(),st(this.anonId)||(this.anonId=nt()),this.postEvent(r,{skuToken:this.skuToken},(t=>{t?this.errorCb(t):e&&(this.success[e]=!0);}),t));}},Nt=qt.postMapLoadEvent.bind(qt),Gt=new class extends $t{constructor(){super("map.auth"),this.success={},this.skuToken="";}getSession(t,e,r,n){if(!St.API_URL||!St.SESSION_PATH)return;const i=Lt(St.API_URL+St.SESSION_PATH);i.params.push(`sku=${e||""}`),i.params.push(`access_token=${n||St.ACCESS_TOKEN||""}`);const s={url:Rt(i),headers:{"Content-Type":"text/plain"}};this.pendingRequest=le(s,(t=>{this.pendingRequest=null,r(t),this.saveEventData(),this.processRequests(n);}));}getSessionAPI(t,e,r,n){this.skuToken=e,this.errorCb=n,St.SESSION_PATH&&St.API_URL&&(r||St.ACCESS_TOKEN?this.queueRequest({id:t,timestamp:Date.now()},r):this.errorCb(new Error(Et)));}processRequests(t){if(this.pendingRequest||0===this.queue.length)return;const{id:e,timestamp:r}=this.queue.shift();e&&this.success[e]||this.getSession(r,this.skuToken,(t=>{t?this.errorCb(t):e&&(this.success[e]=!0);}),t);}},Zt=Gt.getSessionAPI.bind(Gt),Xt=new Set,Kt="mapbox-tiles";let Yt,Ht,Jt=500,Wt=50;function Qt(){a.caches&&!Yt&&(Yt=a.caches.open(Kt));}function te(t){const e=t.indexOf("?");return e<0?t:t.slice(0,e)}let ee=1/0;const re={Unknown:"Unknown",Style:"Style",Source:"Source",Tile:"Tile",Glyphs:"Glyphs",SpriteImage:"SpriteImage",SpriteJSON:"SpriteJSON",Image:"Image"};"function"==typeof Object.freeze&&Object.freeze(re);class ne extends Error{constructor(t,e,r){401===e&&Vt(r)&&(t+=": you may have provided an invalid Mapbox access token. See https://www.mapbox.com/api-documentation/#access-tokens-and-token-scopes"),super(t),this.status=e,this.url=r;}toString(){return `${this.name}: ${this.message} (${this.status}): ${this.url}`}}const ie=yt()?()=>self.worker&&self.worker.referrer:()=>("blob:"===a.location.protocol?a.parent:a).location.href;const se=function(t,e){if(!(/^file:/.test(r=t.url)||/^file:/.test(ie())&&!/^\w+:/.test(r))){if(a.fetch&&a.Request&&a.AbortController&&a.Request.prototype.hasOwnProperty("signal"))return function(t,e){const r=new a.AbortController,n=new a.Request(t.url,{method:t.method||"GET",body:t.body,credentials:t.credentials,headers:t.headers,referrer:ie(),signal:r.signal});let i=!1,s=!1;const o=(l=n.url).indexOf("sku=")>0&&Vt(l);var l;"json"===t.type&&n.headers.set("Accept","application/json");const u=(r,i,l)=>{if(s)return;if(r&&"SecurityError"!==r.message&&pt(r),i&&l)return c(i);const u=Date.now();a.fetch(n).then((r=>{if(r.ok){const t=o?r.clone():null;return c(r,t,u)}return e(new ne(r.statusText,r.status,t.url))})).catch((t=>{20!==t.code&&e(new Error(t.message));}));},c=(r,o,l)=>{("arrayBuffer"===t.type?r.arrayBuffer():"json"===t.type?r.json():r.text()).then((t=>{s||(o&&l&&function(t,e,r){if(Qt(),!Yt)return;const n={status:e.status,statusText:e.statusText,headers:new a.Headers};e.headers.forEach(((t,e)=>n.headers.set(e,t)));const i=mt(e.headers.get("Cache-Control")||"");i["no-store"]||(i["max-age"]&&n.headers.set("Expires",new Date(r+1e3*i["max-age"]).toUTCString()),new Date(n.headers.get("Expires")).getTime()-r<42e4||function(t,e){if(void 0===Ht)try{new Response(new ReadableStream),Ht=!0;}catch(t){Ht=!1;}Ht?e(t.body):t.blob().then(e);}(e,(e=>{const r=new a.Response(e,n);Qt(),Yt&&Yt.then((e=>e.put(te(t.url),r))).catch((t=>pt(t.message)));})));}(n,o,l),i=!0,e(null,t,r.headers.get("Cache-Control"),r.headers.get("Expires")));})).catch((t=>{s||e(new Error(t.message));}));};return o?function(t,e){if(Qt(),!Yt)return e(null);const r=te(t.url);Yt.then((t=>{t.match(r).then((n=>{const i=function(t){if(!t)return !1;const e=new Date(t.headers.get("Expires")||0),r=mt(t.headers.get("Cache-Control")||"");return e>Date.now()&&!r["no-cache"]}(n);t.delete(r),i&&t.put(r,n.clone()),e(null,n,i);})).catch(e);})).catch(e);}(n,u):u(null,null),{cancel:()=>{s=!0,i||r.abort();}}}(t,e);if(yt()&&self.worker&&self.worker.actor)return self.worker.actor.send("getResource",t,e,void 0,!0)}var r;return function(t,e){const r=new a.XMLHttpRequest;r.open(t.method||"GET",t.url,!0),"arrayBuffer"===t.type&&(r.responseType="arraybuffer");for(const e in t.headers)r.setRequestHeader(e,t.headers[e]);return "json"===t.type&&(r.responseType="text",r.setRequestHeader("Accept","application/json")),r.withCredentials="include"===t.credentials,r.onerror=()=>{e(new Error(r.statusText));},r.onload=()=>{if((r.status>=200&&r.status<300||0===r.status)&&null!==r.response){let n=r.response;if("json"===t.type)try{n=JSON.parse(r.response);}catch(t){return e(t)}e(null,n,r.getResponseHeader("Cache-Control"),r.getResponseHeader("Expires"));}else e(new ne(r.statusText,r.status,t.url));},r.send(t.body),{cancel:()=>r.abort()}}(t,e)},ae=function(t,e){return se(tt(t,{type:"arrayBuffer"}),e)},oe=function(t,e){return se(tt(t,{method:"POST"}),e)},le=function(t,e){return se(tt(t,{method:"GET"}),e)};function ue(t){const e=a.document.createElement("a");return e.href=t,e.protocol===a.document.location.protocol&&e.host===a.document.location.host}const ce="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQYV2NgAAIAAAUAAarVyFEAAAAASUVORK5CYII=";let he,pe;he=[],pe=0;const de=function(t,e){if(It.supported&&(t.headers||(t.headers={}),t.headers.accept="image/webp,*/*"),pe>=St.MAX_PARALLEL_IMAGE_REQUESTS){const r={requestParameters:t,callback:e,cancelled:!1,cancel(){this.cancelled=!0;}};return he.push(r),r}pe++;let r=!1;const n=()=>{if(!r)for(r=!0,pe--;he.length&&pe<St.MAX_PARALLEL_IMAGE_REQUESTS;){const t=he.shift(),{requestParameters:e,callback:r,cancelled:n}=t;n||(t.cancel=de(e,r).cancel);}},i=ae(t,((t,r,i,s)=>{n(),t?e(t):r&&(a.createImageBitmap?function(t,e){const r=new a.Blob([new Uint8Array(t)],{type:"image/png"});a.createImageBitmap(r).then((t=>{e(null,t);})).catch((t=>{e(new Error(`Could not load image because of ${t.message}. Please make sure to use a supported image type such as PNG or JPEG. Note that SVGs are not supported.`));}));}(r,((t,r)=>e(t,r,i,s))):function(t,e){const r=new a.Image,n=a.URL;r.onload=()=>{e(null,r),n.revokeObjectURL(r.src),r.onload=null,a.requestAnimationFrame((()=>{r.src=ce;}));},r.onerror=()=>e(new Error("Could not load image. Please make sure to use a supported image type such as PNG or JPEG. Note that SVGs are not supported."));const i=new a.Blob([new Uint8Array(t)],{type:"image/png"});r.src=t.byteLength?n.createObjectURL(i):ce;}(r,((t,r)=>e(t,r,i,s))));}));return {cancel:()=>{i.cancel(),n();}}};function fe(t,e,r){r[t]&&-1!==r[t].indexOf(e)||(r[t]=r[t]||[],r[t].push(e));}function ye(t,e,r){if(r&&r[t]){const n=r[t].indexOf(e);-1!==n&&r[t].splice(n,1);}}class me{constructor(t,e={}){tt(this,e),this.type=t;}}class ge extends me{constructor(t,e={}){super("error",tt({error:t},e));}}class xe{on(t,e){return this._listeners=this._listeners||{},fe(t,e,this._listeners),this}off(t,e){return ye(t,e,this._listeners),ye(t,e,this._oneTimeListeners),this}once(t,e){return e?(this._oneTimeListeners=this._oneTimeListeners||{},fe(t,e,this._oneTimeListeners),this):new Promise((e=>this.once(t,e)))}fire(t,e){"string"==typeof t&&(t=new me(t,e||{}));const r=t.type;if(this.listens(r)){t.target=this;const e=this._listeners&&this._listeners[r]?this._listeners[r].slice():[];for(const r of e)r.call(this,t);const n=this._oneTimeListeners&&this._oneTimeListeners[r]?this._oneTimeListeners[r].slice():[];for(const e of n)ye(r,e,this._oneTimeListeners),e.call(this,t);const i=this._eventedParent;i&&(tt(t,"function"==typeof this._eventedParentData?this._eventedParentData():this._eventedParentData),i.fire(t));}else t instanceof ge&&console.error(t.error);return this}listens(t){return !!(this._listeners&&this._listeners[t]&&this._listeners[t].length>0||this._oneTimeListeners&&this._oneTimeListeners[t]&&this._oneTimeListeners[t].length>0||this._eventedParent&&this._eventedParent.listens(t))}setEventedParent(t,e){return this._eventedParent=t,this._eventedParentData=e,this}}var ve=JSON.parse('{"$version":8,"$root":{"version":{"required":true,"type":"enum","values":[8]},"name":{"type":"string"},"metadata":{"type":"*"},"center":{"type":"array","value":"number"},"zoom":{"type":"number"},"bearing":{"type":"number","default":0,"period":360,"units":"degrees"},"pitch":{"type":"number","default":0,"units":"degrees"},"light":{"type":"light"},"terrain":{"type":"terrain"},"fog":{"type":"fog"},"sources":{"required":true,"type":"sources"},"sprite":{"type":"string"},"glyphs":{"type":"string"},"transition":{"type":"transition"},"projection":{"type":"projection"},"layers":{"required":true,"type":"array","value":"layer"}},"sources":{"*":{"type":"source"}},"source":["source_vector","source_raster","source_raster_dem","source_geojson","source_video","source_image"],"source_vector":{"type":{"required":true,"type":"enum","values":{"vector":{}}},"url":{"type":"string"},"tiles":{"type":"array","value":"string"},"bounds":{"type":"array","value":"number","length":4,"default":[-180,-85.051129,180,85.051129]},"scheme":{"type":"enum","values":{"xyz":{},"tms":{}},"default":"xyz"},"minzoom":{"type":"number","default":0},"maxzoom":{"type":"number","default":22},"attribution":{"type":"string"},"promoteId":{"type":"promoteId"},"volatile":{"type":"boolean","default":false},"*":{"type":"*"}},"source_raster":{"type":{"required":true,"type":"enum","values":{"raster":{}}},"url":{"type":"string"},"tiles":{"type":"array","value":"string"},"bounds":{"type":"array","value":"number","length":4,"default":[-180,-85.051129,180,85.051129]},"minzoom":{"type":"number","default":0},"maxzoom":{"type":"number","default":22},"tileSize":{"type":"number","default":512,"units":"pixels"},"scheme":{"type":"enum","values":{"xyz":{},"tms":{}},"default":"xyz"},"attribution":{"type":"string"},"volatile":{"type":"boolean","default":false},"*":{"type":"*"}},"source_raster_dem":{"type":{"required":true,"type":"enum","values":{"raster-dem":{}}},"url":{"type":"string"},"tiles":{"type":"array","value":"string"},"bounds":{"type":"array","value":"number","length":4,"default":[-180,-85.051129,180,85.051129]},"minzoom":{"type":"number","default":0},"maxzoom":{"type":"number","default":22},"tileSize":{"type":"number","default":512,"units":"pixels"},"attribution":{"type":"string"},"encoding":{"type":"enum","values":{"terrarium":{},"mapbox":{}},"default":"mapbox"},"volatile":{"type":"boolean","default":false},"*":{"type":"*"}},"source_geojson":{"type":{"required":true,"type":"enum","values":{"geojson":{}}},"data":{"type":"*"},"maxzoom":{"type":"number","default":18},"attribution":{"type":"string"},"buffer":{"type":"number","default":128,"maximum":512,"minimum":0},"filter":{"type":"*"},"tolerance":{"type":"number","default":0.375},"cluster":{"type":"boolean","default":false},"clusterRadius":{"type":"number","default":50,"minimum":0},"clusterMaxZoom":{"type":"number"},"clusterMinPoints":{"type":"number"},"clusterProperties":{"type":"*"},"lineMetrics":{"type":"boolean","default":false},"generateId":{"type":"boolean","default":false},"promoteId":{"type":"promoteId"}},"source_video":{"type":{"required":true,"type":"enum","values":{"video":{}}},"urls":{"required":true,"type":"array","value":"string"},"coordinates":{"required":true,"type":"array","length":4,"value":{"type":"array","length":2,"value":"number"}}},"source_image":{"type":{"required":true,"type":"enum","values":{"image":{}}},"url":{"required":true,"type":"string"},"coordinates":{"required":true,"type":"array","length":4,"value":{"type":"array","length":2,"value":"number"}}},"layer":{"id":{"type":"string","required":true},"type":{"type":"enum","values":{"fill":{},"line":{},"symbol":{},"circle":{},"heatmap":{},"fill-extrusion":{},"raster":{},"hillshade":{},"background":{},"sky":{}},"required":true},"metadata":{"type":"*"},"source":{"type":"string"},"source-layer":{"type":"string"},"minzoom":{"type":"number","minimum":0,"maximum":24},"maxzoom":{"type":"number","minimum":0,"maximum":24},"filter":{"type":"filter"},"layout":{"type":"layout"},"paint":{"type":"paint"}},"layout":["layout_fill","layout_line","layout_circle","layout_heatmap","layout_fill-extrusion","layout_symbol","layout_raster","layout_hillshade","layout_background","layout_sky"],"layout_background":{"visibility":{"type":"enum","values":{"visible":{},"none":{}},"default":"visible","property-type":"constant"}},"layout_sky":{"visibility":{"type":"enum","values":{"visible":{},"none":{}},"default":"visible","property-type":"constant"}},"layout_fill":{"fill-sort-key":{"type":"number","expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"data-driven"},"visibility":{"type":"enum","values":{"visible":{},"none":{}},"default":"visible","property-type":"constant"}},"layout_circle":{"circle-sort-key":{"type":"number","expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"data-driven"},"visibility":{"type":"enum","values":{"visible":{},"none":{}},"default":"visible","property-type":"constant"}},"layout_heatmap":{"visibility":{"type":"enum","values":{"visible":{},"none":{}},"default":"visible","property-type":"constant"}},"layout_fill-extrusion":{"visibility":{"type":"enum","values":{"visible":{},"none":{}},"default":"visible","property-type":"constant"}},"layout_line":{"line-cap":{"type":"enum","values":{"butt":{},"round":{},"square":{}},"default":"butt","expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"data-driven"},"line-join":{"type":"enum","values":{"bevel":{},"round":{},"miter":{}},"default":"miter","expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"data-driven"},"line-miter-limit":{"type":"number","default":2,"requires":[{"line-join":"miter"}],"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"line-round-limit":{"type":"number","default":1.05,"requires":[{"line-join":"round"}],"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"line-sort-key":{"type":"number","expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"data-driven"},"visibility":{"type":"enum","values":{"visible":{},"none":{}},"default":"visible","property-type":"constant"}},"layout_symbol":{"symbol-placement":{"type":"enum","values":{"point":{},"line":{},"line-center":{}},"default":"point","expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"symbol-spacing":{"type":"number","default":250,"minimum":1,"units":"pixels","requires":[{"symbol-placement":"line"}],"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"symbol-avoid-edges":{"type":"boolean","default":false,"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"symbol-sort-key":{"type":"number","expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"data-driven"},"symbol-z-order":{"type":"enum","values":{"auto":{},"viewport-y":{},"source":{}},"default":"auto","expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"icon-allow-overlap":{"type":"boolean","default":false,"requires":["icon-image"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"icon-ignore-placement":{"type":"boolean","default":false,"requires":["icon-image"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"icon-optional":{"type":"boolean","default":false,"requires":["icon-image","text-field"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"icon-rotation-alignment":{"type":"enum","values":{"map":{},"viewport":{},"auto":{}},"default":"auto","requires":["icon-image"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"icon-size":{"type":"number","default":1,"minimum":0,"units":"factor of the original icon size","requires":["icon-image"],"expression":{"interpolated":true,"parameters":["zoom","feature"]},"property-type":"data-driven"},"icon-text-fit":{"type":"enum","values":{"none":{},"width":{},"height":{},"both":{}},"default":"none","requires":["icon-image","text-field"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"icon-text-fit-padding":{"type":"array","value":"number","length":4,"default":[0,0,0,0],"units":"pixels","requires":["icon-image","text-field",{"icon-text-fit":["both","width","height"]}],"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"icon-image":{"type":"resolvedImage","tokens":true,"expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"data-driven"},"icon-rotate":{"type":"number","default":0,"period":360,"units":"degrees","requires":["icon-image"],"expression":{"interpolated":true,"parameters":["zoom","feature"]},"property-type":"data-driven"},"icon-padding":{"type":"number","default":2,"minimum":0,"units":"pixels","requires":["icon-image"],"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"icon-keep-upright":{"type":"boolean","default":false,"requires":["icon-image",{"icon-rotation-alignment":"map"},{"symbol-placement":["line","line-center"]}],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"icon-offset":{"type":"array","value":"number","length":2,"default":[0,0],"requires":["icon-image"],"expression":{"interpolated":true,"parameters":["zoom","feature"]},"property-type":"data-driven"},"icon-anchor":{"type":"enum","values":{"center":{},"left":{},"right":{},"top":{},"bottom":{},"top-left":{},"top-right":{},"bottom-left":{},"bottom-right":{}},"default":"center","requires":["icon-image"],"expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"data-driven"},"icon-pitch-alignment":{"type":"enum","values":{"map":{},"viewport":{},"auto":{}},"default":"auto","requires":["icon-image"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"text-pitch-alignment":{"type":"enum","values":{"map":{},"viewport":{},"auto":{}},"default":"auto","requires":["text-field"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"text-rotation-alignment":{"type":"enum","values":{"map":{},"viewport":{},"auto":{}},"default":"auto","requires":["text-field"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"text-field":{"type":"formatted","default":"","tokens":true,"expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"data-driven"},"text-font":{"type":"array","value":"string","default":["Open Sans Regular","Arial Unicode MS Regular"],"requires":["text-field"],"expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"data-driven"},"text-size":{"type":"number","default":16,"minimum":0,"units":"pixels","requires":["text-field"],"expression":{"interpolated":true,"parameters":["zoom","feature"]},"property-type":"data-driven"},"text-max-width":{"type":"number","default":10,"minimum":0,"units":"ems","requires":["text-field",{"symbol-placement":["point"]}],"expression":{"interpolated":true,"parameters":["zoom","feature"]},"property-type":"data-driven"},"text-line-height":{"type":"number","default":1.2,"units":"ems","requires":["text-field"],"expression":{"interpolated":true,"parameters":["zoom","feature"]},"property-type":"data-driven"},"text-letter-spacing":{"type":"number","default":0,"units":"ems","requires":["text-field"],"expression":{"interpolated":true,"parameters":["zoom","feature"]},"property-type":"data-driven"},"text-justify":{"type":"enum","values":{"auto":{},"left":{},"center":{},"right":{}},"default":"center","requires":["text-field"],"expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"data-driven"},"text-radial-offset":{"type":"number","units":"ems","default":0,"requires":["text-field"],"property-type":"data-driven","expression":{"interpolated":true,"parameters":["zoom","feature"]}},"text-variable-anchor":{"type":"array","value":"enum","values":{"center":{},"left":{},"right":{},"top":{},"bottom":{},"top-left":{},"top-right":{},"bottom-left":{},"bottom-right":{}},"requires":["text-field",{"symbol-placement":["point"]}],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"text-anchor":{"type":"enum","values":{"center":{},"left":{},"right":{},"top":{},"bottom":{},"top-left":{},"top-right":{},"bottom-left":{},"bottom-right":{}},"default":"center","requires":["text-field",{"!":"text-variable-anchor"}],"expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"data-driven"},"text-max-angle":{"type":"number","default":45,"units":"degrees","requires":["text-field",{"symbol-placement":["line","line-center"]}],"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"text-writing-mode":{"type":"array","value":"enum","values":{"horizontal":{},"vertical":{}},"requires":["text-field"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"text-rotate":{"type":"number","default":0,"period":360,"units":"degrees","requires":["text-field"],"expression":{"interpolated":true,"parameters":["zoom","feature"]},"property-type":"data-driven"},"text-padding":{"type":"number","default":2,"minimum":0,"units":"pixels","requires":["text-field"],"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"text-keep-upright":{"type":"boolean","default":true,"requires":["text-field",{"text-rotation-alignment":"map"},{"symbol-placement":["line","line-center"]}],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"text-transform":{"type":"enum","values":{"none":{},"uppercase":{},"lowercase":{}},"default":"none","requires":["text-field"],"expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"data-driven"},"text-offset":{"type":"array","value":"number","units":"ems","length":2,"default":[0,0],"requires":["text-field",{"!":"text-radial-offset"}],"expression":{"interpolated":true,"parameters":["zoom","feature"]},"property-type":"data-driven"},"text-allow-overlap":{"type":"boolean","default":false,"requires":["text-field"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"text-ignore-placement":{"type":"boolean","default":false,"requires":["text-field"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"text-optional":{"type":"boolean","default":false,"requires":["text-field","icon-image"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"visibility":{"type":"enum","values":{"visible":{},"none":{}},"default":"visible","property-type":"constant"}},"layout_raster":{"visibility":{"type":"enum","values":{"visible":{},"none":{}},"default":"visible","property-type":"constant"}},"layout_hillshade":{"visibility":{"type":"enum","values":{"visible":{},"none":{}},"default":"visible","property-type":"constant"}},"filter":{"type":"array","value":"*"},"filter_symbol":{"type":"boolean","default":false,"transition":false,"property-type":"data-driven","expression":{"interpolated":false,"parameters":["zoom","feature","pitch","distance-from-center"]}},"filter_fill":{"type":"boolean","default":false,"transition":false,"property-type":"data-driven","expression":{"interpolated":false,"parameters":["zoom","feature"]}},"filter_line":{"type":"boolean","default":false,"transition":false,"property-type":"data-driven","expression":{"interpolated":false,"parameters":["zoom","feature"]}},"filter_circle":{"type":"boolean","default":false,"transition":false,"property-type":"data-driven","expression":{"interpolated":false,"parameters":["zoom","feature"]}},"filter_fill-extrusion":{"type":"boolean","default":false,"transition":false,"property-type":"data-driven","expression":{"interpolated":false,"parameters":["zoom","feature"]}},"filter_heatmap":{"type":"boolean","default":false,"transition":false,"property-type":"data-driven","expression":{"interpolated":false,"parameters":["zoom","feature"]}},"filter_operator":{"type":"enum","values":{"==":{},"!=":{},">":{},">=":{},"<":{},"<=":{},"in":{},"!in":{},"all":{},"any":{},"none":{},"has":{},"!has":{},"within":{}}},"geometry_type":{"type":"enum","values":{"Point":{},"LineString":{},"Polygon":{}}},"function":{"expression":{"type":"expression"},"stops":{"type":"array","value":"function_stop"},"base":{"type":"number","default":1,"minimum":0},"property":{"type":"string","default":"$zoom"},"type":{"type":"enum","values":{"identity":{},"exponential":{},"interval":{},"categorical":{}},"default":"exponential"},"colorSpace":{"type":"enum","values":{"rgb":{},"lab":{},"hcl":{}},"default":"rgb"},"default":{"type":"*","required":false}},"function_stop":{"type":"array","minimum":0,"maximum":24,"value":["number","color"],"length":2},"expression":{"type":"array","value":"*","minimum":1},"fog":{"range":{"type":"array","default":[0.5,10],"minimum":-20,"maximum":20,"length":2,"value":"number","property-type":"data-constant","transition":true,"expression":{"interpolated":true,"parameters":["zoom"]}},"color":{"type":"color","property-type":"data-constant","default":"#ffffff","expression":{"interpolated":true,"parameters":["zoom"]},"transition":true},"horizon-blend":{"type":"number","property-type":"data-constant","default":0.1,"minimum":0,"maximum":1,"expression":{"interpolated":true,"parameters":["zoom"]},"transition":true}},"light":{"anchor":{"type":"enum","default":"viewport","values":{"map":{},"viewport":{}},"property-type":"data-constant","transition":false,"expression":{"interpolated":false,"parameters":["zoom"]}},"position":{"type":"array","default":[1.15,210,30],"length":3,"value":"number","property-type":"data-constant","transition":true,"expression":{"interpolated":true,"parameters":["zoom"]}},"color":{"type":"color","property-type":"data-constant","default":"#ffffff","expression":{"interpolated":true,"parameters":["zoom"]},"transition":true},"intensity":{"type":"number","property-type":"data-constant","default":0.5,"minimum":0,"maximum":1,"expression":{"interpolated":true,"parameters":["zoom"]},"transition":true}},"projection":{"name":{"type":"enum","values":{"albers":{},"equalEarth":{},"equirectangular":{},"lambertConformalConic":{},"mercator":{},"naturalEarth":{},"winkelTripel":{}},"default":"mercator","required":true},"center":{"type":"array","length":2,"value":"number","property-type":"data-constant","transition":false,"requires":[{"name":["albers","lambertConformalConic"]}]},"parallels":{"type":"array","length":2,"value":"number","property-type":"data-constant","transition":false,"requires":[{"name":["albers","lambertConformalConic"]}]}},"terrain":{"source":{"type":"string","required":true},"exaggeration":{"type":"number","property-type":"data-constant","default":1,"minimum":0,"maximum":1000,"expression":{"interpolated":true,"parameters":["zoom"]},"transition":true}},"paint":["paint_fill","paint_line","paint_circle","paint_heatmap","paint_fill-extrusion","paint_symbol","paint_raster","paint_hillshade","paint_background","paint_sky"],"paint_fill":{"fill-antialias":{"type":"boolean","default":true,"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"fill-opacity":{"type":"number","default":1,"minimum":0,"maximum":1,"transition":true,"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"fill-color":{"type":"color","default":"#000000","transition":true,"requires":[{"!":"fill-pattern"}],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"fill-outline-color":{"type":"color","transition":true,"requires":[{"!":"fill-pattern"},{"fill-antialias":true}],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"fill-translate":{"type":"array","value":"number","length":2,"default":[0,0],"transition":true,"units":"pixels","expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"fill-translate-anchor":{"type":"enum","values":{"map":{},"viewport":{}},"default":"map","requires":["fill-translate"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"fill-pattern":{"type":"resolvedImage","transition":true,"expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"cross-faded-data-driven"}},"paint_fill-extrusion":{"fill-extrusion-opacity":{"type":"number","default":1,"minimum":0,"maximum":1,"transition":true,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"fill-extrusion-color":{"type":"color","default":"#000000","transition":true,"requires":[{"!":"fill-extrusion-pattern"}],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"fill-extrusion-translate":{"type":"array","value":"number","length":2,"default":[0,0],"transition":true,"units":"pixels","expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"fill-extrusion-translate-anchor":{"type":"enum","values":{"map":{},"viewport":{}},"default":"map","requires":["fill-extrusion-translate"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"fill-extrusion-pattern":{"type":"resolvedImage","transition":true,"expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"cross-faded-data-driven"},"fill-extrusion-height":{"type":"number","default":0,"minimum":0,"units":"meters","transition":true,"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"fill-extrusion-base":{"type":"number","default":0,"minimum":0,"units":"meters","transition":true,"requires":["fill-extrusion-height"],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"fill-extrusion-vertical-gradient":{"type":"boolean","default":true,"transition":false,"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"}},"paint_line":{"line-opacity":{"type":"number","default":1,"minimum":0,"maximum":1,"transition":true,"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"line-color":{"type":"color","default":"#000000","transition":true,"requires":[{"!":"line-pattern"}],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"line-translate":{"type":"array","value":"number","length":2,"default":[0,0],"transition":true,"units":"pixels","expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"line-translate-anchor":{"type":"enum","values":{"map":{},"viewport":{}},"default":"map","requires":["line-translate"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"line-width":{"type":"number","default":1,"minimum":0,"transition":true,"units":"pixels","expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"line-gap-width":{"type":"number","default":0,"minimum":0,"transition":true,"units":"pixels","expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"line-offset":{"type":"number","default":0,"transition":true,"units":"pixels","expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"line-blur":{"type":"number","default":0,"minimum":0,"transition":true,"units":"pixels","expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"line-dasharray":{"type":"array","value":"number","minimum":0,"transition":true,"units":"line widths","requires":[{"!":"line-pattern"}],"expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"cross-faded-data-driven"},"line-pattern":{"type":"resolvedImage","transition":true,"expression":{"interpolated":false,"parameters":["zoom","feature"]},"property-type":"cross-faded-data-driven"},"line-gradient":{"type":"color","transition":false,"requires":[{"!":"line-pattern"},{"source":"geojson","has":{"lineMetrics":true}}],"expression":{"interpolated":true,"parameters":["line-progress"]},"property-type":"color-ramp"}},"paint_circle":{"circle-radius":{"type":"number","default":5,"minimum":0,"transition":true,"units":"pixels","expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"circle-color":{"type":"color","default":"#000000","transition":true,"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"circle-blur":{"type":"number","default":0,"transition":true,"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"circle-opacity":{"type":"number","default":1,"minimum":0,"maximum":1,"transition":true,"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"circle-translate":{"type":"array","value":"number","length":2,"default":[0,0],"transition":true,"units":"pixels","expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"circle-translate-anchor":{"type":"enum","values":{"map":{},"viewport":{}},"default":"map","requires":["circle-translate"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"circle-pitch-scale":{"type":"enum","values":{"map":{},"viewport":{}},"default":"map","expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"circle-pitch-alignment":{"type":"enum","values":{"map":{},"viewport":{}},"default":"viewport","expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"circle-stroke-width":{"type":"number","default":0,"minimum":0,"transition":true,"units":"pixels","expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"circle-stroke-color":{"type":"color","default":"#000000","transition":true,"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"circle-stroke-opacity":{"type":"number","default":1,"minimum":0,"maximum":1,"transition":true,"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"}},"paint_heatmap":{"heatmap-radius":{"type":"number","default":30,"minimum":1,"transition":true,"units":"pixels","expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"heatmap-weight":{"type":"number","default":1,"minimum":0,"transition":false,"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"heatmap-intensity":{"type":"number","default":1,"minimum":0,"transition":true,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"heatmap-color":{"type":"color","default":["interpolate",["linear"],["heatmap-density"],0,"rgba(0, 0, 255, 0)",0.1,"royalblue",0.3,"cyan",0.5,"lime",0.7,"yellow",1,"red"],"transition":false,"expression":{"interpolated":true,"parameters":["heatmap-density"]},"property-type":"color-ramp"},"heatmap-opacity":{"type":"number","default":1,"minimum":0,"maximum":1,"transition":true,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"}},"paint_symbol":{"icon-opacity":{"type":"number","default":1,"minimum":0,"maximum":1,"transition":true,"requires":["icon-image"],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"icon-color":{"type":"color","default":"#000000","transition":true,"requires":["icon-image"],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"icon-halo-color":{"type":"color","default":"rgba(0, 0, 0, 0)","transition":true,"requires":["icon-image"],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"icon-halo-width":{"type":"number","default":0,"minimum":0,"transition":true,"units":"pixels","requires":["icon-image"],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"icon-halo-blur":{"type":"number","default":0,"minimum":0,"transition":true,"units":"pixels","requires":["icon-image"],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"icon-translate":{"type":"array","value":"number","length":2,"default":[0,0],"transition":true,"units":"pixels","requires":["icon-image"],"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"icon-translate-anchor":{"type":"enum","values":{"map":{},"viewport":{}},"default":"map","requires":["icon-image","icon-translate"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"text-opacity":{"type":"number","default":1,"minimum":0,"maximum":1,"transition":true,"requires":["text-field"],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"text-color":{"type":"color","default":"#000000","transition":true,"overridable":true,"requires":["text-field"],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"text-halo-color":{"type":"color","default":"rgba(0, 0, 0, 0)","transition":true,"requires":["text-field"],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"text-halo-width":{"type":"number","default":0,"minimum":0,"transition":true,"units":"pixels","requires":["text-field"],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"text-halo-blur":{"type":"number","default":0,"minimum":0,"transition":true,"units":"pixels","requires":["text-field"],"expression":{"interpolated":true,"parameters":["zoom","feature","feature-state"]},"property-type":"data-driven"},"text-translate":{"type":"array","value":"number","length":2,"default":[0,0],"transition":true,"units":"pixels","requires":["text-field"],"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"text-translate-anchor":{"type":"enum","values":{"map":{},"viewport":{}},"default":"map","requires":["text-field","text-translate"],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"}},"paint_raster":{"raster-opacity":{"type":"number","default":1,"minimum":0,"maximum":1,"transition":true,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"raster-hue-rotate":{"type":"number","default":0,"period":360,"transition":true,"units":"degrees","expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"raster-brightness-min":{"type":"number","default":0,"minimum":0,"maximum":1,"transition":true,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"raster-brightness-max":{"type":"number","default":1,"minimum":0,"maximum":1,"transition":true,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"raster-saturation":{"type":"number","default":0,"minimum":-1,"maximum":1,"transition":true,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"raster-contrast":{"type":"number","default":0,"minimum":-1,"maximum":1,"transition":true,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"raster-resampling":{"type":"enum","values":{"linear":{},"nearest":{}},"default":"linear","expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"raster-fade-duration":{"type":"number","default":300,"minimum":0,"transition":false,"units":"milliseconds","expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"}},"paint_hillshade":{"hillshade-illumination-direction":{"type":"number","default":335,"minimum":0,"maximum":359,"transition":false,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"hillshade-illumination-anchor":{"type":"enum","values":{"map":{},"viewport":{}},"default":"viewport","expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"hillshade-exaggeration":{"type":"number","default":0.5,"minimum":0,"maximum":1,"transition":true,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"hillshade-shadow-color":{"type":"color","default":"#000000","transition":true,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"hillshade-highlight-color":{"type":"color","default":"#FFFFFF","transition":true,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"hillshade-accent-color":{"type":"color","default":"#000000","transition":true,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"}},"paint_background":{"background-color":{"type":"color","default":"#000000","transition":true,"requires":[{"!":"background-pattern"}],"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"},"background-pattern":{"type":"resolvedImage","transition":true,"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"cross-faded"},"background-opacity":{"type":"number","default":1,"minimum":0,"maximum":1,"transition":true,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"}},"paint_sky":{"sky-type":{"type":"enum","values":{"gradient":{},"atmosphere":{}},"default":"atmosphere","expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"sky-atmosphere-sun":{"type":"array","value":"number","length":2,"units":"degrees","minimum":[0,0],"maximum":[360,180],"transition":false,"requires":[{"sky-type":"atmosphere"}],"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"sky-atmosphere-sun-intensity":{"type":"number","requires":[{"sky-type":"atmosphere"}],"default":10,"minimum":0,"maximum":100,"transition":false,"property-type":"data-constant"},"sky-gradient-center":{"type":"array","requires":[{"sky-type":"gradient"}],"value":"number","default":[0,0],"length":2,"units":"degrees","minimum":[0,0],"maximum":[360,180],"transition":false,"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"sky-gradient-radius":{"type":"number","requires":[{"sky-type":"gradient"}],"default":90,"minimum":0,"maximum":180,"transition":false,"expression":{"interpolated":false,"parameters":["zoom"]},"property-type":"data-constant"},"sky-gradient":{"type":"color","default":["interpolate",["linear"],["sky-radial-progress"],0.8,"#87ceeb",1,"white"],"transition":false,"requires":[{"sky-type":"gradient"}],"expression":{"interpolated":true,"parameters":["sky-radial-progress"]},"property-type":"color-ramp"},"sky-atmosphere-halo-color":{"type":"color","default":"white","transition":false,"requires":[{"sky-type":"atmosphere"}],"property-type":"data-constant"},"sky-atmosphere-color":{"type":"color","default":"white","transition":false,"requires":[{"sky-type":"atmosphere"}],"property-type":"data-constant"},"sky-opacity":{"type":"number","default":1,"minimum":0,"maximum":1,"transition":true,"expression":{"interpolated":true,"parameters":["zoom"]},"property-type":"data-constant"}},"transition":{"duration":{"type":"number","default":300,"minimum":0,"units":"milliseconds"},"delay":{"type":"number","default":0,"minimum":0,"units":"milliseconds"}},"property-type":{"data-driven":{"type":"property-type"},"cross-faded":{"type":"property-type"},"cross-faded-data-driven":{"type":"property-type"},"color-ramp":{"type":"property-type"},"data-constant":{"type":"property-type"},"constant":{"type":"property-type"}},"promoteId":{"*":{"type":"string"}}}');class be{constructor(t,e,r,n){this.message=(t?`${t}: `:"")+r,n&&(this.identifier=n),null!=e&&e.__line__&&(this.line=e.__line__);}}function we(t){const e=t.value;return e?[new be(t.key,e,"constants have been deprecated as of v8")]:[]}function _e(t,...e){for(const r of e)for(const e in r)t[e]=r[e];return t}function Ae(t){return t instanceof Number||t instanceof String||t instanceof Boolean?t.valueOf():t}function ke(t){if(Array.isArray(t))return t.map(ke);if(t instanceof Object&&!(t instanceof Number||t instanceof String||t instanceof Boolean)){const e={};for(const r in t)e[r]=ke(t[r]);return e}return Ae(t)}class Se extends Error{constructor(t,e){super(e),this.message=e,this.key=t;}}class Ie{constructor(t,e=[]){this.parent=t,this.bindings={};for(const[t,r]of e)this.bindings[t]=r;}concat(t){return new Ie(this,t)}get(t){if(this.bindings[t])return this.bindings[t];if(this.parent)return this.parent.get(t);throw new Error(`${t} not found in scope.`)}has(t){return !!this.bindings[t]||!!this.parent&&this.parent.has(t)}}const ze={kind:"null"},Me={kind:"number"},Te={kind:"string"},Be={kind:"boolean"},Ce={kind:"color"},Pe={kind:"object"},Ee={kind:"value"},De={kind:"collator"},Ve={kind:"formatted"},Fe={kind:"resolvedImage"};function Le(t,e){return {kind:"array",itemType:t,N:e}}function Re(t){if("array"===t.kind){const e=Re(t.itemType);return "number"==typeof t.N?`array<${e}, ${t.N}>`:"value"===t.itemType.kind?"array":`array<${e}>`}return t.kind}const Ue=[ze,Me,Te,Be,Ce,Ve,Pe,Le(Ee),Fe];function $e(t,e){if("error"===e.kind)return null;if("array"===t.kind){if("array"===e.kind&&(0===e.N&&"value"===e.itemType.kind||!$e(t.itemType,e.itemType))&&("number"!=typeof t.N||t.N===e.N))return null}else {if(t.kind===e.kind)return null;if("value"===t.kind)for(const t of Ue)if(!$e(t,e))return null}return `Expected ${Re(t)} but found ${Re(e)} instead.`}function Oe(t,e){return e.some((e=>e.kind===t.kind))}function je(t,e){return e.some((e=>"null"===e?null===t:"array"===e?Array.isArray(t):"object"===e?t&&!Array.isArray(t)&&"object"==typeof t:e===typeof t))}function qe(t){var e={exports:{}};return t(e,e.exports),e.exports}var Ne=qe((function(t,e){var r={transparent:[0,0,0,0],aliceblue:[240,248,255,1],antiquewhite:[250,235,215,1],aqua:[0,255,255,1],aquamarine:[127,255,212,1],azure:[240,255,255,1],beige:[245,245,220,1],bisque:[255,228,196,1],black:[0,0,0,1],blanchedalmond:[255,235,205,1],blue:[0,0,255,1],blueviolet:[138,43,226,1],brown:[165,42,42,1],burlywood:[222,184,135,1],cadetblue:[95,158,160,1],chartreuse:[127,255,0,1],chocolate:[210,105,30,1],coral:[255,127,80,1],cornflowerblue:[100,149,237,1],cornsilk:[255,248,220,1],crimson:[220,20,60,1],cyan:[0,255,255,1],darkblue:[0,0,139,1],darkcyan:[0,139,139,1],darkgoldenrod:[184,134,11,1],darkgray:[169,169,169,1],darkgreen:[0,100,0,1],darkgrey:[169,169,169,1],darkkhaki:[189,183,107,1],darkmagenta:[139,0,139,1],darkolivegreen:[85,107,47,1],darkorange:[255,140,0,1],darkorchid:[153,50,204,1],darkred:[139,0,0,1],darksalmon:[233,150,122,1],darkseagreen:[143,188,143,1],darkslateblue:[72,61,139,1],darkslategray:[47,79,79,1],darkslategrey:[47,79,79,1],darkturquoise:[0,206,209,1],darkviolet:[148,0,211,1],deeppink:[255,20,147,1],deepskyblue:[0,191,255,1],dimgray:[105,105,105,1],dimgrey:[105,105,105,1],dodgerblue:[30,144,255,1],firebrick:[178,34,34,1],floralwhite:[255,250,240,1],forestgreen:[34,139,34,1],fuchsia:[255,0,255,1],gainsboro:[220,220,220,1],ghostwhite:[248,248,255,1],gold:[255,215,0,1],goldenrod:[218,165,32,1],gray:[128,128,128,1],green:[0,128,0,1],greenyellow:[173,255,47,1],grey:[128,128,128,1],honeydew:[240,255,240,1],hotpink:[255,105,180,1],indianred:[205,92,92,1],indigo:[75,0,130,1],ivory:[255,255,240,1],khaki:[240,230,140,1],lavender:[230,230,250,1],lavenderblush:[255,240,245,1],lawngreen:[124,252,0,1],lemonchiffon:[255,250,205,1],lightblue:[173,216,230,1],lightcoral:[240,128,128,1],lightcyan:[224,255,255,1],lightgoldenrodyellow:[250,250,210,1],lightgray:[211,211,211,1],lightgreen:[144,238,144,1],lightgrey:[211,211,211,1],lightpink:[255,182,193,1],lightsalmon:[255,160,122,1],lightseagreen:[32,178,170,1],lightskyblue:[135,206,250,1],lightslategray:[119,136,153,1],lightslategrey:[119,136,153,1],lightsteelblue:[176,196,222,1],lightyellow:[255,255,224,1],lime:[0,255,0,1],limegreen:[50,205,50,1],linen:[250,240,230,1],magenta:[255,0,255,1],maroon:[128,0,0,1],mediumaquamarine:[102,205,170,1],mediumblue:[0,0,205,1],mediumorchid:[186,85,211,1],mediumpurple:[147,112,219,1],mediumseagreen:[60,179,113,1],mediumslateblue:[123,104,238,1],mediumspringgreen:[0,250,154,1],mediumturquoise:[72,209,204,1],mediumvioletred:[199,21,133,1],midnightblue:[25,25,112,1],mintcream:[245,255,250,1],mistyrose:[255,228,225,1],moccasin:[255,228,181,1],navajowhite:[255,222,173,1],navy:[0,0,128,1],oldlace:[253,245,230,1],olive:[128,128,0,1],olivedrab:[107,142,35,1],orange:[255,165,0,1],orangered:[255,69,0,1],orchid:[218,112,214,1],palegoldenrod:[238,232,170,1],palegreen:[152,251,152,1],paleturquoise:[175,238,238,1],palevioletred:[219,112,147,1],papayawhip:[255,239,213,1],peachpuff:[255,218,185,1],peru:[205,133,63,1],pink:[255,192,203,1],plum:[221,160,221,1],powderblue:[176,224,230,1],purple:[128,0,128,1],rebeccapurple:[102,51,153,1],red:[255,0,0,1],rosybrown:[188,143,143,1],royalblue:[65,105,225,1],saddlebrown:[139,69,19,1],salmon:[250,128,114,1],sandybrown:[244,164,96,1],seagreen:[46,139,87,1],seashell:[255,245,238,1],sienna:[160,82,45,1],silver:[192,192,192,1],skyblue:[135,206,235,1],slateblue:[106,90,205,1],slategray:[112,128,144,1],slategrey:[112,128,144,1],snow:[255,250,250,1],springgreen:[0,255,127,1],steelblue:[70,130,180,1],tan:[210,180,140,1],teal:[0,128,128,1],thistle:[216,191,216,1],tomato:[255,99,71,1],turquoise:[64,224,208,1],violet:[238,130,238,1],wheat:[245,222,179,1],white:[255,255,255,1],whitesmoke:[245,245,245,1],yellow:[255,255,0,1],yellowgreen:[154,205,50,1]};function n(t){return (t=Math.round(t))<0?0:t>255?255:t}function i(t){return n("%"===t[t.length-1]?parseFloat(t)/100*255:parseInt(t))}function s(t){return (e="%"===t[t.length-1]?parseFloat(t)/100:parseFloat(t))<0?0:e>1?1:e;var e;}function a(t,e,r){return r<0?r+=1:r>1&&(r-=1),6*r<1?t+(e-t)*r*6:2*r<1?e:3*r<2?t+(e-t)*(2/3-r)*6:t}try{e.parseCSSColor=function(t){var e,o=t.replace(/ /g,"").toLowerCase();if(o in r)return r[o].slice();if("#"===o[0])return 4===o.length?(e=parseInt(o.substr(1),16))>=0&&e<=4095?[(3840&e)>>4|(3840&e)>>8,240&e|(240&e)>>4,15&e|(15&e)<<4,1]:null:7===o.length&&(e=parseInt(o.substr(1),16))>=0&&e<=16777215?[(16711680&e)>>16,(65280&e)>>8,255&e,1]:null;var l=o.indexOf("("),u=o.indexOf(")");if(-1!==l&&u+1===o.length){var c=o.substr(0,l),h=o.substr(l+1,u-(l+1)).split(","),p=1;switch(c){case"rgba":if(4!==h.length)return null;p=s(h.pop());case"rgb":return 3!==h.length?null:[i(h[0]),i(h[1]),i(h[2]),p];case"hsla":if(4!==h.length)return null;p=s(h.pop());case"hsl":if(3!==h.length)return null;var d=(parseFloat(h[0])%360+360)%360/360,f=s(h[1]),y=s(h[2]),m=y<=.5?y*(f+1):y+f-y*f,g=2*y-m;return [n(255*a(g,m,d+1/3)),n(255*a(g,m,d)),n(255*a(g,m,d-1/3)),p];default:return null}}return null};}catch(t){}}));class Ge{constructor(t,e,r,n=1){this.r=t,this.g=e,this.b=r,this.a=n;}static parse(t){if(!t)return;if(t instanceof Ge)return t;if("string"!=typeof t)return;const e=Ne.parseCSSColor(t);return e?new Ge(e[0]/255*e[3],e[1]/255*e[3],e[2]/255*e[3],e[3]):void 0}toString(){const[t,e,r,n]=this.toArray();return `rgba(${Math.round(t)},${Math.round(e)},${Math.round(r)},${n})`}toArray(){const{r:t,g:e,b:r,a:n}=this;return 0===n?[0,0,0,0]:[255*t/n,255*e/n,255*r/n,n]}}Ge.black=new Ge(0,0,0,1),Ge.white=new Ge(1,1,1,1),Ge.transparent=new Ge(0,0,0,0),Ge.red=new Ge(1,0,0,1),Ge.blue=new Ge(0,0,1,1);class Ze{constructor(t,e,r){this.sensitivity=t?e?"variant":"case":e?"accent":"base",this.locale=r,this.collator=new Intl.Collator(this.locale?this.locale:[],{sensitivity:this.sensitivity,usage:"search"});}compare(t,e){return this.collator.compare(t,e)}resolvedLocale(){return new Intl.Collator(this.locale?this.locale:[]).resolvedOptions().locale}}class Xe{constructor(t,e,r,n,i){this.text=t.normalize?t.normalize():t,this.image=e,this.scale=r,this.fontStack=n,this.textColor=i;}}class Ke{constructor(t){this.sections=t;}static fromString(t){return new Ke([new Xe(t,null,null,null,null)])}isEmpty(){return 0===this.sections.length||!this.sections.some((t=>0!==t.text.length||t.image&&0!==t.image.name.length))}static factory(t){return t instanceof Ke?t:Ke.fromString(t)}toString(){return 0===this.sections.length?"":this.sections.map((t=>t.text)).join("")}serialize(){const t=["format"];for(const e of this.sections){if(e.image){t.push(["image",e.image.name]);continue}t.push(e.text);const r={};e.fontStack&&(r["text-font"]=["literal",e.fontStack.split(",")]),e.scale&&(r["font-scale"]=e.scale),e.textColor&&(r["text-color"]=["rgba"].concat(e.textColor.toArray())),t.push(r);}return t}}class Ye{constructor(t){this.name=t.name,this.available=t.available;}toString(){return this.name}static fromString(t){return t?new Ye({name:t,available:!1}):null}serialize(){return ["image",this.name]}}function He(t,e,r,n){return "number"==typeof t&&t>=0&&t<=255&&"number"==typeof e&&e>=0&&e<=255&&"number"==typeof r&&r>=0&&r<=255?void 0===n||"number"==typeof n&&n>=0&&n<=1?null:`Invalid rgba value [${[t,e,r,n].join(", ")}]: 'a' must be between 0 and 1.`:`Invalid rgba value [${("number"==typeof n?[t,e,r,n]:[t,e,r]).join(", ")}]: 'r', 'g', and 'b' must be between 0 and 255.`}function Je(t){if(null===t)return !0;if("string"==typeof t)return !0;if("boolean"==typeof t)return !0;if("number"==typeof t)return !0;if(t instanceof Ge)return !0;if(t instanceof Ze)return !0;if(t instanceof Ke)return !0;if(t instanceof Ye)return !0;if(Array.isArray(t)){for(const e of t)if(!Je(e))return !1;return !0}if("object"==typeof t){for(const e in t)if(!Je(t[e]))return !1;return !0}return !1}function We(t){if(null===t)return ze;if("string"==typeof t)return Te;if("boolean"==typeof t)return Be;if("number"==typeof t)return Me;if(t instanceof Ge)return Ce;if(t instanceof Ze)return De;if(t instanceof Ke)return Ve;if(t instanceof Ye)return Fe;if(Array.isArray(t)){const e=t.length;let r;for(const e of t){const t=We(e);if(r){if(r===t)continue;r=Ee;break}r=t;}return Le(r||Ee,e)}return Pe}function Qe(t){const e=typeof t;return null===t?"":"string"===e||"number"===e||"boolean"===e?String(t):t instanceof Ge||t instanceof Ke||t instanceof Ye?t.toString():JSON.stringify(t)}class tr{constructor(t,e){this.type=t,this.value=e;}static parse(t,e){if(2!==t.length)return e.error(`'literal' expression requires exactly one argument, but found ${t.length-1} instead.`);if(!Je(t[1]))return e.error("invalid value");const r=t[1];let n=We(r);const i=e.expectedType;return "array"!==n.kind||0!==n.N||!i||"array"!==i.kind||"number"==typeof i.N&&0!==i.N||(n=i),new tr(n,r)}evaluate(){return this.value}eachChild(){}outputDefined(){return !0}serialize(){return "array"===this.type.kind||"object"===this.type.kind?["literal",this.value]:this.value instanceof Ge?["rgba"].concat(this.value.toArray()):this.value instanceof Ke?this.value.serialize():this.value}}class er{constructor(t){this.name="ExpressionEvaluationError",this.message=t;}toJSON(){return this.message}}const rr={string:Te,number:Me,boolean:Be,object:Pe};class nr{constructor(t,e){this.type=t,this.args=e;}static parse(t,e){if(t.length<2)return e.error("Expected at least one argument.");let r,n=1;const i=t[0];if("array"===i){let i,s;if(t.length>2){const r=t[1];if("string"!=typeof r||!(r in rr)||"object"===r)return e.error('The item type argument of "array" must be one of string, number, boolean',1);i=rr[r],n++;}else i=Ee;if(t.length>3){if(null!==t[2]&&("number"!=typeof t[2]||t[2]<0||t[2]!==Math.floor(t[2])))return e.error('The length argument to "array" must be a positive integer literal',2);s=t[2],n++;}r=Le(i,s);}else r=rr[i];const s=[];for(;n<t.length;n++){const r=e.parse(t[n],n,Ee);if(!r)return null;s.push(r);}return new nr(r,s)}evaluate(t){for(let e=0;e<this.args.length;e++){const r=this.args[e].evaluate(t);if(!$e(this.type,We(r)))return r;if(e===this.args.length-1)throw new er(`Expected value to be of type ${Re(this.type)}, but found ${Re(We(r))} instead.`)}return null}eachChild(t){this.args.forEach(t);}outputDefined(){return this.args.every((t=>t.outputDefined()))}serialize(){const t=this.type,e=[t.kind];if("array"===t.kind){const r=t.itemType;if("string"===r.kind||"number"===r.kind||"boolean"===r.kind){e.push(r.kind);const n=t.N;("number"==typeof n||this.args.length>1)&&e.push(n);}}return e.concat(this.args.map((t=>t.serialize())))}}class ir{constructor(t){this.type=Ve,this.sections=t;}static parse(t,e){if(t.length<2)return e.error("Expected at least one argument.");const r=t[1];if(!Array.isArray(r)&&"object"==typeof r)return e.error("First argument must be an image or text section.");const n=[];let i=!1;for(let r=1;r<=t.length-1;++r){const s=t[r];if(i&&"object"==typeof s&&!Array.isArray(s)){i=!1;let t=null;if(s["font-scale"]&&(t=e.parse(s["font-scale"],1,Me),!t))return null;let r=null;if(s["text-font"]&&(r=e.parse(s["text-font"],1,Le(Te)),!r))return null;let a=null;if(s["text-color"]&&(a=e.parse(s["text-color"],1,Ce),!a))return null;const o=n[n.length-1];o.scale=t,o.font=r,o.textColor=a;}else {const s=e.parse(t[r],1,Ee);if(!s)return null;const a=s.type.kind;if("string"!==a&&"value"!==a&&"null"!==a&&"resolvedImage"!==a)return e.error("Formatted text type must be 'string', 'value', 'image' or 'null'.");i=!0,n.push({content:s,scale:null,font:null,textColor:null});}}return new ir(n)}evaluate(t){return new Ke(this.sections.map((e=>{const r=e.content.evaluate(t);return We(r)===Fe?new Xe("",r,null,null,null):new Xe(Qe(r),null,e.scale?e.scale.evaluate(t):null,e.font?e.font.evaluate(t).join(","):null,e.textColor?e.textColor.evaluate(t):null)})))}eachChild(t){for(const e of this.sections)t(e.content),e.scale&&t(e.scale),e.font&&t(e.font),e.textColor&&t(e.textColor);}outputDefined(){return !1}serialize(){const t=["format"];for(const e of this.sections){t.push(e.content.serialize());const r={};e.scale&&(r["font-scale"]=e.scale.serialize()),e.font&&(r["text-font"]=e.font.serialize()),e.textColor&&(r["text-color"]=e.textColor.serialize()),t.push(r);}return t}}class sr{constructor(t){this.type=Fe,this.input=t;}static parse(t,e){if(2!==t.length)return e.error("Expected two arguments.");const r=e.parse(t[1],1,Te);return r?new sr(r):e.error("No image name provided.")}evaluate(t){const e=this.input.evaluate(t),r=Ye.fromString(e);return r&&t.availableImages&&(r.available=t.availableImages.indexOf(e)>-1),r}eachChild(t){t(this.input);}outputDefined(){return !1}serialize(){return ["image",this.input.serialize()]}}const ar={"to-boolean":Be,"to-color":Ce,"to-number":Me,"to-string":Te};class or{constructor(t,e){this.type=t,this.args=e;}static parse(t,e){if(t.length<2)return e.error("Expected at least one argument.");const r=t[0];if(("to-boolean"===r||"to-string"===r)&&2!==t.length)return e.error("Expected one argument.");const n=ar[r],i=[];for(let r=1;r<t.length;r++){const n=e.parse(t[r],r,Ee);if(!n)return null;i.push(n);}return new or(n,i)}evaluate(t){if("boolean"===this.type.kind)return Boolean(this.args[0].evaluate(t));if("color"===this.type.kind){let e,r;for(const n of this.args){if(e=n.evaluate(t),r=null,e instanceof Ge)return e;if("string"==typeof e){const r=t.parseColor(e);if(r)return r}else if(Array.isArray(e)&&(r=e.length<3||e.length>4?`Invalid rbga value ${JSON.stringify(e)}: expected an array containing either three or four numeric values.`:He(e[0],e[1],e[2],e[3]),!r))return new Ge(e[0]/255,e[1]/255,e[2]/255,e[3])}throw new er(r||`Could not parse color from value '${"string"==typeof e?e:String(JSON.stringify(e))}'`)}if("number"===this.type.kind){let e=null;for(const r of this.args){if(e=r.evaluate(t),null===e)return 0;const n=Number(e);if(!isNaN(n))return n}throw new er(`Could not convert ${JSON.stringify(e)} to number.`)}return "formatted"===this.type.kind?Ke.fromString(Qe(this.args[0].evaluate(t))):"resolvedImage"===this.type.kind?Ye.fromString(Qe(this.args[0].evaluate(t))):Qe(this.args[0].evaluate(t))}eachChild(t){this.args.forEach(t);}outputDefined(){return this.args.every((t=>t.outputDefined()))}serialize(){if("formatted"===this.type.kind)return new ir([{content:this.args[0],scale:null,font:null,textColor:null}]).serialize();if("resolvedImage"===this.type.kind)return new sr(this.args[0]).serialize();const t=[`to-${this.type.kind}`];return this.eachChild((e=>{t.push(e.serialize());})),t}}const lr=["Unknown","Point","LineString","Polygon"];class ur{constructor(){this.globals=null,this.feature=null,this.featureState=null,this.formattedSection=null,this._parseColorCache={},this.availableImages=null,this.canonical=null,this.featureTileCoord=null,this.featureDistanceData=null;}id(){return this.feature&&"id"in this.feature?this.feature.id:null}geometryType(){return this.feature?"number"==typeof this.feature.type?lr[this.feature.type]:this.feature.type:null}geometry(){return this.feature&&"geometry"in this.feature?this.feature.geometry:null}canonicalID(){return this.canonical}properties(){return this.feature&&this.feature.properties||{}}distanceFromCenter(){if(this.featureTileCoord&&this.featureDistanceData){const t=this.featureDistanceData.center,e=this.featureDistanceData.scale,{x:r,y:n}=this.featureTileCoord;return this.featureDistanceData.bearing[0]*(r*e-t[0])+this.featureDistanceData.bearing[1]*(n*e-t[1])}return 0}parseColor(t){let e=this._parseColorCache[t];return e||(e=this._parseColorCache[t]=Ge.parse(t)),e}}class cr{constructor(t,e,r,n){this.name=t,this.type=e,this._evaluate=r,this.args=n;}evaluate(t){return this._evaluate(t,this.args)}eachChild(t){this.args.forEach(t);}outputDefined(){return !1}serialize(){return [this.name].concat(this.args.map((t=>t.serialize())))}static parse(t,e){const r=t[0],n=cr.definitions[r];if(!n)return e.error(`Unknown expression "${r}". If you wanted a literal array, use ["literal", [...]].`,0);const i=Array.isArray(n)?n[0]:n.type,s=Array.isArray(n)?[[n[1],n[2]]]:n.overloads,a=s.filter((([e])=>!Array.isArray(e)||e.length===t.length-1));let o=null;for(const[n,s]of a){o=new Er(e.registry,e.path,null,e.scope);const a=[];let l=!1;for(let e=1;e<t.length;e++){const r=t[e],i=Array.isArray(n)?n[e-1]:n.type,s=o.parse(r,1+a.length,i);if(!s){l=!0;break}a.push(s);}if(!l)if(Array.isArray(n)&&n.length!==a.length)o.error(`Expected ${n.length} arguments, but found ${a.length} instead.`);else {for(let t=0;t<a.length;t++){const e=Array.isArray(n)?n[t]:n.type,r=a[t];o.concat(t+1).checkSubtype(e,r.type);}if(0===o.errors.length)return new cr(r,i,s,a)}}if(1===a.length)e.errors.push(...o.errors);else {const r=(a.length?a:s).map((([t])=>{return e=t,Array.isArray(e)?`(${e.map(Re).join(", ")})`:`(${Re(e.type)}...)`;var e;})).join(" | "),n=[];for(let r=1;r<t.length;r++){const i=e.parse(t[r],1+n.length);if(!i)return null;n.push(Re(i.type));}e.error(`Expected arguments of type ${r}, but found (${n.join(", ")}) instead.`);}return null}static register(t,e){cr.definitions=e;for(const r in e)t[r]=cr;}}class hr{constructor(t,e,r){this.type=De,this.locale=r,this.caseSensitive=t,this.diacriticSensitive=e;}static parse(t,e){if(2!==t.length)return e.error("Expected one argument.");const r=t[1];if("object"!=typeof r||Array.isArray(r))return e.error("Collator options argument must be an object.");const n=e.parse(void 0!==r["case-sensitive"]&&r["case-sensitive"],1,Be);if(!n)return null;const i=e.parse(void 0!==r["diacritic-sensitive"]&&r["diacritic-sensitive"],1,Be);if(!i)return null;let s=null;return r.locale&&(s=e.parse(r.locale,1,Te),!s)?null:new hr(n,i,s)}evaluate(t){return new Ze(this.caseSensitive.evaluate(t),this.diacriticSensitive.evaluate(t),this.locale?this.locale.evaluate(t):null)}eachChild(t){t(this.caseSensitive),t(this.diacriticSensitive),this.locale&&t(this.locale);}outputDefined(){return !1}serialize(){const t={};return t["case-sensitive"]=this.caseSensitive.serialize(),t["diacritic-sensitive"]=this.diacriticSensitive.serialize(),this.locale&&(t.locale=this.locale.serialize()),["collator",t]}}const pr=8192;function dr(t,e){t[0]=Math.min(t[0],e[0]),t[1]=Math.min(t[1],e[1]),t[2]=Math.max(t[2],e[0]),t[3]=Math.max(t[3],e[1]);}function fr(t,e){return !(t[0]<=e[0]||t[2]>=e[2]||t[1]<=e[1]||t[3]>=e[3])}function yr(t,e){const r=(180+t[0])/360,n=(180-180/Math.PI*Math.log(Math.tan(Math.PI/4+t[1]*Math.PI/360)))/360,i=Math.pow(2,e.z);return [Math.round(r*i*pr),Math.round(n*i*pr)]}function mr(t,e,r){const n=t[0]-e[0],i=t[1]-e[1],s=t[0]-r[0],a=t[1]-r[1];return n*a-s*i==0&&n*s<=0&&i*a<=0}function gr(t,e){let r=!1;for(let a=0,o=e.length;a<o;a++){const o=e[a];for(let e=0,a=o.length;e<a-1;e++){if(mr(t,o[e],o[e+1]))return !1;(i=o[e])[1]>(n=t)[1]!=(s=o[e+1])[1]>n[1]&&n[0]<(s[0]-i[0])*(n[1]-i[1])/(s[1]-i[1])+i[0]&&(r=!r);}}var n,i,s;return r}function xr(t,e){for(let r=0;r<e.length;r++)if(gr(t,e[r]))return !0;return !1}function vr(t,e,r,n){const i=n[0]-r[0],s=n[1]-r[1],a=(t[0]-r[0])*s-i*(t[1]-r[1]),o=(e[0]-r[0])*s-i*(e[1]-r[1]);return a>0&&o<0||a<0&&o>0}function br(t,e,r){for(const u of r)for(let r=0;r<u.length-1;++r)if(0!=(o=[(a=u[r+1])[0]-(s=u[r])[0],a[1]-s[1]])[0]*(l=[(i=e)[0]-(n=t)[0],i[1]-n[1]])[1]-o[1]*l[0]&&vr(n,i,s,a)&&vr(s,a,n,i))return !0;var n,i,s,a,o,l;return !1}function wr(t,e){for(let r=0;r<t.length;++r)if(!gr(t[r],e))return !1;for(let r=0;r<t.length-1;++r)if(br(t[r],t[r+1],e))return !1;return !0}function _r(t,e){for(let r=0;r<e.length;r++)if(wr(t,e[r]))return !0;return !1}function Ar(t,e,r){const n=[];for(let i=0;i<t.length;i++){const s=[];for(let n=0;n<t[i].length;n++){const a=yr(t[i][n],r);dr(e,a),s.push(a);}n.push(s);}return n}function kr(t,e,r){const n=[];for(let i=0;i<t.length;i++){const s=Ar(t[i],e,r);n.push(s);}return n}function Sr(t,e,r,n){if(t[0]<r[0]||t[0]>r[2]){const e=.5*n;let i=t[0]-r[0]>e?-n:r[0]-t[0]>e?n:0;0===i&&(i=t[0]-r[2]>e?-n:r[2]-t[0]>e?n:0),t[0]+=i;}dr(e,t);}function Ir(t,e,r,n){const i=Math.pow(2,n.z)*pr,s=[n.x*pr,n.y*pr],a=[];for(const n of t)for(const t of n){const n=[t.x+s[0],t.y+s[1]];Sr(n,e,r,i),a.push(n);}return a}function zr(t,e,r,n){const i=Math.pow(2,n.z)*pr,s=[n.x*pr,n.y*pr],a=[];for(const r of t){const t=[];for(const n of r){const r=[n.x+s[0],n.y+s[1]];dr(e,r),t.push(r);}a.push(t);}if(e[2]-e[0]<=i/2){(o=e)[0]=o[1]=1/0,o[2]=o[3]=-1/0;for(const t of a)for(const n of t)Sr(n,e,r,i);}var o;return a}class Mr{constructor(t,e){this.type=Be,this.geojson=t,this.geometries=e;}static parse(t,e){if(2!==t.length)return e.error(`'within' expression requires exactly one argument, but found ${t.length-1} instead.`);if(Je(t[1])){const e=t[1];if("FeatureCollection"===e.type)for(let t=0;t<e.features.length;++t){const r=e.features[t].geometry.type;if("Polygon"===r||"MultiPolygon"===r)return new Mr(e,e.features[t].geometry)}else if("Feature"===e.type){const t=e.geometry.type;if("Polygon"===t||"MultiPolygon"===t)return new Mr(e,e.geometry)}else if("Polygon"===e.type||"MultiPolygon"===e.type)return new Mr(e,e)}return e.error("'within' expression requires valid geojson object that contains polygon geometry type.")}evaluate(t){if(null!=t.geometry()&&null!=t.canonicalID()){if("Point"===t.geometryType())return function(t,e){const r=[1/0,1/0,-1/0,-1/0],n=[1/0,1/0,-1/0,-1/0],i=t.canonicalID();if("Polygon"===e.type){const s=Ar(e.coordinates,n,i),a=Ir(t.geometry(),r,n,i);if(!fr(r,n))return !1;for(const t of a)if(!gr(t,s))return !1}if("MultiPolygon"===e.type){const s=kr(e.coordinates,n,i),a=Ir(t.geometry(),r,n,i);if(!fr(r,n))return !1;for(const t of a)if(!xr(t,s))return !1}return !0}(t,this.geometries);if("LineString"===t.geometryType())return function(t,e){const r=[1/0,1/0,-1/0,-1/0],n=[1/0,1/0,-1/0,-1/0],i=t.canonicalID();if("Polygon"===e.type){const s=Ar(e.coordinates,n,i),a=zr(t.geometry(),r,n,i);if(!fr(r,n))return !1;for(const t of a)if(!wr(t,s))return !1}if("MultiPolygon"===e.type){const s=kr(e.coordinates,n,i),a=zr(t.geometry(),r,n,i);if(!fr(r,n))return !1;for(const t of a)if(!_r(t,s))return !1}return !0}(t,this.geometries)}return !1}eachChild(){}outputDefined(){return !0}serialize(){return ["within",this.geojson]}}function Tr(t){if(t instanceof cr){if("get"===t.name&&1===t.args.length)return !1;if("feature-state"===t.name)return !1;if("has"===t.name&&1===t.args.length)return !1;if("properties"===t.name||"geometry-type"===t.name||"id"===t.name)return !1;if(/^filter-/.test(t.name))return !1}if(t instanceof Mr)return !1;let e=!0;return t.eachChild((t=>{e&&!Tr(t)&&(e=!1);})),e}function Br(t){if(t instanceof cr&&"feature-state"===t.name)return !1;let e=!0;return t.eachChild((t=>{e&&!Br(t)&&(e=!1);})),e}function Cr(t,e){if(t instanceof cr&&e.indexOf(t.name)>=0)return !1;let r=!0;return t.eachChild((t=>{r&&!Cr(t,e)&&(r=!1);})),r}class Pr{constructor(t,e){this.type=e.type,this.name=t,this.boundExpression=e;}static parse(t,e){if(2!==t.length||"string"!=typeof t[1])return e.error("'var' expression requires exactly one string literal argument.");const r=t[1];return e.scope.has(r)?new Pr(r,e.scope.get(r)):e.error(`Unknown variable "${r}". Make sure "${r}" has been bound in an enclosing "let" expression before using it.`,1)}evaluate(t){return this.boundExpression.evaluate(t)}eachChild(){}outputDefined(){return !1}serialize(){return ["var",this.name]}}class Er{constructor(t,e=[],r,n=new Ie,i=[]){this.registry=t,this.path=e,this.key=e.map((t=>`[${t}]`)).join(""),this.scope=n,this.errors=i,this.expectedType=r;}parse(t,e,r,n,i={}){return e?this.concat(e,r,n)._parse(t,i):this._parse(t,i)}_parse(t,e){function r(t,e,r){return "assert"===r?new nr(e,[t]):"coerce"===r?new or(e,[t]):t}if(null!==t&&"string"!=typeof t&&"boolean"!=typeof t&&"number"!=typeof t||(t=["literal",t]),Array.isArray(t)){if(0===t.length)return this.error('Expected an array with at least one element. If you wanted a literal array, use ["literal", []].');const n=t[0];if("string"!=typeof n)return this.error(`Expression name must be a string, but found ${typeof n} instead. If you wanted a literal array, use ["literal", [...]].`,0),null;const i=this.registry[n];if(i){let n=i.parse(t,this);if(!n)return null;if(this.expectedType){const t=this.expectedType,i=n.type;if("string"!==t.kind&&"number"!==t.kind&&"boolean"!==t.kind&&"object"!==t.kind&&"array"!==t.kind||"value"!==i.kind)if("color"!==t.kind&&"formatted"!==t.kind&&"resolvedImage"!==t.kind||"value"!==i.kind&&"string"!==i.kind){if(this.checkSubtype(t,i))return null}else n=r(n,t,e.typeAnnotation||"coerce");else n=r(n,t,e.typeAnnotation||"assert");}if(!(n instanceof tr)&&"resolvedImage"!==n.type.kind&&Dr(n)){const t=new ur;try{n=new tr(n.type,n.evaluate(t));}catch(t){return this.error(t.message),null}}return n}return this.error(`Unknown expression "${n}". If you wanted a literal array, use ["literal", [...]].`,0)}return this.error(void 0===t?"'undefined' value invalid. Use null instead.":"object"==typeof t?'Bare objects invalid. Use ["literal", {...}] instead.':`Expected an array, but found ${typeof t} instead.`)}concat(t,e,r){const n="number"==typeof t?this.path.concat(t):this.path,i=r?this.scope.concat(r):this.scope;return new Er(this.registry,n,e||null,i,this.errors)}error(t,...e){const r=`${this.key}${e.map((t=>`[${t}]`)).join("")}`;this.errors.push(new Se(r,t));}checkSubtype(t,e){const r=$e(t,e);return r&&this.error(r),r}}function Dr(t){if(t instanceof Pr)return Dr(t.boundExpression);if(t instanceof cr&&"error"===t.name)return !1;if(t instanceof hr)return !1;if(t instanceof Mr)return !1;const e=t instanceof or||t instanceof nr;let r=!0;return t.eachChild((t=>{r=e?r&&Dr(t):r&&t instanceof tr;})),!!r&&Tr(t)&&Cr(t,["zoom","heatmap-density","line-progress","sky-radial-progress","accumulated","is-supported-script","pitch","distance-from-center"])}function Vr(t,e){const r=t.length-1;let n,i,s=0,a=r,o=0;for(;s<=a;)if(o=Math.floor((s+a)/2),n=t[o],i=t[o+1],n<=e){if(o===r||e<i)return o;s=o+1;}else {if(!(n>e))throw new er("Input is not a number.");a=o-1;}return 0}class Fr{constructor(t,e,r){this.type=t,this.input=e,this.labels=[],this.outputs=[];for(const[t,e]of r)this.labels.push(t),this.outputs.push(e);}static parse(t,e){if(t.length-1<4)return e.error(`Expected at least 4 arguments, but found only ${t.length-1}.`);if((t.length-1)%2!=0)return e.error("Expected an even number of arguments.");const r=e.parse(t[1],1,Me);if(!r)return null;const n=[];let i=null;e.expectedType&&"value"!==e.expectedType.kind&&(i=e.expectedType);for(let r=1;r<t.length;r+=2){const s=1===r?-1/0:t[r],a=t[r+1],o=r,l=r+1;if("number"!=typeof s)return e.error('Input/output pairs for "step" expressions must be defined using literal numeric values (not computed expressions) for the input values.',o);if(n.length&&n[n.length-1][0]>=s)return e.error('Input/output pairs for "step" expressions must be arranged with input values in strictly ascending order.',o);const u=e.parse(a,l,i);if(!u)return null;i=i||u.type,n.push([s,u]);}return new Fr(i,r,n)}evaluate(t){const e=this.labels,r=this.outputs;if(1===e.length)return r[0].evaluate(t);const n=this.input.evaluate(t);if(n<=e[0])return r[0].evaluate(t);const i=e.length;return n>=e[i-1]?r[i-1].evaluate(t):r[Vr(e,n)].evaluate(t)}eachChild(t){t(this.input);for(const e of this.outputs)t(e);}outputDefined(){return this.outputs.every((t=>t.outputDefined()))}serialize(){const t=["step",this.input.serialize()];for(let e=0;e<this.labels.length;e++)e>0&&t.push(this.labels[e]),t.push(this.outputs[e].serialize());return t}}function Lr(t,e,r){return t*(1-r)+e*r}var Rr=Object.freeze({__proto__:null,number:Lr,color:function(t,e,r){return new Ge(Lr(t.r,e.r,r),Lr(t.g,e.g,r),Lr(t.b,e.b,r),Lr(t.a,e.a,r))},array:function(t,e,r){return t.map(((t,n)=>Lr(t,e[n],r)))}});const Ur=.95047,$r=1.08883,Or=4/29,jr=6/29,qr=3*jr*jr,Nr=Math.PI/180,Gr=180/Math.PI;function Zr(t){return t>.008856451679035631?Math.pow(t,1/3):t/qr+Or}function Xr(t){return t>jr?t*t*t:qr*(t-Or)}function Kr(t){return 255*(t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055)}function Yr(t){return (t/=255)<=.04045?t/12.92:Math.pow((t+.055)/1.055,2.4)}function Hr(t){const e=Yr(t.r),r=Yr(t.g),n=Yr(t.b),i=Zr((.4124564*e+.3575761*r+.1804375*n)/Ur),s=Zr((.2126729*e+.7151522*r+.072175*n)/1);return {l:116*s-16,a:500*(i-s),b:200*(s-Zr((.0193339*e+.119192*r+.9503041*n)/$r)),alpha:t.a}}function Jr(t){let e=(t.l+16)/116,r=isNaN(t.a)?e:e+t.a/500,n=isNaN(t.b)?e:e-t.b/200;return e=1*Xr(e),r=Ur*Xr(r),n=$r*Xr(n),new Ge(Kr(3.2404542*r-1.5371385*e-.4985314*n),Kr(-.969266*r+1.8760108*e+.041556*n),Kr(.0556434*r-.2040259*e+1.0572252*n),t.alpha)}function Wr(t,e,r){const n=e-t;return t+r*(n>180||n<-180?n-360*Math.round(n/360):n)}const Qr={forward:Hr,reverse:Jr,interpolate:function(t,e,r){return {l:Lr(t.l,e.l,r),a:Lr(t.a,e.a,r),b:Lr(t.b,e.b,r),alpha:Lr(t.alpha,e.alpha,r)}}},tn={forward:function(t){const{l:e,a:r,b:n}=Hr(t),i=Math.atan2(n,r)*Gr;return {h:i<0?i+360:i,c:Math.sqrt(r*r+n*n),l:e,alpha:t.a}},reverse:function(t){const e=t.h*Nr,r=t.c;return Jr({l:t.l,a:Math.cos(e)*r,b:Math.sin(e)*r,alpha:t.alpha})},interpolate:function(t,e,r){return {h:Wr(t.h,e.h,r),c:Lr(t.c,e.c,r),l:Lr(t.l,e.l,r),alpha:Lr(t.alpha,e.alpha,r)}}};var en=Object.freeze({__proto__:null,lab:Qr,hcl:tn});class rn{constructor(t,e,r,n,i){this.type=t,this.operator=e,this.interpolation=r,this.input=n,this.labels=[],this.outputs=[];for(const[t,e]of i)this.labels.push(t),this.outputs.push(e);}static interpolationFactor(t,e,n,i){let s=0;if("exponential"===t.name)s=nn(e,t.base,n,i);else if("linear"===t.name)s=nn(e,1,n,i);else if("cubic-bezier"===t.name){const a=t.controlPoints;s=new r(a[0],a[1],a[2],a[3]).solve(nn(e,1,n,i));}return s}static parse(t,e){let[r,n,i,...s]=t;if(!Array.isArray(n)||0===n.length)return e.error("Expected an interpolation type expression.",1);if("linear"===n[0])n={name:"linear"};else if("exponential"===n[0]){const t=n[1];if("number"!=typeof t)return e.error("Exponential interpolation requires a numeric base.",1,1);n={name:"exponential",base:t};}else {if("cubic-bezier"!==n[0])return e.error(`Unknown interpolation type ${String(n[0])}`,1,0);{const t=n.slice(1);if(4!==t.length||t.some((t=>"number"!=typeof t||t<0||t>1)))return e.error("Cubic bezier interpolation requires four numeric arguments with values between 0 and 1.",1);n={name:"cubic-bezier",controlPoints:t};}}if(t.length-1<4)return e.error(`Expected at least 4 arguments, but found only ${t.length-1}.`);if((t.length-1)%2!=0)return e.error("Expected an even number of arguments.");if(i=e.parse(i,2,Me),!i)return null;const a=[];let o=null;"interpolate-hcl"===r||"interpolate-lab"===r?o=Ce:e.expectedType&&"value"!==e.expectedType.kind&&(o=e.expectedType);for(let t=0;t<s.length;t+=2){const r=s[t],n=s[t+1],i=t+3,l=t+4;if("number"!=typeof r)return e.error('Input/output pairs for "interpolate" expressions must be defined using literal numeric values (not computed expressions) for the input values.',i);if(a.length&&a[a.length-1][0]>=r)return e.error('Input/output pairs for "interpolate" expressions must be arranged with input values in strictly ascending order.',i);const u=e.parse(n,l,o);if(!u)return null;o=o||u.type,a.push([r,u]);}return "number"===o.kind||"color"===o.kind||"array"===o.kind&&"number"===o.itemType.kind&&"number"==typeof o.N?new rn(o,r,n,i,a):e.error(`Type ${Re(o)} is not interpolatable.`)}evaluate(t){const e=this.labels,r=this.outputs;if(1===e.length)return r[0].evaluate(t);const n=this.input.evaluate(t);if(n<=e[0])return r[0].evaluate(t);const i=e.length;if(n>=e[i-1])return r[i-1].evaluate(t);const s=Vr(e,n),a=rn.interpolationFactor(this.interpolation,n,e[s],e[s+1]),o=r[s].evaluate(t),l=r[s+1].evaluate(t);return "interpolate"===this.operator?Rr[this.type.kind.toLowerCase()](o,l,a):"interpolate-hcl"===this.operator?tn.reverse(tn.interpolate(tn.forward(o),tn.forward(l),a)):Qr.reverse(Qr.interpolate(Qr.forward(o),Qr.forward(l),a))}eachChild(t){t(this.input);for(const e of this.outputs)t(e);}outputDefined(){return this.outputs.every((t=>t.outputDefined()))}serialize(){let t;t="linear"===this.interpolation.name?["linear"]:"exponential"===this.interpolation.name?1===this.interpolation.base?["linear"]:["exponential",this.interpolation.base]:["cubic-bezier"].concat(this.interpolation.controlPoints);const e=[this.operator,t,this.input.serialize()];for(let t=0;t<this.labels.length;t++)e.push(this.labels[t],this.outputs[t].serialize());return e}}function nn(t,e,r,n){const i=n-r,s=t-r;return 0===i?0:1===e?s/i:(Math.pow(e,s)-1)/(Math.pow(e,i)-1)}class sn{constructor(t,e){this.type=t,this.args=e;}static parse(t,e){if(t.length<2)return e.error("Expectected at least one argument.");let r=null;const n=e.expectedType;n&&"value"!==n.kind&&(r=n);const i=[];for(const n of t.slice(1)){const t=e.parse(n,1+i.length,r,void 0,{typeAnnotation:"omit"});if(!t)return null;r=r||t.type,i.push(t);}const s=n&&i.some((t=>$e(n,t.type)));return new sn(s?Ee:r,i)}evaluate(t){let e,r=null,n=0;for(const i of this.args){if(n++,r=i.evaluate(t),r&&r instanceof Ye&&!r.available&&(e||(e=r),r=null,n===this.args.length))return e;if(null!==r)break}return r}eachChild(t){this.args.forEach(t);}outputDefined(){return this.args.every((t=>t.outputDefined()))}serialize(){const t=["coalesce"];return this.eachChild((e=>{t.push(e.serialize());})),t}}class an{constructor(t,e){this.type=e.type,this.bindings=[].concat(t),this.result=e;}evaluate(t){return this.result.evaluate(t)}eachChild(t){for(const e of this.bindings)t(e[1]);t(this.result);}static parse(t,e){if(t.length<4)return e.error(`Expected at least 3 arguments, but found ${t.length-1} instead.`);const r=[];for(let n=1;n<t.length-1;n+=2){const i=t[n];if("string"!=typeof i)return e.error(`Expected string, but found ${typeof i} instead.`,n);if(/[^a-zA-Z0-9_]/.test(i))return e.error("Variable names must contain only alphanumeric characters or '_'.",n);const s=e.parse(t[n+1],n+1);if(!s)return null;r.push([i,s]);}const n=e.parse(t[t.length-1],t.length-1,e.expectedType,r);return n?new an(r,n):null}outputDefined(){return this.result.outputDefined()}serialize(){const t=["let"];for(const[e,r]of this.bindings)t.push(e,r.serialize());return t.push(this.result.serialize()),t}}class on{constructor(t,e,r){this.type=t,this.index=e,this.input=r;}static parse(t,e){if(3!==t.length)return e.error(`Expected 2 arguments, but found ${t.length-1} instead.`);const r=e.parse(t[1],1,Me),n=e.parse(t[2],2,Le(e.expectedType||Ee));return r&&n?new on(n.type.itemType,r,n):null}evaluate(t){const e=this.index.evaluate(t),r=this.input.evaluate(t);if(e<0)throw new er(`Array index out of bounds: ${e} < 0.`);if(e>=r.length)throw new er(`Array index out of bounds: ${e} > ${r.length-1}.`);if(e!==Math.floor(e))throw new er(`Array index must be an integer, but found ${e} instead.`);return r[e]}eachChild(t){t(this.index),t(this.input);}outputDefined(){return !1}serialize(){return ["at",this.index.serialize(),this.input.serialize()]}}class ln{constructor(t,e){this.type=Be,this.needle=t,this.haystack=e;}static parse(t,e){if(3!==t.length)return e.error(`Expected 2 arguments, but found ${t.length-1} instead.`);const r=e.parse(t[1],1,Ee),n=e.parse(t[2],2,Ee);return r&&n?Oe(r.type,[Be,Te,Me,ze,Ee])?new ln(r,n):e.error(`Expected first argument to be of type boolean, string, number or null, but found ${Re(r.type)} instead`):null}evaluate(t){const e=this.needle.evaluate(t),r=this.haystack.evaluate(t);if(!r)return !1;if(!je(e,["boolean","string","number","null"]))throw new er(`Expected first argument to be of type boolean, string, number or null, but found ${Re(We(e))} instead.`);if(!je(r,["string","array"]))throw new er(`Expected second argument to be of type array or string, but found ${Re(We(r))} instead.`);return r.indexOf(e)>=0}eachChild(t){t(this.needle),t(this.haystack);}outputDefined(){return !0}serialize(){return ["in",this.needle.serialize(),this.haystack.serialize()]}}class un{constructor(t,e,r){this.type=Me,this.needle=t,this.haystack=e,this.fromIndex=r;}static parse(t,e){if(t.length<=2||t.length>=5)return e.error(`Expected 3 or 4 arguments, but found ${t.length-1} instead.`);const r=e.parse(t[1],1,Ee),n=e.parse(t[2],2,Ee);if(!r||!n)return null;if(!Oe(r.type,[Be,Te,Me,ze,Ee]))return e.error(`Expected first argument to be of type boolean, string, number or null, but found ${Re(r.type)} instead`);if(4===t.length){const i=e.parse(t[3],3,Me);return i?new un(r,n,i):null}return new un(r,n)}evaluate(t){const e=this.needle.evaluate(t),r=this.haystack.evaluate(t);if(!je(e,["boolean","string","number","null"]))throw new er(`Expected first argument to be of type boolean, string, number or null, but found ${Re(We(e))} instead.`);if(!je(r,["string","array"]))throw new er(`Expected second argument to be of type array or string, but found ${Re(We(r))} instead.`);if(this.fromIndex){const n=this.fromIndex.evaluate(t);return r.indexOf(e,n)}return r.indexOf(e)}eachChild(t){t(this.needle),t(this.haystack),this.fromIndex&&t(this.fromIndex);}outputDefined(){return !1}serialize(){if(null!=this.fromIndex&&void 0!==this.fromIndex){const t=this.fromIndex.serialize();return ["index-of",this.needle.serialize(),this.haystack.serialize(),t]}return ["index-of",this.needle.serialize(),this.haystack.serialize()]}}class cn{constructor(t,e,r,n,i,s){this.inputType=t,this.type=e,this.input=r,this.cases=n,this.outputs=i,this.otherwise=s;}static parse(t,e){if(t.length<5)return e.error(`Expected at least 4 arguments, but found only ${t.length-1}.`);if(t.length%2!=1)return e.error("Expected an even number of arguments.");let r,n;e.expectedType&&"value"!==e.expectedType.kind&&(n=e.expectedType);const i={},s=[];for(let a=2;a<t.length-1;a+=2){let o=t[a];const l=t[a+1];Array.isArray(o)||(o=[o]);const u=e.concat(a);if(0===o.length)return u.error("Expected at least one branch label.");for(const t of o){if("number"!=typeof t&&"string"!=typeof t)return u.error("Branch labels must be numbers or strings.");if("number"==typeof t&&Math.abs(t)>Number.MAX_SAFE_INTEGER)return u.error(`Branch labels must be integers no larger than ${Number.MAX_SAFE_INTEGER}.`);if("number"==typeof t&&Math.floor(t)!==t)return u.error("Numeric branch labels must be integer values.");if(r){if(u.checkSubtype(r,We(t)))return null}else r=We(t);if(void 0!==i[String(t)])return u.error("Branch labels must be unique.");i[String(t)]=s.length;}const c=e.parse(l,a,n);if(!c)return null;n=n||c.type,s.push(c);}const a=e.parse(t[1],1,Ee);if(!a)return null;const o=e.parse(t[t.length-1],t.length-1,n);return o?"value"!==a.type.kind&&e.concat(1).checkSubtype(r,a.type)?null:new cn(r,n,a,i,s,o):null}evaluate(t){const e=this.input.evaluate(t);return (We(e)===this.inputType&&this.outputs[this.cases[e]]||this.otherwise).evaluate(t)}eachChild(t){t(this.input),this.outputs.forEach(t),t(this.otherwise);}outputDefined(){return this.outputs.every((t=>t.outputDefined()))&&this.otherwise.outputDefined()}serialize(){const t=["match",this.input.serialize()],e=Object.keys(this.cases).sort(),r=[],n={};for(const t of e){const e=n[this.cases[t]];void 0===e?(n[this.cases[t]]=r.length,r.push([this.cases[t],[t]])):r[e][1].push(t);}const i=t=>"number"===this.inputType.kind?Number(t):t;for(const[e,n]of r)t.push(1===n.length?i(n[0]):n.map(i)),t.push(this.outputs[e].serialize());return t.push(this.otherwise.serialize()),t}}class hn{constructor(t,e,r){this.type=t,this.branches=e,this.otherwise=r;}static parse(t,e){if(t.length<4)return e.error(`Expected at least 3 arguments, but found only ${t.length-1}.`);if(t.length%2!=0)return e.error("Expected an odd number of arguments.");let r;e.expectedType&&"value"!==e.expectedType.kind&&(r=e.expectedType);const n=[];for(let i=1;i<t.length-1;i+=2){const s=e.parse(t[i],i,Be);if(!s)return null;const a=e.parse(t[i+1],i+1,r);if(!a)return null;n.push([s,a]),r=r||a.type;}const i=e.parse(t[t.length-1],t.length-1,r);return i?new hn(r,n,i):null}evaluate(t){for(const[e,r]of this.branches)if(e.evaluate(t))return r.evaluate(t);return this.otherwise.evaluate(t)}eachChild(t){for(const[e,r]of this.branches)t(e),t(r);t(this.otherwise);}outputDefined(){return this.branches.every((([t,e])=>e.outputDefined()))&&this.otherwise.outputDefined()}serialize(){const t=["case"];return this.eachChild((e=>{t.push(e.serialize());})),t}}class pn{constructor(t,e,r,n){this.type=t,this.input=e,this.beginIndex=r,this.endIndex=n;}static parse(t,e){if(t.length<=2||t.length>=5)return e.error(`Expected 3 or 4 arguments, but found ${t.length-1} instead.`);const r=e.parse(t[1],1,Ee),n=e.parse(t[2],2,Me);if(!r||!n)return null;if(!Oe(r.type,[Le(Ee),Te,Ee]))return e.error(`Expected first argument to be of type array or string, but found ${Re(r.type)} instead`);if(4===t.length){const i=e.parse(t[3],3,Me);return i?new pn(r.type,r,n,i):null}return new pn(r.type,r,n)}evaluate(t){const e=this.input.evaluate(t),r=this.beginIndex.evaluate(t);if(!je(e,["string","array"]))throw new er(`Expected first argument to be of type array or string, but found ${Re(We(e))} instead.`);if(this.endIndex){const n=this.endIndex.evaluate(t);return e.slice(r,n)}return e.slice(r)}eachChild(t){t(this.input),t(this.beginIndex),this.endIndex&&t(this.endIndex);}outputDefined(){return !1}serialize(){if(null!=this.endIndex&&void 0!==this.endIndex){const t=this.endIndex.serialize();return ["slice",this.input.serialize(),this.beginIndex.serialize(),t]}return ["slice",this.input.serialize(),this.beginIndex.serialize()]}}function dn(t,e){return "=="===t||"!="===t?"boolean"===e.kind||"string"===e.kind||"number"===e.kind||"null"===e.kind||"value"===e.kind:"string"===e.kind||"number"===e.kind||"value"===e.kind}function fn(t,e,r,n){return 0===n.compare(e,r)}function yn(t,e,r){const n="=="!==t&&"!="!==t;return class i{constructor(t,e,r){this.type=Be,this.lhs=t,this.rhs=e,this.collator=r,this.hasUntypedArgument="value"===t.type.kind||"value"===e.type.kind;}static parse(t,e){if(3!==t.length&&4!==t.length)return e.error("Expected two or three arguments.");const r=t[0];let s=e.parse(t[1],1,Ee);if(!s)return null;if(!dn(r,s.type))return e.concat(1).error(`"${r}" comparisons are not supported for type '${Re(s.type)}'.`);let a=e.parse(t[2],2,Ee);if(!a)return null;if(!dn(r,a.type))return e.concat(2).error(`"${r}" comparisons are not supported for type '${Re(a.type)}'.`);if(s.type.kind!==a.type.kind&&"value"!==s.type.kind&&"value"!==a.type.kind)return e.error(`Cannot compare types '${Re(s.type)}' and '${Re(a.type)}'.`);n&&("value"===s.type.kind&&"value"!==a.type.kind?s=new nr(a.type,[s]):"value"!==s.type.kind&&"value"===a.type.kind&&(a=new nr(s.type,[a])));let o=null;if(4===t.length){if("string"!==s.type.kind&&"string"!==a.type.kind&&"value"!==s.type.kind&&"value"!==a.type.kind)return e.error("Cannot use collator to compare non-string types.");if(o=e.parse(t[3],3,De),!o)return null}return new i(s,a,o)}evaluate(i){const s=this.lhs.evaluate(i),a=this.rhs.evaluate(i);if(n&&this.hasUntypedArgument){const e=We(s),r=We(a);if(e.kind!==r.kind||"string"!==e.kind&&"number"!==e.kind)throw new er(`Expected arguments for "${t}" to be (string, string) or (number, number), but found (${e.kind}, ${r.kind}) instead.`)}if(this.collator&&!n&&this.hasUntypedArgument){const t=We(s),r=We(a);if("string"!==t.kind||"string"!==r.kind)return e(i,s,a)}return this.collator?r(i,s,a,this.collator.evaluate(i)):e(i,s,a)}eachChild(t){t(this.lhs),t(this.rhs),this.collator&&t(this.collator);}outputDefined(){return !0}serialize(){const e=[t];return this.eachChild((t=>{e.push(t.serialize());})),e}}}const mn=yn("==",(function(t,e,r){return e===r}),fn),gn=yn("!=",(function(t,e,r){return e!==r}),(function(t,e,r,n){return !fn(0,e,r,n)})),xn=yn("<",(function(t,e,r){return e<r}),(function(t,e,r,n){return n.compare(e,r)<0})),vn=yn(">",(function(t,e,r){return e>r}),(function(t,e,r,n){return n.compare(e,r)>0})),bn=yn("<=",(function(t,e,r){return e<=r}),(function(t,e,r,n){return n.compare(e,r)<=0})),wn=yn(">=",(function(t,e,r){return e>=r}),(function(t,e,r,n){return n.compare(e,r)>=0}));class _n{constructor(t,e,r,n,i){this.type=Te,this.number=t,this.locale=e,this.currency=r,this.minFractionDigits=n,this.maxFractionDigits=i;}static parse(t,e){if(3!==t.length)return e.error("Expected two arguments.");const r=e.parse(t[1],1,Me);if(!r)return null;const n=t[2];if("object"!=typeof n||Array.isArray(n))return e.error("NumberFormat options argument must be an object.");let i=null;if(n.locale&&(i=e.parse(n.locale,1,Te),!i))return null;let s=null;if(n.currency&&(s=e.parse(n.currency,1,Te),!s))return null;let a=null;if(n["min-fraction-digits"]&&(a=e.parse(n["min-fraction-digits"],1,Me),!a))return null;let o=null;return n["max-fraction-digits"]&&(o=e.parse(n["max-fraction-digits"],1,Me),!o)?null:new _n(r,i,s,a,o)}evaluate(t){return new Intl.NumberFormat(this.locale?this.locale.evaluate(t):[],{style:this.currency?"currency":"decimal",currency:this.currency?this.currency.evaluate(t):void 0,minimumFractionDigits:this.minFractionDigits?this.minFractionDigits.evaluate(t):void 0,maximumFractionDigits:this.maxFractionDigits?this.maxFractionDigits.evaluate(t):void 0}).format(this.number.evaluate(t))}eachChild(t){t(this.number),this.locale&&t(this.locale),this.currency&&t(this.currency),this.minFractionDigits&&t(this.minFractionDigits),this.maxFractionDigits&&t(this.maxFractionDigits);}outputDefined(){return !1}serialize(){const t={};return this.locale&&(t.locale=this.locale.serialize()),this.currency&&(t.currency=this.currency.serialize()),this.minFractionDigits&&(t["min-fraction-digits"]=this.minFractionDigits.serialize()),this.maxFractionDigits&&(t["max-fraction-digits"]=this.maxFractionDigits.serialize()),["number-format",this.number.serialize(),t]}}class An{constructor(t){this.type=Me,this.input=t;}static parse(t,e){if(2!==t.length)return e.error(`Expected 1 argument, but found ${t.length-1} instead.`);const r=e.parse(t[1],1);return r?"array"!==r.type.kind&&"string"!==r.type.kind&&"value"!==r.type.kind?e.error(`Expected argument of type string or array, but found ${Re(r.type)} instead.`):new An(r):null}evaluate(t){const e=this.input.evaluate(t);if("string"==typeof e)return e.length;if(Array.isArray(e))return e.length;throw new er(`Expected value to be of type string or array, but found ${Re(We(e))} instead.`)}eachChild(t){t(this.input);}outputDefined(){return !1}serialize(){const t=["length"];return this.eachChild((e=>{t.push(e.serialize());})),t}}const kn={"==":mn,"!=":gn,">":vn,"<":xn,">=":wn,"<=":bn,array:nr,at:on,boolean:nr,case:hn,coalesce:sn,collator:hr,format:ir,image:sr,in:ln,"index-of":un,interpolate:rn,"interpolate-hcl":rn,"interpolate-lab":rn,length:An,let:an,literal:tr,match:cn,number:nr,"number-format":_n,object:nr,slice:pn,step:Fr,string:nr,"to-boolean":or,"to-color":or,"to-number":or,"to-string":or,var:Pr,within:Mr};function Sn(t,[e,r,n,i]){e=e.evaluate(t),r=r.evaluate(t),n=n.evaluate(t);const s=i?i.evaluate(t):1,a=He(e,r,n,s);if(a)throw new er(a);return new Ge(e/255*s,r/255*s,n/255*s,s)}function In(t,e){return t in e}function zn(t,e){const r=e[t];return void 0===r?null:r}function Mn(t){return {type:t}}function Tn(t){return {result:"success",value:t}}function Bn(t){return {result:"error",value:t}}function Cn(t){return "data-driven"===t["property-type"]||"cross-faded-data-driven"===t["property-type"]}function Pn(t){return !!t.expression&&t.expression.parameters.indexOf("zoom")>-1}function En(t){return !!t.expression&&t.expression.interpolated}function Dn(t){return t instanceof Number?"number":t instanceof String?"string":t instanceof Boolean?"boolean":Array.isArray(t)?"array":null===t?"null":typeof t}function Vn(t){return "object"==typeof t&&null!==t&&!Array.isArray(t)}function Fn(t){return t}function Ln(t,e){const r="color"===e.type,n=t.stops&&"object"==typeof t.stops[0][0],i=n||!(n||void 0!==t.property),s=t.type||(En(e)?"exponential":"interval");if(r&&((t=_e({},t)).stops&&(t.stops=t.stops.map((t=>[t[0],Ge.parse(t[1])]))),t.default=Ge.parse(t.default?t.default:e.default)),t.colorSpace&&"rgb"!==t.colorSpace&&!en[t.colorSpace])throw new Error(`Unknown color space: ${t.colorSpace}`);let a,o,l;if("exponential"===s)a=On;else if("interval"===s)a=$n;else if("categorical"===s){a=Un,o=Object.create(null);for(const e of t.stops)o[e[0]]=e[1];l=typeof t.stops[0][0];}else {if("identity"!==s)throw new Error(`Unknown function type "${s}"`);a=jn;}if(n){const r={},n=[];for(let e=0;e<t.stops.length;e++){const i=t.stops[e],s=i[0].zoom;void 0===r[s]&&(r[s]={zoom:s,type:t.type,property:t.property,default:t.default,stops:[]},n.push(s)),r[s].stops.push([i[0].value,i[1]]);}const i=[];for(const t of n)i.push([r[t].zoom,Ln(r[t],e)]);const s={name:"linear"};return {kind:"composite",interpolationType:s,interpolationFactor:rn.interpolationFactor.bind(void 0,s),zoomStops:i.map((t=>t[0])),evaluate:({zoom:r},n)=>On({stops:i,base:t.base},e,r).evaluate(r,n)}}if(i){const r="exponential"===s?{name:"exponential",base:void 0!==t.base?t.base:1}:null;return {kind:"camera",interpolationType:r,interpolationFactor:rn.interpolationFactor.bind(void 0,r),zoomStops:t.stops.map((t=>t[0])),evaluate:({zoom:r})=>a(t,e,r,o,l)}}return {kind:"source",evaluate(r,n){const i=n&&n.properties?n.properties[t.property]:void 0;return void 0===i?Rn(t.default,e.default):a(t,e,i,o,l)}}}function Rn(t,e,r){return void 0!==t?t:void 0!==e?e:void 0!==r?r:void 0}function Un(t,e,r,n,i){return Rn(typeof r===i?n[r]:void 0,t.default,e.default)}function $n(t,e,r){if("number"!==Dn(r))return Rn(t.default,e.default);const n=t.stops.length;if(1===n)return t.stops[0][1];if(r<=t.stops[0][0])return t.stops[0][1];if(r>=t.stops[n-1][0])return t.stops[n-1][1];const i=Vr(t.stops.map((t=>t[0])),r);return t.stops[i][1]}function On(t,e,r){const n=void 0!==t.base?t.base:1;if("number"!==Dn(r))return Rn(t.default,e.default);const i=t.stops.length;if(1===i)return t.stops[0][1];if(r<=t.stops[0][0])return t.stops[0][1];if(r>=t.stops[i-1][0])return t.stops[i-1][1];const s=Vr(t.stops.map((t=>t[0])),r),a=function(t,e,r,n){const i=n-r,s=t-r;return 0===i?0:1===e?s/i:(Math.pow(e,s)-1)/(Math.pow(e,i)-1)}(r,n,t.stops[s][0],t.stops[s+1][0]),o=t.stops[s][1],l=t.stops[s+1][1];let u=Rr[e.type]||Fn;if(t.colorSpace&&"rgb"!==t.colorSpace){const e=en[t.colorSpace];u=(t,r)=>e.reverse(e.interpolate(e.forward(t),e.forward(r),a));}return "function"==typeof o.evaluate?{evaluate(...t){const e=o.evaluate.apply(void 0,t),r=l.evaluate.apply(void 0,t);if(void 0!==e&&void 0!==r)return u(e,r,a)}}:u(o,l,a)}function jn(t,e,r){return "color"===e.type?r=Ge.parse(r):"formatted"===e.type?r=Ke.fromString(r.toString()):"resolvedImage"===e.type?r=Ye.fromString(r.toString()):Dn(r)===e.type||"enum"===e.type&&e.values[r]||(r=void 0),Rn(r,t.default,e.default)}cr.register(kn,{error:[{kind:"error"},[Te],(t,[e])=>{throw new er(e.evaluate(t))}],typeof:[Te,[Ee],(t,[e])=>Re(We(e.evaluate(t)))],"to-rgba":[Le(Me,4),[Ce],(t,[e])=>e.evaluate(t).toArray()],rgb:[Ce,[Me,Me,Me],Sn],rgba:[Ce,[Me,Me,Me,Me],Sn],has:{type:Be,overloads:[[[Te],(t,[e])=>In(e.evaluate(t),t.properties())],[[Te,Pe],(t,[e,r])=>In(e.evaluate(t),r.evaluate(t))]]},get:{type:Ee,overloads:[[[Te],(t,[e])=>zn(e.evaluate(t),t.properties())],[[Te,Pe],(t,[e,r])=>zn(e.evaluate(t),r.evaluate(t))]]},"feature-state":[Ee,[Te],(t,[e])=>zn(e.evaluate(t),t.featureState||{})],properties:[Pe,[],t=>t.properties()],"geometry-type":[Te,[],t=>t.geometryType()],id:[Ee,[],t=>t.id()],zoom:[Me,[],t=>t.globals.zoom],pitch:[Me,[],t=>t.globals.pitch||0],"distance-from-center":[Me,[],t=>t.distanceFromCenter()],"heatmap-density":[Me,[],t=>t.globals.heatmapDensity||0],"line-progress":[Me,[],t=>t.globals.lineProgress||0],"sky-radial-progress":[Me,[],t=>t.globals.skyRadialProgress||0],accumulated:[Ee,[],t=>void 0===t.globals.accumulated?null:t.globals.accumulated],"+":[Me,Mn(Me),(t,e)=>{let r=0;for(const n of e)r+=n.evaluate(t);return r}],"*":[Me,Mn(Me),(t,e)=>{let r=1;for(const n of e)r*=n.evaluate(t);return r}],"-":{type:Me,overloads:[[[Me,Me],(t,[e,r])=>e.evaluate(t)-r.evaluate(t)],[[Me],(t,[e])=>-e.evaluate(t)]]},"/":[Me,[Me,Me],(t,[e,r])=>e.evaluate(t)/r.evaluate(t)],"%":[Me,[Me,Me],(t,[e,r])=>e.evaluate(t)%r.evaluate(t)],ln2:[Me,[],()=>Math.LN2],pi:[Me,[],()=>Math.PI],e:[Me,[],()=>Math.E],"^":[Me,[Me,Me],(t,[e,r])=>Math.pow(e.evaluate(t),r.evaluate(t))],sqrt:[Me,[Me],(t,[e])=>Math.sqrt(e.evaluate(t))],log10:[Me,[Me],(t,[e])=>Math.log(e.evaluate(t))/Math.LN10],ln:[Me,[Me],(t,[e])=>Math.log(e.evaluate(t))],log2:[Me,[Me],(t,[e])=>Math.log(e.evaluate(t))/Math.LN2],sin:[Me,[Me],(t,[e])=>Math.sin(e.evaluate(t))],cos:[Me,[Me],(t,[e])=>Math.cos(e.evaluate(t))],tan:[Me,[Me],(t,[e])=>Math.tan(e.evaluate(t))],asin:[Me,[Me],(t,[e])=>Math.asin(e.evaluate(t))],acos:[Me,[Me],(t,[e])=>Math.acos(e.evaluate(t))],atan:[Me,[Me],(t,[e])=>Math.atan(e.evaluate(t))],min:[Me,Mn(Me),(t,e)=>Math.min(...e.map((e=>e.evaluate(t))))],max:[Me,Mn(Me),(t,e)=>Math.max(...e.map((e=>e.evaluate(t))))],abs:[Me,[Me],(t,[e])=>Math.abs(e.evaluate(t))],round:[Me,[Me],(t,[e])=>{const r=e.evaluate(t);return r<0?-Math.round(-r):Math.round(r)}],floor:[Me,[Me],(t,[e])=>Math.floor(e.evaluate(t))],ceil:[Me,[Me],(t,[e])=>Math.ceil(e.evaluate(t))],"filter-==":[Be,[Te,Ee],(t,[e,r])=>t.properties()[e.value]===r.value],"filter-id-==":[Be,[Ee],(t,[e])=>t.id()===e.value],"filter-type-==":[Be,[Te],(t,[e])=>t.geometryType()===e.value],"filter-<":[Be,[Te,Ee],(t,[e,r])=>{const n=t.properties()[e.value],i=r.value;return typeof n==typeof i&&n<i}],"filter-id-<":[Be,[Ee],(t,[e])=>{const r=t.id(),n=e.value;return typeof r==typeof n&&r<n}],"filter->":[Be,[Te,Ee],(t,[e,r])=>{const n=t.properties()[e.value],i=r.value;return typeof n==typeof i&&n>i}],"filter-id->":[Be,[Ee],(t,[e])=>{const r=t.id(),n=e.value;return typeof r==typeof n&&r>n}],"filter-<=":[Be,[Te,Ee],(t,[e,r])=>{const n=t.properties()[e.value],i=r.value;return typeof n==typeof i&&n<=i}],"filter-id-<=":[Be,[Ee],(t,[e])=>{const r=t.id(),n=e.value;return typeof r==typeof n&&r<=n}],"filter->=":[Be,[Te,Ee],(t,[e,r])=>{const n=t.properties()[e.value],i=r.value;return typeof n==typeof i&&n>=i}],"filter-id->=":[Be,[Ee],(t,[e])=>{const r=t.id(),n=e.value;return typeof r==typeof n&&r>=n}],"filter-has":[Be,[Ee],(t,[e])=>e.value in t.properties()],"filter-has-id":[Be,[],t=>null!==t.id()&&void 0!==t.id()],"filter-type-in":[Be,[Le(Te)],(t,[e])=>e.value.indexOf(t.geometryType())>=0],"filter-id-in":[Be,[Le(Ee)],(t,[e])=>e.value.indexOf(t.id())>=0],"filter-in-small":[Be,[Te,Le(Ee)],(t,[e,r])=>r.value.indexOf(t.properties()[e.value])>=0],"filter-in-large":[Be,[Te,Le(Ee)],(t,[e,r])=>function(t,e,r,n){for(;r<=n;){const i=r+n>>1;if(e[i]===t)return !0;e[i]>t?n=i-1:r=i+1;}return !1}(t.properties()[e.value],r.value,0,r.value.length-1)],all:{type:Be,overloads:[[[Be,Be],(t,[e,r])=>e.evaluate(t)&&r.evaluate(t)],[Mn(Be),(t,e)=>{for(const r of e)if(!r.evaluate(t))return !1;return !0}]]},any:{type:Be,overloads:[[[Be,Be],(t,[e,r])=>e.evaluate(t)||r.evaluate(t)],[Mn(Be),(t,e)=>{for(const r of e)if(r.evaluate(t))return !0;return !1}]]},"!":[Be,[Be],(t,[e])=>!e.evaluate(t)],"is-supported-script":[Be,[Te],(t,[e])=>{const r=t.globals&&t.globals.isSupportedScript;return !r||r(e.evaluate(t))}],upcase:[Te,[Te],(t,[e])=>e.evaluate(t).toUpperCase()],downcase:[Te,[Te],(t,[e])=>e.evaluate(t).toLowerCase()],concat:[Te,Mn(Ee),(t,e)=>e.map((e=>Qe(e.evaluate(t)))).join("")],"resolved-locale":[Te,[De],(t,[e])=>e.evaluate(t).resolvedLocale()]});class qn{constructor(t,e){this.expression=t,this._warningHistory={},this._evaluator=new ur,this._defaultValue=e?function(t){return "color"===t.type&&Vn(t.default)?new Ge(0,0,0,0):"color"===t.type?Ge.parse(t.default)||null:void 0===t.default?null:t.default}(e):null,this._enumValues=e&&"enum"===e.type?e.values:null;}evaluateWithoutErrorHandling(t,e,r,n,i,s,a,o){return this._evaluator.globals=t,this._evaluator.feature=e,this._evaluator.featureState=r,this._evaluator.canonical=n,this._evaluator.availableImages=i||null,this._evaluator.formattedSection=s,this._evaluator.featureTileCoord=a||null,this._evaluator.featureDistanceData=o||null,this.expression.evaluate(this._evaluator)}evaluate(t,e,r,n,i,s,a,o){this._evaluator.globals=t,this._evaluator.feature=e||null,this._evaluator.featureState=r||null,this._evaluator.canonical=n,this._evaluator.availableImages=i||null,this._evaluator.formattedSection=s||null,this._evaluator.featureTileCoord=a||null,this._evaluator.featureDistanceData=o||null;try{const t=this.expression.evaluate(this._evaluator);if(null==t||"number"==typeof t&&t!=t)return this._defaultValue;if(this._enumValues&&!(t in this._enumValues))throw new er(`Expected value to be one of ${Object.keys(this._enumValues).map((t=>JSON.stringify(t))).join(", ")}, but found ${JSON.stringify(t)} instead.`);return t}catch(t){return this._warningHistory[t.message]||(this._warningHistory[t.message]=!0,"undefined"!=typeof console&&console.warn(t.message)),this._defaultValue}}}function Nn(t){return Array.isArray(t)&&t.length>0&&"string"==typeof t[0]&&t[0]in kn}function Gn(t,e){const r=new Er(kn,[],e?function(t){const e={color:Ce,string:Te,number:Me,enum:Te,boolean:Be,formatted:Ve,resolvedImage:Fe};return "array"===t.type?Le(e[t.value]||Ee,t.length):e[t.type]}(e):void 0),n=r.parse(t,void 0,void 0,void 0,e&&"string"===e.type?{typeAnnotation:"coerce"}:void 0);return n?Tn(new qn(n,e)):Bn(r.errors)}class Zn{constructor(t,e){this.kind=t,this._styleExpression=e,this.isStateDependent="constant"!==t&&!Br(e.expression);}evaluateWithoutErrorHandling(t,e,r,n,i,s){return this._styleExpression.evaluateWithoutErrorHandling(t,e,r,n,i,s)}evaluate(t,e,r,n,i,s){return this._styleExpression.evaluate(t,e,r,n,i,s)}}class Xn{constructor(t,e,r,n){this.kind=t,this.zoomStops=r,this._styleExpression=e,this.isStateDependent="camera"!==t&&!Br(e.expression),this.interpolationType=n;}evaluateWithoutErrorHandling(t,e,r,n,i,s){return this._styleExpression.evaluateWithoutErrorHandling(t,e,r,n,i,s)}evaluate(t,e,r,n,i,s){return this._styleExpression.evaluate(t,e,r,n,i,s)}interpolationFactor(t,e,r){return this.interpolationType?rn.interpolationFactor(this.interpolationType,t,e,r):0}}function Kn(t,e){if("error"===(t=Gn(t,e)).result)return t;const r=t.value.expression,n=Tr(r);if(!n&&!Cn(e))return Bn([new Se("","data expressions not supported")]);const i=Cr(r,["zoom","pitch","distance-from-center"]);if(!i&&!Pn(e))return Bn([new Se("","zoom expressions not supported")]);const s=Hn(r);return s||i?s instanceof Se?Bn([s]):s instanceof rn&&!En(e)?Bn([new Se("",'"interpolate" expressions cannot be used with this property')]):Tn(s?new Xn(n?"camera":"composite",t.value,s.labels,s instanceof rn?s.interpolation:void 0):new Zn(n?"constant":"source",t.value)):Bn([new Se("",'"zoom" expression may only be used as input to a top-level "step" or "interpolate" expression.')])}class Yn{constructor(t,e){this._parameters=t,this._specification=e,_e(this,Ln(this._parameters,this._specification));}static deserialize(t){return new Yn(t._parameters,t._specification)}static serialize(t){return {_parameters:t._parameters,_specification:t._specification}}}function Hn(t){let e=null;if(t instanceof an)e=Hn(t.result);else if(t instanceof sn){for(const r of t.args)if(e=Hn(r),e)break}else (t instanceof Fr||t instanceof rn)&&t.input instanceof cr&&"zoom"===t.input.name&&(e=t);return e instanceof Se||t.eachChild((t=>{const r=Hn(t);r instanceof Se?e=r:!e&&r?e=new Se("",'"zoom" expression may only be used as input to a top-level "step" or "interpolate" expression.'):e&&r&&e!==r&&(e=new Se("",'Only one zoom-based "step" or "interpolate" subexpression may be used in an expression.'));})),e}function Jn(t){const e=t.key,r=t.value,n=t.valueSpec||{},i=t.objectElementValidators||{},s=t.style,a=t.styleSpec;let o=[];const l=Dn(r);if("object"!==l)return [new be(e,r,`object expected, ${l} found`)];for(const t in r){const l=t.split(".")[0],u=n[l]||n["*"];let c;if(i[l])c=i[l];else if(n[l])c=Bi;else if(i["*"])c=i["*"];else {if(!n["*"]){o.push(new be(e,r[t],`unknown property "${t}"`));continue}c=Bi;}o=o.concat(c({key:(e?`${e}.`:e)+t,value:r[t],valueSpec:u,style:s,styleSpec:a,object:r,objectKey:t},r));}for(const t in n)i[t]||n[t].required&&void 0===n[t].default&&void 0===r[t]&&o.push(new be(e,r,`missing required property "${t}"`));return o}function Wn(t){const e=t.value,r=t.valueSpec,n=t.style,i=t.styleSpec,s=t.key,a=t.arrayElementValidator||Bi;if("array"!==Dn(e))return [new be(s,e,`array expected, ${Dn(e)} found`)];if(r.length&&e.length!==r.length)return [new be(s,e,`array length ${r.length} expected, length ${e.length} found`)];if(r["min-length"]&&e.length<r["min-length"])return [new be(s,e,`array length at least ${r["min-length"]} expected, length ${e.length} found`)];let o={type:r.value,values:r.values,minimum:r.minimum,maximum:r.maximum};i.$version<7&&(o.function=r.function),"object"===Dn(r.value)&&(o=r.value);let l=[];for(let t=0;t<e.length;t++)l=l.concat(a({array:e,arrayIndex:t,value:e[t],valueSpec:o,style:n,styleSpec:i,key:`${s}[${t}]`}));return l}function Qn(t){const e=t.key,r=t.value,n=t.valueSpec;let i=Dn(r);if("number"===i&&r!=r&&(i="NaN"),"number"!==i)return [new be(e,r,`number expected, ${i} found`)];if("minimum"in n){let i=n.minimum;if("array"===Dn(n.minimum)&&(i=n.minimum[t.arrayIndex]),r<i)return [new be(e,r,`${r} is less than the minimum value ${i}`)]}if("maximum"in n){let i=n.maximum;if("array"===Dn(n.maximum)&&(i=n.maximum[t.arrayIndex]),r>i)return [new be(e,r,`${r} is greater than the maximum value ${i}`)]}return []}function ti(t){const e=t.valueSpec,r=Ae(t.value.type);let n,i,s,a={};const o="categorical"!==r&&void 0===t.value.property,l=!o,u="array"===Dn(t.value.stops)&&"array"===Dn(t.value.stops[0])&&"object"===Dn(t.value.stops[0][0]),c=Jn({key:t.key,value:t.value,valueSpec:t.styleSpec.function,style:t.style,styleSpec:t.styleSpec,objectElementValidators:{stops:function(t){if("identity"===r)return [new be(t.key,t.value,'identity function may not have a "stops" property')];let e=[];const n=t.value;return e=e.concat(Wn({key:t.key,value:n,valueSpec:t.valueSpec,style:t.style,styleSpec:t.styleSpec,arrayElementValidator:h})),"array"===Dn(n)&&0===n.length&&e.push(new be(t.key,n,"array must have at least one stop")),e},default:function(t){return Bi({key:t.key,value:t.value,valueSpec:e,style:t.style,styleSpec:t.styleSpec})}}});return "identity"===r&&o&&c.push(new be(t.key,t.value,'missing required property "property"')),"identity"===r||t.value.stops||c.push(new be(t.key,t.value,'missing required property "stops"')),"exponential"===r&&t.valueSpec.expression&&!En(t.valueSpec)&&c.push(new be(t.key,t.value,"exponential functions not supported")),t.styleSpec.$version>=8&&(l&&!Cn(t.valueSpec)?c.push(new be(t.key,t.value,"property functions not supported")):o&&!Pn(t.valueSpec)&&c.push(new be(t.key,t.value,"zoom functions not supported"))),"categorical"!==r&&!u||void 0!==t.value.property||c.push(new be(t.key,t.value,'"property" property is required')),c;function h(t){let r=[];const n=t.value,o=t.key;if("array"!==Dn(n))return [new be(o,n,`array expected, ${Dn(n)} found`)];if(2!==n.length)return [new be(o,n,`array length 2 expected, length ${n.length} found`)];if(u){if("object"!==Dn(n[0]))return [new be(o,n,`object expected, ${Dn(n[0])} found`)];if(void 0===n[0].zoom)return [new be(o,n,"object stop key must have zoom")];if(void 0===n[0].value)return [new be(o,n,"object stop key must have value")];if(s&&s>Ae(n[0].zoom))return [new be(o,n[0].zoom,"stop zoom values must appear in ascending order")];Ae(n[0].zoom)!==s&&(s=Ae(n[0].zoom),i=void 0,a={}),r=r.concat(Jn({key:`${o}[0]`,value:n[0],valueSpec:{zoom:{}},style:t.style,styleSpec:t.styleSpec,objectElementValidators:{zoom:Qn,value:p}}));}else r=r.concat(p({key:`${o}[0]`,value:n[0],valueSpec:{},style:t.style,styleSpec:t.styleSpec},n));return Nn(ke(n[1]))?r.concat([new be(`${o}[1]`,n[1],"expressions are not allowed in function stops.")]):r.concat(Bi({key:`${o}[1]`,value:n[1],valueSpec:e,style:t.style,styleSpec:t.styleSpec}))}function p(t,s){const o=Dn(t.value),l=Ae(t.value),u=null!==t.value?t.value:s;if(n){if(o!==n)return [new be(t.key,u,`${o} stop domain type must match previous stop domain type ${n}`)]}else n=o;if("number"!==o&&"string"!==o&&"boolean"!==o)return [new be(t.key,u,"stop domain value must be a number, string, or boolean")];if("number"!==o&&"categorical"!==r){let n=`number expected, ${o} found`;return Cn(e)&&void 0===r&&(n+='\nIf you intended to use a categorical function, specify `"type": "categorical"`.'),[new be(t.key,u,n)]}return "categorical"!==r||"number"!==o||isFinite(l)&&Math.floor(l)===l?"categorical"!==r&&"number"===o&&void 0!==i&&l<i?[new be(t.key,u,"stop domain values must appear in ascending order")]:(i=l,"categorical"===r&&l in a?[new be(t.key,u,"stop domain values must be unique")]:(a[l]=!0,[])):[new be(t.key,u,`integer expected, found ${l}`)]}}function ei(t){const e=("property"===t.expressionContext?Kn:Gn)(ke(t.value),t.valueSpec);if("error"===e.result)return e.value.map((e=>new be(`${t.key}${e.key}`,t.value,e.message)));const r=e.value.expression||e.value._styleExpression.expression;if("property"===t.expressionContext&&"text-font"===t.propertyKey&&!r.outputDefined())return [new be(t.key,t.value,`Invalid data expression for "${t.propertyKey}". Output values must be contained as literals within the expression.`)];if("property"===t.expressionContext&&"layout"===t.propertyType&&!Br(r))return [new be(t.key,t.value,'"feature-state" data expressions are not supported with layout properties.')];if("filter"===t.expressionContext)return ri(r,t);if(t.expressionContext&&0===t.expressionContext.indexOf("cluster")){if(!Cr(r,["zoom","feature-state"]))return [new be(t.key,t.value,'"zoom" and "feature-state" expressions are not supported with cluster properties.')];if("cluster-initial"===t.expressionContext&&!Tr(r))return [new be(t.key,t.value,"Feature data expressions are not supported with initial expression part of cluster properties.")]}return []}function ri(t,e){const r=new Set(["zoom","feature-state","pitch","distance-from-center"]);for(const t of e.valueSpec.expression.parameters)r.delete(t);if(0===r.size)return [];const n=[];return t instanceof cr&&r.has(t.name)?[new be(e.key,e.value,`["${t.name}"] expression is not supported in a filter for a ${e.object.type} layer with id: ${e.object.id}`)]:(t.eachChild((t=>{n.push(...ri(t,e));})),n)}function ni(t){const e=t.key,r=t.value,n=t.valueSpec,i=[];return Array.isArray(n.values)?-1===n.values.indexOf(Ae(r))&&i.push(new be(e,r,`expected one of [${n.values.join(", ")}], ${JSON.stringify(r)} found`)):-1===Object.keys(n.values).indexOf(Ae(r))&&i.push(new be(e,r,`expected one of [${Object.keys(n.values).join(", ")}], ${JSON.stringify(r)} found`)),i}function ii(t){if(!0===t||!1===t)return !0;if(!Array.isArray(t)||0===t.length)return !1;switch(t[0]){case"has":return t.length>=2&&"$id"!==t[1]&&"$type"!==t[1];case"in":return t.length>=3&&("string"!=typeof t[1]||Array.isArray(t[2]));case"!in":case"!has":case"none":return !1;case"==":case"!=":case">":case">=":case"<":case"<=":return 3!==t.length||Array.isArray(t[1])||Array.isArray(t[2]);case"any":case"all":for(const e of t.slice(1))if(!ii(e)&&"boolean"!=typeof e)return !1;return !0;default:return !0}}function si(t,e="fill"){if(null==t)return {filter:()=>!0,needGeometry:!1,needFeature:!1};ii(t)||(t=pi(t));const r=t;let n=!0;try{n=function(t){if(!li(t))return t;let e=ke(t);return oi(e),e=ai(e),e}(r);}catch(t){console.warn(`Failed to extract static filter. Filter will continue working, but at higher memory usage and slower framerate.\nThis is most likely a bug, please report this via https://github.com/mapbox/mapbox-gl-js/issues/new?assignees=&labels=&template=Bug_report.md\nand paste the contents of this message in the report.\nThank you!\nFilter Expression:\n${JSON.stringify(r,null,2)}\n        `);}const i=ve[`filter_${e}`],s=Gn(n,i);let a=null;if("error"===s.result)throw new Error(s.value.map((t=>`${t.key}: ${t.message}`)).join(", "));a=(t,e,r)=>s.value.evaluate(t,e,{},r);let o=null,l=null;if(n!==r){const t=Gn(r,i);if("error"===t.result)throw new Error(t.value.map((t=>`${t.key}: ${t.message}`)).join(", "));o=(e,r,n,i,s)=>t.value.evaluate(e,r,{},n,void 0,void 0,i,s),l=!Tr(t.value.expression);}return a=a,{filter:a,dynamicFilter:o||void 0,needGeometry:hi(n),needFeature:!!l}}function ai(t){if(!Array.isArray(t))return t;const e=function(t){if(ui.has(t[0]))for(let e=1;e<t.length;e++)if(li(t[e]))return !0;return t}(t);return !0===e?e:e.map((t=>ai(t)))}function oi(t){let e=!1;const r=[];if("case"===t[0]){for(let n=1;n<t.length-1;n+=2)e=e||li(t[n]),r.push(t[n+1]);r.push(t[t.length-1]);}else if("match"===t[0]){e=e||li(t[1]);for(let e=2;e<t.length-1;e+=2)r.push(t[e+1]);r.push(t[t.length-1]);}else if("step"===t[0]){e=e||li(t[1]);for(let e=1;e<t.length-1;e+=2)r.push(t[e+1]);}e&&(t.length=0,t.push("any",...r));for(let e=1;e<t.length;e++)oi(t[e]);}function li(t){if(!Array.isArray(t))return !1;if("pitch"===(e=t[0])||"distance-from-center"===e)return !0;var e;for(let e=1;e<t.length;e++)if(li(t[e]))return !0;return !1}const ui=new Set(["in","==","!=",">",">=","<","<=","to-boolean"]);function ci(t,e){return t<e?-1:t>e?1:0}function hi(t){if(!Array.isArray(t))return !1;if("within"===t[0])return !0;for(let e=1;e<t.length;e++)if(hi(t[e]))return !0;return !1}function pi(t){if(!t)return !0;const e=t[0];return t.length<=1?"any"!==e:"=="===e?di(t[1],t[2],"=="):"!="===e?mi(di(t[1],t[2],"==")):"<"===e||">"===e||"<="===e||">="===e?di(t[1],t[2],e):"any"===e?(r=t.slice(1),["any"].concat(r.map(pi))):"all"===e?["all"].concat(t.slice(1).map(pi)):"none"===e?["all"].concat(t.slice(1).map(pi).map(mi)):"in"===e?fi(t[1],t.slice(2)):"!in"===e?mi(fi(t[1],t.slice(2))):"has"===e?yi(t[1]):"!has"===e?mi(yi(t[1])):"within"!==e||t;var r;}function di(t,e,r){switch(t){case"$type":return [`filter-type-${r}`,e];case"$id":return [`filter-id-${r}`,e];default:return [`filter-${r}`,t,e]}}function fi(t,e){if(0===e.length)return !1;switch(t){case"$type":return ["filter-type-in",["literal",e]];case"$id":return ["filter-id-in",["literal",e]];default:return e.length>200&&!e.some((t=>typeof t!=typeof e[0]))?["filter-in-large",t,["literal",e.sort(ci)]]:["filter-in-small",t,["literal",e]]}}function yi(t){switch(t){case"$type":return !0;case"$id":return ["filter-has-id"];default:return ["filter-has",t]}}function mi(t){return ["!",t]}function gi(t){if(ii(ke(t.value))){const e=ke(t.layerType);return ei(_e({},t,{expressionContext:"filter",valueSpec:t.styleSpec[`filter_${e||"fill"}`]}))}return xi(t)}function xi(t){const e=t.value,r=t.key;if("array"!==Dn(e))return [new be(r,e,`array expected, ${Dn(e)} found`)];const n=t.styleSpec;let i,s=[];if(e.length<1)return [new be(r,e,"filter array must have at least 1 element")];switch(s=s.concat(ni({key:`${r}[0]`,value:e[0],valueSpec:n.filter_operator,style:t.style,styleSpec:t.styleSpec})),Ae(e[0])){case"<":case"<=":case">":case">=":e.length>=2&&"$type"===Ae(e[1])&&s.push(new be(r,e,`"$type" cannot be use with operator "${e[0]}"`));case"==":case"!=":3!==e.length&&s.push(new be(r,e,`filter array for operator "${e[0]}" must have 3 elements`));case"in":case"!in":e.length>=2&&(i=Dn(e[1]),"string"!==i&&s.push(new be(`${r}[1]`,e[1],`string expected, ${i} found`)));for(let a=2;a<e.length;a++)i=Dn(e[a]),"$type"===Ae(e[1])?s=s.concat(ni({key:`${r}[${a}]`,value:e[a],valueSpec:n.geometry_type,style:t.style,styleSpec:t.styleSpec})):"string"!==i&&"number"!==i&&"boolean"!==i&&s.push(new be(`${r}[${a}]`,e[a],`string, number, or boolean expected, ${i} found`));break;case"any":case"all":case"none":for(let n=1;n<e.length;n++)s=s.concat(xi({key:`${r}[${n}]`,value:e[n],style:t.style,styleSpec:t.styleSpec}));break;case"has":case"!has":i=Dn(e[1]),2!==e.length?s.push(new be(r,e,`filter array for "${e[0]}" operator must have 2 elements`)):"string"!==i&&s.push(new be(`${r}[1]`,e[1],`string expected, ${i} found`));break;case"within":i=Dn(e[1]),2!==e.length?s.push(new be(r,e,`filter array for "${e[0]}" operator must have 2 elements`)):"object"!==i&&s.push(new be(`${r}[1]`,e[1],`object expected, ${i} found`));}return s}function vi(t,e){const r=t.key,n=t.style,i=t.styleSpec,s=t.value,a=t.objectKey,o=i[`${e}_${t.layerType}`];if(!o)return [];const l=a.match(/^(.*)-transition$/);if("paint"===e&&l&&o[l[1]]&&o[l[1]].transition)return Bi({key:r,value:s,valueSpec:i.transition,style:n,styleSpec:i});const u=t.valueSpec||o[a];if(!u)return [new be(r,s,`unknown property "${a}"`)];let c;if("string"===Dn(s)&&Cn(u)&&!u.tokens&&(c=/^{([^}]+)}$/.exec(s)))return [new be(r,s,`"${a}" does not support interpolation syntax\nUse an identity property function instead: \`{ "type": "identity", "property": ${JSON.stringify(c[1])} }\`.`)];const h=[];return "symbol"===t.layerType&&("text-field"===a&&n&&!n.glyphs&&h.push(new be(r,s,'use of "text-field" requires a style "glyphs" property')),"text-font"===a&&Vn(ke(s))&&"identity"===Ae(s.type)&&h.push(new be(r,s,'"text-font" does not support identity functions'))),h.concat(Bi({key:t.key,value:s,valueSpec:u,style:n,styleSpec:i,expressionContext:"property",propertyType:e,propertyKey:a}))}function bi(t){return vi(t,"paint")}function wi(t){return vi(t,"layout")}function _i(t){let e=[];const r=t.value,n=t.key,i=t.style,s=t.styleSpec;r.type||r.ref||e.push(new be(n,r,'either "type" or "ref" is required'));let a=Ae(r.type);const o=Ae(r.ref);if(r.id){const s=Ae(r.id);for(let a=0;a<t.arrayIndex;a++){const t=i.layers[a];Ae(t.id)===s&&e.push(new be(n,r.id,`duplicate layer id "${r.id}", previously used at line ${t.id.__line__}`));}}if("ref"in r){let t;["type","source","source-layer","filter","layout"].forEach((t=>{t in r&&e.push(new be(n,r[t],`"${t}" is prohibited for ref layers`));})),i.layers.forEach((e=>{Ae(e.id)===o&&(t=e);})),t?t.ref?e.push(new be(n,r.ref,"ref cannot reference another ref layer")):a=Ae(t.type):e.push(new be(n,r.ref,`ref layer "${o}" not found`));}else if("background"!==a&&"sky"!==a)if(r.source){const t=i.sources&&i.sources[r.source],s=t&&Ae(t.type);t?"vector"===s&&"raster"===a?e.push(new be(n,r.source,`layer "${r.id}" requires a raster source`)):"raster"===s&&"raster"!==a?e.push(new be(n,r.source,`layer "${r.id}" requires a vector source`)):"vector"!==s||r["source-layer"]?"raster-dem"===s&&"hillshade"!==a?e.push(new be(n,r.source,"raster-dem source can only be used with layer type 'hillshade'.")):"line"!==a||!r.paint||!r.paint["line-gradient"]||"geojson"===s&&t.lineMetrics||e.push(new be(n,r,`layer "${r.id}" specifies a line-gradient, which requires a GeoJSON source with \`lineMetrics\` enabled.`)):e.push(new be(n,r,`layer "${r.id}" must specify a "source-layer"`)):e.push(new be(n,r.source,`source "${r.source}" not found`));}else e.push(new be(n,r,'missing required property "source"'));return e=e.concat(Jn({key:n,value:r,valueSpec:s.layer,style:t.style,styleSpec:t.styleSpec,objectElementValidators:{"*":()=>[],type:()=>Bi({key:`${n}.type`,value:r.type,valueSpec:s.layer.type,style:t.style,styleSpec:t.styleSpec,object:r,objectKey:"type"}),filter:t=>gi(_e({layerType:a},t)),layout:t=>Jn({layer:r,key:t.key,value:t.value,style:t.style,styleSpec:t.styleSpec,objectElementValidators:{"*":t=>wi(_e({layerType:a},t))}}),paint:t=>Jn({layer:r,key:t.key,value:t.value,style:t.style,styleSpec:t.styleSpec,objectElementValidators:{"*":t=>bi(_e({layerType:a},t))}})}})),e}function Ai(t){const e=t.value,r=t.key,n=Dn(e);return "string"!==n?[new be(r,e,`string expected, ${n} found`)]:[]}const ki={promoteId:function({key:t,value:e}){if("string"===Dn(e))return Ai({key:t,value:e});{const r=[];for(const n in e)r.push(...Ai({key:`${t}.${n}`,value:e[n]}));return r}}};function Si(t){const e=t.value,r=t.key,n=t.styleSpec,i=t.style;if(!e.type)return [new be(r,e,'"type" is required')];const s=Ae(e.type);let a;switch(s){case"vector":case"raster":case"raster-dem":return a=Jn({key:r,value:e,valueSpec:n[`source_${s.replace("-","_")}`],style:t.style,styleSpec:n,objectElementValidators:ki}),a;case"geojson":if(a=Jn({key:r,value:e,valueSpec:n.source_geojson,style:i,styleSpec:n,objectElementValidators:ki}),e.cluster)for(const t in e.clusterProperties){const[n,i]=e.clusterProperties[t],s="string"==typeof n?[n,["accumulated"],["get",t]]:n;a.push(...ei({key:`${r}.${t}.map`,value:i,expressionContext:"cluster-map"})),a.push(...ei({key:`${r}.${t}.reduce`,value:s,expressionContext:"cluster-reduce"}));}return a;case"video":return Jn({key:r,value:e,valueSpec:n.source_video,style:i,styleSpec:n});case"image":return Jn({key:r,value:e,valueSpec:n.source_image,style:i,styleSpec:n});case"canvas":return [new be(r,null,"Please use runtime APIs to add canvas sources, rather than including them in stylesheets.","source.canvas")];default:return ni({key:`${r}.type`,value:e.type,valueSpec:{values:["vector","raster","raster-dem","geojson","video","image"]},style:i,styleSpec:n})}}function Ii(t){const e=t.value,r=t.styleSpec,n=r.light,i=t.style;let s=[];const a=Dn(e);if(void 0===e)return s;if("object"!==a)return s=s.concat([new be("light",e,`object expected, ${a} found`)]),s;for(const t in e){const a=t.match(/^(.*)-transition$/);s=s.concat(a&&n[a[1]]&&n[a[1]].transition?Bi({key:t,value:e[t],valueSpec:r.transition,style:i,styleSpec:r}):n[t]?Bi({key:t,value:e[t],valueSpec:n[t],style:i,styleSpec:r}):[new be(t,e[t],`unknown property "${t}"`)]);}return s}function zi(t){const e=t.value,r=t.key,n=t.style,i=t.styleSpec,s=i.terrain;let a=[];const o=Dn(e);if(void 0===e)return a;if("object"!==o)return a=a.concat([new be("terrain",e,`object expected, ${o} found`)]),a;for(const t in e){const r=t.match(/^(.*)-transition$/);a=a.concat(r&&s[r[1]]&&s[r[1]].transition?Bi({key:t,value:e[t],valueSpec:i.transition,style:n,styleSpec:i}):s[t]?Bi({key:t,value:e[t],valueSpec:s[t],style:n,styleSpec:i}):[new be(t,e[t],`unknown property "${t}"`)]);}if(e.source){const t=n.sources&&n.sources[e.source],i=t&&Ae(t.type);t?"raster-dem"!==i&&a.push(new be(r,e.source,`terrain cannot be used with a source of type ${i}, it only be used with a "raster-dem" source type`)):a.push(new be(r,e.source,`source "${e.source}" not found`));}else a.push(new be(r,e,'terrain is missing required property "source"'));return a}function Mi(t){const e=t.value,r=t.style,n=t.styleSpec,i=n.fog;let s=[];const a=Dn(e);if(void 0===e)return s;if("object"!==a)return s=s.concat([new be("fog",e,`object expected, ${a} found`)]),s;for(const t in e){const a=t.match(/^(.*)-transition$/);s=s.concat(a&&i[a[1]]&&i[a[1]].transition?Bi({key:t,value:e[t],valueSpec:n.transition,style:r,styleSpec:n}):i[t]?Bi({key:t,value:e[t],valueSpec:i[t],style:r,styleSpec:n}):[new be(t,e[t],`unknown property "${t}"`)]);}return s}const Ti={"*":()=>[],array:Wn,boolean:function(t){const e=t.value,r=t.key,n=Dn(e);return "boolean"!==n?[new be(r,e,`boolean expected, ${n} found`)]:[]},number:Qn,color:function(t){const e=t.key,r=t.value,n=Dn(r);return "string"!==n?[new be(e,r,`color expected, ${n} found`)]:null===Ne.parseCSSColor(r)?[new be(e,r,`color expected, "${r}" found`)]:[]},constants:we,enum:ni,filter:gi,function:ti,layer:_i,object:Jn,source:Si,light:Ii,terrain:zi,fog:Mi,string:Ai,formatted:function(t){return 0===Ai(t).length?[]:ei(t)},resolvedImage:function(t){return 0===Ai(t).length?[]:ei(t)},projection:function(t){const e=t.value,r=t.styleSpec,n=r.projection,i=t.style;let s=[];const a=Dn(e);if("object"===a)for(const t in e)s=s.concat(Bi({key:t,value:e[t],valueSpec:n[t],style:i,styleSpec:r}));else "string"!==a&&(s=s.concat([new be("projection",e,`object or string expected, ${a} found`)]));return s}};function Bi(t){const e=t.value,r=t.valueSpec,n=t.styleSpec;return r.expression&&Vn(Ae(e))?ti(t):r.expression&&Nn(ke(e))?ei(t):r.type&&Ti[r.type]?Ti[r.type](t):Jn(_e({},t,{valueSpec:r.type?n[r.type]:r}))}function Ci(t){const e=t.value,r=t.key,n=Ai(t);return n.length||(-1===e.indexOf("{fontstack}")&&n.push(new be(r,e,'"glyphs" url must include a "{fontstack}" token')),-1===e.indexOf("{range}")&&n.push(new be(r,e,'"glyphs" url must include a "{range}" token'))),n}function Pi(t,e=ve){let r=[];return r=r.concat(Bi({key:"",value:t,valueSpec:e.$root,styleSpec:e,style:t,objectElementValidators:{glyphs:Ci,"*":()=>[]}})),t.constants&&(r=r.concat(we({key:"constants",value:t.constants,style:t,styleSpec:e}))),Ei(r)}function Ei(t){return [].concat(t).sort(((t,e)=>t.line-e.line))}function Di(t){return function(...e){return Ei(t.apply(this,e))}}Pi.source=Di(Si),Pi.light=Di(Ii),Pi.terrain=Di(zi),Pi.fog=Di(Mi),Pi.layer=Di(_i),Pi.filter=Di(gi),Pi.paintProperty=Di(bi),Pi.layoutProperty=Di(wi);const Vi=Pi,Fi=Vi.light,Li=Vi.fog,Ri=Vi.paintProperty,Ui=Vi.layoutProperty;function $i(t,e){let r=!1;if(e&&e.length)for(const n of e)t.fire(new ge(new Error(n.message))),r=!0;return r}var Oi=ji;function ji(t,e,r){var n=this.cells=[];if(t instanceof ArrayBuffer){this.arrayBuffer=t;var i=new Int32Array(this.arrayBuffer);t=i[0],this.d=(e=i[1])+2*(r=i[2]);for(var s=0;s<this.d*this.d;s++){var a=i[3+s],o=i[3+s+1];n.push(a===o?null:i.subarray(a,o));}var l=i[3+n.length+1];this.keys=i.subarray(i[3+n.length],l),this.bboxes=i.subarray(l),this.insert=this._insertReadonly;}else {this.d=e+2*r;for(var u=0;u<this.d*this.d;u++)n.push([]);this.keys=[],this.bboxes=[];}this.n=e,this.extent=t,this.padding=r,this.scale=e/t,this.uid=0;var c=r/e*t;this.min=-c,this.max=t+c;}ji.prototype.insert=function(t,e,r,n,i){this._forEachCell(e,r,n,i,this._insertCell,this.uid++),this.keys.push(t),this.bboxes.push(e),this.bboxes.push(r),this.bboxes.push(n),this.bboxes.push(i);},ji.prototype._insertReadonly=function(){throw "Cannot insert into a GridIndex created from an ArrayBuffer."},ji.prototype._insertCell=function(t,e,r,n,i,s){this.cells[i].push(s);},ji.prototype.query=function(t,e,r,n,i){var s=this.min,a=this.max;if(t<=s&&e<=s&&a<=r&&a<=n&&!i)return Array.prototype.slice.call(this.keys);var o=[];return this._forEachCell(t,e,r,n,this._queryCell,o,{},i),o},ji.prototype._queryCell=function(t,e,r,n,i,s,a,o){var l=this.cells[i];if(null!==l)for(var u=this.keys,c=this.bboxes,h=0;h<l.length;h++){var p=l[h];if(void 0===a[p]){var d=4*p;(o?o(c[d+0],c[d+1],c[d+2],c[d+3]):t<=c[d+2]&&e<=c[d+3]&&r>=c[d+0]&&n>=c[d+1])?(a[p]=!0,s.push(u[p])):a[p]=!1;}}},ji.prototype._forEachCell=function(t,e,r,n,i,s,a,o){for(var l=this._convertToCellCoord(t),u=this._convertToCellCoord(e),c=this._convertToCellCoord(r),h=this._convertToCellCoord(n),p=l;p<=c;p++)for(var d=u;d<=h;d++){var f=this.d*d+p;if((!o||o(this._convertFromCellCoord(p),this._convertFromCellCoord(d),this._convertFromCellCoord(p+1),this._convertFromCellCoord(d+1)))&&i.call(this,t,e,r,n,f,s,a,o))return}},ji.prototype._convertFromCellCoord=function(t){return (t-this.padding)/this.scale},ji.prototype._convertToCellCoord=function(t){return Math.max(0,Math.min(this.d-1,Math.floor(t*this.scale)+this.padding))},ji.prototype.toArrayBuffer=function(){if(this.arrayBuffer)return this.arrayBuffer;for(var t=this.cells,e=3+this.cells.length+1+1,r=0,n=0;n<this.cells.length;n++)r+=this.cells[n].length;var i=new Int32Array(e+r+this.keys.length+this.bboxes.length);i[0]=this.extent,i[1]=this.n,i[2]=this.padding;for(var s=e,a=0;a<t.length;a++){var o=t[a];i[3+a]=s,i.set(o,s),s+=o.length;}return i[3+t.length]=s,i.set(this.keys,s),i[3+t.length+1]=s+=this.keys.length,i.set(this.bboxes,s),s+=this.bboxes.length,i.buffer};const{ImageData:qi,ImageBitmap:Ni}=a,Gi={};function Zi(t,e,r={}){Object.defineProperty(e,"_classRegistryKey",{value:t,writeable:!1}),Gi[t]={klass:e,omit:r.omit||[],shallow:r.shallow||[]};}Zi("Object",Object),Oi.serialize=function(t,e){const r=t.toArrayBuffer();return e&&e.push(r),{buffer:r}},Oi.deserialize=function(t){return new Oi(t.buffer)},Zi("Grid",Oi),Zi("Color",Ge),Zi("Error",Error),Zi("ResolvedImage",Ye),Zi("StylePropertyFunction",Yn),Zi("StyleExpression",qn,{omit:["_evaluator"]}),Zi("ZoomDependentExpression",Xn),Zi("ZoomConstantExpression",Zn),Zi("CompoundExpression",cr,{omit:["_evaluate"]});for(const t in kn)kn[t]._classRegistryKey||Zi(`Expression_${t}`,kn[t]);function Xi(t){return t&&"undefined"!=typeof ArrayBuffer&&(t instanceof ArrayBuffer||t.constructor&&"ArrayBuffer"===t.constructor.name)}function Ki(t){return Ni&&t instanceof Ni}function Yi(t,e){if(null==t||"boolean"==typeof t||"number"==typeof t||"string"==typeof t||t instanceof Boolean||t instanceof Number||t instanceof String||t instanceof Date||t instanceof RegExp)return t;if(Xi(t)||Ki(t))return e&&e.push(t),t;if(ArrayBuffer.isView(t)){const r=t;return e&&e.push(r.buffer),r}if(t instanceof qi)return e&&e.push(t.data.buffer),t;if(Array.isArray(t)){const r=[];for(const n of t)r.push(Yi(n,e));return r}if("object"==typeof t){const r=t.constructor,n=r._classRegistryKey;if(!n)throw new Error("can't serialize object of unregistered class");const i=r.serialize?r.serialize(t,e):{};if(!r.serialize){for(const r in t){if(!t.hasOwnProperty(r))continue;if(Gi[n].omit.indexOf(r)>=0)continue;const s=t[r];i[r]=Gi[n].shallow.indexOf(r)>=0?s:Yi(s,e);}t instanceof Error&&(i.message=t.message);}if(i.$name)throw new Error("$name property is reserved for worker serialization logic.");return "Object"!==n&&(i.$name=n),i}throw new Error("can't serialize object of type "+typeof t)}function Hi(t){if(null==t||"boolean"==typeof t||"number"==typeof t||"string"==typeof t||t instanceof Boolean||t instanceof Number||t instanceof String||t instanceof Date||t instanceof RegExp||Xi(t)||Ki(t)||ArrayBuffer.isView(t)||t instanceof qi)return t;if(Array.isArray(t))return t.map(Hi);if("object"==typeof t){const e=t.$name||"Object",{klass:r}=Gi[e];if(!r)throw new Error(`can't deserialize unregistered class ${e}`);if(r.deserialize)return r.deserialize(t);const n=Object.create(r.prototype);for(const r of Object.keys(t)){if("$name"===r)continue;const i=t[r];n[r]=Gi[e].shallow.indexOf(r)>=0?i:Hi(i);}return n}throw new Error("can't deserialize object of type "+typeof t)}class Ji{constructor(){this.first=!0;}update(t,e){const r=Math.floor(t);return this.first?(this.first=!1,this.lastIntegerZoom=r,this.lastIntegerZoomTime=0,this.lastZoom=t,this.lastFloorZoom=r,!0):(this.lastFloorZoom>r?(this.lastIntegerZoom=r+1,this.lastIntegerZoomTime=e):this.lastFloorZoom<r&&(this.lastIntegerZoom=r,this.lastIntegerZoomTime=e),t!==this.lastZoom&&(this.lastZoom=t,this.lastFloorZoom=r,!0))}}const Wi=t=>t>=1536&&t<=1791,Qi=t=>t>=1872&&t<=1919,ts=t=>t>=2208&&t<=2303,es=t=>t>=11904&&t<=12031,rs=t=>t>=12032&&t<=12255,ns=t=>t>=12272&&t<=12287,is=t=>t>=12288&&t<=12351,ss=t=>t>=12352&&t<=12447,as=t=>t>=12448&&t<=12543,os=t=>t>=12544&&t<=12591,ls=t=>t>=12704&&t<=12735,us=t=>t>=12736&&t<=12783,cs=t=>t>=12784&&t<=12799,hs=t=>t>=12800&&t<=13055,ps=t=>t>=13056&&t<=13311,ds=t=>t>=13312&&t<=19903,fs=t=>t>=19968&&t<=40959,ys=t=>t>=40960&&t<=42127,ms=t=>t>=42128&&t<=42191,gs=t=>t>=44032&&t<=55215,xs=t=>t>=63744&&t<=64255,vs=t=>t>=64336&&t<=65023,bs=t=>t>=65040&&t<=65055,ws=t=>t>=65072&&t<=65103,_s=t=>t>=65104&&t<=65135,As=t=>t>=65136&&t<=65279,ks=t=>t>=65280&&t<=65519;function Ss(t){for(const e of t)if(Ms(e.charCodeAt(0)))return !0;return !1}function Is(t){for(const e of t)if(!zs(e.charCodeAt(0)))return !1;return !0}function zs(t){return !(Wi(t)||Qi(t)||ts(t)||vs(t)||As(t))}function Ms(t){return !(746!==t&&747!==t&&(t<4352||!(ls(t)||os(t)||ws(t)&&!(t>=65097&&t<=65103)||xs(t)||ps(t)||es(t)||us(t)||!(!is(t)||t>=12296&&t<=12305||t>=12308&&t<=12319||12336===t)||ds(t)||fs(t)||hs(t)||(t=>t>=12592&&t<=12687)(t)||(t=>t>=43360&&t<=43391)(t)||(t=>t>=55216&&t<=55295)(t)||(t=>t>=4352&&t<=4607)(t)||gs(t)||ss(t)||ns(t)||(t=>t>=12688&&t<=12703)(t)||rs(t)||cs(t)||as(t)&&12540!==t||!(!ks(t)||65288===t||65289===t||65293===t||t>=65306&&t<=65310||65339===t||65341===t||65343===t||t>=65371&&t<=65503||65507===t||t>=65512&&t<=65519)||!(!_s(t)||t>=65112&&t<=65118||t>=65123&&t<=65126)||(t=>t>=5120&&t<=5759)(t)||(t=>t>=6320&&t<=6399)(t)||bs(t)||(t=>t>=19904&&t<=19967)(t)||ys(t)||ms(t))))}function Ts(t){return !(Ms(t)||function(t){return !!((t=>t>=128&&t<=255)(t)&&(167===t||169===t||174===t||177===t||188===t||189===t||190===t||215===t||247===t)||(t=>t>=8192&&t<=8303)(t)&&(8214===t||8224===t||8225===t||8240===t||8241===t||8251===t||8252===t||8258===t||8263===t||8264===t||8265===t||8273===t)||(t=>t>=8448&&t<=8527)(t)||(t=>t>=8528&&t<=8591)(t)||(t=>t>=8960&&t<=9215)(t)&&(t>=8960&&t<=8967||t>=8972&&t<=8991||t>=8996&&t<=9e3||9003===t||t>=9085&&t<=9114||t>=9150&&t<=9165||9167===t||t>=9169&&t<=9179||t>=9186&&t<=9215)||(t=>t>=9216&&t<=9279)(t)&&9251!==t||(t=>t>=9280&&t<=9311)(t)||(t=>t>=9312&&t<=9471)(t)||(t=>t>=9632&&t<=9727)(t)||(t=>t>=9728&&t<=9983)(t)&&!(t>=9754&&t<=9759)||(t=>t>=11008&&t<=11263)(t)&&(t>=11026&&t<=11055||t>=11088&&t<=11097||t>=11192&&t<=11243)||is(t)||as(t)||(t=>t>=57344&&t<=63743)(t)||ws(t)||_s(t)||ks(t)||8734===t||8756===t||8757===t||t>=9984&&t<=10087||t>=10102&&t<=10131||65532===t||65533===t)}(t))}function Bs(t){return t>=1424&&t<=2303||vs(t)||As(t)}function Cs(t,e){return !(!e&&Bs(t)||t>=2304&&t<=3583||t>=3840&&t<=4255||(t=>t>=6016&&t<=6143)(t))}function Ps(t){for(const e of t)if(Bs(e.charCodeAt(0)))return !0;return !1}const Es="deferred",Ds="loading",Vs="loaded";let Fs=null,Ls="unavailable",Rs=null;const Us=function(t){t&&"string"==typeof t&&t.indexOf("NetworkError")>-1&&(Ls="error"),Fs&&Fs(t);};function $s(){Os.fire(new me("pluginStateChange",{pluginStatus:Ls,pluginURL:Rs}));}const Os=new xe,js=function(){return Ls},qs=function(){if(Ls!==Es||!Rs)throw new Error("rtl-text-plugin cannot be downloaded unless a pluginURL is specified");Ls=Ds,$s(),Rs&&ae({url:Rs},(t=>{t?Us(t):(Ls=Vs,$s());}));},Ns={applyArabicShaping:null,processBidirectionalText:null,processStyledBidirectionalText:null,isLoaded:()=>Ls===Vs||null!=Ns.applyArabicShaping,isLoading:()=>Ls===Ds,setState(t){Ls=t.pluginStatus,Rs=t.pluginURL;},isParsed:()=>null!=Ns.applyArabicShaping&&null!=Ns.processBidirectionalText&&null!=Ns.processStyledBidirectionalText,getPluginURL:()=>Rs};class Gs{constructor(t,e){this.zoom=t,e?(this.now=e.now,this.fadeDuration=e.fadeDuration,this.zoomHistory=e.zoomHistory,this.transition=e.transition,this.pitch=e.pitch):(this.now=0,this.fadeDuration=0,this.zoomHistory=new Ji,this.transition={},this.pitch=0);}isSupportedScript(t){return function(t,e){for(const r of t)if(!Cs(r.charCodeAt(0),e))return !1;return !0}(t,Ns.isLoaded())}crossFadingFactor(){return 0===this.fadeDuration?1:Math.min((this.now-this.zoomHistory.lastIntegerZoomTime)/this.fadeDuration,1)}getCrossfadeParameters(){const t=this.zoom,e=t-Math.floor(t),r=this.crossFadingFactor();return t>this.zoomHistory.lastIntegerZoom?{fromScale:2,toScale:1,t:e+(1-e)*r}:{fromScale:.5,toScale:1,t:1-(1-r)*e}}}class Zs{constructor(t,e){this.property=t,this.value=e,this.expression=function(t,e){if(Vn(t))return new Yn(t,e);if(Nn(t)){const r=Kn(t,e);if("error"===r.result)throw new Error(r.value.map((t=>`${t.key}: ${t.message}`)).join(", "));return r.value}{let r=t;return "string"==typeof t&&"color"===e.type&&(r=Ge.parse(t)),{kind:"constant",evaluate:()=>r}}}(void 0===e?t.specification.default:e,t.specification);}isDataDriven(){return "source"===this.expression.kind||"composite"===this.expression.kind}possiblyEvaluate(t,e,r){return this.property.possiblyEvaluate(this,t,e,r)}}class Xs{constructor(t){this.property=t,this.value=new Zs(t,void 0);}transitioned(t,e){return new Ys(this.property,this.value,e,tt({},t.transition,this.transition),t.now)}untransitioned(){return new Ys(this.property,this.value,null,{},0)}}class Ks{constructor(t){this._properties=t,this._values=Object.create(t.defaultTransitionablePropertyValues);}getValue(t){return ct(this._values[t].value.value)}setValue(t,e){this._values.hasOwnProperty(t)||(this._values[t]=new Xs(this._values[t].property)),this._values[t].value=new Zs(this._values[t].property,null===e?void 0:ct(e));}getTransition(t){return ct(this._values[t].transition)}setTransition(t,e){this._values.hasOwnProperty(t)||(this._values[t]=new Xs(this._values[t].property)),this._values[t].transition=ct(e)||void 0;}serialize(){const t={};for(const e of Object.keys(this._values)){const r=this.getValue(e);void 0!==r&&(t[e]=r);const n=this.getTransition(e);void 0!==n&&(t[`${e}-transition`]=n);}return t}transitioned(t,e){const r=new Hs(this._properties);for(const n of Object.keys(this._values))r._values[n]=this._values[n].transitioned(t,e._values[n]);return r}untransitioned(){const t=new Hs(this._properties);for(const e of Object.keys(this._values))t._values[e]=this._values[e].untransitioned();return t}}class Ys{constructor(t,e,r,n,i){const s=n.delay||0,a=n.duration||0;i=i||0,this.property=t,this.value=e,this.begin=i+s,this.end=this.begin+a,t.specification.transition&&(n.delay||n.duration)&&(this.prior=r);}possiblyEvaluate(t,e,r){const n=t.now||0,i=this.value.possiblyEvaluate(t,e,r),s=this.prior;if(s){if(n>this.end)return this.prior=null,i;if(this.value.isDataDriven())return this.prior=null,i;if(n<this.begin)return s.possiblyEvaluate(t,e,r);{const a=(n-this.begin)/(this.end-this.begin);return this.property.interpolate(s.possiblyEvaluate(t,e,r),i,Z(a))}}return i}}class Hs{constructor(t){this._properties=t,this._values=Object.create(t.defaultTransitioningPropertyValues);}possiblyEvaluate(t,e,r){const n=new Qs(this._properties);for(const i of Object.keys(this._values))n._values[i]=this._values[i].possiblyEvaluate(t,e,r);return n}hasTransition(){for(const t of Object.keys(this._values))if(this._values[t].prior)return !0;return !1}}class Js{constructor(t){this._properties=t,this._values=Object.create(t.defaultPropertyValues);}getValue(t){return ct(this._values[t].value)}setValue(t,e){this._values[t]=new Zs(this._values[t].property,null===e?void 0:ct(e));}serialize(){const t={};for(const e of Object.keys(this._values)){const r=this.getValue(e);void 0!==r&&(t[e]=r);}return t}possiblyEvaluate(t,e,r){const n=new Qs(this._properties);for(const i of Object.keys(this._values))n._values[i]=this._values[i].possiblyEvaluate(t,e,r);return n}}class Ws{constructor(t,e,r){this.property=t,this.value=e,this.parameters=r;}isConstant(){return "constant"===this.value.kind}constantOr(t){return "constant"===this.value.kind?this.value.value:t}evaluate(t,e,r,n){return this.property.evaluate(this.value,this.parameters,t,e,r,n)}}class Qs{constructor(t){this._properties=t,this._values=Object.create(t.defaultPossiblyEvaluatedValues);}get(t){return this._values[t]}}class ta{constructor(t){this.specification=t;}possiblyEvaluate(t,e){return t.expression.evaluate(e)}interpolate(t,e,r){const n=Rr[this.specification.type];return n?n(t,e,r):t}}class ea{constructor(t,e){this.specification=t,this.overrides=e;}possiblyEvaluate(t,e,r,n){return new Ws(this,"constant"===t.expression.kind||"camera"===t.expression.kind?{kind:"constant",value:t.expression.evaluate(e,null,{},r,n)}:t.expression,e)}interpolate(t,e,r){if("constant"!==t.value.kind||"constant"!==e.value.kind)return t;if(void 0===t.value.value||void 0===e.value.value)return new Ws(this,{kind:"constant",value:void 0},t.parameters);const n=Rr[this.specification.type];return n?new Ws(this,{kind:"constant",value:n(t.value.value,e.value.value,r)},t.parameters):t}evaluate(t,e,r,n,i,s){return "constant"===t.kind?t.value:t.evaluate(e,r,n,i,s)}}class ra extends ea{possiblyEvaluate(t,e,r,n){if(void 0===t.value)return new Ws(this,{kind:"constant",value:void 0},e);if("constant"===t.expression.kind){const i=t.expression.evaluate(e,null,{},r,n),s="resolvedImage"===t.property.specification.type&&"string"!=typeof i?i.name:i,a=this._calculate(s,s,s,e);return new Ws(this,{kind:"constant",value:a},e)}if("camera"===t.expression.kind){const r=this._calculate(t.expression.evaluate({zoom:e.zoom-1}),t.expression.evaluate({zoom:e.zoom}),t.expression.evaluate({zoom:e.zoom+1}),e);return new Ws(this,{kind:"constant",value:r},e)}return new Ws(this,t.expression,e)}evaluate(t,e,r,n,i,s){if("source"===t.kind){const a=t.evaluate(e,r,n,i,s);return this._calculate(a,a,a,e)}return "composite"===t.kind?this._calculate(t.evaluate({zoom:Math.floor(e.zoom)-1},r,n),t.evaluate({zoom:Math.floor(e.zoom)},r,n),t.evaluate({zoom:Math.floor(e.zoom)+1},r,n),e):t.value}_calculate(t,e,r,n){return n.zoom>n.zoomHistory.lastIntegerZoom?{from:t,to:e,other:r}:{from:r,to:e,other:t}}interpolate(t){return t}}class na{constructor(t){this.specification=t;}possiblyEvaluate(t,e,r,n){if(void 0!==t.value){if("constant"===t.expression.kind){const i=t.expression.evaluate(e,null,{},r,n);return this._calculate(i,i,i,e)}return this._calculate(t.expression.evaluate(new Gs(Math.floor(e.zoom-1),e)),t.expression.evaluate(new Gs(Math.floor(e.zoom),e)),t.expression.evaluate(new Gs(Math.floor(e.zoom+1),e)),e)}}_calculate(t,e,r,n){return n.zoom>n.zoomHistory.lastIntegerZoom?{from:t,to:e}:{from:r,to:e}}interpolate(t){return t}}class ia{constructor(t){this.specification=t;}possiblyEvaluate(t,e,r,n){return !!t.expression.evaluate(e,null,{},r,n)}interpolate(){return !1}}class sa{constructor(t){this.properties=t,this.defaultPropertyValues={},this.defaultTransitionablePropertyValues={},this.defaultTransitioningPropertyValues={},this.defaultPossiblyEvaluatedValues={},this.overridableProperties=[];for(const e in t){const r=t[e];r.specification.overridable&&this.overridableProperties.push(e);const n=this.defaultPropertyValues[e]=new Zs(r,void 0),i=this.defaultTransitionablePropertyValues[e]=new Xs(r);this.defaultTransitioningPropertyValues[e]=i.untransitioned(),this.defaultPossiblyEvaluatedValues[e]=n.possiblyEvaluate({});}}}function aa(t,e){return 256*(t=Y(Math.floor(t),0,255))+Y(Math.floor(e),0,255)}Zi("DataDrivenProperty",ea),Zi("DataConstantProperty",ta),Zi("CrossFadedDataDrivenProperty",ra),Zi("CrossFadedProperty",na),Zi("ColorRampProperty",ia);const oa={Int8:Int8Array,Uint8:Uint8Array,Int16:Int16Array,Uint16:Uint16Array,Int32:Int32Array,Uint32:Uint32Array,Float32:Float32Array};class la{constructor(t,e){this._structArray=t,this._pos1=e*this.size,this._pos2=this._pos1/2,this._pos4=this._pos1/4,this._pos8=this._pos1/8;}}class ua{constructor(){this.isTransferred=!1,this.capacity=-1,this.resize(0);}static serialize(t,e){return t._trim(),e&&(t.isTransferred=!0,e.push(t.arrayBuffer)),{length:t.length,arrayBuffer:t.arrayBuffer}}static deserialize(t){const e=Object.create(this.prototype);return e.arrayBuffer=t.arrayBuffer,e.length=t.length,e.capacity=t.arrayBuffer.byteLength/e.bytesPerElement,e._refreshViews(),e}_trim(){this.length!==this.capacity&&(this.capacity=this.length,this.arrayBuffer=this.arrayBuffer.slice(0,this.length*this.bytesPerElement),this._refreshViews());}clear(){this.length=0;}resize(t){this.reserve(t),this.length=t;}reserve(t){if(t>this.capacity){this.capacity=Math.max(t,Math.floor(5*this.capacity),128),this.arrayBuffer=new ArrayBuffer(this.capacity*this.bytesPerElement);const e=this.uint8;this._refreshViews(),e&&this.uint8.set(e);}}_refreshViews(){throw new Error("_refreshViews() must be implemented by each concrete StructArray layout")}}function ca(t,e=1){let r=0,n=0;return {members:t.map((t=>{const i=oa[t.type].BYTES_PER_ELEMENT,s=r=ha(r,Math.max(e,i)),a=t.components||1;return n=Math.max(n,i),r+=i*a,{name:t.name,type:t.type,components:a,offset:s}})),size:ha(r,Math.max(n,e)),alignment:e}}function ha(t,e){return Math.ceil(t/e)*e}class pa extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer);}emplaceBack(t,e){const r=this.length;return this.resize(r+1),this.emplace(r,t,e)}emplace(t,e,r){const n=2*t;return this.int16[n+0]=e,this.int16[n+1]=r,t}}pa.prototype.bytesPerElement=4,Zi("StructArrayLayout2i4",pa);class da extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer);}emplaceBack(t,e,r,n){const i=this.length;return this.resize(i+1),this.emplace(i,t,e,r,n)}emplace(t,e,r,n,i){const s=4*t;return this.int16[s+0]=e,this.int16[s+1]=r,this.int16[s+2]=n,this.int16[s+3]=i,t}}da.prototype.bytesPerElement=8,Zi("StructArrayLayout4i8",da);class fa extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer);}emplaceBack(t,e,r,n,i,s,a){const o=this.length;return this.resize(o+1),this.emplace(o,t,e,r,n,i,s,a)}emplace(t,e,r,n,i,s,a,o){const l=6*t,u=12*t,c=3*t;return this.int16[l+0]=e,this.int16[l+1]=r,this.uint8[u+4]=n,this.uint8[u+5]=i,this.uint8[u+6]=s,this.uint8[u+7]=a,this.float32[c+2]=o,t}}fa.prototype.bytesPerElement=12,Zi("StructArrayLayout2i4ub1f12",fa);class ya extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer);}emplaceBack(t,e,r){const n=this.length;return this.resize(n+1),this.emplace(n,t,e,r)}emplace(t,e,r,n){const i=3*t;return this.float32[i+0]=e,this.float32[i+1]=r,this.float32[i+2]=n,t}}ya.prototype.bytesPerElement=12,Zi("StructArrayLayout3f12",ya);class ma extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);}emplaceBack(t,e,r,n,i,s,a,o,l,u){const c=this.length;return this.resize(c+1),this.emplace(c,t,e,r,n,i,s,a,o,l,u)}emplace(t,e,r,n,i,s,a,o,l,u,c){const h=10*t;return this.uint16[h+0]=e,this.uint16[h+1]=r,this.uint16[h+2]=n,this.uint16[h+3]=i,this.uint16[h+4]=s,this.uint16[h+5]=a,this.uint16[h+6]=o,this.uint16[h+7]=l,this.uint16[h+8]=u,this.uint16[h+9]=c,t}}ma.prototype.bytesPerElement=20,Zi("StructArrayLayout10ui20",ma);class ga extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);}emplaceBack(t,e,r,n,i,s,a,o){const l=this.length;return this.resize(l+1),this.emplace(l,t,e,r,n,i,s,a,o)}emplace(t,e,r,n,i,s,a,o,l){const u=8*t;return this.uint16[u+0]=e,this.uint16[u+1]=r,this.uint16[u+2]=n,this.uint16[u+3]=i,this.uint16[u+4]=s,this.uint16[u+5]=a,this.uint16[u+6]=o,this.uint16[u+7]=l,t}}ga.prototype.bytesPerElement=16,Zi("StructArrayLayout8ui16",ga);class xa extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);}emplaceBack(t,e,r,n,i,s,a,o,l,u,c,h,p,d,f,y){const m=this.length;return this.resize(m+1),this.emplace(m,t,e,r,n,i,s,a,o,l,u,c,h,p,d,f,y)}emplace(t,e,r,n,i,s,a,o,l,u,c,h,p,d,f,y,m){const g=16*t;return this.int16[g+0]=e,this.int16[g+1]=r,this.int16[g+2]=n,this.int16[g+3]=i,this.uint16[g+4]=s,this.uint16[g+5]=a,this.uint16[g+6]=o,this.uint16[g+7]=l,this.int16[g+8]=u,this.int16[g+9]=c,this.int16[g+10]=h,this.int16[g+11]=p,this.int16[g+12]=d,this.int16[g+13]=f,this.int16[g+14]=y,this.int16[g+15]=m,t}}xa.prototype.bytesPerElement=32,Zi("StructArrayLayout4i4ui4i4i32",xa);class va extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.uint32=new Uint32Array(this.arrayBuffer);}emplaceBack(t){const e=this.length;return this.resize(e+1),this.emplace(e,t)}emplace(t,e){return this.uint32[1*t+0]=e,t}}va.prototype.bytesPerElement=4,Zi("StructArrayLayout1ul4",va);class ba extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer),this.uint32=new Uint32Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);}emplaceBack(t,e,r,n,i,s,a,o,l,u,c,h,p){const d=this.length;return this.resize(d+1),this.emplace(d,t,e,r,n,i,s,a,o,l,u,c,h,p)}emplace(t,e,r,n,i,s,a,o,l,u,c,h,p,d){const f=20*t,y=10*t;return this.int16[f+0]=e,this.int16[f+1]=r,this.int16[f+2]=n,this.int16[f+3]=i,this.int16[f+4]=s,this.float32[y+3]=a,this.float32[y+4]=o,this.float32[y+5]=l,this.float32[y+6]=u,this.int16[f+14]=c,this.uint32[y+8]=h,this.uint16[f+18]=p,this.uint16[f+19]=d,t}}ba.prototype.bytesPerElement=40,Zi("StructArrayLayout5i4f1i1ul2ui40",ba);class wa extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer);}emplaceBack(t,e,r,n,i,s,a){const o=this.length;return this.resize(o+1),this.emplace(o,t,e,r,n,i,s,a)}emplace(t,e,r,n,i,s,a,o){const l=8*t;return this.int16[l+0]=e,this.int16[l+1]=r,this.int16[l+2]=n,this.int16[l+4]=i,this.int16[l+5]=s,this.int16[l+6]=a,this.int16[l+7]=o,t}}wa.prototype.bytesPerElement=16,Zi("StructArrayLayout3i2i2i16",wa);class _a extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer);}emplaceBack(t,e,r,n,i){const s=this.length;return this.resize(s+1),this.emplace(s,t,e,r,n,i)}emplace(t,e,r,n,i,s){const a=4*t,o=8*t;return this.float32[a+0]=e,this.float32[a+1]=r,this.float32[a+2]=n,this.int16[o+6]=i,this.int16[o+7]=s,t}}_a.prototype.bytesPerElement=16,Zi("StructArrayLayout2f1f2i16",_a);class Aa extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer);}emplaceBack(t,e,r,n){const i=this.length;return this.resize(i+1),this.emplace(i,t,e,r,n)}emplace(t,e,r,n,i){const s=12*t,a=3*t;return this.uint8[s+0]=e,this.uint8[s+1]=r,this.float32[a+1]=n,this.float32[a+2]=i,t}}Aa.prototype.bytesPerElement=12,Zi("StructArrayLayout2ub2f12",Aa);class ka extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);}emplaceBack(t,e,r){const n=this.length;return this.resize(n+1),this.emplace(n,t,e,r)}emplace(t,e,r,n){const i=3*t;return this.uint16[i+0]=e,this.uint16[i+1]=r,this.uint16[i+2]=n,t}}ka.prototype.bytesPerElement=6,Zi("StructArrayLayout3ui6",ka);class Sa extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer),this.uint32=new Uint32Array(this.arrayBuffer);}emplaceBack(t,e,r,n,i,s,a,o,l,u,c,h,p,d,f,y,m,g,x,v,b){const w=this.length;return this.resize(w+1),this.emplace(w,t,e,r,n,i,s,a,o,l,u,c,h,p,d,f,y,m,g,x,v,b)}emplace(t,e,r,n,i,s,a,o,l,u,c,h,p,d,f,y,m,g,x,v,b,w){const _=30*t,A=15*t,k=60*t;return this.int16[_+0]=e,this.int16[_+1]=r,this.int16[_+2]=n,this.float32[A+2]=i,this.float32[A+3]=s,this.uint16[_+8]=a,this.uint16[_+9]=o,this.uint32[A+5]=l,this.uint32[A+6]=u,this.uint32[A+7]=c,this.uint16[_+16]=h,this.uint16[_+17]=p,this.uint16[_+18]=d,this.float32[A+10]=f,this.float32[A+11]=y,this.uint8[k+48]=m,this.uint8[k+49]=g,this.uint8[k+50]=x,this.uint32[A+13]=v,this.int16[_+28]=b,this.uint8[k+58]=w,t}}Sa.prototype.bytesPerElement=60,Zi("StructArrayLayout3i2f2ui3ul3ui2f3ub1ul1i1ub60",Sa);class Ia extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer),this.uint32=new Uint32Array(this.arrayBuffer);}emplaceBack(t,e,r,n,i,s,a,o,l,u,c,h,p,d,f,y,m,g,x,v,b,w,_,A,k,S,I,z,M,T){const B=this.length;return this.resize(B+1),this.emplace(B,t,e,r,n,i,s,a,o,l,u,c,h,p,d,f,y,m,g,x,v,b,w,_,A,k,S,I,z,M,T)}emplace(t,e,r,n,i,s,a,o,l,u,c,h,p,d,f,y,m,g,x,v,b,w,_,A,k,S,I,z,M,T,B){const C=38*t,P=19*t;return this.int16[C+0]=e,this.int16[C+1]=r,this.int16[C+2]=n,this.float32[P+2]=i,this.float32[P+3]=s,this.int16[C+8]=a,this.int16[C+9]=o,this.int16[C+10]=l,this.int16[C+11]=u,this.int16[C+12]=c,this.int16[C+13]=h,this.uint16[C+14]=p,this.uint16[C+15]=d,this.uint16[C+16]=f,this.uint16[C+17]=y,this.uint16[C+18]=m,this.uint16[C+19]=g,this.uint16[C+20]=x,this.uint16[C+21]=v,this.uint16[C+22]=b,this.uint16[C+23]=w,this.uint16[C+24]=_,this.uint16[C+25]=A,this.uint16[C+26]=k,this.uint16[C+27]=S,this.uint16[C+28]=I,this.uint32[P+15]=z,this.float32[P+16]=M,this.float32[P+17]=T,this.float32[P+18]=B,t}}Ia.prototype.bytesPerElement=76,Zi("StructArrayLayout3i2f6i15ui1ul3f76",Ia);class za extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer);}emplaceBack(t){const e=this.length;return this.resize(e+1),this.emplace(e,t)}emplace(t,e){return this.float32[1*t+0]=e,t}}za.prototype.bytesPerElement=4,Zi("StructArrayLayout1f4",za);class Ma extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.int16=new Int16Array(this.arrayBuffer);}emplaceBack(t,e,r){const n=this.length;return this.resize(n+1),this.emplace(n,t,e,r)}emplace(t,e,r,n){const i=3*t;return this.int16[i+0]=e,this.int16[i+1]=r,this.int16[i+2]=n,t}}Ma.prototype.bytesPerElement=6,Zi("StructArrayLayout3i6",Ma);class Ta extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer);}emplaceBack(t,e,r,n,i,s,a){const o=this.length;return this.resize(o+1),this.emplace(o,t,e,r,n,i,s,a)}emplace(t,e,r,n,i,s,a,o){const l=7*t;return this.float32[l+0]=e,this.float32[l+1]=r,this.float32[l+2]=n,this.float32[l+3]=i,this.float32[l+4]=s,this.float32[l+5]=a,this.float32[l+6]=o,t}}Ta.prototype.bytesPerElement=28,Zi("StructArrayLayout7f28",Ta);class Ba extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.uint32=new Uint32Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);}emplaceBack(t,e,r,n){const i=this.length;return this.resize(i+1),this.emplace(i,t,e,r,n)}emplace(t,e,r,n,i){const s=6*t;return this.uint32[3*t+0]=e,this.uint16[s+2]=r,this.uint16[s+3]=n,this.uint16[s+4]=i,t}}Ba.prototype.bytesPerElement=12,Zi("StructArrayLayout1ul3ui12",Ba);class Ca extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);}emplaceBack(t,e){const r=this.length;return this.resize(r+1),this.emplace(r,t,e)}emplace(t,e,r){const n=2*t;return this.uint16[n+0]=e,this.uint16[n+1]=r,t}}Ca.prototype.bytesPerElement=4,Zi("StructArrayLayout2ui4",Ca);class Pa extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.uint16=new Uint16Array(this.arrayBuffer);}emplaceBack(t){const e=this.length;return this.resize(e+1),this.emplace(e,t)}emplace(t,e){return this.uint16[1*t+0]=e,t}}Pa.prototype.bytesPerElement=2,Zi("StructArrayLayout1ui2",Pa);class Ea extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer);}emplaceBack(t,e){const r=this.length;return this.resize(r+1),this.emplace(r,t,e)}emplace(t,e,r){const n=2*t;return this.float32[n+0]=e,this.float32[n+1]=r,t}}Ea.prototype.bytesPerElement=8,Zi("StructArrayLayout2f8",Ea);class Da extends ua{_refreshViews(){this.uint8=new Uint8Array(this.arrayBuffer),this.float32=new Float32Array(this.arrayBuffer);}emplaceBack(t,e,r,n){const i=this.length;return this.resize(i+1),this.emplace(i,t,e,r,n)}emplace(t,e,r,n,i){const s=4*t;return this.float32[s+0]=e,this.float32[s+1]=r,this.float32[s+2]=n,this.float32[s+3]=i,t}}Da.prototype.bytesPerElement=16,Zi("StructArrayLayout4f16",Da);class Va extends la{get projectedAnchorX(){return this._structArray.int16[this._pos2+0]}get projectedAnchorY(){return this._structArray.int16[this._pos2+1]}get projectedAnchorZ(){return this._structArray.int16[this._pos2+2]}get tileAnchorX(){return this._structArray.int16[this._pos2+3]}get tileAnchorY(){return this._structArray.int16[this._pos2+4]}get x1(){return this._structArray.float32[this._pos4+3]}get y1(){return this._structArray.float32[this._pos4+4]}get x2(){return this._structArray.float32[this._pos4+5]}get y2(){return this._structArray.float32[this._pos4+6]}get padding(){return this._structArray.int16[this._pos2+14]}get featureIndex(){return this._structArray.uint32[this._pos4+8]}get sourceLayerIndex(){return this._structArray.uint16[this._pos2+18]}get bucketIndex(){return this._structArray.uint16[this._pos2+19]}}Va.prototype.size=40;class Fa extends ba{get(t){return new Va(this,t)}}Zi("CollisionBoxArray",Fa);class La extends la{get projectedAnchorX(){return this._structArray.int16[this._pos2+0]}get projectedAnchorY(){return this._structArray.int16[this._pos2+1]}get projectedAnchorZ(){return this._structArray.int16[this._pos2+2]}get tileAnchorX(){return this._structArray.float32[this._pos4+2]}get tileAnchorY(){return this._structArray.float32[this._pos4+3]}get glyphStartIndex(){return this._structArray.uint16[this._pos2+8]}get numGlyphs(){return this._structArray.uint16[this._pos2+9]}get vertexStartIndex(){return this._structArray.uint32[this._pos4+5]}get lineStartIndex(){return this._structArray.uint32[this._pos4+6]}get lineLength(){return this._structArray.uint32[this._pos4+7]}get segment(){return this._structArray.uint16[this._pos2+16]}get lowerSize(){return this._structArray.uint16[this._pos2+17]}get upperSize(){return this._structArray.uint16[this._pos2+18]}get lineOffsetX(){return this._structArray.float32[this._pos4+10]}get lineOffsetY(){return this._structArray.float32[this._pos4+11]}get writingMode(){return this._structArray.uint8[this._pos1+48]}get placedOrientation(){return this._structArray.uint8[this._pos1+49]}set placedOrientation(t){this._structArray.uint8[this._pos1+49]=t;}get hidden(){return this._structArray.uint8[this._pos1+50]}set hidden(t){this._structArray.uint8[this._pos1+50]=t;}get crossTileID(){return this._structArray.uint32[this._pos4+13]}set crossTileID(t){this._structArray.uint32[this._pos4+13]=t;}get associatedIconIndex(){return this._structArray.int16[this._pos2+28]}get flipState(){return this._structArray.uint8[this._pos1+58]}set flipState(t){this._structArray.uint8[this._pos1+58]=t;}}La.prototype.size=60;class Ra extends Sa{get(t){return new La(this,t)}}Zi("PlacedSymbolArray",Ra);class Ua extends la{get projectedAnchorX(){return this._structArray.int16[this._pos2+0]}get projectedAnchorY(){return this._structArray.int16[this._pos2+1]}get projectedAnchorZ(){return this._structArray.int16[this._pos2+2]}get tileAnchorX(){return this._structArray.float32[this._pos4+2]}get tileAnchorY(){return this._structArray.float32[this._pos4+3]}get rightJustifiedTextSymbolIndex(){return this._structArray.int16[this._pos2+8]}get centerJustifiedTextSymbolIndex(){return this._structArray.int16[this._pos2+9]}get leftJustifiedTextSymbolIndex(){return this._structArray.int16[this._pos2+10]}get verticalPlacedTextSymbolIndex(){return this._structArray.int16[this._pos2+11]}get placedIconSymbolIndex(){return this._structArray.int16[this._pos2+12]}get verticalPlacedIconSymbolIndex(){return this._structArray.int16[this._pos2+13]}get key(){return this._structArray.uint16[this._pos2+14]}get textBoxStartIndex(){return this._structArray.uint16[this._pos2+15]}get textBoxEndIndex(){return this._structArray.uint16[this._pos2+16]}get verticalTextBoxStartIndex(){return this._structArray.uint16[this._pos2+17]}get verticalTextBoxEndIndex(){return this._structArray.uint16[this._pos2+18]}get iconBoxStartIndex(){return this._structArray.uint16[this._pos2+19]}get iconBoxEndIndex(){return this._structArray.uint16[this._pos2+20]}get verticalIconBoxStartIndex(){return this._structArray.uint16[this._pos2+21]}get verticalIconBoxEndIndex(){return this._structArray.uint16[this._pos2+22]}get featureIndex(){return this._structArray.uint16[this._pos2+23]}get numHorizontalGlyphVertices(){return this._structArray.uint16[this._pos2+24]}get numVerticalGlyphVertices(){return this._structArray.uint16[this._pos2+25]}get numIconVertices(){return this._structArray.uint16[this._pos2+26]}get numVerticalIconVertices(){return this._structArray.uint16[this._pos2+27]}get useRuntimeCollisionCircles(){return this._structArray.uint16[this._pos2+28]}get crossTileID(){return this._structArray.uint32[this._pos4+15]}set crossTileID(t){this._structArray.uint32[this._pos4+15]=t;}get textOffset0(){return this._structArray.float32[this._pos4+16]}get textOffset1(){return this._structArray.float32[this._pos4+17]}get collisionCircleDiameter(){return this._structArray.float32[this._pos4+18]}}Ua.prototype.size=76;class $a extends Ia{get(t){return new Ua(this,t)}}Zi("SymbolInstanceArray",$a);class Oa extends za{getoffsetX(t){return this.float32[1*t+0]}}Zi("GlyphOffsetArray",Oa);class ja extends Ma{getx(t){return this.int16[3*t+0]}gety(t){return this.int16[3*t+1]}gettileUnitDistanceFromAnchor(t){return this.int16[3*t+2]}}Zi("SymbolLineVertexArray",ja);class qa extends la{get featureIndex(){return this._structArray.uint32[this._pos4+0]}get sourceLayerIndex(){return this._structArray.uint16[this._pos2+2]}get bucketIndex(){return this._structArray.uint16[this._pos2+3]}get layoutVertexArrayOffset(){return this._structArray.uint16[this._pos2+4]}}qa.prototype.size=12;class Na extends Ba{get(t){return new qa(this,t)}}Zi("FeatureIndexArray",Na);class Ga extends la{get a_centroid_pos0(){return this._structArray.uint16[this._pos2+0]}get a_centroid_pos1(){return this._structArray.uint16[this._pos2+1]}}Ga.prototype.size=4;class Za extends Ca{get(t){return new Ga(this,t)}}Zi("FillExtrusionCentroidArray",Za);const Xa=ca([{name:"a_pattern_to",components:4,type:"Uint16"},{name:"a_pattern_from",components:4,type:"Uint16"},{name:"a_pixel_ratio_to",components:1,type:"Uint16"},{name:"a_pixel_ratio_from",components:1,type:"Uint16"}]),Ka=ca([{name:"a_dash_to",components:4,type:"Uint16"},{name:"a_dash_from",components:4,type:"Uint16"}]);var Ya=qe((function(t){t.exports=function(t,e){var r,n,i,s,a,o,l,u;for(n=t.length-(r=3&t.length),i=e,a=3432918353,o=461845907,u=0;u<n;)l=255&t.charCodeAt(u)|(255&t.charCodeAt(++u))<<8|(255&t.charCodeAt(++u))<<16|(255&t.charCodeAt(++u))<<24,++u,i=27492+(65535&(s=5*(65535&(i=(i^=l=(65535&(l=(l=(65535&l)*a+(((l>>>16)*a&65535)<<16)&4294967295)<<15|l>>>17))*o+(((l>>>16)*o&65535)<<16)&4294967295)<<13|i>>>19))+((5*(i>>>16)&65535)<<16)&4294967295))+((58964+(s>>>16)&65535)<<16);switch(l=0,r){case 3:l^=(255&t.charCodeAt(u+2))<<16;case 2:l^=(255&t.charCodeAt(u+1))<<8;case 1:i^=l=(65535&(l=(l=(65535&(l^=255&t.charCodeAt(u)))*a+(((l>>>16)*a&65535)<<16)&4294967295)<<15|l>>>17))*o+(((l>>>16)*o&65535)<<16)&4294967295;}return i^=t.length,i=2246822507*(65535&(i^=i>>>16))+((2246822507*(i>>>16)&65535)<<16)&4294967295,i=3266489909*(65535&(i^=i>>>13))+((3266489909*(i>>>16)&65535)<<16)&4294967295,(i^=i>>>16)>>>0};})),Ha=qe((function(t){t.exports=function(t,e){for(var r,n=t.length,i=e^n,s=0;n>=4;)r=1540483477*(65535&(r=255&t.charCodeAt(s)|(255&t.charCodeAt(++s))<<8|(255&t.charCodeAt(++s))<<16|(255&t.charCodeAt(++s))<<24))+((1540483477*(r>>>16)&65535)<<16),i=1540483477*(65535&i)+((1540483477*(i>>>16)&65535)<<16)^(r=1540483477*(65535&(r^=r>>>24))+((1540483477*(r>>>16)&65535)<<16)),n-=4,++s;switch(n){case 3:i^=(255&t.charCodeAt(s+2))<<16;case 2:i^=(255&t.charCodeAt(s+1))<<8;case 1:i=1540483477*(65535&(i^=255&t.charCodeAt(s)))+((1540483477*(i>>>16)&65535)<<16);}return i=1540483477*(65535&(i^=i>>>13))+((1540483477*(i>>>16)&65535)<<16),(i^=i>>>15)>>>0};})),Ja=Ya,Wa=Ha;Ja.murmur3=Ya,Ja.murmur2=Wa;class Qa{constructor(){this.ids=[],this.positions=[],this.indexed=!1;}add(t,e,r,n){this.ids.push(to(t)),this.positions.push(e,r,n);}getPositions(t){const e=to(t);let r=0,n=this.ids.length-1;for(;r<n;){const t=r+n>>1;this.ids[t]>=e?n=t:r=t+1;}const i=[];for(;this.ids[r]===e;)i.push({index:this.positions[3*r],start:this.positions[3*r+1],end:this.positions[3*r+2]}),r++;return i}static serialize(t,e){const r=new Float64Array(t.ids),n=new Uint32Array(t.positions);return eo(r,n,0,r.length-1),e&&e.push(r.buffer,n.buffer),{ids:r,positions:n}}static deserialize(t){const e=new Qa;return e.ids=t.ids,e.positions=t.positions,e.indexed=!0,e}}function to(t){const e=+t;return !isNaN(e)&&Number.MIN_SAFE_INTEGER<=e&&e<=Number.MAX_SAFE_INTEGER?e:Ja(String(t))}function eo(t,e,r,n){for(;r<n;){const i=t[r+n>>1];let s=r-1,a=n+1;for(;;){do{s++;}while(t[s]<i);do{a--;}while(t[a]>i);if(s>=a)break;ro(t,s,a),ro(e,3*s,3*a),ro(e,3*s+1,3*a+1),ro(e,3*s+2,3*a+2);}a-r<n-a?(eo(t,e,r,a),r=a+1):(eo(t,e,a+1,n),n=a);}}function ro(t,e,r){const n=t[e];t[e]=t[r],t[r]=n;}Zi("FeaturePositionMap",Qa);class no{constructor(t,e){this.gl=t.gl,this.location=e;}}class io extends no{constructor(t,e){super(t,e),this.current=0;}set(t){this.current!==t&&(this.current=t,this.gl.uniform1f(this.location,t));}}class so extends no{constructor(t,e){super(t,e),this.current=[0,0,0,0];}set(t){t[0]===this.current[0]&&t[1]===this.current[1]&&t[2]===this.current[2]&&t[3]===this.current[3]||(this.current=t,this.gl.uniform4f(this.location,t[0],t[1],t[2],t[3]));}}class ao extends no{constructor(t,e){super(t,e),this.current=Ge.transparent;}set(t){t.r===this.current.r&&t.g===this.current.g&&t.b===this.current.b&&t.a===this.current.a||(this.current=t,this.gl.uniform4f(this.location,t.r,t.g,t.b,t.a));}}const oo=new Float32Array(16),lo=new Float32Array(9),uo=new Float32Array(4);function co(t){return [aa(255*t.r,255*t.g),aa(255*t.b,255*t.a)]}class ho{constructor(t,e,r){this.value=t,this.uniformNames=e.map((t=>`u_${t}`)),this.type=r;}setUniform(t,e,r){t.set(r.constantOr(this.value));}getBinding(t,e,r){return "color"===this.type?new ao(t,e):new io(t,e)}}class po{constructor(t,e){this.uniformNames=e.map((t=>`u_${t}`)),this.patternFrom=null,this.patternTo=null,this.pixelRatioFrom=1,this.pixelRatioTo=1;}setConstantPatternPositions(t,e){this.pixelRatioFrom=e.pixelRatio,this.pixelRatioTo=t.pixelRatio,this.patternFrom=e.tl.concat(e.br),this.patternTo=t.tl.concat(t.br);}setUniform(t,e,r,n){const i="u_pattern_to"===n||"u_dash_to"===n?this.patternTo:"u_pattern_from"===n||"u_dash_from"===n?this.patternFrom:"u_pixel_ratio_to"===n?this.pixelRatioTo:"u_pixel_ratio_from"===n?this.pixelRatioFrom:null;i&&t.set(i);}getBinding(t,e,r){return "u_pattern_from"===r||"u_pattern_to"===r||"u_dash_from"===r||"u_dash_to"===r?new so(t,e):new io(t,e)}}class fo{constructor(t,e,r,n){this.expression=t,this.type=r,this.maxValue=0,this.paintVertexAttributes=e.map((t=>({name:`a_${t}`,type:"Float32",components:"color"===r?2:1,offset:0}))),this.paintVertexArray=new n;}populatePaintArray(t,e,r,n,i,s){const a=this.paintVertexArray.length,o=this.expression.evaluate(new Gs(0),e,{},i,n,s);this.paintVertexArray.resize(t),this._setPaintValue(a,t,o);}updatePaintArray(t,e,r,n,i){const s=this.expression.evaluate({zoom:0},r,n,void 0,i);this._setPaintValue(t,e,s);}_setPaintValue(t,e,r){if("color"===this.type){const n=co(r);for(let r=t;r<e;r++)this.paintVertexArray.emplace(r,n[0],n[1]);}else {for(let n=t;n<e;n++)this.paintVertexArray.emplace(n,r);this.maxValue=Math.max(this.maxValue,Math.abs(r));}}upload(t){this.paintVertexArray&&this.paintVertexArray.arrayBuffer&&(this.paintVertexBuffer&&this.paintVertexBuffer.buffer?this.paintVertexBuffer.updateData(this.paintVertexArray):this.paintVertexBuffer=t.createVertexBuffer(this.paintVertexArray,this.paintVertexAttributes,this.expression.isStateDependent));}destroy(){this.paintVertexBuffer&&this.paintVertexBuffer.destroy();}}class yo{constructor(t,e,r,n,i,s){this.expression=t,this.uniformNames=e.map((t=>`u_${t}_t`)),this.type=r,this.useIntegerZoom=n,this.zoom=i,this.maxValue=0,this.paintVertexAttributes=e.map((t=>({name:`a_${t}`,type:"Float32",components:"color"===r?4:2,offset:0}))),this.paintVertexArray=new s;}populatePaintArray(t,e,r,n,i,s){const a=this.expression.evaluate(new Gs(this.zoom),e,{},i,n,s),o=this.expression.evaluate(new Gs(this.zoom+1),e,{},i,n,s),l=this.paintVertexArray.length;this.paintVertexArray.resize(t),this._setPaintValue(l,t,a,o);}updatePaintArray(t,e,r,n,i){const s=this.expression.evaluate({zoom:this.zoom},r,n,void 0,i),a=this.expression.evaluate({zoom:this.zoom+1},r,n,void 0,i);this._setPaintValue(t,e,s,a);}_setPaintValue(t,e,r,n){if("color"===this.type){const i=co(r),s=co(n);for(let r=t;r<e;r++)this.paintVertexArray.emplace(r,i[0],i[1],s[0],s[1]);}else {for(let i=t;i<e;i++)this.paintVertexArray.emplace(i,r,n);this.maxValue=Math.max(this.maxValue,Math.abs(r),Math.abs(n));}}upload(t){this.paintVertexArray&&this.paintVertexArray.arrayBuffer&&(this.paintVertexBuffer&&this.paintVertexBuffer.buffer?this.paintVertexBuffer.updateData(this.paintVertexArray):this.paintVertexBuffer=t.createVertexBuffer(this.paintVertexArray,this.paintVertexAttributes,this.expression.isStateDependent));}destroy(){this.paintVertexBuffer&&this.paintVertexBuffer.destroy();}setUniform(t,e){const r=this.useIntegerZoom?Math.floor(e.zoom):e.zoom,n=Y(this.expression.interpolationFactor(r,this.zoom,this.zoom+1),0,1);t.set(n);}getBinding(t,e,r){return new io(t,e)}}class mo{constructor(t,e,r,n,i,s,a){this.expression=t,this.type=r,this.useIntegerZoom=n,this.zoom=i,this.layerId=a,this.paintVertexAttributes=("array"===r?Ka:Xa).members;for(let t=0;t<e.length;++t);this.zoomInPaintVertexArray=new s,this.zoomOutPaintVertexArray=new s;}populatePaintArray(t,e,r){const n=this.zoomInPaintVertexArray.length;this.zoomInPaintVertexArray.resize(t),this.zoomOutPaintVertexArray.resize(t),this._setPaintValues(n,t,e.patterns&&e.patterns[this.layerId],r);}updatePaintArray(t,e,r,n,i,s){this._setPaintValues(t,e,r.patterns&&r.patterns[this.layerId],s);}_setPaintValues(t,e,r,n){if(!n||!r)return;const{min:i,mid:s,max:a}=r,o=n[i],l=n[s],u=n[a];if(o&&l&&u)for(let r=t;r<e;r++)this._setPaintValue(this.zoomInPaintVertexArray,r,l,o),this._setPaintValue(this.zoomOutPaintVertexArray,r,l,u);}_setPaintValue(t,e,r,n){t.emplace(e,r.tl[0],r.tl[1],r.br[0],r.br[1],n.tl[0],n.tl[1],n.br[0],n.br[1],r.pixelRatio,n.pixelRatio);}upload(t){this.zoomInPaintVertexArray&&this.zoomInPaintVertexArray.arrayBuffer&&this.zoomOutPaintVertexArray&&this.zoomOutPaintVertexArray.arrayBuffer&&(this.zoomInPaintVertexBuffer=t.createVertexBuffer(this.zoomInPaintVertexArray,this.paintVertexAttributes,this.expression.isStateDependent),this.zoomOutPaintVertexBuffer=t.createVertexBuffer(this.zoomOutPaintVertexArray,this.paintVertexAttributes,this.expression.isStateDependent));}destroy(){this.zoomOutPaintVertexBuffer&&this.zoomOutPaintVertexBuffer.destroy(),this.zoomInPaintVertexBuffer&&this.zoomInPaintVertexBuffer.destroy();}}class go{constructor(t,e,r=(()=>!0)){this.binders={},this._buffers=[];const n=[];for(const i in t.paint._values){if(!r(i))continue;const s=t.paint.get(i);if(!(s instanceof Ws&&Cn(s.property.specification)))continue;const a=bo(i,t.type),o=s.value,l=s.property.specification.type,u=s.property.useIntegerZoom,c=s.property.specification["property-type"],h="cross-faded"===c||"cross-faded-data-driven"===c,p="line-dasharray"===String(i)&&"constant"!==t.layout.get("line-cap").value.kind;if("constant"!==o.kind||p)if("source"===o.kind||p||h){const r=Ao(i,l,"source");this.binders[i]=h?new mo(o,a,l,u,e,r,t.id):new fo(o,a,l,r),n.push(`/a_${i}`);}else {const t=Ao(i,l,"composite");this.binders[i]=new yo(o,a,l,u,e,t),n.push(`/z_${i}`);}else this.binders[i]=h?new po(o.value,a):new ho(o.value,a,l),n.push(`/u_${i}`);}this.cacheKey=n.sort().join("");}getMaxValue(t){const e=this.binders[t];return e instanceof fo||e instanceof yo?e.maxValue:0}populatePaintArrays(t,e,r,n,i,s){for(const a in this.binders){const o=this.binders[a];(o instanceof fo||o instanceof yo||o instanceof mo)&&o.populatePaintArray(t,e,r,n,i,s);}}setConstantPatternPositions(t,e){for(const r in this.binders){const n=this.binders[r];n instanceof po&&n.setConstantPatternPositions(t,e);}}updatePaintArrays(t,e,r,n,i,s){let a=!1;for(const o in t){const l=e.getPositions(o);for(const e of l){const l=r.feature(e.index);for(const r in this.binders){const u=this.binders[r];if((u instanceof fo||u instanceof yo||u instanceof mo)&&!0===u.expression.isStateDependent){const c=n.paint.get(r);u.expression=c.value,u.updatePaintArray(e.start,e.end,l,t[o],i,s),a=!0;}}}}return a}defines(){const t=[];for(const e in this.binders){const r=this.binders[e];(r instanceof ho||r instanceof po)&&t.push(...r.uniformNames.map((t=>`#define HAS_UNIFORM_${t}`)));}return t}getBinderAttributes(){const t=[];for(const e in this.binders){const r=this.binders[e];if(r instanceof fo||r instanceof yo||r instanceof mo)for(let e=0;e<r.paintVertexAttributes.length;e++)t.push(r.paintVertexAttributes[e].name);}return t}getBinderUniforms(){const t=[];for(const e in this.binders){const r=this.binders[e];if(r instanceof ho||r instanceof po||r instanceof yo)for(const e of r.uniformNames)t.push(e);}return t}getPaintVertexBuffers(){return this._buffers}getUniforms(t,e){const r=[];for(const n in this.binders){const i=this.binders[n];if(i instanceof ho||i instanceof po||i instanceof yo)for(const s of i.uniformNames)if(e[s]){const a=i.getBinding(t,e[s],s);r.push({name:s,property:n,binding:a});}}return r}setUniforms(t,e,r,n){for(const{name:t,property:i,binding:s}of e)this.binders[i].setUniform(s,n,r.get(i),t);}updatePaintBuffers(t){this._buffers=[];for(const e in this.binders){const r=this.binders[e];if(t&&r instanceof mo){const e=2===t.fromScale?r.zoomInPaintVertexBuffer:r.zoomOutPaintVertexBuffer;e&&this._buffers.push(e);}else (r instanceof fo||r instanceof yo)&&r.paintVertexBuffer&&this._buffers.push(r.paintVertexBuffer);}}upload(t){for(const e in this.binders){const r=this.binders[e];(r instanceof fo||r instanceof yo||r instanceof mo)&&r.upload(t);}this.updatePaintBuffers();}destroy(){for(const t in this.binders){const e=this.binders[t];(e instanceof fo||e instanceof yo||e instanceof mo)&&e.destroy();}}}class xo{constructor(t,e,r=(()=>!0)){this.programConfigurations={};for(const n of t)this.programConfigurations[n.id]=new go(n,e,r);this.needsUpload=!1,this._featureMap=new Qa,this._bufferOffset=0;}populatePaintArrays(t,e,r,n,i,s,a){for(const r in this.programConfigurations)this.programConfigurations[r].populatePaintArrays(t,e,n,i,s,a);void 0!==e.id&&this._featureMap.add(e.id,r,this._bufferOffset,t),this._bufferOffset=t,this.needsUpload=!0;}updatePaintArrays(t,e,r,n,i){for(const s of r)this.needsUpload=this.programConfigurations[s.id].updatePaintArrays(t,this._featureMap,e,s,n,i)||this.needsUpload;}get(t){return this.programConfigurations[t]}upload(t){if(this.needsUpload){for(const e in this.programConfigurations)this.programConfigurations[e].upload(t);this.needsUpload=!1;}}destroy(){for(const t in this.programConfigurations)this.programConfigurations[t].destroy();}}const vo={"text-opacity":["opacity"],"icon-opacity":["opacity"],"text-color":["fill_color"],"icon-color":["fill_color"],"text-halo-color":["halo_color"],"icon-halo-color":["halo_color"],"text-halo-blur":["halo_blur"],"icon-halo-blur":["halo_blur"],"text-halo-width":["halo_width"],"icon-halo-width":["halo_width"],"line-gap-width":["gapwidth"],"line-pattern":["pattern_to","pattern_from","pixel_ratio_to","pixel_ratio_from"],"fill-pattern":["pattern_to","pattern_from","pixel_ratio_to","pixel_ratio_from"],"fill-extrusion-pattern":["pattern_to","pattern_from","pixel_ratio_to","pixel_ratio_from"],"line-dasharray":["dash_to","dash_from"]};function bo(t,e){return vo[t]||[t.replace(`${e}-`,"").replace(/-/g,"_")]}const wo={"line-pattern":{source:ma,composite:ma},"fill-pattern":{source:ma,composite:ma},"fill-extrusion-pattern":{source:ma,composite:ma},"line-dasharray":{source:ga,composite:ga}},_o={color:{source:Ea,composite:Da},number:{source:za,composite:Ea}};function Ao(t,e,r){const n=wo[t];return n&&n[r]||_o[e][r]}Zi("ConstantBinder",ho),Zi("CrossFadedConstantBinder",po),Zi("SourceExpressionBinder",fo),Zi("CrossFadedCompositeBinder",mo),Zi("CompositeExpressionBinder",yo),Zi("ProgramConfiguration",go,{omit:["_buffers"]}),Zi("ProgramConfigurationSet",xo);const ko="-transition";class So extends xe{constructor(t,e){if(super(),this.id=t.id,this.type=t.type,this._featureFilter={filter:()=>!0,needGeometry:!1,needFeature:!1},this._filterCompiled=!1,"custom"!==t.type&&(this.metadata=(t=t).metadata,this.minzoom=t.minzoom,this.maxzoom=t.maxzoom,"background"!==t.type&&"sky"!==t.type&&(this.source=t.source,this.sourceLayer=t["source-layer"],this.filter=t.filter),e.layout&&(this._unevaluatedLayout=new Js(e.layout)),e.paint)){this._transitionablePaint=new Ks(e.paint);for(const e in t.paint)this.setPaintProperty(e,t.paint[e],{validate:!1});for(const e in t.layout)this.setLayoutProperty(e,t.layout[e],{validate:!1});this._transitioningPaint=this._transitionablePaint.untransitioned(),this.paint=new Qs(e.paint);}}getCrossfadeParameters(){return this._crossfadeParameters}getLayoutProperty(t){return "visibility"===t?this.visibility:this._unevaluatedLayout.getValue(t)}setLayoutProperty(t,e,r={}){null!=e&&this._validate(Ui,`layers.${this.id}.layout.${t}`,t,e,r)||("visibility"!==t?this._unevaluatedLayout.setValue(t,e):this.visibility=e);}getPaintProperty(t){return ot(t,ko)?this._transitionablePaint.getTransition(t.slice(0,-ko.length)):this._transitionablePaint.getValue(t)}setPaintProperty(t,e,r={}){if(null!=e&&this._validate(Ri,`layers.${this.id}.paint.${t}`,t,e,r))return !1;if(ot(t,ko))return this._transitionablePaint.setTransition(t.slice(0,-ko.length),e||void 0),!1;{const r=this._transitionablePaint._values[t],n="cross-faded-data-driven"===r.property.specification["property-type"],i=r.value.isDataDriven(),s=r.value;this._transitionablePaint.setValue(t,e),this._handleSpecialPaintPropertyUpdate(t);const a=this._transitionablePaint._values[t].value;return a.isDataDriven()||i||n||this._handleOverridablePaintPropertyUpdate(t,s,a)}}_handleSpecialPaintPropertyUpdate(t){}getProgramIds(){return null}getProgramConfiguration(t){return null}_handleOverridablePaintPropertyUpdate(t,e,r){return !1}isHidden(t){return !!(this.minzoom&&t<this.minzoom)||!!(this.maxzoom&&t>=this.maxzoom)||"none"===this.visibility}updateTransitions(t){this._transitioningPaint=this._transitionablePaint.transitioned(t,this._transitioningPaint);}hasTransition(){return this._transitioningPaint.hasTransition()}recalculate(t,e){t.getCrossfadeParameters&&(this._crossfadeParameters=t.getCrossfadeParameters()),this._unevaluatedLayout&&(this.layout=this._unevaluatedLayout.possiblyEvaluate(t,void 0,e)),this.paint=this._transitioningPaint.possiblyEvaluate(t,void 0,e);}serialize(){const t={id:this.id,type:this.type,source:this.source,"source-layer":this.sourceLayer,metadata:this.metadata,minzoom:this.minzoom,maxzoom:this.maxzoom,filter:this.filter,layout:this._unevaluatedLayout&&this._unevaluatedLayout.serialize(),paint:this._transitionablePaint&&this._transitionablePaint.serialize()};return this.visibility&&(t.layout=t.layout||{},t.layout.visibility=this.visibility),ut(t,((t,e)=>!(void 0===t||"layout"===e&&!Object.keys(t).length||"paint"===e&&!Object.keys(t).length)))}_validate(t,e,r,n,i={}){return (!i||!1!==i.validate)&&$i(this,t.call(Vi,{key:e,layerType:this.type,objectKey:r,value:n,styleSpec:ve,style:{glyphs:!0,sprite:!0}}))}is3D(){return !1}isSky(){return !1}isTileClipped(){return !1}hasOffscreenPass(){return !1}resize(){}isStateDependent(){for(const t in this.paint._values){const e=this.paint.get(t);if(e instanceof Ws&&Cn(e.property.specification)&&("source"===e.value.kind||"composite"===e.value.kind)&&e.value.isStateDependent)return !0}return !1}compileFilter(){this._filterCompiled||(this._featureFilter=si(this.filter),this._filterCompiled=!0);}invalidateCompiledFilter(){this._filterCompiled=!1;}dynamicFilter(){return this._featureFilter.dynamicFilter}dynamicFilterNeedsFeature(){return this._featureFilter.needFeature}}const Io=ca([{name:"a_pos",components:2,type:"Int16"}],4),{members:zo}=Io;class Mo{constructor(t=[]){this.segments=t;}prepareSegment(t,e,r,n){let i=this.segments[this.segments.length-1];return t>Mo.MAX_VERTEX_ARRAY_LENGTH&&pt(`Max vertices per segment is ${Mo.MAX_VERTEX_ARRAY_LENGTH}: bucket requested ${t}`),(!i||i.vertexLength+t>Mo.MAX_VERTEX_ARRAY_LENGTH||i.sortKey!==n)&&(i={vertexOffset:e.length,primitiveOffset:r.length,vertexLength:0,primitiveLength:0},void 0!==n&&(i.sortKey=n),this.segments.push(i)),i}get(){return this.segments}destroy(){for(const t of this.segments)for(const e in t.vaos)t.vaos[e].destroy();}static simpleSegment(t,e,r,n){return new Mo([{vertexOffset:t,primitiveOffset:e,vertexLength:r,primitiveLength:n,vaos:{},sortKey:0}])}}Mo.MAX_VERTEX_ARRAY_LENGTH=Math.pow(2,16)-1,Zi("SegmentVector",Mo);var To=8192;class Bo{constructor(t,e){t&&(e?this.setSouthWest(t).setNorthEast(e):4===t.length?this.setSouthWest([t[0],t[1]]).setNorthEast([t[2],t[3]]):this.setSouthWest(t[0]).setNorthEast(t[1]));}setNorthEast(t){return this._ne=t instanceof Po?new Po(t.lng,t.lat):Po.convert(t),this}setSouthWest(t){return this._sw=t instanceof Po?new Po(t.lng,t.lat):Po.convert(t),this}extend(t){const e=this._sw,r=this._ne;let n,i;if(t instanceof Po)n=t,i=t;else {if(!(t instanceof Bo))return Array.isArray(t)?4===t.length||t.every(Array.isArray)?this.extend(Bo.convert(t)):this.extend(Po.convert(t)):this;if(n=t._sw,i=t._ne,!n||!i)return this}return e||r?(e.lng=Math.min(n.lng,e.lng),e.lat=Math.min(n.lat,e.lat),r.lng=Math.max(i.lng,r.lng),r.lat=Math.max(i.lat,r.lat)):(this._sw=new Po(n.lng,n.lat),this._ne=new Po(i.lng,i.lat)),this}getCenter(){return new Po((this._sw.lng+this._ne.lng)/2,(this._sw.lat+this._ne.lat)/2)}getSouthWest(){return this._sw}getNorthEast(){return this._ne}getNorthWest(){return new Po(this.getWest(),this.getNorth())}getSouthEast(){return new Po(this.getEast(),this.getSouth())}getWest(){return this._sw.lng}getSouth(){return this._sw.lat}getEast(){return this._ne.lng}getNorth(){return this._ne.lat}toArray(){return [this._sw.toArray(),this._ne.toArray()]}toString(){return `LngLatBounds(${this._sw.toString()}, ${this._ne.toString()})`}isEmpty(){return !(this._sw&&this._ne)}contains(t){const{lng:e,lat:r}=Po.convert(t);let n=this._sw.lng<=e&&e<=this._ne.lng;return this._sw.lng>this._ne.lng&&(n=this._sw.lng>=e&&e>=this._ne.lng),this._sw.lat<=r&&r<=this._ne.lat&&n}static convert(t){return !t||t instanceof Bo?t:new Bo(t)}}const Co=6371008.8;class Po{constructor(t,e){if(isNaN(t)||isNaN(e))throw new Error(`Invalid LngLat object: (${t}, ${e})`);if(this.lng=+t,this.lat=+e,this.lat>90||this.lat<-90)throw new Error("Invalid LngLat latitude value: must be between -90 and 90")}wrap(){return new Po(J(this.lng,-180,180),this.lat)}toArray(){return [this.lng,this.lat]}toString(){return `LngLat(${this.lng}, ${this.lat})`}distanceTo(t){const e=Math.PI/180,r=this.lat*e,n=t.lat*e,i=Math.sin(r)*Math.sin(n)+Math.cos(r)*Math.cos(n)*Math.cos((t.lng-this.lng)*e);return Co*Math.acos(Math.min(i,1))}toBounds(t=0){const e=360*t/40075017,r=e/Math.cos(Math.PI/180*this.lat);return new Bo(new Po(this.lng-r,this.lat-e),new Po(this.lng+r,this.lat+e))}static convert(t){if(t instanceof Po)return t;if(Array.isArray(t)&&(2===t.length||3===t.length))return new Po(Number(t[0]),Number(t[1]));if(!Array.isArray(t)&&"object"==typeof t&&null!==t)return new Po(Number("lng"in t?t.lng:t.lon),Number(t.lat));throw new Error("`LngLatLike` argument must be specified as a LngLat instance, an object {lng: <lng>, lat: <lat>}, an object {lon: <lng>, lat: <lat>}, or an array of [<lng>, <lat>]")}}const Eo=2*Math.PI*Co;function Do(t){return Eo*Math.cos(t*Math.PI/180)}function Vo(t){return (180+t)/360}function Fo(t){return (180-180/Math.PI*Math.log(Math.tan(Math.PI/4+t*Math.PI/360)))/360}function Lo(t,e){return t/Do(e)}function Ro(t){return 360*t-180}function Uo(t){return 360/Math.PI*Math.atan(Math.exp((180-360*t)*Math.PI/180))-90}function $o(t,e){return t*Do(Uo(e))}const Oo=85.051129;class jo{constructor(t,e,r=0){this.x=+t,this.y=+e,this.z=+r;}static fromLngLat(t,e=0){const r=Po.convert(t);return new jo(Vo(r.lng),Fo(r.lat),Lo(e,r.lat))}toLngLat(){return new Po(Ro(this.x),Uo(this.y))}toAltitude(){return $o(this.z,this.y)}meterInMercatorCoordinateUnits(){return 1/Eo*(t=Uo(this.y),1/Math.cos(t*Math.PI/180));var t;}}function qo(t,e,r,n,s,a,o,l,u){const c=(e+n)/2,h=(r+s)/2,p=new i(c,h);l(p),function(t,e,r,n,i,s){const a=r-i,o=n-s;return Math.abs((n-e)*a-(r-t)*o)/Math.hypot(a,o)}(p.x,p.y,a.x,a.y,o.x,o.y)>=u?(qo(t,e,r,c,h,a,p,l,u),qo(t,c,h,n,s,p,o,l,u)):t.push(o);}function No(t,e,r){const n=[];let i,s,a;for(const o of t){const{x:t,y:l}=o;e(o),a?qo(n,i,s,t,l,a,o,e,r):n.push(o),i=t,s=l,a=o;}return n}const Go=Math.pow(2,14)-1,Zo=-Go-1;function Xo(t,e){const r=Math.round(t.x*e),n=Math.round(t.y*e);return t.x=Y(r,Zo,Go),t.y=Y(n,Zo,Go),(r<t.x||r>t.x+1||n<t.y||n>t.y+1)&&pt("Geometry exceeds allowed extent, reduce your vector tile buffer size"),t}function Ko(t,e,r){const n=t.loadGeometry(),i=t.extent,s=To/i;if(e&&r&&r.projection.isReprojectedInTileSpace){const s=1<<e.z,{scale:a,x:o,y:l,projection:u}=r,c=t=>{const r=Ro((e.x+t.x/i)/s),n=Uo((e.y+t.y/i)/s),c=u.project(r,n);t.x=(c.x*a-o)*i,t.y=(c.y*a-l)*i;};for(let e=0;e<n.length;e++)if(1!==t.type)n[e]=No(n[e],c,1);else {const t=[];for(const r of n[e])r.x<0||r.x>=i||r.y<0||r.y>=i||(c(r),t.push(r));n[e]=t;}}for(const t of n)for(const e of t)Xo(e,s);return n}function Yo(t,e){return {type:t.type,id:t.id,properties:t.properties,geometry:e?Ko(t):[]}}function Ho(t,e,r,n,i){t.emplaceBack(2*e+(n+1)/2,2*r+(i+1)/2);}class Jo{constructor(t){this.zoom=t.zoom,this.overscaling=t.overscaling,this.layers=t.layers,this.layerIds=this.layers.map((t=>t.id)),this.index=t.index,this.hasPattern=!1,this.layoutVertexArray=new pa,this.indexArray=new ka,this.segments=new Mo,this.programConfigurations=new xo(t.layers,t.zoom),this.stateDependentLayerIds=this.layers.filter((t=>t.isStateDependent())).map((t=>t.id));}populate(t,e,r,n){const i=this.layers[0],s=[];let a=null;"circle"===i.type&&(a=i.layout.get("circle-sort-key"));for(const{feature:e,id:i,index:o,sourceLayerIndex:l}of t){const t=this.layers[0]._featureFilter.needGeometry,u=Yo(e,t);if(!this.layers[0]._featureFilter.filter(new Gs(this.zoom),u,r))continue;const c=a?a.evaluate(u,{},r):void 0,h={id:i,properties:e.properties,type:e.type,sourceLayerIndex:l,index:o,geometry:t?u.geometry:Ko(e,r,n),patterns:{},sortKey:c};s.push(h);}a&&s.sort(((t,e)=>t.sortKey-e.sortKey));for(const n of s){const{geometry:i,index:s,sourceLayerIndex:a}=n,o=t[s].feature;this.addFeature(n,i,s,e.availableImages,r),e.featureIndex.insert(o,i,s,a,this.index);}}update(t,e,r,n){this.stateDependentLayers.length&&this.programConfigurations.updatePaintArrays(t,e,this.stateDependentLayers,r,n);}isEmpty(){return 0===this.layoutVertexArray.length}uploadPending(){return !this.uploaded||this.programConfigurations.needsUpload}upload(t){this.uploaded||(this.layoutVertexBuffer=t.createVertexBuffer(this.layoutVertexArray,zo),this.indexBuffer=t.createIndexBuffer(this.indexArray)),this.programConfigurations.upload(t),this.uploaded=!0;}destroy(){this.layoutVertexBuffer&&(this.layoutVertexBuffer.destroy(),this.indexBuffer.destroy(),this.programConfigurations.destroy(),this.segments.destroy());}addFeature(t,e,r,n,i){for(const r of e)for(const e of r){const r=e.x,n=e.y;if(r<0||r>=To||n<0||n>=To)continue;const i=this.segments.prepareSegment(4,this.layoutVertexArray,this.indexArray,t.sortKey),s=i.vertexLength;Ho(this.layoutVertexArray,r,n,-1,-1),Ho(this.layoutVertexArray,r,n,1,-1),Ho(this.layoutVertexArray,r,n,1,1),Ho(this.layoutVertexArray,r,n,-1,1),this.indexArray.emplaceBack(s,s+1,s+2),this.indexArray.emplaceBack(s,s+3,s+2),i.vertexLength+=4,i.primitiveLength+=2;}this.programConfigurations.populatePaintArrays(this.layoutVertexArray.length,t,r,{},n,i);}}function Wo(t,e){for(let r=0;r<t.length;r++)if(ol(e,t[r]))return !0;for(let r=0;r<e.length;r++)if(ol(t,e[r]))return !0;return !!rl(t,e)}function Qo(t,e,r){return !!ol(t,e)||!!il(e,t,r)}function tl(t,e){if(1===t.length)return al(e,t[0]);for(let r=0;r<e.length;r++){const n=e[r];for(let e=0;e<n.length;e++)if(ol(t,n[e]))return !0}for(let r=0;r<t.length;r++)if(al(e,t[r]))return !0;for(let r=0;r<e.length;r++)if(rl(t,e[r]))return !0;return !1}function el(t,e,r){if(t.length>1){if(rl(t,e))return !0;for(let n=0;n<e.length;n++)if(il(e[n],t,r))return !0}for(let n=0;n<t.length;n++)if(il(t[n],e,r))return !0;return !1}function rl(t,e){if(0===t.length||0===e.length)return !1;for(let r=0;r<t.length-1;r++){const n=t[r],i=t[r+1];for(let t=0;t<e.length-1;t++)if(nl(n,i,e[t],e[t+1]))return !0}return !1}function nl(t,e,r,n){return dt(t,r,n)!==dt(e,r,n)&&dt(t,e,r)!==dt(t,e,n)}function il(t,e,r){const n=r*r;if(1===e.length)return t.distSqr(e[0])<n;for(let r=1;r<e.length;r++)if(sl(t,e[r-1],e[r])<n)return !0;return !1}function sl(t,e,r){const n=e.distSqr(r);if(0===n)return t.distSqr(e);const i=((t.x-e.x)*(r.x-e.x)+(t.y-e.y)*(r.y-e.y))/n;return t.distSqr(i<0?e:i>1?r:r.sub(e)._mult(i)._add(e))}function al(t,e){let r,n,i,s=!1;for(let a=0;a<t.length;a++){r=t[a];for(let t=0,a=r.length-1;t<r.length;a=t++)n=r[t],i=r[a],n.y>e.y!=i.y>e.y&&e.x<(i.x-n.x)*(e.y-n.y)/(i.y-n.y)+n.x&&(s=!s);}return s}function ol(t,e){let r=!1;for(let n=0,i=t.length-1;n<t.length;i=n++){const s=t[n],a=t[i];s.y>e.y!=a.y>e.y&&e.x<(a.x-s.x)*(e.y-s.y)/(a.y-s.y)+s.x&&(r=!r);}return r}function ll(t,e,r,n,s){for(const i of t)if(e<=i.x&&r<=i.y&&n>=i.x&&s>=i.y)return !0;const a=[new i(e,r),new i(e,s),new i(n,s),new i(n,r)];if(t.length>2)for(const e of a)if(ol(t,e))return !0;for(let e=0;e<t.length-1;e++)if(ul(t[e],t[e+1],a))return !0;return !1}function ul(t,e,r){const n=r[0],i=r[2];if(t.x<n.x&&e.x<n.x||t.x>i.x&&e.x>i.x||t.y<n.y&&e.y<n.y||t.y>i.y&&e.y>i.y)return !1;const s=dt(t,e,r[0]);return s!==dt(t,e,r[1])||s!==dt(t,e,r[2])||s!==dt(t,e,r[3])}function cl(t,e,r){const n=e.paint.get(t).value;return "constant"===n.kind?n.value:r.programConfigurations.get(e.id).getMaxValue(t)}function hl(t){return Math.sqrt(t[0]*t[0]+t[1]*t[1])}function pl(t,e,r,n,s){if(!e[0]&&!e[1])return t;const a=i.convert(e)._mult(s);"viewport"===r&&a._rotate(-n);const o=[];for(let e=0;e<t.length;e++)o.push(t[e].sub(a));return o}function dl(t,e,r,n){const s=i.convert(t)._mult(n);return "viewport"===e&&s._rotate(-r),s}Zi("CircleBucket",Jo,{omit:["layers"]});const fl=new sa({"circle-sort-key":new ea(ve.layout_circle["circle-sort-key"])});var yl={paint:new sa({"circle-radius":new ea(ve.paint_circle["circle-radius"]),"circle-color":new ea(ve.paint_circle["circle-color"]),"circle-blur":new ea(ve.paint_circle["circle-blur"]),"circle-opacity":new ea(ve.paint_circle["circle-opacity"]),"circle-translate":new ta(ve.paint_circle["circle-translate"]),"circle-translate-anchor":new ta(ve.paint_circle["circle-translate-anchor"]),"circle-pitch-scale":new ta(ve.paint_circle["circle-pitch-scale"]),"circle-pitch-alignment":new ta(ve.paint_circle["circle-pitch-alignment"]),"circle-stroke-width":new ea(ve.paint_circle["circle-stroke-width"]),"circle-stroke-color":new ea(ve.paint_circle["circle-stroke-color"]),"circle-stroke-opacity":new ea(ve.paint_circle["circle-stroke-opacity"])}),layout:fl};class ml{constructor(t,e){this.points=t,this.planes=e;}static fromInvProjectionMatrix(t,e,r,n){const i=Math.pow(2,r),s=[[-1,1,-1,1],[1,1,-1,1],[1,-1,-1,1],[-1,-1,-1,1],[-1,1,1,1],[1,1,1,1],[1,-1,1,1],[-1,-1,1,1]].map((r=>{const s=F([],r,t),a=1/s[3]/e*i;return function(t,e,r){return t[0]=e[0]*r[0],t[1]=e[1]*r[1],t[2]=e[2]*r[2],t[3]=e[3]*r[3],t}(s,s,[a,a,n?1/s[3]:a,a])})),a=[[0,1,2],[6,5,4],[0,3,7],[2,1,5],[3,2,6],[0,4,5]].map((t=>{const e=z([],T([],E([],s[t[0]],s[t[1]]),E([],s[t[2]],s[t[1]]))),r=-M(e,s[t[1]]);return e.concat(r)}));return new ml(s,a)}}class gl{constructor(t,e){this.min=t,this.max=e,this.center=S([],w([],this.min,this.max),.5);}quadrant(t){const e=[t%2==0,t<2],r=x(this.min),n=x(this.max);for(let t=0;t<e.length;t++)r[t]=e[t]?this.min[t]:this.center[t],n[t]=e[t]?this.center[t]:this.max[t];return n[2]=this.max[2],new gl(r,n)}distanceX(t){return Math.max(Math.min(this.max[0],t[0]),this.min[0])-t[0]}distanceY(t){return Math.max(Math.min(this.max[1],t[1]),this.min[1])-t[1]}distanceZ(t){return Math.max(Math.min(this.max[2],t[2]),this.min[2])-t[2]}getCorners(){const t=this.min,e=this.max;return [[t[0],t[1],t[2]],[e[0],t[1],t[2]],[e[0],e[1],t[2]],[t[0],e[1],t[2]],[t[0],t[1],e[2]],[e[0],t[1],e[2]],[e[0],e[1],e[2]],[t[0],e[1],e[2]]]}intersects(t){const e=this.getCorners();let r=!0;for(let n=0;n<t.planes.length;n++){const i=t.planes[n];let s=0;for(let t=0;t<e.length;t++)s+=M(i,e[t])+i[3]>=0;if(0===s)return 0;s!==e.length&&(r=!1);}if(r)return 2;for(let e=0;e<3;e++){let r=Number.MAX_VALUE,n=-Number.MAX_VALUE;for(let i=0;i<t.points.length;i++){const s=t.points[i][e]-this.min[e];r=Math.min(r,s),n=Math.max(n,s);}if(n<0||r>this.max[e]-this.min[e])return 0}return 1}}function xl(t,e,r,n,i,s,a,o,l){if(s&&t.queryGeometry.isAboveHorizon)return !1;s&&(l*=t.pixelToTileUnitsFactor);for(const u of e)for(const e of u){const u=e.add(o),c=i&&r.elevation?r.elevation.exaggeration()*i.getElevationAt(u.x,u.y,!0):0,h=s?u:vl(u,c,n),p=s?t.tilespaceRays.map((t=>_l(t,c))):t.queryGeometry.screenGeometry,d=F([],[e.x,e.y,c,1],n);if(!a&&s?l*=d[3]/r.cameraToCenterDistance:a&&!s&&(l*=r.cameraToCenterDistance/d[3]),Qo(p,h,l))return !0}return !1}function vl(t,e,r){const n=F([],[t.x,t.y,e,1],r);return new i(n[0]/n[3],n[1]/n[3])}const bl=b(0,0,0),wl=b(0,0,1);function _l(t,e){const r=g();return bl[2]=e,t.intersectsPlane(bl,wl,r),new i(r[0],r[1])}class Al extends Jo{}function kl(t,{width:e,height:r},n,i){if(i){if(i instanceof Uint8ClampedArray)i=new Uint8Array(i.buffer);else if(i.length!==e*r*n)throw new RangeError("mismatched image size")}else i=new Uint8Array(e*r*n);return t.width=e,t.height=r,t.data=i,t}function Sl(t,{width:e,height:r},n){if(e===t.width&&r===t.height)return;const i=kl({},{width:e,height:r},n);Il(t,i,{x:0,y:0},{x:0,y:0},{width:Math.min(t.width,e),height:Math.min(t.height,r)},n),t.width=e,t.height=r,t.data=i.data;}function Il(t,e,r,n,i,s){if(0===i.width||0===i.height)return e;if(i.width>t.width||i.height>t.height||r.x>t.width-i.width||r.y>t.height-i.height)throw new RangeError("out of range source coordinates for image copy");if(i.width>e.width||i.height>e.height||n.x>e.width-i.width||n.y>e.height-i.height)throw new RangeError("out of range destination coordinates for image copy");const a=t.data,o=e.data;for(let l=0;l<i.height;l++){const u=((r.y+l)*t.width+r.x)*s,c=((n.y+l)*e.width+n.x)*s;for(let t=0;t<i.width*s;t++)o[c+t]=a[u+t];}return e}Zi("HeatmapBucket",Al,{omit:["layers"]});class zl{constructor(t,e){kl(this,t,1,e);}resize(t){Sl(this,t,1);}clone(){return new zl({width:this.width,height:this.height},new Uint8Array(this.data))}static copy(t,e,r,n,i){Il(t,e,r,n,i,1);}}class Ml{constructor(t,e){kl(this,t,4,e);}resize(t){Sl(this,t,4);}replace(t,e){e?this.data.set(t):this.data=t instanceof Uint8ClampedArray?new Uint8Array(t.buffer):t;}clone(){return new Ml({width:this.width,height:this.height},new Uint8Array(this.data))}static copy(t,e,r,n,i){Il(t,e,r,n,i,4);}}Zi("AlphaImage",zl),Zi("RGBAImage",Ml);var Tl={paint:new sa({"heatmap-radius":new ea(ve.paint_heatmap["heatmap-radius"]),"heatmap-weight":new ea(ve.paint_heatmap["heatmap-weight"]),"heatmap-intensity":new ta(ve.paint_heatmap["heatmap-intensity"]),"heatmap-color":new ia(ve.paint_heatmap["heatmap-color"]),"heatmap-opacity":new ta(ve.paint_heatmap["heatmap-opacity"])})};function Bl(t){const e={},r=t.resolution||256,n=t.clips?t.clips.length:1,i=t.image||new Ml({width:r,height:n}),s=(r,n,s)=>{e[t.evaluationKey]=s;const a=t.expression.evaluate(e);i.data[r+n+0]=Math.floor(255*a.r/a.a),i.data[r+n+1]=Math.floor(255*a.g/a.a),i.data[r+n+2]=Math.floor(255*a.b/a.a),i.data[r+n+3]=Math.floor(255*a.a);};if(t.clips)for(let e=0,i=0;e<n;++e,i+=4*r)for(let n=0,a=0;n<r;n++,a+=4){const o=n/(r-1),{start:l,end:u}=t.clips[e];s(i,a,l*(1-o)+u*o);}else for(let t=0,e=0;t<r;t++,e+=4)s(0,e,t/(r-1));return i}var Cl={paint:new sa({"hillshade-illumination-direction":new ta(ve.paint_hillshade["hillshade-illumination-direction"]),"hillshade-illumination-anchor":new ta(ve.paint_hillshade["hillshade-illumination-anchor"]),"hillshade-exaggeration":new ta(ve.paint_hillshade["hillshade-exaggeration"]),"hillshade-shadow-color":new ta(ve.paint_hillshade["hillshade-shadow-color"]),"hillshade-highlight-color":new ta(ve.paint_hillshade["hillshade-highlight-color"]),"hillshade-accent-color":new ta(ve.paint_hillshade["hillshade-accent-color"])})};const Pl=ca([{name:"a_pos",components:2,type:"Int16"}],4),{members:El}=Pl;var Dl=Fl,Vl=Fl;function Fl(t,e,r){r=r||2;var n,i,s,a,o,l,u,c=e&&e.length,h=c?e[0]*r:t.length,p=Ll(t,0,h,r,!0),d=[];if(!p||p.next===p.prev)return d;if(c&&(p=function(t,e,r,n){var i,s,a,o=[];for(i=0,s=e.length;i<s;i++)(a=Ll(t,e[i]*n,i<s-1?e[i+1]*n:t.length,n,!1))===a.next&&(a.steiner=!0),o.push(Kl(a));for(o.sort(Nl),i=0;i<o.length;i++)r=Rl(r=Gl(o[i],r),r.next);return r}(t,e,p,r)),t.length>80*r){n=s=t[0],i=a=t[1];for(var f=r;f<h;f+=r)(o=t[f])<n&&(n=o),(l=t[f+1])<i&&(i=l),o>s&&(s=o),l>a&&(a=l);u=0!==(u=Math.max(s-n,a-i))?1/u:0;}return Ul(p,d,r,n,i,u),d}function Ll(t,e,r,n,i){var s,a;if(i===ou(t,e,r,n)>0)for(s=e;s<r;s+=n)a=iu(s,t[s],t[s+1],a);else for(s=r-n;s>=e;s-=n)a=iu(s,t[s],t[s+1],a);return a&&Wl(a,a.next)&&(su(a),a=a.next),a}function Rl(t,e){if(!t)return t;e||(e=t);var r,n=t;do{if(r=!1,n.steiner||!Wl(n,n.next)&&0!==Jl(n.prev,n,n.next))n=n.next;else {if(su(n),(n=e=n.prev)===n.next)break;r=!0;}}while(r||n!==e);return e}function Ul(t,e,r,n,i,s,a){if(t){!a&&s&&function(t,e,r,n){var i=t;do{null===i.z&&(i.z=Xl(i.x,i.y,e,r,n)),i.prevZ=i.prev,i.nextZ=i.next,i=i.next;}while(i!==t);i.prevZ.nextZ=null,i.prevZ=null,function(t){var e,r,n,i,s,a,o,l,u=1;do{for(r=t,t=null,s=null,a=0;r;){for(a++,n=r,o=0,e=0;e<u&&(o++,n=n.nextZ);e++);for(l=u;o>0||l>0&&n;)0!==o&&(0===l||!n||r.z<=n.z)?(i=r,r=r.nextZ,o--):(i=n,n=n.nextZ,l--),s?s.nextZ=i:t=i,i.prevZ=s,s=i;r=n;}s.nextZ=null,u*=2;}while(a>1)}(i);}(t,n,i,s);for(var o,l,u=t;t.prev!==t.next;)if(o=t.prev,l=t.next,s?Ol(t,n,i,s):$l(t))e.push(o.i/r),e.push(t.i/r),e.push(l.i/r),su(t),t=l.next,u=l.next;else if((t=l)===u){a?1===a?Ul(t=jl(Rl(t),e,r),e,r,n,i,s,2):2===a&&ql(t,e,r,n,i,s):Ul(Rl(t),e,r,n,i,s,1);break}}}function $l(t){var e=t.prev,r=t,n=t.next;if(Jl(e,r,n)>=0)return !1;for(var i=t.next.next;i!==t.prev;){if(Yl(e.x,e.y,r.x,r.y,n.x,n.y,i.x,i.y)&&Jl(i.prev,i,i.next)>=0)return !1;i=i.next;}return !0}function Ol(t,e,r,n){var i=t.prev,s=t,a=t.next;if(Jl(i,s,a)>=0)return !1;for(var o=i.x>s.x?i.x>a.x?i.x:a.x:s.x>a.x?s.x:a.x,l=i.y>s.y?i.y>a.y?i.y:a.y:s.y>a.y?s.y:a.y,u=Xl(i.x<s.x?i.x<a.x?i.x:a.x:s.x<a.x?s.x:a.x,i.y<s.y?i.y<a.y?i.y:a.y:s.y<a.y?s.y:a.y,e,r,n),c=Xl(o,l,e,r,n),h=t.prevZ,p=t.nextZ;h&&h.z>=u&&p&&p.z<=c;){if(h!==t.prev&&h!==t.next&&Yl(i.x,i.y,s.x,s.y,a.x,a.y,h.x,h.y)&&Jl(h.prev,h,h.next)>=0)return !1;if(h=h.prevZ,p!==t.prev&&p!==t.next&&Yl(i.x,i.y,s.x,s.y,a.x,a.y,p.x,p.y)&&Jl(p.prev,p,p.next)>=0)return !1;p=p.nextZ;}for(;h&&h.z>=u;){if(h!==t.prev&&h!==t.next&&Yl(i.x,i.y,s.x,s.y,a.x,a.y,h.x,h.y)&&Jl(h.prev,h,h.next)>=0)return !1;h=h.prevZ;}for(;p&&p.z<=c;){if(p!==t.prev&&p!==t.next&&Yl(i.x,i.y,s.x,s.y,a.x,a.y,p.x,p.y)&&Jl(p.prev,p,p.next)>=0)return !1;p=p.nextZ;}return !0}function jl(t,e,r){var n=t;do{var i=n.prev,s=n.next.next;!Wl(i,s)&&Ql(i,n,n.next,s)&&ru(i,s)&&ru(s,i)&&(e.push(i.i/r),e.push(n.i/r),e.push(s.i/r),su(n),su(n.next),n=t=s),n=n.next;}while(n!==t);return Rl(n)}function ql(t,e,r,n,i,s){var a=t;do{for(var o=a.next.next;o!==a.prev;){if(a.i!==o.i&&Hl(a,o)){var l=nu(a,o);return a=Rl(a,a.next),l=Rl(l,l.next),Ul(a,e,r,n,i,s),void Ul(l,e,r,n,i,s)}o=o.next;}a=a.next;}while(a!==t)}function Nl(t,e){return t.x-e.x}function Gl(t,e){var r=function(t,e){var r,n=e,i=t.x,s=t.y,a=-1/0;do{if(s<=n.y&&s>=n.next.y&&n.next.y!==n.y){var o=n.x+(s-n.y)*(n.next.x-n.x)/(n.next.y-n.y);if(o<=i&&o>a){if(a=o,o===i){if(s===n.y)return n;if(s===n.next.y)return n.next}r=n.x<n.next.x?n:n.next;}}n=n.next;}while(n!==e);if(!r)return null;if(i===a)return r;var l,u=r,c=r.x,h=r.y,p=1/0;n=r;do{i>=n.x&&n.x>=c&&i!==n.x&&Yl(s<h?i:a,s,c,h,s<h?a:i,s,n.x,n.y)&&(l=Math.abs(s-n.y)/(i-n.x),ru(n,t)&&(l<p||l===p&&(n.x>r.x||n.x===r.x&&Zl(r,n)))&&(r=n,p=l)),n=n.next;}while(n!==u);return r}(t,e);if(!r)return e;var n=nu(r,t),i=Rl(r,r.next);return Rl(n,n.next),e===r?i:e}function Zl(t,e){return Jl(t.prev,t,e.prev)<0&&Jl(e.next,t,t.next)<0}function Xl(t,e,r,n,i){return (t=1431655765&((t=858993459&((t=252645135&((t=16711935&((t=32767*(t-r)*i)|t<<8))|t<<4))|t<<2))|t<<1))|(e=1431655765&((e=858993459&((e=252645135&((e=16711935&((e=32767*(e-n)*i)|e<<8))|e<<4))|e<<2))|e<<1))<<1}function Kl(t){var e=t,r=t;do{(e.x<r.x||e.x===r.x&&e.y<r.y)&&(r=e),e=e.next;}while(e!==t);return r}function Yl(t,e,r,n,i,s,a,o){return (i-a)*(e-o)-(t-a)*(s-o)>=0&&(t-a)*(n-o)-(r-a)*(e-o)>=0&&(r-a)*(s-o)-(i-a)*(n-o)>=0}function Hl(t,e){return t.next.i!==e.i&&t.prev.i!==e.i&&!function(t,e){var r=t;do{if(r.i!==t.i&&r.next.i!==t.i&&r.i!==e.i&&r.next.i!==e.i&&Ql(r,r.next,t,e))return !0;r=r.next;}while(r!==t);return !1}(t,e)&&(ru(t,e)&&ru(e,t)&&function(t,e){var r=t,n=!1,i=(t.x+e.x)/2,s=(t.y+e.y)/2;do{r.y>s!=r.next.y>s&&r.next.y!==r.y&&i<(r.next.x-r.x)*(s-r.y)/(r.next.y-r.y)+r.x&&(n=!n),r=r.next;}while(r!==t);return n}(t,e)&&(Jl(t.prev,t,e.prev)||Jl(t,e.prev,e))||Wl(t,e)&&Jl(t.prev,t,t.next)>0&&Jl(e.prev,e,e.next)>0)}function Jl(t,e,r){return (e.y-t.y)*(r.x-e.x)-(e.x-t.x)*(r.y-e.y)}function Wl(t,e){return t.x===e.x&&t.y===e.y}function Ql(t,e,r,n){var i=eu(Jl(t,e,r)),s=eu(Jl(t,e,n)),a=eu(Jl(r,n,t)),o=eu(Jl(r,n,e));return i!==s&&a!==o||!(0!==i||!tu(t,r,e))||!(0!==s||!tu(t,n,e))||!(0!==a||!tu(r,t,n))||!(0!==o||!tu(r,e,n))}function tu(t,e,r){return e.x<=Math.max(t.x,r.x)&&e.x>=Math.min(t.x,r.x)&&e.y<=Math.max(t.y,r.y)&&e.y>=Math.min(t.y,r.y)}function eu(t){return t>0?1:t<0?-1:0}function ru(t,e){return Jl(t.prev,t,t.next)<0?Jl(t,e,t.next)>=0&&Jl(t,t.prev,e)>=0:Jl(t,e,t.prev)<0||Jl(t,t.next,e)<0}function nu(t,e){var r=new au(t.i,t.x,t.y),n=new au(e.i,e.x,e.y),i=t.next,s=e.prev;return t.next=e,e.prev=t,r.next=i,i.prev=r,n.next=r,r.prev=n,s.next=n,n.prev=s,n}function iu(t,e,r,n){var i=new au(t,e,r);return n?(i.next=n.next,i.prev=n,n.next.prev=i,n.next=i):(i.prev=i,i.next=i),i}function su(t){t.next.prev=t.prev,t.prev.next=t.next,t.prevZ&&(t.prevZ.nextZ=t.nextZ),t.nextZ&&(t.nextZ.prevZ=t.prevZ);}function au(t,e,r){this.i=t,this.x=e,this.y=r,this.prev=null,this.next=null,this.z=null,this.prevZ=null,this.nextZ=null,this.steiner=!1;}function ou(t,e,r,n){for(var i=0,s=e,a=r-n;s<r;s+=n)i+=(t[a]-t[s])*(t[s+1]+t[a+1]),a=s;return i}function lu(t,e,r,n,i){uu(t,e,r||0,n||t.length-1,i||hu);}function uu(t,e,r,n,i){for(;n>r;){if(n-r>600){var s=n-r+1,a=e-r+1,o=Math.log(s),l=.5*Math.exp(2*o/3),u=.5*Math.sqrt(o*l*(s-l)/s)*(a-s/2<0?-1:1);uu(t,e,Math.max(r,Math.floor(e-a*l/s+u)),Math.min(n,Math.floor(e+(s-a)*l/s+u)),i);}var c=t[e],h=r,p=n;for(cu(t,r,e),i(t[n],c)>0&&cu(t,r,n);h<p;){for(cu(t,h,p),h++,p--;i(t[h],c)<0;)h++;for(;i(t[p],c)>0;)p--;}0===i(t[r],c)?cu(t,r,p):cu(t,++p,n),p<=e&&(r=p+1),e<=p&&(n=p-1);}}function cu(t,e,r){var n=t[e];t[e]=t[r],t[r]=n;}function hu(t,e){return t<e?-1:t>e?1:0}function pu(t,e){const r=t.length;if(r<=1)return [t];const n=[];let i,s;for(let e=0;e<r;e++){const r=ft(t[e]);0!==r&&(t[e].area=Math.abs(r),void 0===s&&(s=r<0),s===r<0?(i&&n.push(i),i=[t[e]]):i.push(t[e]));}if(i&&n.push(i),e>1)for(let t=0;t<n.length;t++)n[t].length<=e||(lu(n[t],e,1,n[t].length-1,du),n[t]=n[t].slice(0,e));return n}function du(t,e){return e.area-t.area}function fu(t,e,r){const n=r.patternDependencies;let i=!1;for(const r of e){const e=r.paint.get(`${t}-pattern`);e.isConstant()||(i=!0);const s=e.constantOr(null);s&&(i=!0,n[s.to]=!0,n[s.from]=!0);}return i}function yu(t,e,r,n,i){const s=i.patternDependencies;for(const a of e){const e=a.paint.get(`${t}-pattern`).value;if("constant"!==e.kind){let t=e.evaluate({zoom:n-1},r,{},i.availableImages),o=e.evaluate({zoom:n},r,{},i.availableImages),l=e.evaluate({zoom:n+1},r,{},i.availableImages);t=t&&t.name?t.name:t,o=o&&o.name?o.name:o,l=l&&l.name?l.name:l,s[t]=!0,s[o]=!0,s[l]=!0,r.patterns[a.id]={min:t,mid:o,max:l};}}return r}Fl.deviation=function(t,e,r,n){var i=e&&e.length,s=Math.abs(ou(t,0,i?e[0]*r:t.length,r));if(i)for(var a=0,o=e.length;a<o;a++)s-=Math.abs(ou(t,e[a]*r,a<o-1?e[a+1]*r:t.length,r));var l=0;for(a=0;a<n.length;a+=3){var u=n[a]*r,c=n[a+1]*r,h=n[a+2]*r;l+=Math.abs((t[u]-t[h])*(t[c+1]-t[u+1])-(t[u]-t[c])*(t[h+1]-t[u+1]));}return 0===s&&0===l?0:Math.abs((l-s)/s)},Fl.flatten=function(t){for(var e=t[0][0].length,r={vertices:[],holes:[],dimensions:e},n=0,i=0;i<t.length;i++){for(var s=0;s<t[i].length;s++)for(var a=0;a<e;a++)r.vertices.push(t[i][s][a]);i>0&&r.holes.push(n+=t[i-1].length);}return r},Dl.default=Vl;class mu{constructor(t){this.zoom=t.zoom,this.overscaling=t.overscaling,this.layers=t.layers,this.layerIds=this.layers.map((t=>t.id)),this.index=t.index,this.hasPattern=!1,this.patternFeatures=[],this.layoutVertexArray=new pa,this.indexArray=new ka,this.indexArray2=new Ca,this.programConfigurations=new xo(t.layers,t.zoom),this.segments=new Mo,this.segments2=new Mo,this.stateDependentLayerIds=this.layers.filter((t=>t.isStateDependent())).map((t=>t.id));}populate(t,e,r,n){this.hasPattern=fu("fill",this.layers,e);const i=this.layers[0].layout.get("fill-sort-key"),s=[];for(const{feature:a,id:o,index:l,sourceLayerIndex:u}of t){const t=this.layers[0]._featureFilter.needGeometry,c=Yo(a,t);if(!this.layers[0]._featureFilter.filter(new Gs(this.zoom),c,r))continue;const h=i?i.evaluate(c,{},r,e.availableImages):void 0,p={id:o,properties:a.properties,type:a.type,sourceLayerIndex:u,index:l,geometry:t?c.geometry:Ko(a,r,n),patterns:{},sortKey:h};s.push(p);}i&&s.sort(((t,e)=>t.sortKey-e.sortKey));for(const n of s){const{geometry:i,index:s,sourceLayerIndex:a}=n;if(this.hasPattern){const t=yu("fill",this.layers,n,this.zoom,e);this.patternFeatures.push(t);}else this.addFeature(n,i,s,r,{},e.availableImages);e.featureIndex.insert(t[s].feature,i,s,a,this.index);}}update(t,e,r,n){this.stateDependentLayers.length&&this.programConfigurations.updatePaintArrays(t,e,this.stateDependentLayers,r,n);}addFeatures(t,e,r,n){for(const t of this.patternFeatures)this.addFeature(t,t.geometry,t.index,e,r,n);}isEmpty(){return 0===this.layoutVertexArray.length}uploadPending(){return !this.uploaded||this.programConfigurations.needsUpload}upload(t){this.uploaded||(this.layoutVertexBuffer=t.createVertexBuffer(this.layoutVertexArray,El),this.indexBuffer=t.createIndexBuffer(this.indexArray),this.indexBuffer2=t.createIndexBuffer(this.indexArray2)),this.programConfigurations.upload(t),this.uploaded=!0;}destroy(){this.layoutVertexBuffer&&(this.layoutVertexBuffer.destroy(),this.indexBuffer.destroy(),this.indexBuffer2.destroy(),this.programConfigurations.destroy(),this.segments.destroy(),this.segments2.destroy());}addFeature(t,e,r,n,i,s=[]){for(const t of pu(e,500)){let e=0;for(const r of t)e+=r.length;const r=this.segments.prepareSegment(e,this.layoutVertexArray,this.indexArray),n=r.vertexLength,i=[],s=[];for(const e of t){if(0===e.length)continue;e!==t[0]&&s.push(i.length/2);const r=this.segments2.prepareSegment(e.length,this.layoutVertexArray,this.indexArray2),n=r.vertexLength;this.layoutVertexArray.emplaceBack(e[0].x,e[0].y),this.indexArray2.emplaceBack(n+e.length-1,n),i.push(e[0].x),i.push(e[0].y);for(let t=1;t<e.length;t++)this.layoutVertexArray.emplaceBack(e[t].x,e[t].y),this.indexArray2.emplaceBack(n+t-1,n+t),i.push(e[t].x),i.push(e[t].y);r.vertexLength+=e.length,r.primitiveLength+=e.length;}const a=Dl(i,s);for(let t=0;t<a.length;t+=3)this.indexArray.emplaceBack(n+a[t],n+a[t+1],n+a[t+2]);r.vertexLength+=e,r.primitiveLength+=a.length/3;}this.programConfigurations.populatePaintArrays(this.layoutVertexArray.length,t,r,i,s,n);}}Zi("FillBucket",mu,{omit:["layers","patternFeatures"]});const gu=new sa({"fill-sort-key":new ea(ve.layout_fill["fill-sort-key"])});var xu={paint:new sa({"fill-antialias":new ta(ve.paint_fill["fill-antialias"]),"fill-opacity":new ea(ve.paint_fill["fill-opacity"]),"fill-color":new ea(ve.paint_fill["fill-color"]),"fill-outline-color":new ea(ve.paint_fill["fill-outline-color"]),"fill-translate":new ta(ve.paint_fill["fill-translate"]),"fill-translate-anchor":new ta(ve.paint_fill["fill-translate-anchor"]),"fill-pattern":new ra(ve.paint_fill["fill-pattern"])}),layout:gu};const vu=ca([{name:"a_pos_normal_ed",components:4,type:"Int16"}]),bu=ca([{name:"a_centroid_pos",components:2,type:"Uint16"}]),{members:wu}=vu;var _u=Au;function Au(t,e,r,n,i){this.properties={},this.extent=r,this.type=0,this._pbf=t,this._geometry=-1,this._keys=n,this._values=i,t.readFields(ku,this,e);}function ku(t,e,r){1==t?e.id=r.readVarint():2==t?function(t,e){for(var r=t.readVarint()+t.pos;t.pos<r;){var n=e._keys[t.readVarint()],i=e._values[t.readVarint()];e.properties[n]=i;}}(r,e):3==t?e.type=r.readVarint():4==t&&(e._geometry=r.pos);}function Su(t){for(var e,r,n=0,i=0,s=t.length,a=s-1;i<s;a=i++)n+=((r=t[a]).x-(e=t[i]).x)*(e.y+r.y);return n}Au.types=["Unknown","Point","LineString","Polygon"],Au.prototype.loadGeometry=function(){var t=this._pbf;t.pos=this._geometry;for(var e,r=t.readVarint()+t.pos,n=1,s=0,a=0,o=0,l=[];t.pos<r;){if(s<=0){var u=t.readVarint();n=7&u,s=u>>3;}if(s--,1===n||2===n)a+=t.readSVarint(),o+=t.readSVarint(),1===n&&(e&&l.push(e),e=[]),e.push(new i(a,o));else {if(7!==n)throw new Error("unknown command "+n);e&&e.push(e[0].clone());}}return e&&l.push(e),l},Au.prototype.bbox=function(){var t=this._pbf;t.pos=this._geometry;for(var e=t.readVarint()+t.pos,r=1,n=0,i=0,s=0,a=1/0,o=-1/0,l=1/0,u=-1/0;t.pos<e;){if(n<=0){var c=t.readVarint();r=7&c,n=c>>3;}if(n--,1===r||2===r)(i+=t.readSVarint())<a&&(a=i),i>o&&(o=i),(s+=t.readSVarint())<l&&(l=s),s>u&&(u=s);else if(7!==r)throw new Error("unknown command "+r)}return [a,l,o,u]},Au.prototype.toGeoJSON=function(t,e,r){var n,i,s=this.extent*Math.pow(2,r),a=this.extent*t,o=this.extent*e,l=this.loadGeometry(),u=Au.types[this.type];function c(t){for(var e=0;e<t.length;e++){var r=t[e];t[e]=[360*(r.x+a)/s-180,360/Math.PI*Math.atan(Math.exp((180-360*(r.y+o)/s)*Math.PI/180))-90];}}switch(this.type){case 1:var h=[];for(n=0;n<l.length;n++)h[n]=l[n][0];c(l=h);break;case 2:for(n=0;n<l.length;n++)c(l[n]);break;case 3:for(l=function(t){var e=t.length;if(e<=1)return [t];for(var r,n,i=[],s=0;s<e;s++){var a=Su(t[s]);0!==a&&(void 0===n&&(n=a<0),n===a<0?(r&&i.push(r),r=[t[s]]):r.push(t[s]));}return r&&i.push(r),i}(l),n=0;n<l.length;n++)for(i=0;i<l[n].length;i++)c(l[n][i]);}1===l.length?l=l[0]:u="Multi"+u;var p={type:"Feature",geometry:{type:u,coordinates:l},properties:this.properties};return "id"in this&&(p.id=this.id),p};var Iu=zu;function zu(t,e){this.version=1,this.name=null,this.extent=4096,this.length=0,this._pbf=t,this._keys=[],this._values=[],this._features=[],t.readFields(Mu,this,e),this.length=this._features.length;}function Mu(t,e,r){15===t?e.version=r.readVarint():1===t?e.name=r.readString():5===t?e.extent=r.readVarint():2===t?e._features.push(r.pos):3===t?e._keys.push(r.readString()):4===t&&e._values.push(function(t){for(var e=null,r=t.readVarint()+t.pos;t.pos<r;){var n=t.readVarint()>>3;e=1===n?t.readString():2===n?t.readFloat():3===n?t.readDouble():4===n?t.readVarint64():5===n?t.readVarint():6===n?t.readSVarint():7===n?t.readBoolean():null;}return e}(r));}function Tu(t,e,r){if(3===t){var n=new Iu(r,r.readVarint()+r.pos);n.length&&(e[n.name]=n);}}zu.prototype.feature=function(t){if(t<0||t>=this._features.length)throw new Error("feature index out of bounds");this._pbf.pos=this._features[t];var e=this._pbf.readVarint()+this._pbf.pos;return new _u(this._pbf,e,this.extent,this._keys,this._values)};var Bu={VectorTile:function(t,e){this.layers=t.readFields(Tu,{},e);},VectorTileFeature:_u,VectorTileLayer:Iu};const Cu=Bu.VectorTileFeature.types,Pu=Math.pow(2,13);function Eu(t,e,r,n,i,s,a,o){t.emplaceBack((e<<1)+a,(r<<1)+s,(Math.floor(n*Pu)<<1)+i,Math.round(o));}class Du{constructor(){this.acc=new i(0,0),this.polyCount=[];}startRing(t){this.currentPolyCount={edges:0,top:0},this.polyCount.push(this.currentPolyCount),this.min||(this.min=new i(t.x,t.y),this.max=new i(t.x,t.y));}append(t,e){this.currentPolyCount.edges++,this.acc._add(t);let r=!!this.borders;const n=this.min,i=this.max;t.x<n.x?(n.x=t.x,r=!0):t.x>i.x&&(i.x=t.x,r=!0),t.y<n.y?(n.y=t.y,r=!0):t.y>i.y&&(i.y=t.y,r=!0),((0===t.x||t.x===To)&&t.x===e.x)!=((0===t.y||t.y===To)&&t.y===e.y)&&this.processBorderOverlap(t,e),r&&this.checkBorderIntersection(t,e);}checkBorderIntersection(t,e){e.x<0!=t.x<0&&this.addBorderIntersection(0,Lr(e.y,t.y,(0-e.x)/(t.x-e.x))),e.x>To!=t.x>To&&this.addBorderIntersection(1,Lr(e.y,t.y,(To-e.x)/(t.x-e.x))),e.y<0!=t.y<0&&this.addBorderIntersection(2,Lr(e.x,t.x,(0-e.y)/(t.y-e.y))),e.y>To!=t.y>To&&this.addBorderIntersection(3,Lr(e.x,t.x,(To-e.y)/(t.y-e.y)));}addBorderIntersection(t,e){this.borders||(this.borders=[[Number.MAX_VALUE,-Number.MAX_VALUE],[Number.MAX_VALUE,-Number.MAX_VALUE],[Number.MAX_VALUE,-Number.MAX_VALUE],[Number.MAX_VALUE,-Number.MAX_VALUE]]);const r=this.borders[t];e<r[0]&&(r[0]=e),e>r[1]&&(r[1]=e);}processBorderOverlap(t,e){if(t.x===e.x){if(t.y===e.y)return;const r=0===t.x?0:1;this.addBorderIntersection(r,e.y),this.addBorderIntersection(r,t.y);}else {const r=0===t.y?2:3;this.addBorderIntersection(r,e.x),this.addBorderIntersection(r,t.x);}}centroid(){const t=this.polyCount.reduce(((t,e)=>t+e.edges),0);return 0!==t?this.acc.div(t)._round():new i(0,0)}span(){return new i(this.max.x-this.min.x,this.max.y-this.min.y)}intersectsCount(){return this.borders.reduce(((t,e)=>t+ +(e[0]!==Number.MAX_VALUE)),0)}}class Vu{constructor(t){this.zoom=t.zoom,this.overscaling=t.overscaling,this.layers=t.layers,this.layerIds=this.layers.map((t=>t.id)),this.index=t.index,this.hasPattern=!1,this.layoutVertexArray=new da,this.centroidVertexArray=new Za,this.indexArray=new ka,this.programConfigurations=new xo(t.layers,t.zoom),this.segments=new Mo,this.stateDependentLayerIds=this.layers.filter((t=>t.isStateDependent())).map((t=>t.id)),this.enableTerrain=t.enableTerrain;}populate(t,e,r,n){this.features=[],this.hasPattern=fu("fill-extrusion",this.layers,e),this.featuresOnBorder=[],this.borders=[[],[],[],[]],this.borderDone=[!1,!1,!1,!1],this.tileToMeter=function(t){const e=Math.exp(Math.PI*(1-t.y/(1<<t.z)*2));return 80150034*e/(e*e+1)/To/(1<<t.z)}(r);for(const{feature:i,id:s,index:a,sourceLayerIndex:o}of t){const t=this.layers[0]._featureFilter.needGeometry,l=Yo(i,t);if(!this.layers[0]._featureFilter.filter(new Gs(this.zoom),l,r))continue;const u={id:s,sourceLayerIndex:o,index:a,geometry:t?l.geometry:Ko(i,r,n),properties:i.properties,type:i.type,patterns:{}},c=this.layoutVertexArray.length;this.hasPattern?this.features.push(yu("fill-extrusion",this.layers,u,this.zoom,e)):this.addFeature(u,u.geometry,a,r,{},e.availableImages),e.featureIndex.insert(i,u.geometry,a,o,this.index,c);}this.sortBorders();}addFeatures(t,e,r,n){for(const t of this.features){const{geometry:i}=t;this.addFeature(t,i,t.index,e,r,n);}this.sortBorders();}update(t,e,r,n){this.stateDependentLayers.length&&this.programConfigurations.updatePaintArrays(t,e,this.stateDependentLayers,r,n);}isEmpty(){return 0===this.layoutVertexArray.length}uploadPending(){return !this.uploaded||this.programConfigurations.needsUpload}upload(t){this.uploaded||(this.layoutVertexBuffer=t.createVertexBuffer(this.layoutVertexArray,wu),this.indexBuffer=t.createIndexBuffer(this.indexArray)),this.programConfigurations.upload(t),this.uploaded=!0;}uploadCentroid(t){0!==this.centroidVertexArray.length&&(this.centroidVertexBuffer?this.needsCentroidUpdate&&this.centroidVertexBuffer.updateData(this.centroidVertexArray):this.centroidVertexBuffer=t.createVertexBuffer(this.centroidVertexArray,bu.members,!0),this.needsCentroidUpdate=!1);}destroy(){this.layoutVertexBuffer&&(this.layoutVertexBuffer.destroy(),this.centroidVertexBuffer&&this.centroidVertexBuffer.destroy(),this.indexBuffer.destroy(),this.programConfigurations.destroy(),this.segments.destroy());}addFeature(t,e,r,n,i,s){const a=this.enableTerrain?new Du:null;for(const r of pu(e,500)){let e=0,n=this.segments.prepareSegment(4,this.layoutVertexArray,this.indexArray);if(0===r.length||(o=r[0]).every((t=>t.x<=0))||o.every((t=>t.x>=To))||o.every((t=>t.y<=0))||o.every((t=>t.y>=To)))continue;for(let t=0;t<r.length;t++){const i=r[t];if(0===i.length)continue;e+=i.length;let s=0;a&&a.startRing(i[0]);for(let t=0;t<i.length;t++){const e=i[t];if(t>=1){const r=i[t-1];if(!Fu(e,r)){a&&a.append(e,r),n.vertexLength+4>Mo.MAX_VERTEX_ARRAY_LENGTH&&(n=this.segments.prepareSegment(4,this.layoutVertexArray,this.indexArray));const t=e.sub(r)._perp(),i=t.x/(Math.abs(t.x)+Math.abs(t.y)),o=t.y>0?1:0,l=r.dist(e);s+l>32768&&(s=0),Eu(this.layoutVertexArray,e.x,e.y,i,o,0,0,s),Eu(this.layoutVertexArray,e.x,e.y,i,o,0,1,s),s+=l,Eu(this.layoutVertexArray,r.x,r.y,i,o,0,0,s),Eu(this.layoutVertexArray,r.x,r.y,i,o,0,1,s);const u=n.vertexLength;this.indexArray.emplaceBack(u,u+2,u+1),this.indexArray.emplaceBack(u+1,u+2,u+3),n.vertexLength+=4,n.primitiveLength+=2;}}}}if(n.vertexLength+e>Mo.MAX_VERTEX_ARRAY_LENGTH&&(n=this.segments.prepareSegment(e,this.layoutVertexArray,this.indexArray)),"Polygon"!==Cu[t.type])continue;const i=[],s=[],l=n.vertexLength;for(let t=0;t<r.length;t++){const e=r[t];if(0!==e.length){e!==r[0]&&s.push(i.length/2);for(let t=0;t<e.length;t++){const r=e[t];Eu(this.layoutVertexArray,r.x,r.y,0,0,1,1,0),i.push(r.x),i.push(r.y),a&&a.currentPolyCount.top++;}}}const u=Dl(i,s);for(let t=0;t<u.length;t+=3)this.indexArray.emplaceBack(l+u[t],l+u[t+2],l+u[t+1]);n.primitiveLength+=u.length/3,n.vertexLength+=e;}var o;if(a&&a.polyCount.length>0){if(a.borders){a.vertexArrayOffset=this.centroidVertexArray.length;const t=a.borders,e=this.featuresOnBorder.push(a)-1;for(let r=0;r<4;r++)t[r][0]!==Number.MAX_VALUE&&this.borders[r].push(e);}this.encodeCentroid(a.borders?void 0:a.centroid(),a);}this.programConfigurations.populatePaintArrays(this.layoutVertexArray.length,t,r,i,s,n);}sortBorders(){for(let t=0;t<4;t++)this.borders[t].sort(((e,r)=>this.featuresOnBorder[e].borders[t][0]-this.featuresOnBorder[r].borders[t][0]));}encodeCentroid(t,e,r=!0){let n,i;if(t)if(0!==t.y){const r=e.span()._mult(this.tileToMeter);n=(Math.max(t.x,1)<<3)+Math.min(7,Math.round(r.x/10)),i=(Math.max(t.y,1)<<3)+Math.min(7,Math.round(r.y/10));}else n=Math.ceil(7*(t.x+450)),i=0;else n=0,i=+r;let s=r?this.centroidVertexArray.length:e.vertexArrayOffset;for(const t of e.polyCount){r&&this.centroidVertexArray.resize(this.centroidVertexArray.length+4*t.edges+t.top);for(let e=0;e<2*t.edges;e++)this.centroidVertexArray.emplace(s++,0,i),this.centroidVertexArray.emplace(s++,n,i);for(let e=0;e<t.top;e++)this.centroidVertexArray.emplace(s++,n,i);}}}function Fu(t,e){return t.x===e.x&&(t.x<0||t.x>To)||t.y===e.y&&(t.y<0||t.y>To)}Zi("FillExtrusionBucket",Vu,{omit:["layers","features"]}),Zi("PartMetadata",Du);var Lu={paint:new sa({"fill-extrusion-opacity":new ta(ve["paint_fill-extrusion"]["fill-extrusion-opacity"]),"fill-extrusion-color":new ea(ve["paint_fill-extrusion"]["fill-extrusion-color"]),"fill-extrusion-translate":new ta(ve["paint_fill-extrusion"]["fill-extrusion-translate"]),"fill-extrusion-translate-anchor":new ta(ve["paint_fill-extrusion"]["fill-extrusion-translate-anchor"]),"fill-extrusion-pattern":new ra(ve["paint_fill-extrusion"]["fill-extrusion-pattern"]),"fill-extrusion-height":new ea(ve["paint_fill-extrusion"]["fill-extrusion-height"]),"fill-extrusion-base":new ea(ve["paint_fill-extrusion"]["fill-extrusion-base"]),"fill-extrusion-vertical-gradient":new ta(ve["paint_fill-extrusion"]["fill-extrusion-vertical-gradient"])})};function Ru(t,e){return t.x*e.x+t.y*e.y}function Uu(t,e){if(1===t.length){let r=0;const n=e[r++];let i;for(;!i||n.equals(i);)if(i=e[r++],!i)return 1/0;for(;r<e.length;r++){const s=e[r],a=t[0],o=i.sub(n),l=s.sub(n),u=a.sub(n),c=Ru(o,o),h=Ru(o,l),p=Ru(l,l),d=Ru(u,o),f=Ru(u,l),y=c*p-h*h,m=(p*d-h*f)/y,g=(c*f-h*d)/y,x=n.z*(1-m-g)+i.z*m+s.z*g;if(isFinite(x))return x}return 1/0}{let t=1/0;for(const r of e)t=Math.min(t,r.z);return t}}function $u(t){const e=new i(t[0],t[1]);return e.z=t[2],e}function Ou(t,e,r,n,i,s,a,o){const l=a*i.getElevationAt(t,e,!0,!0),u=0!==s[0],c=u?0===s[1]?a*(s[0]/7-450):a*function(t,e,r){const n=Math.floor(e[0]/8),i=Math.floor(e[1]/8),s=10*(e[0]-8*n),a=10*(e[1]-8*i),o=t.getElevationAt(n,i,!0,!0),l=t.getMeterToDEM(r),u=Math.floor(.5*(s*l-1)),c=Math.floor(.5*(a*l-1)),h=t.tileCoordToPixel(n,i),p=2*u+1,d=2*c+1,f=function(t,e,r,n,i){return [t.getElevationAtPixel(e,r,!0),t.getElevationAtPixel(e+i,r,!0),t.getElevationAtPixel(e,r+i,!0),t.getElevationAtPixel(e+n,r+i,!0)]}(t,h.x-u,h.y-c,p,d),y=Math.abs(f[0]-f[1]),m=Math.abs(f[2]-f[3]),g=Math.abs(f[0]-f[2])+Math.abs(f[1]-f[3]),x=Math.min(.25,.5*l*(y+m)/p),v=Math.min(.25,.5*l*g/d);return o+Math.max(x*s,v*a)}(i,s,o):l;return {base:l+(0===r)?-1:r,top:u?Math.max(c+n,l+r+2):l+n}}const ju=ca([{name:"a_pos_normal",components:2,type:"Int16"},{name:"a_data",components:4,type:"Uint8"},{name:"a_linesofar",components:1,type:"Float32"}],4),{members:qu}=ju,Nu=ca([{name:"a_packed",components:3,type:"Float32"}]),{members:Gu}=Nu,Zu=Bu.VectorTileFeature.types,Xu=Math.cos(Math.PI/180*37.5);class Ku{constructor(t){this.zoom=t.zoom,this.overscaling=t.overscaling,this.layers=t.layers,this.layerIds=this.layers.map((t=>t.id)),this.index=t.index,this.hasPattern=!1,this.patternFeatures=[],this.lineClipsArray=[],this.gradients={},this.layers.forEach((t=>{this.gradients[t.id]={};})),this.layoutVertexArray=new fa,this.layoutVertexArray2=new ya,this.indexArray=new ka,this.programConfigurations=new xo(t.layers,t.zoom),this.segments=new Mo,this.maxLineLength=0,this.stateDependentLayerIds=this.layers.filter((t=>t.isStateDependent())).map((t=>t.id));}populate(t,e,r,n){this.hasPattern=fu("line",this.layers,e);const i=this.layers[0].layout.get("line-sort-key"),s=[];for(const{feature:e,id:a,index:o,sourceLayerIndex:l}of t){const t=this.layers[0]._featureFilter.needGeometry,u=Yo(e,t);if(!this.layers[0]._featureFilter.filter(new Gs(this.zoom),u,r))continue;const c=i?i.evaluate(u,{},r):void 0,h={id:a,properties:e.properties,type:e.type,sourceLayerIndex:l,index:o,geometry:t?u.geometry:Ko(e,r,n),patterns:{},sortKey:c};s.push(h);}i&&s.sort(((t,e)=>t.sortKey-e.sortKey));const{lineAtlas:a,featureIndex:o}=e,l=this.addConstantDashes(a);for(const n of s){const{geometry:i,index:s,sourceLayerIndex:u}=n;if(l&&this.addFeatureDashes(n,a),this.hasPattern){const t=yu("line",this.layers,n,this.zoom,e);this.patternFeatures.push(t);}else this.addFeature(n,i,s,r,a.positions,e.availableImages);o.insert(t[s].feature,i,s,u,this.index);}}addConstantDashes(t){let e=!1;for(const r of this.layers){const n=r.paint.get("line-dasharray").value,i=r.layout.get("line-cap").value;if("constant"!==n.kind||"constant"!==i.kind)e=!0;else {const e=i.value,r=n.value;if(!r)continue;t.addDash(r.from,e),t.addDash(r.to,e),r.other&&t.addDash(r.other,e);}}return e}addFeatureDashes(t,e){const r=this.zoom;for(const n of this.layers){const i=n.paint.get("line-dasharray").value,s=n.layout.get("line-cap").value;if("constant"===i.kind&&"constant"===s.kind)continue;let a,o,l,u,c,h;if("constant"===i.kind){const t=i.value;if(!t)continue;a=t.other||t.to,o=t.to,l=t.from;}else a=i.evaluate({zoom:r-1},t),o=i.evaluate({zoom:r},t),l=i.evaluate({zoom:r+1},t);"constant"===s.kind?u=c=h=s.value:(u=s.evaluate({zoom:r-1},t),c=s.evaluate({zoom:r},t),h=s.evaluate({zoom:r+1},t)),e.addDash(a,u),e.addDash(o,c),e.addDash(l,h);const p=e.getKey(a,u),d=e.getKey(o,c),f=e.getKey(l,h);t.patterns[n.id]={min:p,mid:d,max:f};}}update(t,e,r,n){this.stateDependentLayers.length&&this.programConfigurations.updatePaintArrays(t,e,this.stateDependentLayers,r,n);}addFeatures(t,e,r,n){for(const t of this.patternFeatures)this.addFeature(t,t.geometry,t.index,e,r,n);}isEmpty(){return 0===this.layoutVertexArray.length}uploadPending(){return !this.uploaded||this.programConfigurations.needsUpload}upload(t){this.uploaded||(0!==this.layoutVertexArray2.length&&(this.layoutVertexBuffer2=t.createVertexBuffer(this.layoutVertexArray2,Gu)),this.layoutVertexBuffer=t.createVertexBuffer(this.layoutVertexArray,qu),this.indexBuffer=t.createIndexBuffer(this.indexArray)),this.programConfigurations.upload(t),this.uploaded=!0;}destroy(){this.layoutVertexBuffer&&(this.layoutVertexBuffer.destroy(),this.indexBuffer.destroy(),this.programConfigurations.destroy(),this.segments.destroy());}lineFeatureClips(t){if(t.properties&&t.properties.hasOwnProperty("mapbox_clip_start")&&t.properties.hasOwnProperty("mapbox_clip_end"))return {start:+t.properties.mapbox_clip_start,end:+t.properties.mapbox_clip_end}}addFeature(t,e,r,n,i,s){const a=this.layers[0].layout,o=a.get("line-join").evaluate(t,{}),l=a.get("line-cap").evaluate(t,{}),u=a.get("line-miter-limit"),c=a.get("line-round-limit");this.lineClips=this.lineFeatureClips(t);for(const r of e)this.addLine(r,t,o,l,u,c);this.programConfigurations.populatePaintArrays(this.layoutVertexArray.length,t,r,i,s,n);}addLine(t,e,r,n,i,s){if(this.distance=0,this.scaledDistance=0,this.totalDistance=0,this.lineSoFar=0,this.lineClips){this.lineClipsArray.push(this.lineClips);for(let e=0;e<t.length-1;e++)this.totalDistance+=t[e].dist(t[e+1]);this.updateScaledDistance(),this.maxLineLength=Math.max(this.maxLineLength,this.totalDistance);}const a="Polygon"===Zu[e.type];let o=t.length;for(;o>=2&&t[o-1].equals(t[o-2]);)o--;let l=0;for(;l<o-1&&t[l].equals(t[l+1]);)l++;if(o<(a?3:2))return;"bevel"===r&&(i=1.05);const u=this.overscaling<=16?122880/(512*this.overscaling):0,c=this.segments.prepareSegment(10*o,this.layoutVertexArray,this.indexArray);let h,p,d,f,y;this.e1=this.e2=-1,a&&(h=t[o-2],y=t[l].sub(h)._unit()._perp());for(let e=l;e<o;e++){if(d=e===o-1?a?t[l+1]:void 0:t[e+1],d&&t[e].equals(d))continue;y&&(f=y),h&&(p=h),h=t[e],y=d?d.sub(h)._unit()._perp():f,f=f||y;let m=f.add(y);0===m.x&&0===m.y||m._unit();const g=f.x*y.x+f.y*y.y,x=m.x*y.x+m.y*y.y,v=0!==x?1/x:1/0,b=2*Math.sqrt(2-2*x),w=x<Xu&&p&&d,_=f.x*y.y-f.y*y.x>0;if(w&&e>l){const t=h.dist(p);if(t>2*u){const e=h.sub(h.sub(p)._mult(u/t)._round());this.updateDistance(p,e),this.addCurrentVertex(e,f,0,0,c),p=e;}}const A=p&&d;let k=A?r:a?"butt":n;if(A&&"round"===k&&(v<s?k="miter":v<=2&&(k="fakeround")),"miter"===k&&v>i&&(k="bevel"),"bevel"===k&&(v>2&&(k="flipbevel"),v<i&&(k="miter")),p&&this.updateDistance(p,h),"miter"===k)m._mult(v),this.addCurrentVertex(h,m,0,0,c);else if("flipbevel"===k){if(v>100)m=y.mult(-1);else {const t=v*f.add(y).mag()/f.sub(y).mag();m._perp()._mult(t*(_?-1:1));}this.addCurrentVertex(h,m,0,0,c),this.addCurrentVertex(h,m.mult(-1),0,0,c);}else if("bevel"===k||"fakeround"===k){const t=-Math.sqrt(v*v-1),e=_?t:0,r=_?0:t;if(p&&this.addCurrentVertex(h,f,e,r,c),"fakeround"===k){const t=Math.round(180*b/Math.PI/20);for(let e=1;e<t;e++){let r=e/t;if(.5!==r){const t=r-.5;r+=r*t*(r-1)*((1.0904+g*(g*(3.55645-1.43519*g)-3.2452))*t*t+(.848013+g*(.215638*g-1.06021)));}const n=y.sub(f)._mult(r)._add(f)._unit()._mult(_?-1:1);this.addHalfVertex(h,n.x,n.y,!1,_,0,c);}}d&&this.addCurrentVertex(h,y,-e,-r,c);}else if("butt"===k)this.addCurrentVertex(h,m,0,0,c);else if("square"===k){const t=p?1:-1;p||this.addCurrentVertex(h,m,t,t,c),this.addCurrentVertex(h,m,0,0,c),p&&this.addCurrentVertex(h,m,t,t,c);}else "round"===k&&(p&&(this.addCurrentVertex(h,f,0,0,c),this.addCurrentVertex(h,f,1,1,c,!0)),d&&(this.addCurrentVertex(h,y,-1,-1,c,!0),this.addCurrentVertex(h,y,0,0,c)));if(w&&e<o-1){const t=h.dist(d);if(t>2*u){const e=h.add(d.sub(h)._mult(u/t)._round());this.updateDistance(h,e),this.addCurrentVertex(e,y,0,0,c),h=e;}}}}addCurrentVertex(t,e,r,n,i,s=!1){const a=e.y*n-e.x,o=-e.y-e.x*n;this.addHalfVertex(t,e.x+e.y*r,e.y-e.x*r,s,!1,r,i),this.addHalfVertex(t,a,o,s,!0,-n,i);}addHalfVertex({x:t,y:e},r,n,i,s,a,o){this.layoutVertexArray.emplaceBack((t<<1)+(i?1:0),(e<<1)+(s?1:0),Math.round(63*r)+128,Math.round(63*n)+128,1+(0===a?0:a<0?-1:1),0,this.lineSoFar),this.lineClips&&this.layoutVertexArray2.emplaceBack(this.scaledDistance,this.lineClipsArray.length,this.lineSoFar);const l=o.vertexLength++;this.e1>=0&&this.e2>=0&&(this.indexArray.emplaceBack(this.e1,this.e2,l),o.primitiveLength++),s?this.e2=l:this.e1=l;}updateScaledDistance(){if(this.lineClips){const t=this.totalDistance/(this.lineClips.end-this.lineClips.start);this.scaledDistance=this.distance/this.totalDistance,this.lineSoFar=t*this.lineClips.start+this.distance;}else this.lineSoFar=this.distance;}updateDistance(t,e){this.distance+=t.dist(e),this.updateScaledDistance();}}Zi("LineBucket",Ku,{omit:["layers","patternFeatures"]});const Yu=new sa({"line-cap":new ea(ve.layout_line["line-cap"]),"line-join":new ea(ve.layout_line["line-join"]),"line-miter-limit":new ta(ve.layout_line["line-miter-limit"]),"line-round-limit":new ta(ve.layout_line["line-round-limit"]),"line-sort-key":new ea(ve.layout_line["line-sort-key"])});var Hu={paint:new sa({"line-opacity":new ea(ve.paint_line["line-opacity"]),"line-color":new ea(ve.paint_line["line-color"]),"line-translate":new ta(ve.paint_line["line-translate"]),"line-translate-anchor":new ta(ve.paint_line["line-translate-anchor"]),"line-width":new ea(ve.paint_line["line-width"]),"line-gap-width":new ea(ve.paint_line["line-gap-width"]),"line-offset":new ea(ve.paint_line["line-offset"]),"line-blur":new ea(ve.paint_line["line-blur"]),"line-dasharray":new ra(ve.paint_line["line-dasharray"]),"line-pattern":new ra(ve.paint_line["line-pattern"]),"line-gradient":new ia(ve.paint_line["line-gradient"])}),layout:Yu};const Ju=new class extends ea{possiblyEvaluate(t,e){return e=new Gs(Math.floor(e.zoom),{now:e.now,fadeDuration:e.fadeDuration,zoomHistory:e.zoomHistory,transition:e.transition}),super.possiblyEvaluate(t,e)}evaluate(t,e,r,n){return e=tt({},e,{zoom:Math.floor(e.zoom)}),super.evaluate(t,e,r,n)}}(Hu.paint.properties["line-width"].specification);function Wu(t,e){return e>0?e+2*t:t}Ju.useIntegerZoom=!0;const Qu=ca([{name:"a_pos_offset",components:4,type:"Int16"},{name:"a_tex_size",components:4,type:"Uint16"},{name:"a_pixeloffset",components:4,type:"Int16"},{name:"a_z_tile_anchor",components:4,type:"Int16"}],4),tc=ca([{name:"a_projected_pos",components:3,type:"Float32"}],4);ca([{name:"a_fade_opacity",components:1,type:"Uint32"}],4);const ec=ca([{name:"a_placed",components:2,type:"Uint8"},{name:"a_shift",components:2,type:"Float32"}]),rc=ca([{name:"a_size_scale",components:1,type:"Float32"},{name:"a_padding",components:2,type:"Float32"}]);ca([{type:"Int16",name:"projectedAnchorX"},{type:"Int16",name:"projectedAnchorY"},{type:"Int16",name:"projectedAnchorZ"},{type:"Int16",name:"tileAnchorX"},{type:"Int16",name:"tileAnchorY"},{type:"Float32",name:"x1"},{type:"Float32",name:"y1"},{type:"Float32",name:"x2"},{type:"Float32",name:"y2"},{type:"Int16",name:"padding"},{type:"Uint32",name:"featureIndex"},{type:"Uint16",name:"sourceLayerIndex"},{type:"Uint16",name:"bucketIndex"}]);const nc=ca([{name:"a_pos",components:3,type:"Int16"},{name:"a_anchor_pos",components:2,type:"Int16"},{name:"a_extrude",components:2,type:"Int16"}],4),ic=ca([{name:"a_pos_2f",components:2,type:"Float32"},{name:"a_radius",components:1,type:"Float32"},{name:"a_flags",components:2,type:"Int16"}],4);ca([{name:"triangle",components:3,type:"Uint16"}]),ca([{type:"Int16",name:"projectedAnchorX"},{type:"Int16",name:"projectedAnchorY"},{type:"Int16",name:"projectedAnchorZ"},{type:"Float32",name:"tileAnchorX"},{type:"Float32",name:"tileAnchorY"},{type:"Uint16",name:"glyphStartIndex"},{type:"Uint16",name:"numGlyphs"},{type:"Uint32",name:"vertexStartIndex"},{type:"Uint32",name:"lineStartIndex"},{type:"Uint32",name:"lineLength"},{type:"Uint16",name:"segment"},{type:"Uint16",name:"lowerSize"},{type:"Uint16",name:"upperSize"},{type:"Float32",name:"lineOffsetX"},{type:"Float32",name:"lineOffsetY"},{type:"Uint8",name:"writingMode"},{type:"Uint8",name:"placedOrientation"},{type:"Uint8",name:"hidden"},{type:"Uint32",name:"crossTileID"},{type:"Int16",name:"associatedIconIndex"},{type:"Uint8",name:"flipState"}]),ca([{type:"Int16",name:"projectedAnchorX"},{type:"Int16",name:"projectedAnchorY"},{type:"Int16",name:"projectedAnchorZ"},{type:"Float32",name:"tileAnchorX"},{type:"Float32",name:"tileAnchorY"},{type:"Int16",name:"rightJustifiedTextSymbolIndex"},{type:"Int16",name:"centerJustifiedTextSymbolIndex"},{type:"Int16",name:"leftJustifiedTextSymbolIndex"},{type:"Int16",name:"verticalPlacedTextSymbolIndex"},{type:"Int16",name:"placedIconSymbolIndex"},{type:"Int16",name:"verticalPlacedIconSymbolIndex"},{type:"Uint16",name:"key"},{type:"Uint16",name:"textBoxStartIndex"},{type:"Uint16",name:"textBoxEndIndex"},{type:"Uint16",name:"verticalTextBoxStartIndex"},{type:"Uint16",name:"verticalTextBoxEndIndex"},{type:"Uint16",name:"iconBoxStartIndex"},{type:"Uint16",name:"iconBoxEndIndex"},{type:"Uint16",name:"verticalIconBoxStartIndex"},{type:"Uint16",name:"verticalIconBoxEndIndex"},{type:"Uint16",name:"featureIndex"},{type:"Uint16",name:"numHorizontalGlyphVertices"},{type:"Uint16",name:"numVerticalGlyphVertices"},{type:"Uint16",name:"numIconVertices"},{type:"Uint16",name:"numVerticalIconVertices"},{type:"Uint16",name:"useRuntimeCollisionCircles"},{type:"Uint32",name:"crossTileID"},{type:"Float32",components:2,name:"textOffset"},{type:"Float32",name:"collisionCircleDiameter"}]),ca([{type:"Float32",name:"offsetX"}]),ca([{type:"Int16",name:"x"},{type:"Int16",name:"y"},{type:"Int16",name:"tileUnitDistanceFromAnchor"}]);var sc=24;const ac=128;function oc(t,e){const{expression:r}=e;if("constant"===r.kind)return {kind:"constant",layoutSize:r.evaluate(new Gs(t+1))};if("source"===r.kind)return {kind:"source"};{const{zoomStops:e,interpolationType:n}=r;let i=0;for(;i<e.length&&e[i]<=t;)i++;i=Math.max(0,i-1);let s=i;for(;s<e.length&&e[s]<t+1;)s++;s=Math.min(e.length-1,s);const a=e[i],o=e[s];return "composite"===r.kind?{kind:"composite",minZoom:a,maxZoom:o,interpolationType:n}:{kind:"camera",minZoom:a,maxZoom:o,minSize:r.evaluate(new Gs(a)),maxSize:r.evaluate(new Gs(o)),interpolationType:n}}}function lc(t,{uSize:e,uSizeT:r},{lowerSize:n,upperSize:i}){return "source"===t.kind?n/ac:"composite"===t.kind?Lr(n/ac,i/ac,r):e}function uc(t,e){let r=0,n=0;if("constant"===t.kind)n=t.layoutSize;else if("source"!==t.kind){const{interpolationType:i,minZoom:s,maxZoom:a}=t,o=i?Y(rn.interpolationFactor(i,e,s,a),0,1):0;"camera"===t.kind?n=Lr(t.minSize,t.maxSize,o):r=o;}return {uSizeT:r,uSize:n}}var cc=Object.freeze({__proto__:null,getSizeData:oc,evaluateSizeForFeature:lc,evaluateSizeForZoom:uc,SIZE_PACK_FACTOR:ac});function hc(t,e,r){return t.sections.forEach((t=>{t.text=function(t,e,r){const n=e.layout.get("text-transform").evaluate(r,{});return "uppercase"===n?t=t.toLocaleUpperCase():"lowercase"===n&&(t=t.toLocaleLowerCase()),Ns.applyArabicShaping&&(t=Ns.applyArabicShaping(t)),t}(t.text,e,r);})),t}const pc={"!":"︕","#":"＃",$:"＄","%":"％","&":"＆","(":"︵",")":"︶","*":"＊","+":"＋",",":"︐","-":"︲",".":"・","/":"／",":":"︓",";":"︔","<":"︿","=":"＝",">":"﹀","?":"︖","@":"＠","[":"﹇","\\":"＼","]":"﹈","^":"＾",_:"︳","`":"｀","{":"︷","|":"―","}":"︸","~":"～","¢":"￠","£":"￡","¥":"￥","¦":"￤","¬":"￢","¯":"￣","–":"︲","—":"︱","‘":"﹃","’":"﹄","“":"﹁","”":"﹂","…":"︙","‧":"・","₩":"￦","、":"︑","。":"︒","〈":"︿","〉":"﹀","《":"︽","》":"︾","「":"﹁","」":"﹂","『":"﹃","』":"﹄","【":"︻","】":"︼","〔":"︹","〕":"︺","〖":"︗","〗":"︘","！":"︕","（":"︵","）":"︶","，":"︐","－":"︲","．":"・","：":"︓","；":"︔","＜":"︿","＞":"﹀","？":"︖","［":"﹇","］":"﹈","＿":"︳","｛":"︷","｜":"―","｝":"︸","｟":"︵","｠":"︶","｡":"︒","｢":"﹁","｣":"﹂"};function dc(t){return "︶"===t||"﹈"===t||"︸"===t||"﹄"===t||"﹂"===t||"︾"===t||"︼"===t||"︺"===t||"︘"===t||"﹀"===t||"︐"===t||"︓"===t||"︔"===t||"｀"===t||"￣"===t||"︑"===t||"︒"===t}function fc(t){return "︵"===t||"﹇"===t||"︷"===t||"﹃"===t||"﹁"===t||"︽"===t||"︻"===t||"︹"===t||"︗"===t||"︿"===t}var yc=function(t,e,r,n,i){var s,a,o=8*i-n-1,l=(1<<o)-1,u=l>>1,c=-7,h=r?i-1:0,p=r?-1:1,d=t[e+h];for(h+=p,s=d&(1<<-c)-1,d>>=-c,c+=o;c>0;s=256*s+t[e+h],h+=p,c-=8);for(a=s&(1<<-c)-1,s>>=-c,c+=n;c>0;a=256*a+t[e+h],h+=p,c-=8);if(0===s)s=1-u;else {if(s===l)return a?NaN:1/0*(d?-1:1);a+=Math.pow(2,n),s-=u;}return (d?-1:1)*a*Math.pow(2,s-n)},mc=function(t,e,r,n,i,s){var a,o,l,u=8*s-i-1,c=(1<<u)-1,h=c>>1,p=23===i?Math.pow(2,-24)-Math.pow(2,-77):0,d=n?0:s-1,f=n?1:-1,y=e<0||0===e&&1/e<0?1:0;for(e=Math.abs(e),isNaN(e)||e===1/0?(o=isNaN(e)?1:0,a=c):(a=Math.floor(Math.log(e)/Math.LN2),e*(l=Math.pow(2,-a))<1&&(a--,l*=2),(e+=a+h>=1?p/l:p*Math.pow(2,1-h))*l>=2&&(a++,l/=2),a+h>=c?(o=0,a=c):a+h>=1?(o=(e*l-1)*Math.pow(2,i),a+=h):(o=e*Math.pow(2,h-1)*Math.pow(2,i),a=0));i>=8;t[r+d]=255&o,d+=f,o/=256,i-=8);for(a=a<<i|o,u+=i;u>0;t[r+d]=255&a,d+=f,a/=256,u-=8);t[r+d-f]|=128*y;},gc=xc;function xc(t){this.buf=ArrayBuffer.isView&&ArrayBuffer.isView(t)?t:new Uint8Array(t||0),this.pos=0,this.type=0,this.length=this.buf.length;}xc.Varint=0,xc.Fixed64=1,xc.Bytes=2,xc.Fixed32=5;var vc=4294967296,bc=1/vc,wc="undefined"==typeof TextDecoder?null:new TextDecoder("utf8");function _c(t){return t.type===xc.Bytes?t.readVarint()+t.pos:t.pos+1}function Ac(t,e,r){return r?4294967296*e+(t>>>0):4294967296*(e>>>0)+(t>>>0)}function kc(t,e,r){var n=e<=16383?1:e<=2097151?2:e<=268435455?3:Math.floor(Math.log(e)/(7*Math.LN2));r.realloc(n);for(var i=r.pos-1;i>=t;i--)r.buf[i+n]=r.buf[i];}function Sc(t,e){for(var r=0;r<t.length;r++)e.writeVarint(t[r]);}function Ic(t,e){for(var r=0;r<t.length;r++)e.writeSVarint(t[r]);}function zc(t,e){for(var r=0;r<t.length;r++)e.writeFloat(t[r]);}function Mc(t,e){for(var r=0;r<t.length;r++)e.writeDouble(t[r]);}function Tc(t,e){for(var r=0;r<t.length;r++)e.writeBoolean(t[r]);}function Bc(t,e){for(var r=0;r<t.length;r++)e.writeFixed32(t[r]);}function Cc(t,e){for(var r=0;r<t.length;r++)e.writeSFixed32(t[r]);}function Pc(t,e){for(var r=0;r<t.length;r++)e.writeFixed64(t[r]);}function Ec(t,e){for(var r=0;r<t.length;r++)e.writeSFixed64(t[r]);}function Dc(t,e){return (t[e]|t[e+1]<<8|t[e+2]<<16)+16777216*t[e+3]}function Vc(t,e,r){t[r]=e,t[r+1]=e>>>8,t[r+2]=e>>>16,t[r+3]=e>>>24;}function Fc(t,e){return (t[e]|t[e+1]<<8|t[e+2]<<16)+(t[e+3]<<24)}function Lc(t,e,r){e.glyphs=[],1===t&&r.readMessage(Rc,e);}function Rc(t,e,r){if(3===t){const{id:t,bitmap:n,width:i,height:s,left:a,top:o,advance:l}=r.readMessage(Uc,{});e.glyphs.push({id:t,bitmap:new zl({width:i+6,height:s+6},n),metrics:{width:i,height:s,left:a,top:o,advance:l}});}else 4===t?e.ascender=r.readSVarint():5===t&&(e.descender=r.readSVarint());}function Uc(t,e,r){1===t?e.id=r.readVarint():2===t?e.bitmap=r.readBytes():3===t?e.width=r.readVarint():4===t?e.height=r.readVarint():5===t?e.left=r.readSVarint():6===t?e.top=r.readSVarint():7===t&&(e.advance=r.readVarint());}function $c(t){let e=0,r=0;for(const n of t)e+=n.w*n.h,r=Math.max(r,n.w);t.sort(((t,e)=>e.h-t.h));const n=[{x:0,y:0,w:Math.max(Math.ceil(Math.sqrt(e/.95)),r),h:1/0}];let i=0,s=0;for(const e of t)for(let t=n.length-1;t>=0;t--){const r=n[t];if(!(e.w>r.w||e.h>r.h)){if(e.x=r.x,e.y=r.y,s=Math.max(s,e.y+e.h),i=Math.max(i,e.x+e.w),e.w===r.w&&e.h===r.h){const e=n.pop();t<n.length&&(n[t]=e);}else e.h===r.h?(r.x+=e.w,r.w-=e.w):e.w===r.w?(r.y+=e.h,r.h-=e.h):(n.push({x:r.x+e.w,y:r.y,w:r.w-e.w,h:e.h}),r.y+=e.h,r.h-=e.h);break}}return {w:i,h:s,fill:e/(i*s)||0}}xc.prototype={destroy:function(){this.buf=null;},readFields:function(t,e,r){for(r=r||this.length;this.pos<r;){var n=this.readVarint(),i=n>>3,s=this.pos;this.type=7&n,t(i,e,this),this.pos===s&&this.skip(n);}return e},readMessage:function(t,e){return this.readFields(t,e,this.readVarint()+this.pos)},readFixed32:function(){var t=Dc(this.buf,this.pos);return this.pos+=4,t},readSFixed32:function(){var t=Fc(this.buf,this.pos);return this.pos+=4,t},readFixed64:function(){var t=Dc(this.buf,this.pos)+Dc(this.buf,this.pos+4)*vc;return this.pos+=8,t},readSFixed64:function(){var t=Dc(this.buf,this.pos)+Fc(this.buf,this.pos+4)*vc;return this.pos+=8,t},readFloat:function(){var t=yc(this.buf,this.pos,!0,23,4);return this.pos+=4,t},readDouble:function(){var t=yc(this.buf,this.pos,!0,52,8);return this.pos+=8,t},readVarint:function(t){var e,r,n=this.buf;return e=127&(r=n[this.pos++]),r<128?e:(e|=(127&(r=n[this.pos++]))<<7,r<128?e:(e|=(127&(r=n[this.pos++]))<<14,r<128?e:(e|=(127&(r=n[this.pos++]))<<21,r<128?e:function(t,e,r){var n,i,s=r.buf;if(n=(112&(i=s[r.pos++]))>>4,i<128)return Ac(t,n,e);if(n|=(127&(i=s[r.pos++]))<<3,i<128)return Ac(t,n,e);if(n|=(127&(i=s[r.pos++]))<<10,i<128)return Ac(t,n,e);if(n|=(127&(i=s[r.pos++]))<<17,i<128)return Ac(t,n,e);if(n|=(127&(i=s[r.pos++]))<<24,i<128)return Ac(t,n,e);if(n|=(1&(i=s[r.pos++]))<<31,i<128)return Ac(t,n,e);throw new Error("Expected varint not more than 10 bytes")}(e|=(15&(r=n[this.pos]))<<28,t,this))))},readVarint64:function(){return this.readVarint(!0)},readSVarint:function(){var t=this.readVarint();return t%2==1?(t+1)/-2:t/2},readBoolean:function(){return Boolean(this.readVarint())},readString:function(){var t=this.readVarint()+this.pos,e=this.pos;return this.pos=t,t-e>=12&&wc?function(t,e,r){return wc.decode(t.subarray(e,r))}(this.buf,e,t):function(t,e,r){for(var n="",i=e;i<r;){var s,a,o,l=t[i],u=null,c=l>239?4:l>223?3:l>191?2:1;if(i+c>r)break;1===c?l<128&&(u=l):2===c?128==(192&(s=t[i+1]))&&(u=(31&l)<<6|63&s)<=127&&(u=null):3===c?(a=t[i+2],128==(192&(s=t[i+1]))&&128==(192&a)&&((u=(15&l)<<12|(63&s)<<6|63&a)<=2047||u>=55296&&u<=57343)&&(u=null)):4===c&&(a=t[i+2],o=t[i+3],128==(192&(s=t[i+1]))&&128==(192&a)&&128==(192&o)&&((u=(15&l)<<18|(63&s)<<12|(63&a)<<6|63&o)<=65535||u>=1114112)&&(u=null)),null===u?(u=65533,c=1):u>65535&&(u-=65536,n+=String.fromCharCode(u>>>10&1023|55296),u=56320|1023&u),n+=String.fromCharCode(u),i+=c;}return n}(this.buf,e,t)},readBytes:function(){var t=this.readVarint()+this.pos,e=this.buf.subarray(this.pos,t);return this.pos=t,e},readPackedVarint:function(t,e){if(this.type!==xc.Bytes)return t.push(this.readVarint(e));var r=_c(this);for(t=t||[];this.pos<r;)t.push(this.readVarint(e));return t},readPackedSVarint:function(t){if(this.type!==xc.Bytes)return t.push(this.readSVarint());var e=_c(this);for(t=t||[];this.pos<e;)t.push(this.readSVarint());return t},readPackedBoolean:function(t){if(this.type!==xc.Bytes)return t.push(this.readBoolean());var e=_c(this);for(t=t||[];this.pos<e;)t.push(this.readBoolean());return t},readPackedFloat:function(t){if(this.type!==xc.Bytes)return t.push(this.readFloat());var e=_c(this);for(t=t||[];this.pos<e;)t.push(this.readFloat());return t},readPackedDouble:function(t){if(this.type!==xc.Bytes)return t.push(this.readDouble());var e=_c(this);for(t=t||[];this.pos<e;)t.push(this.readDouble());return t},readPackedFixed32:function(t){if(this.type!==xc.Bytes)return t.push(this.readFixed32());var e=_c(this);for(t=t||[];this.pos<e;)t.push(this.readFixed32());return t},readPackedSFixed32:function(t){if(this.type!==xc.Bytes)return t.push(this.readSFixed32());var e=_c(this);for(t=t||[];this.pos<e;)t.push(this.readSFixed32());return t},readPackedFixed64:function(t){if(this.type!==xc.Bytes)return t.push(this.readFixed64());var e=_c(this);for(t=t||[];this.pos<e;)t.push(this.readFixed64());return t},readPackedSFixed64:function(t){if(this.type!==xc.Bytes)return t.push(this.readSFixed64());var e=_c(this);for(t=t||[];this.pos<e;)t.push(this.readSFixed64());return t},skip:function(t){var e=7&t;if(e===xc.Varint)for(;this.buf[this.pos++]>127;);else if(e===xc.Bytes)this.pos=this.readVarint()+this.pos;else if(e===xc.Fixed32)this.pos+=4;else {if(e!==xc.Fixed64)throw new Error("Unimplemented type: "+e);this.pos+=8;}},writeTag:function(t,e){this.writeVarint(t<<3|e);},realloc:function(t){for(var e=this.length||16;e<this.pos+t;)e*=2;if(e!==this.length){var r=new Uint8Array(e);r.set(this.buf),this.buf=r,this.length=e;}},finish:function(){return this.length=this.pos,this.pos=0,this.buf.subarray(0,this.length)},writeFixed32:function(t){this.realloc(4),Vc(this.buf,t,this.pos),this.pos+=4;},writeSFixed32:function(t){this.realloc(4),Vc(this.buf,t,this.pos),this.pos+=4;},writeFixed64:function(t){this.realloc(8),Vc(this.buf,-1&t,this.pos),Vc(this.buf,Math.floor(t*bc),this.pos+4),this.pos+=8;},writeSFixed64:function(t){this.realloc(8),Vc(this.buf,-1&t,this.pos),Vc(this.buf,Math.floor(t*bc),this.pos+4),this.pos+=8;},writeVarint:function(t){(t=+t||0)>268435455||t<0?function(t,e){var r,n;if(t>=0?(r=t%4294967296|0,n=t/4294967296|0):(n=~(-t/4294967296),4294967295^(r=~(-t%4294967296))?r=r+1|0:(r=0,n=n+1|0)),t>=0x10000000000000000||t<-0x10000000000000000)throw new Error("Given varint doesn't fit into 10 bytes");e.realloc(10),function(t,e,r){r.buf[r.pos++]=127&t|128,t>>>=7,r.buf[r.pos++]=127&t|128,t>>>=7,r.buf[r.pos++]=127&t|128,t>>>=7,r.buf[r.pos++]=127&t|128,r.buf[r.pos]=127&(t>>>=7);}(r,0,e),function(t,e){var r=(7&t)<<4;e.buf[e.pos++]|=r|((t>>>=3)?128:0),t&&(e.buf[e.pos++]=127&t|((t>>>=7)?128:0),t&&(e.buf[e.pos++]=127&t|((t>>>=7)?128:0),t&&(e.buf[e.pos++]=127&t|((t>>>=7)?128:0),t&&(e.buf[e.pos++]=127&t|((t>>>=7)?128:0),t&&(e.buf[e.pos++]=127&t)))));}(n,e);}(t,this):(this.realloc(4),this.buf[this.pos++]=127&t|(t>127?128:0),t<=127||(this.buf[this.pos++]=127&(t>>>=7)|(t>127?128:0),t<=127||(this.buf[this.pos++]=127&(t>>>=7)|(t>127?128:0),t<=127||(this.buf[this.pos++]=t>>>7&127))));},writeSVarint:function(t){this.writeVarint(t<0?2*-t-1:2*t);},writeBoolean:function(t){this.writeVarint(Boolean(t));},writeString:function(t){t=String(t),this.realloc(4*t.length),this.pos++;var e=this.pos;this.pos=function(t,e,r){for(var n,i,s=0;s<e.length;s++){if((n=e.charCodeAt(s))>55295&&n<57344){if(!i){n>56319||s+1===e.length?(t[r++]=239,t[r++]=191,t[r++]=189):i=n;continue}if(n<56320){t[r++]=239,t[r++]=191,t[r++]=189,i=n;continue}n=i-55296<<10|n-56320|65536,i=null;}else i&&(t[r++]=239,t[r++]=191,t[r++]=189,i=null);n<128?t[r++]=n:(n<2048?t[r++]=n>>6|192:(n<65536?t[r++]=n>>12|224:(t[r++]=n>>18|240,t[r++]=n>>12&63|128),t[r++]=n>>6&63|128),t[r++]=63&n|128);}return r}(this.buf,t,this.pos);var r=this.pos-e;r>=128&&kc(e,r,this),this.pos=e-1,this.writeVarint(r),this.pos+=r;},writeFloat:function(t){this.realloc(4),mc(this.buf,t,this.pos,!0,23,4),this.pos+=4;},writeDouble:function(t){this.realloc(8),mc(this.buf,t,this.pos,!0,52,8),this.pos+=8;},writeBytes:function(t){var e=t.length;this.writeVarint(e),this.realloc(e);for(var r=0;r<e;r++)this.buf[this.pos++]=t[r];},writeRawMessage:function(t,e){this.pos++;var r=this.pos;t(e,this);var n=this.pos-r;n>=128&&kc(r,n,this),this.pos=r-1,this.writeVarint(n),this.pos+=n;},writeMessage:function(t,e,r){this.writeTag(t,xc.Bytes),this.writeRawMessage(e,r);},writePackedVarint:function(t,e){e.length&&this.writeMessage(t,Sc,e);},writePackedSVarint:function(t,e){e.length&&this.writeMessage(t,Ic,e);},writePackedBoolean:function(t,e){e.length&&this.writeMessage(t,Tc,e);},writePackedFloat:function(t,e){e.length&&this.writeMessage(t,zc,e);},writePackedDouble:function(t,e){e.length&&this.writeMessage(t,Mc,e);},writePackedFixed32:function(t,e){e.length&&this.writeMessage(t,Bc,e);},writePackedSFixed32:function(t,e){e.length&&this.writeMessage(t,Cc,e);},writePackedFixed64:function(t,e){e.length&&this.writeMessage(t,Pc,e);},writePackedSFixed64:function(t,e){e.length&&this.writeMessage(t,Ec,e);},writeBytesField:function(t,e){this.writeTag(t,xc.Bytes),this.writeBytes(e);},writeFixed32Field:function(t,e){this.writeTag(t,xc.Fixed32),this.writeFixed32(e);},writeSFixed32Field:function(t,e){this.writeTag(t,xc.Fixed32),this.writeSFixed32(e);},writeFixed64Field:function(t,e){this.writeTag(t,xc.Fixed64),this.writeFixed64(e);},writeSFixed64Field:function(t,e){this.writeTag(t,xc.Fixed64),this.writeSFixed64(e);},writeVarintField:function(t,e){this.writeTag(t,xc.Varint),this.writeVarint(e);},writeSVarintField:function(t,e){this.writeTag(t,xc.Varint),this.writeSVarint(e);},writeStringField:function(t,e){this.writeTag(t,xc.Bytes),this.writeString(e);},writeFloatField:function(t,e){this.writeTag(t,xc.Fixed32),this.writeFloat(e);},writeDoubleField:function(t,e){this.writeTag(t,xc.Fixed64),this.writeDouble(e);},writeBooleanField:function(t,e){this.writeVarintField(t,Boolean(e));}};class Oc{constructor(t,{pixelRatio:e,version:r,stretchX:n,stretchY:i,content:s}){this.paddedRect=t,this.pixelRatio=e,this.stretchX=n,this.stretchY=i,this.content=s,this.version=r;}get tl(){return [this.paddedRect.x+1,this.paddedRect.y+1]}get br(){return [this.paddedRect.x+this.paddedRect.w-1,this.paddedRect.y+this.paddedRect.h-1]}get displaySize(){return [(this.paddedRect.w-2)/this.pixelRatio,(this.paddedRect.h-2)/this.pixelRatio]}}class jc{constructor(t,e){const r={},n={};this.haveRenderCallbacks=[];const i=[];this.addImages(t,r,i),this.addImages(e,n,i);const{w:s,h:a}=$c(i),o=new Ml({width:s||1,height:a||1});for(const e in t){const n=t[e],i=r[e].paddedRect;Ml.copy(n.data,o,{x:0,y:0},{x:i.x+1,y:i.y+1},n.data);}for(const t in e){const r=e[t],i=n[t].paddedRect,s=i.x+1,a=i.y+1,l=r.data.width,u=r.data.height;Ml.copy(r.data,o,{x:0,y:0},{x:s,y:a},r.data),Ml.copy(r.data,o,{x:0,y:u-1},{x:s,y:a-1},{width:l,height:1}),Ml.copy(r.data,o,{x:0,y:0},{x:s,y:a+u},{width:l,height:1}),Ml.copy(r.data,o,{x:l-1,y:0},{x:s-1,y:a},{width:1,height:u}),Ml.copy(r.data,o,{x:0,y:0},{x:s+l,y:a},{width:1,height:u});}this.image=o,this.iconPositions=r,this.patternPositions=n;}addImages(t,e,r){for(const n in t){const i=t[n],s={x:0,y:0,w:i.data.width+2,h:i.data.height+2};r.push(s),e[n]=new Oc(s,i),i.hasRenderCallback&&this.haveRenderCallbacks.push(n);}}patchUpdatedImages(t,e){t.dispatchRenderCallbacks(this.haveRenderCallbacks);for(const r in t.updatedImages)this.patchUpdatedImage(this.iconPositions[r],t.getImage(r),e),this.patchUpdatedImage(this.patternPositions[r],t.getImage(r),e);}patchUpdatedImage(t,e,r){if(!t||!e)return;if(t.version===e.version)return;t.version=e.version;const[n,i]=t.tl;r.update(e.data,void 0,{x:n,y:i});}}Zi("ImagePosition",Oc),Zi("ImageAtlas",jc);const qc={horizontal:1,vertical:2,horizontalOnly:3};class Nc{constructor(){this.scale=1,this.fontStack="",this.imageName=null;}static forText(t,e){const r=new Nc;return r.scale=t||1,r.fontStack=e,r}static forImage(t){const e=new Nc;return e.imageName=t,e}}class Gc{constructor(){this.text="",this.sectionIndex=[],this.sections=[],this.imageSectionID=null;}static fromFeature(t,e){const r=new Gc;for(let n=0;n<t.sections.length;n++){const i=t.sections[n];i.image?r.addImageSection(i):r.addTextSection(i,e);}return r}length(){return this.text.length}getSection(t){return this.sections[this.sectionIndex[t]]}getSections(){return this.sections}getSectionIndex(t){return this.sectionIndex[t]}getCharCode(t){return this.text.charCodeAt(t)}verticalizePunctuation(t){this.text=function(t,e){let r="";for(let n=0;n<t.length;n++){const i=t.charCodeAt(n+1)||null,s=t.charCodeAt(n-1)||null;r+=!e&&(i&&Ts(i)&&!pc[t[n+1]]||s&&Ts(s)&&!pc[t[n-1]])||!pc[t[n]]?t[n]:pc[t[n]];}return r}(this.text,t);}trim(){let t=0;for(let e=0;e<this.text.length&&Xc[this.text.charCodeAt(e)];e++)t++;let e=this.text.length;for(let r=this.text.length-1;r>=0&&r>=t&&Xc[this.text.charCodeAt(r)];r--)e--;this.text=this.text.substring(t,e),this.sectionIndex=this.sectionIndex.slice(t,e);}substring(t,e){const r=new Gc;return r.text=this.text.substring(t,e),r.sectionIndex=this.sectionIndex.slice(t,e),r.sections=this.sections,r}toString(){return this.text}getMaxScale(){return this.sectionIndex.reduce(((t,e)=>Math.max(t,this.sections[e].scale)),0)}addTextSection(t,e){this.text+=t.text,this.sections.push(Nc.forText(t.scale,t.fontStack||e));const r=this.sections.length-1;for(let e=0;e<t.text.length;++e)this.sectionIndex.push(r);}addImageSection(t){const e=t.image?t.image.name:"";if(0===e.length)return void pt("Can't add FormattedSection with an empty image.");const r=this.getNextImageSectionCharCode();r?(this.text+=String.fromCharCode(r),this.sections.push(Nc.forImage(e)),this.sectionIndex.push(this.sections.length-1)):pt("Reached maximum number of images 6401");}getNextImageSectionCharCode(){return this.imageSectionID?this.imageSectionID>=63743?null:++this.imageSectionID:(this.imageSectionID=57344,this.imageSectionID)}}function Zc(t,e,r,n,i,s,a,o,l,u,c,h,p,d,f,y){const m=Gc.fromFeature(t,i);let g;h===qc.vertical&&m.verticalizePunctuation(p);const{processBidirectionalText:x,processStyledBidirectionalText:v}=Ns;if(x&&1===m.sections.length){g=[];const t=x(m.toString(),th(m,u,s,e,n,d,f));for(const e of t){const t=new Gc;t.text=e,t.sections=m.sections;for(let r=0;r<e.length;r++)t.sectionIndex.push(0);g.push(t);}}else if(v){g=[];const t=v(m.text,m.sectionIndex,th(m,u,s,e,n,d,f));for(const e of t){const t=new Gc;t.text=e[0],t.sectionIndex=e[1],t.sections=m.sections,g.push(t);}}else g=function(t,e){const r=[],n=t.text;let i=0;for(const n of e)r.push(t.substring(i,n)),i=n;return i<n.length&&r.push(t.substring(i,n.length)),r}(m,th(m,u,s,e,n,d,f));const b=[],w={positionedLines:b,text:m.toString(),top:c[1],bottom:c[1],left:c[0],right:c[0],writingMode:h,iconsInText:!1,verticalizable:!1,hasBaseline:!1};return function(t,e,r,n,i,s,a,o,l,u,c,h){let p=0,d=0,f=0;const y="right"===o?1:"left"===o?0:.5;let m=!1;for(const t of i){const r=t.getSections();for(const t of r){if(t.imageName)continue;const r=e[t.fontStack];if(r&&(m=void 0!==r.ascender&&void 0!==r.descender,!m))break}if(!m)break}let g=0;for(const a of i){a.trim();const i=a.getMaxScale(),o=(i-1)*sc,v={positionedGlyphs:[],lineOffset:0};t.positionedLines[g]=v;const b=v.positionedGlyphs;let w=0;if(!a.length()){d+=s,++g;continue}let _=0,A=0;for(let s=0;s<a.length();s++){const o=a.getSection(s),f=a.getSectionIndex(s),y=a.getCharCode(s);let g=o.scale,v=null,k=null,S=null,I=sc,z=0;const M=!(l===qc.horizontal||!c&&!Ms(y)||c&&(Xc[y]||(x=y,Wi(x)||Qi(x)||ts(x)||vs(x)||As(x))));if(o.imageName){const e=n[o.imageName];if(!e)continue;S=o.imageName,t.iconsInText=t.iconsInText||!0,k=e.paddedRect;const r=e.displaySize;g=g*sc/h,v={width:r[0],height:r[1],left:1,top:-3,advance:M?r[1]:r[0],localGlyph:!1},z=m?-v.height*g:i*sc-17-r[1]*g,I=v.advance;const s=(M?r[0]:r[1])*g-sc*i;s>0&&s>w&&(w=s);}else {const t=r[o.fontStack];if(!t)continue;t[y]&&(k=t[y]);const n=e[o.fontStack];if(!n)continue;const s=n.glyphs[y];if(!s)continue;if(v=s.metrics,I=8203!==y?sc:0,m){const t=void 0!==n.ascender?Math.abs(n.ascender):0,e=void 0!==n.descender?Math.abs(n.descender):0,r=(t+e)*g;_<r&&(_=r,A=(t-e)/2*g),z=-t*g;}else z=(i-g)*sc-17;}M?(t.verticalizable=!0,b.push({glyph:y,imageName:S,x:p,y:d+z,vertical:M,scale:g,localGlyph:v.localGlyph,fontStack:o.fontStack,sectionIndex:f,metrics:v,rect:k}),p+=I*g+u):(b.push({glyph:y,imageName:S,x:p,y:d+z,vertical:M,scale:g,localGlyph:v.localGlyph,fontStack:o.fontStack,sectionIndex:f,metrics:v,rect:k}),p+=v.advance*g+u);}0!==b.length&&(f=Math.max(p-u,f),m?rh(b,y,w,A,s*i/2):rh(b,y,w,0,s/2)),p=0;const k=s*i+w;v.lineOffset=Math.max(w,o),d+=k,++g;}var x;const v=d,{horizontalAlign:b,verticalAlign:w}=eh(a);(function(t,e,r,n,i,s){const a=(e-r)*i,o=-s*n;for(const e of t)for(const t of e.positionedGlyphs)t.x+=a,t.y+=o;})(t.positionedLines,y,b,w,f,v),t.top+=-w*v,t.bottom=t.top+v,t.left+=-b*f,t.right=t.left+f,t.hasBaseline=m;}(w,e,r,n,g,a,o,l,h,u,p,y),!function(t){for(const e of t)if(0!==e.positionedGlyphs.length)return !1;return !0}(b)&&w}const Xc={9:!0,10:!0,11:!0,12:!0,13:!0,32:!0},Kc={10:!0,32:!0,38:!0,40:!0,41:!0,43:!0,45:!0,47:!0,173:!0,183:!0,8203:!0,8208:!0,8211:!0,8231:!0};function Yc(t,e,r,n,i,s){if(e.imageName){const t=n[e.imageName];return t?t.displaySize[0]*e.scale*sc/s+i:0}{const n=r[e.fontStack],s=n&&n.glyphs[t];return s?s.metrics.advance*e.scale+i:0}}function Hc(t,e,r,n){const i=Math.pow(t-e,2);return n?t<e?i/2:2*i:i+Math.abs(r)*r}function Jc(t,e,r){let n=0;return 10===t&&(n-=1e4),r&&(n+=150),40!==t&&65288!==t||(n+=50),41!==e&&65289!==e||(n+=50),n}function Wc(t,e,r,n,i,s){let a=null,o=Hc(e,r,i,s);for(const t of n){const n=Hc(e-t.x,r,i,s)+t.badness;n<=o&&(a=t,o=n);}return {index:t,x:e,priorBreak:a,badness:o}}function Qc(t){return t?Qc(t.priorBreak).concat(t.index):[]}function th(t,e,r,n,i,s,a){if("point"!==s)return [];if(!t)return [];const o=[],l=function(t,e,r,n,i,s){let a=0;for(let r=0;r<t.length();r++){const o=t.getSection(r);a+=Yc(t.getCharCode(r),o,n,i,e,s);}return a/Math.max(1,Math.ceil(a/r))}(t,e,r,n,i,a),u=t.text.indexOf("​")>=0;let c=0;for(let r=0;r<t.length();r++){const s=t.getSection(r),p=t.getCharCode(r);if(Xc[p]||(c+=Yc(p,s,n,i,e,a)),r<t.length()-1){const e=!((h=p)<11904||!(ls(h)||os(h)||ws(h)||xs(h)||ps(h)||es(h)||us(h)||is(h)||ds(h)||fs(h)||hs(h)||ks(h)||ss(h)||ns(h)||rs(h)||cs(h)||as(h)||bs(h)||ms(h)||ys(h)));(Kc[p]||e||s.imageName)&&o.push(Wc(r+1,c,l,o,Jc(p,t.getCharCode(r+1),e&&u),!1));}}var h;return Qc(Wc(t.length(),c,l,o,0,!0))}function eh(t){let e=.5,r=.5;switch(t){case"right":case"top-right":case"bottom-right":e=1;break;case"left":case"top-left":case"bottom-left":e=0;}switch(t){case"bottom":case"bottom-right":case"bottom-left":r=1;break;case"top":case"top-right":case"top-left":r=0;}return {horizontalAlign:e,verticalAlign:r}}function rh(t,e,r,n,i){if(!(e||r||n||i))return;const s=t.length-1,a=t[s],o=(a.x+a.metrics.advance*a.scale)*e;for(let e=0;e<=s;e++)t[e].x-=o,t[e].y+=r+n+i;}function nh(t,e,r){const{horizontalAlign:n,verticalAlign:i}=eh(r),s=e[0]-t.displaySize[0]*n,a=e[1]-t.displaySize[1]*i;return {image:t,top:a,bottom:a+t.displaySize[1],left:s,right:s+t.displaySize[0]}}function ih(t,e,r,n,i,s){const a=t.image;let o;if(a.content){const t=a.content,e=a.pixelRatio||1;o=[t[0]/e,t[1]/e,a.displaySize[0]-t[2]/e,a.displaySize[1]-t[3]/e];}const l=e.left*s,u=e.right*s;let c,h,p,d;"width"===r||"both"===r?(d=i[0]+l-n[3],h=i[0]+u+n[1]):(d=i[0]+(l+u-a.displaySize[0])/2,h=d+a.displaySize[0]);const f=e.top*s,y=e.bottom*s;return "height"===r||"both"===r?(c=i[1]+f-n[0],p=i[1]+y+n[2]):(c=i[1]+(f+y-a.displaySize[1])/2,p=c+a.displaySize[1]),{image:a,top:c,right:h,bottom:p,left:d,collisionPadding:o}}class sh extends i{constructor(t,e,r,n,i){super(t,e),this.angle=n,this.z=r,void 0!==i&&(this.segment=i);}clone(){return new sh(this.x,this.y,this.z,this.angle,this.segment)}}function ah(t,e,r,n,i){if(void 0===e.segment)return !0;let s=e,a=e.segment+1,o=0;for(;o>-r/2;){if(a--,a<0)return !1;o-=t[a].dist(s),s=t[a];}o+=t[a].dist(t[a+1]),a++;const l=[];let u=0;for(;o<r/2;){const e=t[a],r=t[a+1];if(!r)return !1;let s=t[a-1].angleTo(e)-e.angleTo(r);for(s=Math.abs((s+3*Math.PI)%(2*Math.PI)-Math.PI),l.push({distance:o,angleDelta:s}),u+=s;o-l[0].distance>n;)u-=l.shift().angleDelta;if(u>i)return !1;a++,o+=e.dist(r);}return !0}function oh(t){let e=0;for(let r=0;r<t.length-1;r++)e+=t[r].dist(t[r+1]);return e}function lh(t,e,r){return t?.6*e*r:0}function uh(t,e){return Math.max(t?t.right-t.left:0,e?e.right-e.left:0)}function ch(t,e,r,n,i,s){const a=lh(r,i,s),o=uh(r,n)*s;let l=0;const u=oh(t)/2;for(let r=0;r<t.length-1;r++){const n=t[r],i=t[r+1],s=n.dist(i);if(l+s>u){const c=(u-l)/s,h=Lr(n.x,i.x,c),p=Lr(n.y,i.y,c),d=new sh(h,p,0,i.angleTo(n),r);return !a||ah(t,d,o,a,e)?d:void 0}l+=s;}}function hh(t,e,r,n,i,s,a,o,l){const u=lh(n,s,a),c=uh(n,i),h=c*a,p=0===t[0].x||t[0].x===l||0===t[0].y||t[0].y===l;return e-h<e/4&&(e=h+e/4),ph(t,p?e/2*o%e:(c/2+2*s)*a*o%e,e,u,r,h,p,!1,l)}function ph(t,e,r,n,i,s,a,o,l){const u=s/2,c=oh(t);let h=0,p=e-r,d=[];for(let e=0;e<t.length-1;e++){const a=t[e],o=t[e+1],f=a.dist(o),y=o.angleTo(a);for(;p+r<h+f;){p+=r;const m=(p-h)/f,g=Lr(a.x,o.x,m),x=Lr(a.y,o.y,m);if(g>=0&&g<l&&x>=0&&x<l&&p-u>=0&&p+u<=c){const r=new sh(g,x,0,y,e);r._round(),n&&!ah(t,r,s,n,i)||d.push(r);}}h+=f;}return o||d.length||a||(d=ph(t,h/2,r,n,i,s,a,!0,l)),d}function dh(t,e,r,n,s){const a=[];for(let o=0;o<t.length;o++){const l=t[o];let u;for(let t=0;t<l.length-1;t++){let o=l[t],c=l[t+1];o.x<e&&c.x<e||(o.x<e?o=new i(e,o.y+(e-o.x)/(c.x-o.x)*(c.y-o.y))._round():c.x<e&&(c=new i(e,o.y+(e-o.x)/(c.x-o.x)*(c.y-o.y))._round()),o.y<r&&c.y<r||(o.y<r?o=new i(o.x+(r-o.y)/(c.y-o.y)*(c.x-o.x),r)._round():c.y<r&&(c=new i(o.x+(r-o.y)/(c.y-o.y)*(c.x-o.x),r)._round()),o.x>=n&&c.x>=n||(o.x>=n?o=new i(n,o.y+(n-o.x)/(c.x-o.x)*(c.y-o.y))._round():c.x>=n&&(c=new i(n,o.y+(n-o.x)/(c.x-o.x)*(c.y-o.y))._round()),o.y>=s&&c.y>=s||(o.y>=s?o=new i(o.x+(s-o.y)/(c.y-o.y)*(c.x-o.x),s)._round():c.y>=s&&(c=new i(o.x+(s-o.y)/(c.y-o.y)*(c.x-o.x),s)._round()),u&&o.equals(u[u.length-1])||(u=[o],a.push(u)),u.push(c)))));}}return a}Zi("Anchor",sh);const fh=1e20;function yh(t,e,r,n,i,s,a,o,l){for(let u=e;u<e+n;u++)mh(t,r*s+u,s,i,a,o,l);for(let u=r;u<r+i;u++)mh(t,u*s+e,1,n,a,o,l);}function mh(t,e,r,n,i,s,a){s[0]=0,a[0]=-fh,a[1]=fh,i[0]=t[e];for(let o=1,l=0,u=0;o<n;o++){i[o]=t[e+o*r];const n=o*o;do{const t=s[l];u=(i[o]-i[t]+n-t*t)/(o-t)/2;}while(u<=a[l]&&--l>-1);l++,s[l]=o,a[l]=u,a[l+1]=fh;}for(let o=0,l=0;o<n;o++){for(;a[l+1]<o;)l++;const n=s[l],u=o-n;t[e+o*r]=i[n]+u*u;}}const gh={none:0,ideographs:1,all:2};class xh{constructor(t,e,r){this.requestManager=t,this.localGlyphMode=e,this.localFontFamily=r,this.entries={},this.localGlyphs={200:{},400:{},500:{},900:{}};}setURL(t){this.url=t;}getGlyphs(t,e){const r=[];for(const e in t)for(const n of t[e])r.push({stack:e,id:n});W(r,(({stack:t,id:e},r)=>{let n=this.entries[t];n||(n=this.entries[t]={glyphs:{},requests:{},ranges:{},ascender:void 0,descender:void 0});let i=n.glyphs[e];if(void 0!==i)return void r(null,{stack:t,id:e,glyph:i});if(i=this._tinySDF(n,t,e),i)return n.glyphs[e]=i,void r(null,{stack:t,id:e,glyph:i});const s=Math.floor(e/256);if(256*s>65535)return void r(new Error("glyphs > 65535 not supported"));if(n.ranges[s])return void r(null,{stack:t,id:e,glyph:i});let a=n.requests[s];a||(a=n.requests[s]=[],xh.loadGlyphRange(t,s,this.url,this.requestManager,((t,e)=>{if(e){n.ascender=e.ascender,n.descender=e.descender;for(const t in e.glyphs)this._doesCharSupportLocalGlyph(+t)||(n.glyphs[+t]=e.glyphs[+t]);n.ranges[s]=!0;}for(const r of a)r(t,e);delete n.requests[s];}))),a.push(((n,i)=>{n?r(n):i&&r(null,{stack:t,id:e,glyph:i.glyphs[e]||null});}));}),((t,r)=>{if(t)e(t);else if(r){const t={};for(const{stack:e,id:n,glyph:i}of r)void 0===t[e]&&(t[e]={}),void 0===t[e].glyphs&&(t[e].glyphs={}),t[e].glyphs[n]=i&&{id:i.id,bitmap:i.bitmap.clone(),metrics:i.metrics},t[e].ascender=this.entries[e].ascender,t[e].descender=this.entries[e].descender;e(null,t);}}));}_doesCharSupportLocalGlyph(t){return this.localGlyphMode!==gh.none&&(this.localGlyphMode===gh.all?!!this.localFontFamily:!!this.localFontFamily&&(fs(t)||gs(t)||ss(t)||as(t))||is(t))}_tinySDF(t,e,r){const n=this.localFontFamily;if(!n||!this._doesCharSupportLocalGlyph(r))return;let i=t.tinySDF;if(!i){let r="400";/bold/i.test(e)?r="900":/medium/i.test(e)?r="500":/light/i.test(e)&&(r="200"),i=t.tinySDF=new xh.TinySDF({fontFamily:n,fontWeight:r,fontSize:48,buffer:6,radius:16}),i.fontWeight=r;}if(this.localGlyphs[i.fontWeight][r])return this.localGlyphs[i.fontWeight][r];const s=String.fromCharCode(r),{data:a,width:o,height:l,glyphWidth:u,glyphHeight:c,glyphLeft:h,glyphTop:p,glyphAdvance:d}=i.draw(s);return this.localGlyphs[i.fontWeight][r]={id:r,bitmap:new zl({width:o,height:l},a),metrics:{width:u/2,height:c/2,left:h/2,top:p/2-27,advance:d/2,localGlyph:!0}}}}function vh(t,e,r,n){const s=[],a=t.image,o=a.pixelRatio,l=a.paddedRect.w-2,u=a.paddedRect.h-2,c=t.right-t.left,h=t.bottom-t.top,p=a.stretchX||[[0,l]],d=a.stretchY||[[0,u]],f=(t,e)=>t+e[1]-e[0],y=p.reduce(f,0),m=d.reduce(f,0),g=l-y,x=u-m;let v=0,b=y,w=0,_=m,A=0,k=g,S=0,I=x;if(a.content&&n){const t=a.content;v=bh(p,0,t[0]),w=bh(d,0,t[1]),b=bh(p,t[0],t[2]),_=bh(d,t[1],t[3]),A=t[0]-v,S=t[1]-w,k=t[2]-t[0]-b,I=t[3]-t[1]-_;}const z=(n,s,l,u)=>{const p=_h(n.stretch-v,b,c,t.left),d=Ah(n.fixed-A,k,n.stretch,y),f=_h(s.stretch-w,_,h,t.top),g=Ah(s.fixed-S,I,s.stretch,m),x=_h(l.stretch-v,b,c,t.left),z=Ah(l.fixed-A,k,l.stretch,y),M=_h(u.stretch-w,_,h,t.top),T=Ah(u.fixed-S,I,u.stretch,m),B=new i(p,f),C=new i(x,f),P=new i(x,M),E=new i(p,M),D=new i(d/o,g/o),V=new i(z/o,T/o),F=e*Math.PI/180;if(F){const t=Math.sin(F),e=Math.cos(F),r=[e,-t,t,e];B._matMult(r),C._matMult(r),E._matMult(r),P._matMult(r);}const L=n.stretch+n.fixed,R=s.stretch+s.fixed;return {tl:B,tr:C,bl:E,br:P,tex:{x:a.paddedRect.x+1+L,y:a.paddedRect.y+1+R,w:l.stretch+l.fixed-L,h:u.stretch+u.fixed-R},writingMode:void 0,glyphOffset:[0,0],sectionIndex:0,pixelOffsetTL:D,pixelOffsetBR:V,minFontScaleX:k/o/c,minFontScaleY:I/o/h,isSDF:r}};if(n&&(a.stretchX||a.stretchY)){const t=wh(p,g,y),e=wh(d,x,m);for(let r=0;r<t.length-1;r++){const n=t[r],i=t[r+1];for(let t=0;t<e.length-1;t++)s.push(z(n,e[t],i,e[t+1]));}}else s.push(z({fixed:0,stretch:-1},{fixed:0,stretch:-1},{fixed:0,stretch:l+1},{fixed:0,stretch:u+1}));return s}function bh(t,e,r){let n=0;for(const i of t)n+=Math.max(e,Math.min(r,i[1]))-Math.max(e,Math.min(r,i[0]));return n}function wh(t,e,r){const n=[{fixed:-1,stretch:0}];for(const[e,r]of t){const t=n[n.length-1];n.push({fixed:e-t.stretch,stretch:t.stretch}),n.push({fixed:e-t.stretch,stretch:t.stretch+(r-e)});}return n.push({fixed:e+1,stretch:r}),n}function _h(t,e,r,n){return t/e*r+n}function Ah(t,e,r,n){return t-e*r/n}function kh(t,e,r,n){const i=e+t.positionedLines[n].lineOffset;return 0===n?r+i/2:r+(i+(e+t.positionedLines[n-1].lineOffset))/2}xh.loadGlyphRange=function(t,e,r,n,i){const s=256*e,a=s+255,o=n.transformRequest(n.normalizeGlyphsURL(r).replace("{fontstack}",t).replace("{range}",`${s}-${a}`),re.Glyphs);ae(o,((t,e)=>{if(t)i(t);else if(e){const t={},r=function(t){return new gc(t).readFields(Lc,{})}(e);for(const e of r.glyphs)t[e.id]=e;i(null,{glyphs:t,ascender:r.ascender,descender:r.descender});}}));},xh.TinySDF=class{constructor({fontSize:t=24,buffer:e=3,radius:r=8,cutoff:n=.25,fontFamily:i="sans-serif",fontWeight:s="normal",fontStyle:a="normal"}){this.buffer=e,this.cutoff=n,this.radius=r;const o=this.size=t+4*e,l=this._createCanvas(o),u=this.ctx=l.getContext("2d",{willReadFrequently:!0});u.font=`${a} ${s} ${t}px ${i}`,u.textBaseline="alphabetic",u.textAlign="left",u.fillStyle="black",this.gridOuter=new Float64Array(o*o),this.gridInner=new Float64Array(o*o),this.f=new Float64Array(o),this.z=new Float64Array(o+1),this.v=new Uint16Array(o);}_createCanvas(t){const e=document.createElement("canvas");return e.width=e.height=t,e}draw(t){const{width:e,actualBoundingBoxAscent:r,actualBoundingBoxDescent:n,actualBoundingBoxLeft:i,actualBoundingBoxRight:s}=this.ctx.measureText(t),a=Math.floor(r),o=Math.min(this.size-this.buffer,Math.ceil(s-i)),l=Math.min(this.size-this.buffer,Math.ceil(r)+Math.ceil(n)),u=o+2*this.buffer,c=l+2*this.buffer,h=u*c,p=new Uint8ClampedArray(h),d={data:p,width:u,height:c,glyphWidth:o,glyphHeight:l,glyphTop:a,glyphLeft:0,glyphAdvance:e};if(0===o||0===l)return d;const{ctx:f,buffer:y,gridInner:m,gridOuter:g}=this;f.clearRect(y,y,o,l),f.fillText(t,y,y+a+1);const x=f.getImageData(y,y,o,l);g.fill(fh,0,h),m.fill(0,0,h);for(let t=0;t<l;t++)for(let e=0;e<o;e++){const r=x.data[4*(t*o+e)+3]/255;if(0===r)continue;const n=(t+y)*u+e+y;if(1===r)g[n]=0,m[n]=fh;else {const t=.5-r;g[n]=t>0?t*t:0,m[n]=t<0?t*t:0;}}yh(g,0,0,u,c,u,this.f,this.v,this.z),yh(m,y,y,o,l,u,this.f,this.v,this.z);for(let t=0;t<h;t++){const e=Math.sqrt(g[t])-Math.sqrt(m[t]);p[t]=Math.round(255-255*(e/this.radius+this.cutoff));}return d}};class Sh{constructor(t=[],e=Ih){if(this.data=t,this.length=this.data.length,this.compare=e,this.length>0)for(let t=(this.length>>1)-1;t>=0;t--)this._down(t);}push(t){this.data.push(t),this.length++,this._up(this.length-1);}pop(){if(0===this.length)return;const t=this.data[0],e=this.data.pop();return this.length--,this.length>0&&(this.data[0]=e,this._down(0)),t}peek(){return this.data[0]}_up(t){const{data:e,compare:r}=this,n=e[t];for(;t>0;){const i=t-1>>1,s=e[i];if(r(n,s)>=0)break;e[t]=s,t=i;}e[t]=n;}_down(t){const{data:e,compare:r}=this,n=this.length>>1,i=e[t];for(;t<n;){let n=1+(t<<1),s=e[n];const a=n+1;if(a<this.length&&r(e[a],s)<0&&(n=a,s=e[a]),r(s,i)>=0)break;e[t]=s,t=n;}e[t]=i;}}function Ih(t,e){return t<e?-1:t>e?1:0}function zh(t,e=1,r=!1){let n=1/0,s=1/0,a=-1/0,o=-1/0;const l=t[0];for(let t=0;t<l.length;t++){const e=l[t];(!t||e.x<n)&&(n=e.x),(!t||e.y<s)&&(s=e.y),(!t||e.x>a)&&(a=e.x),(!t||e.y>o)&&(o=e.y);}const u=Math.min(a-n,o-s);let c=u/2;const h=new Sh([],Mh);if(0===u)return new i(n,s);for(let e=n;e<a;e+=u)for(let r=s;r<o;r+=u)h.push(new Th(e+c,r+c,c,t));let p=function(t){let e=0,r=0,n=0;const i=t[0];for(let t=0,s=i.length,a=s-1;t<s;a=t++){const s=i[t],o=i[a],l=s.x*o.y-o.x*s.y;r+=(s.x+o.x)*l,n+=(s.y+o.y)*l,e+=3*l;}return new Th(r/e,n/e,0,t)}(t),d=h.length;for(;h.length;){const n=h.pop();(n.d>p.d||!p.d)&&(p=n,r&&console.log("found best %d after %d probes",Math.round(1e4*n.d)/1e4,d)),n.max-p.d<=e||(c=n.h/2,h.push(new Th(n.p.x-c,n.p.y-c,c,t)),h.push(new Th(n.p.x+c,n.p.y-c,c,t)),h.push(new Th(n.p.x-c,n.p.y+c,c,t)),h.push(new Th(n.p.x+c,n.p.y+c,c,t)),d+=4);}return r&&(console.log(`num probes: ${d}`),console.log(`best distance: ${p.d}`)),p.p}function Mh(t,e){return e.max-t.max}function Th(t,e,r,n){this.p=new i(t,e),this.h=r,this.d=function(t,e){let r=!1,n=1/0;for(let i=0;i<e.length;i++){const s=e[i];for(let e=0,i=s.length,a=i-1;e<i;a=e++){const i=s[e],o=s[a];i.y>t.y!=o.y>t.y&&t.x<(o.x-i.x)*(t.y-i.y)/(o.y-i.y)+i.x&&(r=!r),n=Math.min(n,sl(t,i,o));}}return (r?1:-1)*Math.sqrt(n)}(this.p,n),this.max=this.d+this.h*Math.SQRT2;}const Bh=Number.POSITIVE_INFINITY,Ch=Math.sqrt(2);function Ph(t,e){return e[1]!==Bh?function(t,e,r){let n=0,i=0;switch(e=Math.abs(e),r=Math.abs(r),t){case"top-right":case"top-left":case"top":i=r-7;break;case"bottom-right":case"bottom-left":case"bottom":i=7-r;}switch(t){case"top-right":case"bottom-right":case"right":n=-e;break;case"top-left":case"bottom-left":case"left":n=e;}return [n,i]}(t,e[0],e[1]):function(t,e){let r=0,n=0;e<0&&(e=0);const i=e/Ch;switch(t){case"top-right":case"top-left":n=i-7;break;case"bottom-right":case"bottom-left":n=7-i;break;case"bottom":n=7-e;break;case"top":n=e-7;}switch(t){case"top-right":case"bottom-right":r=-i;break;case"top-left":case"bottom-left":r=i;break;case"left":r=e;break;case"right":r=-e;}return [r,n]}(t,e[0])}function Eh(t,e,r,n,i,s,a,o,l,u){t.createArrays(),t.tilePixelRatio=To/(512*t.overscaling),t.compareText={},t.iconsNeedLinear=!1;const c=t.layers[0].layout,h=t.layers[0]._unevaluatedLayout._values,p={};if("composite"===t.textSizeData.kind){const{minZoom:e,maxZoom:r}=t.textSizeData;p.compositeTextSizes=[h["text-size"].possiblyEvaluate(new Gs(e),o),h["text-size"].possiblyEvaluate(new Gs(r),o)];}if("composite"===t.iconSizeData.kind){const{minZoom:e,maxZoom:r}=t.iconSizeData;p.compositeIconSizes=[h["icon-size"].possiblyEvaluate(new Gs(e),o),h["icon-size"].possiblyEvaluate(new Gs(r),o)];}p.layoutTextSize=h["text-size"].possiblyEvaluate(new Gs(l+1),o),p.layoutIconSize=h["icon-size"].possiblyEvaluate(new Gs(l+1),o),p.textMaxSize=h["text-size"].possiblyEvaluate(new Gs(18),o);const d="map"===c.get("text-rotation-alignment")&&"point"!==c.get("symbol-placement"),f=c.get("text-size");for(const s of t.features){const l=c.get("text-font").evaluate(s,{},o).join(","),h=f.evaluate(s,{},o),y=p.layoutTextSize.evaluate(s,{},o),m=(p.layoutIconSize.evaluate(s,{},o),{horizontal:{},vertical:void 0}),g=s.text;let x,v=[0,0];if(g){const n=g.toString(),a=c.get("text-letter-spacing").evaluate(s,{},o)*sc,u=c.get("text-line-height").evaluate(s,{},o)*sc,p=Is(n)?a:0,f=c.get("text-anchor").evaluate(s,{},o),x=c.get("text-variable-anchor");if(!x){const t=c.get("text-radial-offset").evaluate(s,{},o);v=t?Ph(f,[t*sc,Bh]):c.get("text-offset").evaluate(s,{},o).map((t=>t*sc));}let b=d?"center":c.get("text-justify").evaluate(s,{},o);const w=c.get("symbol-placement"),_="point"===w,A="point"===w?c.get("text-max-width").evaluate(s,{},o)*sc:0,k=s=>{t.allowVerticalPlacement&&Ss(n)&&(m.vertical=Zc(g,e,r,i,l,A,u,f,s,p,v,qc.vertical,!0,w,y,h));};if(!d&&x){const t="auto"===b?x.map((t=>Dh(t))):[b];let n=!1;for(let s=0;s<t.length;s++){const a=t[s];if(!m.horizontal[a])if(n)m.horizontal[a]=m.horizontal[0];else {const t=Zc(g,e,r,i,l,A,u,"center",a,p,v,qc.horizontal,!1,w,y,h);t&&(m.horizontal[a]=t,n=1===t.positionedLines.length);}}k("left");}else {if("auto"===b&&(b=Dh(f)),_||c.get("text-writing-mode").indexOf("horizontal")>=0||!Ss(n)){const t=Zc(g,e,r,i,l,A,u,f,b,p,v,qc.horizontal,!1,w,y,h);t&&(m.horizontal[b]=t);}k("point"===w?"left":b);}}let b=!1;if(s.icon&&s.icon.name){const e=n[s.icon.name];e&&(x=nh(i[s.icon.name],c.get("icon-offset").evaluate(s,{},o),c.get("icon-anchor").evaluate(s,{},o)),b=e.sdf,void 0===t.sdfIcons?t.sdfIcons=e.sdf:t.sdfIcons!==e.sdf&&pt("Style sheet warning: Cannot mix SDF and non-SDF icons in one buffer"),(e.pixelRatio!==t.pixelRatio||0!==c.get("icon-rotate").constantOr(1))&&(t.iconsNeedLinear=!0));}const w=Rh(m.horizontal)||m.vertical;t.iconsInText||(t.iconsInText=!!w&&w.iconsInText),(w||x)&&Vh(t,s,m,x,n,p,y,0,v,b,a,o,u);}s&&t.generateCollisionDebugBuffers(l,t.collisionBoxArray);}function Dh(t){switch(t){case"right":case"top-right":case"bottom-right":return "right";case"left":case"top-left":case"bottom-left":return "left"}return "center"}function Vh(t,e,r,n,i,s,a,o,l,u,c,h,p){let d=s.textMaxSize.evaluate(e,{},h);void 0===d&&(d=a);const f=t.layers[0].layout,y=f.get("icon-offset").evaluate(e,{},h),m=Rh(r.horizontal)||r.vertical,g=a/24,x=t.tilePixelRatio*d/24,v=t.tilePixelRatio*f.get("symbol-spacing"),b=f.get("text-padding")*t.tilePixelRatio,w=f.get("icon-padding")*t.tilePixelRatio,_=q(f.get("text-max-angle")),A="map"===f.get("text-rotation-alignment")&&"point"!==f.get("symbol-placement"),k="map"===f.get("icon-rotation-alignment")&&"point"!==f.get("symbol-placement"),S=f.get("symbol-placement"),I=v/2,z=f.get("icon-text-fit");let M;n&&"none"!==z&&(t.allowVerticalPlacement&&r.vertical&&(M=ih(n,r.vertical,z,f.get("icon-text-fit-padding"),y,g)),m&&(n=ih(n,m,z,f.get("icon-text-fit-padding"),y,g)));const T=(a,o,d)=>{if(o.x<0||o.x>=To||o.y<0||o.y>=To)return;const{x:f,y:m,z:g}=p.projectTilePoint(o.x,o.y,d),x=new sh(f,m,g,0,void 0);!function(t,e,r,n,i,s,a,o,l,u,c,h,p,d,f,y,m,g,x,v,b,w,_,A,k){const S=t.addToLineVertexArray(e,n);let I,z,M,T,B,C,P,E=0,D=0,V=0,F=0,L=-1,R=-1;const U={};let $=Ja(""),O=0,j=0;if(void 0===l._unevaluatedLayout.getValue("text-radial-offset")?[O,j]=l.layout.get("text-offset").evaluate(b,{},k).map((t=>t*sc)):(O=l.layout.get("text-radial-offset").evaluate(b,{},k)*sc,j=Bh),t.allowVerticalPlacement&&i.vertical){const t=i.vertical;if(f)C=$h(t),o&&(P=$h(o));else {const n=l.layout.get("text-rotate").evaluate(b,{},k)+90;M=Uh(u,r,e,c,h,p,t,d,n,y),o&&(T=Uh(u,r,e,c,h,p,o,g,n));}}if(s){const n=l.layout.get("icon-rotate").evaluate(b,{},k),i="none"!==l.layout.get("icon-text-fit"),a=vh(s,n,_,i),d=o?vh(o,n,_,i):void 0;z=Uh(u,r,e,c,h,p,s,g,n),E=4*a.length;const f=t.iconSizeData;let y=null;"source"===f.kind?(y=[ac*l.layout.get("icon-size").evaluate(b,{},k)],y[0]>Fh&&pt(`${t.layerIds[0]}: Value for "icon-size" is >= 255. Reduce your "icon-size".`)):"composite"===f.kind&&(y=[ac*w.compositeIconSizes[0].evaluate(b,{},k),ac*w.compositeIconSizes[1].evaluate(b,{},k)],(y[0]>Fh||y[1]>Fh)&&pt(`${t.layerIds[0]}: Value for "icon-size" is >= 255. Reduce your "icon-size".`)),t.addSymbols(t.icon,a,y,v,x,b,!1,r,e,S.lineStartIndex,S.lineLength,-1,A,k),L=t.icon.placedSymbolArray.length-1,d&&(D=4*d.length,t.addSymbols(t.icon,d,y,v,x,b,qc.vertical,r,e,S.lineStartIndex,S.lineLength,-1,A,k),R=t.icon.placedSymbolArray.length-1);}for(const n in i.horizontal){const s=i.horizontal[n];I||($=Ja(s.text),f?B=$h(s):I=Uh(u,r,e,c,h,p,s,d,l.layout.get("text-rotate").evaluate(b,{},k),y));const o=1===s.positionedLines.length;if(V+=Lh(t,r,e,s,a,l,f,b,y,S,i.vertical?qc.horizontal:qc.horizontalOnly,o?Object.keys(i.horizontal):[n],U,L,w,A,k),o)break}i.vertical&&(F+=Lh(t,r,e,i.vertical,a,l,f,b,y,S,qc.vertical,["vertical"],U,R,w,A,k));let q=-1;const N=(t,e)=>t?Math.max(t,e):e;q=N(B,q),q=N(C,q),q=N(P,q);const G=q>-1?1:0;t.glyphOffsetArray.length>=Yh.MAX_GLYPHS&&pt("Too many glyphs being rendered in a tile. See https://github.com/mapbox/mapbox-gl-js/issues/2907"),void 0!==b.sortKey&&t.addToSortKeyRanges(t.symbolInstances.length,b.sortKey),t.symbolInstances.emplaceBack(r.x,r.y,r.z,e.x,e.y,U.right>=0?U.right:-1,U.center>=0?U.center:-1,U.left>=0?U.left:-1,U.vertical>=0?U.vertical:-1,L,R,$,void 0!==I?I:t.collisionBoxArray.length,void 0!==I?I+1:t.collisionBoxArray.length,void 0!==M?M:t.collisionBoxArray.length,void 0!==M?M+1:t.collisionBoxArray.length,void 0!==z?z:t.collisionBoxArray.length,void 0!==z?z+1:t.collisionBoxArray.length,T||t.collisionBoxArray.length,T?T+1:t.collisionBoxArray.length,c,V,F,E,D,G,0,O,j,q);}(t,o,x,a,r,n,i,M,t.layers[0],t.collisionBoxArray,e.index,e.sourceLayerIndex,t.index,b,A,l,0,w,k,y,e,s,u,c,h);};if("line"===S)for(const i of dh(e.geometry,0,0,To,To)){const e=hh(i,v,_,r.vertical||m,n,24,x,t.overscaling,To);for(const r of e){const e=m;e&&Oh(t,e.text,I,r)||T(i,r,h);}}else if("line-center"===S){for(const t of e.geometry)if(t.length>1){const e=ch(t,_,r.vertical||m,n,24,x);e&&T(t,e,h);}}else if("Polygon"===e.type)for(const t of pu(e.geometry,0)){const e=zh(t,16);T(t[0],new sh(e.x,e.y,0,0,void 0),h);}else if("LineString"===e.type)for(const t of e.geometry)T(t,new sh(t[0].x,t[0].y,0,0,void 0),h);else if("Point"===e.type)for(const t of e.geometry)for(const e of t)T([e],new sh(e.x,e.y,0,0,void 0),h);}const Fh=32640;function Lh(t,e,r,n,s,a,o,l,u,c,h,p,d,f,y,m,g){const x=function(t,e,r,n,s,a,o,l){const u=[];if(0===e.positionedLines.length)return u;const c=n.layout.get("text-rotate").evaluate(a,{})*Math.PI/180,h=function(t){const e=t[0],r=t[1],n=e*r;return n>0?[e,-r]:n<0?[-e,r]:0===e?[r,e]:[r,-e]}(r);let p=Math.abs(e.top-e.bottom);for(const t of e.positionedLines)p-=t.lineOffset;const d=e.positionedLines.length,f=p/d;let y=e.top-r[1];for(let t=0;t<d;++t){const n=e.positionedLines[t];y=kh(e,f,y,t);for(const t of n.positionedGlyphs){if(!t.rect)continue;const n=t.rect||{};let a=4,p=!0,d=1,f=0;if(t.imageName){const e=o[t.imageName];if(!e)continue;if(e.sdf){pt("SDF images are not supported in formatted text and will be ignored.");continue}p=!1,d=e.pixelRatio,a=1/d;}const m=(s||l)&&t.vertical,g=t.metrics.advance*t.scale/2,x=t.metrics,v=t.rect;if(null===v)continue;l&&e.verticalizable&&(f=t.imageName?g-t.metrics.width*t.scale/2:0);const b=s?[t.x+g,t.y]:[0,0];let w=[0,0],_=[0,0],A=!1;s||(m?(_=[t.x+g+h[0],t.y+h[1]-f],A=!0):w=[t.x+g+r[0],t.y+r[1]-f]);const k=v.w*t.scale/(d*(t.localGlyph?2:1)),S=v.h*t.scale/(d*(t.localGlyph?2:1));let I,z,M,T;if(m){const e=t.y-y,r=new i(-g,g-e),n=-Math.PI/2,s=new i(..._);I=new i(-g+w[0],w[1]),I._rotateAround(n,r)._add(s),I.x+=-e+g,I.y-=(x.left-a)*t.scale;const o=t.imageName?x.advance*t.scale:sc*t.scale,l=String.fromCharCode(t.glyph);dc(l)?I.x+=(1-a)*t.scale:fc(l)?I.x+=o-x.height*t.scale+(-a-1)*t.scale:I.x+=t.imageName||x.width+2*a===v.w&&x.height+2*a===v.h?(o-S)/2:(o-(x.height+2*a)*t.scale)/2,z=new i(I.x,I.y-k),M=new i(I.x+S,I.y),T=new i(I.x+S,I.y-k);}else {const e=(x.left-a)*t.scale-g+w[0],r=(-x.top-a)*t.scale+w[1],n=e+k,s=r+S;I=new i(e,r),z=new i(n,r),M=new i(e,s),T=new i(n,s);}if(c){let t;t=s?new i(0,0):A?new i(h[0],h[1]):new i(r[0],r[1]),I._rotateAround(c,t),z._rotateAround(c,t),M._rotateAround(c,t),T._rotateAround(c,t);}const B=new i(0,0),C=new i(0,0);u.push({tl:I,tr:z,bl:M,br:T,tex:n,writingMode:e.writingMode,glyphOffset:b,sectionIndex:t.sectionIndex,isSDF:p,pixelOffsetTL:B,pixelOffsetBR:C,minFontScaleX:0,minFontScaleY:0});}}return u}(0,n,u,a,o,l,s,t.allowVerticalPlacement),v=t.textSizeData;let b=null;"source"===v.kind?(b=[ac*a.layout.get("text-size").evaluate(l,{},g)],b[0]>Fh&&pt(`${t.layerIds[0]}: Value for "text-size" is >= 255. Reduce your "text-size".`)):"composite"===v.kind&&(b=[ac*y.compositeTextSizes[0].evaluate(l,{},g),ac*y.compositeTextSizes[1].evaluate(l,{},g)],(b[0]>Fh||b[1]>Fh)&&pt(`${t.layerIds[0]}: Value for "text-size" is >= 255. Reduce your "text-size".`)),t.addSymbols(t.text,x,b,u,o,l,h,e,r,c.lineStartIndex,c.lineLength,f,m,g);for(const e of p)d[e]=t.text.placedSymbolArray.length-1;return 4*x.length}function Rh(t){for(const e in t)return t[e];return null}function Uh(t,e,r,n,s,a,o,l,u,c){let h=o.top,p=o.bottom,d=o.left,f=o.right;const y=o.collisionPadding;if(y&&(d-=y[0],h-=y[1],f+=y[2],p+=y[3]),u){const t=new i(d,h),e=new i(f,h),r=new i(d,p),n=new i(f,p),s=q(u);let a=new i(0,0);c&&(a=new i(c[0],c[1])),t._rotateAround(s,a),e._rotateAround(s,a),r._rotateAround(s,a),n._rotateAround(s,a),d=Math.min(t.x,e.x,r.x,n.x),f=Math.max(t.x,e.x,r.x,n.x),h=Math.min(t.y,e.y,r.y,n.y),p=Math.max(t.y,e.y,r.y,n.y);}return t.emplaceBack(e.x,e.y,e.z,r.x,r.y,d,h,f,p,l,n,s,a),t.length-1}function $h(t){t.collisionPadding&&(t.top-=t.collisionPadding[1],t.bottom+=t.collisionPadding[3]);const e=t.bottom-t.top;return e>0?Math.max(10,e):null}function Oh(t,e,r,n){const i=t.compareText;if(e in i){const t=i[e];for(let e=t.length-1;e>=0;e--)if(n.dist(t[e])<r)return !0}else i[e]=[];return i[e].push(n),!1}const jh=Bu.VectorTileFeature.types,qh=[{name:"a_fade_opacity",components:1,type:"Uint8",offset:0}];function Nh(t,e,r,n,i,s,a,o,l,u,c,h,p,d,f,y){const m=c?Math.min(Fh,Math.round(c[0])):0,g=c?Math.min(Fh,Math.round(c[1])):0;t.emplaceBack(e,r,Math.round(32*a),Math.round(32*o),l,u,(m<<1)+(h?1:0),g,16*p,16*d,256*f,256*y,n,i,s,0);}function Gh(t,e,r){t.emplaceBack(e.x,e.y,r),t.emplaceBack(e.x,e.y,r),t.emplaceBack(e.x,e.y,r),t.emplaceBack(e.x,e.y,r);}function Zh(t){for(const e of t.sections)if(Ps(e.text))return !0;return !1}class Xh{constructor(t){this.layoutVertexArray=new xa,this.indexArray=new ka,this.programConfigurations=t,this.segments=new Mo,this.dynamicLayoutVertexArray=new ya,this.opacityVertexArray=new va,this.placedSymbolArray=new Ra;}isEmpty(){return 0===this.layoutVertexArray.length&&0===this.indexArray.length&&0===this.dynamicLayoutVertexArray.length&&0===this.opacityVertexArray.length}upload(t,e,r,n){this.isEmpty()||(r&&(this.layoutVertexBuffer=t.createVertexBuffer(this.layoutVertexArray,Qu.members),this.indexBuffer=t.createIndexBuffer(this.indexArray,e),this.dynamicLayoutVertexBuffer=t.createVertexBuffer(this.dynamicLayoutVertexArray,tc.members,!0),this.opacityVertexBuffer=t.createVertexBuffer(this.opacityVertexArray,qh,!0),this.opacityVertexBuffer.itemSize=1),(r||n)&&this.programConfigurations.upload(t));}destroy(){this.layoutVertexBuffer&&(this.layoutVertexBuffer.destroy(),this.indexBuffer.destroy(),this.programConfigurations.destroy(),this.segments.destroy(),this.dynamicLayoutVertexBuffer.destroy(),this.opacityVertexBuffer.destroy());}}Zi("SymbolBuffers",Xh);class Kh{constructor(t,e,r){this.layoutVertexArray=new t,this.layoutAttributes=e,this.indexArray=new r,this.segments=new Mo,this.collisionVertexArray=new Aa,this.collisionVertexArrayExt=new ya;}upload(t){this.layoutVertexBuffer=t.createVertexBuffer(this.layoutVertexArray,this.layoutAttributes),this.indexBuffer=t.createIndexBuffer(this.indexArray),this.collisionVertexBuffer=t.createVertexBuffer(this.collisionVertexArray,ec.members,!0),this.collisionVertexBufferExt=t.createVertexBuffer(this.collisionVertexArrayExt,rc.members,!0);}destroy(){this.layoutVertexBuffer&&(this.layoutVertexBuffer.destroy(),this.indexBuffer.destroy(),this.segments.destroy(),this.collisionVertexBuffer.destroy(),this.collisionVertexBufferExt.destroy());}}Zi("CollisionBuffers",Kh);class Yh{constructor(t){this.collisionBoxArray=t.collisionBoxArray,this.zoom=t.zoom,this.overscaling=t.overscaling,this.layers=t.layers,this.layerIds=this.layers.map((t=>t.id)),this.index=t.index,this.pixelRatio=t.pixelRatio,this.sourceLayerIndex=t.sourceLayerIndex,this.hasPattern=!1,this.hasRTLText=!1,this.fullyClipped=!1,this.sortKeyRanges=[],this.collisionCircleArray=[],this.placementInvProjMatrix=c([]),this.placementViewportMatrix=c([]);const e=this.layers[0]._unevaluatedLayout._values;this.textSizeData=oc(this.zoom,e["text-size"]),this.iconSizeData=oc(this.zoom,e["icon-size"]);const r=this.layers[0].layout,n=r.get("symbol-sort-key"),i=r.get("symbol-z-order");this.canOverlap=r.get("text-allow-overlap")||r.get("icon-allow-overlap")||r.get("text-ignore-placement")||r.get("icon-ignore-placement"),this.sortFeaturesByKey="viewport-y"!==i&&void 0!==n.constantOr(1),this.sortFeaturesByY=("viewport-y"===i||"auto"===i&&!this.sortFeaturesByKey)&&this.canOverlap,this.writingModes=r.get("text-writing-mode").map((t=>qc[t])),this.stateDependentLayerIds=this.layers.filter((t=>t.isStateDependent())).map((t=>t.id)),this.sourceID=t.sourceID;}createArrays(){this.text=new Xh(new xo(this.layers,this.zoom,(t=>/^text/.test(t)))),this.icon=new Xh(new xo(this.layers,this.zoom,(t=>/^icon/.test(t)))),this.glyphOffsetArray=new Oa,this.lineVertexArray=new ja,this.symbolInstances=new $a;}calculateGlyphDependencies(t,e,r,n,i){for(let r=0;r<t.length;r++)if(e[t.charCodeAt(r)]=!0,n&&i){const n=pc[t.charAt(r)];n&&(e[n.charCodeAt(0)]=!0);}}populate(t,e,r,n){const i=this.layers[0],s=i.layout,a=s.get("text-font"),o=s.get("text-field"),l=s.get("icon-image"),u=("constant"!==o.value.kind||o.value.value instanceof Ke&&!o.value.value.isEmpty()||o.value.value.toString().length>0)&&("constant"!==a.value.kind||a.value.value.length>0),c="constant"!==l.value.kind||!!l.value.value||Object.keys(l.parameters).length>0,h=s.get("symbol-sort-key");if(this.features=[],!u&&!c)return;const p=e.iconDependencies,d=e.glyphDependencies,f=e.availableImages,y=new Gs(this.zoom);for(const{feature:e,id:o,index:l,sourceLayerIndex:m}of t){const t=i._featureFilter.needGeometry,g=Yo(e,t);if(!i._featureFilter.filter(y,g,r))continue;let x,v;if(t||(g.geometry=Ko(e,r,n)),u){const t=i.getValueAndResolveTokens("text-field",g,r,f),e=Ke.factory(t);Zh(e)&&(this.hasRTLText=!0),(!this.hasRTLText||"unavailable"===js()||this.hasRTLText&&Ns.isParsed())&&(x=hc(e,i,g));}if(c){const t=i.getValueAndResolveTokens("icon-image",g,r,f);v=t instanceof Ye?t:Ye.fromString(t);}if(!x&&!v)continue;const b=this.sortFeaturesByKey?h.evaluate(g,{},r):void 0;if(this.features.push({id:o,text:x,icon:v,index:l,sourceLayerIndex:m,geometry:g.geometry,properties:e.properties,type:jh[e.type],sortKey:b}),v&&(p[v.name]=!0),x){const t=a.evaluate(g,{},r).join(","),e="map"===s.get("text-rotation-alignment")&&"point"!==s.get("symbol-placement");this.allowVerticalPlacement=this.writingModes&&this.writingModes.indexOf(qc.vertical)>=0;for(const r of x.sections)if(r.image)p[r.image.name]=!0;else {const n=Ss(x.toString()),i=r.fontStack||t,s=d[i]=d[i]||{};this.calculateGlyphDependencies(r.text,s,e,this.allowVerticalPlacement,n);}}}"line"===s.get("symbol-placement")&&(this.features=function(t){const e={},r={},n=[];let i=0;function s(e){n.push(t[e]),i++;}function a(t,e,i){const s=r[t];return delete r[t],r[e]=s,n[s].geometry[0].pop(),n[s].geometry[0]=n[s].geometry[0].concat(i[0]),s}function o(t,r,i){const s=e[r];return delete e[r],e[t]=s,n[s].geometry[0].shift(),n[s].geometry[0]=i[0].concat(n[s].geometry[0]),s}function l(t,e,r){const n=r?e[0][e[0].length-1]:e[0][0];return `${t}:${n.x}:${n.y}`}for(let u=0;u<t.length;u++){const c=t[u],h=c.geometry,p=c.text?c.text.toString():null;if(!p){s(u);continue}const d=l(p,h),f=l(p,h,!0);if(d in r&&f in e&&r[d]!==e[f]){const t=o(d,f,h),i=a(d,f,n[t].geometry);delete e[d],delete r[f],r[l(p,n[i].geometry,!0)]=i,n[t].geometry=null;}else d in r?a(d,f,h):f in e?o(d,f,h):(s(u),e[d]=i-1,r[f]=i-1);}return n.filter((t=>t.geometry))}(this.features)),this.sortFeaturesByKey&&this.features.sort(((t,e)=>t.sortKey-e.sortKey));}update(t,e,r,n){this.stateDependentLayers.length&&(this.text.programConfigurations.updatePaintArrays(t,e,this.layers,r,n),this.icon.programConfigurations.updatePaintArrays(t,e,this.layers,r,n));}isEmpty(){return 0===this.symbolInstances.length&&!this.hasRTLText}uploadPending(){return !this.uploaded||this.text.programConfigurations.needsUpload||this.icon.programConfigurations.needsUpload}upload(t){!this.uploaded&&this.hasDebugData()&&(this.textCollisionBox.upload(t),this.iconCollisionBox.upload(t)),this.text.upload(t,this.sortFeaturesByY,!this.uploaded,this.text.programConfigurations.needsUpload),this.icon.upload(t,this.sortFeaturesByY,!this.uploaded,this.icon.programConfigurations.needsUpload),this.uploaded=!0;}destroyDebugData(){this.textCollisionBox.destroy(),this.iconCollisionBox.destroy();}destroy(){this.text.destroy(),this.icon.destroy(),this.hasDebugData()&&this.destroyDebugData();}addToLineVertexArray(t,e){const r=this.lineVertexArray.length;if(void 0!==t.segment){let r=t.dist(e[t.segment+1]),n=t.dist(e[t.segment]);const i={};for(let n=t.segment+1;n<e.length;n++)i[n]={x:e[n].x,y:e[n].y,tileUnitDistanceFromAnchor:r},n<e.length-1&&(r+=e[n+1].dist(e[n]));for(let r=t.segment||0;r>=0;r--)i[r]={x:e[r].x,y:e[r].y,tileUnitDistanceFromAnchor:n},r>0&&(n+=e[r-1].dist(e[r]));for(let t=0;t<e.length;t++){const e=i[t];this.lineVertexArray.emplaceBack(e.x,e.y,e.tileUnitDistanceFromAnchor);}}return {lineStartIndex:r,lineLength:this.lineVertexArray.length-r}}addSymbols(t,e,r,n,i,s,a,o,l,u,c,h,p,d){const f=t.indexArray,y=t.layoutVertexArray,m=t.segments.prepareSegment(4*e.length,y,f,this.canOverlap?s.sortKey:void 0),g=this.glyphOffsetArray.length,x=m.vertexLength,v=this.allowVerticalPlacement&&a===qc.vertical?Math.PI/2:0,b=s.text&&s.text.sections;for(let n=0;n<e.length;n++){const{tl:i,tr:a,bl:u,br:c,tex:h,pixelOffsetTL:g,pixelOffsetBR:x,minFontScaleX:w,minFontScaleY:_,glyphOffset:A,isSDF:k,sectionIndex:S}=e[n],I=m.vertexLength,z=A[1];Nh(y,o.x,o.y,o.z,l.x,l.y,i.x,z+i.y,h.x,h.y,r,k,g.x,g.y,w,_),Nh(y,o.x,o.y,o.z,l.x,l.y,a.x,z+a.y,h.x+h.w,h.y,r,k,x.x,g.y,w,_),Nh(y,o.x,o.y,o.z,l.x,l.y,u.x,z+u.y,h.x,h.y+h.h,r,k,g.x,x.y,w,_),Nh(y,o.x,o.y,o.z,l.x,l.y,c.x,z+c.y,h.x+h.w,h.y+h.h,r,k,x.x,x.y,w,_),Gh(t.dynamicLayoutVertexArray,o,v),f.emplaceBack(I,I+1,I+2),f.emplaceBack(I+1,I+2,I+3),m.vertexLength+=4,m.primitiveLength+=2,this.glyphOffsetArray.emplaceBack(A[0]),n!==e.length-1&&S===e[n+1].sectionIndex||t.programConfigurations.populatePaintArrays(y.length,s,s.index,{},p,d,b&&b[S]);}t.placedSymbolArray.emplaceBack(o.x,o.y,o.z,l.x,l.y,g,this.glyphOffsetArray.length-g,x,u,c,l.segment,r?r[0]:0,r?r[1]:0,n[0],n[1],a,0,!1,0,h,0);}_commitLayoutVertex(t,e,r,n,i,s,a){t.emplaceBack(e,r,n,i,s,Math.round(a.x),Math.round(a.y));}_addCollisionDebugVertices(t,e,r,n,s,a,o){const l=r.segments.prepareSegment(4,r.layoutVertexArray,r.indexArray),u=l.vertexLength,c=o.tileAnchorX,h=o.tileAnchorY;for(let t=0;t<4;t++)r.collisionVertexArray.emplaceBack(0,0,0,0);r.collisionVertexArrayExt.emplaceBack(e,-t.padding,-t.padding),r.collisionVertexArrayExt.emplaceBack(e,t.padding,-t.padding),r.collisionVertexArrayExt.emplaceBack(e,t.padding,t.padding),r.collisionVertexArrayExt.emplaceBack(e,-t.padding,t.padding),this._commitLayoutVertex(r.layoutVertexArray,n,s,a,c,h,new i(t.x1,t.y1)),this._commitLayoutVertex(r.layoutVertexArray,n,s,a,c,h,new i(t.x2,t.y1)),this._commitLayoutVertex(r.layoutVertexArray,n,s,a,c,h,new i(t.x2,t.y2)),this._commitLayoutVertex(r.layoutVertexArray,n,s,a,c,h,new i(t.x1,t.y2)),l.vertexLength+=4;const p=r.indexArray;p.emplaceBack(u,u+1),p.emplaceBack(u+1,u+2),p.emplaceBack(u+2,u+3),p.emplaceBack(u+3,u),l.primitiveLength+=4;}_addTextDebugCollisionBoxes(t,e,r,n,i,s){for(let a=n;a<i;a++){const n=r.get(a),i=this.getSymbolInstanceTextSize(t,s,e,a);this._addCollisionDebugVertices(n,i,this.textCollisionBox,n.projectedAnchorX,n.projectedAnchorY,n.projectedAnchorZ,s);}}_addIconDebugCollisionBoxes(t,e,r,n,i,s){for(let a=n;a<i;a++){const n=r.get(a),i=this.getSymbolInstanceIconSize(t,e,a);this._addCollisionDebugVertices(n,i,this.iconCollisionBox,n.projectedAnchorX,n.projectedAnchorY,n.projectedAnchorZ,s);}}generateCollisionDebugBuffers(t,e){this.hasDebugData()&&this.destroyDebugData(),this.textCollisionBox=new Kh(wa,nc.members,Ca),this.iconCollisionBox=new Kh(wa,nc.members,Ca);const r=uc(this.iconSizeData,t),n=uc(this.textSizeData,t);for(let i=0;i<this.symbolInstances.length;i++){const s=this.symbolInstances.get(i);this._addTextDebugCollisionBoxes(n,t,e,s.textBoxStartIndex,s.textBoxEndIndex,s),this._addTextDebugCollisionBoxes(n,t,e,s.verticalTextBoxStartIndex,s.verticalTextBoxEndIndex,s),this._addIconDebugCollisionBoxes(r,t,e,s.iconBoxStartIndex,s.iconBoxEndIndex,s),this._addIconDebugCollisionBoxes(r,t,e,s.verticalIconBoxStartIndex,s.verticalIconBoxEndIndex,s);}}getSymbolInstanceTextSize(t,e,r,n){const i=this.text.placedSymbolArray.get(e.rightJustifiedTextSymbolIndex>=0?e.rightJustifiedTextSymbolIndex:e.centerJustifiedTextSymbolIndex>=0?e.centerJustifiedTextSymbolIndex:e.leftJustifiedTextSymbolIndex>=0?e.leftJustifiedTextSymbolIndex:e.verticalPlacedTextSymbolIndex>=0?e.verticalPlacedTextSymbolIndex:n),s=lc(this.textSizeData,t,i)/sc;return this.tilePixelRatio*s}getSymbolInstanceIconSize(t,e,r){const n=this.icon.placedSymbolArray.get(r),i=lc(this.iconSizeData,t,n);return this.tilePixelRatio*i}_commitDebugCollisionVertexUpdate(t,e,r){t.emplaceBack(e,-r,-r),t.emplaceBack(e,r,-r),t.emplaceBack(e,r,r),t.emplaceBack(e,-r,r);}_updateTextDebugCollisionBoxes(t,e,r,n,i,s){for(let a=n;a<i;a++){const n=r.get(a),i=this.getSymbolInstanceTextSize(t,s,e,a);this._commitDebugCollisionVertexUpdate(this.textCollisionBox.collisionVertexArrayExt,i,n.padding);}}_updateIconDebugCollisionBoxes(t,e,r,n,i){for(let s=n;s<i;s++){const n=r.get(s),i=this.getSymbolInstanceIconSize(t,e,s);this._commitDebugCollisionVertexUpdate(this.iconCollisionBox.collisionVertexArrayExt,i,n.padding);}}updateCollisionDebugBuffers(t,e){if(!this.hasDebugData())return;this.hasTextCollisionBoxData()&&this.textCollisionBox.collisionVertexArrayExt.clear(),this.hasIconCollisionBoxData()&&this.iconCollisionBox.collisionVertexArrayExt.clear();const r=uc(this.iconSizeData,t),n=uc(this.textSizeData,t);for(let i=0;i<this.symbolInstances.length;i++){const s=this.symbolInstances.get(i);this._updateTextDebugCollisionBoxes(n,t,e,s.textBoxStartIndex,s.textBoxEndIndex,s),this._updateTextDebugCollisionBoxes(n,t,e,s.verticalTextBoxStartIndex,s.verticalTextBoxEndIndex,s),this._updateIconDebugCollisionBoxes(r,t,e,s.iconBoxStartIndex,s.iconBoxEndIndex),this._updateIconDebugCollisionBoxes(r,t,e,s.verticalIconBoxStartIndex,s.verticalIconBoxEndIndex);}this.hasTextCollisionBoxData()&&this.textCollisionBox.collisionVertexBufferExt&&this.textCollisionBox.collisionVertexBufferExt.updateData(this.textCollisionBox.collisionVertexArrayExt),this.hasIconCollisionBoxData()&&this.iconCollisionBox.collisionVertexBufferExt&&this.iconCollisionBox.collisionVertexBufferExt.updateData(this.iconCollisionBox.collisionVertexArrayExt);}_deserializeCollisionBoxesForSymbol(t,e,r,n,i,s,a,o,l){const u={};for(let n=e;n<r;n++){const e=t.get(n);u.textBox={x1:e.x1,y1:e.y1,x2:e.x2,y2:e.y2,padding:e.padding,projectedAnchorX:e.projectedAnchorX,projectedAnchorY:e.projectedAnchorY,projectedAnchorZ:e.projectedAnchorZ,tileAnchorX:e.tileAnchorX,tileAnchorY:e.tileAnchorY},u.textFeatureIndex=e.featureIndex;break}for(let e=n;e<i;e++){const r=t.get(e);u.verticalTextBox={x1:r.x1,y1:r.y1,x2:r.x2,y2:r.y2,padding:r.padding,projectedAnchorX:r.projectedAnchorX,projectedAnchorY:r.projectedAnchorY,projectedAnchorZ:r.projectedAnchorZ,tileAnchorX:r.tileAnchorX,tileAnchorY:r.tileAnchorY},u.verticalTextFeatureIndex=r.featureIndex;break}for(let e=s;e<a;e++){const r=t.get(e);u.iconBox={x1:r.x1,y1:r.y1,x2:r.x2,y2:r.y2,padding:r.padding,projectedAnchorX:r.projectedAnchorX,projectedAnchorY:r.projectedAnchorY,projectedAnchorZ:r.projectedAnchorZ,tileAnchorX:r.tileAnchorX,tileAnchorY:r.tileAnchorY},u.iconFeatureIndex=r.featureIndex;break}for(let e=o;e<l;e++){const r=t.get(e);u.verticalIconBox={x1:r.x1,y1:r.y1,x2:r.x2,y2:r.y2,padding:r.padding,projectedAnchorX:r.projectedAnchorX,projectedAnchorY:r.projectedAnchorY,projectedAnchorZ:r.projectedAnchorZ,tileAnchorX:r.tileAnchorX,tileAnchorY:r.tileAnchorY},u.verticalIconFeatureIndex=r.featureIndex;break}return u}deserializeCollisionBoxes(t){this.collisionArrays=[];for(let e=0;e<this.symbolInstances.length;e++){const r=this.symbolInstances.get(e);this.collisionArrays.push(this._deserializeCollisionBoxesForSymbol(t,r.textBoxStartIndex,r.textBoxEndIndex,r.verticalTextBoxStartIndex,r.verticalTextBoxEndIndex,r.iconBoxStartIndex,r.iconBoxEndIndex,r.verticalIconBoxStartIndex,r.verticalIconBoxEndIndex));}}hasTextData(){return this.text.segments.get().length>0}hasIconData(){return this.icon.segments.get().length>0}hasDebugData(){return this.textCollisionBox&&this.iconCollisionBox}hasTextCollisionBoxData(){return this.hasDebugData()&&this.textCollisionBox.segments.get().length>0}hasIconCollisionBoxData(){return this.hasDebugData()&&this.iconCollisionBox.segments.get().length>0}addIndicesForPlacedSymbol(t,e){const r=t.placedSymbolArray.get(e),n=r.vertexStartIndex+4*r.numGlyphs;for(let e=r.vertexStartIndex;e<n;e+=4)t.indexArray.emplaceBack(e,e+1,e+2),t.indexArray.emplaceBack(e+1,e+2,e+3);}getSortedSymbolIndexes(t){if(this.sortedAngle===t&&void 0!==this.symbolInstanceIndexes)return this.symbolInstanceIndexes;const e=Math.sin(t),r=Math.cos(t),n=[],i=[],s=[];for(let t=0;t<this.symbolInstances.length;++t){s.push(t);const a=this.symbolInstances.get(t);n.push(0|Math.round(e*a.tileAnchorX+r*a.tileAnchorY)),i.push(a.featureIndex);}return s.sort(((t,e)=>n[t]-n[e]||i[e]-i[t])),s}addToSortKeyRanges(t,e){const r=this.sortKeyRanges[this.sortKeyRanges.length-1];r&&r.sortKey===e?r.symbolInstanceEnd=t+1:this.sortKeyRanges.push({sortKey:e,symbolInstanceStart:t,symbolInstanceEnd:t+1});}sortFeatures(t){if(this.sortFeaturesByY&&this.sortedAngle!==t&&!(this.text.segments.get().length>1||this.icon.segments.get().length>1)){this.symbolInstanceIndexes=this.getSortedSymbolIndexes(t),this.sortedAngle=t,this.text.indexArray.clear(),this.icon.indexArray.clear(),this.featureSortOrder=[];for(const t of this.symbolInstanceIndexes){const e=this.symbolInstances.get(t);this.featureSortOrder.push(e.featureIndex),[e.rightJustifiedTextSymbolIndex,e.centerJustifiedTextSymbolIndex,e.leftJustifiedTextSymbolIndex].forEach(((t,e,r)=>{t>=0&&r.indexOf(t)===e&&this.addIndicesForPlacedSymbol(this.text,t);})),e.verticalPlacedTextSymbolIndex>=0&&this.addIndicesForPlacedSymbol(this.text,e.verticalPlacedTextSymbolIndex),e.placedIconSymbolIndex>=0&&this.addIndicesForPlacedSymbol(this.icon,e.placedIconSymbolIndex),e.verticalPlacedIconSymbolIndex>=0&&this.addIndicesForPlacedSymbol(this.icon,e.verticalPlacedIconSymbolIndex);}this.text.indexBuffer&&this.text.indexBuffer.updateData(this.text.indexArray),this.icon.indexBuffer&&this.icon.indexBuffer.updateData(this.icon.indexArray);}}}Zi("SymbolBucket",Yh,{omit:["layers","collisionBoxArray","features","compareText"]}),Yh.MAX_GLYPHS=65535,Yh.addDynamicAttributes=Gh;const Hh=new sa({"symbol-placement":new ta(ve.layout_symbol["symbol-placement"]),"symbol-spacing":new ta(ve.layout_symbol["symbol-spacing"]),"symbol-avoid-edges":new ta(ve.layout_symbol["symbol-avoid-edges"]),"symbol-sort-key":new ea(ve.layout_symbol["symbol-sort-key"]),"symbol-z-order":new ta(ve.layout_symbol["symbol-z-order"]),"icon-allow-overlap":new ta(ve.layout_symbol["icon-allow-overlap"]),"icon-ignore-placement":new ta(ve.layout_symbol["icon-ignore-placement"]),"icon-optional":new ta(ve.layout_symbol["icon-optional"]),"icon-rotation-alignment":new ta(ve.layout_symbol["icon-rotation-alignment"]),"icon-size":new ea(ve.layout_symbol["icon-size"]),"icon-text-fit":new ta(ve.layout_symbol["icon-text-fit"]),"icon-text-fit-padding":new ta(ve.layout_symbol["icon-text-fit-padding"]),"icon-image":new ea(ve.layout_symbol["icon-image"]),"icon-rotate":new ea(ve.layout_symbol["icon-rotate"]),"icon-padding":new ta(ve.layout_symbol["icon-padding"]),"icon-keep-upright":new ta(ve.layout_symbol["icon-keep-upright"]),"icon-offset":new ea(ve.layout_symbol["icon-offset"]),"icon-anchor":new ea(ve.layout_symbol["icon-anchor"]),"icon-pitch-alignment":new ta(ve.layout_symbol["icon-pitch-alignment"]),"text-pitch-alignment":new ta(ve.layout_symbol["text-pitch-alignment"]),"text-rotation-alignment":new ta(ve.layout_symbol["text-rotation-alignment"]),"text-field":new ea(ve.layout_symbol["text-field"]),"text-font":new ea(ve.layout_symbol["text-font"]),"text-size":new ea(ve.layout_symbol["text-size"]),"text-max-width":new ea(ve.layout_symbol["text-max-width"]),"text-line-height":new ea(ve.layout_symbol["text-line-height"]),"text-letter-spacing":new ea(ve.layout_symbol["text-letter-spacing"]),"text-justify":new ea(ve.layout_symbol["text-justify"]),"text-radial-offset":new ea(ve.layout_symbol["text-radial-offset"]),"text-variable-anchor":new ta(ve.layout_symbol["text-variable-anchor"]),"text-anchor":new ea(ve.layout_symbol["text-anchor"]),"text-max-angle":new ta(ve.layout_symbol["text-max-angle"]),"text-writing-mode":new ta(ve.layout_symbol["text-writing-mode"]),"text-rotate":new ea(ve.layout_symbol["text-rotate"]),"text-padding":new ta(ve.layout_symbol["text-padding"]),"text-keep-upright":new ta(ve.layout_symbol["text-keep-upright"]),"text-transform":new ea(ve.layout_symbol["text-transform"]),"text-offset":new ea(ve.layout_symbol["text-offset"]),"text-allow-overlap":new ta(ve.layout_symbol["text-allow-overlap"]),"text-ignore-placement":new ta(ve.layout_symbol["text-ignore-placement"]),"text-optional":new ta(ve.layout_symbol["text-optional"])});var Jh={paint:new sa({"icon-opacity":new ea(ve.paint_symbol["icon-opacity"]),"icon-color":new ea(ve.paint_symbol["icon-color"]),"icon-halo-color":new ea(ve.paint_symbol["icon-halo-color"]),"icon-halo-width":new ea(ve.paint_symbol["icon-halo-width"]),"icon-halo-blur":new ea(ve.paint_symbol["icon-halo-blur"]),"icon-translate":new ta(ve.paint_symbol["icon-translate"]),"icon-translate-anchor":new ta(ve.paint_symbol["icon-translate-anchor"]),"text-opacity":new ea(ve.paint_symbol["text-opacity"]),"text-color":new ea(ve.paint_symbol["text-color"],{runtimeType:Ce,getOverride:t=>t.textColor,hasOverride:t=>!!t.textColor}),"text-halo-color":new ea(ve.paint_symbol["text-halo-color"]),"text-halo-width":new ea(ve.paint_symbol["text-halo-width"]),"text-halo-blur":new ea(ve.paint_symbol["text-halo-blur"]),"text-translate":new ta(ve.paint_symbol["text-translate"]),"text-translate-anchor":new ta(ve.paint_symbol["text-translate-anchor"])}),layout:Hh};class Wh{constructor(t){this.type=t.property.overrides?t.property.overrides.runtimeType:ze,this.defaultValue=t;}evaluate(t){if(t.formattedSection){const e=this.defaultValue.property.overrides;if(e&&e.hasOverride(t.formattedSection))return e.getOverride(t.formattedSection)}return t.feature&&t.featureState?this.defaultValue.evaluate(t.feature,t.featureState):this.defaultValue.property.specification.default}eachChild(t){this.defaultValue.isConstant()||t(this.defaultValue.value._styleExpression.expression);}outputDefined(){return !1}serialize(){return null}}Zi("FormatSectionOverride",Wh,{omit:["defaultValue"]});class Qh extends So{constructor(t){super(t,Jh);}recalculate(t,e){super.recalculate(t,e),"auto"===this.layout.get("icon-rotation-alignment")&&(this.layout._values["icon-rotation-alignment"]="point"!==this.layout.get("symbol-placement")?"map":"viewport"),"auto"===this.layout.get("text-rotation-alignment")&&(this.layout._values["text-rotation-alignment"]="point"!==this.layout.get("symbol-placement")?"map":"viewport"),"auto"===this.layout.get("text-pitch-alignment")&&(this.layout._values["text-pitch-alignment"]=this.layout.get("text-rotation-alignment")),"auto"===this.layout.get("icon-pitch-alignment")&&(this.layout._values["icon-pitch-alignment"]=this.layout.get("icon-rotation-alignment"));const r=this.layout.get("text-writing-mode");if(r){const t=[];for(const e of r)t.indexOf(e)<0&&t.push(e);this.layout._values["text-writing-mode"]=t;}else this.layout._values["text-writing-mode"]="point"===this.layout.get("symbol-placement")?["horizontal"]:["horizontal","vertical"];this._setPaintOverrides();}getValueAndResolveTokens(t,e,r,n){const i=this.layout.get(t).evaluate(e,{},r,n),s=this._unevaluatedLayout._values[t];return s.isDataDriven()||Nn(s.value)||!i?i:function(t,e){return e.replace(/{([^{}]+)}/g,((e,r)=>r in t?String(t[r]):""))}(e.properties,i)}createBucket(t){return new Yh(t)}queryRadius(){return 0}queryIntersectsFeature(){return !1}_setPaintOverrides(){for(const t of Jh.paint.overridableProperties){if(!Qh.hasPaintOverride(this.layout,t))continue;const e=this.paint.get(t),r=new Wh(e),n=new qn(r,e.property.specification);let i=null;i="constant"===e.value.kind||"source"===e.value.kind?new Zn("source",n):new Xn("composite",n,e.value.zoomStops,e.value._interpolationType),this.paint._values[t]=new Ws(e.property,i,e.parameters);}}_handleOverridablePaintPropertyUpdate(t,e,r){return !(!this.layout||e.isDataDriven()||r.isDataDriven())&&Qh.hasPaintOverride(this.layout,t)}static hasPaintOverride(t,e){const r=t.get("text-field"),n=Jh.paint.properties[e];let i=!1;const s=t=>{for(const e of t)if(n.overrides&&n.overrides.hasOverride(e))return void(i=!0)};if("constant"===r.value.kind&&r.value.value instanceof Ke)s(r.value.value.sections);else if("source"===r.value.kind){const t=e=>{i||(e instanceof tr&&We(e.value)===Ve?s(e.value.sections):e instanceof ir?s(e.sections):e.eachChild(t));},e=r.value;e._styleExpression&&t(e._styleExpression.expression);}return i}getProgramConfiguration(t){return new go(this,t)}}var tp={paint:new sa({"background-color":new ta(ve.paint_background["background-color"]),"background-pattern":new na(ve.paint_background["background-pattern"]),"background-opacity":new ta(ve.paint_background["background-opacity"])})},ep={paint:new sa({"raster-opacity":new ta(ve.paint_raster["raster-opacity"]),"raster-hue-rotate":new ta(ve.paint_raster["raster-hue-rotate"]),"raster-brightness-min":new ta(ve.paint_raster["raster-brightness-min"]),"raster-brightness-max":new ta(ve.paint_raster["raster-brightness-max"]),"raster-saturation":new ta(ve.paint_raster["raster-saturation"]),"raster-contrast":new ta(ve.paint_raster["raster-contrast"]),"raster-resampling":new ta(ve.paint_raster["raster-resampling"]),"raster-fade-duration":new ta(ve.paint_raster["raster-fade-duration"])})};class rp extends So{constructor(t){super(t,{}),this.implementation=t;}is3D(){return "3d"===this.implementation.renderingMode}hasOffscreenPass(){return void 0!==this.implementation.prerender}recalculate(){}updateTransitions(){}hasTransition(){}serialize(){}onAdd(t){this.implementation.onAdd&&this.implementation.onAdd(t,t.painter.context.gl);}onRemove(t){this.implementation.onRemove&&this.implementation.onRemove(t,t.painter.context.gl);}}var np={paint:new sa({"sky-type":new ta(ve.paint_sky["sky-type"]),"sky-atmosphere-sun":new ta(ve.paint_sky["sky-atmosphere-sun"]),"sky-atmosphere-sun-intensity":new ta(ve.paint_sky["sky-atmosphere-sun-intensity"]),"sky-gradient-center":new ta(ve.paint_sky["sky-gradient-center"]),"sky-gradient-radius":new ta(ve.paint_sky["sky-gradient-radius"]),"sky-gradient":new ia(ve.paint_sky["sky-gradient"]),"sky-atmosphere-halo-color":new ta(ve.paint_sky["sky-atmosphere-halo-color"]),"sky-atmosphere-color":new ta(ve.paint_sky["sky-atmosphere-color"]),"sky-opacity":new ta(ve.paint_sky["sky-opacity"])})};function ip(t,e,r){const n=b(0,0,1),i=R(L());return function(t,e,r){r*=.5;var n=e[0],i=e[1],s=e[2],a=e[3],o=Math.sin(r),l=Math.cos(r);t[0]=n*l-s*o,t[1]=i*l+a*o,t[2]=s*l+n*o,t[3]=a*l-i*o;}(i,i,r?-q(t)+Math.PI:q(t)),U(i,i,-q(e)),C(n,n,i),z(n,n)}const sp={circle:class extends So{constructor(t){super(t,yl);}createBucket(t){return new Jo(t)}queryRadius(t){const e=t;return cl("circle-radius",this,e)+cl("circle-stroke-width",this,e)+hl(this.paint.get("circle-translate"))}queryIntersectsFeature(t,e,r,n,i,s,a,o){const l=dl(this.paint.get("circle-translate"),this.paint.get("circle-translate-anchor"),s.angle,t.pixelToTileUnitsFactor),u=this.paint.get("circle-radius").evaluate(e,r)+this.paint.get("circle-stroke-width").evaluate(e,r);return xl(t,n,s,a,o,"map"===this.paint.get("circle-pitch-alignment"),"map"===this.paint.get("circle-pitch-scale"),l,u)}getProgramIds(){return ["circle"]}getProgramConfiguration(t){return new go(this,t)}},heatmap:class extends So{createBucket(t){return new Al(t)}constructor(t){super(t,Tl),this._updateColorRamp();}_handleSpecialPaintPropertyUpdate(t){"heatmap-color"===t&&this._updateColorRamp();}_updateColorRamp(){this.colorRamp=Bl({expression:this._transitionablePaint._values["heatmap-color"].value.expression,evaluationKey:"heatmapDensity",image:this.colorRamp}),this.colorRampTexture=null;}resize(){this.heatmapFbo&&(this.heatmapFbo.destroy(),this.heatmapFbo=null);}queryRadius(t){return cl("heatmap-radius",this,t)}queryIntersectsFeature(t,e,r,n,s,a,o,l){const u=this.paint.get("heatmap-radius").evaluate(e,r);return xl(t,n,a,o,l,!0,!0,new i(0,0),u)}hasOffscreenPass(){return 0!==this.paint.get("heatmap-opacity")&&"none"!==this.visibility}getProgramIds(){return ["heatmap","heatmapTexture"]}getProgramConfiguration(t){return new go(this,t)}},hillshade:class extends So{constructor(t){super(t,Cl);}hasOffscreenPass(){return 0!==this.paint.get("hillshade-exaggeration")&&"none"!==this.visibility}getProgramIds(){return ["hillshade","hillshadePrepare"]}getProgramConfiguration(t){return new go(this,t)}},fill:class extends So{constructor(t){super(t,xu);}getProgramIds(){const t=this.paint.get("fill-pattern"),e=t&&t.constantOr(1),r=[e?"fillPattern":"fill"];return this.paint.get("fill-antialias")&&r.push(e&&!this.getPaintProperty("fill-outline-color")?"fillOutlinePattern":"fillOutline"),r}getProgramConfiguration(t){return new go(this,t)}recalculate(t,e){super.recalculate(t,e);const r=this.paint._values["fill-outline-color"];"constant"===r.value.kind&&void 0===r.value.value&&(this.paint._values["fill-outline-color"]=this.paint._values["fill-color"]);}createBucket(t){return new mu(t)}queryRadius(){return hl(this.paint.get("fill-translate"))}queryIntersectsFeature(t,e,r,n,i,s){return !t.queryGeometry.isAboveHorizon&&tl(pl(t.tilespaceGeometry,this.paint.get("fill-translate"),this.paint.get("fill-translate-anchor"),s.angle,t.pixelToTileUnitsFactor),n)}isTileClipped(){return !0}},"fill-extrusion":class extends So{constructor(t){super(t,Lu);}createBucket(t){return new Vu(t)}queryRadius(){return hl(this.paint.get("fill-extrusion-translate"))}is3D(){return !0}getProgramIds(){return [this.paint.get("fill-extrusion-pattern").constantOr(1)?"fillExtrusionPattern":"fillExtrusion"]}getProgramConfiguration(t){return new go(this,t)}queryIntersectsFeature(t,e,r,n,s,a,o,l,u){const c=dl(this.paint.get("fill-extrusion-translate"),this.paint.get("fill-extrusion-translate-anchor"),a.angle,t.pixelToTileUnitsFactor),h=this.paint.get("fill-extrusion-height").evaluate(e,r),p=this.paint.get("fill-extrusion-base").evaluate(e,r),d=[0,0],f=l&&a.elevation,y=a.elevation?a.elevation.exaggeration():1;if(f){const e=t.tile.getBucket(this).centroidVertexArray,r=u+1;if(r<e.length){const t=e.get(r);d[0]=t.a_centroid_pos0,d[1]=t.a_centroid_pos1;}}if(0===d[0]&&1===d[1])return !1;const m=function(t,e,r,n,s,a,o,l,u){return a?function(t,e,r,n,i,s,a,o,l){const u=[],c=[],h=[0,0,0,1];for(const p of t){const t=[],d=[];for(const u of p){const c=u.x+n.x,p=u.y+n.y,f=Ou(c,p,e,r,s,a,o,l);h[0]=c,h[1]=p,h[2]=f.base,h[3]=1,F(h,h,i),h[3]=Math.max(h[3],1e-5);const y=$u([h[0]/h[3],h[1]/h[3],h[2]/h[3]]);h[0]=c,h[1]=p,h[2]=f.top,h[3]=1,F(h,h,i),h[3]=Math.max(h[3],1e-5);const m=$u([h[0]/h[3],h[1]/h[3],h[2]/h[3]]);t.push(y),d.push(m);}u.push(t),c.push(d);}return [u,c]}(t,e,r,n,s,a,o,l,u):function(t,e,r,n,s){const a=[],o=[],l=s[8]*e,u=s[9]*e,c=s[10]*e,h=s[11]*e,p=s[8]*r,d=s[9]*r,f=s[10]*r,y=s[11]*r;for(const e of t){const t=[],r=[];for(const a of e){const e=a.x+n.x,o=a.y+n.y,m=s[0]*e+s[4]*o+s[12],g=s[1]*e+s[5]*o+s[13],x=s[2]*e+s[6]*o+s[14],v=s[3]*e+s[7]*o+s[15],b=m+l,w=g+u,_=x+c,A=Math.max(v+h,1e-5),k=m+p,S=g+d,I=x+f,z=Math.max(v+y,1e-5),M=new i(b/A,w/A);M.z=_/A,t.push(M);const T=new i(k/z,S/z);T.z=I/z,r.push(T);}a.push(t),o.push(r);}return [a,o]}(t,e,r,n,s)}(n,p,h,c,o,f?l:null,d,y,a.center.lat),g=t.queryGeometry;return function(t,e,r){let n=1/0;tl(r,e)&&(n=Uu(r,e[0]));for(let i=0;i<e.length;i++){const s=e[i],a=t[i];for(let t=0;t<s.length-1;t++){const e=s[t],i=[e,s[t+1],a[t+1],a[t],e];Wo(r,i)&&(n=Math.min(n,Uu(r,i)));}}return n!==1/0&&n}(m[0],m[1],g.isPointQuery()?g.screenBounds:g.screenGeometry)}},line:class extends So{constructor(t){super(t,Hu),this.gradientVersion=0;}_handleSpecialPaintPropertyUpdate(t){if("line-gradient"===t){const t=this._transitionablePaint._values["line-gradient"].value.expression;this.stepInterpolant=t._styleExpression&&t._styleExpression.expression instanceof Fr,this.gradientVersion=(this.gradientVersion+1)%Number.MAX_SAFE_INTEGER;}}gradientExpression(){return this._transitionablePaint._values["line-gradient"].value.expression}recalculate(t,e){super.recalculate(t,e),this.paint._values["line-floorwidth"]=Ju.possiblyEvaluate(this._transitioningPaint._values["line-width"].value,t);}createBucket(t){return new Ku(t)}getProgramIds(){return [this.paint.get("line-pattern").constantOr(1)?"linePattern":"line"]}getProgramConfiguration(t){return new go(this,t)}queryRadius(t){const e=t,r=Wu(cl("line-width",this,e),cl("line-gap-width",this,e)),n=cl("line-offset",this,e);return r/2+Math.abs(n)+hl(this.paint.get("line-translate"))}queryIntersectsFeature(t,e,r,n,s,a){if(t.queryGeometry.isAboveHorizon)return !1;const o=pl(t.tilespaceGeometry,this.paint.get("line-translate"),this.paint.get("line-translate-anchor"),a.angle,t.pixelToTileUnitsFactor),l=t.pixelToTileUnitsFactor/2*Wu(this.paint.get("line-width").evaluate(e,r),this.paint.get("line-gap-width").evaluate(e,r)),u=this.paint.get("line-offset").evaluate(e,r);return u&&(n=function(t,e){const r=[],n=new i(0,0);for(let i=0;i<t.length;i++){const s=t[i],a=[];for(let t=0;t<s.length;t++){const r=s[t-1],i=s[t],o=s[t+1],l=0===t?n:i.sub(r)._unit()._perp(),u=t===s.length-1?n:o.sub(i)._unit()._perp(),c=l._add(u)._unit();c._mult(1/(c.x*u.x+c.y*u.y)),a.push(c._mult(e)._add(i));}r.push(a);}return r}(n,u*t.pixelToTileUnitsFactor)),function(t,e,r){for(let n=0;n<e.length;n++){const i=e[n];if(t.length>=3)for(let e=0;e<i.length;e++)if(ol(t,i[e]))return !0;if(el(t,i,r))return !0}return !1}(o,n,l)}isTileClipped(){return !0}},symbol:Qh,background:class extends So{constructor(t){super(t,tp);}getProgramIds(){return [this.paint.get("background-pattern")?"backgroundPattern":"background"]}},raster:class extends So{constructor(t){super(t,ep);}getProgramIds(){return ["raster"]}},sky:class extends So{constructor(t){super(t,np),this._updateColorRamp();}_handleSpecialPaintPropertyUpdate(t){"sky-gradient"===t?this._updateColorRamp():"sky-atmosphere-sun"!==t&&"sky-atmosphere-halo-color"!==t&&"sky-atmosphere-color"!==t&&"sky-atmosphere-sun-intensity"!==t||(this._skyboxInvalidated=!0);}_updateColorRamp(){this.colorRamp=Bl({expression:this._transitionablePaint._values["sky-gradient"].value.expression,evaluationKey:"skyRadialProgress"}),this.colorRampTexture&&(this.colorRampTexture.destroy(),this.colorRampTexture=null);}needsSkyboxCapture(t){if(this._skyboxInvalidated||!this.skyboxTexture||!this.skyboxGeometry)return !0;if(!this.paint.get("sky-atmosphere-sun")){const e=t.style.light.properties.get("position");return this._lightPosition.azimuthal!==e.azimuthal||this._lightPosition.polar!==e.polar}}getCenter(t,e){const r=this.paint.get("sky-type");if("atmosphere"===r){const r=this.paint.get("sky-atmosphere-sun"),n=!r,i=t.style.light,s=i.properties.get("position");return n&&"viewport"===i.properties.get("anchor")&&pt("The sun direction is attached to a light with viewport anchor, lighting may behave unexpectedly."),n?ip(s.azimuthal,90-s.polar,e):ip(r[0],90-r[1],e)}if("gradient"===r){const t=this.paint.get("sky-gradient-center");return ip(t[0],90-t[1],e)}}is3D(){return !1}isSky(){return !0}markSkyboxValid(t){this._skyboxInvalidated=!1,this._lightPosition=t.style.light.properties.get("position");}hasOffscreenPass(){return !0}getProgramIds(){const t=this.paint.get("sky-type");return "atmosphere"===t?["skyboxCapture","skybox"]:"gradient"===t?["skyboxGradient"]:null}}},{HTMLImageElement:ap,HTMLCanvasElement:op,HTMLVideoElement:lp,ImageData:up,ImageBitmap:cp}=a;class hp{constructor(t,e,r,n){this.context=t,this.format=r,this.texture=t.gl.createTexture(),this.update(e,n);}update(t,e,r){const{width:n,height:i}=t,{context:s}=this,{gl:a}=s;if(a.bindTexture(a.TEXTURE_2D,this.texture),s.pixelStoreUnpackFlipY.set(!1),s.pixelStoreUnpack.set(1),s.pixelStoreUnpackPremultiplyAlpha.set(this.format===a.RGBA&&(!e||!1!==e.premultiply)),r||this.size&&this.size[0]===n&&this.size[1]===i){const{x:e,y:s}=r||{x:0,y:0};t instanceof ap||t instanceof op||t instanceof lp||t instanceof up||cp&&t instanceof cp?a.texSubImage2D(a.TEXTURE_2D,0,e,s,a.RGBA,a.UNSIGNED_BYTE,t):a.texSubImage2D(a.TEXTURE_2D,0,e,s,n,i,a.RGBA,a.UNSIGNED_BYTE,t.data);}else this.size=[n,i],t instanceof ap||t instanceof op||t instanceof lp||t instanceof up||cp&&t instanceof cp?a.texImage2D(a.TEXTURE_2D,0,this.format,this.format,a.UNSIGNED_BYTE,t):a.texImage2D(a.TEXTURE_2D,0,this.format,n,i,0,this.format,a.UNSIGNED_BYTE,t.data);this.useMipmap=Boolean(e&&e.useMipmap&&this.isSizePowerOfTwo()),this.useMipmap&&a.generateMipmap(a.TEXTURE_2D);}bind(t,e){const{context:r}=this,{gl:n}=r;n.bindTexture(n.TEXTURE_2D,this.texture),t!==this.filter&&(n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,t),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,this.useMipmap?t===n.NEAREST?n.NEAREST_MIPMAP_NEAREST:n.LINEAR_MIPMAP_NEAREST:t),this.filter=t),e!==this.wrap&&(n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,e),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,e),this.wrap=e);}isSizePowerOfTwo(){return this.size[0]===this.size[1]&&Math.log(this.size[0])/Math.LN2%1==0}destroy(){const{gl:t}=this.context;t.deleteTexture(this.texture),this.texture=null;}}class pp{constructor(t,e){this.width=t,this.height=e,this.nextRow=0,this.image=new zl({width:t,height:e}),this.positions={},this.uploaded=!1;}getDash(t,e){const r=this.getKey(t,e);return this.positions[r]}trim(){const t=this.width,e=this.height=it(this.nextRow);this.image.resize({width:t,height:e});}getKey(t,e){return t.join(",")+e}getDashRanges(t,e,r){const n=[];let i=t.length%2==1?-t[t.length-1]*r:0,s=t[0]*r,a=!0;n.push({left:i,right:s,isDash:a,zeroLength:0===t[0]});let o=t[0];for(let e=1;e<t.length;e++){a=!a;const l=t[e];i=o*r,o+=l,s=o*r,n.push({left:i,right:s,isDash:a,zeroLength:0===l});}return n}addRoundDash(t,e,r){const n=e/2;for(let e=-r;e<=r;e++){const i=this.width*(this.nextRow+r+e);let s=0,a=t[s];for(let o=0;o<this.width;o++){o/a.right>1&&(a=t[++s]);const l=Math.abs(o-a.left),u=Math.abs(o-a.right),c=Math.min(l,u);let h;const p=e/r*(n+1);if(a.isDash){const t=n-Math.abs(p);h=Math.sqrt(c*c+t*t);}else h=n-Math.sqrt(c*c+p*p);this.image.data[i+o]=Math.max(0,Math.min(255,h+128));}}}addRegularDash(t,e){for(let e=t.length-1;e>=0;--e){const r=t[e],n=t[e+1];r.zeroLength?t.splice(e,1):n&&n.isDash===r.isDash&&(n.left=r.left,t.splice(e,1));}const r=t[0],n=t[t.length-1];r.isDash===n.isDash&&(r.left=n.left-this.width,n.right=r.right+this.width);const i=this.width*this.nextRow;let s=0,a=t[s];for(let r=0;r<this.width;r++){r/a.right>1&&(a=t[++s]);const n=Math.abs(r-a.left),o=Math.abs(r-a.right),l=Math.min(n,o);this.image.data[i+r]=Math.max(0,Math.min(255,(a.isDash?l:-l)+e+128));}}addDash(t,e){const r=this.getKey(t,e);if(this.positions[r])return this.positions[r];const n="round"===e,i=n?7:0,s=2*i+1;if(this.nextRow+s>this.height)return pt("LineAtlas out of space"),null;0===t.length&&t.push(1);let a=0;for(let e=0;e<t.length;e++)t[e]<0&&(pt("Negative value is found in line dasharray, replacing values with 0"),t[e]=0),a+=t[e];if(0!==a){const r=this.width/a,s=this.getDashRanges(t,this.width,r);n?this.addRoundDash(s,r,i):this.addRegularDash(s,"square"===e?.5*r:0);}const o=this.nextRow+i;this.nextRow+=s;const l={tl:[o,i],br:[a,0]};return this.positions[r]=l,l}}Zi("LineAtlas",pp);class dp{constructor(t){this._callback=t,this._triggered=!1,"undefined"!=typeof MessageChannel&&(this._channel=new MessageChannel,this._channel.port2.onmessage=()=>{this._triggered=!1,this._callback();});}trigger(){this._triggered||(this._triggered=!0,this._channel?this._channel.port1.postMessage(!0):setTimeout((()=>{this._triggered=!1,this._callback();}),0));}remove(){delete this._channel,this._callback=()=>{};}}const fp=a.performance;function yp(t){const e=t?t.url.toString():void 0;return fp.getEntriesByName(e)}class mp{constructor(){this.tasks={},this.taskQueue=[],at(["process"],this),this.invoker=new dp(this.process),this.nextId=0;}add(t,e){const r=this.nextId++,n=function({type:t,isSymbolTile:e,zoom:r}){return r=r||0,"message"===t?0:"maybePrepare"!==t||e?"parseTile"!==t||e?"parseTile"===t&&e?300-r:"maybePrepare"===t&&e?400-r:500:200-r:100-r}(e);if(0===n){yt();try{t();}finally{}return {cancel:()=>{}}}return this.tasks[r]={fn:t,metadata:e,priority:n,id:r},this.taskQueue.push(r),this.invoker.trigger(),{cancel:()=>{delete this.tasks[r];}}}process(){yt();try{if(this.taskQueue=this.taskQueue.filter((t=>!!this.tasks[t])),!this.taskQueue.length)return;const t=this.pick();if(null===t)return;const e=this.tasks[t];if(delete this.tasks[t],this.taskQueue.length&&this.invoker.trigger(),!e)return;e.fn();}finally{}}pick(){let t=null,e=1/0;for(let r=0;r<this.taskQueue.length;r++){const n=this.tasks[this.taskQueue[r]];n.priority<e&&(e=n.priority,t=r);}if(null===t)return null;const r=this.taskQueue[t];return this.taskQueue.splice(t,1),r}remove(){this.invoker.remove();}}function gp(t,e,r){var n=2*Math.PI*6378137/256/Math.pow(2,r);return [t*n-2*Math.PI*6378137/2,e*n-2*Math.PI*6378137/2]}class xp{constructor(t,e,r){this.z=t,this.x=e,this.y=r,this.key=wp(0,t,t,e,r);}equals(t){return this.z===t.z&&this.x===t.x&&this.y===t.y}url(t,e){const r=function(t,e,r){var n=gp(256*t,256*(e=Math.pow(2,r)-e-1),r),i=gp(256*(t+1),256*(e+1),r);return n[0]+","+n[1]+","+i[0]+","+i[1]}(this.x,this.y,this.z),n=function(t,e,r){let n,i="";for(let s=t;s>0;s--)n=1<<s-1,i+=(e&n?1:0)+(r&n?2:0);return i}(this.z,this.x,this.y);return t[(this.x+this.y)%t.length].replace("{prefix}",(this.x%16).toString(16)+(this.y%16).toString(16)).replace("{z}",String(this.z)).replace("{x}",String(this.x)).replace("{y}",String("tms"===e?Math.pow(2,this.z)-this.y-1:this.y)).replace("{quadkey}",n).replace("{bbox-epsg-3857}",r)}toString(){return `${this.z}/${this.x}/${this.y}`}}class vp{constructor(t,e){this.wrap=t,this.canonical=e,this.key=wp(t,e.z,e.z,e.x,e.y);}}class bp{constructor(t,e,r,n,i){this.overscaledZ=t,this.wrap=e,this.canonical=new xp(r,+n,+i),this.key=0===e&&t===r?this.canonical.key:wp(e,t,r,n,i);}equals(t){return this.overscaledZ===t.overscaledZ&&this.wrap===t.wrap&&this.canonical.equals(t.canonical)}scaledTo(t){const e=this.canonical.z-t;return t>this.canonical.z?new bp(t,this.wrap,this.canonical.z,this.canonical.x,this.canonical.y):new bp(t,this.wrap,t,this.canonical.x>>e,this.canonical.y>>e)}calculateScaledKey(t,e=!0){if(this.overscaledZ===t&&e)return this.key;if(t>this.canonical.z)return wp(this.wrap*+e,t,this.canonical.z,this.canonical.x,this.canonical.y);{const r=this.canonical.z-t;return wp(this.wrap*+e,t,t,this.canonical.x>>r,this.canonical.y>>r)}}isChildOf(t){if(t.wrap!==this.wrap)return !1;const e=this.canonical.z-t.canonical.z;return 0===t.overscaledZ||t.overscaledZ<this.overscaledZ&&t.canonical.x===this.canonical.x>>e&&t.canonical.y===this.canonical.y>>e}children(t){if(this.overscaledZ>=t)return [new bp(this.overscaledZ+1,this.wrap,this.canonical.z,this.canonical.x,this.canonical.y)];const e=this.canonical.z+1,r=2*this.canonical.x,n=2*this.canonical.y;return [new bp(e,this.wrap,e,r,n),new bp(e,this.wrap,e,r+1,n),new bp(e,this.wrap,e,r,n+1),new bp(e,this.wrap,e,r+1,n+1)]}isLessThan(t){return this.wrap<t.wrap||!(this.wrap>t.wrap)&&(this.overscaledZ<t.overscaledZ||!(this.overscaledZ>t.overscaledZ)&&(this.canonical.x<t.canonical.x||!(this.canonical.x>t.canonical.x)&&this.canonical.y<t.canonical.y))}wrapped(){return new bp(this.overscaledZ,0,this.canonical.z,this.canonical.x,this.canonical.y)}unwrapTo(t){return new bp(this.overscaledZ,t,this.canonical.z,this.canonical.x,this.canonical.y)}overscaleFactor(){return Math.pow(2,this.overscaledZ-this.canonical.z)}toUnwrapped(){return new vp(this.wrap,this.canonical)}toString(){return `${this.overscaledZ}/${this.canonical.x}/${this.canonical.y}`}}function wp(t,e,r,n,i){const s=1<<Math.min(r,22);let a=s*(i%s)+n%s;return t&&r<22&&(a+=s*s*((t<0?-2*t-1:2*t)%(1<<2*(22-r)))),16*(32*a+r)+(e-r)}Zi("CanonicalTileID",xp),Zi("OverscaledTileID",bp,{omit:["projMatrix"]});class _p{constructor(t,e,r){this.func=t,this.mask=e,this.range=r;}}_p.ReadOnly=!1,_p.ReadWrite=!0,_p.disabled=new _p(519,_p.ReadOnly,[0,1]);const Ap=7680;class kp{constructor(t,e,r,n,i,s){this.test=t,this.ref=e,this.mask=r,this.fail=n,this.depthFail=i,this.pass=s;}}kp.disabled=new kp({func:519,mask:0},0,0,Ap,Ap,Ap);class Sp{constructor(t,e,r){this.blendFunction=t,this.blendColor=e,this.mask=r;}}Sp.Replace=[1,0],Sp.disabled=new Sp(Sp.Replace,Ge.transparent,[!1,!1,!1,!1]),Sp.unblended=new Sp(Sp.Replace,Ge.transparent,[!0,!0,!0,!0]),Sp.alphaBlended=new Sp([1,771],Ge.transparent,[!0,!0,!0,!0]);const Ip=1029,zp=2305;class Mp{constructor(t,e,r){this.enable=t,this.mode=e,this.frontFace=r;}}Mp.disabled=new Mp(!1,Ip,zp),Mp.backCCW=new Mp(!0,Ip,zp),Mp.backCW=new Mp(!0,Ip,2304),Mp.frontCW=new Mp(!0,1028,2304),Mp.frontCCW=new Mp(!0,1028,zp);class Tp{constructor(t){this._stringToNumber={},this._numberToString=[];for(let e=0;e<t.length;e++){const r=t[e];this._stringToNumber[r]=e,this._numberToString[e]=r;}}encode(t){return this._stringToNumber[t]}decode(t){return this._numberToString[t]}}class Bp{constructor(t,e,r,n,i){this.type="Feature",this._vectorTileFeature=t,t._z=e,t._x=r,t._y=n,this.properties=t.properties,this.id=i;}get geometry(){return void 0===this._geometry&&(this._geometry=this._vectorTileFeature.toGeoJSON(this._vectorTileFeature._x,this._vectorTileFeature._y,this._vectorTileFeature._z).geometry),this._geometry}set geometry(t){this._geometry=t;}toJSON(){const t={geometry:this.geometry};for(const e in this)"_geometry"!==e&&"_vectorTileFeature"!==e&&(t[e]=this[e]);return t}}class Cp{constructor(){this.state={},this.stateChanges={},this.deletedStates={};}updateState(t,e,r){const n=String(e);if(this.stateChanges[t]=this.stateChanges[t]||{},this.stateChanges[t][n]=this.stateChanges[t][n]||{},tt(this.stateChanges[t][n],r),null===this.deletedStates[t]){this.deletedStates[t]={};for(const e in this.state[t])e!==n&&(this.deletedStates[t][e]=null);}else if(this.deletedStates[t]&&null===this.deletedStates[t][n]){this.deletedStates[t][n]={};for(const e in this.state[t][n])r[e]||(this.deletedStates[t][n][e]=null);}else for(const e in r)this.deletedStates[t]&&this.deletedStates[t][n]&&null===this.deletedStates[t][n][e]&&delete this.deletedStates[t][n][e];}removeFeatureState(t,e,r){if(null===this.deletedStates[t])return;const n=String(e);if(this.deletedStates[t]=this.deletedStates[t]||{},r&&void 0!==e)null!==this.deletedStates[t][n]&&(this.deletedStates[t][n]=this.deletedStates[t][n]||{},this.deletedStates[t][n][r]=null);else if(void 0!==e)if(this.stateChanges[t]&&this.stateChanges[t][n])for(r in this.deletedStates[t][n]={},this.stateChanges[t][n])this.deletedStates[t][n][r]=null;else this.deletedStates[t][n]=null;else this.deletedStates[t]=null;}getState(t,e){const r=String(e),n=tt({},(this.state[t]||{})[r],(this.stateChanges[t]||{})[r]);if(null===this.deletedStates[t])return {};if(this.deletedStates[t]){const r=this.deletedStates[t][e];if(null===r)return {};for(const t in r)delete n[t];}return n}initializeTileState(t,e){t.setFeatureState(this.state,e);}coalesceChanges(t,e){const r={};for(const t in this.stateChanges){this.state[t]=this.state[t]||{};const e={};for(const r in this.stateChanges[t])this.state[t][r]||(this.state[t][r]={}),tt(this.state[t][r],this.stateChanges[t][r]),e[r]=this.state[t][r];r[t]=e;}for(const t in this.deletedStates){this.state[t]=this.state[t]||{};const e={};if(null===this.deletedStates[t])for(const r in this.state[t])e[r]={},this.state[t][r]={};else for(const r in this.deletedStates[t]){if(null===this.deletedStates[t][r])this.state[t][r]={};else for(const e of Object.keys(this.deletedStates[t][r]))delete this.state[t][r][e];e[r]=this.state[t][r];}r[t]=r[t]||{},tt(r[t],e);}if(this.stateChanges={},this.deletedStates={},0!==Object.keys(r).length)for(const n in t)t[n].setFeatureState(r,e);}}class Pp{constructor(t){this.size=t,this.minimums=[],this.maximums=[],this.leaves=[];}getElevation(t,e){const r=this.toIdx(t,e);return {min:this.minimums[r],max:this.maximums[r]}}isLeaf(t,e){return this.leaves[this.toIdx(t,e)]}toIdx(t,e){return e*this.size+t}}function Ep(t,e,r,n){let i=0,s=Number.MAX_VALUE;for(let a=0;a<3;a++)if(Math.abs(n[a])<1e-15){if(r[a]<t[a]||r[a]>e[a])return null}else {const o=1/n[a];let l=(t[a]-r[a])*o,u=(e[a]-r[a])*o;if(l>u){const t=l;l=u,u=t;}if(l>i&&(i=l),u<s&&(s=u),i>s)return null}return i}function Dp(t,e,r,n,i,s,a,o,l,u,c){const h=n-t,p=i-e,d=s-r,f=a-t,y=o-e,m=l-r,g=c[1]*m-c[2]*y,x=c[2]*f-c[0]*m,v=c[0]*y-c[1]*f,b=h*g+p*x+d*v;if(Math.abs(b)<1e-15)return null;const w=1/b,_=u[0]-t,A=u[1]-e,k=u[2]-r,S=(_*g+A*x+k*v)*w;if(S<0||S>1)return null;const I=A*d-k*p,z=k*h-_*d,M=_*p-A*h,T=(c[0]*I+c[1]*z+c[2]*M)*w;return T<0||S+T>1?null:(f*I+y*z+m*M)*w}function Vp(t,e,r){return (t-e)/(r-e)}function Fp(t,e,r,n,i,s,a,o,l){const u=1<<r,c=s-n,h=a-i,p=(t+1)/u*c+n,d=(e+0)/u*h+i,f=(e+1)/u*h+i;o[0]=(t+0)/u*c+n,o[1]=d,l[0]=p,l[1]=f;}class Lp{constructor(t){if(this.maximums=[],this.minimums=[],this.leaves=[],this.childOffsets=[],this.nodeCount=0,this.dem=t,this._siblingOffset=[[0,0],[1,0],[0,1],[1,1]],!this.dem)return;const e=function(t){const e=Math.ceil(Math.log2(t.dim/8)),r=[];let n=Math.ceil(Math.pow(2,e));const i=1/n,s=(t,e,r,n,i)=>{const s=n?1:0,a=(t+1)*r-s,o=e*r,l=(e+1)*r-s;i[0]=t*r,i[1]=o,i[2]=a,i[3]=l;};let a=new Pp(n);const o=[];for(let e=0;e<n*n;e++){s(e%n,Math.floor(e/n),i,!1,o);const r=Up(o[0],o[1],t),l=Up(o[2],o[1],t),u=Up(o[2],o[3],t),c=Up(o[0],o[3],t);a.minimums.push(Math.min(r,l,u,c)),a.maximums.push(Math.max(r,l,u,c)),a.leaves.push(1);}for(r.push(a),n/=2;n>=1;n/=2){const t=r[r.length-1];a=new Pp(n);for(let e=0;e<n*n;e++){s(e%n,Math.floor(e/n),2,!0,o);const r=t.getElevation(o[0],o[1]),i=t.getElevation(o[2],o[1]),l=t.getElevation(o[2],o[3]),u=t.getElevation(o[0],o[3]),c=t.isLeaf(o[0],o[1]),h=t.isLeaf(o[2],o[1]),p=t.isLeaf(o[2],o[3]),d=t.isLeaf(o[0],o[3]),f=Math.min(r.min,i.min,l.min,u.min),y=Math.max(r.max,i.max,l.max,u.max),m=c&&h&&p&&d;a.maximums.push(y),a.minimums.push(f),a.leaves.push(y-f<=5&&m?1:0);}r.push(a);}return r}(this.dem),r=e.length-1,n=e[r];this._addNode(n.minimums[0],n.maximums[0],n.leaves[0]),this._construct(e,0,0,r,0);}raycastRoot(t,e,r,n,i,s,a=1){return Ep([t,e,-100],[r,n,this.maximums[0]*a],i,s)}raycast(t,e,r,n,i,s,a=1){if(!this.nodeCount)return null;const o=this.raycastRoot(t,e,r,n,i,s,a);if(null==o)return null;const l=[],u=[],c=[],h=[],p=[{idx:0,t:o,nodex:0,nodey:0,depth:0}];for(;p.length>0;){const{idx:o,t:d,nodex:f,nodey:y,depth:m}=p.pop();if(this.leaves[o]){Fp(f,y,m,t,e,r,n,c,h);const o=1<<m,l=(f+0)/o,u=(f+1)/o,p=(y+0)/o,g=(y+1)/o,x=Up(l,p,this.dem)*a,v=Up(u,p,this.dem)*a,b=Up(u,g,this.dem)*a,w=Up(l,g,this.dem)*a,_=Dp(c[0],c[1],x,h[0],c[1],v,h[0],h[1],b,i,s),A=Dp(h[0],h[1],b,c[0],h[1],w,c[0],c[1],x,i,s),k=Math.min(null!==_?_:Number.MAX_VALUE,null!==A?A:Number.MAX_VALUE);if(k!==Number.MAX_VALUE)return k;{const t=I([],i,s,d);if(Rp(x,v,w,b,Vp(t[0],c[0],h[0]),Vp(t[1],c[1],h[1]))>=t[2])return d}continue}let g=0;for(let p=0;p<this._siblingOffset.length;p++){Fp((f<<1)+this._siblingOffset[p][0],(y<<1)+this._siblingOffset[p][1],m+1,t,e,r,n,c,h),c[2]=-100,h[2]=this.maximums[this.childOffsets[o]+p]*a;const d=Ep(c,h,i,s);if(null!=d){const t=d;l[p]=t;let e=!1;for(let r=0;r<g&&!e;r++)t>=l[u[r]]&&(u.splice(r,0,p),e=!0);e||(u[g]=p),g++;}}for(let t=0;t<g;t++){const e=u[t];p.push({idx:this.childOffsets[o]+e,t:l[e],nodex:(f<<1)+this._siblingOffset[e][0],nodey:(y<<1)+this._siblingOffset[e][1],depth:m+1});}}return null}_addNode(t,e,r){return this.minimums.push(t),this.maximums.push(e),this.leaves.push(r),this.childOffsets.push(0),this.nodeCount++}_construct(t,e,r,n,i){if(1===t[n].isLeaf(e,r))return;this.childOffsets[i]||(this.childOffsets[i]=this.nodeCount);const s=n-1,a=t[s];let o,l=0;for(let t=0;t<this._siblingOffset.length;t++){const n=2*e+this._siblingOffset[t][0],i=2*r+this._siblingOffset[t][1],s=a.getElevation(n,i),u=a.isLeaf(n,i),c=this._addNode(s.min,s.max,u);u&&(l|=1<<t),o||(o=c);}for(let n=0;n<this._siblingOffset.length;n++)l&1<<n||this._construct(t,2*e+this._siblingOffset[n][0],2*r+this._siblingOffset[n][1],s,o+n);}}function Rp(t,e,r,n,i,s){return Lr(Lr(t,r,s),Lr(e,n,s),i)}function Up(t,e,r){const n=r.dim,i=Y(t*n-.5,0,n-1),s=Y(e*n-.5,0,n-1),a=Math.floor(i),o=Math.floor(s),l=Math.min(a+1,n-1),u=Math.min(o+1,n-1);return Rp(r.get(a,o),r.get(l,o),r.get(a,u),r.get(l,u),i-a,s-o)}const $p={mapbox:[6553.6,25.6,.1,1e4],terrarium:[256,1,1/256,32768]};class Op{get tree(){return this._tree||this._buildQuadTree(),this._tree}constructor(t,e,r,n=!1,i=!1){if(this.uid=t,e.height!==e.width)throw new RangeError("DEM tiles must be square");if(r&&"mapbox"!==r&&"terrarium"!==r)return pt(`"${r}" is not a valid encoding type. Valid types include "mapbox" and "terrarium".`);this.stride=e.height;const s=this.dim=e.height-2;if(this.data=new Uint32Array(e.data.buffer),this.encoding=r||"mapbox",this.borderReady=n,!n){for(let t=0;t<s;t++)this.data[this._idx(-1,t)]=this.data[this._idx(0,t)],this.data[this._idx(s,t)]=this.data[this._idx(s-1,t)],this.data[this._idx(t,-1)]=this.data[this._idx(t,0)],this.data[this._idx(t,s)]=this.data[this._idx(t,s-1)];this.data[this._idx(-1,-1)]=this.data[this._idx(0,0)],this.data[this._idx(s,-1)]=this.data[this._idx(s-1,0)],this.data[this._idx(-1,s)]=this.data[this._idx(0,s-1)],this.data[this._idx(s,s)]=this.data[this._idx(s-1,s-1)],i&&this._buildQuadTree();}}_buildQuadTree(){this._tree=new Lp(this);}get(t,e,r=!1){const n=new Uint8Array(this.data.buffer);r&&(t=Y(t,-1,this.dim),e=Y(e,-1,this.dim));const i=4*this._idx(t,e);return ("terrarium"===this.encoding?this._unpackTerrarium:this._unpackMapbox)(n[i],n[i+1],n[i+2])}static getUnpackVector(t){return $p[t]}get unpackVector(){return $p[this.encoding]}_idx(t,e){if(t<-1||t>=this.dim+1||e<-1||e>=this.dim+1)throw new RangeError("out of range source coordinates for DEM data");return (e+1)*this.stride+(t+1)}_unpackMapbox(t,e,r){return (256*t*256+256*e+r)/10-1e4}_unpackTerrarium(t,e,r){return 256*t+e+r/256-32768}static pack(t,e){const r=[0,0,0,0],n=Op.getUnpackVector(e);let i=Math.floor((t+n[3])/n[2]);return r[2]=i%256,i=Math.floor(i/256),r[1]=i%256,i=Math.floor(i/256),r[0]=i,r}getPixels(){return new Ml({width:this.stride,height:this.stride},new Uint8Array(this.data.buffer))}backfillBorder(t,e,r){if(this.dim!==t.dim)throw new Error("dem dimension mismatch");let n=e*this.dim,i=e*this.dim+this.dim,s=r*this.dim,a=r*this.dim+this.dim;switch(e){case-1:n=i-1;break;case 1:i=n+1;}switch(r){case-1:s=a-1;break;case 1:a=s+1;}const o=-e*this.dim,l=-r*this.dim;for(let e=s;e<a;e++)for(let r=n;r<i;r++)this.data[this._idx(r,e)]=t.data[this._idx(r+o,e+l)];}onDeserialize(){this._tree&&(this._tree.dem=this);}}Zi("DEMData",Op),Zi("DemMinMaxQuadTree",Lp,{omit:["dem"]});class jp{constructor(t,e){this.max=t,this.onRemove=e,this.reset();}reset(){for(const t in this.data)for(const e of this.data[t])e.timeout&&clearTimeout(e.timeout),this.onRemove(e.value);return this.data={},this.order=[],this}add(t,e,r){const n=t.wrapped().key;void 0===this.data[n]&&(this.data[n]=[]);const i={value:e,timeout:void 0};if(void 0!==r&&(i.timeout=setTimeout((()=>{this.remove(t,i);}),r)),this.data[n].push(i),this.order.push(n),this.order.length>this.max){const t=this._getAndRemoveByKey(this.order[0]);t&&this.onRemove(t);}return this}has(t){return t.wrapped().key in this.data}getAndRemove(t){return this.has(t)?this._getAndRemoveByKey(t.wrapped().key):null}_getAndRemoveByKey(t){const e=this.data[t].shift();return e.timeout&&clearTimeout(e.timeout),0===this.data[t].length&&delete this.data[t],this.order.splice(this.order.indexOf(t),1),e.value}getByKey(t){const e=this.data[t];return e?e[0].value:null}get(t){return this.has(t)?this.data[t.wrapped().key][0].value:null}remove(t,e){if(!this.has(t))return this;const r=t.wrapped().key,n=void 0===e?0:this.data[r].indexOf(e),i=this.data[r][n];return this.data[r].splice(n,1),i.timeout&&clearTimeout(i.timeout),0===this.data[r].length&&delete this.data[r],this.onRemove(i.value),this.order.splice(this.order.indexOf(r),1),this}setMaxSize(t){for(this.max=t;this.order.length>this.max;){const t=this._getAndRemoveByKey(this.order[0]);t&&this.onRemove(t);}return this}filter(t){const e=[];for(const r in this.data)for(const n of this.data[r])t(n.value)||e.push(n);for(const t of e)this.remove(t.value.tileID,t);}}class qp extends xe{constructor(t,e,r){super(),this.id=t,this._onlySymbols=r,e.on("data",(t=>{"source"===t.dataType&&"metadata"===t.sourceDataType&&(this._sourceLoaded=!0),this._sourceLoaded&&!this._paused&&"source"===t.dataType&&"content"===t.sourceDataType&&(this.reload(),this.transform&&this.update(this.transform));})),e.on("error",(()=>{this._sourceErrored=!0;})),this._source=e,this._tiles={},this._cache=new jp(0,this._unloadTile.bind(this)),this._timers={},this._cacheTimers={},this._minTileCacheSize=null,this._maxTileCacheSize=null,this._loadedParentTiles={},this._coveredTiles={},this._state=new Cp;}onAdd(t){this.map=t,this._minTileCacheSize=t?t._minTileCacheSize:null,this._maxTileCacheSize=t?t._maxTileCacheSize:null;}loaded(){if(this._sourceErrored)return !0;if(!this._sourceLoaded)return !1;if(!this._source.loaded())return !1;for(const t in this._tiles){const e=this._tiles[t];if("loaded"!==e.state&&"errored"!==e.state)return !1}return !0}getSource(){return this._source}pause(){this._paused=!0;}resume(){if(!this._paused)return;const t=this._shouldReloadOnResume;this._paused=!1,this._shouldReloadOnResume=!1,t&&this.reload(),this.transform&&this.update(this.transform);}_loadTile(t,e){return t.isSymbolTile=this._onlySymbols,this._source.loadTile(t,e)}_unloadTile(t){if(this._source.unloadTile)return this._source.unloadTile(t,(()=>{}))}_abortTile(t){if(this._source.abortTile)return this._source.abortTile(t,(()=>{}))}serialize(){return this._source.serialize()}prepare(t){this._source.prepare&&this._source.prepare(),this._state.coalesceChanges(this._tiles,this.map?this.map.painter:null);for(const e in this._tiles){const r=this._tiles[e];r.upload(t),r.prepare(this.map.style.imageManager);}}getIds(){return Q(this._tiles).map((t=>t.tileID)).sort(Np).map((t=>t.key))}getRenderableIds(t){const e=[];for(const r in this._tiles)this._isIdRenderable(+r,t)&&e.push(this._tiles[r]);return t?e.sort(((t,e)=>{const r=t.tileID,n=e.tileID,s=new i(r.canonical.x,r.canonical.y)._rotate(this.transform.angle),a=new i(n.canonical.x,n.canonical.y)._rotate(this.transform.angle);return r.overscaledZ-n.overscaledZ||a.y-s.y||a.x-s.x})).map((t=>t.tileID.key)):e.map((t=>t.tileID)).sort(Np).map((t=>t.key))}hasRenderableParent(t){const e=this.findLoadedParent(t,0);return !!e&&this._isIdRenderable(e.tileID.key)}_isIdRenderable(t,e){return this._tiles[t]&&this._tiles[t].hasData()&&!this._coveredTiles[t]&&(e||!this._tiles[t].holdingForFade())}reload(){if(this._paused)this._shouldReloadOnResume=!0;else {this._cache.reset();for(const t in this._tiles)"errored"!==this._tiles[t].state&&this._reloadTile(+t,"reloading");}}_reloadTile(t,e){const r=this._tiles[t];r&&("loading"!==r.state&&(r.state=e),this._loadTile(r,this._tileLoaded.bind(this,r,t,e)));}_tileLoaded(t,e,r,n){if(n)if(t.state="errored",404!==n.status)this._source.fire(new ge(n,{tile:t}));else if("raster-dem"===this._source.type&&this.usedForTerrain&&this.map.painter.terrain){const t=this.map.painter.terrain;this.update(this.transform,t.getScaledDemTileSize(),!0),t.resetTileLookupCache(this.id);}else this.update(this.transform);else t.timeAdded=At.now(),"expired"===r&&(t.refreshedUponExpiration=!0),this._setTileReloadTimer(e,t),"raster-dem"===this._source.type&&t.dem&&this._backfillDEM(t),this._state.initializeTileState(t,this.map?this.map.painter:null),this._source.fire(new me("data",{dataType:"source",tile:t,coord:t.tileID,sourceCacheId:this.id}));}_backfillDEM(t){const e=this.getRenderableIds();for(let n=0;n<e.length;n++){const i=e[n];if(t.neighboringTiles&&t.neighboringTiles[i]){const e=this.getTileByID(i);r(t,e),r(e,t);}}function r(t,e){if(!t.dem||t.dem.borderReady)return;t.needsHillshadePrepare=!0,t.needsDEMTextureUpload=!0;let r=e.tileID.canonical.x-t.tileID.canonical.x;const n=e.tileID.canonical.y-t.tileID.canonical.y,i=Math.pow(2,t.tileID.canonical.z),s=e.tileID.key;0===r&&0===n||Math.abs(n)>1||(Math.abs(r)>1&&(1===Math.abs(r+i)?r+=i:1===Math.abs(r-i)&&(r-=i)),e.dem&&t.dem&&(t.dem.backfillBorder(e.dem,r,n),t.neighboringTiles&&t.neighboringTiles[s]&&(t.neighboringTiles[s].backfilled=!0)));}}getTile(t){return this.getTileByID(t.key)}getTileByID(t){return this._tiles[t]}_retainLoadedChildren(t,e,r,n){for(const i in this._tiles){let s=this._tiles[i];if(n[i]||!s.hasData()||s.tileID.overscaledZ<=e||s.tileID.overscaledZ>r)continue;let a=s.tileID;for(;s&&s.tileID.overscaledZ>e+1;){const t=s.tileID.scaledTo(s.tileID.overscaledZ-1);s=this._tiles[t.key],s&&s.hasData()&&(a=t);}let o=a;for(;o.overscaledZ>e;)if(o=o.scaledTo(o.overscaledZ-1),t[o.key]){n[a.key]=a;break}}}findLoadedParent(t,e){if(t.key in this._loadedParentTiles){const r=this._loadedParentTiles[t.key];return r&&r.tileID.overscaledZ>=e?r:null}for(let r=t.overscaledZ-1;r>=e;r--){const e=t.scaledTo(r),n=this._getLoadedTile(e);if(n)return n}}_getLoadedTile(t){const e=this._tiles[t.key];return e&&e.hasData()?e:this._cache.getByKey(this._source.reparseOverscaled?t.wrapped().key:t.canonical.key)}updateCacheSize(t,e){e=e||this._source.tileSize;const r=Math.ceil(t.width/e)+1,n=Math.ceil(t.height/e)+1,i=Math.floor(r*n*5),s="number"==typeof this._minTileCacheSize?Math.max(this._minTileCacheSize,i):i,a="number"==typeof this._maxTileCacheSize?Math.min(this._maxTileCacheSize,s):s;this._cache.setMaxSize(a);}handleWrapJump(t){const e=Math.round((t-(void 0===this._prevLng?t:this._prevLng))/360);if(this._prevLng=t,e){const t={};for(const r in this._tiles){const n=this._tiles[r];n.tileID=n.tileID.unwrapTo(n.tileID.wrap+e),t[n.tileID.key]=n;}this._tiles=t;for(const t in this._timers)clearTimeout(this._timers[t]),delete this._timers[t];for(const t in this._tiles)this._setTileReloadTimer(+t,this._tiles[t]);}}update(t,e,r){if(this.transform=t,!this._sourceLoaded||this._paused||this.transform.freezeTileCoverage)return;if(this.usedForTerrain&&!r)return;let n;this.updateCacheSize(t,e),"globe"!==this.transform.projection.name&&this.handleWrapJump(this.transform.center.lng),this._coveredTiles={},this.used||this.usedForTerrain?this._source.tileID?n=t.getVisibleUnwrappedCoordinates(this._source.tileID).map((t=>new bp(t.canonical.z,t.wrap,t.canonical.z,t.canonical.x,t.canonical.y))):(n=t.coveringTiles({tileSize:e||this._source.tileSize,minzoom:this._source.minzoom,maxzoom:this._source.maxzoom,roundZoom:this._source.roundZoom&&!r,reparseOverscaled:this._source.reparseOverscaled,isTerrainDEM:this.usedForTerrain}),this._source.hasTile&&(n=n.filter((t=>this._source.hasTile(t))))):n=[];const i=this._updateRetainedTiles(n);if(Gp(this._source.type)&&0!==n.length){const t={},e={},r=Object.keys(i);for(const n of r){const r=i[n],s=this._tiles[n];if(!s||s.fadeEndTime&&s.fadeEndTime<=At.now())continue;const a=this.findLoadedParent(r,Math.max(r.overscaledZ-qp.maxOverzooming,this._source.minzoom));a&&(this._addTile(a.tileID),t[a.tileID.key]=a.tileID),e[n]=r;}const s=n[n.length-1].overscaledZ;for(const t in this._tiles){const r=this._tiles[t];if(i[t]||!r.hasData())continue;let n=r.tileID;for(;n.overscaledZ>s;){n=n.scaledTo(n.overscaledZ-1);const s=this._tiles[n.key];if(s&&s.hasData()&&e[n.key]){i[t]=r.tileID;break}}}for(const e in t)i[e]||(this._coveredTiles[e]=!0,i[e]=t[e]);}for(const t in i)this._tiles[t].clearFadeHold();const s=function(t,e){const r=[];for(const n in t)n in e||r.push(n);return r}(this._tiles,i);for(const t of s){const e=this._tiles[t];e.hasSymbolBuckets&&!e.holdingForFade()?e.setHoldDuration(this.map._fadeDuration):e.hasSymbolBuckets&&!e.symbolFadeFinished()||this._removeTile(+t);}this._updateLoadedParentTileCache(),this._onlySymbols&&this._source.afterUpdate&&this._source.afterUpdate();}releaseSymbolFadeTiles(){for(const t in this._tiles)this._tiles[t].holdingForFade()&&this._removeTile(+t);}_updateRetainedTiles(t){const e={};if(0===t.length)return e;const r={},n=t.reduce(((t,e)=>Math.min(t,e.overscaledZ)),1/0),i=t[0].overscaledZ,s=Math.max(i-qp.maxOverzooming,this._source.minzoom),a=Math.max(i+qp.maxUnderzooming,this._source.minzoom),o={};for(const r of t){const t=this._addTile(r);e[r.key]=r,t.hasData()||n<this._source.maxzoom&&(o[r.key]=r);}this._retainLoadedChildren(o,n,a,e);for(const n of t){let t=this._tiles[n.key];if(t.hasData())continue;if(n.canonical.z>=this._source.maxzoom){const t=n.children(this._source.maxzoom)[0],r=this.getTile(t);if(r&&r.hasData()){e[t.key]=t;continue}}else {const t=n.children(this._source.maxzoom);if(e[t[0].key]&&e[t[1].key]&&e[t[2].key]&&e[t[3].key])continue}let i=t.wasRequested();for(let a=n.overscaledZ-1;a>=s;--a){const s=n.scaledTo(a);if(r[s.key])break;if(r[s.key]=!0,t=this.getTile(s),!t&&i&&(t=this._addTile(s)),t&&(e[s.key]=s,i=t.wasRequested(),t.hasData()))break}}return e}_updateLoadedParentTileCache(){this._loadedParentTiles={};for(const t in this._tiles){const e=[];let r,n=this._tiles[t].tileID;for(;n.overscaledZ>0;){if(n.key in this._loadedParentTiles){r=this._loadedParentTiles[n.key];break}e.push(n.key);const t=n.scaledTo(n.overscaledZ-1);if(r=this._getLoadedTile(t),r)break;n=t;}for(const t of e)this._loadedParentTiles[t]=r;}}_addTile(t){let e=this._tiles[t.key];if(e)return e;e=this._cache.getAndRemove(t),e&&(this._setTileReloadTimer(t.key,e),e.tileID=t,this._state.initializeTileState(e,this.map?this.map.painter:null),this._cacheTimers[t.key]&&(clearTimeout(this._cacheTimers[t.key]),delete this._cacheTimers[t.key],this._setTileReloadTimer(t.key,e)));const r=Boolean(e);if(!r){const r=this.map?this.map.painter:null,n="raster"===this._source.type||"raster-dem"===this._source.type;e=new ad(t,this._source.tileSize*t.overscaleFactor(),this.transform.tileZoom,r,n),this._loadTile(e,this._tileLoaded.bind(this,e,t.key,e.state));}return e?(e.uses++,this._tiles[t.key]=e,r||this._source.fire(new me("dataloading",{tile:e,coord:e.tileID,dataType:"source"})),e):null}_setTileReloadTimer(t,e){t in this._timers&&(clearTimeout(this._timers[t]),delete this._timers[t]);const r=e.getExpiryTimeout();r&&(this._timers[t]=setTimeout((()=>{this._reloadTile(t,"expired"),delete this._timers[t];}),r));}_removeTile(t){const e=this._tiles[t];e&&(e.uses--,delete this._tiles[t],this._timers[t]&&(clearTimeout(this._timers[t]),delete this._timers[t]),e.uses>0||(e.hasData()&&"reloading"!==e.state?this._cache.add(e.tileID,e,e.getExpiryTimeout()):(e.aborted=!0,this._abortTile(e),this._unloadTile(e))));}clearTiles(){this._shouldReloadOnResume=!1,this._paused=!1;for(const t in this._tiles)this._removeTile(+t);this._source._clear&&this._source._clear(),this._cache.reset();}tilesIn(t,e,r){const n=[],i=this.transform;if(!i)return n;for(const s in this._tiles){const a=this._tiles[s];if(r&&a.clearQueryDebugViz(),a.holdingForFade())continue;const o=t.containsTile(a,i,e);o&&n.push(o);}return n}getVisibleCoordinates(t){const e=this.getRenderableIds(t).map((t=>this._tiles[t].tileID));for(const t of e)t.projMatrix=this.transform.calculateProjMatrix(t.toUnwrapped());return e}hasTransition(){if(this._source.hasTransition())return !0;if(Gp(this._source.type))for(const t in this._tiles){const e=this._tiles[t];if(void 0!==e.fadeEndTime&&e.fadeEndTime>=At.now())return !0}return !1}setFeatureState(t,e,r){this._state.updateState(t=t||"_geojsonTileLayer",e,r);}removeFeatureState(t,e,r){this._state.removeFeatureState(t=t||"_geojsonTileLayer",e,r);}getFeatureState(t,e){return this._state.getState(t=t||"_geojsonTileLayer",e)}setDependencies(t,e,r){const n=this._tiles[t];n&&n.setDependencies(e,r);}reloadTilesForDependencies(t,e){for(const r in this._tiles)this._tiles[r].hasDependency(t,e)&&this._reloadTile(+r,"reloading");this._cache.filter((r=>!r.hasDependency(t,e)));}_preloadTiles(t,e){const r=new Map,n=Array.isArray(t)?t:[t],i=this.map.painter.terrain,s=this.usedForTerrain&&i?i.getScaledDemTileSize():this._source.tileSize;for(const t of n){const e=t.coveringTiles({tileSize:s,minzoom:this._source.minzoom,maxzoom:this._source.maxzoom,roundZoom:this._source.roundZoom&&!this.usedForTerrain,reparseOverscaled:this._source.reparseOverscaled,isTerrainDEM:this.usedForTerrain});for(const t of e)r.set(t.key,t);this.usedForTerrain&&t.updateElevation(!1);}const a=Array.from(r.values()),o="raster"===this._source.type||"raster-dem"===this._source.type;W(a,((t,e)=>{const r=new ad(t,this._source.tileSize*t.overscaleFactor(),this.transform.tileZoom,this.map.painter,o);this._loadTile(r,(t=>{"raster-dem"===this._source.type&&r.dem&&this._backfillDEM(r),e(t,r);}));}),e);}}function Np(t,e){const r=Math.abs(2*t.wrap)-+(t.wrap<0),n=Math.abs(2*e.wrap)-+(e.wrap<0);return t.overscaledZ-e.overscaledZ||n-r||e.canonical.y-t.canonical.y||e.canonical.x-t.canonical.x}function Gp(t){return "raster"===t||"image"===t||"video"===t}qp.maxOverzooming=10,qp.maxUnderzooming=3;class Zp{constructor(t,e,r){this._demTile=t,this._dem=this._demTile.dem,this._scale=e,this._offset=r;}static create(t,e,r){const n=r||t.findDEMTileFor(e);if(!n||!n.dem)return;const i=n.dem,s=n.tileID,a=1<<e.canonical.z-s.canonical.z;return new Zp(n,n.tileSize/To/a,[(e.canonical.x/a-s.canonical.x)*i.dim,(e.canonical.y/a-s.canonical.y)*i.dim])}tileCoordToPixel(t,e){const r=e*this._scale+this._offset[1],n=Math.floor(t*this._scale+this._offset[0]),s=Math.floor(r);return new i(n,s)}getElevationAt(t,e,r,n){const i=t*this._scale+this._offset[0],s=e*this._scale+this._offset[1],a=Math.floor(i),o=Math.floor(s),l=this._dem;return n=!!n,r?Lr(Lr(l.get(a,o,n),l.get(a,o+1,n),s-o),Lr(l.get(a+1,o,n),l.get(a+1,o+1,n),s-o),i-a):l.get(a,o,n)}getElevationAtPixel(t,e,r){return this._dem.get(t,e,!!r)}getMeterToDEM(t){return (1<<this._demTile.tileID.canonical.z)*Lo(1,t)*this._dem.stride}}class Xp{constructor(t,e){this.tileID=t,this.x=t.canonical.x,this.y=t.canonical.y,this.z=t.canonical.z,this.grid=new Oi(To,16,0),this.featureIndexArray=new Na,this.promoteId=e;}insert(t,e,r,n,i,s=0){const a=this.featureIndexArray.length;this.featureIndexArray.emplaceBack(r,n,i,s);const o=this.grid;for(let t=0;t<e.length;t++){const r=e[t],n=[1/0,1/0,-1/0,-1/0];for(let t=0;t<r.length;t++){const e=r[t];n[0]=Math.min(n[0],e.x),n[1]=Math.min(n[1],e.y),n[2]=Math.max(n[2],e.x),n[3]=Math.max(n[3],e.y);}n[0]<To&&n[1]<To&&n[2]>=0&&n[3]>=0&&o.insert(a,n[0],n[1],n[2],n[3]);}}loadVTLayers(){if(!this.vtLayers){this.vtLayers=new Bu.VectorTile(new gc(this.rawTileData)).layers,this.sourceLayerCoder=new Tp(this.vtLayers?Object.keys(this.vtLayers).sort():["_geojsonTileLayer"]),this.vtFeatures={};for(const t in this.vtLayers)this.vtFeatures[t]=[];}return this.vtLayers}query(t,e,r,n){this.loadVTLayers();const i=t.params||{},s=si(i.filter),a=t.tileResult,o=t.transform,l=a.bufferedTilespaceBounds,u=this.grid.query(l.min.x,l.min.y,l.max.x,l.max.y,((t,e,r,n)=>ll(a.bufferedTilespaceGeometry,t,e,r,n)));u.sort(Yp);let c=null;o.elevation&&u.length>0&&(c=Zp.create(o.elevation,this.tileID));const h={};let p;for(let o=0;o<u.length;o++){const l=u[o];if(l===p)continue;p=l;const d=this.featureIndexArray.get(l);let f=null;this.loadMatchingFeature(h,d,s,i.layers,i.availableImages,e,r,n,((e,r,n,i=0)=>(f||(f=Ko(e,this.tileID.canonical,t.tileTransform)),r.queryIntersectsFeature(a,e,n,f,this.z,t.transform,t.pixelPosMatrix,c,i))));}return h}loadMatchingFeature(t,e,r,n,i,s,a,o,l){const{featureIndex:u,bucketIndex:c,sourceLayerIndex:h,layoutVertexArrayOffset:p}=e,d=this.bucketLayerIDs[c];if(n&&!function(t,e){for(let r=0;r<t.length;r++)if(e.indexOf(t[r])>=0)return !0;return !1}(n,d))return;const f=this.sourceLayerCoder.decode(h),y=this.vtLayers[f].feature(u);if(r.needGeometry){const t=Yo(y,!0);if(!r.filter(new Gs(this.tileID.overscaledZ),t,this.tileID.canonical))return}else if(!r.filter(new Gs(this.tileID.overscaledZ),y))return;const m=this.getId(y,f);for(let e=0;e<d.length;e++){const r=d[e];if(n&&n.indexOf(r)<0)continue;const c=s[r];if(!c)continue;let h={};void 0!==m&&o&&(h=o.getState(c.sourceLayer||"_geojsonTileLayer",m));const f=tt({},a[r]);f.paint=Kp(f.paint,c.paint,y,h,i),f.layout=Kp(f.layout,c.layout,y,h,i);const g=!l||l(y,c,h,p);if(!g)continue;const x=new Bp(y,this.z,this.x,this.y,m);x.layer=f;let v=t[r];void 0===v&&(v=t[r]=[]),v.push({featureIndex:u,feature:x,intersectionZ:g});}}lookupSymbolFeatures(t,e,r,n,i,s,a,o){const l={};this.loadVTLayers();const u=si(i);for(const i of t)this.loadMatchingFeature(l,{bucketIndex:r,sourceLayerIndex:n,featureIndex:i,layoutVertexArrayOffset:0},u,s,a,o,e);return l}loadFeature(t){const{featureIndex:e,sourceLayerIndex:r}=t;this.loadVTLayers();const n=this.sourceLayerCoder.decode(r),i=this.vtFeatures[n];if(i[e])return i[e];const s=this.vtLayers[n].feature(e);return i[e]=s,s}hasLayer(t){for(const e of this.bucketLayerIDs)for(const r of e)if(t===r)return !0;return !1}getId(t,e){let r=t.id;return this.promoteId&&(r=t.properties["string"==typeof this.promoteId?this.promoteId:this.promoteId[e]],"boolean"==typeof r&&(r=Number(r))),r}}function Kp(t,e,r,n,i){return lt(t,((t,s)=>{const a=e instanceof Qs?e.get(s):null;return a&&a.evaluate?a.evaluate(r,n,i):a}))}function Yp(t,e){return e-t}Zi("FeatureIndex",Xp,{omit:["rawTileData","sourceLayerCoder"]});var Hp=ca([{name:"a_pos",type:"Int16",components:2}]);const Jp=32,Wp=33,Qp=new Uint16Array(8184);for(let t=0;t<2046;t++){let e=t+2,r=0,n=0,i=0,s=0,a=0,o=0;for(1&e?i=s=a=Jp:r=n=o=Jp;(e>>=1)>1;){const t=r+i>>1,l=n+s>>1;1&e?(i=r,s=n,r=a,n=o):(r=i,n=s,i=a,s=o),a=t,o=l;}const l=4*t;Qp[l+0]=r,Qp[l+1]=n,Qp[l+2]=i,Qp[l+3]=s;}const td=new Uint16Array(2178),ed=new Uint8Array(1089),rd=new Uint16Array(1089);function nd(t){return 0===t?-.03125:32===t?.03125:0}var id=ca([{name:"a_pos",type:"Int16",components:2},{name:"a_texture_pos",type:"Int16",components:2}]);const sd={type:2,extent:To,loadGeometry:()=>[[new i(0,0),new i(8193,0),new i(8193,8193),new i(0,8193),new i(0,0)]]};class ad{constructor(t,e,r,n,i){this.tileID=t,this.uid=rt(),this.uses=0,this.tileSize=e,this.tileZoom=r,this.buckets={},this.expirationTime=null,this.queryPadding=0,this.hasSymbolBuckets=!1,this.hasRTLText=!1,this.dependencies={},this.isRaster=i,this.expiredRequestCount=0,this.state="loading",n&&n.transform&&(this.projection=n.transform.projection);}registerFadeDuration(t){const e=t+this.timeAdded;e<At.now()||this.fadeEndTime&&e<this.fadeEndTime||(this.fadeEndTime=e);}wasRequested(){return "errored"===this.state||"loaded"===this.state||"reloading"===this.state}get tileTransform(){return this._tileTransform||(this._tileTransform=Ad(this.tileID.canonical,this.projection)),this._tileTransform}loadVectorData(t,e,r){if(this.unloadVectorData(),this.state="loaded",t){t.featureIndex&&(this.latestFeatureIndex=t.featureIndex,t.rawTileData?(this.latestRawTileData=t.rawTileData,this.latestFeatureIndex.rawTileData=t.rawTileData):this.latestRawTileData&&(this.latestFeatureIndex.rawTileData=this.latestRawTileData)),this.collisionBoxArray=t.collisionBoxArray,this.buckets=function(t,e){const r={};if(!e)return r;for(const n of t){const t=n.layerIds.map((t=>e.getLayer(t))).filter(Boolean);if(0!==t.length){n.layers=t,n.stateDependentLayerIds&&(n.stateDependentLayers=n.stateDependentLayerIds.map((e=>t.filter((t=>t.id===e))[0])));for(const e of t)r[e.id]=n;}}return r}(t.buckets,e.style),this.hasSymbolBuckets=!1;for(const t in this.buckets){const e=this.buckets[t];if(e instanceof Yh){if(this.hasSymbolBuckets=!0,!r)break;e.justReloaded=!0;}}if(this.hasRTLText=!1,this.hasSymbolBuckets)for(const t in this.buckets){const e=this.buckets[t];if(e instanceof Yh&&e.hasRTLText){this.hasRTLText=!0,Ns.isLoading()||Ns.isLoaded()||"deferred"!==js()||qs();break}}this.queryPadding=0;for(const t in this.buckets){const r=this.buckets[t];this.queryPadding=Math.max(this.queryPadding,e.style.getLayer(t).queryRadius(r));}t.imageAtlas&&(this.imageAtlas=t.imageAtlas),t.glyphAtlasImage&&(this.glyphAtlasImage=t.glyphAtlasImage),t.lineAtlas&&(this.lineAtlas=t.lineAtlas);}else this.collisionBoxArray=new Fa;}unloadVectorData(){if(this.hasData()){for(const t in this.buckets)this.buckets[t].destroy();this.buckets={},this.imageAtlas&&(this.imageAtlas=null),this.lineAtlas&&(this.lineAtlas=null),this.imageAtlasTexture&&this.imageAtlasTexture.destroy(),this.glyphAtlasTexture&&this.glyphAtlasTexture.destroy(),this.lineAtlasTexture&&this.lineAtlasTexture.destroy(),this._tileBoundsBuffer&&(this._tileBoundsBuffer.destroy(),this._tileBoundsIndexBuffer.destroy(),this._tileBoundsSegments.destroy(),this._tileBoundsBuffer=null),this._tileDebugBuffer&&(this._tileDebugBuffer.destroy(),this._tileDebugIndexBuffer.destroy(),this._tileDebugSegments.destroy(),this._tileDebugBuffer=null),this.globeGridBuffer&&(this.globeGridBuffer.destroy(),this.globeGridBuffer=null),this.globePoleBuffer&&(this.globePoleBuffer.destroy(),this.globePoleBuffer=null),this.latestFeatureIndex=null,this.state="unloaded";}}getBucket(t){return this.buckets[t.id]}upload(t){for(const e in this.buckets){const r=this.buckets[e];r.uploadPending()&&r.upload(t);}const e=t.gl;this.imageAtlas&&!this.imageAtlas.uploaded&&(this.imageAtlasTexture=new hp(t,this.imageAtlas.image,e.RGBA),this.imageAtlas.uploaded=!0),this.glyphAtlasImage&&(this.glyphAtlasTexture=new hp(t,this.glyphAtlasImage,e.ALPHA),this.glyphAtlasImage=null),this.lineAtlas&&!this.lineAtlas.uploaded&&(this.lineAtlasTexture=new hp(t,this.lineAtlas.image,e.ALPHA),this.lineAtlas.uploaded=!0);}prepare(t){this.imageAtlas&&this.imageAtlas.patchUpdatedImages(t,this.imageAtlasTexture);}queryRenderedFeatures(t,e,r,n,i,s,a,o){return this.latestFeatureIndex&&this.latestFeatureIndex.rawTileData?this.latestFeatureIndex.query({tileResult:n,pixelPosMatrix:a,transform:s,params:i,tileTransform:this.tileTransform},t,e,r):{}}querySourceFeatures(t,e){const r=this.latestFeatureIndex;if(!r||!r.rawTileData)return;const n=r.loadVTLayers(),i=e?e.sourceLayer:"",s=n._geojsonTileLayer||n[i];if(!s)return;const a=si(e&&e.filter),{z:o,x:l,y:u}=this.tileID.canonical,c={z:o,x:l,y:u};for(let e=0;e<s.length;e++){const n=s.feature(e);if(a.needGeometry){const t=Yo(n,!0);if(!a.filter(new Gs(this.tileID.overscaledZ),t,this.tileID.canonical))continue}else if(!a.filter(new Gs(this.tileID.overscaledZ),n))continue;const h=r.getId(n,i),p=new Bp(n,o,l,u,h);p.tile=c,t.push(p);}}hasData(){return "loaded"===this.state||"reloading"===this.state||"expired"===this.state}patternsLoaded(){return this.imageAtlas&&!!Object.keys(this.imageAtlas.patternPositions).length}setExpiryData(t){const e=this.expirationTime;if(t.cacheControl){const e=mt(t.cacheControl);e["max-age"]&&(this.expirationTime=Date.now()+1e3*e["max-age"]);}else t.expires&&(this.expirationTime=new Date(t.expires).getTime());if(this.expirationTime){const t=Date.now();let r=!1;if(this.expirationTime>t)r=!1;else if(e)if(this.expirationTime<e)r=!0;else {const n=this.expirationTime-e;n?this.expirationTime=t+Math.max(n,3e4):r=!0;}else r=!0;r?(this.expiredRequestCount++,this.state="expired"):this.expiredRequestCount=0;}}getExpiryTimeout(){if(this.expirationTime)return this.expiredRequestCount?1e3*(1<<Math.min(this.expiredRequestCount-1,31)):Math.min(this.expirationTime-(new Date).getTime(),Math.pow(2,31)-1)}setFeatureState(t,e){if(!this.latestFeatureIndex||!this.latestFeatureIndex.rawTileData||0===Object.keys(t).length||!e)return;const r=this.latestFeatureIndex.loadVTLayers(),n=e.style.listImages();for(const i in this.buckets){if(!e.style.hasLayer(i))continue;const s=this.buckets[i],a=s.layers[0].sourceLayer||"_geojsonTileLayer",o=r[a],l=t[a];if(!o||!l||0===Object.keys(l).length)continue;if(s.update(l,o,n,this.imageAtlas&&this.imageAtlas.patternPositions||{}),s instanceof Ku||s instanceof mu){const t=e.style._getSourceCache(s.layers[0].source);e._terrain&&e._terrain.enabled&&t&&s.programConfigurations.needsUpload&&e._terrain._clearRenderCacheForTile(t.id,this.tileID);}const u=e&&e.style&&e.style.getLayer(i);u&&(this.queryPadding=Math.max(this.queryPadding,u.queryRadius(s)));}}holdingForFade(){return void 0!==this.symbolFadeHoldUntil}symbolFadeFinished(){return !this.symbolFadeHoldUntil||this.symbolFadeHoldUntil<At.now()}clearFadeHold(){this.symbolFadeHoldUntil=void 0;}setHoldDuration(t){this.symbolFadeHoldUntil=At.now()+t;}setDependencies(t,e){const r={};for(const t of e)r[t]=!0;this.dependencies[t]=r;}hasDependency(t,e){for(const r of t){const t=this.dependencies[r];if(t)for(const r of e)if(t[r])return !0}return !1}clearQueryDebugViz(){}_makeDebugTileBoundsBuffers(t,e){if(!e||"mercator"===e.name||this._tileDebugBuffer)return;const r=Ko(sd,this.tileID.canonical,this.tileTransform)[0],n=new pa,i=new Pa;for(let t=0;t<r.length;t++){const{x:e,y:s}=r[t];n.emplaceBack(e,s),i.emplaceBack(t);}i.emplaceBack(0),this._tileDebugIndexBuffer=t.createIndexBuffer(i),this._tileDebugBuffer=t.createVertexBuffer(n,id.members),this._tileDebugSegments=Mo.simpleSegment(0,0,n.length,i.length);}_makeTileBoundsBuffers(t,e){if(this._tileBoundsBuffer||!e||"mercator"===e.name)return;const r=Ko(sd,this.tileID.canonical,this.tileTransform)[0];let n,i;if(this.isRaster){const t=function(t,e){const r=Ad(t,e),n=Math.pow(2,t.z);for(let i=0;i<Wp;i++)for(let s=0;s<Wp;s++){const a=Ro((t.x+(s+nd(s))/Jp)/n),o=Uo((t.y+(i+nd(i))/Jp)/n),l=e.project(a,o),u=i*Wp+s;td[2*u+0]=Math.round((l.x*r.scale-r.x)*To),td[2*u+1]=Math.round((l.y*r.scale-r.y)*To);}ed.fill(0),rd.fill(0);for(let t=2045;t>=0;t--){const e=4*t,r=Qp[e+0],n=Qp[e+1],i=Qp[e+2],s=Qp[e+3],a=r+i>>1,o=n+s>>1,l=a+o-n,u=o+r-a,c=n*Wp+r,h=s*Wp+i,p=o*Wp+a,d=Math.hypot((td[2*c+0]+td[2*h+0])/2-td[2*p+0],(td[2*c+1]+td[2*h+1])/2-td[2*p+1])>=16;if(ed[p]=ed[p]||(d?1:0),t<1022){const t=(n+u>>1)*Wp+(r+l>>1),e=(s+u>>1)*Wp+(i+l>>1);ed[p]=ed[p]||ed[t]||ed[e];}}const i=new da,s=new ka;let a=0;function o(t,e){const r=e*Wp+t;return 0===rd[r]&&(i.emplaceBack(td[2*r+0],td[2*r+1],t*To/Jp,e*To/Jp),rd[r]=++a),rd[r]-1}function l(t,e,r,n,i,a){const u=t+r>>1,c=e+n>>1;if(Math.abs(t-i)+Math.abs(e-a)>1&&ed[c*Wp+u])l(i,a,t,e,u,c),l(r,n,i,a,u,c);else {const l=o(t,e),u=o(r,n),c=o(i,a);s.emplaceBack(l,u,c);}}return l(0,0,Jp,Jp,Jp,0),l(Jp,Jp,0,0,0,Jp),{vertices:i,indices:s}}(this.tileID.canonical,e);n=t.vertices,i=t.indices;}else {n=new da,i=new ka;for(const{x:t,y:e}of r)n.emplaceBack(t,e,0,0);const t=Dl(n.int16,void 0,4);for(let e=0;e<t.length;e+=3)i.emplaceBack(t[e],t[e+1],t[e+2]);}this._tileBoundsBuffer=t.createVertexBuffer(n,id.members),this._tileBoundsIndexBuffer=t.createIndexBuffer(i),this._tileBoundsSegments=Mo.simpleSegment(0,0,n.length,i.length);}}const od=ca([{type:"Float32",name:"a_globe_pos",components:3},{type:"Float32",name:"a_merc_pos",components:2},{type:"Float32",name:"a_uv",components:2}]),ld=ca([{type:"Float32",name:"a_pos",components:3},{type:"Float32",name:"a_uv",components:2}]),{members:ud}=od;function cd(t,e){const r=t.fovAboveCenter,n=t.elevation?t.elevation.getMinElevationBelowMSL()*e:0,i=(t._camera.position[2]*t.worldSize-n)/Math.cos(t._pitch),s=Math.sin(r)*i/Math.sin(Math.max(Math.PI/2-t._pitch-r,.01)),a=Math.sin(t._pitch)*s+i;return Math.min(1.01*a,i*(1/t._horizonShift))}const hd=To/Math.PI/2,pd=-hd,dd=hd,fd=[new gl([pd,pd,pd],[dd,dd,dd]),new gl([pd,pd,pd],[0,0,dd]),new gl([0,pd,pd],[dd,0,dd]),new gl([pd,0,pd],[0,dd,dd]),new gl([0,0,pd],[dd,dd,dd])];function yd(t){if(t.z<=1)return fd[t.z+2*t.y+t.x];const[e,r]=md(t),n=[xd(e[0],e[1]),xd(e[0],r[1]),xd(r[0],e[1]),xd(r[0],r[1])],i=[dd,dd,dd],s=[pd,pd,pd];for(const t of n)i[0]=Math.min(i[0],t[0]),i[1]=Math.min(i[1],t[1]),i[2]=Math.min(i[2],t[2]),s[0]=Math.max(s[0],t[0]),s[1]=Math.max(s[1],t[1]),s[2]=Math.max(s[2],t[2]);return new gl(i,s)}function md(t){const e=Math.pow(2,t.z),r=t.x/e,n=(t.x+1)/e,i=(t.y+1)/e;return [[Uo(t.y/e),Ro(r)],[Uo(i),Ro(n)]]}function gd(t,e,r,n){return r=q(r),n||(n=hd),[t*Math.sin(r)*n,-e*n,t*Math.cos(r)*n]}function xd(t,e,r){return gd(Math.cos(q(t)),Math.sin(q(t)),e,r)}function vd(t){return 16383/Math.max(...E([],t.max,t.min))}function bd(t){const e=c(new Float64Array(16)),r=1/vd(t);return p(e,e,t.min),d(e,e,[r,r,r]),e}function wd(t,e,r){const n=e/(2*Math.PI),i=function(t){const e=To/(2*Math.PI);return t/(2*Math.PI)/e}(e);if(!r){const n=Y(t.center.lat,-85.051129,Oo);r=[Vo(t.center.lng)*e,Fo(n)*e];}const s=c(new Float64Array(16));return p(s,s,[r[0],r[1],-n]),d(s,s,[i,i,i]),f(s,s,q(-t._center.lat)),y(s,s,q(-t._center.lng)),s}class _d{constructor(t){const e=this._createGridIndices();this.gridIndexBuffer=t.createIndexBuffer(e,!0),this.gridSegments=Mo.simpleSegment(0,0,4225,8192);const r=this._createPoleTriangleIndices();this.poleIndexBuffer=t.createIndexBuffer(r,!0),this.poleSegments=Mo.simpleSegment(0,0,66,64);const n=new Ta;n.emplaceBack(-1,1,1,0,0,0,0),n.emplaceBack(1,1,1,0,0,1,0),n.emplaceBack(1,-1,1,0,0,1,1),n.emplaceBack(-1,-1,1,0,0,0,1);const i=new ka;i.emplaceBack(0,1,2),i.emplaceBack(2,3,0),this.atmosphereVertexBuffer=t.createVertexBuffer(n,ld.members),this.atmosphereIndexBuffer=t.createIndexBuffer(i),this.atmosphereSegments=Mo.simpleSegment(0,0,4,2);}destroy(){this.poleIndexBuffer.destroy(),this.gridIndexBuffer.destroy(),this.poleSegments.destroy(),this.gridSegments.destroy(),this.atmosphereVertexBuffer.destroy(),this.atmosphereIndexBuffer.destroy(),this.atmosphereSegments.destroy(),this.wireframeIndexBuffer&&(this.wireframeIndexBuffer.destroy(),this.wireframeSegments.destroy());}static createPoleTriangleVertices(t,e,r){const n=new Ta,i=e/Math.PI/2;n.emplaceBack(0,-i,0,0,0,.5,r?0:1);const s=360/t,a=Math.cos(q(85)),o=Math.sin(q(85));for(let t=0;t<=64;t++){const e=t/64,u=gd(a,o,0*(1-(l=e))+s*l,i);n.emplaceBack(u[0],u[1],u[2],0,0,e,r?0:1);}var l;return n}_createPoleTriangleIndices(){const t=new ka;for(let e=0;e<=64;e++)t.emplaceBack(0,e+1,e+2);return t}static createGridVertices(t){const e=Math.pow(2,t.z),r=(t,e,r)=>t*(1-r)+e*r,[n,i]=md(t),s=new Ta,a=function(t){const e=c(new Float64Array(16)),r=vd(t);var n,i;return d(e,e,[r,r,r]),p(e,e,((n=[])[0]=-(i=t.min)[0],n[1]=-i[1],n[2]=-i[2],n)),e}(yd(t));s.reserve(4096);for(let o=0;o<65;o++){const l=r(n[0],i[0],o/64),u=Fo(l),c=u*e-t.y,h=Math.sin(q(l)),p=Math.cos(q(l));for(let t=0;t<65;t++){const e=t/64,o=r(n[1],i[1],e),l=gd(p,h,o);B(l,l,a);const d=Vo(o);s.emplaceBack(l[0],l[1],l[2],d,u,e,c);}}return s}_createGridIndices(){const t=new ka,e=(e,r)=>{const n=65*r+e;t.emplaceBack(n+1,n,n+65),t.emplaceBack(n+65,n+65+1,n+1);};for(let t=0;t<64;t++)for(let r=0;r<64;r++)e(r,t);return t}getWirefameBuffer(t){if(!this.wireframeSegments){const e=this._createWireframeGrid();this.wireframeIndexBuffer=t.createIndexBuffer(e),this.wireframeSegments=Mo.simpleSegment(0,0,4096,e.length);}return [this.wireframeIndexBuffer,this.wireframeSegments]}_createWireframeGrid(){const t=new Ca,e=(e,r)=>{const n=65*r+e;t.emplaceBack(n,n+1),t.emplaceBack(n,n+65),t.emplaceBack(n,n+65+1);};for(let t=0;t<64;t++)for(let r=0;r<64;r++)e(r,t);return t}}function Ad(t,e){if(!e.isReprojectedInTileSpace)return {scale:1<<t.z,x:t.x,y:t.y,x2:t.x+1,y2:t.y+1,projection:e};const r=Math.pow(2,-t.z),n=t.x*r,i=(t.x+1)*r,s=t.y*r,a=(t.y+1)*r,o=Ro(n),l=Ro(i),u=Uo(s),c=Uo(a),h=e.project(o,u),p=e.project(l,u),d=e.project(l,c),f=e.project(o,c);let y=Math.min(h.x,p.x,d.x,f.x),m=Math.min(h.y,p.y,d.y,f.y),g=Math.max(h.x,p.x,d.x,f.x),x=Math.max(h.y,p.y,d.y,f.y);const v=r/16;function b(t,r,n,i,s,a){const o=(n+s)/2,l=(i+a)/2,u=e.project(Ro(o),Uo(l)),c=Math.max(0,y-u.x,m-u.y,u.x-g,u.y-x);y=Math.min(y,u.x),g=Math.max(g,u.x),m=Math.min(m,u.y),x=Math.max(x,u.y),c>v&&(b(t,u,n,i,o,l),b(u,r,o,l,s,a));}b(h,p,n,s,i,s),b(p,d,i,s,i,a),b(d,f,i,a,n,a),b(f,h,n,a,n,s),y-=v,m-=v,g+=v,x+=v;const w=1/Math.max(g-y,x-m);return {scale:w,x:y*w,y:m*w,x2:g*w,y2:x*w,projection:e}}class kd{constructor(t){const e={},r=[];for(const n in t){const i=t[n],s=e[n]={};for(const t in i.glyphs){const e=i.glyphs[+t];if(!e||0===e.bitmap.width||0===e.bitmap.height)continue;const n=e.metrics.localGlyph?2:1,a={x:0,y:0,w:e.bitmap.width+2*n,h:e.bitmap.height+2*n};r.push(a),s[t]=a;}}const{w:n,h:i}=$c(r),s=new zl({width:n||1,height:i||1});for(const r in t){const n=t[r];for(const t in n.glyphs){const i=n.glyphs[+t];if(!i||0===i.bitmap.width||0===i.bitmap.height)continue;const a=e[r][t],o=i.metrics.localGlyph?2:1;zl.copy(i.bitmap,s,{x:0,y:0},{x:a.x+o,y:a.y+o},i.bitmap);}}this.image=s,this.positions=e;}}Zi("GlyphAtlas",kd);class Sd{constructor(t){this.tileID=new bp(t.tileID.overscaledZ,t.tileID.wrap,t.tileID.canonical.z,t.tileID.canonical.x,t.tileID.canonical.y),this.tileZoom=t.tileZoom,this.uid=t.uid,this.zoom=t.zoom,this.canonical=t.tileID.canonical,this.pixelRatio=t.pixelRatio,this.tileSize=t.tileSize,this.source=t.source,this.overscaling=this.tileID.overscaleFactor(),this.showCollisionBoxes=t.showCollisionBoxes,this.collectResourceTiming=!!t.collectResourceTiming,this.returnDependencies=!!t.returnDependencies,this.promoteId=t.promoteId,this.enableTerrain=!!t.enableTerrain,this.isSymbolTile=t.isSymbolTile,this.tileTransform=Ad(t.tileID.canonical,t.projection),this.projection=t.projection;}parse(t,e,r,n,i){this.status="parsing",this.data=t,this.collisionBoxArray=new Fa;const s=new Tp(Object.keys(t.layers).sort()),a=new Xp(this.tileID,this.promoteId);a.bucketLayerIDs=[];const o={},l=new pp(256,256),u={featureIndex:a,iconDependencies:{},patternDependencies:{},glyphDependencies:{},lineAtlas:l,availableImages:r},c=e.familiesBySource[this.source];for(const e in c){const n=t.layers[e];if(!n)continue;let i=!1,l=!1;for(const t of c[e])"symbol"===t[0].type?i=!0:l=!0;if(!0===this.isSymbolTile&&!i)continue;if(!1===this.isSymbolTile&&!l)continue;1===n.version&&pt(`Vector tile source "${this.source}" layer "${e}" does not use vector tile spec v2 and therefore may have some rendering errors.`);const h=s.encode(e),p=[];for(let t=0;t<n.length;t++){const r=n.feature(t),i=a.getId(r,e);p.push({feature:r,id:i,index:t,sourceLayerIndex:h});}for(const t of c[e]){const e=t[0];void 0!==this.isSymbolTile&&"symbol"===e.type!==this.isSymbolTile||e.minzoom&&this.zoom<Math.floor(e.minzoom)||e.maxzoom&&this.zoom>=e.maxzoom||"none"!==e.visibility&&(Id(t,this.zoom,r),(o[e.id]=e.createBucket({index:a.bucketLayerIDs.length,layers:t,zoom:this.zoom,canonical:this.canonical,pixelRatio:this.pixelRatio,overscaling:this.overscaling,collisionBoxArray:this.collisionBoxArray,sourceLayerIndex:h,sourceID:this.source,enableTerrain:this.enableTerrain,availableImages:r})).populate(p,u,this.tileID.canonical,this.tileTransform),a.bucketLayerIDs.push(t.map((t=>t.id))));}}let h,p,d,f;l.trim();const y={type:"maybePrepare",isSymbolTile:this.isSymbolTile,zoom:this.zoom},m=lt(u.glyphDependencies,(t=>Object.keys(t).map(Number)));Object.keys(m).length?n.send("getGlyphs",{uid:this.uid,stacks:m},((t,e)=>{h||(h=t,p=e,v.call(this));}),void 0,!1,y):p={};const g=Object.keys(u.iconDependencies);g.length?n.send("getImages",{icons:g,source:this.source,tileID:this.tileID,type:"icons"},((t,e)=>{h||(h=t,d=e,v.call(this));}),void 0,!1,y):d={};const x=Object.keys(u.patternDependencies);function v(){if(h)return i(h);if(p&&d&&f){const t=new kd(p),e=new jc(d,f);for(const n in o){const i=o[n];i instanceof Yh?(Id(i.layers,this.zoom,r),Eh(i,p,t.positions,d,e.iconPositions,this.showCollisionBoxes,r,this.tileID.canonical,this.tileZoom,this.projection),i.projection=this.projection.name):i.hasPattern&&(i instanceof Ku||i instanceof mu||i instanceof Vu)&&(Id(i.layers,this.zoom,r),i.addFeatures(u,this.tileID.canonical,e.patternPositions,r));}this.status="done",i(null,{buckets:Q(o).filter((t=>!t.isEmpty())),featureIndex:a,collisionBoxArray:this.collisionBoxArray,glyphAtlasImage:t.image,lineAtlas:l,imageAtlas:e,glyphMap:this.returnDependencies?p:null,iconMap:this.returnDependencies?d:null,glyphPositions:this.returnDependencies?t.positions:null});}}x.length?n.send("getImages",{icons:x,source:this.source,tileID:this.tileID,type:"patterns"},((t,e)=>{h||(h=t,f=e,v.call(this));}),void 0,!1,y):f={},v.call(this);}}function Id(t,e,r){const n=new Gs(e);for(const e of t)e.recalculate(n,r);}class zd{constructor(t){this.entries={},this.scheduler=t;}request(t,e,r,n){const i=this.entries[t]=this.entries[t]||{callbacks:[]};if(i.result){const[t,r]=i.result;return this.scheduler?this.scheduler.add((()=>{n(t,r);}),e):n(t,r),()=>{}}return i.callbacks.push(n),i.cancel||(i.cancel=r(((r,n)=>{i.result=[r,n];for(const t of i.callbacks)this.scheduler?this.scheduler.add((()=>{t(r,n);}),e):t(r,n);setTimeout((()=>delete this.entries[t]),3e3);}))),()=>{i.result||(i.callbacks=i.callbacks.filter((t=>t!==n)),i.callbacks.length||(i.cancel(),delete this.entries[t]));}}}function Md(t,e,r){const n=JSON.stringify(t.request);return t.data&&(this.deduped.entries[n]={result:[null,t.data]}),this.deduped.request(n,{type:"parseTile",isSymbolTile:t.isSymbolTile,zoom:t.tileZoom},(e=>{const n=ae(t.request,((t,n,i,s)=>{t?e(t):n&&e(null,{vectorTile:r?void 0:new Bu.VectorTile(new gc(n)),rawData:n,cacheControl:i,expires:s});}));return ()=>{n.cancel(),e();}}),e)}const Td=c(new Float64Array(16));class Bd{constructor(t,e){this._tr=t,this._worldSize=e;}createInversionMatrix(){return Td}createTileMatrix(t){let e,r,n;const i=t.canonical,s=c(new Float64Array(16)),a=this._tr.projection;if(a.isReprojectedInTileSpace){const o=Ad(i,a);e=1,r=o.x+t.wrap*o.scale,n=o.y,d(s,s,[e/o.scale,e/o.scale,this._tr.pixelsPerMeter/this._worldSize]);}else e=this._worldSize/this._tr.zoomScale(i.z),r=(i.x+Math.pow(2,i.z)*t.wrap)*e,n=i.y*e;return p(s,s,[r,n,0]),d(s,s,[e/To,e/To,1]),s}pointCoordinate(t,e,r){const n=this._tr.horizonLineFromTop(!1),s=new i(t,Math.max(n,e));return this._tr.rayIntersectionCoordinate(this._tr.pointRayIntersection(s,r))}upVector(){return [0,0,1]}upVectorScale(){return 1}}var Cd={name:"albers",range:[4,7],center:[-96,37.5],parallels:[29.5,45.5],zAxisUnit:"meters",conic:!0,isReprojectedInTileSpace:!0,unsupportedLayers:["custom"],initializeConstants(){if(this.constants&&$(this.parallels,this.constants.parallels))return;const t=Math.sin(q(this.parallels[0])),e=(t+Math.sin(q(this.parallels[1])))/2,r=1+t*(2*e-t),n=Math.sqrt(r)/e;this.constants={n:e,c:r,r0:n,parallels:this.parallels};},project(t,e){this.initializeConstants();const r=q(t-this.center[0]),n=q(e),{n:i,c:s,r0:a}=this.constants,o=Math.sqrt(s-2*i*Math.sin(n))/i;return {x:o*Math.sin(r*i),y:o*Math.cos(r*i)-a,z:0}},unproject(t,e){this.initializeConstants();const{n:r,c:n,r0:i}=this.constants,s=i+e;let a=Math.atan2(t,Math.abs(s))*Math.sign(s);s*r<0&&(a-=Math.PI*Math.sign(t)*Math.sign(s));const o=q(this.center[0])*r;a=J(a,-Math.PI-o,Math.PI-o);const l=N(a/r)+this.center[0],u=Math.asin(Y((n-(t*t+s*s)*r*r)/(2*r),-1,1)),c=Y(N(u),-85.051129,Oo);return new Po(l,c)},projectTilePoint:(t,e)=>({x:t,y:e,z:0}),locationPoint:(t,e)=>t._coordinatePoint(t.locationCoordinate(e),!1),pixelsPerMeter:(t,e)=>Lo(1,t)*e,farthestPixelDistance(t){return cd(t,this.pixelsPerMeter(t.center.lat,t.worldSize))},createTileTransform:(t,e)=>new Bd(t,e)};const Pd=1.340264,Ed=-.081106,Dd=893e-6,Vd=.003796,Fd=Math.sqrt(3)/2;var Ld={name:"equalEarth",center:[0,0],range:[3.5,7],zAxisUnit:"meters",isReprojectedInTileSpace:!0,unsupportedLayers:["custom"],project(t,e){e=e/180*Math.PI,t=t/180*Math.PI;const r=Math.asin(Fd*Math.sin(e)),n=r*r,i=n*n*n;return {x:.5*(t*Math.cos(r)/(Fd*(Pd+3*Ed*n+i*(7*Dd+9*Vd*n)))/Math.PI+.5),y:1-.5*(r*(Pd+Ed*n+i*(Dd+Vd*n))/Math.PI+1),z:0}},unproject(t,e){t=(2*t-.5)*Math.PI;let r=e=(2*(1-e)-1)*Math.PI,n=r*r,i=n*n*n;for(let t,s,a,o=0;o<12&&(s=r*(Pd+Ed*n+i*(Dd+Vd*n))-e,a=Pd+3*Ed*n+i*(7*Dd+9*Vd*n),t=s/a,r=Y(r-t,-Math.PI/3,Math.PI/3),n=r*r,i=n*n*n,!(Math.abs(t)<1e-12));++o);const s=Fd*t*(Pd+3*Ed*n+i*(7*Dd+9*Vd*n))/Math.cos(r),a=Math.asin(Math.sin(r)/Fd),o=Y(180*s/Math.PI,-180,180),l=Y(180*a/Math.PI,-85.051129,Oo);return new Po(o,l)},projectTilePoint:(t,e)=>({x:t,y:e,z:0}),locationPoint:(t,e)=>t._coordinatePoint(t.locationCoordinate(e),!1),pixelsPerMeter:(t,e)=>Lo(1,t)*e,farthestPixelDistance(t){return cd(t,this.pixelsPerMeter(t.center.lat,t.worldSize))},createTileTransform:(t,e)=>new Bd(t,e)},Rd={name:"equirectangular",supportsWorldCopies:!0,center:[0,0],range:[3.5,7],zAxisUnit:"meters",wrap:!0,isReprojectedInTileSpace:!0,unsupportedLayers:["custom"],project:(t,e)=>({x:.5+t/360,y:.5-e/360,z:0}),unproject(t,e){const r=360*(t-.5),n=Y(360*(.5-e),-85.051129,Oo);return new Po(r,n)},projectTilePoint:(t,e)=>({x:t,y:e,z:0}),locationPoint:(t,e)=>t._coordinatePoint(t.locationCoordinate(e),!1),pixelsPerMeter:(t,e)=>Lo(1,t)*e,farthestPixelDistance(t){return cd(t,this.pixelsPerMeter(t.center.lat,t.worldSize))},createTileTransform:(t,e)=>new Bd(t,e)};const Ud=Math.PI/2;function $d(t){return Math.tan((Ud+t)/2)}var Od={name:"lambertConformalConic",range:[3.5,7],zAxisUnit:"meters",center:[0,30],parallels:[30,30],conic:!0,isReprojectedInTileSpace:!0,unsupportedLayers:["custom"],initializeConstants(){if(this.constants&&$(this.parallels,this.constants.parallels))return;const t=q(this.parallels[0]),e=q(this.parallels[1]),r=Math.cos(t),n=t===e?Math.sin(t):Math.log(r/Math.cos(e))/Math.log($d(e)/$d(t)),i=r*Math.pow($d(t),n)/n;this.constants={n:n,f:i,parallels:this.parallels};},project(t,e){this.initializeConstants(),e=q(e),t=q(t-this.center[0]);const r=1e-6,{n:n,f:i}=this.constants;i>0?e<-Ud+r&&(e=-Ud+r):e>Ud-r&&(e=Ud-r);const s=i/Math.pow($d(e),n),a=s*Math.sin(n*t),o=i-s*Math.cos(n*t);return {x:.5*(a/Math.PI+.5),y:1-.5*(o/Math.PI+.5),z:0}},unproject(t,e){this.initializeConstants(),t=(2*t-.5)*Math.PI,e=(2*(1-e)-.5)*Math.PI;const{n:r,f:n}=this.constants,i=n-e,s=Math.sign(i),a=Math.sign(r)*Math.sqrt(t*t+i*i);let o=Math.atan2(t,Math.abs(i))*s;i*r<0&&(o-=Math.PI*Math.sign(t)*s);const l=Y(N(o/r)+this.center[0],-180,180),u=Y(N(2*Math.atan(Math.pow(n/a,1/r))-Ud),-85.051129,Oo);return new Po(l,u)},projectTilePoint:(t,e)=>({x:t,y:e,z:0}),locationPoint:(t,e)=>t._coordinatePoint(t.locationCoordinate(e),!1),pixelsPerMeter:(t,e)=>Lo(1,t)*e,farthestPixelDistance(t){return cd(t,this.pixelsPerMeter(t.center.lat,t.worldSize))},createTileTransform:(t,e)=>new Bd(t,e)},jd={name:"mercator",wrap:!0,requiresDraping:!1,supportsWorldCopies:!0,supportsTerrain:!0,supportsFog:!0,supportsFreeCamera:!0,zAxisUnit:"meters",center:[0,0],project:(t,e)=>({x:Vo(t),y:Fo(e),z:0}),unproject(t,e){const r=Ro(t),n=Uo(e);return new Po(r,n)},projectTilePoint:(t,e)=>({x:t,y:e,z:0}),locationPoint:(t,e)=>t._coordinatePoint(t.locationCoordinate(e),!1),pixelsPerMeter:(t,e)=>Lo(1,t)*e,farthestPixelDistance(t){return cd(t,this.pixelsPerMeter(t.center.lat,t.worldSize))},createTileTransform:(t,e)=>new Bd(t,e)};const qd=q(Oo);var Nd={name:"naturalEarth",center:[0,0],range:[3.5,7],isReprojectedInTileSpace:!0,zAxisUnit:"meters",unsupportedLayers:["custom"],project(t,e){const r=(e=q(e))*e,n=r*r;return {x:.5*((t=q(t))*(.8707-.131979*r+n*(n*(.003971*r-.001529*n)-.013791))/Math.PI+.5),y:1-.5*(e*(1.007226+r*(.015085+n*(.028874*r-.044475-.005916*n)))/Math.PI+1),z:0}},unproject(t,e){t=(2*t-.5)*Math.PI;let r=e=(2*(1-e)-1)*Math.PI,n=25,i=0,s=r*r;do{s=r*r;const t=s*s;i=(r*(1.007226+s*(.015085+t*(.028874*s-.044475-.005916*t)))-e)/(1.007226+s*(.045255+t*(.259866*s-.311325-.005916*11*t))),r=Y(r-i,-qd,qd);}while(Math.abs(i)>1e-6&&--n>0);s=r*r;const a=Y(N(t/(.8707+s*(s*(s*s*s*(.003971-.001529*s)-.013791)-.131979))),-180,180),o=N(r);return new Po(a,o)},projectTilePoint:(t,e)=>({x:t,y:e,z:0}),locationPoint:(t,e)=>t._coordinatePoint(t.locationCoordinate(e),!1),pixelsPerMeter:(t,e)=>Lo(1,t)*e,farthestPixelDistance(t){return cd(t,this.pixelsPerMeter(t.center.lat,t.worldSize))},createTileTransform:(t,e)=>new Bd(t,e)};const Gd=q(Oo),Zd={albers:Cd,equalEarth:Ld,equirectangular:Rd,lambertConformalConic:Od,mercator:jd,naturalEarth:Nd,winkelTripel:{name:"winkelTripel",center:[0,0],range:[3.5,7],zAxisUnit:"meters",isReprojectedInTileSpace:!0,unsupportedLayers:["custom"],project(t,e){e=q(e),t=q(t);const r=Math.cos(e),n=2/Math.PI,i=Math.acos(r*Math.cos(t/2)),s=Math.sin(i)/i,a=.5*(t*n+2*r*Math.sin(t/2)/s)||0,o=.5*(e+Math.sin(e)/s)||0;return {x:.5*(a/Math.PI+.5),y:1-.5*(o/Math.PI+1),z:0}},unproject(t,e){let r=t=(2*t-.5)*Math.PI,n=e=(2*(1-e)-1)*Math.PI,i=25;const s=1e-6;let a=0,o=0;do{const i=Math.cos(n),s=Math.sin(n),l=2*s*i,u=s*s,c=i*i,h=Math.cos(r/2),p=Math.sin(r/2),d=2*h*p,f=p*p,y=1-c*h*h,m=y?1/y:0,g=y?Math.acos(i*h)*Math.sqrt(1/y):0,x=.5*(2*g*i*p+2*r/Math.PI)-t,v=.5*(g*s+n)-e,b=.5*m*(c*f+g*i*h*u)+1/Math.PI,w=m*(d*l/4-g*s*p),_=.125*m*(l*p-g*s*c*d),A=.5*m*(u*h+g*f*i)+.5,k=w*_-A*b;a=(v*w-x*A)/k,o=(x*_-v*b)/k,r=Y(r-a,-Math.PI,Math.PI),n=Y(n-o,-Gd,Gd);}while((Math.abs(a)>s||Math.abs(o)>s)&&--i>0);return new Po(N(r),N(n))},projectTilePoint:(t,e)=>({x:t,y:e,z:0}),locationPoint:(t,e)=>t._coordinatePoint(t.locationCoordinate(e),!1),pixelsPerMeter:(t,e)=>Lo(1,t)*e,farthestPixelDistance(t){return cd(t,this.pixelsPerMeter(t.center.lat,t.worldSize))},createTileTransform:(t,e)=>new Bd(t,e)}};t.ARRAY_TYPE=l,t.AUTH_ERR_MSG=Et,t.Aabb=gl,t.Actor=class{constructor(t,e,r){this.target=t,this.parent=e,this.mapId=r,this.callbacks={},this.cancelCallbacks={},at(["receive"],this),this.target.addEventListener("message",this.receive,!1),this.globalScope=yt()?t:a,this.scheduler=new mp;}send(t,e,r,n,i=!1,s){const a=Math.round(1e18*Math.random()).toString(36).substring(0,10);r&&(r.metadata=s,this.callbacks[a]=r);const o=wt(this.globalScope)?void 0:[];return this.target.postMessage({id:a,type:t,hasCallback:!!r,targetMapId:n,mustQueue:i,sourceMapId:this.mapId,data:Yi(e,o)},o),{cancel:()=>{r&&delete this.callbacks[a],this.target.postMessage({id:a,type:"<cancel>",targetMapId:n,sourceMapId:this.mapId});}}}receive(t){const e=t.data,r=e.id;if(r&&(!e.targetMapId||this.mapId===e.targetMapId))if("<cancel>"===e.type){const t=this.cancelCallbacks[r];delete this.cancelCallbacks[r],t&&t.cancel();}else if(e.mustQueue||yt()){const t=this.callbacks[r];this.cancelCallbacks[r]=this.scheduler.add((()=>this.processTask(r,e)),t&&t.metadata||{type:"message"});}else this.processTask(r,e);}processTask(t,e){if("<response>"===e.type){const r=this.callbacks[t];delete this.callbacks[t],r&&(e.error?r(Hi(e.error)):r(null,Hi(e.data)));}else {const r=wt(this.globalScope)?void 0:[],n=e.hasCallback?(e,n)=>{delete this.cancelCallbacks[t],this.target.postMessage({id:t,type:"<response>",sourceMapId:this.mapId,error:e?Yi(e):null,data:Yi(n,r)},r);}:t=>{},i=Hi(e.data);if(this.parent[e.type])this.parent[e.type](e.sourceMapId,i,n);else if(this.parent.getWorkerSource){const t=e.type.split(".");this.parent.getWorkerSource(e.sourceMapId,t[0],i.source)[t[1]](i,n);}else n(new Error(`Could not find function ${e.type}`));}}remove(){this.scheduler.remove(),this.target.removeEventListener("message",this.receive,!1);}},t.CanonicalTileID=xp,t.Color=Ge,t.ColorMode=Sp,t.CullFaceMode=Mp,t.DEMData=Op,t.DataConstantProperty=ta,t.DedupedRequest=zd,t.DepthMode=_p,t.EXTENT=To,t.Elevation=class{getAtPointOrZero(t,e=0){return this.getAtPoint(t,e)||0}getAtPoint(t,e,r=!0){null==e&&(e=null);const n=this._source();if(!n)return e;if(t.y<0||t.y>1)return e;const i=n.getSource().maxzoom,s=1<<i,a=Math.floor(t.x),o=t.x-a,l=new bp(i,a,i,Math.floor(o*s),Math.floor(t.y*s)),u=this.findDEMTileFor(l);if(!u||!u.dem)return e;const c=u.dem,h=1<<u.tileID.canonical.z,p=(o*h-u.tileID.canonical.x)*c.dim,d=(t.y*h-u.tileID.canonical.y)*c.dim,f=Math.floor(p),y=Math.floor(d);return (r?this.exaggeration():1)*Lr(Lr(c.get(f,y),c.get(f,y+1),d-y),Lr(c.get(f+1,y),c.get(f+1,y+1),d-y),p-f)}getAtTileOffset(t,e,r){const n=1<<t.canonical.z;return this.getAtPointOrZero(new jo(t.wrap+(t.canonical.x+e/To)/n,(t.canonical.y+r/To)/n))}getAtTileOffsetFunc(t,e){return r=>{const n=this.getAtTileOffset(t,r.x,r.y),i=e.upVector(t.canonical,r.x,r.y);return S(i,i,n*e.upVectorScale(t.canonical)),i}}getForTilePoints(t,e,r,n){const i=Zp.create(this,t,n);return !!i&&(e.forEach((t=>{t[2]=this.exaggeration()*i.getElevationAt(t[0],t[1],r);})),!0)}getMinMaxForTile(t){const e=this.findDEMTileFor(t);if(!e||!e.dem)return null;const r=e.dem.tree,n=e.tileID,i=1<<t.canonical.z-n.canonical.z;let s=t.canonical.x/i-n.canonical.x,a=t.canonical.y/i-n.canonical.y,o=0;for(let e=0;e<t.canonical.z-n.canonical.z&&!r.leaves[o];e++){s*=2,a*=2;const t=2*Math.floor(a)+Math.floor(s);o=r.childOffsets[o]+t,s%=1,a%=1;}return {min:this.exaggeration()*r.minimums[o],max:this.exaggeration()*r.maximums[o]}}getMinElevationBelowMSL(){throw new Error("Pure virtual method called.")}raycast(t,e,r){throw new Error("Pure virtual method called.")}pointCoordinate(t){throw new Error("Pure virtual method called.")}_source(){throw new Error("Pure virtual method called.")}exaggeration(){throw new Error("Pure virtual method called.")}findDEMTileFor(t){throw new Error("Pure virtual method called.")}get visibleDemTiles(){throw new Error("Getter must be implemented in subclass.")}},t.ErrorEvent=ge,t.EvaluationParameters=Gs,t.Event=me,t.Evented=xe,t.Frustum=ml,t.GLOBE_ZOOM_THRESHOLD_MAX=6,t.GlobeSharedBuffers=_d,t.GlyphManager=xh,t.ImagePosition=Oc,t.LineAtlas=pp,t.LngLat=Po,t.LngLatBounds=Bo,t.LocalGlyphMode=gh,t.MAX_MERCATOR_LATITUDE=Oo,t.MercatorCoordinate=jo,t.ONE_EM=sc,t.OverscaledTileID=bp,t.Properties=sa,t.RGBAImage=Ml,t.Ray=class{constructor(t,e){this.pos=t,this.dir=e;}intersectsPlane(t,e,r){const n=M(e,this.dir);if(Math.abs(n)<1e-6)return !1;const i=((t[0]-this.pos[0])*e[0]+(t[1]-this.pos[1])*e[1]+(t[2]-this.pos[2])*e[2])/n;return r[0]=this.pos[0]+this.dir[0]*i,r[1]=this.pos[1]+this.dir[1]*i,r[2]=this.pos[2]+this.dir[2]*i,!0}closestPointOnSphere(t,e,r){if(function(t,e){var r=t[0],n=t[1],i=t[2],s=e[0],a=e[1],l=e[2];return Math.abs(r-s)<=o*Math.max(1,Math.abs(r),Math.abs(s))&&Math.abs(n-a)<=o*Math.max(1,Math.abs(n),Math.abs(a))&&Math.abs(i-l)<=o*Math.max(1,Math.abs(i),Math.abs(l))}(this.pos,t)||0===e)return r[0]=r[1]=r[2]=0,!1;const[n,i,s]=this.dir,a=this.pos[0]-t[0],l=this.pos[1]-t[1],u=this.pos[2]-t[2],c=n*n+i*i+s*s,h=2*(a*n+l*i+u*s),p=h*h-4*c*(a*a+l*l+u*u-e*e);if(p<0){const t=Math.max(-h/2,0),o=a+n*t,c=l+i*t,p=u+s*t,d=Math.hypot(o,c,p);return r[0]=o*e/d,r[1]=c*e/d,r[2]=p*e/d,!1}{const t=(-h-Math.sqrt(p))/(2*c);if(t<0){const t=Math.hypot(a,l,u);return r[0]=a*e/t,r[1]=l*e/t,r[2]=u*e/t,!1}return r[0]=a+n*t,r[1]=l+i*t,r[2]=u+s*t,!0}}},t.RequestManager=class{constructor(t,e,r){this._transformRequestFn=t,this._customAccessToken=e,this._silenceAuthErrors=!!r,this._createSkuToken();}_createSkuToken(){const t=function(){let t="";for(let e=0;e<10;e++)t+="0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(62*Math.random())];return {token:["1",Pt,t].join(""),tokenExpiresAt:Date.now()+432e5}}();this._skuToken=t.token,this._skuTokenExpiresAt=t.tokenExpiresAt;}_isSkuTokenExpired(){return Date.now()>this._skuTokenExpiresAt}transformRequest(t,e){return this._transformRequestFn&&this._transformRequestFn(t,e)||{url:t}}normalizeStyleURL(t,e){if(!Dt(t))return t;const r=Lt(t);return r.path=`/styles/v1${r.path}`,this._makeAPIURL(r,this._customAccessToken||e)}normalizeGlyphsURL(t,e){if(!Dt(t))return t;const r=Lt(t);return r.path=`/fonts/v1${r.path}`,this._makeAPIURL(r,this._customAccessToken||e)}normalizeSourceURL(t,e){if(!Dt(t))return t;const r=Lt(t);return r.path=`/v4/${r.authority}.json`,r.params.push("secure"),this._makeAPIURL(r,this._customAccessToken||e)}normalizeSpriteURL(t,e,r,n){const i=Lt(t);return Dt(t)?(i.path=`/styles/v1${i.path}/sprite${e}${r}`,this._makeAPIURL(i,this._customAccessToken||n)):(i.path+=`${e}${r}`,Rt(i))}normalizeTileURL(t,e,r){if(this._isSkuTokenExpired()&&this._createSkuToken(),t&&!Dt(t))return t;const n=Lt(t);n.path=n.path.replace(/(\.(png|jpg)\d*)(?=$)/,`${e||r&&"raster"!==n.authority&&512===r?"@2x":""}${It.supported?".webp":"$1"}`),"raster"===n.authority?n.path=`/${St.RASTER_URL_PREFIX}${n.path}`:(n.path=n.path.replace(/^.+\/v4\//,"/"),n.path=`/${St.TILE_URL_VERSION}${n.path}`);const i=this._customAccessToken||function(t){for(const e of t){const t=e.match(/^access_token=(.*)$/);if(t)return t[1]}return null}(n.params)||St.ACCESS_TOKEN;return St.REQUIRE_ACCESS_TOKEN&&i&&this._skuToken&&n.params.push(`sku=${this._skuToken}`),this._makeAPIURL(n,i)}canonicalizeTileURL(t,e){const r=Lt(t);if(!r.path.match(/^(\/v4\/|\/raster\/v1\/)/)||!r.path.match(/\.[\w]+$/))return t;let n="mapbox://";r.path.match(/^\/raster\/v1\//)?n+=`raster/${r.path.replace(`/${St.RASTER_URL_PREFIX}/`,"")}`:n+=`tiles/${r.path.replace(`/${St.TILE_URL_VERSION}/`,"")}`;let i=r.params;return e&&(i=i.filter((t=>!t.match(/^access_token=/)))),i.length&&(n+=`?${i.join("&")}`),n}canonicalizeTileset(t,e){const r=!!e&&Dt(e),n=[];for(const e of t.tiles||[])Vt(e)?n.push(this.canonicalizeTileURL(e,r)):n.push(e);return n}_makeAPIURL(t,e){const r="See https://www.mapbox.com/api-documentation/#access-tokens-and-token-scopes",n=Lt(St.API_URL);if(t.protocol=n.protocol,t.authority=n.authority,"http"===t.protocol){const e=t.params.indexOf("secure");e>=0&&t.params.splice(e,1);}if("/"!==n.path&&(t.path=`${n.path}${t.path}`),!St.REQUIRE_ACCESS_TOKEN)return Rt(t);if(e=e||St.ACCESS_TOKEN,!this._silenceAuthErrors){if(!e)throw new Error(`An API access token is required to use Mapbox GL. ${r}`);if("s"===e[0])throw new Error(`Use a public access token (pk.*) with Mapbox GL, not a secret access token (sk.*). ${r}`)}return t.params=t.params.filter((t=>-1===t.indexOf("access_token"))),t.params.push(`access_token=${e||""}`),Rt(t)}},t.ResourceType=re,t.SegmentVector=Mo,t.SourceCache=qp,t.StencilMode=kp,t.StructArrayLayout1ui2=Pa,t.StructArrayLayout2f1f2i16=_a,t.StructArrayLayout2i4=pa,t.StructArrayLayout2ui4=Ca,t.StructArrayLayout3f12=ya,t.StructArrayLayout3ui6=ka,t.StructArrayLayout4i8=da,t.Texture=hp,t.Tile=ad,t.Transitionable=Ks,t.Uniform1f=io,t.Uniform1i=class extends no{constructor(t,e){super(t,e),this.current=0;}set(t){this.current!==t&&(this.current=t,this.gl.uniform1i(this.location,t));}},t.Uniform2f=class extends no{constructor(t,e){super(t,e),this.current=[0,0];}set(t){t[0]===this.current[0]&&t[1]===this.current[1]||(this.current=t,this.gl.uniform2f(this.location,t[0],t[1]));}},t.Uniform3f=class extends no{constructor(t,e){super(t,e),this.current=[0,0,0];}set(t){t[0]===this.current[0]&&t[1]===this.current[1]&&t[2]===this.current[2]||(this.current=t,this.gl.uniform3f(this.location,t[0],t[1],t[2]));}},t.Uniform4f=so,t.UniformColor=ao,t.UniformMatrix2f=class extends no{constructor(t,e){super(t,e),this.current=uo;}set(t){for(let e=0;e<4;e++)if(t[e]!==this.current[e]){this.current=t,this.gl.uniformMatrix2fv(this.location,!1,t);break}}},t.UniformMatrix3f=class extends no{constructor(t,e){super(t,e),this.current=lo;}set(t){for(let e=0;e<9;e++)if(t[e]!==this.current[e]){this.current=t,this.gl.uniformMatrix3fv(this.location,!1,t);break}}},t.UniformMatrix4f=class extends no{constructor(t,e){super(t,e),this.current=oo;}set(t){if(t[12]!==this.current[12]||t[0]!==this.current[0])return this.current=t,void this.gl.uniformMatrix4fv(this.location,!1,t);for(let e=1;e<16;e++)if(t[e]!==this.current[e]){this.current=t,this.gl.uniformMatrix4fv(this.location,!1,t);break}}},t.UnwrappedTileID=vp,t.ValidationError=be,t.VectorTileWorkerSource=class extends xe{constructor(t,e,r,n,i){super(),this.actor=t,this.layerIndex=e,this.availableImages=r,this.loadVectorData=i||Md,this.loading={},this.loaded={},this.deduped=new zd(t.scheduler),this.isSpriteLoaded=n,this.scheduler=t.scheduler;}loadTile(t,e){const r=t.uid,n=t&&t.request,i=n&&n.collectResourceTiming,s=this.loading[r]=new Sd(t);s.abort=this.loadVectorData(t,((a,o)=>{const l=!this.loading[r];if(delete this.loading[r],l||a||!o)return s.status="done",l||(this.loaded[r]=s),e(a);const u=o.rawData,c={};o.expires&&(c.expires=o.expires),o.cacheControl&&(c.cacheControl=o.cacheControl),s.vectorTile=o.vectorTile||new Bu.VectorTile(new gc(u));const h=()=>{s.parse(s.vectorTile,this.layerIndex,this.availableImages,this.actor,((t,r)=>{if(t||!r)return e(t);const s={};if(i){const t=yp(n);t.length>0&&(s.resourceTiming=JSON.parse(JSON.stringify(t)));}e(null,tt({rawTileData:u.slice(0)},r,c,s));}));};this.isSpriteLoaded?h():this.once("isSpriteLoaded",(()=>{this.scheduler?this.scheduler.add(h,{type:"parseTile",isSymbolTile:t.isSymbolTile,zoom:t.tileZoom}):h();})),this.loaded=this.loaded||{},this.loaded[r]=s;}));}reloadTile(t,e){const r=this.loaded,n=t.uid,i=this;if(r&&r[n]){const s=r[n];s.showCollisionBoxes=t.showCollisionBoxes,s.enableTerrain=!!t.enableTerrain,s.projection=t.projection;const a=(t,r)=>{const n=s.reloadCallback;n&&(delete s.reloadCallback,s.parse(s.vectorTile,i.layerIndex,this.availableImages,i.actor,n)),e(t,r);};"parsing"===s.status?s.reloadCallback=a:"done"===s.status&&(s.vectorTile?s.parse(s.vectorTile,this.layerIndex,this.availableImages,this.actor,a):a());}}abortTile(t,e){const r=t.uid,n=this.loading[r];n&&(n.abort&&n.abort(),delete this.loading[r]),e();}removeTile(t,e){const r=this.loaded,n=t.uid;r&&r[n]&&delete r[n],e();}},t.WritingMode=qc,t.ZoomHistory=Ji,t.add=w,t.addDynamicAttributes=Gh,t.adjoint=function(t,e){var r=e[0],n=e[1],i=e[2],s=e[3],a=e[4],o=e[5],l=e[6],u=e[7],c=e[8];return t[0]=a*c-o*u,t[1]=i*u-n*c,t[2]=n*o-i*a,t[3]=o*l-s*c,t[4]=r*c-i*l,t[5]=i*s-r*o,t[6]=s*u-a*l,t[7]=n*l-r*u,t[8]=r*a-n*s,t},t.asyncAll=W,t.bezier=X,t.bindAll=at,t.boundsAttributes=id,t.bufferConvexPolygon=function(t,e){const r=[];for(let n=0;n<t.length;n++){const i=J(n-1,-1,t.length-1),s=J(n+1,-1,t.length-1),a=t[n],o=t[s],l=t[i].sub(a).unit(),u=o.sub(a).unit(),c=u.angleWithSep(l.x,l.y),h=l.add(u).unit().mult(-1*e/Math.sin(c/2));r.push(a.add(h));}return r},t.cacheEntryPossiblyAdded=function(t){ee++,ee>Wt&&(t.getActor().send("enforceCacheSizeLimit",Jt),ee=0);},t.calculateGlobeMatrix=wd,t.calculateGlobeMercatorMatrix=function(t){const e=t.worldSize,r=Y(t.center.lat,-85.051129,Oo),n=new i(Vo(t.center.lng)*e,Fo(r)*e),s=Lo(1,t.center.lat)*e,a=t.pixelsPerMeter,o=e/(s/t.pixelsPerMeter),l=c(new Float64Array(16));return p(l,l,[n.x,n.y,0]),d(l,l,[o,o,a]),l},t.clamp=Y,t.clearTileCache=function(t){const e=a.caches.delete(Kt);t&&e.catch(t).then((()=>t()));},t.clipLine=dh,t.clone=function(t){var e=new l(16);return e[0]=t[0],e[1]=t[1],e[2]=t[2],e[3]=t[3],e[4]=t[4],e[5]=t[5],e[6]=t[6],e[7]=t[7],e[8]=t[8],e[9]=t[9],e[10]=t[10],e[11]=t[11],e[12]=t[12],e[13]=t[13],e[14]=t[14],e[15]=t[15],e},t.clone$1=ct,t.collisionCircleLayout=ic,t.config=St,t.conjugate=function(t,e){return t[0]=-e[0],t[1]=-e[1],t[2]=-e[2],t[3]=e[3],t},t.create=function(){var t=new l(16);return l!=Float32Array&&(t[1]=0,t[2]=0,t[3]=0,t[4]=0,t[6]=0,t[7]=0,t[8]=0,t[9]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0),t[0]=1,t[5]=1,t[10]=1,t[15]=1,t},t.create$1=u,t.createExpression=Gn,t.createLayout=ca,t.createStyleLayer=function(t){return "custom"===t.type?new rp(t):new sp[t.type](t)},t.cross=T,t.degToRad=q,t.div=function(t,e,r){return t[0]=e[0]/r[0],t[1]=e[1]/r[1],t[2]=e[2]/r[2],t},t.dot=M,t.ease=K,t.easeCubicInOut=Z,t.emitValidationErrors=$i,t.endsWith=ot,t.enforceCacheSizeLimit=function(t){Qt(),Yt&&Yt.then((e=>{e.keys().then((r=>{for(let n=0;n<r.length-t;n++)e.delete(r[n]);}));}));},t.evaluateSizeForFeature=lc,t.evaluateSizeForZoom=uc,t.evaluateVariableOffset=Ph,t.evented=Os,t.exactEquals=function(t,e){return t[0]===e[0]&&t[1]===e[1]&&t[2]===e[2]&&t[3]===e[3]},t.exactEquals$1=function(t,e){return t[0]===e[0]&&t[1]===e[1]&&t[2]===e[2]},t.exported=At,t.exported$1=It,t.extend=tt,t.extend$1=_e,t.filterObject=ut,t.fromMat4=function(t,e){return t[0]=e[0],t[1]=e[1],t[2]=e[2],t[3]=e[4],t[4]=e[5],t[5]=e[6],t[6]=e[8],t[7]=e[9],t[8]=e[10],t},t.fromQuat=function(t,e){var r=e[0],n=e[1],i=e[2],s=e[3],a=r+r,o=n+n,l=i+i,u=r*a,c=n*a,h=n*o,p=i*a,d=i*o,f=i*l,y=s*a,m=s*o,g=s*l;return t[0]=1-h-f,t[1]=c+g,t[2]=p-m,t[3]=0,t[4]=c-g,t[5]=1-u-f,t[6]=d+y,t[7]=0,t[8]=p+m,t[9]=d-y,t[10]=1-u-h,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,t},t.fromRotation=function(t,e){var r=Math.sin(e),n=Math.cos(e);return t[0]=n,t[1]=r,t[2]=0,t[3]=-r,t[4]=n,t[5]=0,t[6]=0,t[7]=0,t[8]=1,t},t.fromScaling=function(t,e){return t[0]=e[0],t[1]=0,t[2]=0,t[3]=0,t[4]=0,t[5]=e[1],t[6]=0,t[7]=0,t[8]=0,t[9]=0,t[10]=e[2],t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,t},t.furthestTileCorner=function(t){const e=Math.round((t+45+360)%360/90)%4;return G[e]},t.getAABBPointSquareDist=function(t,e,r){let n=0;for(let i=0;i<2;++i){const s=r?r[i]:0;t[i]>s&&(n+=(t[i]-s)*(t[i]-s)),e[i]<s&&(n+=(s-e[i])*(s-e[i]));}return n},t.getAnchorAlignment=eh,t.getAnchorJustification=Dh,t.getBounds=function(t){let e=1/0,r=1/0,n=-1/0,s=-1/0;for(const i of t)e=Math.min(e,i.x),r=Math.min(r,i.y),n=Math.max(n,i.x),s=Math.max(s,i.y);return {min:new i(e,r),max:new i(n,s)}},t.getColumn=function(t,e){return [t[4*e],t[4*e+1],t[4*e+2],t[4*e+3]]},t.getImage=de,t.getJSON=function(t,e){return se(tt(t,{type:"json"}),e)},t.getMapSessionAPI=Zt,t.getPerformanceMeasurement=yp,t.getProjection=function(t){const e=Zd[t.name];if(!e)throw new Error(`Invalid projection name: ${t.name}`);return e.conic?function(t,e){if(e.parallels&&Math.abs(e.parallels[0]+e.parallels[1])<.01){let r=function(t){const e=Math.max(.01,Math.cos(q(t))),r=1/(2*Math.max(Math.PI*e,1/e));return {wrap:!0,supportsWorldCopies:!0,unsupportedLayers:["custom"],project(t,n){const i=q(t)*e,s=Math.sin(q(n))/e;return {x:i*r+.5,y:-s*r+.5,z:0}},unproject(t,n){const i=-(n-.5)/r,s=Y(N((t-.5)/r)/e,-180,180),a=Math.asin(Y(i*e,-1,1)),o=Y(N(a),-85.051129,Oo);return new Po(s,o)}}}(e.parallels[0]);if("lambertConformalConic"===e.name){const{project:t,unproject:e}=Zd.mercator;r={wrap:!0,supportsWorldCopies:!0,project:t,unproject:e};}return tt({},t,e,r)}return tt({},t,e)}(e,t):e},t.getRTLTextPluginStatus=js,t.getReferrer=ie,t.getTilePoint=function(t,{x:e,y:r},n=0){return new i(((e-n)*t.scale-t.x)*To,(r*t.scale-t.y)*To)},t.getTileVec3=function(t,e,r=0){return b(((e.x-r)*t.scale-t.x)*To,(e.y*t.scale-t.y)*To,$o(e.z,e.y))},t.getVideo=function(t,e){const r=a.document.createElement("video");r.muted=!0,r.onloadstart=function(){e(null,r);};for(let e=0;e<t.length;e++){const n=a.document.createElement("source");ue(t[e])||(r.crossOrigin="Anonymous"),n.src=t[e],r.appendChild(n);}return {cancel:()=>{}}},t.globeBuffersForTileMesh=function(t,e,r,n){const i=t.context,s=t.transform;let a=e.globeGridBuffer,o=e.globePoleBuffer;if(!a){const t=_d.createGridVertices(r.canonical);a=e.globeGridBuffer=i.createVertexBuffer(t,ud,!1);}if(!o){const t=_d.createPoleTriangleVertices(n,s.tileSize*n,0===r.canonical.y);o=e.globePoleBuffer=i.createVertexBuffer(t,ud,!1);}return [a,o]},t.globeDenormalizeECEF=bd,t.globeMatrixForTile=function(t,e){const r=bd(yd(t)),n=((i=new Float64Array(16))[0]=(s=e)[0],i[1]=s[1],i[2]=s[2],i[3]=s[3],i[4]=s[4],i[5]=s[5],i[6]=s[6],i[7]=s[7],i[8]=s[8],i[9]=s[9],i[10]=s[10],i[11]=s[11],i[12]=s[12],i[13]=s[13],i[14]=s[14],i[15]=s[15],i);var i,s;return m(n,n,r),n},t.globePoleMatrixForTile=function(t,e,r){const n=c(new Float64Array(16)),i=Math.pow(2,t.z),s=(t.x-i/2)/i*Math.PI*2,a=r.point,o=r.worldSize/(r.tileSize*i);return p(n,n,[a.x,a.y,-r.worldSize/Math.PI/2]),d(n,n,[o,o,o]),f(n,n,q(-r._center.lat)),y(n,n,q(-r._center.lng)),y(n,n,s),e&&d(n,n,[1,-1,1]),n},t.globeTileBounds=yd,t.globeToMercatorTransition=function(t){return H(5,6,t)},t.identity=c,t.identity$1=R,t.invert=function(t,e){var r=e[0],n=e[1],i=e[2],s=e[3],a=e[4],o=e[5],l=e[6],u=e[7],c=e[8],h=e[9],p=e[10],d=e[11],f=e[12],y=e[13],m=e[14],g=e[15],x=r*o-n*a,v=r*l-i*a,b=r*u-s*a,w=n*l-i*o,_=n*u-s*o,A=i*u-s*l,k=c*y-h*f,S=c*m-p*f,I=c*g-d*f,z=h*m-p*y,M=h*g-d*y,T=p*g-d*m,B=x*T-v*M+b*z+w*I-_*S+A*k;return B?(t[0]=(o*T-l*M+u*z)*(B=1/B),t[1]=(i*M-n*T-s*z)*B,t[2]=(y*A-m*_+g*w)*B,t[3]=(p*_-h*A-d*w)*B,t[4]=(l*I-a*T-u*S)*B,t[5]=(r*T-i*I+s*S)*B,t[6]=(m*b-f*A-g*v)*B,t[7]=(c*A-p*b+d*v)*B,t[8]=(a*M-o*I+u*k)*B,t[9]=(n*I-r*M-s*k)*B,t[10]=(f*_-y*b+g*x)*B,t[11]=(h*b-c*_-d*x)*B,t[12]=(o*S-a*z-l*k)*B,t[13]=(r*z-n*S+i*k)*B,t[14]=(y*v-f*w-m*x)*B,t[15]=(c*w-h*v+p*x)*B,t):null},t.isMapAuthenticated=function(t){return Xt.has(t)},t.isMapboxURL=Dt,t.latFromMercatorY=Uo,t.len=V,t.length=v,t.length$1=function(t){return Math.hypot(t[0],t[1],t[2],t[3])},t.loadVectorTile=Md,t.makeRequest=se,t.mercatorXfromLng=Vo,t.mercatorYfromLat=Fo,t.mercatorZfromAltitude=Lo,t.mul=m,t.mul$1=D,t.multiply=function(t,e,r){var n=e[0],i=e[1],s=e[2],a=e[3],o=e[4],l=e[5],u=e[6],c=e[7],h=e[8],p=r[0],d=r[1],f=r[2],y=r[3],m=r[4],g=r[5],x=r[6],v=r[7],b=r[8];return t[0]=p*n+d*a+f*u,t[1]=p*i+d*o+f*c,t[2]=p*s+d*l+f*h,t[3]=y*n+m*a+g*u,t[4]=y*i+m*o+g*c,t[5]=y*s+m*l+g*h,t[6]=x*n+v*a+b*u,t[7]=x*i+v*o+b*c,t[8]=x*s+v*l+b*h,t},t.multiply$1=h,t.multiply$2=A,t.nextPowerOfTwo=it,t.normalize=z,t.normalize$1=function(t,e){var r=e[0],n=e[1],i=e[2],s=e[3],a=r*r+n*n+i*i+s*s;return a>0&&(a=1/Math.sqrt(a)),t[0]=r*a,t[1]=n*a,t[2]=i*a,t[3]=s*a,t},t.number=Lr,t.ortho=function(t,e,r,n,i,s,a){var o=1/(e-r),l=1/(n-i),u=1/(s-a);return t[0]=-2*o,t[1]=0,t[2]=0,t[3]=0,t[4]=0,t[5]=-2*l,t[6]=0,t[7]=0,t[8]=0,t[9]=0,t[10]=2*u,t[11]=0,t[12]=(e+r)*o,t[13]=(i+n)*l,t[14]=(a+s)*u,t[15]=1,t},t.pbf=gc,t.perspective=function(t,e,r,n,i){var s,a=1/Math.tan(e/2);return t[0]=a/r,t[1]=0,t[2]=0,t[3]=0,t[4]=0,t[5]=a,t[6]=0,t[7]=0,t[8]=0,t[9]=0,t[11]=-1,t[12]=0,t[13]=0,t[15]=0,null!=i&&i!==1/0?(t[10]=(i+n)*(s=1/(n-i)),t[14]=2*i*n*s):(t[10]=-1,t[14]=-2*n),t},t.pick=function(t,e){const r={};for(let n=0;n<e.length;n++){const i=e[n];i in t&&(r[i]=t[i]);}return r},t.plugin=Ns,t.pointGeometry=i,t.polygonIntersectsBox=ll,t.polygonIntersectsPolygon=Wo,t.polygonizeBounds=function(t,e,r=0,n=!0){const s=new i(r,r),a=t.sub(s),o=e.add(s),l=[a,new i(o.x,a.y),o,new i(a.x,o.y)];return n&&l.push(a),l},t.posAttributes=Hp,t.postMapLoadEvent=Nt,t.postTurnstileEvent=jt,t.potpack=$c,t.prevPowerOfTwo=function(t){return t<=1?1:Math.pow(2,Math.floor(Math.log(t)/Math.LN2))},t.radToDeg=N,t.refProperties=["type","source","source-layer","minzoom","maxzoom","filter","layout"],t.registerForPluginStateChange=function(t){return t({pluginStatus:Ls,pluginURL:Rs}),Os.on("pluginStateChange",t),t},t.removeAuthState=function(t){Xt.delete(t);},t.renderColorRamp=Bl,t.rotateX=f,t.rotateX$1=U,t.rotateY=y,t.rotateZ=function(t,e,r){var n=Math.sin(r),i=Math.cos(r),s=e[0],a=e[1],o=e[2],l=e[3],u=e[4],c=e[5],h=e[6],p=e[7];return e!==t&&(t[8]=e[8],t[9]=e[9],t[10]=e[10],t[11]=e[11],t[12]=e[12],t[13]=e[13],t[14]=e[14],t[15]=e[15]),t[0]=s*i+u*n,t[1]=a*i+c*n,t[2]=o*i+h*n,t[3]=l*i+p*n,t[4]=u*i-s*n,t[5]=c*i-a*n,t[6]=h*i-o*n,t[7]=p*i-l*n,t},t.rotateZ$1=function(t,e,r){r*=.5;var n=e[0],i=e[1],s=e[2],a=e[3],o=Math.sin(r),l=Math.cos(r);return t[0]=n*l+i*o,t[1]=i*l-n*o,t[2]=s*l+a*o,t[3]=a*l-s*o,t},t.scale=d,t.scale$1=function(t,e,r){return t[0]=e[0]*r,t[1]=e[1]*r,t[2]=e[2]*r,t[3]=e[3]*r,t},t.scale$2=S,t.scaleAndAdd=I,t.setCacheLimits=function(t,e){Jt=t,Wt=e;},t.setColumn=function(t,e,r){t[4*e+0]=r[0],t[4*e+1]=r[1],t[4*e+2]=r[2],t[4*e+3]=r[3];},t.setRTLTextPlugin=function(t,e,r=!1){if(Ls===Es||Ls===Ds||Ls===Vs)throw new Error("setRTLTextPlugin cannot be called multiple times.");Rs=At.resolveURL(t),Ls=Es,Fs=e,$s(),r||qs();},t.smoothstep=H,t.spec=ve,t.storeAuthState=function(t,e){e?Xt.add(t):Xt.delete(t);},t.sub=E,t.subtract=_,t.symbolSize=cc,t.tileAABB=function(t,e,r,n,i,s,a,o,l){if("globe"===l.name){const a=yd(new vp(s,new xp(r,n,i)).canonical).getCorners(),o=Number.MAX_VALUE,l=[-o,-o,-o],p=[o,o,o],d=wd(t,e);for(let t=0;t<a.length;t++)B(a[t],a[t],d),c=p,h=a[t],(u=p)[0]=Math.min(c[0],h[0]),u[1]=Math.min(c[1],h[1]),u[2]=Math.min(c[2],h[2]),k(l,l,a[t]);return new gl(p,l)}var u,c,h;const p=Ad({z:r,x:n,y:i},l);return new gl([(s+p.x/p.scale)*e,e*(p.y/p.scale),a],[(s+p.x2/p.scale)*e,e*(p.y2/p.scale),o])},t.tileTransform=Ad,t.transformMat3=function(t,e,r){var n=e[0],i=e[1],s=e[2];return t[0]=n*r[0]+i*r[3]+s*r[6],t[1]=n*r[1]+i*r[4]+s*r[7],t[2]=n*r[2]+i*r[5]+s*r[8],t},t.transformMat4=B,t.transformMat4$1=F,t.transformQuat=C,t.translate=p,t.transpose=function(t,e){if(t===e){var r=e[1],n=e[2],i=e[5];t[1]=e[3],t[2]=e[6],t[3]=r,t[5]=e[7],t[6]=n,t[7]=i;}else t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8];return t},t.triggerPluginCompletionEvent=Us,t.uniqueId=rt,t.validateCustomStyleLayer=function(t){const e=[],r=t.id;return void 0===r&&e.push({message:`layers.${r}: missing required property "id"`}),void 0===t.render&&e.push({message:`layers.${r}: missing required method "render"`}),t.renderingMode&&"2d"!==t.renderingMode&&"3d"!==t.renderingMode&&e.push({message:`layers.${r}: property "renderingMode" must be either "2d" or "3d"`}),e},t.validateFog=Li,t.validateLight=Fi,t.validateStyle=Vi,t.values=Q,t.vectorTile=Bu,t.version=e,t.warnOnce=pt,t.window=a,t.wrap=J;}));

define(["./shared"],(function(e){"use strict";function t(e){const r=typeof e;if("number"===r||"boolean"===r||"string"===r||null==e)return JSON.stringify(e);if(Array.isArray(e)){let r="[";for(const o of e)r+=`${t(o)},`;return `${r}]`}const o=Object.keys(e).sort();let n="{";for(let r=0;r<o.length;r++)n+=`${JSON.stringify(o[r])}:${t(e[o[r]])},`;return `${n}}`}function r(r){let o="";for(const n of e.refProperties)o+=`/${t(r[n])}`;return o}class o{constructor(e){this.keyCache={},e&&this.replace(e);}replace(e){this._layerConfigs={},this._layers={},this.update(e,[]);}update(t,o){for(const r of t)this._layerConfigs[r.id]=r,(this._layers[r.id]=e.createStyleLayer(r)).compileFilter(),this.keyCache[r.id]&&delete this.keyCache[r.id];for(const e of o)delete this.keyCache[e],delete this._layerConfigs[e],delete this._layers[e];this.familiesBySource={};const n=function(e,t){const o={};for(let n=0;n<e.length;n++){const i=t&&t[e[n].id]||r(e[n]);t&&(t[e[n].id]=i);let s=o[i];s||(s=o[i]=[]),s.push(e[n]);}const n=[];for(const e in o)n.push(o[e]);return n}(e.values(this._layerConfigs),this.keyCache);for(const e of n){const t=e.map((e=>this._layers[e.id])),r=t[0];if("none"===r.visibility)continue;const o=r.source||"";let n=this.familiesBySource[o];n||(n=this.familiesBySource[o]={});const i=r.sourceLayer||"_geojsonTileLayer";let s=n[i];s||(s=n[i]=[]),s.push(t);}}}const{ImageBitmap:n}=e.window;class i{loadTile(t,r){const{uid:o,encoding:i,rawImageData:s,padding:a,buildQuadTree:l}=t,u=n&&s instanceof n?this.getImageData(s,a):s;r(null,new e.DEMData(o,u,i,a<1,l));}getImageData(t,r){this.offscreenCanvas&&this.offscreenCanvasContext||(this.offscreenCanvas=new OffscreenCanvas(t.width,t.height),this.offscreenCanvasContext=this.offscreenCanvas.getContext("2d")),this.offscreenCanvas.width=t.width,this.offscreenCanvas.height=t.height,this.offscreenCanvasContext.drawImage(t,0,0,t.width,t.height);const o=this.offscreenCanvasContext.getImageData(-r,-r,t.width+2*r,t.height+2*r);return this.offscreenCanvasContext.clearRect(0,0,this.offscreenCanvas.width,this.offscreenCanvas.height),new e.RGBAImage({width:o.width,height:o.height},o.data)}}var s=function e(t,r){var o,n=t&&t.type;if("FeatureCollection"===n)for(o=0;o<t.features.length;o++)e(t.features[o],r);else if("GeometryCollection"===n)for(o=0;o<t.geometries.length;o++)e(t.geometries[o],r);else if("Feature"===n)e(t.geometry,r);else if("Polygon"===n)a(t.coordinates,r);else if("MultiPolygon"===n)for(o=0;o<t.coordinates.length;o++)a(t.coordinates[o],r);return t};function a(e,t){if(0!==e.length){l(e[0],t);for(var r=1;r<e.length;r++)l(e[r],!t);}}function l(e,t){for(var r=0,o=0,n=0,i=e.length,s=i-1;n<i;s=n++){var a=(e[n][0]-e[s][0])*(e[s][1]+e[n][1]),l=r+a;o+=Math.abs(r)>=Math.abs(a)?r-l+a:a-l+r,r=l;}r+o>=0!=!!t&&e.reverse();}const u=e.vectorTile.VectorTileFeature.prototype.toGeoJSON;class h{constructor(t){this._feature=t,this.extent=e.EXTENT,this.type=t.type,this.properties=t.tags,"id"in t&&!isNaN(t.id)&&(this.id=parseInt(t.id,10));}loadGeometry(){if(1===this._feature.type){const t=[];for(const r of this._feature.geometry)t.push([new e.pointGeometry(r[0],r[1])]);return t}{const t=[];for(const r of this._feature.geometry){const o=[];for(const t of r)o.push(new e.pointGeometry(t[0],t[1]));t.push(o);}return t}}toGeoJSON(e,t,r){return u.call(this,e,t,r)}}class c{constructor(t){this.layers={_geojsonTileLayer:this},this.name="_geojsonTileLayer",this.extent=e.EXTENT,this.length=t.length,this._features=t;}feature(e){return new h(this._features[e])}}var f=e.vectorTile.VectorTileFeature,p=g;function g(e,t){this.options=t||{},this.features=e,this.length=e.length;}function d(e,t){this.id="number"==typeof e.id?e.id:void 0,this.type=e.type,this.rawGeometry=1===e.type?[e.geometry]:e.geometry,this.properties=e.tags,this.extent=t||4096;}g.prototype.feature=function(e){return new d(this.features[e],this.options.extent)},d.prototype.loadGeometry=function(){var t=this.rawGeometry;this.geometry=[];for(var r=0;r<t.length;r++){for(var o=t[r],n=[],i=0;i<o.length;i++)n.push(new e.pointGeometry(o[i][0],o[i][1]));this.geometry.push(n);}return this.geometry},d.prototype.bbox=function(){this.geometry||this.loadGeometry();for(var e=this.geometry,t=1/0,r=-1/0,o=1/0,n=-1/0,i=0;i<e.length;i++)for(var s=e[i],a=0;a<s.length;a++){var l=s[a];t=Math.min(t,l.x),r=Math.max(r,l.x),o=Math.min(o,l.y),n=Math.max(n,l.y);}return [t,o,r,n]},d.prototype.toGeoJSON=f.prototype.toGeoJSON;var m=v,y=p;function v(t){var r=new e.pbf;return function(e,t){for(var r in e.layers)t.writeMessage(3,x,e.layers[r]);}(t,r),r.finish()}function x(e,t){var r;t.writeVarintField(15,e.version||1),t.writeStringField(1,e.name||""),t.writeVarintField(5,e.extent||4096);var o={keys:[],values:[],keycache:{},valuecache:{}};for(r=0;r<e.length;r++)o.feature=e.feature(r),t.writeMessage(2,w,o);var n=o.keys;for(r=0;r<n.length;r++)t.writeStringField(3,n[r]);var i=o.values;for(r=0;r<i.length;r++)t.writeMessage(4,T,i[r]);}function w(e,t){var r=e.feature;void 0!==r.id&&t.writeVarintField(1,r.id),t.writeMessage(2,S,e),t.writeVarintField(3,r.type),t.writeMessage(4,b,r);}function S(e,t){var r=e.feature,o=e.keys,n=e.values,i=e.keycache,s=e.valuecache;for(var a in r.properties){var l=r.properties[a],u=i[a];if(null!==l){void 0===u&&(o.push(a),i[a]=u=o.length-1),t.writeVarint(u);var h=typeof l;"string"!==h&&"boolean"!==h&&"number"!==h&&(l=JSON.stringify(l));var c=h+":"+l,f=s[c];void 0===f&&(n.push(l),s[c]=f=n.length-1),t.writeVarint(f);}}}function M(e,t){return (t<<3)+(7&e)}function P(e){return e<<1^e>>31}function b(e,t){for(var r=e.loadGeometry(),o=e.type,n=0,i=0,s=r.length,a=0;a<s;a++){var l=r[a],u=1;1===o&&(u=l.length),t.writeVarint(M(1,u));for(var h=3===o?l.length-1:l.length,c=0;c<h;c++){1===c&&1!==o&&t.writeVarint(M(2,h-1));var f=l[c].x-n,p=l[c].y-i;t.writeVarint(P(f)),t.writeVarint(P(p)),n+=f,i+=p;}3===o&&t.writeVarint(M(7,1));}}function T(e,t){var r=typeof e;"string"===r?t.writeStringField(1,e):"boolean"===r?t.writeBooleanField(7,e):"number"===r&&(e%1!=0?t.writeDoubleField(3,e):e<0?t.writeSVarintField(6,e):t.writeVarintField(5,e));}function k(e,t,r,o,n,i){if(n-o<=r)return;const s=o+n>>1;I(e,t,s,o,n,i%2),k(e,t,r,o,s-1,i+1),k(e,t,r,s+1,n,i+1);}function I(e,t,r,o,n,i){for(;n>o;){if(n-o>600){const s=n-o+1,a=r-o+1,l=Math.log(s),u=.5*Math.exp(2*l/3),h=.5*Math.sqrt(l*u*(s-u)/s)*(a-s/2<0?-1:1);I(e,t,r,Math.max(o,Math.floor(r-a*u/s+h)),Math.min(n,Math.floor(r+(s-a)*u/s+h)),i);}const s=t[2*r+i];let a=o,l=n;for(_(e,t,o,r),t[2*n+i]>s&&_(e,t,o,n);a<l;){for(_(e,t,a,l),a++,l--;t[2*a+i]<s;)a++;for(;t[2*l+i]>s;)l--;}t[2*o+i]===s?_(e,t,o,l):(l++,_(e,t,l,n)),l<=r&&(o=l+1),r<=l&&(n=l-1);}}function _(e,t,r,o){L(e,r,o),L(t,2*r,2*o),L(t,2*r+1,2*o+1);}function L(e,t,r){const o=e[t];e[t]=e[r],e[r]=o;}function C(e,t,r,o){const n=e-r,i=t-o;return n*n+i*i}m.fromVectorTileJs=v,m.fromGeojsonVt=function(e,t){t=t||{};var r={};for(var o in e)r[o]=new p(e[o].features,t),r[o].name=o,r[o].version=t.version,r[o].extent=t.extent;return v({layers:r})},m.GeoJSONWrapper=y;const O=e=>e[0],z=e=>e[1];class E{constructor(e,t=O,r=z,o=64,n=Float64Array){this.nodeSize=o,this.points=e;const i=e.length<65536?Uint16Array:Uint32Array,s=this.ids=new i(e.length),a=this.coords=new n(2*e.length);for(let o=0;o<e.length;o++)s[o]=o,a[2*o]=t(e[o]),a[2*o+1]=r(e[o]);k(s,a,o,0,s.length-1,0);}range(e,t,r,o){return function(e,t,r,o,n,i,s){const a=[0,e.length-1,0],l=[];let u,h;for(;a.length;){const c=a.pop(),f=a.pop(),p=a.pop();if(f-p<=s){for(let s=p;s<=f;s++)u=t[2*s],h=t[2*s+1],u>=r&&u<=n&&h>=o&&h<=i&&l.push(e[s]);continue}const g=Math.floor((p+f)/2);u=t[2*g],h=t[2*g+1],u>=r&&u<=n&&h>=o&&h<=i&&l.push(e[g]);const d=(c+1)%2;(0===c?r<=u:o<=h)&&(a.push(p),a.push(g-1),a.push(d)),(0===c?n>=u:i>=h)&&(a.push(g+1),a.push(f),a.push(d));}return l}(this.ids,this.coords,e,t,r,o,this.nodeSize)}within(e,t,r){return function(e,t,r,o,n,i){const s=[0,e.length-1,0],a=[],l=n*n;for(;s.length;){const u=s.pop(),h=s.pop(),c=s.pop();if(h-c<=i){for(let n=c;n<=h;n++)C(t[2*n],t[2*n+1],r,o)<=l&&a.push(e[n]);continue}const f=Math.floor((c+h)/2),p=t[2*f],g=t[2*f+1];C(p,g,r,o)<=l&&a.push(e[f]);const d=(u+1)%2;(0===u?r-n<=p:o-n<=g)&&(s.push(c),s.push(f-1),s.push(d)),(0===u?r+n>=p:o+n>=g)&&(s.push(f+1),s.push(h),s.push(d));}return a}(this.ids,this.coords,e,t,r,this.nodeSize)}}const F={minZoom:0,maxZoom:16,minPoints:2,radius:40,extent:512,nodeSize:64,log:!1,generateId:!1,reduce:null,map:e=>e},N=Math.fround||(j=new Float32Array(1),e=>(j[0]=+e,j[0]));var j;class Z{constructor(e){this.options=D(Object.create(F),e),this.trees=new Array(this.options.maxZoom+1);}load(e){const{log:t,minZoom:r,maxZoom:o,nodeSize:n}=this.options;t&&console.time("total time");const i=`prepare ${e.length} points`;t&&console.time(i),this.points=e;let s=[];for(let t=0;t<e.length;t++)e[t].geometry&&s.push(J(e[t],t));this.trees[o+1]=new E(s,$,B,n,Float32Array),t&&console.timeEnd(i);for(let e=o;e>=r;e--){const r=+Date.now();s=this._cluster(s,e),this.trees[e]=new E(s,$,B,n,Float32Array),t&&console.log("z%d: %d clusters in %dms",e,s.length,+Date.now()-r);}return t&&console.timeEnd("total time"),this}getClusters(e,t){let r=((e[0]+180)%360+360)%360-180;const o=Math.max(-90,Math.min(90,e[1]));let n=180===e[2]?180:((e[2]+180)%360+360)%360-180;const i=Math.max(-90,Math.min(90,e[3]));if(e[2]-e[0]>=360)r=-180,n=180;else if(r>n){const e=this.getClusters([r,o,180,i],t),s=this.getClusters([-180,o,n,i],t);return e.concat(s)}const s=this.trees[this._limitZoom(t)],a=s.range(X(r),V(i),X(n),V(o)),l=[];for(const e of a){const t=s.points[e];l.push(t.numPoints?W(t):this.points[t.index]);}return l}getChildren(e){const t=this._getOriginId(e),r=this._getOriginZoom(e),o="No cluster with the specified id.",n=this.trees[r];if(!n)throw new Error(o);const i=n.points[t];if(!i)throw new Error(o);const s=this.options.radius/(this.options.extent*Math.pow(2,r-1)),a=n.within(i.x,i.y,s),l=[];for(const t of a){const r=n.points[t];r.parentId===e&&l.push(r.numPoints?W(r):this.points[r.index]);}if(0===l.length)throw new Error(o);return l}getLeaves(e,t,r){const o=[];return this._appendLeaves(o,e,t=t||10,r=r||0,0),o}getTile(e,t,r){const o=this.trees[this._limitZoom(e)],n=Math.pow(2,e),{extent:i,radius:s}=this.options,a=s/i,l=(r-a)/n,u=(r+1+a)/n,h={features:[]};return this._addTileFeatures(o.range((t-a)/n,l,(t+1+a)/n,u),o.points,t,r,n,h),0===t&&this._addTileFeatures(o.range(1-a/n,l,1,u),o.points,n,r,n,h),t===n-1&&this._addTileFeatures(o.range(0,l,a/n,u),o.points,-1,r,n,h),h.features.length?h:null}getClusterExpansionZoom(e){let t=this._getOriginZoom(e)-1;for(;t<=this.options.maxZoom;){const r=this.getChildren(e);if(t++,1!==r.length)break;e=r[0].properties.cluster_id;}return t}_appendLeaves(e,t,r,o,n){const i=this.getChildren(t);for(const t of i){const i=t.properties;if(i&&i.cluster?n+i.point_count<=o?n+=i.point_count:n=this._appendLeaves(e,i.cluster_id,r,o,n):n<o?n++:e.push(t),e.length===r)break}return n}_addTileFeatures(e,t,r,o,n,i){for(const s of e){const e=t[s],a=e.numPoints;let l,u,h;if(a)l=Y(e),u=e.x,h=e.y;else {const t=this.points[e.index];l=t.properties,u=X(t.geometry.coordinates[0]),h=V(t.geometry.coordinates[1]);}const c={type:1,geometry:[[Math.round(this.options.extent*(u*n-r)),Math.round(this.options.extent*(h*n-o))]],tags:l};let f;a?f=e.id:this.options.generateId?f=e.index:this.points[e.index].id&&(f=this.points[e.index].id),void 0!==f&&(c.id=f),i.features.push(c);}}_limitZoom(e){return Math.max(this.options.minZoom,Math.min(+e,this.options.maxZoom+1))}_cluster(e,t){const r=[],{radius:o,extent:n,reduce:i,minPoints:s}=this.options,a=o/(n*Math.pow(2,t));for(let o=0;o<e.length;o++){const n=e[o];if(n.zoom<=t)continue;n.zoom=t;const l=this.trees[t+1],u=l.within(n.x,n.y,a),h=n.numPoints||1;let c=h;for(const e of u){const r=l.points[e];r.zoom>t&&(c+=r.numPoints||1);}if(c>h&&c>=s){let e=n.x*h,s=n.y*h,a=i&&h>1?this._map(n,!0):null;const f=(o<<5)+(t+1)+this.points.length;for(const r of u){const o=l.points[r];if(o.zoom<=t)continue;o.zoom=t;const u=o.numPoints||1;e+=o.x*u,s+=o.y*u,o.parentId=f,i&&(a||(a=this._map(n,!0)),i(a,this._map(o)));}n.parentId=f,r.push(G(e/c,s/c,f,c,a));}else if(r.push(n),c>1)for(const e of u){const o=l.points[e];o.zoom<=t||(o.zoom=t,r.push(o));}}return r}_getOriginId(e){return e-this.points.length>>5}_getOriginZoom(e){return (e-this.points.length)%32}_map(e,t){if(e.numPoints)return t?D({},e.properties):e.properties;const r=this.points[e.index].properties,o=this.options.map(r);return t&&o===r?D({},o):o}}function G(e,t,r,o,n){return {x:N(e),y:N(t),zoom:1/0,id:r,parentId:-1,numPoints:o,properties:n}}function J(e,t){const[r,o]=e.geometry.coordinates;return {x:N(X(r)),y:N(V(o)),zoom:1/0,index:t,parentId:-1}}function W(e){return {type:"Feature",id:e.id,properties:Y(e),geometry:{type:"Point",coordinates:[(t=e.x,360*(t-.5)),A(e.y)]}};var t;}function Y(e){const t=e.numPoints,r=t>=1e4?`${Math.round(t/1e3)}k`:t>=1e3?Math.round(t/100)/10+"k":t;return D(D({},e.properties),{cluster:!0,cluster_id:e.id,point_count:t,point_count_abbreviated:r})}function X(e){return e/360+.5}function V(e){const t=Math.sin(e*Math.PI/180),r=.5-.25*Math.log((1+t)/(1-t))/Math.PI;return r<0?0:r>1?1:r}function A(e){const t=(180-360*e)*Math.PI/180;return 360*Math.atan(Math.exp(t))/Math.PI-90}function D(e,t){for(const r in t)e[r]=t[r];return e}function $(e){return e.x}function B(e){return e.y}function R(e,t,r,o){for(var n,i=o,s=r-t>>1,a=r-t,l=e[t],u=e[t+1],h=e[r],c=e[r+1],f=t+3;f<r;f+=3){var p=q(e[f],e[f+1],l,u,h,c);if(p>i)n=f,i=p;else if(p===i){var g=Math.abs(f-s);g<a&&(n=f,a=g);}}i>o&&(n-t>3&&R(e,t,n,o),e[n+2]=i,r-n>3&&R(e,n,r,o));}function q(e,t,r,o,n,i){var s=n-r,a=i-o;if(0!==s||0!==a){var l=((e-r)*s+(t-o)*a)/(s*s+a*a);l>1?(r=n,o=i):l>0&&(r+=s*l,o+=a*l);}return (s=e-r)*s+(a=t-o)*a}function U(e,t,r,o){var n={id:void 0===e?null:e,type:t,geometry:r,tags:o,minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0};return function(e){var t=e.geometry,r=e.type;if("Point"===r||"MultiPoint"===r||"LineString"===r)Q(e,t);else if("Polygon"===r||"MultiLineString"===r)for(var o=0;o<t.length;o++)Q(e,t[o]);else if("MultiPolygon"===r)for(o=0;o<t.length;o++)for(var n=0;n<t[o].length;n++)Q(e,t[o][n]);}(n),n}function Q(e,t){for(var r=0;r<t.length;r+=3)e.minX=Math.min(e.minX,t[r]),e.minY=Math.min(e.minY,t[r+1]),e.maxX=Math.max(e.maxX,t[r]),e.maxY=Math.max(e.maxY,t[r+1]);}function H(e,t,r,o){if(t.geometry){var n=t.geometry.coordinates,i=t.geometry.type,s=Math.pow(r.tolerance/((1<<r.maxZoom)*r.extent),2),a=[],l=t.id;if(r.promoteId?l=t.properties[r.promoteId]:r.generateId&&(l=o||0),"Point"===i)K(n,a);else if("MultiPoint"===i)for(var u=0;u<n.length;u++)K(n[u],a);else if("LineString"===i)ee(n,a,s,!1);else if("MultiLineString"===i){if(r.lineMetrics){for(u=0;u<n.length;u++)ee(n[u],a=[],s,!1),e.push(U(l,"LineString",a,t.properties));return}te(n,a,s,!1);}else if("Polygon"===i)te(n,a,s,!0);else {if("MultiPolygon"!==i){if("GeometryCollection"===i){for(u=0;u<t.geometry.geometries.length;u++)H(e,{id:l,geometry:t.geometry.geometries[u],properties:t.properties},r,o);return}throw new Error("Input data is not a valid GeoJSON object.")}for(u=0;u<n.length;u++){var h=[];te(n[u],h,s,!0),a.push(h);}}e.push(U(l,i,a,t.properties));}}function K(e,t){t.push(re(e[0])),t.push(oe(e[1])),t.push(0);}function ee(e,t,r,o){for(var n,i,s=0,a=0;a<e.length;a++){var l=re(e[a][0]),u=oe(e[a][1]);t.push(l),t.push(u),t.push(0),a>0&&(s+=o?(n*u-l*i)/2:Math.sqrt(Math.pow(l-n,2)+Math.pow(u-i,2))),n=l,i=u;}var h=t.length-3;t[2]=1,R(t,0,h,r),t[h+2]=1,t.size=Math.abs(s),t.start=0,t.end=t.size;}function te(e,t,r,o){for(var n=0;n<e.length;n++){var i=[];ee(e[n],i,r,o),t.push(i);}}function re(e){return e/360+.5}function oe(e){var t=Math.sin(e*Math.PI/180),r=.5-.25*Math.log((1+t)/(1-t))/Math.PI;return r<0?0:r>1?1:r}function ne(e,t,r,o,n,i,s,a){if(o/=t,i>=(r/=t)&&s<o)return e;if(s<r||i>=o)return null;for(var l=[],u=0;u<e.length;u++){var h=e[u],c=h.geometry,f=h.type,p=0===n?h.minX:h.minY,g=0===n?h.maxX:h.maxY;if(p>=r&&g<o)l.push(h);else if(!(g<r||p>=o)){var d=[];if("Point"===f||"MultiPoint"===f)ie(c,d,r,o,n);else if("LineString"===f)se(c,d,r,o,n,!1,a.lineMetrics);else if("MultiLineString"===f)le(c,d,r,o,n,!1);else if("Polygon"===f)le(c,d,r,o,n,!0);else if("MultiPolygon"===f)for(var m=0;m<c.length;m++){var y=[];le(c[m],y,r,o,n,!0),y.length&&d.push(y);}if(d.length){if(a.lineMetrics&&"LineString"===f){for(m=0;m<d.length;m++)l.push(U(h.id,f,d[m],h.tags));continue}"LineString"!==f&&"MultiLineString"!==f||(1===d.length?(f="LineString",d=d[0]):f="MultiLineString"),"Point"!==f&&"MultiPoint"!==f||(f=3===d.length?"Point":"MultiPoint"),l.push(U(h.id,f,d,h.tags));}}}return l.length?l:null}function ie(e,t,r,o,n){for(var i=0;i<e.length;i+=3){var s=e[i+n];s>=r&&s<=o&&(t.push(e[i]),t.push(e[i+1]),t.push(e[i+2]));}}function se(e,t,r,o,n,i,s){for(var a,l,u=ae(e),h=0===n?he:ce,c=e.start,f=0;f<e.length-3;f+=3){var p=e[f],g=e[f+1],d=e[f+2],m=e[f+3],y=e[f+4],v=0===n?p:g,x=0===n?m:y,w=!1;s&&(a=Math.sqrt(Math.pow(p-m,2)+Math.pow(g-y,2))),v<r?x>r&&(l=h(u,p,g,m,y,r),s&&(u.start=c+a*l)):v>o?x<o&&(l=h(u,p,g,m,y,o),s&&(u.start=c+a*l)):ue(u,p,g,d),x<r&&v>=r&&(l=h(u,p,g,m,y,r),w=!0),x>o&&v<=o&&(l=h(u,p,g,m,y,o),w=!0),!i&&w&&(s&&(u.end=c+a*l),t.push(u),u=ae(e)),s&&(c+=a);}var S=e.length-3;p=e[S],g=e[S+1],d=e[S+2],(v=0===n?p:g)>=r&&v<=o&&ue(u,p,g,d),S=u.length-3,i&&S>=3&&(u[S]!==u[0]||u[S+1]!==u[1])&&ue(u,u[0],u[1],u[2]),u.length&&t.push(u);}function ae(e){var t=[];return t.size=e.size,t.start=e.start,t.end=e.end,t}function le(e,t,r,o,n,i){for(var s=0;s<e.length;s++)se(e[s],t,r,o,n,i,!1);}function ue(e,t,r,o){e.push(t),e.push(r),e.push(o);}function he(e,t,r,o,n,i){var s=(i-t)/(o-t);return e.push(i),e.push(r+(n-r)*s),e.push(1),s}function ce(e,t,r,o,n,i){var s=(i-r)/(n-r);return e.push(t+(o-t)*s),e.push(i),e.push(1),s}function fe(e,t){for(var r=[],o=0;o<e.length;o++){var n,i=e[o],s=i.type;if("Point"===s||"MultiPoint"===s||"LineString"===s)n=pe(i.geometry,t);else if("MultiLineString"===s||"Polygon"===s){n=[];for(var a=0;a<i.geometry.length;a++)n.push(pe(i.geometry[a],t));}else if("MultiPolygon"===s)for(n=[],a=0;a<i.geometry.length;a++){for(var l=[],u=0;u<i.geometry[a].length;u++)l.push(pe(i.geometry[a][u],t));n.push(l);}r.push(U(i.id,s,n,i.tags));}return r}function pe(e,t){var r=[];r.size=e.size,void 0!==e.start&&(r.start=e.start,r.end=e.end);for(var o=0;o<e.length;o+=3)r.push(e[o]+t,e[o+1],e[o+2]);return r}function ge(e,t){if(e.transformed)return e;var r,o,n,i=1<<e.z,s=e.x,a=e.y;for(r=0;r<e.features.length;r++){var l=e.features[r],u=l.geometry,h=l.type;if(l.geometry=[],1===h)for(o=0;o<u.length;o+=2)l.geometry.push(de(u[o],u[o+1],t,i,s,a));else for(o=0;o<u.length;o++){var c=[];for(n=0;n<u[o].length;n+=2)c.push(de(u[o][n],u[o][n+1],t,i,s,a));l.geometry.push(c);}}return e.transformed=!0,e}function de(e,t,r,o,n,i){return [Math.round(r*(e*o-n)),Math.round(r*(t*o-i))]}function me(e,t,r,o,n){for(var i=t===n.maxZoom?0:n.tolerance/((1<<t)*n.extent),s={features:[],numPoints:0,numSimplified:0,numFeatures:0,source:null,x:r,y:o,z:t,transformed:!1,minX:2,minY:1,maxX:-1,maxY:0},a=0;a<e.length;a++){s.numFeatures++,ye(s,e[a],i,n);var l=e[a].minX,u=e[a].minY,h=e[a].maxX,c=e[a].maxY;l<s.minX&&(s.minX=l),u<s.minY&&(s.minY=u),h>s.maxX&&(s.maxX=h),c>s.maxY&&(s.maxY=c);}return s}function ye(e,t,r,o){var n=t.geometry,i=t.type,s=[];if("Point"===i||"MultiPoint"===i)for(var a=0;a<n.length;a+=3)s.push(n[a]),s.push(n[a+1]),e.numPoints++,e.numSimplified++;else if("LineString"===i)ve(s,n,e,r,!1,!1);else if("MultiLineString"===i||"Polygon"===i)for(a=0;a<n.length;a++)ve(s,n[a],e,r,"Polygon"===i,0===a);else if("MultiPolygon"===i)for(var l=0;l<n.length;l++){var u=n[l];for(a=0;a<u.length;a++)ve(s,u[a],e,r,!0,0===a);}if(s.length){var h=t.tags||null;if("LineString"===i&&o.lineMetrics){for(var c in h={},t.tags)h[c]=t.tags[c];h.mapbox_clip_start=n.start/n.size,h.mapbox_clip_end=n.end/n.size;}var f={geometry:s,type:"Polygon"===i||"MultiPolygon"===i?3:"LineString"===i||"MultiLineString"===i?2:1,tags:h};null!==t.id&&(f.id=t.id),e.features.push(f);}}function ve(e,t,r,o,n,i){var s=o*o;if(o>0&&t.size<(n?s:o))r.numPoints+=t.length/3;else {for(var a=[],l=0;l<t.length;l+=3)(0===o||t[l+2]>s)&&(r.numSimplified++,a.push(t[l]),a.push(t[l+1])),r.numPoints++;n&&function(e,t){for(var r=0,o=0,n=e.length,i=n-2;o<n;i=o,o+=2)r+=(e[o]-e[i])*(e[o+1]+e[i+1]);if(r>0===t)for(o=0,n=e.length;o<n/2;o+=2){var s=e[o],a=e[o+1];e[o]=e[n-2-o],e[o+1]=e[n-1-o],e[n-2-o]=s,e[n-1-o]=a;}}(a,i),e.push(a);}}function xe(e,t){var r=(t=this.options=function(e,t){for(var r in t)e[r]=t[r];return e}(Object.create(this.options),t)).debug;if(r&&console.time("preprocess data"),t.maxZoom<0||t.maxZoom>24)throw new Error("maxZoom should be in the 0-24 range");if(t.promoteId&&t.generateId)throw new Error("promoteId and generateId cannot be used together.");var o=function(e,t){var r=[];if("FeatureCollection"===e.type)for(var o=0;o<e.features.length;o++)H(r,e.features[o],t,o);else H(r,"Feature"===e.type?e:{geometry:e},t);return r}(e,t);this.tiles={},this.tileCoords=[],r&&(console.timeEnd("preprocess data"),console.log("index: maxZoom: %d, maxPoints: %d",t.indexMaxZoom,t.indexMaxPoints),console.time("generate tiles"),this.stats={},this.total=0),(o=function(e,t){var r=t.buffer/t.extent,o=e,n=ne(e,1,-1-r,r,0,-1,2,t),i=ne(e,1,1-r,2+r,0,-1,2,t);return (n||i)&&(o=ne(e,1,-r,1+r,0,-1,2,t)||[],n&&(o=fe(n,1).concat(o)),i&&(o=o.concat(fe(i,-1)))),o}(o,t)).length&&this.splitTile(o,0,0,0),r&&(o.length&&console.log("features: %d, points: %d",this.tiles[0].numFeatures,this.tiles[0].numPoints),console.timeEnd("generate tiles"),console.log("tiles generated:",this.total,JSON.stringify(this.stats)));}function we(e,t,r){return 32*((1<<e)*r+t)+e}function Se(e,t){const r=e.tileID.canonical;if(!this._geoJSONIndex)return t(null,null);const o=this._geoJSONIndex.getTile(r.z,r.x,r.y);if(!o)return t(null,null);const n=new c(o.features);let i=m(n);0===i.byteOffset&&i.byteLength===i.buffer.byteLength||(i=new Uint8Array(i)),t(null,{vectorTile:n,rawData:i.buffer});}xe.prototype.options={maxZoom:14,indexMaxZoom:5,indexMaxPoints:1e5,tolerance:3,extent:4096,buffer:64,lineMetrics:!1,promoteId:null,generateId:!1,debug:0},xe.prototype.splitTile=function(e,t,r,o,n,i,s){for(var a=[e,t,r,o],l=this.options,u=l.debug;a.length;){o=a.pop(),r=a.pop(),t=a.pop(),e=a.pop();var h=1<<t,c=we(t,r,o),f=this.tiles[c];if(!f&&(u>1&&console.time("creation"),f=this.tiles[c]=me(e,t,r,o,l),this.tileCoords.push({z:t,x:r,y:o}),u)){u>1&&(console.log("tile z%d-%d-%d (features: %d, points: %d, simplified: %d)",t,r,o,f.numFeatures,f.numPoints,f.numSimplified),console.timeEnd("creation"));var p="z"+t;this.stats[p]=(this.stats[p]||0)+1,this.total++;}if(f.source=e,n){if(t===l.maxZoom||t===n)continue;var g=1<<n-t;if(r!==Math.floor(i/g)||o!==Math.floor(s/g))continue}else if(t===l.indexMaxZoom||f.numPoints<=l.indexMaxPoints)continue;if(f.source=null,0!==e.length){u>1&&console.time("clipping");var d,m,y,v,x,w,S=.5*l.buffer/l.extent,M=.5-S,P=.5+S,b=1+S;d=m=y=v=null,x=ne(e,h,r-S,r+P,0,f.minX,f.maxX,l),w=ne(e,h,r+M,r+b,0,f.minX,f.maxX,l),e=null,x&&(d=ne(x,h,o-S,o+P,1,f.minY,f.maxY,l),m=ne(x,h,o+M,o+b,1,f.minY,f.maxY,l),x=null),w&&(y=ne(w,h,o-S,o+P,1,f.minY,f.maxY,l),v=ne(w,h,o+M,o+b,1,f.minY,f.maxY,l),w=null),u>1&&console.timeEnd("clipping"),a.push(d||[],t+1,2*r,2*o),a.push(m||[],t+1,2*r,2*o+1),a.push(y||[],t+1,2*r+1,2*o),a.push(v||[],t+1,2*r+1,2*o+1);}}},xe.prototype.getTile=function(e,t,r){var o=this.options,n=o.extent,i=o.debug;if(e<0||e>24)return null;var s=1<<e,a=we(e,t=(t%s+s)%s,r);if(this.tiles[a])return ge(this.tiles[a],n);i>1&&console.log("drilling down to z%d-%d-%d",e,t,r);for(var l,u=e,h=t,c=r;!l&&u>0;)u--,h=Math.floor(h/2),c=Math.floor(c/2),l=this.tiles[we(u,h,c)];return l&&l.source?(i>1&&console.log("found parent tile z%d-%d-%d",u,h,c),i>1&&console.time("drilling down"),this.splitTile(l.source,u,h,c,e,t,r),i>1&&console.timeEnd("drilling down"),this.tiles[a]?ge(this.tiles[a],n):null):null};class Me extends e.VectorTileWorkerSource{constructor(e,t,r,o,n){super(e,t,r,o,Se),n&&(this.loadGeoJSON=n);}loadData(t,r){const o=t&&t.request,n=o&&o.collectResourceTiming;this.loadGeoJSON(t,((i,a)=>{if(i||!a)return r(i);if("object"!=typeof a)return r(new Error(`Input data given to '${t.source}' is not a valid GeoJSON object.`));{s(a,!0);try{if(t.filter){const r=e.createExpression(t.filter,{type:"boolean","property-type":"data-driven",overridable:!1,transition:!1});if("error"===r.result)throw new Error(r.value.map((e=>`${e.key}: ${e.message}`)).join(", "));const o=a.features.filter((e=>r.value.evaluate({zoom:0},e)));a={type:"FeatureCollection",features:o};}this._geoJSONIndex=t.cluster?new Z(function({superclusterOptions:t,clusterProperties:r}){if(!r||!t)return t;const o={},n={},i={accumulated:null,zoom:0},s={properties:null},a=Object.keys(r);for(const t of a){const[i,s]=r[t],a=e.createExpression(s),l=e.createExpression("string"==typeof i?[i,["accumulated"],["get",t]]:i);o[t]=a.value,n[t]=l.value;}return t.map=e=>{s.properties=e;const t={};for(const e of a)t[e]=o[e].evaluate(i,s);return t},t.reduce=(e,t)=>{s.properties=t;for(const t of a)i.accumulated=e[t],e[t]=n[t].evaluate(i,s);},t}(t)).load(a.features):function(e,t){return new xe(e,t)}(a,t.geojsonVtOptions);}catch(i){return r(i)}this.loaded={};const l={};if(n){const r=e.getPerformanceMeasurement(o);r&&(l.resourceTiming={},l.resourceTiming[t.source]=JSON.parse(JSON.stringify(r)));}r(null,l);}}));}reloadTile(e,t){const r=this.loaded;return r&&r[e.uid]?super.reloadTile(e,t):this.loadTile(e,t)}loadGeoJSON(t,r){if(t.request)e.getJSON(t.request,r);else {if("string"!=typeof t.data)return r(new Error(`Input data given to '${t.source}' is not a valid GeoJSON object.`));try{return r(null,JSON.parse(t.data))}catch(e){return r(new Error(`Input data given to '${t.source}' is not a valid GeoJSON object.`))}}}getClusterExpansionZoom(e,t){try{t(null,this._geoJSONIndex.getClusterExpansionZoom(e.clusterId));}catch(e){t(e);}}getClusterChildren(e,t){try{t(null,this._geoJSONIndex.getChildren(e.clusterId));}catch(e){t(e);}}getClusterLeaves(e,t){try{t(null,this._geoJSONIndex.getLeaves(e.clusterId,e.limit,e.offset));}catch(e){t(e);}}}class Pe{constructor(t){this.self=t,this.actor=new e.Actor(t,this),this.layerIndexes={},this.availableImages={},this.isSpriteLoaded={},this.projections={},this.defaultProjection=e.getProjection({name:"mercator"}),this.workerSourceTypes={vector:e.VectorTileWorkerSource,geojson:Me},this.workerSources={},this.demWorkerSources={},this.self.registerWorkerSource=(e,t)=>{if(this.workerSourceTypes[e])throw new Error(`Worker source with name "${e}" already registered.`);this.workerSourceTypes[e]=t;},this.self.registerRTLTextPlugin=t=>{if(e.plugin.isParsed())throw new Error("RTL text plugin already registered.");e.plugin.applyArabicShaping=t.applyArabicShaping,e.plugin.processBidirectionalText=t.processBidirectionalText,e.plugin.processStyledBidirectionalText=t.processStyledBidirectionalText;};}clearCaches(e,t,r){delete this.layerIndexes[e],delete this.availableImages[e],delete this.workerSources[e],delete this.demWorkerSources[e],r();}checkIfReady(e,t,r){r();}setReferrer(e,t){this.referrer=t;}spriteLoaded(t,r){this.isSpriteLoaded[t]=r;for(const o in this.workerSources[t]){const n=this.workerSources[t][o];for(const t in n)n[t]instanceof e.VectorTileWorkerSource&&(n[t].isSpriteLoaded=r,n[t].fire(new e.Event("isSpriteLoaded")));}}setImages(e,t,r){this.availableImages[e]=t;for(const r in this.workerSources[e]){const o=this.workerSources[e][r];for(const e in o)o[e].availableImages=t;}r();}enableTerrain(e,t,r){this.terrain=t,r();}setProjection(t,r){this.projections[t]=e.getProjection(r);}setLayers(e,t,r){this.getLayerIndex(e).replace(t),r();}updateLayers(e,t,r){this.getLayerIndex(e).update(t.layers,t.removedIds),r();}loadTile(t,r,o){const n=this.enableTerrain?e.extend({enableTerrain:this.terrain},r):r;n.projection=this.projections[t]||this.defaultProjection,this.getWorkerSource(t,r.type,r.source).loadTile(n,o);}loadDEMTile(t,r,o){const n=this.enableTerrain?e.extend({buildQuadTree:this.terrain},r):r;this.getDEMWorkerSource(t,r.source).loadTile(n,o);}reloadTile(t,r,o){const n=this.enableTerrain?e.extend({enableTerrain:this.terrain},r):r;n.projection=this.projections[t]||this.defaultProjection,this.getWorkerSource(t,r.type,r.source).reloadTile(n,o);}abortTile(e,t,r){this.getWorkerSource(e,t.type,t.source).abortTile(t,r);}removeTile(e,t,r){this.getWorkerSource(e,t.type,t.source).removeTile(t,r);}removeSource(e,t,r){if(!this.workerSources[e]||!this.workerSources[e][t.type]||!this.workerSources[e][t.type][t.source])return;const o=this.workerSources[e][t.type][t.source];delete this.workerSources[e][t.type][t.source],void 0!==o.removeSource?o.removeSource(t,r):r();}loadWorkerSource(e,t,r){try{this.self.importScripts(t.url),r();}catch(e){r(e.toString());}}syncRTLPluginState(t,r,o){try{e.plugin.setState(r);const t=e.plugin.getPluginURL();if(e.plugin.isLoaded()&&!e.plugin.isParsed()&&null!=t){this.self.importScripts(t);const r=e.plugin.isParsed();o(r?void 0:new Error(`RTL Text Plugin failed to import scripts from ${t}`),r);}}catch(e){o(e.toString());}}getAvailableImages(e){let t=this.availableImages[e];return t||(t=[]),t}getLayerIndex(e){let t=this.layerIndexes[e];return t||(t=this.layerIndexes[e]=new o),t}getWorkerSource(e,t,r){return this.workerSources[e]||(this.workerSources[e]={}),this.workerSources[e][t]||(this.workerSources[e][t]={}),this.workerSources[e][t][r]||(this.workerSources[e][t][r]=new this.workerSourceTypes[t]({send:(t,r,o,n,i,s)=>{this.actor.send(t,r,o,e,i,s);},scheduler:this.actor.scheduler},this.getLayerIndex(e),this.getAvailableImages(e),this.isSpriteLoaded[e])),this.workerSources[e][t][r]}getDEMWorkerSource(e,t){return this.demWorkerSources[e]||(this.demWorkerSources[e]={}),this.demWorkerSources[e][t]||(this.demWorkerSources[e][t]=new i),this.demWorkerSources[e][t]}enforceCacheSizeLimit(t,r){e.enforceCacheSizeLimit(r);}getWorkerPerformanceMetrics(e,t,r){r(void 0,void 0);}}return "undefined"!=typeof WorkerGlobalScope&&"undefined"!=typeof self&&self instanceof WorkerGlobalScope&&(self.worker=new Pe(self)),Pe}));


//

var mapboxgl$1 = mapboxgl;

return mapboxgl$1;

})));


}).call(this)}).call(this,require('_process'))
},{"_process":5}],5:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],6:[function(require,module,exports){
const mapboxgl = require('mapbox-gl');
const h3 = require('h3-js')
const geojson2h3 = require('geojson2h3')

// public token
mapboxgl.accessToken = 'pk.eyJ1IjoibWF0dGhpYXNmZWlzdCIsImEiOiJjbDB0ZWc1dHcwY2J3M2NsemR3bXJrMHVvIn0.GcKiU5EBVtrQjdp29y5wAA';

let h3IndexToHighlight = '';
const h3Input = document.getElementById('zoomToIndex');

let map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/light-v10',
  center: [15, 50],
  zoom: 3,
  maxBounds: [[-170, -85], [170, 85]]
});

map.on('load', () => {
  // hex data
  map.addSource('tiles-geojson', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });

  // text in the middle of each hex
  map.addSource('tiles-centers-geojson', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });

  // lines around
  map.addLayer({
    id: 'tiles',
    source: 'tiles-geojson',
    type: 'line',
    paint: {
      'line-color': '#000'
    }
  });

  map.addLayer({
    id: 'tiles-shade',
    source: 'tiles-geojson',
    type: 'fill',
    paint: {
      'fill-color': [
        'get', 'tile_color'
        // 'case', ['get', 'pentagon'],  // case statement on 'pentagon' property
        // 'rgba(255,0,0,0.5)',  // if pentagon= true color for pentagons (red)
        // 'rgba(0,0,0,0.1)'     // else color for not pentagons
      ]
    }
  });

  map.addLayer({
    id: 'tiles-centers',
    source: 'tiles-centers-geojson',
    type: 'symbol',
    layout: {
      'text-field': ['format', ['get', 'text'], { 'font-scale': 1.2 }],
      'text-offset': [0, -1],
    },
    paint: {
      'text-color': '#000',
      'text-color-transition': {
        duration: 0
      },
      'text-halo-color': ['case', ['get', 'highlight'], '#0f0', '#fff'],
      'text-halo-width': 1,
      'text-halo-blur': 1
    }
  });

  updateTiles();
});

map.on('moveend', updateTiles);
map.on('click', (e) => {
  const h3Index = h3.geoToH3(e.lngLat.lat, e.lngLat.lng, mapZoomToH3Res(map.getZoom()))
  h3Input.value = h3Index
});

h3Input.addEventListener('change', (e) => {
  const input = h3Input.value
  if (!h3.h3IsValid(input)) {
    alert('input is not a valid H3 index')
    return
  }
  h3IndexToHighlight = input
  const res = h3.h3GetResolution(input)
  const [lat, lng] = h3.h3ToGeo(input)

  map.flyTo({
    center: [lng, lat],
    zoom: h3ResToMapZoom(res)
  });
});


function updateTiles() {
  var extentsGeom = getExtentsGeom();
  const mapZoom = map.getZoom()
  let h3res = mapZoomToH3Res(mapZoom)

  const h3indexes = extendH3IndexesByOne(h3.polyfill(extentsGeom, h3res, true))

  console.log('updating tiles');
  // get the color of the hex
  map.getSource('tiles-geojson').setData(
    {
      type: 'FeatureCollection',
      features: h3indexes.map(getTileFeature)
  });

  // get the text for the center
  map.getSource('tiles-centers-geojson').setData({
    type: 'FeatureCollection',
    features: h3indexes.map(getTileCenterFeature)
  });
}

function extendH3IndexesByOne(indexes) {
  const set = new Set()
  indexes.forEach(index => {
    h3.kRing(index, 1).forEach(ringIndex => set.add(ringIndex))
  })
  return Array.from(set)
}

function getExtentsGeom() {
  var e = map.getBounds();
  return [
    e.getSouthWest().toArray(),
    e.getNorthWest().toArray(),
    e.getNorthEast().toArray(),
    e.getSouthEast().toArray(),
    e.getSouthWest().toArray()
  ];
}

var hex_values_object = {};

function getTileFeature(h3index) {
  const feature = geojson2h3.h3ToFeature(
      h3index,
      {
        pentagon: h3.h3IsPentagon(h3index),
        tile_color: 'rgba(0,' + hex_values_object[h3index] + ',0,0.3)'
      }
  );
  fixTransmeridian(feature)
  return feature
}

function getTileCenterFeature(h3index) {
  // add text to center of the hexes
  var center = h3.h3ToGeo(h3index)
  return {
    type: 'Feature',
    properties: {
      text: h3index + '\nResolution: ' + h3.h3GetResolution(h3index),
      highlight: h3index === h3IndexToHighlight
    },
    geometry: {
      type: 'Point',
      coordinates: [center[1], center[0]]
    }
  };
}

function mapZoomToH3Res(zoom) {
  return Math.max(0, Math.floor((zoom - 3) * 0.8))
}
function h3ResToMapZoom(res) {
  return Math.ceil((res + 3) * 1.2)
}

/****************************
 * the follwing functions are copied from
 * https://observablehq.com/@nrabinowitz/mapbox-utils#fixTransmeridian
 ****************************/

function fixTransmeridianCoord(coord) {
  const lng = coord[0];
  coord[0] = lng < 0 ? lng + 360 : lng;
}

function fixTransmeridianLoop(loop) {
  let isTransmeridian = false;
  for (let i = 0; i < loop.length; i++) {
    // check for arcs > 180 degrees longitude, flagging as transmeridian
    if (Math.abs(loop[0][0] - loop[(i + 1) % loop.length][0]) > 180) {
      isTransmeridian = true;
      break;
    }
  }
  if (isTransmeridian) {
    loop.forEach(fixTransmeridianCoord);
  }
}

function fixTransmeridianPolygon(polygon) {
  polygon.forEach(fixTransmeridianLoop);
}

function fixTransmeridian(feature) {
  const { type } = feature;
  if (type === 'FeatureCollection') {
    feature.features.map(fixTransmeridian);
    return;
  }
  const { type: geometryType, coordinates } = feature.geometry;
  switch (geometryType) {
    case 'LineString':
      fixTransmeridianLoop(coordinates);
      return;
    case 'Polygon':
      fixTransmeridianPolygon(coordinates);
      return;
    case 'MultiPolygon':
      coordinates.forEach(fixTransmeridianPolygon);
      return;
    default:
      throw new Error(`Unknown geometry type: ${geometryType}`);
  }
}


// json upload button
document.getElementById('import').onclick = function() {
  var files = document.getElementById('selectFiles').files;
  console.log(files);
  if (files.length <= 0) {
    return false;
  }

  var fr = new FileReader();

  fr.onload = function(e) {
    // console.log(e);
    var result = JSON.parse(e.target.result);
    var formatted = JSON.stringify(result, null, 2);
    document.getElementById('result').value = formatted;
    hex_values_object = result;
    updateTiles();
  }

  fr.readAsText(files.item(0));
};

},{"geojson2h3":2,"h3-js":3,"mapbox-gl":4}]},{},[6]);