import axios from 'axios';
import * as cheerio from 'cheerio';

const url = 'https://www.refuges.info/point/2940/cabane-non-gardee/abri-de-Tardevant/';

async function debug() {
    try {
        const { data: html } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RefugeExplorerBot/1.0)' }
        });
        const $ = cheerio.load(html);

        console.log('--- Searching for Status (Ouvert/Fermé) ---');
        // Look for specific classes or text indicating status
        const bodyText = $('body').text();
        if (bodyText.includes('Ouvert')) console.log('Found "Ouvert" in body');
        if (bodyText.includes('Fermé')) console.log('Found "Fermé" in body');

        $('.fiche_cadre').each((i, el) => {
            console.log('Fiche Content for Status:', $(el).text().substring(0, 200));
        });

        console.log('--- Extracting Comments ---');
        $('.bloc_commentaire').each((i, el) => {
            const date = $(el).find('.commentaire_date').text().trim();
            const author = $(el).find('.commentaire_pseudo').text().trim();
            const text = $(el).find('.commentaire_texte').text().trim();
            console.log(`Comment ${i}: [${date}] ${author} - ${text.substring(0, 50)}...`);
        });

    } catch (e) {
        console.error(e);
    }
}

debug();
