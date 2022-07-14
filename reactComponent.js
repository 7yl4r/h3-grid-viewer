import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
// import geobuf from 'geobuf';
// import Pbf from 'pbf';
import { Layer, Source } from 'react-map-gl';
// import { useMediaQuery } from 'react-responsive';
// import { preferredTemperatureUnit } from '../../../utils';
// import { brandingConfig } from '../../../config';

const s3UrlBase = 'https://seagull-visualization-layers.s3.us-east-2.amazonaws.com';

const CoastalFloodUmich = (props) => {
  const {
    UTCPath,
    // selectedLake,
  } = props;

  // const isMobile = useMediaQuery({ maxWidth: 767 });
  const [isLoading, setIsLoading] = useState(false);
  const [floodLayers, setFloodLayers] = useState([]);

  const fetchFloodUmich = async () => {
    // const floodUrl = `${s3UrlBase}${UTCPath}/floodModel.geojson`;
    const floodUrl = `${s3UrlBase}/flood_test/testFloodMiHuron_15.geojson`;
    const floodResponse = await fetch(floodUrl);
    const floodData = await floodResponse.json();
    return floodData;
  };

  const fetchData = async () => {
    const [floodDataRawMHG] = await Promise.all([
      fetchFloodUmich(),
    ]);
    await setFloodLayers([
      {
        lake: 'primaryLake',
        sourceId: 'primaryLakeSource',
        data: floodDataRawMHG,
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
        <Source
          id={floodLayer.sourceId}
          type="geojson"
          data={floodLayer.data}
          key={index}
        />
      ))}
      {floodLayers.map((floodLayer, index) => (
        <Layer
          id={floodLayer.lake}
          source={floodLayer.sourceId}
          {...floodStyle}
          key={index}
        />
      ))}
    </>
  );
};
CoastalFloodUmich.defaultProps = {
  UTCPath: '',
  selectedLake: '',
};
CoastalFloodUmich.propTypes = {
  UTCPath: PropTypes.string,
  selectedLake: PropTypes.string,
};

export default CoastalFloodUmich;
