import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';

const BASE_URL = 'https://mirrorinkomik.my.id';

// Mengambil list genre dari array yang ada di file Kotlin kamu
const GENRES = [
    "Action", "Adventure", "Comedy", "Demons", "Drama", "Ecchi", 
    "Fantasy", "Harem", "Historical", "Isekai", "Magic", "Martial Art", 
    "Military", "Reincarnation", "Romance", "School", "Seinen", 
    "Shoujo", "Shounen", "Slice of Life", "Supernatural", "Webtoons", "Yaoi"
];

// Fungsi untuk menjeda eksekusi (menghindari rate-limit/blokir IP)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scrapeGenre(genre) {
    let page = 1;
    let lastId = null;
    let hasNextPage = true;
    const results = [];

    console.log(`\n🚀 Memulai scraping genre: ${genre}...`);

    while (hasNextPage) {
        try {
            let htmlToParse = '';

            if (page === 1) {
                // Request Halaman Pertama
                const response = await axios.get(`${BASE_URL}/Genre/${genre}`);
                htmlToParse = response.data;
                
                const $ = cheerio.load(htmlToParse);
                lastId = $('#load-more').attr('data-last-id');
                
            } else {
                // Request Halaman Kedua dst (Load More API)
                const response = await axios.get(`${BASE_URL}/loadmore-type`, {
                    params: {
                        type: genre,
                        last_id: lastId
                    },
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });

                // Di Kotlin dibilang responnya JSON berisi { html, lastId, lastScore }
                const data = response.data;
                htmlToParse = data.html || '';
                lastId = data.lastId;
            }

            // Mencegah error jika lastId nilainya '0' (berarti sudah mentok)
            if (lastId === '0' || !lastId) {
                lastId = null;
                hasNextPage = false;
            } else {
                page++;
            }

            // Parsing HTML dengan Cheerio
            const $ = cheerio.load(htmlToParse);
            
            // Selector ini mengadopsi fungsi mangaFromKomikCard & mangaFromGenreCard di Kotlin
            const cards = $('a.komik-card, #genre-list .bsx a[title]');

            cards.each((i, el) => {
                let url = $(el).attr('href');
                if (url && !url.startsWith('http')) {
                    url = `${BASE_URL}${url}`;
                }

                // Ambil judul
                let title = $(el).find('.komik-info h3').text().trim();
                if (!title) title = $(el).attr('title')?.trim();

                // Ambil gambar
                let thumb = $(el).find('.komik-cover img').attr('src');
                if (!thumb) thumb = $(el).find('img').attr('src');

                if (title && url) {
                    results.push({
                        title,
                        url,
                        thumbnail_url: thumb || null
                    });
                }
            });

            console.log(`   [${genre}] Berhasil memproses ${results.length} judul sejauh ini (Last ID: ${lastId || 'TAMAT'})`);

            // Jeda 2 detik antar request halaman supaya server gak keberatan
            if (hasNextPage) await delay(2000); 

        } catch (error) {
            console.error(`❌ Error pada genre ${genre} (Halaman ${page}):`, error.message);
            hasNextPage = false; // Berhenti nge-scrape genre ini kalau ada error beruntun
        }
    }

    // Simpan ke file JSON
    const fileName = `genre_${genre.toLowerCase().replace(/\s/g, '_')}.json`;
    await fs.writeFile(fileName, JSON.stringify(results, null, 2));
    console.log(`✅ Selesai! Data genre ${genre} tersimpan di ${fileName} (Total: ${results.length} judul)`);
}

async function main() {
    console.log("Memulai proses scraping semua genre...");
    
    // Looping genre satu per satu secara berurutan
    // JANGAN gunakan Promise.all() di sini agar server web komik tidak down ditembak banyak request sekaligus
    for (const genre of GENRES) {
        await scrapeGenre(genre);
        // Jeda 5 detik tiap ganti genre
        await delay(5000);
    }
    
    console.log("\n🎉 SEMUA PROSES SELESAI!");
}

main();
