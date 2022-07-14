import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Layer, Source } from 'react-map-gl';
// TODO: add h3 react import

const CoastalFloodUmich = (props) => {
  const {
    // UTCPath,
    // // selectedLake,
  } = props;

  const [isLoading, setIsLoading] = useState(false);

  // TODO: something like this:
  const [extentsGeom, setExtentsGeom] = useState([]);

  // if floodLayers changes, setFloodLayers is called:
  // state variable is floodLayers
  // setFloodLayers is a standard setter that sets the state variable to
  //    whatever is passed to it.
  //const [floodLayers, setFloodLayers] = useState([]);

  const fetchH3JSON = async () => {
    // fetch the h3 .json file & load it
    // TODO: finish this
    const floodUrl = 'https://github.com/raw/etc/generated_h3_data.json';
    const dataResponse = await fetch(floodUrl);
    const dataJSON = await dataResponse.json();
    return dataJSON;
  };

  const fetchData = async () => {
    // this `const [floodDataRawMHG]` syntax creates an
    //     anon function declaration that assigns return value
    //     to the bracketed variable
    const [floodDataRawMHG] = await Promise.all([
      fetchH3JSON(),
    ]);
    await setFloodLayers([
      {
        sourceId: 'primaryLakeSource',
        data: floodDataRawMHG,  //
      },
    ]);
    setIsLoading(false);
  };

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
  }, [UTCPath]);

  const floodStyle = {
    type: 'line',
    // Omit this for now, due to flooding
    // beforeId: 'waterway-label',
    layout: {
      'line-cap': 'round',
    },
    paint: {
      'line-blur': 1,
      'line-color': '#FF0000',
      'line-opacity': 0.75,
      'line-width': 3,
    },
  };
  return (
    <>
      {floodLayers.map((floodLayer, index) => (
        <Source  // TODO: bring the map.addSource into here
          id={floodLayer.sourceId}
          type="geojson"
          data={floodLayer.data}
          key={index}
        />
      ))}
      {floodLayers.map((floodLayer, index) => (
        <Layer  // TODO: bring in map.addLayer stuff
          id={floodLayer.lake}
          source={floodLayer.sourceId}
          {...floodStyle}
          key={index}
        />
      ))}
    </>
  );
};
// // set property default values
// CoastalFloodUmich.defaultProps = {
//   UTCPath: '',
//   selectedLake: '',
// };
// // set types of properties
// CoastalFloodUmich.propTypes = {
//   UTCPath: PropTypes.string,
//   selectedLake: PropTypes.string,
// };

export default CoastalFloodUmich;
