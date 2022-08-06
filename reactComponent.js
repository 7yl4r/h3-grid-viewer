import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Layer, Source } from 'react-map-gl';
// TODO: add h3 react import

const H3Bathy = (props) => {
  const {
      UTCPath,
  } = props;

  const [isLoading, setIsLoading] = useState(false);
  const [mapMoved, setMapMoved] = useState(false);
  const [h3Data, setH3Data] = useState([]);  // all the h3 data
  const [h3Layers, setH3Layers] = useState([]);  // subset of h3 data 4 display

  const fetchH3JSON = async () => {
    // fetch the h3 .json file & load it
    const h3DataUrl = 'https://github.com/raw/etc/generated_h3_data.json';
    const dataResponse = await fetch(h3DataUrl);
    const dataJSON = await dataResponse.json();
    return dataJSON;
  };

  const fetchData = async () => {
    const [h3DataRaw] = await Promise.all([
      fetchH3JSON(),
    ]);
    await setH3Data(h3Data);
    setIsLoading(false);
    setMapMoved(true);  // trigger run of the initial map update
  };

  // =======================================================================
  // === H3 hexagon feature generator functions
  // =======================================================================
  const fixTransmeridianCoord = fixTransmeridianCoord(coord) {
    // copied from observablehq.com/@nrabinowitz/mapbox-utils#fixTransmeridian
    const lng = coord[0];
    coord[0] = lng < 0 ? lng + 360 : lng;
  }
  const fixTransmeridianLoop = function(loop) {
    // copied from observablehq.com/@nrabinowitz/mapbox-utils#fixTransmeridian
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
  const fixTransmeridianPolygon = function(polygon) {
    // copied from observablehq.com/@nrabinowitz/mapbox-utils#fixTransmeridian
    polygon.forEach(fixTransmeridianLoop);
  }
  const fixTransmeridian = function(feature) {
    // copied from observablehq.com/@nrabinowitz/mapbox-utils#fixTransmeridian
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
  const mapZoomToH3Res = function(zoom) {
    // converts a mapboxgl zoom level to an H3 resolution level
    return Math.max(0, Math.floor((zoom - 3) * 0.8))
  }
  const extendH3IndexesByOne = function(indexes) {
    // ???
    const set = new Set()
    indexes.forEach(index => {
      h3.kRing(index, 1).forEach(ringIndex => set.add(ringIndex))
    })
    return Array.from(set)
  }
  const getTileFeature = function(h3index) {
    const feature = geojson2h3.h3ToFeature(
        h3index,
        {
          tile_color: 'rgba(0,' + hex_values_object[h3index] + ',0,0.3)'
        }
    );
    fixTransmeridian(feature)
    return feature
  }
  const updateH3Tiles = function(extentsGeom, h3res) {
    // Updates the tile layer given a mapGL extent and h3resolution level.
    // The hexes in the viewport is computed by the h3 lib so that we can
    // mapGL doesn't get overwhelmed with hexagon Features.
    // In theory we could cram all hexes into mapGL when the data is initially
    // loaded, but that offloads all LoD calculations onto mapGL. At time of
    // writing mapGL isn't fancy enough to do that well.
    const h3indexes = extendH3IndexesByOne(  // hexes in the current viewport
        h3.polyfill(extentsGeom, h3res, true)
    )

    // set the color of the hexes in the viewport
    setH3Layers([
      {
        sourceId: 'tiles-geojson',
        data: h3indexes.map(getTileFeature)
      },
    ])
  }
  // =======================================================================
  // =======================================================================

  useEffect(() => {
    if (!isLoading) {
      setIsLoading(true);
      fetchData()
        .then(() => {
          setIsLoading(false);
        })
        .catch(() => {
          setIsLoading(false);
        });
    }
    if (mapMoved) {
        // TODO: Need to find how map moved from mapGL somehow.
        //       `map` will be undefined in this context.
        //       This needs to be implemented as a state variable?
        //       The current implementation assumes `mapMoved` set `true`
        //       by mapgl. I made that assumption up,
        //       so this implementation will need to get that value from the
        //       mapGL react component in a way that is more real.
        const z = map.getZoom()
        const e = map.getBounds();
        updateH3Tiles(
            [
              e.getSouthWest().toArray(),
              e.getNorthWest().toArray(),
              e.getNorthEast().toArray(),
              e.getSouthEast().toArray(),
              e.getSouthWest().toArray()
            ],
            mapZoomToH3Res(z)
        );
        setMapMoved(false);
    }
  }, [UTCPath]);

  const tileShadingStyle = {
    type: 'fill',
    paint: {
        'fill-color': [
          'get', 'tile_color'
        ]
    }
  };
  return (
    <>
      {h3Layers.map((dataLayer, index) => (
        <Source
          id={dataLayer.sourceId}
          type="geojson"
          data={dataLayer.data}
          key={index}
        />
      ))}
      {h3Layers.map((dataLayer, index) => (
        <Layer
          // id={floodLayer.lake}  // maybe we don't need an id?
          source={dataLayer.sourceId}
          {...tileShadingStyle}
          key={index}
        />
      ))}
    </>
  );
};

export default H3Bathy;
