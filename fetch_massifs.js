// Script to fetch massif polygons from refuges.info API
import fs from 'fs';
import https from 'https';

const url = 'https://www.refuges.info/api/polygones?type_polygon=1';

https.get(url, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        const geojson = JSON.parse(data);

        // Save to public folder
        fs.writeFileSync('./public/massifs.json', JSON.stringify(geojson, null, 2));
        console.log('✅ Massif polygons saved to public/massifs.json');
        console.log(`📊 Total massifs: ${geojson.features.length}`);
    });

}).on('error', (err) => {
    console.error('Error:', err.message);
});
