import fs from 'fs';
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'path';

const INPUT_FILE = path.join(process.cwd(), 'public/refuges.json');
const OUTPUT_FILE = path.join(process.cwd(), 'public/refuges_enriched.json');
const REQUEST_DELAY_MS = 200;

const normalizeText = (value = '') =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const shouldCaptureRemarks = (text) => {
  const normalized = normalizeText(text);
  return normalized.includes('remarques') || normalized.includes('informations complementaires');
};

const parseArgs = () => {
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const startArg = process.argv.find((arg) => arg.startsWith('--start='));
  return {
    limit: limitArg ? Number(limitArg.split('=')[1]) : null,
    start: startArg ? Number(startArg.split('=')[1]) : 0,
  };
};

const isYes = (val = '') => {
  const v = normalizeText(val);
  if (!v) return false;
  if (v.includes('non')) return false;
  return v.includes('oui') || v.includes('ok') || v.includes('dispo') || v.includes('present');
};

const decodeHtml = (str = '') => {
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/<[^>]+>/g, '')
    .trim();
};

const fetchComments = async (id) => {
  try {
    const { data } = await axios.get(`https://www.refuges.info/api/commentaires?id_point=${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RefugeExplorerBot/1.0)' },
    });
    const list = Object.values(data || {}).filter((c) => c && c.date_commentaire);
    list.sort((a, b) => new Date(b.date_commentaire) - new Date(a.date_commentaire));
    return list.map((c) => ({
      id: c.id_commentaire,
      date: c.date_commentaire,
      author: c.auteur_commentaire || '',
      text: decodeHtml(c.texte_commentaire || ''),
      photos: {
        vignette: c['photo-vignette'] ? `https://www.refuges.info${c['photo-vignette']}` : null,
        reduite: c['photo-reduite'] ? `https://www.refuges.info${c['photo-reduite']}` : null,
        originale: c['photo-originale'] ? `https://www.refuges.info${c['photo-originale']}` : null,
      },
    }));
  } catch (e) {
    return [];
  }
};

const extractComments = ($) => {
  const comments = [];
  let nodes = $('.bloc_commentaire');
  if (!nodes.length) nodes = $.root().find('.bloc_commentaire');

  nodes.each((i, el) => {
    const date = $(el).find('.commentaire_date').text().trim();
    const author = $(el).find('.commentaire_pseudo').text().trim();
    const text = $(el).find('.commentaire_texte').text().trim();
    if (text) comments.push({ date, author, text });
  });

  // Fallback if structure differs
  if (!comments.length) {
    $('.commentaire_texte').each((i, el) => {
      const text = $(el).text().trim();
      if (text) comments.push({ date: '', author: '', text });
    });
  }

  return comments;
};

const extractDetails = ($) => {
  const details = {};
  $('dd').each((i, el) => {
    const raw = $(el).text().trim();
    const parts = raw.split(':');
    const key = normalizeText(parts[0] || '');
    const val = (parts.slice(1).join(':') || raw).trim();

    if (key.includes('eau')) details.water = val;
    if (key.includes('poele') || key.includes('cheminee')) details.heating = val;
    if (key.includes('bois') || key.includes('foret')) details.wood = val;
    if (key.includes('latrines')) details.latrines = val;
    if (key.includes('matelas')) details.mattress = val;
    if (key.includes('couvertures')) details.blankets = val;
    if (key.includes('places')) details.places = val;
    if (key.includes('acces')) details.access = val;
  });

  // derived booleans in French for easier use
  const hasWood = isYes(details.wood || '');
  let hasHeating = isYes(details.heating || '');

  if (!hasHeating && hasWood) {
    details.heating = 'Poele / bois';
    hasHeating = true;
  }
  if (!hasWood && isYes(details.heating || '')) {
    details.wood = details.heating;
  }

  details.equipements = {
    eau: isYes(details.water || ''),
    chauffage: hasHeating,
    bois: hasWood,
    latrines: isYes(details.latrines || ''),
    matelas: isYes(details.mattress || ''),
    couvertures: isYes(details.blankets || ''),
  };

  return details;
};

async function scrape() {
  console.log('Reading input file...');
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Input file not found: ${INPUT_FILE}`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const { limit, start } = parseArgs();
  const features = data.features.slice(start, limit ? start + limit : undefined);
  const enriched = [];

  console.log(`Starting scrape of ${features.length} refuges (from index ${start}${limit ? `, limit ${limit}` : ''}).`);

  for (const feature of features) {
    const url = feature.properties.lien;
    process.stdout.write(`Scraping ${feature.properties.nom}... `);

    try {
      const { data: html } = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RefugeExplorerBot/1.0)' },
      });
      const $ = cheerio.load(html);

            // Extract Photos
            const photos = [];
            $('.photos img').each((i, el) => {
                let src = $(el).attr('src');
                if (src) {
                    if (!src.startsWith('http')) {
                        src = `https://www.refuges.info${src}`;
                    }
                    photos.push(src);
                }
            });

            // Extract Remarks
            let remarks = '';

            $('dt').each((i, el) => {
                const text = $(el).text().trim();
                if (shouldCaptureRemarks(text)) {
                    const next = $(el).next('dd');
                    if (next.length) {
                        remarks += next.text().trim() + ' ';
                    }
                }
            });

            if (!remarks) {
                $('b, strong').each((i, el) => {
                    const text = $(el).text().trim();
                    if (shouldCaptureRemarks(text)) {
                        const parent = $(el).parent();
                        const clone = parent.clone();
                        clone.find('b, strong').remove();
                        remarks += clone.text().trim() + ' ';
                    }
                });
            }

            if (!remarks || remarks.length < 10) {
                const firstComment = $('.bloc_commentaire').first().find('.commentaire_texte').text().trim();
                if (firstComment) remarks = firstComment;
            }

            const htmlComments = extractComments($);
            const apiComments = await fetchComments(feature.properties.id);
            const comments = apiComments.length ? apiComments : htmlComments;

            // Extract Status (Open/Closed)
            let status = 'Ouvert';
            const ficheText = normalizeText($('.fiche_cadre').text());
            if (ficheText.includes('detruit')) {
                status = 'Detruit';
            } else if (ficheText.includes('ferme')) {
                status = 'Ferme';
            } else if (ficheText.includes('cle') && ficheText.includes('recuperer')) {
                status = 'Cle requise';
            }

            // Extract Specific Details (Water, Wood, Latrines, etc.)
            const details = extractDetails($);

            feature.properties.photos = photos;
            feature.properties.remarks = remarks.trim();
            feature.properties.remarques = feature.properties.remarks; // alias FR
            feature.properties.details = details;
            feature.properties.comments = comments;
            feature.properties.commentStats = {
                count: comments.length,
                lastDate: comments[0]?.date || null,
            };
            feature.properties.status = status;

      // Calculate Score
            // Placeholder score (kept for UI compatibility, can be recalculated later)
            let score = 0;
            if (photos.length > 0) score += 20;
            if (remarks.length > 50) score += 15;
            if (details.equipements.eau) score += 15;
            if (details.equipements.bois || details.equipements.chauffage) score += 15;
            if (details.equipements.latrines) score += 10;
            if (details.equipements.matelas || details.equipements.couvertures) score += 15;
            if (feature.properties.places && feature.properties.places.valeur > 0) score += 10;
            feature.properties.score = Math.min(100, score);

      enriched.push(feature);
      console.log('Done.');
    } catch (e) {
      console.log(`Failed: ${e.message}`);
      enriched.push(feature);
    }

    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  const outputCollection = { ...data, features: enriched };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputCollection, null, 2));
  console.log(`\nSaved ${enriched.length} enriched items to ${OUTPUT_FILE}`);
}

scrape();
