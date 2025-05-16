// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoiZXJpbndlbDA1NSIsImEiOiJjbWFxaTR6MjYwMDg4Mm1wdjNyOXA2aTJiIn0.EhY5ftLOWRRGuEHBIpSeGA';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map', // ID of the div where the map will render
    style: 'mapbox://styles/mapbox/streets-v12', // Map style
    center: [-71.09415, 42.36027], // [longitude, latitude]
    zoom: 12, // Initial zoom level
    minZoom: 5, // Minimum allowed zoom
    maxZoom: 18, // Maximum allowed zoom
});

// The helper function to get the coordinates of the station on the web projected from the coordinates on the map
function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
    const { x, y } = map.project(point); // Project to pixel coordinates
    return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
    return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
    return timeFilter === -1
        ? trips // If no filter is applied (-1), return all trips
        : trips.filter((trip) => {
            // Convert trip start and end times to minutes since midnight
            const startedMinutes = minutesSinceMidnight(trip.started_at);
            const endedMinutes = minutesSinceMidnight(trip.ended_at);

            // Include trips that started or ended within 60 minutes of the selected time
            return (
                Math.abs(startedMinutes - timeFilter) <= 60 ||
                Math.abs(endedMinutes - timeFilter) <= 60
            );
        });
}

function computeStationTraffic(stations, trips) {
    // Compute departures
    const departures = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.start_station_id,
    );

    // Calculate arrivals using d3.rollup
    const arrivals = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.end_station_id
    );
    // Update each station..
    return stations.map((station) => {
        let id = station.short_name;
        station.arrivals = arrivals.get(id) ?? 0;
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
    });
}

map.on('load', async () => {
    //code
    // Boston
    // Define common line style for bike lanes
    const bikeLineStyle = {
        'line-color': '#32D400',
        'line-width': 5,
        'line-opacity': 0.6
    };

    // Boston
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });

    map.addLayer({
        id: 'boston-bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: bikeLineStyle
    });

    // Cambridge
    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
    });

    map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge_route',
        paint: bikeLineStyle
    });


    // use d3 to draw stations on the map
    try {
        const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

        // Await JSON fetch
        const jsonData = await d3.json(jsonurl);
        console.log('Loaded JSON Data:', jsonData); // Log to verify structure

        // let stations = jsonData.data.stations;
        const trips = await d3.csv('https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
            (trip) => {
                trip.started_at = new Date(trip.started_at);
                trip.ended_at = new Date(trip.ended_at);
                return trip;
            },
        )
        const stations = computeStationTraffic(jsonData.data.stations, trips);

        console.log('Stations with traffic data:', stations);

        // step 3.3
        const svg = d3.select('#map').select('svg');
        // Create radius scale for circle sizes
        const radiusScale = d3
            .scaleSqrt()
            .domain([0, d3.max(stations, (d) => d.totalTraffic)])
            .range([0, 25]);

        let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

        // Append circles to the SVG for each station
        const circles = svg.selectAll('circle')
            .data(stations, (d) => d.short_name)
            .enter()
            .append('circle')
            .attr('cx', d => getCoords(d).cx)
            .attr('cy', d => getCoords(d).cy)
            .attr('r', d => radiusScale(d.totalTraffic))  // Use the radius scale here
            .attr('fill', 'steelblue')
            .attr('fill-opacity', 0.6)
            .attr('stroke', 'white')
            .attr('stroke-width', 1)
            .each(function (d) {
                // Add <title> for browser tooltips
                d3.select(this)
                    .append('title')
                    .text(
                        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
                    );
            })
            .attr('pointer-events', 'auto')
            .style('--departure-ratio', (d) =>
                stationFlow(d.departures / d.totalTraffic),
            );;

        // Function to update circle positions when the map moves/zooms
        function updatePositions() {
            circles
                .attr('cx', (d) => getCoords(d).cx) // Set the x-position using projected coordinates
                .attr('cy', (d) => getCoords(d).cy); // Set the y-position using projected coordinates
        }

        // Initial position update when map loads
        updatePositions();

        // Reposition markers on map interactions
        map.on('move', updatePositions); // Update during map movement
        map.on('zoom', updatePositions); // Update during zooming
        map.on('resize', updatePositions); // Update on window resize
        map.on('moveend', updatePositions); // Final adjustment after movement ends

        function updateTimeDisplay() {
            let timeFilter = Number(timeSlider.value); // Get slider value

            if (timeFilter === -1) {
                selectedTime.textContent = ''; // Clear time display
                anyTimeLabel.style.display = 'block'; // Show "(any time)"
            } else {
                selectedTime.textContent = formatTime(timeFilter); // Display formatted time
                anyTimeLabel.style.display = 'none'; // Hide "(any time)"
            }

            // Trigger filtering logic which will be implemented in the next step
            // Call updateScatterPlot to reflect the changes on the map
            updateScatterPlot(timeFilter);
        }

        function updateScatterPlot(timeFilter) {
            // Get only the trips that match the selected time filter
            const filteredTrips = filterTripsbyTime(trips, timeFilter);

            // Recompute station traffic based on the filtered trips
            const filteredStations = computeStationTraffic(stations, filteredTrips);

            timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

            // Update the scatterplot by adjusting the radius of circles
            circles
                .data(filteredStations, (d) => d.short_name)
                .join('circle') // Ensure the data is bound correctly
                .attr('r', (d) => radiusScale(d.totalTraffic))
                .style('--departure-ratio', (d) =>
                    stationFlow(d.departures / d.totalTraffic),
                ); // Update circle sizes
        }

        // part 5 reactive slide
        const timeSlider = document.getElementById('time-slider');
        const selectedTime = document.getElementById('selected-time');
        const anyTimeLabel = document.getElementById('any-time');

        timeSlider.addEventListener('input', updateTimeDisplay);
        updateTimeDisplay();

    } catch (error) {
        console.error('Error loading JSON:', error); // Handle errors
    }


});

