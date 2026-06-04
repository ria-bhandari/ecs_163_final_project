const fs = require('fs');
const path = require('path');

// 1. Comprehensive array mapping all 16 downloaded NOAA California Tide Gauges
const STATIONS = [
    { id: '9410170', name: 'San Diego',         lat: 32.714, lon: -117.173, offset: 7.0 },
    { id: '9410230', name: 'La Jolla',          lat: 32.866, lon: -117.255, offset: 6.9 },
    { id: '9410660', name: 'Los Angeles',       lat: 33.720, lon: -118.260, offset: 6.9 },
    { id: '9410840', name: 'Santa Monica',      lat: 34.008, lon: -118.500, offset: 6.8 },
    { id: '9411340', name: 'Santa Barbara',     lat: 34.408, lon: -119.685, offset: 6.9 }, // Rincon Island / SB channel zone
    { id: '9412110', name: 'Port San Luis',     lat: 35.172, lon: -120.760, offset: 7.0 },
    { id: '9413450', name: 'Monterey',          lat: 36.605, lon: -121.888, offset: 7.0 },
    { id: '9414290', name: 'San Francisco',     lat: 37.807, lon: -122.467, offset: 7.0 },
    { id: '9414523', name: 'Redwood City',      lat: 37.513, lon: -122.212, offset: 7.0 }, // SF South Bay Hub
    { id: '9414750', name: 'Alameda',           lat: 37.772, lon: -122.298, offset: 7.0 }, // SF East Bay Anchor
    { id: '9414863', name: 'Richmond',          lat: 37.930, lon: -122.413, offset: 7.0 },
    { id: '9415020', name: 'Point Reyes',       lat: 37.997, lon: -122.975, offset: 7.0 },
    { id: '9415144', name: 'Port Chicago',      lat: 38.056, lon: -122.026, offset: 7.1 }, // Suisun Bay Delta Gate
    { id: '9416841', name: 'Arena Cove',        lat: 38.915, lon: -123.711, offset: 7.0 }, // Mendocino Coast
    { id: '9418767', name: 'North Spit',        lat: 40.767, lon: -124.217, offset: 7.1 }, // Humboldt Bay Anchor
    { id: '9419750', name: 'Crescent City',     lat: 41.745, lon: -124.183, offset: 7.1 }  // Oregon Border Gateway
];

let outputRows = ['Station,Latitude,Longitude,Date,MeanSeaLevelAnomaly'];

console.log(`Starting Data Extraction Pipeline across ${STATIONS.length} California Regions...`);

STATIONS.forEach(station => {
    const filename = `${station.id}_meantrend.csv`;
    const filePath = path.join(__dirname, filename);

    if (!fs.existsSync(filePath)) {
        console.warn(`Warning: Raw file ${filename} not found in root directory. Skipping.`);
        return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    // Group monthly records by year to calculate continuous annual averages
    const yearlyData = {};

    lines.forEach(line => {
        if (!line || line.startsWith('Year') || line.startsWith('#')) return;

        const columns = line.trim().split(/[\s,]+/);
        if (columns.length < 3) return;

        const year = parseInt(columns[0], 10);
        const value = parseFloat(columns[2]); // Monthly Mean Sea Level coordinate

        // Keep bounds cleanly constrained to your interactive temporal slider
        if (year >= 1784 && year <= 2013 && !isNaN(value)) {
            if (!yearlyData[year]) {
                yearlyData[year] = [];
            }
            yearlyData[year].push(value);
        }
    });

    // Compile groupings into an annual delta timeline
    Object.keys(yearlyData).sort().forEach(yearStr => {
        const year = parseInt(yearStr, 10);
        const values = yearlyData[year];
        
        if (values.length > 0) {
            // THE FIX: The NOAA meantrend files are already baseline-normalized anomalies!
            const anomaly = values.reduce((sum, val) => sum + val, 0) / values.length;

            const formattedDate = `${year}-01-01`;
            outputRows.push(`${station.name},${station.lat},${station.lon},${formattedDate},${anomaly.toFixed(3)}`);
        }
    });

    console.log(`Successfully compiled timeline for: ${station.name}`);
});

// 2. Ensure output folder layout is verified
const outputDir = path.join(__dirname, 'data', 'sea_level');
if (!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir, { recursive: true });
}

const outputPath = path.join(outputDir, 'ca_sea_level_stations.csv');
fs.writeFileSync(outputPath, outputRows.join('\n'), 'utf-8');

console.log(`\nData pipeline complete! All 16 profiles compiled successfully into: ${outputPath}`);