// Downloads annual temperature anomalies for every California county from NOAA.
// Output feeds the county coloring in the California map overlay.

const fs = require('fs');
const path = require('path');

const COUNTIES = [
    { name: "Alameda", fips: "001" }, { name: "Alpine", fips: "003" }, { name: "Amador", fips: "005" },
    { name: "Butte", fips: "007" }, { name: "Calaveras", fips: "009" }, { name: "Colusa", fips: "011" },
    { name: "Contra Costa", fips: "013" }, { name: "Del Norte", fips: "015" }, { name: "El Dorado", fips: "017" },
    { name: "Fresno", fips: "019" }, { name: "Glenn", fips: "021" }, { name: "Humboldt", fips: "023" },
    { name: "Imperial", fips: "025" }, { name: "Inyo", fips: "027" }, { name: "Kern", fips: "029" },
    { name: "Kings", fips: "031" }, { name: "Lake", fips: "033" }, { name: "Lassen", fips: "035" },
    { name: "Los Angeles", fips: "037" }, { name: "Madera", fips: "039" }, { name: "Marin", fips: "041" },
    { name: "Mariposa", fips: "043" }, { name: "Mendocino", fips: "045" }, { name: "Merced", fips: "047" },
    { name: "Modoc", fips: "049" }, { name: "Mono", fips: "051" }, { name: "Monterey", fips: "053" },
    { name: "Napa", fips: "055" }, { name: "Nevada", fips: "057" }, { name: "Orange", fips: "059" },
    { name: "Placer", fips: "061" }, { name: "Plumas", fips: "063" }, { name: "Riverside", fips: "065" },
    { name: "Sacramento", fips: "067" }, { name: "San Benito", fips: "069" }, { name: "San Bernardino", fips: "071" },
    { name: "San Diego", fips: "073" }, { name: "San Francisco", fips: "075" }, { name: "San Joaquin", fips: "077" },
    { name: "San Luis Obispo", fips: "079" }, { name: "San Mateo", fips: "081" }, { name: "Santa Barbara", fips: "083" },
    { name: "Santa Clara", fips: "085" }, { name: "Santa Cruz", fips: "087" }, { name: "Shasta", fips: "089" },
    { name: "Sierra", fips: "091" }, { name: "Siskiyou", fips: "093" }, { name: "Solano", fips: "095" },
    { name: "Sonoma", fips: "097" }, { name: "Stanislaus", fips: "099" }, { name: "Sutter", fips: "101" },
    { name: "Tehama", fips: "103" }, { name: "Trinity", fips: "105" }, { name: "Tulare", fips: "107" },
    { name: "Tuolumne", fips: "109" }, { name: "Ventura", fips: "111" }, { name: "Yolo", fips: "113" },
    { name: "Yuba", fips: "115" }
];

let outputRows = ['County,Year,Anomaly'];

async function fetchCountyData() {
    console.log("Starting NOAA County Data Pipeline...");
    
    for (const county of COUNTIES) {
        const url = `https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/county/time-series/CA-${county.fips}/tavg/12/12/1895-2013.csv?base_prd=true&begbaseyear=1901&endbaseyear=2000`;
        
        try {
            const response = await fetch(url);
            const text = await response.text();
            
            const lines = text.split('\n');
            lines.forEach(line => {
                if (line.includes(',') && !line.startsWith('Date') && !line.startsWith('Location')) {
                    const parts = line.split(',');
                    if (parts.length >= 3) {
                        const year = parts[0].substring(0, 4);
                        const anomaly = parseFloat(parts[2]);
                        const anomalyC = anomaly * (5 / 9); // NOAA returns Fahrenheit
                        if (!isNaN(anomalyC)) {
                            outputRows.push(`${county.name},${year},${anomalyC.toFixed(3)}`);
                        }
                    }
                }
            });
            console.log(`Fetched: ${county.name} County`);
            
            await new Promise(r => setTimeout(r, 200)); // Be gentle on the NOAA API
            
        } catch (error) {
            console.error(`Failed to fetch ${county.name}:`, error);
        }
    }

    const outputDir = path.join(__dirname, 'data', 'temperature');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    
    fs.writeFileSync(path.join(outputDir, 'ca_county_temps.csv'), outputRows.join('\n'), 'utf-8');
    console.log("Pipeline Complete! Saved to data/temperature/ca_county_temps.csv");
}

fetchCountyData();