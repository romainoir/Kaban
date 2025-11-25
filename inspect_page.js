import axios from 'axios';
import * as cheerio from 'cheerio';

const url = 'https://www.refuges.info/point/2940/cabane-non-gardee/abri-de-Tardevant/';

async function inspect() {
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        console.log('--- Title ---');
        console.log($('h1').text());

        console.log('--- Searching for Keywords ---');
        const keywords = ['Remarques', 'Informations complémentaires'];
        const bodyHtml = $('body').html();

        keywords.forEach(kw => {
            const index = bodyHtml.indexOf(kw);
            if (index !== -1) {
                console.log(`Found "${kw}" at index ${index}`);
                // Print 100 chars before and 500 after
                console.log(bodyHtml.substring(Math.max(0, index - 100), index + 500).replace(/\s+/g, ' '));
                console.log('-----------------------------------');
            } else {
                console.log(`"${kw}" not found.`);
            }
        });

    } catch (e) {
        console.error(e);
    }
}

inspect();
